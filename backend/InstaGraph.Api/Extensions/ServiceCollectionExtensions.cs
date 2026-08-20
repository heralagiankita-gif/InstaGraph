using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.Graph;
using InstaGraph.Api.Realtime;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;

namespace InstaGraph.Api.Extensions;

public static class ServiceCollectionExtensions
{
    public const string CorsPolicyName = "InstaGraphClient";

    public static IServiceCollection AddInstaGraph(this IServiceCollection services, IConfiguration config)
    {
        services.Configure<JwtSettings>(config.GetSection(JwtSettings.SectionName));
        services.Configure<UploadSettings>(config.GetSection(UploadSettings.SectionName));
        services.Configure<FeedSettings>(config.GetSection(FeedSettings.SectionName));
        services.Configure<GraphSettings>(config.GetSection(GraphSettings.SectionName));
        services.Configure<EmailSettings>(config.GetSection(EmailSettings.SectionName));

        // Retry on transient failures. On a local SQL Server this almost never fires; against a hosted
        // database it is the difference between working and not. Azure SQL's free tier pauses itself
        // when idle and throttles under load, and both surface as an exception on a connection that
        // would succeed a second later — so the first visitor after a quiet hour gets an error page
        // unless something retries for them. Safe here only because nothing in this codebase opens an
        // explicit transaction: the retrying execution strategy refuses to wrap one it did not start.
        services.AddDbContext<AppDbContext>(options =>
            options.UseSqlServer(config.GetConnectionString("DefaultConnection"),
                sql => sql.EnableRetryOnFailure(
                    maxRetryCount: 5,
                    maxRetryDelay: TimeSpan.FromSeconds(10),
                    errorNumbersToAdd: null)));

        services.AddHttpContextAccessor();

        // One shared copy of the follow graph for the whole process — rebuilding it per request would
        // defeat the point of holding it in memory at all.
        services.AddSingleton<IGraphSnapshotProvider, GraphSnapshotProvider>();

        // Stateless — it reads a snapshot and some weights, so one instance serves everybody.
        services.AddSingleton<ISuggestionEngine, SuggestionEngine>();

        // Who is online and who is typing. One dictionary for the process: both facts expire in seconds,
        // so writing them to SQL would cost a row update per keystroke to store something already stale.
        services.AddSingleton<IPresenceTracker, PresenceTracker>();

        // How many wrong passwords an account or an address may offer before the app stops answering,
        // and which sessions stopped being valid before their expiry says so. Both hold facts that expire
        // in minutes and belong to the process rather than the row, for the same reason presence does.
        services.AddSingleton<ILoginThrottle, LoginThrottle>();
        services.AddSingleton<ISessionRevocations, SessionRevocations>();

        // SignalR is part of the shared framework, so this costs no package reference. Timestamps go out
        // through the same UTC converter the controllers use, or a pushed message would carry a different
        // date format from the one fetched over HTTP.
        services
            .AddSignalR(options =>
            {
                // A browser tab that has been asleep should be dropped rather than held open forever.
                options.ClientTimeoutInterval = TimeSpan.FromSeconds(60);
                options.KeepAliveInterval = TimeSpan.FromSeconds(15);
            })
            .AddJsonProtocol(options =>
            {
                options.PayloadSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
                options.PayloadSerializerOptions.Converters.Add(new JsonStringEnumConverter());
                options.PayloadSerializerOptions.Converters.Add(new UtcDateTimeConverter());
                options.PayloadSerializerOptions.Converters.Add(new NullableUtcDateTimeConverter());
            });

        services.AddSingleton<IRealtimeNotifier, RealtimeNotifier>();

        services.AddScoped<ICurrentUser, CurrentUser>();
        services.AddScoped<IRelationshipReader, RelationshipReader>();
        services.AddScoped<ITokenService, TokenService>();
        services.AddScoped<IImageStorage, ImageStorage>();
        services.AddScoped<IEmailSender, EmailSender>();
        services.AddScoped<IAuthService, AuthService>();
        services.AddScoped<IUserService, UserService>();
        services.AddScoped<IPostService, PostService>();
        services.AddScoped<IFeedService, FeedService>();
        services.AddScoped<IGraphInsightsService, GraphInsightsService>();
        services.AddScoped<INotificationService, NotificationService>();
        services.AddScoped<IMessagingService, MessagingService>();
        services.AddScoped<INoteService, NoteService>();
        services.AddScoped<ISettingsService, SettingsService>();
        services.AddScoped<IStoryService, StoryService>();
        services.AddScoped<IHighlightService, HighlightService>();
        services.AddScoped<ICollectionService, CollectionService>();

        return services;
    }

    public static IServiceCollection AddJwtAuth(this IServiceCollection services, IConfiguration config)
    {
        var jwt = config.GetSection(JwtSettings.SectionName).Get<JwtSettings>()
                  ?? throw new InvalidOperationException("The Jwt section is missing from configuration.");

        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = jwt.Issuer,
                    ValidAudience = jwt.Audience,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.SecretKey)),
                    // Default is five minutes of slack on expiry, which hides bugs during development.
                    ClockSkew = TimeSpan.Zero
                };

                options.Events = new JwtBearerEvents
                {
                    // A WebSocket handshake cannot carry an Authorization header, so the SignalR client
                    // puts the token in the query string instead. Accepted only for the hub path —
                    // everywhere else a token in a URL would end up in logs and browser history.
                    OnMessageReceived = context =>
                    {
                        var token = context.Request.Query["access_token"];

                        if (!string.IsNullOrEmpty(token)
                            && context.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                        {
                            context.Token = token;
                        }

                        return Task.CompletedTask;
                    },

                    // The signature being good only proves the token was ours when it was made. This is
                    // where a token stops being valid earlier than it says: a password change ends every
                    // session issued before it, which is the only thing that makes changing a password
                    // useful against somebody who already has one.
                    //
                    // It costs a dictionary lookup, not a query — see ISessionRevocations.
                    OnTokenValidated = context =>
                    {
                        var principal = context.Principal;
                        var revocations = context.HttpContext.RequestServices
                            .GetRequiredService<ISessionRevocations>();

                        var id = principal?.FindFirstValue(ClaimTypes.NameIdentifier);
                        var ticks = principal?.FindFirstValue(InstaGraphClaims.IssuedAtTicks);

                        if (!int.TryParse(id, out var userId) || !long.TryParse(ticks, out var issued))
                        {
                            // Predates the claim, so it predates every password change too.
                            context.Fail("Sign in again.");
                            return Task.CompletedTask;
                        }

                        if (revocations.IsRevoked(userId, new DateTime(issued, DateTimeKind.Utc)))
                        {
                            context.Fail("Your password changed. Sign in again.");
                        }

                        return Task.CompletedTask;
                    }
                };
            });

        services.AddAuthorization();

        return services;
    }

    public static IServiceCollection AddClientCors(this IServiceCollection services, IConfiguration config)
    {
        var origins = config.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? ["http://localhost:4200"];

        services.AddCors(options => options.AddPolicy(CorsPolicyName, policy => policy
            .WithOrigins(origins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            // Required by the SignalR handshake. Safe here because the origins are named explicitly —
            // credentials cannot be combined with a wildcard origin, and the browser enforces that.
            .AllowCredentials()));

        return services;
    }

    public static IServiceCollection AddSwaggerWithAuth(this IServiceCollection services)
    {
        services.AddEndpointsApiExplorer();

        services.AddSwaggerGen(options =>
        {
            options.SwaggerDoc("v1", new OpenApiInfo
            {
                Title = "InstaGraph API",
                Version = "v1",
                Description = "A photo-sharing app. Follows are directed edges; the feed, suggestions and "
                              + "explore are all questions asked of that graph."
            });

            options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
            {
                Name = "Authorization",
                Type = SecuritySchemeType.Http,
                Scheme = "bearer",
                BearerFormat = "JWT",
                In = ParameterLocation.Header,
                Description = "Paste the token from /api/auth/login."
            });

            options.AddSecurityRequirement(new OpenApiSecurityRequirement
            {
                {
                    new OpenApiSecurityScheme
                    {
                        Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" }
                    },
                    Array.Empty<string>()
                }
            });

            var xml = Path.Combine(AppContext.BaseDirectory, "InstaGraph.Api.xml");

            if (File.Exists(xml))
            {
                options.IncludeXmlComments(xml);
            }
        });

        return services;
    }
}
