using System.Text.RegularExpressions;
using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using InstaGraph.Api.Realtime;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace InstaGraph.Api.Services;

public interface IPostService
{
    Task<PostResponse> CreateAsync(int userId, CreatePostRequest request, CancellationToken ct = default);
    Task<PostResponse> GetAsync(int viewerId, int postId, CancellationToken ct = default);
    Task<PostResponse> UpdateCaptionAsync(int userId, int postId, UpdateCaptionRequest request, CancellationToken ct = default);
    Task DeleteAsync(int userId, int postId, CancellationToken ct = default);

    Task<PostResponse> SetTagsAsync(int userId, int postId, SetPostTagsRequest request, CancellationToken ct = default);
    Task<Page<PostResponse>> TaggedAsync(int viewerId, string username, int page, int pageSize, CancellationToken ct = default);

    Task<PostResponse> SetArchivedAsync(int userId, int postId, bool archived, CancellationToken ct = default);
    Task<Page<PostResponse>> ArchivedAsync(int userId, int page, int pageSize, CancellationToken ct = default);
    Task<PostResponse> SetPinnedAsync(int userId, int postId, bool pinned, CancellationToken ct = default);

    Task<int> ViewAsync(int viewerId, int postId, CancellationToken ct = default);

    Task<LikeResponse> LikeAsync(int userId, int postId, CancellationToken ct = default);
    Task<LikeResponse> UnlikeAsync(int userId, int postId, CancellationToken ct = default);
    Task<Page<UserSummary>> LikedByAsync(int viewerId, int postId, int page, int pageSize, CancellationToken ct = default);

    Task<SaveResponse> SaveAsync(int userId, int postId, CancellationToken ct = default);
    Task<SaveResponse> UnsaveAsync(int userId, int postId, CancellationToken ct = default);
    Task<Page<PostResponse>> SavedAsync(int userId, int? collectionId, int page, int pageSize, CancellationToken ct = default);

    Task<Page<CommentResponse>> CommentsAsync(int viewerId, int postId, int page, int pageSize, CancellationToken ct = default);
    Task<CommentResponse> AddCommentAsync(int userId, int postId, CreateCommentRequest request, CancellationToken ct = default);
    Task DeleteCommentAsync(int userId, int commentId, CancellationToken ct = default);
    Task<LikeResponse> LikeCommentAsync(int userId, int commentId, bool liked, CancellationToken ct = default);

    Task<Page<PostResponse>> ByUserAsync(int viewerId, string username, int page, int pageSize, CancellationToken ct = default);
    Task<Page<PostResponse>> ByHashtagAsync(int viewerId, string tag, int page, int pageSize, CancellationToken ct = default);
    Task<IReadOnlyList<HashtagResponse>> TrendingHashtagsAsync(int limit, CancellationToken ct = default);
}

public partial class PostService(
    AppDbContext db,
    IImageStorage storage,
    IGraphSnapshotProvider graphProvider,
    INotificationService notifications,
    IRealtimeNotifier realtime,
    IOptions<UploadSettings> uploadSettings) : IPostService
{
    private readonly UploadSettings _uploads = uploadSettings.Value;

    /// <summary>Reads one of the parallel form arrays, falling back when the client sent a short one.</summary>
    private static double At(IReadOnlyList<double>? values, int index, double fallback) =>
        values is not null && index < values.Count ? values[index] : fallback;

    private static int At(IReadOnlyList<int>? values, int index, int fallback) =>
        values is not null && index < values.Count ? values[index] : fallback;

    /// <summary>How many posts may sit above the rest of a grid. Instagram's own number.</summary>
    private const int MaxPinnedPosts = 3;

    [GeneratedRegex(@"#([\p{L}0-9_]{1,60})", RegexOptions.Compiled)]
    private static partial Regex HashtagPattern();

    [GeneratedRegex(@"@([a-z0-9._]{3,30})", RegexOptions.Compiled | RegexOptions.IgnoreCase)]
    private static partial Regex MentionPattern();

    /// <summary>
    /// Turns every @handle in a piece of text into a notification for that account.
    /// <para>
    /// Only real, active accounts are notified, and never one that has a block either way — being
    /// mentioned by somebody you blocked would route straight around the wall.
    /// </para>
    /// </summary>
    private async Task NotifyMentionsAsync(
        string text, int actorId, int? postId, NotificationKind kind, CancellationToken ct)
    {
        var handles = MentionPattern()
            .Matches(text)
            .Select(m => m.Groups[1].Value.ToLowerInvariant())
            .Distinct()
            .Take(10)
            .ToList();

        if (handles.Count == 0)
        {
            return;
        }

        var graph = await graphProvider.GetAsync(ct);
        var wall = graph.WalledFor(actorId);

        var mentioned = await db.Users
            .Where(u => handles.Contains(u.Username) && u.IsActive && u.Id != actorId)
            .Select(u => u.Id)
            .ToListAsync(ct);

        foreach (var userId in mentioned.Where(id => !wall.Contains(id)))
        {
            notifications.Add(userId, actorId, kind, postId);
        }
    }

    /// <summary>
    /// The author's own rules about their comments: who may leave one, and which words they never want to
    /// read.
    /// <para>
    /// Both refusals use the same wording on purpose. Telling somebody they tripped a hidden word tells
    /// them which word to avoid, which is precisely the person the list exists to stop.
    /// </para>
    /// </summary>
    private async Task GuardCommentRulesAsync(int userId, User author, string text, CancellationToken ct)
    {
        if (author.Id == userId)
        {
            return;
        }

        var graph = await graphProvider.GetAsync(ct);

        var allowed = author.CommentsFrom switch
        {
            Audience.Everyone => true,
            Audience.Following => graph.IsFollowing(author.Id, userId),
            Audience.Friends => graph.IsMutual(author.Id, userId),
            _ => false
        };

        if (!allowed)
        {
            throw AppException.Forbidden("Comments are limited on this post.");
        }

        if (!string.IsNullOrWhiteSpace(author.HiddenWords) && !string.IsNullOrWhiteSpace(text))
        {
            var words = author.HiddenWords
                .Split([',', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            if (words.Any(word => text.Contains(word, StringComparison.OrdinalIgnoreCase)))
            {
                throw AppException.Forbidden("Comments are limited on this post.");
            }
        }
    }

    // ------------------------------------------------------------------- create

    public async Task<PostResponse> CreateAsync(int userId, CreatePostRequest request, CancellationToken ct = default)
    {
        var author = await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct) ?? throw AppException.Unauthorized();

        // Either field will do: "media" for a carousel, "image" for the single photo this endpoint has
        // always taken. Whichever arrived, everything below works on a list, so there is one path and not
        // two.
        var files = request.Media is { Count: > 0 }
            ? request.Media
            : request.Image is not null ? [request.Image] : new List<IFormFile>();

        if (files.Count == 0)
        {
            throw AppException.BadRequest("Choose a photo or a video to post.");
        }

        if (files.Count > _uploads.MaxMediaPerPost)
        {
            throw AppException.BadRequest(
                $"A post can hold up to {_uploads.MaxMediaPerPost} photos or videos.");
        }

        // The files land on disk before any row is written: if one fails there is no post pointing at
        // nothing. If a later one fails, the ones already written are swept up again rather than left
        // behind as garbage nobody has a reference to.
        var media = new List<PostMedia>();

        try
        {
            for (var i = 0; i < files.Count; i++)
            {
                var (url, kind) = await storage.SaveMediaAsync(files[i], ct);

                media.Add(new PostMedia
                {
                    Kind = kind,
                    Url = url,
                    Position = i,
                    AspectRatio = At(request.AspectRatios, i, 1.0),
                    DurationMs = kind == MediaKind.Video ? At(request.Durations, i, 0) : 0
                });
            }

            // Posters only mean anything on the clips, so each one names the item it belongs to rather
            // than relying on its own position lining up.
            for (var i = 0; i < (request.Posters?.Count ?? 0); i++)
            {
                var target = At(request.PosterFor, i, -1);

                if (target < 0 || target >= media.Count || media[target].Kind != MediaKind.Video)
                {
                    continue;
                }

                media[target].PosterUrl = await storage.SaveAsync(request.Posters![i], ct);
            }
        }
        catch
        {
            foreach (var item in media)
            {
                storage.Delete(item.Url);
                storage.Delete(item.PosterUrl);
            }

            throw;
        }

        var cover = media[0];

        var post = new Post
        {
            AuthorId = userId,
            Caption = request.Caption.Trim(),
            Location = string.IsNullOrWhiteSpace(request.Location) ? null : request.Location.Trim(),

            // The cover has to be something an image tag can draw, so a post that opens on a clip is
            // covered by that clip's poster frame and never by the MP4 itself.
            ImageUrl = cover.Kind == MediaKind.Video ? cover.PosterUrl ?? cover.Url : cover.Url,

            // Nobody chooses to make a reel. You post a video and it is one — which is the rule the real
            // app follows, and the reason there is no switch for this on the composer.
            IsReel = media.Count == 1 && media[0].Kind == MediaKind.Video,

            CommentsDisabled = request.CommentsDisabled,
            HideCounts = request.HideCounts,
            Media = media
        };

        db.Posts.Add(post);
        author.PostCount++;

        await db.SaveChangesAsync(ct);

        await AttachHashtagsAsync(post, ct);
        await NotifyMentionsAsync(post.Caption, userId, post.Id, NotificationKind.Mention, ct);
        await db.SaveChangesAsync(ct);
        await notifications.PushPendingAsync(ct);

        // Everyone with an edge pointing at this account is told a photo exists. Deliberately just that
        // — not the photo. The feed is ranked, so where this post lands is a question only the feed can
        // answer; pushing the post itself would mean guessing at its position and getting it wrong.
        var graph = await graphProvider.GetAsync(ct);
        var wall = graph.WalledFor(userId);

        await realtime.ToUsersAsync(
            graph.Followers(userId).Where(id => !wall.Contains(id)),
            RealtimeEvents.Post,
            new { userId, username = author.Username },
            ct);

        return await GetAsync(userId, post.Id, ct);
    }

    /// <summary>Edits the caption of your own post, re-deriving the hashtags from the new text.</summary>
    public async Task<PostResponse> UpdateCaptionAsync(
        int userId, int postId, UpdateCaptionRequest request, CancellationToken ct = default)
    {
        var post = await db.Posts
            .Include(p => p.Hashtags).ThenInclude(h => h.Hashtag)
            .FirstOrDefaultAsync(p => p.Id == postId, ct)
            ?? throw AppException.NotFound("That post no longer exists.");

        if (post.AuthorId != userId)
        {
            throw AppException.Forbidden("You can only edit your own posts.");
        }

        // The old tags are released before the new ones are counted, otherwise a tag removed from the
        // caption would keep its count forever.
        foreach (var link in post.Hashtags)
        {
            link.Hashtag.PostCount = Math.Max(0, link.Hashtag.PostCount - 1);
        }

        db.PostHashtags.RemoveRange(post.Hashtags);

        post.Caption = request.Caption.Trim();
        post.Location = string.IsNullOrWhiteSpace(request.Location) ? null : request.Location.Trim();

        // Null means "leave it as it is", so the editor can send a caption without also having to
        // restate every switch on the post.
        post.CommentsDisabled = request.CommentsDisabled ?? post.CommentsDisabled;
        post.HideCounts = request.HideCounts ?? post.HideCounts;

        await db.SaveChangesAsync(ct);

        await AttachHashtagsAsync(post, ct);
        await db.SaveChangesAsync(ct);

        return await GetAsync(userId, postId, ct);
    }

    /// <summary>Pulls #tags out of the caption and links them, reusing tag rows that already exist.</summary>
    private async Task AttachHashtagsAsync(Post post, CancellationToken ct)
    {
        var tags = HashtagPattern()
            .Matches(post.Caption)
            .Select(m => m.Groups[1].Value.ToLowerInvariant())
            .Distinct()
            .Take(10)
            .ToList();

        if (tags.Count == 0)
        {
            return;
        }

        var existing = await db.Hashtags.Where(h => tags.Contains(h.Tag)).ToListAsync(ct);

        foreach (var tag in tags)
        {
            var hashtag = existing.FirstOrDefault(h => h.Tag == tag);

            if (hashtag is null)
            {
                hashtag = new Hashtag { Tag = tag };
                db.Hashtags.Add(hashtag);
            }

            hashtag.PostCount++;
            db.PostHashtags.Add(new PostHashtag { Post = post, Hashtag = hashtag });
        }
    }

    // --------------------------------------------------------------------- read

    public async Task<PostResponse> GetAsync(int viewerId, int postId, CancellationToken ct = default)
    {
        var post = await LoadAsync(postId, ct);
        await GuardVisibilityAsync(viewerId, post.Author, ct);

        var isLiked = await db.PostLikes.AnyAsync(l => l.PostId == postId && l.UserId == viewerId, ct);
        var isSaved = await db.SavedPosts.AnyAsync(s => s.PostId == postId && s.UserId == viewerId, ct);

        var preview = await db.Comments
            .AsNoTracking()
            .Include(c => c.Author)
            .Where(c => c.PostId == postId)
            .OrderByDescending(c => c.CreatedAt)
            .Take(2)
            .ToListAsync(ct);

        preview.Reverse();

        return post.ToResponse(
            viewerId,
            isLiked,
            preview.Select(c => c.ToResponse(viewerId)).ToList(),
            isSaved: isSaved);
    }

    public async Task<Page<PostResponse>> ByUserAsync(
        int viewerId, string username, int page, int pageSize, CancellationToken ct = default)
    {
        username = username.Trim().ToLowerInvariant();

        var author = await db.Users.FirstOrDefaultAsync(u => u.Username == username && u.IsActive, ct)
                     ?? throw AppException.NotFound("That account does not exist.");

        await GuardVisibilityAsync(viewerId, author, ct);

        // Archived posts are off the grid for everybody, their author included: the archive is its own
        // screen, reached on purpose, and not a thing you scroll past by accident.
        var query = db.Posts
            .AsNoTracking()
            .Where(p => p.AuthorId == author.Id && !p.IsArchived)
            .OrderByDescending(p => p.IsPinned)
            .ThenByDescending(p => p.CreatedAt);

        return await PageAsync(query, viewerId, page, pageSize, ct);
    }

    public async Task<Page<PostResponse>> ByHashtagAsync(
        int viewerId, string tag, int page, int pageSize, CancellationToken ct = default)
    {
        tag = tag.Trim().TrimStart('#').ToLowerInvariant();

        var walled = (await graphProvider.GetAsync(ct)).WalledFor(viewerId).ToList();

        var query = db.Posts
            .AsNoTracking()
            // Private accounts never appear under a hashtag: the tag page is a public surface. Neither
            // does anybody on either side of a block.
            .Where(p => !p.Author.IsPrivate && p.Author.IsActive && !walled.Contains(p.AuthorId))
            .Where(p => !p.IsArchived)
            .Where(p => p.Hashtags.Any(h => h.Hashtag.Tag == tag))
            .OrderByDescending(p => p.LikeCount + p.CommentCount)
            .ThenByDescending(p => p.CreatedAt);

        return await PageAsync(query, viewerId, page, pageSize, ct);
    }

    public async Task<IReadOnlyList<HashtagResponse>> TrendingHashtagsAsync(int limit, CancellationToken ct = default) =>
        await db.Hashtags
            .AsNoTracking()
            .Where(h => h.PostCount > 0)
            .OrderByDescending(h => h.PostCount)
            .Take(limit)
            .Select(h => new HashtagResponse { Tag = h.Tag, PostCount = h.PostCount })
            .ToListAsync(ct);

    // ------------------------------------------------------------------- delete

    public async Task DeleteAsync(int userId, int postId, CancellationToken ct = default)
    {
        var post = await db.Posts
            .Include(p => p.Hashtags).ThenInclude(h => h.Hashtag)
            .Include(p => p.Media)
            .FirstOrDefaultAsync(p => p.Id == postId, ct)
            ?? throw AppException.NotFound("That post no longer exists.");

        if (post.AuthorId != userId)
        {
            throw AppException.Forbidden("You can only delete your own posts.");
        }

        foreach (var link in post.Hashtags)
        {
            link.Hashtag.PostCount = Math.Max(0, link.Hashtag.PostCount - 1);
        }

        var author = await db.Users.FirstAsync(u => u.Id == userId, ct);
        author.PostCount = Math.Max(0, author.PostCount - 1);

        // Anybody who shared this post into a chat still has a bubble pointing at it, and that foreign
        // key is Restrict on purpose — so that deleting a post has to decide what happens to those
        // rather than silently destroying somebody else's message.
        //
        // The decision is to keep the message and drop the reference: the thread keeps its shape, and the
        // card degrades to "That post is no longer available", which the client already draws. Without
        // this the delete fails outright with a foreign key violation the moment a post has ever been
        // shared — which is exactly what it did until a test tried it.
        var shares = await db.Messages
            .Where(m => m.SharedPostId == postId)
            .ToListAsync(ct);

        foreach (var share in shares)
        {
            share.SharedPostId = null;
        }

        // Collected before the row goes, because after the delete there is nothing left to read them off.
        var files = post.Media
            .SelectMany(m => new[] { m.Url, m.PosterUrl })
            .Append(post.ImageUrl)
            .Where(url => !string.IsNullOrWhiteSpace(url))
            .Distinct()
            .ToList();

        // Likes, comments, media, tags, views and notifications are all cascade-deleted by their keys.
        db.Posts.Remove(post);
        await db.SaveChangesAsync(ct);

        foreach (var file in files)
        {
            storage.Delete(file);
        }
    }

    // ------------------------------------------------------------- photo tags

    /// <summary>
    /// Replaces the whole set of labels on a photo.
    /// <para>
    /// A set rather than an add and a remove: the editor sends the picture it is looking at, and the two
    /// of them then agree. Doing it incrementally means the client and the server can disagree about what
    /// is on a photo, and the only way to find out is to reload it.
    /// </para>
    /// </summary>
    public async Task<PostResponse> SetTagsAsync(
        int userId, int postId, SetPostTagsRequest request, CancellationToken ct = default)
    {
        var post = await db.Posts
            .Include(p => p.Tags)
            .Include(p => p.Media)
            .FirstOrDefaultAsync(p => p.Id == postId, ct)
            ?? throw AppException.NotFound("That post no longer exists.");

        if (post.AuthorId != userId)
        {
            throw AppException.Forbidden("You can only tag people in your own posts.");
        }

        var wanted = request.Tags
            .Where(t => t.UserId != userId)
            .GroupBy(t => t.UserId)
            .Select(g => g.First())
            .Take(20)
            .ToList();

        var ids = wanted.Select(t => t.UserId).ToList();

        // Only real accounts, and never one on either side of a block — tagging somebody who blocked you
        // would put your photo on their profile and route straight around the wall.
        var graph = await graphProvider.GetAsync(ct);
        var wall = graph.WalledFor(userId);

        var taggable = (await db.Users
            .Where(u => ids.Contains(u.Id) && u.IsActive)
            .Select(u => u.Id)
            .ToListAsync(ct))
            .Where(id => !wall.Contains(id))
            .ToHashSet();

        var itemCount = Math.Max(1, post.Media.Count);
        var existing = post.Tags.ToList();

        db.PostTags.RemoveRange(existing);

        foreach (var tag in wanted.Where(t => taggable.Contains(t.UserId)))
        {
            db.PostTags.Add(new PostTag
            {
                PostId = postId,
                UserId = tag.UserId,
                MediaPosition = Math.Clamp(tag.MediaPosition, 0, itemCount - 1),
                X = Math.Clamp(tag.X, 0, 1),
                Y = Math.Clamp(tag.Y, 0, 1)
            });

            // Being tagged is told the same way being mentioned is, and only when it is new — re-saving
            // the same set of labels should not notify anybody a second time.
            if (existing.All(e => e.UserId != tag.UserId))
            {
                notifications.Add(tag.UserId, userId, NotificationKind.Tag, postId);
            }
        }

        await db.SaveChangesAsync(ct);
        await notifications.PushPendingAsync(ct);

        return await GetAsync(userId, postId, ct);
    }

    /// <summary>Photos somebody has been named in — the Tagged tab on a profile.</summary>
    public async Task<Page<PostResponse>> TaggedAsync(
        int viewerId, string username, int page, int pageSize, CancellationToken ct = default)
    {
        username = username.Trim().ToLowerInvariant();

        var person = await db.Users.FirstOrDefaultAsync(u => u.Username == username && u.IsActive, ct)
                     ?? throw AppException.NotFound("That account does not exist.");

        await GuardVisibilityAsync(viewerId, person, ct);

        var walled = (await graphProvider.GetAsync(ct)).WalledFor(viewerId).ToList();

        // The tab lists other people's photos, so each one has to clear its own author's privacy —
        // being tagged in a private account's post does not make that post public.
        var following = (await db.Follows
            .Where(f => f.FollowerId == viewerId && !f.IsPending)
            .Select(f => f.FolloweeId)
            .ToListAsync(ct));

        var query = db.Posts
            .AsNoTracking()
            .Where(p => !p.IsArchived && p.Tags.Any(t => t.UserId == person.Id))
            .Where(p => !walled.Contains(p.AuthorId))
            .Where(p => !p.Author.IsPrivate || p.AuthorId == viewerId || following.Contains(p.AuthorId))
            .OrderByDescending(p => p.CreatedAt);

        return await PageAsync(query, viewerId, page, pageSize, ct);
    }

    // --------------------------------------------------------- archive and pin

    /// <summary>
    /// Moves a post off the grid and out of every feed without destroying it.
    /// <para>
    /// The softer thing a delete is not. It is also why the delete can stay permanent: there is somewhere
    /// to put a post you are not sure about, so the button that removes one for good does not have to
    /// pretend to be reversible.
    /// </para>
    /// </summary>
    public async Task<PostResponse> SetArchivedAsync(
        int userId, int postId, bool archived, CancellationToken ct = default)
    {
        var post = await db.Posts.FirstOrDefaultAsync(p => p.Id == postId, ct)
                   ?? throw AppException.NotFound("That post no longer exists.");

        if (post.AuthorId != userId)
        {
            throw AppException.Forbidden("You can only archive your own posts.");
        }

        if (post.IsArchived != archived)
        {
            post.IsArchived = archived;

            // Archiving takes it off the profile too, so the count on the header has to move with it.
            var author = await db.Users.FirstAsync(u => u.Id == userId, ct);
            author.PostCount = Math.Max(0, author.PostCount + (archived ? -1 : 1));

            // An archived post cannot be pinned to a grid it is no longer on.
            if (archived)
            {
                post.IsPinned = false;
            }

            await db.SaveChangesAsync(ct);
        }

        return await GetAsync(userId, postId, ct);
    }

    public async Task<Page<PostResponse>> ArchivedAsync(
        int userId, int page, int pageSize, CancellationToken ct = default)
    {
        var query = db.Posts
            .AsNoTracking()
            .Where(p => p.AuthorId == userId && p.IsArchived)
            .OrderByDescending(p => p.CreatedAt);

        return await PageAsync(query, userId, page, pageSize, ct);
    }

    /// <summary>Pins a post to the top of your own grid. Three at most, the way the real one works.</summary>
    public async Task<PostResponse> SetPinnedAsync(
        int userId, int postId, bool pinned, CancellationToken ct = default)
    {
        var post = await db.Posts.FirstOrDefaultAsync(p => p.Id == postId, ct)
                   ?? throw AppException.NotFound("That post no longer exists.");

        if (post.AuthorId != userId)
        {
            throw AppException.Forbidden("You can only pin your own posts.");
        }

        if (pinned && post.IsArchived)
        {
            throw AppException.BadRequest("Bring that post back from the archive before pinning it.");
        }

        if (pinned && !post.IsPinned)
        {
            // The limit is enforced here rather than in the composer: a rule only the client knows about
            // is not a rule, it is a suggestion.
            var alreadyPinned = await db.Posts.CountAsync(p => p.AuthorId == userId && p.IsPinned, ct);

            if (alreadyPinned >= MaxPinnedPosts)
            {
                throw AppException.BadRequest($"You can pin up to {MaxPinnedPosts} posts. Unpin one first.");
            }
        }

        post.IsPinned = pinned;
        await db.SaveChangesAsync(ct);

        return await GetAsync(userId, postId, ct);
    }

    // ---------------------------------------------------------------- views

    /// <summary>
    /// Counts a play. Once per viewer, whatever they do afterwards.
    /// </summary>
    public async Task<int> ViewAsync(int viewerId, int postId, CancellationToken ct = default)
    {
        var post = await db.Posts.Include(p => p.Author).FirstOrDefaultAsync(p => p.Id == postId, ct)
                   ?? throw AppException.NotFound("That post no longer exists.");

        await GuardVisibilityAsync(viewerId, post.Author, ct);

        // Watching your own reel is not a view, for the same reason your own profile visit is not one.
        if (post.AuthorId == viewerId)
        {
            return post.ViewCount;
        }

        if (await db.PostViews.AnyAsync(v => v.PostId == postId && v.ViewerId == viewerId, ct))
        {
            return post.ViewCount;
        }

        db.PostViews.Add(new PostView { PostId = postId, ViewerId = viewerId });
        post.ViewCount++;

        await db.SaveChangesAsync(ct);

        return post.ViewCount;
    }

    // --------------------------------------------------------------------- like

    public async Task<LikeResponse> LikeAsync(int userId, int postId, CancellationToken ct = default)
    {
        var post = await db.Posts.Include(p => p.Author).FirstOrDefaultAsync(p => p.Id == postId, ct)
                   ?? throw AppException.NotFound("That post no longer exists.");

        await GuardVisibilityAsync(userId, post.Author, ct);

        if (await db.PostLikes.AnyAsync(l => l.PostId == postId && l.UserId == userId, ct))
        {
            throw AppException.Conflict("You have already liked this post.");
        }

        db.PostLikes.Add(new PostLike { PostId = postId, UserId = userId });
        post.LikeCount++;

        notifications.Add(post.AuthorId, userId, NotificationKind.Like, postId);
        await StrengthenEdgeAsync(userId, post.AuthorId, ct);

        await db.SaveChangesAsync(ct);
        await notifications.PushPendingAsync(ct);

        return new LikeResponse { IsLiked = true, LikeCount = post.LikeCount };
    }

    public async Task<LikeResponse> UnlikeAsync(int userId, int postId, CancellationToken ct = default)
    {
        var post = await db.Posts.FirstOrDefaultAsync(p => p.Id == postId, ct)
                   ?? throw AppException.NotFound("That post no longer exists.");

        var like = await db.PostLikes.FirstOrDefaultAsync(l => l.PostId == postId && l.UserId == userId, ct)
                   ?? throw AppException.NotFound("You have not liked this post.");

        db.PostLikes.Remove(like);
        post.LikeCount = Math.Max(0, post.LikeCount - 1);

        await notifications.RemoveAsync(post.AuthorId, userId, NotificationKind.Like, postId, ct);
        await db.SaveChangesAsync(ct);

        return new LikeResponse { IsLiked = false, LikeCount = post.LikeCount };
    }

    public async Task<Page<UserSummary>> LikedByAsync(
        int viewerId, int postId, int page, int pageSize, CancellationToken ct = default)
    {
        var post = await LoadAsync(postId, ct);
        await GuardVisibilityAsync(viewerId, post.Author, ct);

        var walled = (await graphProvider.GetAsync(ct)).WalledFor(viewerId).ToList();

        var rows = await db.PostLikes
            .AsNoTracking()
            .Where(l => l.PostId == postId && !walled.Contains(l.UserId))
            .OrderByDescending(l => l.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .Select(l => new UserSummary
            {
                Id = l.User.Id,
                Username = l.User.Username,
                FullName = l.User.FullName,
                AvatarUrl = l.User.AvatarUrl,
                IsPrivate = l.User.IsPrivate,
                IsVerified = l.User.IsVerified
            })
            .ToListAsync(ct);

        return new Page<UserSummary>
        {
            Items = rows.Take(pageSize).ToList(),
            PageNumber = page,
            PageSize = pageSize,
            HasMore = rows.Count > pageSize
        };
    }

    // --------------------------------------------------------------------- save

    public async Task<SaveResponse> SaveAsync(int userId, int postId, CancellationToken ct = default)
    {
        var post = await db.Posts.Include(p => p.Author).FirstOrDefaultAsync(p => p.Id == postId, ct)
                   ?? throw AppException.NotFound("That post no longer exists.");

        await GuardVisibilityAsync(userId, post.Author, ct);

        if (await db.SavedPosts.AnyAsync(s => s.PostId == postId && s.UserId == userId, ct))
        {
            // Saving twice is the same state as saving once, so this is not worth an error.
            return new SaveResponse { IsSaved = true };
        }

        db.SavedPosts.Add(new SavedPost { PostId = postId, UserId = userId });
        await db.SaveChangesAsync(ct);

        return new SaveResponse { IsSaved = true };
    }

    public async Task<SaveResponse> UnsaveAsync(int userId, int postId, CancellationToken ct = default)
    {
        var saved = await db.SavedPosts.FirstOrDefaultAsync(s => s.PostId == postId && s.UserId == userId, ct);

        if (saved is not null)
        {
            db.SavedPosts.Remove(saved);
            await db.SaveChangesAsync(ct);
        }

        return new SaveResponse { IsSaved = false };
    }

    public async Task<Page<PostResponse>> SavedAsync(
        int userId, int? collectionId, int page, int pageSize, CancellationToken ct = default)
    {
        // Ids first, in the order they were saved, then the posts themselves. Two small queries rather
        // than one that tries to page and eager-load through a join table.
        var savedIds = await db.SavedPosts
            .AsNoTracking()
            .Where(s => s.UserId == userId)
            .Where(s => collectionId == null || s.CollectionId == collectionId)
            .OrderByDescending(s => s.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .Select(s => s.PostId)
            .ToListAsync(ct);

        var hasMore = savedIds.Count > pageSize;
        var window = savedIds.Take(pageSize).ToList();

        if (window.Count == 0)
        {
            return new Page<PostResponse> { Items = [], PageNumber = page, PageSize = pageSize, HasMore = false };
        }

        var posts = await db.Posts
            .AsNoTracking()
            .Include(p => p.Author)
            .Include(p => p.Hashtags).ThenInclude(h => h.Hashtag)
            .Include(p => p.Media)
            .Include(p => p.Tags).ThenInclude(t => t.User)
            .Where(p => window.Contains(p.Id))
            .ToListAsync(ct);

        var liked = (await db.PostLikes
            .Where(l => l.UserId == userId && window.Contains(l.PostId))
            .Select(l => l.PostId)
            .ToListAsync(ct)).ToHashSet();

        // SQL returns them in whatever order it likes, so the saved order is restored here.
        var byId = posts.ToDictionary(p => p.Id);

        var items = window
            .Where(byId.ContainsKey)
            .Select(id => byId[id].ToResponse(userId, liked.Contains(id), isSaved: true))
            .ToList();

        return new Page<PostResponse>
        {
            Items = items,
            PageNumber = page,
            PageSize = pageSize,
            HasMore = hasMore
        };
    }

    // ----------------------------------------------------------------- comments

    /// <summary>
    /// The thread. Top-level comments are paged; each one carries its replies with it, because a reply
    /// makes no sense away from what it answers.
    /// </summary>
    public async Task<Page<CommentResponse>> CommentsAsync(
        int viewerId, int postId, int page, int pageSize, CancellationToken ct = default)
    {
        var post = await LoadAsync(postId, ct);
        await GuardVisibilityAsync(viewerId, post.Author, ct);

        var roots = await db.Comments
            .AsNoTracking()
            .Include(c => c.Author)
            .Where(c => c.PostId == postId && c.ParentId == null)
            .OrderBy(c => c.CreatedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToListAsync(ct);

        var hasMore = roots.Count > pageSize;
        var window = roots.Take(pageSize).ToList();
        var rootIds = window.Select(c => c.Id).ToList();

        // Replies for the whole page in one query rather than one per comment.
        var replies = await db.Comments
            .AsNoTracking()
            .Include(c => c.Author)
            .Where(c => c.ParentId != null && rootIds.Contains(c.ParentId!.Value))
            .OrderBy(c => c.CreatedAt)
            .ToListAsync(ct);

        var allIds = rootIds.Concat(replies.Select(r => r.Id)).ToList();

        var liked = (await db.CommentLikes
            .Where(l => l.UserId == viewerId && allIds.Contains(l.CommentId))
            .Select(l => l.CommentId)
            .ToListAsync(ct)).ToHashSet();

        var byParent = replies.GroupBy(r => r.ParentId!.Value).ToDictionary(g => g.Key, g => g.ToList());

        var items = window
            .Select(root => root.ToResponse(
                viewerId,
                liked.Contains(root.Id),
                byParent.TryGetValue(root.Id, out var kids)
                    ? kids.Select(k => k.ToResponse(viewerId, liked.Contains(k.Id))).ToList()
                    : []))
            .ToList();

        return new Page<CommentResponse>
        {
            Items = items,
            PageNumber = page,
            PageSize = pageSize,
            HasMore = hasMore
        };
    }

    public async Task<CommentResponse> AddCommentAsync(
        int userId, int postId, CreateCommentRequest request, CancellationToken ct = default)
    {
        var post = await db.Posts.Include(p => p.Author).FirstOrDefaultAsync(p => p.Id == postId, ct)
                   ?? throw AppException.NotFound("That post no longer exists.");

        await GuardVisibilityAsync(userId, post.Author, ct);

        // The author closed this one photo. Checked before the account-wide audience, because it is the
        // narrower rule and refusing on it gives the more accurate reason.
        if (post.CommentsDisabled && post.AuthorId != userId)
        {
            throw AppException.Forbidden("Comments are turned off for this post.");
        }

        await GuardCommentRulesAsync(userId, post.Author, request.Text, ct);

        Comment? parent = null;

        if (request.ParentId is int parentId)
        {
            parent = await db.Comments.FirstOrDefaultAsync(c => c.Id == parentId && c.PostId == postId, ct)
                     ?? throw AppException.NotFound("That comment no longer exists.");

            // Threading stops at one level: answering a reply attaches to the same parent, so the thread
            // stays two deep however long the argument runs.
            if (parent.ParentId is int grandparentId)
            {
                parent = await db.Comments.FirstAsync(c => c.Id == grandparentId, ct);
            }
        }

        var comment = new Comment
        {
            PostId = postId,
            AuthorId = userId,
            Text = request.Text.Trim(),
            ParentId = parent?.Id
        };

        db.Comments.Add(comment);
        post.CommentCount++;

        if (parent is not null)
        {
            parent.ReplyCount++;
            notifications.Add(parent.AuthorId, userId, NotificationKind.Reply, postId);
        }
        else
        {
            notifications.Add(post.AuthorId, userId, NotificationKind.Comment, postId);
        }

        await NotifyMentionsAsync(comment.Text, userId, postId, NotificationKind.Mention, ct);
        await StrengthenEdgeAsync(userId, post.AuthorId, ct);

        await db.SaveChangesAsync(ct);
        await notifications.PushPendingAsync(ct);

        comment.Author = await db.Users.FirstAsync(u => u.Id == userId, ct);

        return comment.ToResponse(userId);
    }

    public async Task DeleteCommentAsync(int userId, int commentId, CancellationToken ct = default)
    {
        var comment = await db.Comments
            .Include(c => c.Post)
            .Include(c => c.Replies)
            .FirstOrDefaultAsync(c => c.Id == commentId, ct)
            ?? throw AppException.NotFound("That comment no longer exists.");

        // Either the person who wrote it or the owner of the photo may remove it.
        if (comment.AuthorId != userId && comment.Post.AuthorId != userId)
        {
            throw AppException.Forbidden("You cannot delete that comment.");
        }

        // Replies go with it. The foreign key is Restrict rather than Cascade — SQL Server will not
        // cascade a self-reference — so the subtree is removed here, explicitly.
        var removed = 1 + comment.Replies.Count;

        if (comment.Replies.Count > 0)
        {
            db.Comments.RemoveRange(comment.Replies);
        }

        if (comment.ParentId is int parentId)
        {
            var parent = await db.Comments.FirstOrDefaultAsync(c => c.Id == parentId, ct);

            if (parent is not null)
            {
                parent.ReplyCount = Math.Max(0, parent.ReplyCount - 1);
            }
        }

        comment.Post.CommentCount = Math.Max(0, comment.Post.CommentCount - removed);
        db.Comments.Remove(comment);

        await db.SaveChangesAsync(ct);
    }

    public async Task<LikeResponse> LikeCommentAsync(
        int userId, int commentId, bool liked, CancellationToken ct = default)
    {
        var comment = await db.Comments
            .Include(c => c.Post).ThenInclude(p => p.Author)
            .FirstOrDefaultAsync(c => c.Id == commentId, ct)
            ?? throw AppException.NotFound("That comment no longer exists.");

        await GuardVisibilityAsync(userId, comment.Post.Author, ct);

        var existing = await db.CommentLikes
            .FirstOrDefaultAsync(l => l.CommentId == commentId && l.UserId == userId, ct);

        if (liked && existing is null)
        {
            db.CommentLikes.Add(new CommentLike { CommentId = commentId, UserId = userId });
            comment.LikeCount++;
            notifications.Add(comment.AuthorId, userId, NotificationKind.CommentLike, comment.PostId);
        }
        else if (!liked && existing is not null)
        {
            db.CommentLikes.Remove(existing);
            comment.LikeCount = Math.Max(0, comment.LikeCount - 1);
            await notifications.RemoveAsync(
                comment.AuthorId, userId, NotificationKind.CommentLike, comment.PostId, ct);
        }

        await db.SaveChangesAsync(ct);
        await notifications.PushPendingAsync(ct);

        return new LikeResponse { IsLiked = liked, LikeCount = comment.LikeCount };
    }

    // ------------------------------------------------------------------ helpers

    /// <summary>
    /// A like or a comment makes the edge to that author heavier, and the feed ranks by edge weight. This
    /// is the whole feedback loop: what you engage with is what you are shown more of.
    /// </summary>
    private async Task StrengthenEdgeAsync(int fromUserId, int toUserId, CancellationToken ct)
    {
        if (fromUserId == toUserId)
        {
            return;
        }

        var edge = await db.Follows
            .FirstOrDefaultAsync(f => f.FollowerId == fromUserId && f.FolloweeId == toUserId && !f.IsPending, ct);

        if (edge is not null)
        {
            edge.InteractionScore++;

            // The weight is read from the cached snapshot, so it has to know the edge moved.
            graphProvider.Invalidate();
        }
    }

    private async Task<Post> LoadAsync(int postId, CancellationToken ct) =>
        await db.Posts
            .AsNoTracking()
            .Include(p => p.Author)
            .Include(p => p.Hashtags).ThenInclude(h => h.Hashtag)
            .Include(p => p.Media)
            .Include(p => p.Tags).ThenInclude(t => t.User)
            .FirstOrDefaultAsync(p => p.Id == postId, ct)
        ?? throw AppException.NotFound("That post no longer exists.");

    private async Task GuardVisibilityAsync(int viewerId, User author, CancellationToken ct)
    {
        if (author.Id == viewerId)
        {
            return;
        }

        var graph = await graphProvider.GetAsync(ct);

        // A block hides the post entirely, and says so in the same words an unknown id gets.
        if (graph.IsWalled(viewerId, author.Id))
        {
            throw AppException.NotFound("That post no longer exists.");
        }

        if (!author.IsPrivate)
        {
            return;
        }

        if (!graph.IsFollowing(viewerId, author.Id))
        {
            throw AppException.Forbidden("This account is private.");
        }
    }

    /// <summary>Shared paging + "did I like this?" resolution for every list of posts.</summary>
    private async Task<Page<PostResponse>> PageAsync(
        IQueryable<Post> query, int viewerId, int page, int pageSize, CancellationToken ct)
    {
        var posts = await query
            .Include(p => p.Author)
            .Include(p => p.Hashtags).ThenInclude(h => h.Hashtag)
            .Include(p => p.Media)
            .Include(p => p.Tags).ThenInclude(t => t.User)
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToListAsync(ct);

        var hasMore = posts.Count > pageSize;
        var window = posts.Take(pageSize).ToList();
        var ids = window.Select(p => p.Id).ToList();

        // One query each for the whole page rather than one per card.
        var liked = (await db.PostLikes
            .Where(l => l.UserId == viewerId && ids.Contains(l.PostId))
            .Select(l => l.PostId)
            .ToListAsync(ct)).ToHashSet();

        var saved = (await db.SavedPosts
            .Where(s => s.UserId == viewerId && ids.Contains(s.PostId))
            .Select(s => s.PostId)
            .ToListAsync(ct)).ToHashSet();

        return new Page<PostResponse>
        {
            Items = window
                .Select(p => p.ToResponse(viewerId, liked.Contains(p.Id), isSaved: saved.Contains(p.Id)))
                .ToList(),
            PageNumber = page,
            PageSize = pageSize,
            HasMore = hasMore
        };
    }
}
