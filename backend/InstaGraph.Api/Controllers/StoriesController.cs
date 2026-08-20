using InstaGraph.Api.DTOs;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace InstaGraph.Api.Controllers;

/// <summary>
/// Stories. The audience is the author's in-edges — everyone who follows them — optionally narrowed to
/// the close-friends list. Nothing ranks them, so nothing has to justify the order.
/// </summary>
[Route("api/stories")]
public class StoriesController(IStoryService stories, ICurrentUser currentUser)
    : ApiControllerBase(currentUser)
{
    /// <summary>
    /// Posts a story. Multipart form: <c>image</c>, <c>caption</c>, <c>closeFriendsOnly</c>.
    /// </summary>
    [HttpPost]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<ActionResult<StoryResponse>> Create(
        [FromForm] CreateStoryRequest request, CancellationToken ct) =>
        Ok(await stories.CreateAsync(UserId, request, ct));

    /// <summary>The ring row: yours first, then anybody with something you have not opened.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<StoryTrayItem>>> Tray(CancellationToken ct) =>
        Ok(await stories.TrayAsync(UserId, ct));

    /// <summary>One account's live stories, oldest first — the order the viewer plays them in.</summary>
    [HttpGet("{username}")]
    public async Task<ActionResult<StoryTrayItem>> ByUser(string username, CancellationToken ct) =>
        Ok(await stories.ByUserAsync(UserId, username, ct));

    /// <summary>Records that you opened it. Your own stories are never counted as views.</summary>
    [HttpPost("{id:int}/view")]
    public async Task<IActionResult> View(int id, CancellationToken ct)
    {
        await stories.MarkSeenAsync(UserId, id, ct);
        return NoContent();
    }

    /// <summary>Who watched. Visible to the author and to nobody else.</summary>
    [HttpGet("{id:int}/viewers")]
    public async Task<ActionResult<IReadOnlyList<StoryViewer>>> Viewers(int id, CancellationToken ct) =>
        Ok(await stories.ViewersAsync(UserId, id, ct));

    /// <summary>Answers a story. It arrives as an ordinary direct message, through the ordinary gate.</summary>
    [HttpPost("{id:int}/reply")]
    public async Task<ActionResult<MessageResponse>> Reply(
        int id, StoryReplyRequest request, CancellationToken ct) =>
        Ok(await stories.ReplyAsync(UserId, id, request.Text, ct));

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await stories.DeleteAsync(UserId, id, ct);
        return NoContent();
    }
}
