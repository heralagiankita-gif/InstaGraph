using InstaGraph.Api.DTOs;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace InstaGraph.Api.Controllers;

[Route("api/users")]
public class UsersController(
    IUserService users,
    IPostService posts,
    IGraphInsightsService graph,
    ICollectionService collections,
    ICurrentUser currentUser) : ApiControllerBase(currentUser)
{
    /// <summary>
    /// "Suggested for you" — the blended graph ranking, strongest evidence first. The same list as
    /// <c>/api/graph/suggestions</c>, kept here because this is where the sidebar has always looked.
    /// </summary>
    [HttpGet("suggestions")]
    public async Task<ActionResult<IReadOnlyList<SuggestedUser>>> Suggestions(
        [FromQuery] int limit = 8, CancellationToken ct = default) =>
        Ok(await graph.SuggestionsAsync(UserId, Math.Clamp(limit, 1, 25), null, ct));

    /// <summary>Search accounts and hashtags at once, the way the search panel does.</summary>
    [HttpGet("search")]
    public async Task<ActionResult<SearchResponse>> Search(
        [FromQuery] string q = "", [FromQuery] int limit = 10, CancellationToken ct = default) =>
        Ok(await users.SearchAsync(UserId, q, Math.Clamp(limit, 1, 25), ct));

    /// <summary>Everyone you have blocked.</summary>
    [HttpGet("me/blocked")]
    public async Task<ActionResult<IReadOnlyList<UserSummary>>> Blocked(CancellationToken ct) =>
        Ok(await users.BlockedAsync(UserId, ct));

    /// <summary>Everyone you have muted — the edges you kept and the content you dropped.</summary>
    [HttpGet("me/muted")]
    public async Task<ActionResult<IReadOnlyList<UserSummary>>> Muted(CancellationToken ct) =>
        Ok(await users.MutedAsync(UserId, ct));

    /// <summary>
    /// Blocks an account: deletes the edges in both directions and raises a wall that every later
    /// traversal respects.
    /// </summary>
    [HttpPost("{username}/block")]
    public async Task<ActionResult<RelationshipResponse>> Block(string username, CancellationToken ct) =>
        Ok(await users.BlockAsync(UserId, username, ct));

    /// <summary>Removes the wall. The edges are not restored.</summary>
    [HttpDelete("{username}/block")]
    public async Task<ActionResult<RelationshipResponse>> Unblock(string username, CancellationToken ct) =>
        Ok(await users.UnblockAsync(UserId, username, ct));

    /// <summary>Keeps the follow, drops their posts out of your feed. They are not told.</summary>
    [HttpPost("{username}/mute")]
    public async Task<ActionResult<RelationshipResponse>> Mute(string username, CancellationToken ct) =>
        Ok(await users.MuteAsync(UserId, username, muted: true, ct));

    [HttpDelete("{username}/mute")]
    public async Task<ActionResult<RelationshipResponse>> Unmute(string username, CancellationToken ct) =>
        Ok(await users.MuteAsync(UserId, username, muted: false, ct));

    /// <summary>Follow requests waiting on your private account.</summary>
    [HttpGet("follow-requests")]
    public async Task<ActionResult<IReadOnlyList<UserSummary>>> FollowRequests(CancellationToken ct) =>
        Ok(await users.FollowRequestsAsync(UserId, ct));

    [HttpPost("follow-requests/{username}/accept")]
    public async Task<IActionResult> AcceptRequest(string username, CancellationToken ct)
    {
        await users.RespondToFollowRequestAsync(UserId, username, accept: true, ct);
        return NoContent();
    }

    [HttpPost("follow-requests/{username}/reject")]
    public async Task<IActionResult> RejectRequest(string username, CancellationToken ct)
    {
        await users.RespondToFollowRequestAsync(UserId, username, accept: false, ct);
        return NoContent();
    }

    /// <summary>
    /// Your saved posts. Only ever your own — there is no way to read anybody else's. Pass
    /// <c>collectionId</c> to read one folder; leave it off for everything you have saved.
    /// </summary>
    [HttpGet("me/saved")]
    public async Task<ActionResult<Page<PostResponse>>> Saved(
        [FromQuery] int? collectionId = null,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 12,
        CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 12, 36);
        return Ok(await posts.SavedAsync(UserId, collectionId, p, size, ct));
    }

    /// <summary>The folders inside your saved tab.</summary>
    [HttpGet("me/collections")]
    public async Task<ActionResult<IReadOnlyList<CollectionResponse>>> Collections(CancellationToken ct) =>
        Ok(await collections.ListAsync(UserId, ct));

    [HttpPost("me/collections")]
    public async Task<ActionResult<CollectionResponse>> CreateCollection(
        CreateCollectionRequest request, CancellationToken ct) =>
        Ok(await collections.CreateAsync(UserId, request, ct));

    [HttpPut("me/collections/{id:int}")]
    public async Task<ActionResult<CollectionResponse>> RenameCollection(
        int id, CreateCollectionRequest request, CancellationToken ct) =>
        Ok(await collections.RenameAsync(UserId, id, request, ct));

    /// <summary>Removes the folder. What was in it goes back to being saved and unsorted.</summary>
    [HttpDelete("me/collections/{id:int}")]
    public async Task<IActionResult> DeleteCollection(int id, CancellationToken ct)
    {
        await collections.DeleteAsync(UserId, id, ct);
        return NoContent();
    }

    /// <summary>
    /// Your archive: posts you have put away. Only ever your own, and reached on purpose rather than
    /// scrolled past.
    /// </summary>
    [HttpGet("me/archive")]
    public async Task<ActionResult<Page<PostResponse>>> Archive(
        [FromQuery] int page = 1, [FromQuery] int pageSize = 12, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 12, 36);
        return Ok(await posts.ArchivedAsync(UserId, p, size, ct));
    }

    /// <summary>Photos this account has been named in — the Tagged tab.</summary>
    [HttpGet("{username}/tagged")]
    public async Task<ActionResult<Page<PostResponse>>> Tagged(
        string username, [FromQuery] int page = 1, [FromQuery] int pageSize = 12, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 12, 36);
        return Ok(await posts.TaggedAsync(UserId, username, p, size, ct));
    }

    /// <summary>Edits your own name, bio and privacy.</summary>
    [HttpPut("me")]
    public async Task<ActionResult<ProfileResponse>> UpdateMe(UpdateProfileRequest request, CancellationToken ct) =>
        Ok(await users.UpdateProfileAsync(UserId, request, ct));

    /// <summary>Replaces your profile photo. Multipart, field name <c>file</c>.</summary>
    [HttpPost("me/avatar")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<ActionResult<UserSummary>> UpdateAvatar(IFormFile file, CancellationToken ct) =>
        Ok(await users.UpdateAvatarAsync(UserId, file, ct));

    /// <summary>A profile header, including whether you two are connected and through whom.</summary>
    [HttpGet("{username}")]
    public async Task<ActionResult<ProfileResponse>> Profile(string username, CancellationToken ct) =>
        Ok(await users.GetProfileAsync(UserId, username, ct));

    /// <summary>The profile grid.</summary>
    [HttpGet("{username}/posts")]
    public async Task<ActionResult<Page<PostResponse>>> Posts(
        string username, [FromQuery] int page = 1, [FromQuery] int pageSize = 12, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 12, 36);
        return Ok(await posts.ByUserAsync(UserId, username, p, size, ct));
    }

    /// <summary>Their followers, each row carrying how you stand with that account.</summary>
    [HttpGet("{username}/followers")]
    public async Task<ActionResult<Page<UserRelation>>> Followers(
        string username, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 20, 50);
        return Ok(await users.FollowersAsync(UserId, username, p, size, ct));
    }

    [HttpGet("{username}/following")]
    public async Task<ActionResult<Page<UserRelation>>> Following(
        string username, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 20, 50);
        return Ok(await users.FollowingAsync(UserId, username, p, size, ct));
    }

    /// <summary>
    /// Accounts they follow who follow them back — the intersection of their out-edges and in-edges.
    /// </summary>
    [HttpGet("{username}/friends")]
    public async Task<ActionResult<Page<UserRelation>>> Friends(
        string username, [FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 20, 50);
        return Ok(await users.FriendsAsync(UserId, username, p, size, ct));
    }

    /// <summary>Adds the edge. Against a private account this leaves a request instead.</summary>
    [HttpPost("{username}/follow")]
    public async Task<ActionResult<FollowResponse>> Follow(string username, CancellationToken ct) =>
        Ok(await users.FollowAsync(UserId, username, ct));

    /// <summary>Deletes the edge.</summary>
    [HttpDelete("{username}/follow")]
    public async Task<ActionResult<FollowResponse>> Unfollow(string username, CancellationToken ct) =>
        Ok(await users.UnfollowAsync(UserId, username, ct));

    /// <summary>Removes somebody from your followers — deleting their edge to you.</summary>
    [HttpDelete("{username}/follower")]
    public async Task<ActionResult<FollowResponse>> RemoveFollower(string username, CancellationToken ct) =>
        Ok(await users.RemoveFollowerAsync(UserId, username, ct));
}
