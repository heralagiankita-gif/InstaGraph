using System.Text.Json.Serialization;
using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.Extensions;
using InstaGraph.Api.Graph;
using InstaGraph.Api.Middleware;
using InstaGraph.Api.Realtime;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// -------------------------------------------------------------------- services
builder.Services
    .AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());

        // Every timestamp goes out as UTC with an explicit Z. Without this the browser reads a bare
        // date-time as local time and every relative timestamp is wrong by the viewer's offset.
        options.JsonSerializerOptions.Converters.Add(new UtcDateTimeConverter());
        options.JsonSerializerOptions.Converters.Add(new NullableUtcDateTimeConverter());

        options.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
    });

// Model-validation failures go out in the same JSON shape as everything else, so the client has one
// error path rather than two.
builder.Services.Configure<ApiBehaviorOptions>(options =>
{
    options.InvalidModelStateResponseFactory = context =>
    {
        var message = context.ModelState
            .SelectMany(entry => entry.Value?.Errors ?? [])
            .Select(error => error.ErrorMessage)
            .FirstOrDefault(m => !string.IsNullOrWhiteSpace(m)) ?? "That request was not valid.";

        return new BadRequestObjectResult(new
        {
            statusCode = StatusCodes.Status400BadRequest,
            message,
            path = context.HttpContext.Request.Path.Value,
            timestamp = DateTime.UtcNow
        });
    };
});

builder.Services.AddInstaGraph(builder.Configuration);
builder.Services.AddJwtAuth(builder.Configuration);
builder.Services.AddClientCors(builder.Configuration);
builder.Services.AddSwaggerWithAuth();

var app = builder.Build();

// ------------------------------------------------------- database and warm-up
await using (var scope = app.Services.CreateAsyncScope())
{
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();

    try
    {
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();

        // Which sessions stopped being valid before their expiry says so. Read once into memory so the
        // check on every authenticated request is a dictionary lookup rather than a query — and read at
        // all so that restarting the API does not hand back the sessions a password change ended.
        await scope.ServiceProvider.GetRequiredService<ISessionRevocations>().LoadAsync(db);

        // No demo data: the app starts empty and fills up with whatever real accounts sign up.
        var snapshot = await app.Services.GetRequiredService<IGraphSnapshotProvider>().GetAsync();

        logger.LogInformation(
            "InstaGraph ready on {Url}. {Nodes} accounts, {Edges} follows, {Communities} communities.",
            "http://localhost:5120", snapshot.NodeCount, snapshot.EdgeCount, snapshot.CommunityCount);

        // Worth one line at boot: whether a confirmation code will reach an inbox is the difference
        // between a sign-up somebody can complete and one that dead-ends, and it is not obvious from
        // anywhere else until the first person tries it.
        var mail = scope.ServiceProvider.GetRequiredService<IEmailSender>();

        logger.LogInformation(mail.Delivers
            ? "Mail is configured — confirmation codes will be emailed."
            : "Mail is NOT configured — confirmation codes go to this log, and the sign-up screen says so.");
    }
    catch (Exception ex)
    {
        // The API still starts, so Swagger is reachable and the reason is visible.
        logger.LogError(ex,
            "Startup could not prepare the database. Check that SQL Server is running and that "
            + "ConnectionStrings:DefaultConnection in appsettings.json points at it.");
    }
}

// -------------------------------------------------------------------- pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "InstaGraph API v1");
        options.DocumentTitle = "InstaGraph API";
        options.DisplayRequestDuration();
    });

    app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();
}

app.UseMiddleware<ExceptionMiddleware>();

app.UseCors(ServiceCollectionExtensions.CorsPolicyName);

// Uploaded photos are served as plain static files. An <img> tag cannot attach a bearer token, so this
// sits ahead of authentication and the filenames are unguessable GUIDs rather than sequential ids.
//
// Two headers go with them. nosniff stops the browser second-guessing the content type and deciding a
// file is markup after all — which, for a directory whose contents are chosen by users, is the whole
// ball game. The CSP is the belt to that pair of braces: even if something scriptable were served from
// here, it would have nothing it was allowed to do.
// The same wwwroot also holds the built Angular app on a deployed build, and the two need opposite
// treatment: uploads are hostile input to be locked down, the SPA is our own code that has to run. So
// the hardened headers are scoped to the uploads path rather than applied to everything served here.
var uploadsPath = "/" + (builder.Configuration["Uploads:Folder"] ?? "uploads").Trim('/');

app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        var headers = context.Context.Response.Headers;

        headers.XContentTypeOptions = "nosniff";

        if (context.Context.Request.Path.StartsWithSegments(uploadsPath))
        {
            headers.ContentSecurityPolicy = "default-src 'none'; sandbox";

            // Uploaded media never changes — the name is a fresh GUID every time — so cache it hard.
            headers.CacheControl = "public, max-age=31536000, immutable";
        }
        else if (context.File.Name.Equals("index.html", StringComparison.OrdinalIgnoreCase))
        {
            // The one file that must not be cached. It names the hashed bundles, so a stale copy points
            // a browser at chunk filenames that no longer exist and the app fails to boot after a deploy.
            headers.CacheControl = "no-cache, no-store, must-revalidate";
        }
        else
        {
            // Everything else Angular emits carries a content hash in its filename.
            headers.CacheControl = "public, max-age=31536000, immutable";
        }
    }
});

app.UseAuthentication();
app.UseAuthorization();

// After authentication, so it knows who is asking: one dictionary write per request, which is what the
// green dot and "Active now" are read from.
app.UseMiddleware<PresenceMiddleware>();

app.MapControllers();

// The socket. One connection per open tab; the client falls back to server-sent events and then to long
// polling on its own if a proxy refuses to upgrade.
app.MapHub<RealtimeHub>("/hubs/realtime");

// ------------------------------------------------------------------- the SPA
// On a deployed build the Angular bundle sits in wwwroot and this API is the only origin there is.
// `/explore` is a route the client router owns, not a file on disk, so anything that reaches the end of
// the pipeline unmatched is handed index.html and the router resolves it in the browser. Without this,
// a refresh on any URL but `/` is a 404 — the classic single-page-app deployment bug.
//
// The prefixes below are excluded deliberately. A wrong API path has to keep answering 404, because
// returning a page of HTML to something expecting JSON turns a clear "no such endpoint" into a parse
// error three layers away from the cause.
app.MapFallback(async context =>
{
    var path = context.Request.Path;

    if (path.StartsWithSegments("/api")
        || path.StartsWithSegments("/hubs")
        || path.StartsWithSegments("/swagger")
        || path.StartsWithSegments(uploadsPath))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    var index = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html");

    // No SPA in wwwroot is the normal state on a dev machine, where Angular is served by `ng serve` on
    // its own port. Say so plainly rather than throwing a file-not-found.
    if (!File.Exists(index))
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    context.Response.ContentType = "text/html";
    context.Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";

    await context.Response.SendFileAsync(index);
});

app.Run();
