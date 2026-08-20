using InstaGraph.Api.DTOs;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace InstaGraph.Api.Controllers;

[Route("api/feed")]
public class FeedController(IFeedService feed, ICurrentUser currentUser) : ApiControllerBase(currentUser)
{
    /// <summary>Your home feed, ranked.</summary>
    [HttpGet]
    public async Task<ActionResult<Page<PostResponse>>> Home(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 8, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 8, 30);
        return Ok(await feed.HomeAsync(UserId, p, size, ct));
    }

    /// <summary>The ring row: accounts you follow who posted in the last 24 hours.</summary>
    [HttpGet("highlights")]
    public async Task<ActionResult<IReadOnlyList<HighlightResponse>>> Highlights(CancellationToken ct) =>
        Ok(await feed.HighlightsAsync(UserId, ct));

    /// <summary>
    /// Reels — every clip in the app, ranked mostly on what it has drawn rather than on who posted it.
    /// </summary>
    [HttpGet("reels")]
    public async Task<ActionResult<Page<PostResponse>>> Reels(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 6, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 6, 20);
        return Ok(await feed.ReelsAsync(UserId, p, size, ct));
    }

    /// <summary>Explore — photos from accounts you do not follow.</summary>
    [HttpGet("explore")]
    public async Task<ActionResult<Page<PostResponse>>> Explore(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 24, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 24, 48);
        return Ok(await feed.ExploreAsync(UserId, p, size, ct));
    }
}

[Route("api/hashtags")]
public class HashtagsController(IPostService posts, ICurrentUser currentUser) : ApiControllerBase(currentUser)
{
    [HttpGet("trending")]
    public async Task<ActionResult<IReadOnlyList<HashtagResponse>>> Trending(
        [FromQuery] int limit = 10, CancellationToken ct = default) =>
        Ok(await posts.TrendingHashtagsAsync(Math.Clamp(limit, 1, 30), ct));

    [HttpGet("{tag}/posts")]
    public async Task<ActionResult<Page<PostResponse>>> Posts(
        string tag, [FromQuery] int page = 1, [FromQuery] int pageSize = 24, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 24, 48);
        return Ok(await posts.ByHashtagAsync(UserId, tag, p, size, ct));
    }
}

[Route("api/notifications")]
public class NotificationsController(INotificationService notifications, ICurrentUser currentUser)
    : ApiControllerBase(currentUser)
{
    [HttpGet]
    public async Task<ActionResult<Page<NotificationResponse>>> List(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 20, 50);
        return Ok(await notifications.ListAsync(UserId, p, size, ct));
    }

    /// <summary>Drives the red dot on the sidebar.</summary>
    [HttpGet("unread-count")]
    public async Task<ActionResult<int>> UnreadCount(CancellationToken ct) =>
        Ok(await notifications.UnreadCountAsync(UserId, ct));

    [HttpPost("read-all")]
    public async Task<IActionResult> ReadAll(CancellationToken ct)
    {
        await notifications.MarkAllReadAsync(UserId, ct);
        return NoContent();
    }
}
