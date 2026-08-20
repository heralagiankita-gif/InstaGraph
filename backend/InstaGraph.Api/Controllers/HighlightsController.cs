using InstaGraph.Api.DTOs;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace InstaGraph.Api.Controllers;

/// <summary>
/// Story highlights, and the archive they are picked from.
/// <para>
/// A highlight is a second reference to a story rather than a longer-lived story: the story keeps its own
/// expiry and leaves the tray on time, while the highlight holds a pointer that expiry does not touch.
/// </para>
/// </summary>
[Route("api/highlights")]
public class HighlightsController(IHighlightService highlights, ICurrentUser currentUser)
    : ApiControllerBase(currentUser)
{
    /// <summary>The circles under somebody's bio. Covers only — the photos come when one is opened.</summary>
    [HttpGet("user/{username}")]
    public async Task<ActionResult<IReadOnlyList<StoryHighlightResponse>>> ByUser(
        string username, CancellationToken ct) =>
        Ok(await highlights.ListAsync(UserId, username, ct));

    /// <summary>One highlight and everything in it, oldest first — the order it plays in.</summary>
    [HttpGet("{id:int}")]
    public async Task<ActionResult<StoryHighlightResponse>> Get(int id, CancellationToken ct) =>
        Ok(await highlights.GetAsync(UserId, id, ct));

    [HttpPost]
    public async Task<ActionResult<StoryHighlightResponse>> Create(
        CreateHighlightRequest request, CancellationToken ct) =>
        Ok(await highlights.CreateAsync(UserId, request, ct));

    /// <summary>Renames it, re-covers it, or replaces what is in it. Anything left null is left alone.</summary>
    [HttpPut("{id:int}")]
    public async Task<ActionResult<StoryHighlightResponse>> Update(
        int id, UpdateHighlightRequest request, CancellationToken ct) =>
        Ok(await highlights.UpdateAsync(UserId, id, request, ct));

    /// <summary>Removes the highlight. The stories in it are untouched and stay in your archive.</summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await highlights.DeleteAsync(UserId, id, ct);
        return NoContent();
    }

    /// <summary>
    /// Every story you have ever posted, live and expired alike, newest first. Yours and nobody else's.
    /// </summary>
    [HttpGet("archive")]
    public async Task<ActionResult<Page<StoryResponse>>> Archive(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 24, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 24, 60);
        return Ok(await highlights.ArchiveAsync(UserId, p, size, ct));
    }
}
