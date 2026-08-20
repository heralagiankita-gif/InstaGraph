namespace InstaGraph.Api.Common;

/// <summary>
/// Thrown by services when the caller is at fault. Carries the status code so controllers stay free of
/// try/catch and the middleware has everything it needs to write the response.
/// </summary>
public class AppException(int statusCode, string message) : Exception(message)
{
    public int StatusCode { get; } = statusCode;
    public static AppException BadRequest(string message) => new(StatusCodes.Status400BadRequest, message);

    public static AppException Unauthorized(string message = "Please sign in.") =>
        new(StatusCodes.Status401Unauthorized, message);

    public static AppException Forbidden(string message = "You cannot do that.") =>
        new(StatusCodes.Status403Forbidden, message);

    public static AppException NotFound(string message = "Not found.") =>
        new(StatusCodes.Status404NotFound, message);

    public static AppException Conflict(string message) => new(StatusCodes.Status409Conflict, message);

    /// <summary>
    /// Slow down. Used by the sign-in lockout, where the distinction from a plain 401 matters: the caller
    /// is no longer being told their password was wrong, because it is no longer being checked.
    /// </summary>
    public static AppException TooManyRequests(string message) =>
        new(StatusCodes.Status429TooManyRequests, message);
}
