using System.Text.Json;
using InstaGraph.Api.Common;

namespace InstaGraph.Api.Middleware;

/// <summary>
/// One place where every failure becomes the same JSON shape, so the client has a single error path.
/// </summary>
public class ExceptionMiddleware(RequestDelegate next, ILogger<ExceptionMiddleware> logger)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (AppException ex)
        {
            // Expected: the caller asked for something they cannot have. Not worth a stack trace.
            logger.LogInformation("{Status} on {Path}: {Message}", ex.StatusCode, context.Request.Path, ex.Message);
            await WriteAsync(context, ex.StatusCode, ex.Message);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Unhandled error on {Path}.", context.Request.Path);
            await WriteAsync(context, StatusCodes.Status500InternalServerError, "Something went wrong on our side.");
        }
    }

    private static async Task WriteAsync(HttpContext context, int status, string message)
    {
        if (context.Response.HasStarted)
        {
            return;
        }

        context.Response.Clear();
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json";

        await context.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            statusCode = status,
            message,
            path = context.Request.Path.Value,
            timestamp = DateTime.UtcNow
        }, Json));
    }
}
