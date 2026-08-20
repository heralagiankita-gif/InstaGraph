using InstaGraph.Api.Common;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace InstaGraph.Api.Controllers;

/// <summary>
/// Settings and activity. Most of what is here is a rule about the follow edge rather than about content:
/// who may message you, who may comment, and the two named subsets of the edge set — close friends on the
/// way in, favourites on the way out.
/// </summary>
[Route("api/settings")]
public class SettingsController(ISettingsService settings, INoteService notes, ICurrentUser currentUser)
    : ApiControllerBase(currentUser)
{
    [HttpGet]
    public async Task<ActionResult<SettingsResponse>> Get(CancellationToken ct) =>
        Ok(await settings.GetAsync(UserId, ct));

    [HttpPut]
    public async Task<ActionResult<SettingsResponse>> Update(
        UpdateSettingsRequest request, CancellationToken ct) =>
        Ok(await settings.UpdateAsync(UserId, request, ct));

    /// <summary>What you have done here, counted — the numbers behind "Your activity".</summary>
    [HttpGet("activity")]
    public async Task<ActionResult<ActivitySummary>> Activity(CancellationToken ct) =>
        Ok(await settings.ActivityAsync(UserId, ct));

    /// <summary>
    /// One of the two lists. <c>kind</c> is <c>close-friends</c> (drawn from your followers) or
    /// <c>favorites</c> (drawn from the accounts you follow).
    /// </summary>
    [HttpGet("lists/{kind}")]
    public async Task<ActionResult<Page<ListMember>>> List(
        string kind,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 20, 50);
        return Ok(await settings.ListAsync(UserId, ParseKind(kind), p, size, ct));
    }

    [HttpPost("lists/{kind}/{username}")]
    public async Task<ActionResult<object>> Add(string kind, string username, CancellationToken ct)
    {
        var count = await settings.SetListEntryAsync(UserId, ParseKind(kind), username, on: true, ct);
        return Ok(new { count });
    }

    [HttpDelete("lists/{kind}/{username}")]
    public async Task<ActionResult<object>> Remove(string kind, string username, CancellationToken ct)
    {
        var count = await settings.SetListEntryAsync(UserId, ParseKind(kind), username, on: false, ct);
        return Ok(new { count });
    }

    /// <summary>The notes above the inbox — yours, then everybody whose note reaches you.</summary>
    [HttpGet("/api/notes")]
    public async Task<ActionResult<IReadOnlyList<NoteResponse>>> Notes(CancellationToken ct) =>
        Ok(await notes.ListAsync(UserId, ct));

    /// <summary>Writes or replaces your note. Sixty characters, gone in a day.</summary>
    [HttpPost("/api/notes")]
    public async Task<ActionResult<NoteResponse>> WriteNote(WriteNoteRequest request, CancellationToken ct) =>
        Ok(await notes.WriteAsync(UserId, request, ct));

    [HttpDelete("/api/notes")]
    public async Task<IActionResult> ClearNote(CancellationToken ct)
    {
        await notes.ClearAsync(UserId, ct);
        return NoContent();
    }

    private static UserListKind ParseKind(string kind) => kind.Trim().ToLowerInvariant() switch
    {
        "close-friends" or "closefriends" => UserListKind.CloseFriends,
        "favorites" or "favourites" => UserListKind.Favorites,
        _ => throw AppException.BadRequest("The list is either close-friends or favorites.")
    };
}
