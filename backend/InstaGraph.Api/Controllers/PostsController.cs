using InstaGraph.Api.DTOs;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace InstaGraph.Api.Controllers;

[Route("api/posts")]
public class PostsController(
    IPostService posts, ICollectionService collections, ICurrentUser currentUser)
    : ApiControllerBase(currentUser)
{
    /// <summary>
    /// Creates a post. Multipart form: <c>media</c> (one to ten photos or clips, in order), or
    /// <c>image</c> for a single photo; plus <c>caption</c>, <c>location</c>, <c>aspectRatios</c>,
    /// <c>durations</c>, and <c>posters</c>/<c>posterFor</c> for the clips. Hashtags are pulled out of the
    /// caption automatically.
    /// </summary>
    [HttpPost]
    // Ten clips at the video ceiling is the worst case, so the limit is raised here rather than globally:
    // it is this one endpoint that legitimately receives a large body, and nothing else should.
    [RequestSizeLimit(256L * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 256L * 1024 * 1024, ValueCountLimit = 256)]
    public async Task<ActionResult<PostResponse>> Create(
        [FromForm] CreatePostRequest request, CancellationToken ct)
    {
        var created = await posts.CreateAsync(UserId, request, ct);
        return CreatedAtAction(nameof(Get), new { id = created.Id }, created);
    }

    /// <summary>Replaces the whole set of people named in the photo.</summary>
    [HttpPut("{id:int}/tags")]
    public async Task<ActionResult<PostResponse>> SetTags(
        int id, SetPostTagsRequest request, CancellationToken ct) =>
        Ok(await posts.SetTagsAsync(UserId, id, request, ct));

    /// <summary>Moves a post off your grid and out of every feed, without destroying it.</summary>
    [HttpPost("{id:int}/archive")]
    public async Task<ActionResult<PostResponse>> Archive(int id, CancellationToken ct) =>
        Ok(await posts.SetArchivedAsync(UserId, id, archived: true, ct));

    [HttpDelete("{id:int}/archive")]
    public async Task<ActionResult<PostResponse>> Unarchive(int id, CancellationToken ct) =>
        Ok(await posts.SetArchivedAsync(UserId, id, archived: false, ct));

    /// <summary>Pins a post to the top of your grid. Three at most.</summary>
    [HttpPost("{id:int}/pin")]
    public async Task<ActionResult<PostResponse>> Pin(int id, CancellationToken ct) =>
        Ok(await posts.SetPinnedAsync(UserId, id, pinned: true, ct));

    [HttpDelete("{id:int}/pin")]
    public async Task<ActionResult<PostResponse>> Unpin(int id, CancellationToken ct) =>
        Ok(await posts.SetPinnedAsync(UserId, id, pinned: false, ct));

    /// <summary>Counts a play. Once per viewer, however many times they watch it.</summary>
    [HttpPost("{id:int}/view")]
    public async Task<ActionResult<int>> View(int id, CancellationToken ct) =>
        Ok(await posts.ViewAsync(UserId, id, ct));

    /// <summary>Files a saved post into one of your collections, or out of them all when null.</summary>
    [HttpPut("{id:int}/collection")]
    public async Task<IActionResult> File(int id, FilePostRequest request, CancellationToken ct)
    {
        await collections.FileAsync(UserId, id, request.CollectionId, ct);
        return NoContent();
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<PostResponse>> Get(int id, CancellationToken ct) =>
        Ok(await posts.GetAsync(UserId, id, ct));

    /// <summary>Edits your own caption. Hashtags are re-derived from the new text.</summary>
    [HttpPut("{id:int}")]
    public async Task<ActionResult<PostResponse>> UpdateCaption(
        int id, UpdateCaptionRequest request, CancellationToken ct) =>
        Ok(await posts.UpdateCaptionAsync(UserId, id, request, ct));

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id, CancellationToken ct)
    {
        await posts.DeleteAsync(UserId, id, ct);
        return NoContent();
    }

    [HttpPost("{id:int}/like")]
    public async Task<ActionResult<LikeResponse>> Like(int id, CancellationToken ct) =>
        Ok(await posts.LikeAsync(UserId, id, ct));

    [HttpDelete("{id:int}/like")]
    public async Task<ActionResult<LikeResponse>> Unlike(int id, CancellationToken ct) =>
        Ok(await posts.UnlikeAsync(UserId, id, ct));

    /// <summary>Bookmarks a post. Private — the author is not told.</summary>
    [HttpPost("{id:int}/save")]
    public async Task<ActionResult<SaveResponse>> Save(int id, CancellationToken ct) =>
        Ok(await posts.SaveAsync(UserId, id, ct));

    [HttpDelete("{id:int}/save")]
    public async Task<ActionResult<SaveResponse>> Unsave(int id, CancellationToken ct) =>
        Ok(await posts.UnsaveAsync(UserId, id, ct));

    [HttpGet("{id:int}/likes")]
    public async Task<ActionResult<Page<UserSummary>>> Likes(
        int id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 20, 50);
        return Ok(await posts.LikedByAsync(UserId, id, p, size, ct));
    }

    [HttpGet("{id:int}/comments")]
    public async Task<ActionResult<Page<CommentResponse>>> Comments(
        int id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 20, 50);
        return Ok(await posts.CommentsAsync(UserId, id, p, size, ct));
    }

    [HttpPost("{id:int}/comments")]
    public async Task<ActionResult<CommentResponse>> AddComment(
        int id, CreateCommentRequest request, CancellationToken ct) =>
        Ok(await posts.AddCommentAsync(UserId, id, request, ct));

    [HttpPost("comments/{commentId:int}/like")]
    public async Task<ActionResult<LikeResponse>> LikeComment(int commentId, CancellationToken ct) =>
        Ok(await posts.LikeCommentAsync(UserId, commentId, liked: true, ct));

    [HttpDelete("comments/{commentId:int}/like")]
    public async Task<ActionResult<LikeResponse>> UnlikeComment(int commentId, CancellationToken ct) =>
        Ok(await posts.LikeCommentAsync(UserId, commentId, liked: false, ct));

    /// <summary>Removable by whoever wrote it or by the owner of the photo. Replies go with it.</summary>
    [HttpDelete("comments/{commentId:int}")]
    public async Task<IActionResult> DeleteComment(int commentId, CancellationToken ct)
    {
        await posts.DeleteCommentAsync(UserId, commentId, ct);
        return NoContent();
    }
}
