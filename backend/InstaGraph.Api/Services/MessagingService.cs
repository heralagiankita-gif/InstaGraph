using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using InstaGraph.Api.Realtime;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Services;

public interface IMessagingService
{
    Task<Page<ConversationSummary>> InboxAsync(
        int viewerId, MemberState folder, int page, int pageSize, CancellationToken ct = default);

    Task<InboxCounts> CountsAsync(int viewerId, CancellationToken ct = default);

    Task<ConversationDetail> ThreadAsync(
        int viewerId, int conversationId, int? beforeMessageId, int take, CancellationToken ct = default);

    Task<ConversationSummary> StartAsync(
        int viewerId, StartConversationRequest request, CancellationToken ct = default);

    Task<MessageResponse> SendAsync(
        int viewerId, int conversationId, SendMessageRequest request, CancellationToken ct = default);

    Task<MessageResponse> SendImageAsync(
        int viewerId, int conversationId, IFormFile file, CancellationToken ct = default);

    /// <summary>Sends one post into several chats at once — the share sheet behind the paper plane.</summary>
    Task<int> ShareAsync(
        int viewerId, int postId, IReadOnlyList<string> usernames, string text, CancellationToken ct = default);

    Task UnsendAsync(int viewerId, int messageId, CancellationToken ct = default);

    Task<IReadOnlyList<ReactionSummary>> ReactAsync(
        int viewerId, int messageId, string emoji, CancellationToken ct = default);

    Task MarkReadAsync(int viewerId, int conversationId, CancellationToken ct = default);

    Task RespondToRequestAsync(
        int viewerId, int conversationId, bool accept, bool markSpam, CancellationToken ct = default);

    Task UpdateMemberAsync(
        int viewerId, int conversationId, bool? muted, bool? pinned, CancellationToken ct = default);

    Task DeleteConversationAsync(int viewerId, int conversationId, CancellationToken ct = default);

    Task LeaveAsync(int viewerId, int conversationId, CancellationToken ct = default);

    Task SetTypingAsync(int viewerId, int conversationId, CancellationToken ct = default);

    Task<IReadOnlyList<ChatCandidate>> CandidatesAsync(
        int viewerId, string? query, int limit, CancellationToken ct = default);
}

/// <summary>
/// Direct messages.
/// <para>
/// The follow graph decides three things here and stays out of everything else. It decides whether a new
/// thread may be opened at all — <see cref="Audience"/> on the recipient is a rule about the edge, not
/// about the message. It decides which folder that thread lands in: an edge from the recipient back to
/// the sender puts it in the inbox, and its absence puts it under Requests. And it decides the order of
/// the people offered on the new-message screen, because the interaction weight already sitting on the
/// edge is a better guess at who you want to talk to than any list of names.
/// </para>
/// <para>
/// Traffic then runs the other way. Every message sent adds to the weight on the edges between the two
/// accounts, and that weight is the affinity term in the home feed. Messaging somebody quietly moves
/// their photos up your feed, which is the honest version of what "your feed knows who you are close to"
/// actually means.
/// </para>
/// </summary>
public class MessagingService(
    AppDbContext db,
    IGraphSnapshotProvider graphProvider,
    IPresenceTracker presence,
    IRealtimeNotifier realtime,
    IImageStorage storage) : IMessagingService
{
    /// <summary>What one message adds to the edge weight in each direction that exists.</summary>
    private const int MessageInteractionWeight = 1;

    // ------------------------------------------------------------------- inbox

    public async Task<Page<ConversationSummary>> InboxAsync(
        int viewerId, MemberState folder, int page, int pageSize, CancellationToken ct = default)
    {
        var me = await db.Users.AsNoTracking().FirstAsync(u => u.Id == viewerId, ct);

        var memberships = await db.ConversationMembers
            .AsNoTracking()
            .Include(m => m.Conversation)
            .Where(m => m.UserId == viewerId
                        && m.State == folder
                        && !m.IsHidden
                        && m.LeftAt == null)
            .OrderByDescending(m => m.IsPinned)
            .ThenByDescending(m => m.Conversation.LastMessageAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize + 1)
            .ToListAsync(ct);

        var hasMore = memberships.Count > pageSize;
        memberships = memberships.Take(pageSize).ToList();

        if (memberships.Count == 0)
        {
            return new Page<ConversationSummary>
            {
                Items = [], PageNumber = page, PageSize = pageSize, HasMore = false
            };
        }

        var conversationIds = memberships.Select(m => m.ConversationId).ToList();

        // Everybody in every thread on this page, in one query rather than one per row.
        var allMembers = await db.ConversationMembers
            .AsNoTracking()
            .Include(m => m.User)
            .Where(m => conversationIds.Contains(m.ConversationId))
            .ToListAsync(ct);

        var lastMessages = await LastMessagesAsync(conversationIds, ct);
        var unread = await UnreadCountsAsync(viewerId, memberships, ct);
        var notes = await LiveNotesAsync(viewerId, allMembers.Select(m => m.UserId).Distinct().ToList(), ct);

        var items = new List<ConversationSummary>(memberships.Count);

        foreach (var membership in memberships)
        {
            var others = allMembers
                .Where(m => m.ConversationId == membership.ConversationId
                            && m.UserId != viewerId
                            && m.LeftAt == null)
                .ToList();

            lastMessages.TryGetValue(membership.ConversationId, out var last);

            var mine = last is not null && last.SenderId == viewerId;

            // "Seen" is only shown when both sides have read receipts on. A one-way mirror would be
            // worse than not showing it at all.
            var seen = mine
                       && me.ShowReadReceipts
                       && others.Any(o => o.User.ShowReadReceipts && o.LastReadMessageId >= last!.Id);

            items.Add(new ConversationSummary
            {
                Id = membership.ConversationId,
                IsGroup = membership.Conversation.IsGroup,
                Title = TitleFor(membership.Conversation, others),
                Participants = others.Select(o => Participant(o.User, me)).ToList(),
                Preview = Preview(last, viewerId, membership.Conversation.IsGroup),
                LastMessageAt = last?.CreatedAt ?? membership.Conversation.LastMessageAt,
                UnreadCount = membership.IsMuted ? 0 : unread.GetValueOrDefault(membership.ConversationId),
                LastMessageMine = mine,
                LastMessageSeen = seen,
                IsMuted = membership.IsMuted,
                IsPinned = membership.IsPinned,
                State = membership.State.ToString(),
                IsTyping = presence.TypingIn(membership.ConversationId, viewerId).Count > 0,
                Note = others.Count == 1 ? notes.GetValueOrDefault(others[0].UserId) : null
            });
        }

        return new Page<ConversationSummary>
        {
            Items = items, PageNumber = page, PageSize = pageSize, HasMore = hasMore
        };
    }

    public async Task<InboxCounts> CountsAsync(int viewerId, CancellationToken ct = default)
    {
        var memberships = await db.ConversationMembers
            .AsNoTracking()
            .Where(m => m.UserId == viewerId && !m.IsHidden && m.LeftAt == null)
            .ToListAsync(ct);

        var accepted = memberships.Where(m => m.State == MemberState.Accepted && !m.IsMuted).ToList();
        var unread = await UnreadCountsAsync(viewerId, accepted, ct);

        return new InboxCounts
        {
            // Threads with something in them, not messages: the badge counts conversations, the way the
            // real one does.
            Unread = unread.Count(u => u.Value > 0),
            Requests = memberships.Count(m => m.State == MemberState.Pending)
        };
    }

    // ------------------------------------------------------------------ thread

    public async Task<ConversationDetail> ThreadAsync(
        int viewerId, int conversationId, int? beforeMessageId, int take, CancellationToken ct = default)
    {
        var membership = await MemberAsync(viewerId, conversationId, ct);
        var me = await db.Users.AsNoTracking().FirstAsync(u => u.Id == viewerId, ct);

        var conversation = await db.Conversations
            .AsNoTracking()
            .FirstAsync(c => c.Id == conversationId, ct);

        var members = await db.ConversationMembers
            .AsNoTracking()
            .Include(m => m.User)
            .Where(m => m.ConversationId == conversationId)
            .ToListAsync(ct);

        var others = members.Where(m => m.UserId != viewerId && m.LeftAt == null).ToList();

        var query = db.Messages
            .AsNoTracking()
            .Include(m => m.Sender)
            .Include(m => m.SharedPost).ThenInclude(p => p!.Author)
            .Include(m => m.SharedUser)
            .Include(m => m.SharedStory).ThenInclude(st => st!.Author)
            .Include(m => m.ReplyToMessage).ThenInclude(r => r!.Sender)
            .Include(m => m.Reactions).ThenInclude(r => r.User)
            .Where(m => m.ConversationId == conversationId);

        // Clearing a chat empties your copy only: the messages are still there, and still there for
        // everybody else, they are simply older than your line in the sand.
        if (membership.ClearedAt is not null)
        {
            query = query.Where(m => m.CreatedAt > membership.ClearedAt);
        }

        if (beforeMessageId is > 0)
        {
            query = query.Where(m => m.Id < beforeMessageId);
        }

        var page = await query
            .OrderByDescending(m => m.Id)
            .Take(take + 1)
            .ToListAsync(ct);

        var hasMore = page.Count > take;
        page = page.Take(take).ToList();
        page.Reverse();

        // The furthest any of them has read, so the sender's own last message can carry "Seen".
        int? seenUpTo = me.ShowReadReceipts
            ? others.Where(o => o.User.ShowReadReceipts)
                .Select(o => o.LastReadMessageId)
                .DefaultIfEmpty(null)
                .Max()
            : null;

        var typing = presence.TypingIn(conversationId, viewerId);

        return new ConversationDetail
        {
            Id = conversationId,
            IsGroup = conversation.IsGroup,
            Title = TitleFor(conversation, others),
            Participants = others.Select(o => Participant(o.User, me)).ToList(),
            Messages = page.Select(m => ToResponse(m, viewerId)).ToList(),
            HasMore = hasMore,
            State = membership.State.ToString(),
            IsMuted = membership.IsMuted,
            IsPinned = membership.IsPinned,
            TypingUsernames = members.Where(m => typing.Contains(m.UserId)).Select(m => m.User.Username).ToList(),
            SeenUpToMessageId = seenUpTo,

            // Only a one-to-one thread has a "who is this" to answer.
            Context = others.Count == 1 ? await ContextAsync(viewerId, others[0].User, ct) : null
        };
    }

    // ------------------------------------------------------------- starting one

    public async Task<ConversationSummary> StartAsync(
        int viewerId, StartConversationRequest request, CancellationToken ct = default)
    {
        var handles = request.Usernames
            .Select(u => u.Trim().ToLowerInvariant())
            .Where(u => u.Length > 0)
            .Distinct()
            .ToList();

        if (handles.Count == 0)
        {
            throw AppException.BadRequest("Choose somebody to message.");
        }

        var targets = await db.Users
            .Where(u => handles.Contains(u.Username) && u.IsActive && u.Id != viewerId)
            .ToListAsync(ct);

        if (targets.Count != handles.Count)
        {
            throw AppException.NotFound("That account does not exist.");
        }

        var conversation = await FindOrCreateAsync(viewerId, targets, request.Title, ct);

        var members = await db.ConversationMembers
            .AsNoTracking()
            .Include(m => m.User)
            .Where(m => m.ConversationId == conversation.Id)
            .ToListAsync(ct);

        var me = await db.Users.AsNoTracking().FirstAsync(u => u.Id == viewerId, ct);
        var others = members.Where(m => m.UserId != viewerId && m.LeftAt == null).ToList();

        return new ConversationSummary
        {
            Id = conversation.Id,
            IsGroup = conversation.IsGroup,
            Title = TitleFor(conversation, others),
            Participants = others.Select(o => Participant(o.User, me)).ToList(),
            LastMessageAt = conversation.LastMessageAt,
            State = MemberState.Accepted.ToString()
        };
    }

    // ------------------------------------------------------------------ sending

    public async Task<MessageResponse> SendAsync(
        int viewerId, int conversationId, SendMessageRequest request, CancellationToken ct = default)
    {
        var membership = await MemberAsync(viewerId, conversationId, ct);

        var text = (request.Text ?? string.Empty).Trim();
        var hasBody = text.Length > 0
                      || request.SharedPostId is > 0
                      || !string.IsNullOrWhiteSpace(request.SharedUsername)
                      || request.IsHeart;

        if (!hasBody)
        {
            throw AppException.BadRequest("Write something first.");
        }

        var others = await OtherMembersAsync(conversationId, viewerId, ct);
        await GuardWallAsync(viewerId, others.Select(o => o.UserId).ToList(), ct);

        var message = new Message
        {
            ConversationId = conversationId,
            SenderId = viewerId,
            Text = text,
            Kind = MessageKind.Text
        };

        if (request.IsHeart && text.Length == 0)
        {
            message.Kind = MessageKind.Heart;
            message.Text = "❤️";
        }

        if (request.SharedPostId is > 0)
        {
            var post = await db.Posts
                .Include(p => p.Author)
                .FirstOrDefaultAsync(p => p.Id == request.SharedPostId, ct)
                ?? throw AppException.NotFound("That post no longer exists.");

            await GuardCanSeePostAsync(viewerId, post, ct);

            message.Kind = MessageKind.PostShare;
            message.SharedPostId = post.Id;
        }
        else if (request.SharedStoryId is > 0)
        {
            // Visibility was already checked by the story screen that produced this; the reference is
            // stored so the bubble can show what was answered, and nulled if the story later expires.
            var exists = await db.Stories.AnyAsync(s => s.Id == request.SharedStoryId, ct);

            if (exists)
            {
                message.Kind = MessageKind.StoryReply;
                message.SharedStoryId = request.SharedStoryId;
            }
        }
        else if (!string.IsNullOrWhiteSpace(request.SharedUsername))
        {
            var handle = request.SharedUsername.Trim().ToLowerInvariant();

            var shared = await db.Users.FirstOrDefaultAsync(u => u.Username == handle && u.IsActive, ct)
                         ?? throw AppException.NotFound("That account does not exist.");

            message.Kind = MessageKind.ProfileShare;
            message.SharedUserId = shared.Id;
        }

        if (request.ReplyToMessageId is > 0)
        {
            var parent = await db.Messages
                .FirstOrDefaultAsync(m => m.Id == request.ReplyToMessageId && m.ConversationId == conversationId, ct)
                ?? throw AppException.NotFound("That message is no longer there.");

            message.ReplyToMessageId = parent.Id;
        }

        db.Messages.Add(message);
        await ApplySendAsync(viewerId, conversationId, membership, others, message, ct);

        return await LoadResponseAsync(message.Id, viewerId, ct);
    }

    public async Task<MessageResponse> SendImageAsync(
        int viewerId, int conversationId, IFormFile file, CancellationToken ct = default)
    {
        var membership = await MemberAsync(viewerId, conversationId, ct);
        var others = await OtherMembersAsync(conversationId, viewerId, ct);
        await GuardWallAsync(viewerId, others.Select(o => o.UserId).ToList(), ct);

        var url = await storage.SaveAsync(file, ct);

        var message = new Message
        {
            ConversationId = conversationId,
            SenderId = viewerId,
            Kind = MessageKind.Image,
            ImageUrl = url
        };

        db.Messages.Add(message);
        await ApplySendAsync(viewerId, conversationId, membership, others, message, ct);

        return await LoadResponseAsync(message.Id, viewerId, ct);
    }

    public async Task<int> ShareAsync(
        int viewerId, int postId, IReadOnlyList<string> usernames, string text, CancellationToken ct = default)
    {
        var post = await db.Posts
            .Include(p => p.Author)
            .FirstOrDefaultAsync(p => p.Id == postId, ct)
            ?? throw AppException.NotFound("That post no longer exists.");

        await GuardCanSeePostAsync(viewerId, post, ct);

        var handles = usernames
            .Select(u => u.Trim().ToLowerInvariant())
            .Where(u => u.Length > 0)
            .Distinct()
            .ToList();

        if (handles.Count == 0)
        {
            throw AppException.BadRequest("Choose somebody to send it to.");
        }

        var sent = 0;

        foreach (var handle in handles)
        {
            var target = await db.Users.FirstOrDefaultAsync(u => u.Username == handle && u.IsActive, ct);

            if (target is null || target.Id == viewerId)
            {
                continue;
            }

            try
            {
                var conversation = await FindOrCreateAsync(viewerId, [target], null, ct);

                await SendAsync(
                    viewerId,
                    conversation.Id,
                    new SendMessageRequest { SharedPostId = post.Id, Text = text },
                    ct);

                sent++;
            }
            catch (AppException)
            {
                // One recipient who does not accept messages, or who has a block in place, should not
                // undo the sends that already succeeded. The count that comes back is the honest answer.
            }
        }

        return sent;
    }

    // ----------------------------------------------------------------- editing

    /// <summary>
    /// Unsend. The row survives with its text cleared, because a reply and a reaction both point at it —
    /// deleting it would leave an answer to nothing.
    /// </summary>
    public async Task UnsendAsync(int viewerId, int messageId, CancellationToken ct = default)
    {
        var message = await db.Messages.FirstOrDefaultAsync(m => m.Id == messageId, ct)
                      ?? throw AppException.NotFound("That message is no longer there.");

        if (message.SenderId != viewerId)
        {
            throw AppException.Forbidden("You can only unsend your own messages.");
        }

        await MemberAsync(viewerId, message.ConversationId, ct);

        message.IsUnsent = true;
        message.Text = string.Empty;
        message.SharedPostId = null;
        message.SharedUserId = null;

        if (message.ImageUrl is not null)
        {
            storage.Delete(message.ImageUrl);
            message.ImageUrl = null;
        }

        var reactions = await db.MessageReactions.Where(r => r.MessageId == messageId).ToListAsync(ct);
        db.MessageReactions.RemoveRange(reactions);

        await db.SaveChangesAsync(ct);

        await PushMessageAsync(messageId, RealtimeEvents.MessageChanged, ct);
    }

    public async Task<IReadOnlyList<ReactionSummary>> ReactAsync(
        int viewerId, int messageId, string emoji, CancellationToken ct = default)
    {
        var message = await db.Messages.FirstOrDefaultAsync(m => m.Id == messageId, ct)
                      ?? throw AppException.NotFound("That message is no longer there.");

        await MemberAsync(viewerId, message.ConversationId, ct);

        var existing = await db.MessageReactions
            .FirstOrDefaultAsync(r => r.MessageId == messageId && r.UserId == viewerId, ct);

        emoji = emoji.Trim();

        if (existing is not null)
        {
            // The same emoji again takes it back; a different one replaces it. One reaction per person.
            if (emoji.Length == 0 || existing.Emoji == emoji)
            {
                db.MessageReactions.Remove(existing);
            }
            else
            {
                existing.Emoji = emoji;
            }
        }
        else if (emoji.Length > 0)
        {
            db.MessageReactions.Add(new MessageReaction
            {
                MessageId = messageId,
                UserId = viewerId,
                Emoji = emoji
            });
        }

        await db.SaveChangesAsync(ct);

        await PushMessageAsync(messageId, RealtimeEvents.MessageChanged, ct);

        var reactions = await db.MessageReactions
            .AsNoTracking()
            .Include(r => r.User)
            .Where(r => r.MessageId == messageId)
            .ToListAsync(ct);

        return Summarise(reactions, viewerId);
    }

    // ------------------------------------------------------------- housekeeping

    public async Task MarkReadAsync(int viewerId, int conversationId, CancellationToken ct = default)
    {
        var membership = await MemberAsync(viewerId, conversationId, ct);

        // Reading a request does not mark it read. Otherwise opening one to decide whether you want it
        // would put "Seen" under the sender's message — telling them something the screen promises it
        // will not, and turning a decision you have not made into one they can see you making.
        if (membership.State != MemberState.Accepted)
        {
            return;
        }

        var newest = await db.Messages
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.Id)
            .Select(m => (int?)m.Id)
            .FirstOrDefaultAsync(ct);

        if (newest is null || membership.LastReadMessageId >= newest)
        {
            return;
        }

        membership.LastReadMessageId = newest;
        membership.LastReadAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);

        // "Seen" appears on the other side the moment it is true, and only if this account is willing to
        // say so. Somebody with read receipts off reads silently, here as everywhere else.
        var me = await db.Users.AsNoTracking().FirstAsync(u => u.Id == viewerId, ct);

        if (!me.ShowReadReceipts)
        {
            return;
        }

        var others = await db.ConversationMembers
            .AsNoTracking()
            .Include(m => m.User)
            .Where(m => m.ConversationId == conversationId && m.UserId != viewerId && m.LeftAt == null)
            .ToListAsync(ct);

        await realtime.ToUsersAsync(
            others.Where(o => o.User.ShowReadReceipts).Select(o => o.UserId),
            RealtimeEvents.Read,
            new { conversationId, userId = viewerId, messageId = newest.Value },
            ct);
    }

    public async Task RespondToRequestAsync(
        int viewerId, int conversationId, bool accept, bool markSpam, CancellationToken ct = default)
    {
        var membership = await MemberAsync(viewerId, conversationId, ct);

        if (accept)
        {
            membership.State = MemberState.Accepted;
            membership.IsHidden = false;
            await db.SaveChangesAsync(ct);
            return;
        }

        if (markSpam)
        {
            // Marked as spam: the thread stays so the same account cannot simply arrive again in the
            // inbox, but nothing from it is ever counted or shown outside the spam folder.
            membership.State = MemberState.Spam;
            membership.IsHidden = false;
        }
        else
        {
            membership.IsHidden = true;
            membership.ClearedAt = DateTime.UtcNow;
        }

        await db.SaveChangesAsync(ct);
    }

    public async Task UpdateMemberAsync(
        int viewerId, int conversationId, bool? muted, bool? pinned, CancellationToken ct = default)
    {
        var membership = await MemberAsync(viewerId, conversationId, ct);

        if (muted is not null)
        {
            membership.IsMuted = muted.Value;
        }

        if (pinned is not null)
        {
            membership.IsPinned = pinned.Value;
        }

        await db.SaveChangesAsync(ct);
    }

    /// <summary>
    /// Deletes the chat for you and nobody else: the row is hidden, the history behind it is cut off, and
    /// the other side's copy is untouched. A new message brings it back empty.
    /// </summary>
    public async Task DeleteConversationAsync(int viewerId, int conversationId, CancellationToken ct = default)
    {
        var membership = await MemberAsync(viewerId, conversationId, ct);

        membership.IsHidden = true;
        membership.ClearedAt = DateTime.UtcNow;
        membership.LastReadAt = DateTime.UtcNow;

        membership.LastReadMessageId = await db.Messages
            .Where(m => m.ConversationId == conversationId)
            .OrderByDescending(m => m.Id)
            .Select(m => (int?)m.Id)
            .FirstOrDefaultAsync(ct) ?? membership.LastReadMessageId;

        await db.SaveChangesAsync(ct);
    }

    public async Task LeaveAsync(int viewerId, int conversationId, CancellationToken ct = default)
    {
        var membership = await MemberAsync(viewerId, conversationId, ct);

        var conversation = await db.Conversations.FirstAsync(c => c.Id == conversationId, ct);

        if (!conversation.IsGroup)
        {
            throw AppException.BadRequest("You can only leave a group.");
        }

        membership.LeftAt = DateTime.UtcNow;

        var me = await db.Users.AsNoTracking().FirstAsync(u => u.Id == viewerId, ct);

        db.Messages.Add(new Message
        {
            ConversationId = conversationId,
            SenderId = viewerId,
            Kind = MessageKind.System,
            Text = $"{me.Username} left the group."
        });

        conversation.LastMessageAt = DateTime.UtcNow;

        await db.SaveChangesAsync(ct);
    }

    public async Task SetTypingAsync(int viewerId, int conversationId, CancellationToken ct = default)
    {
        await MemberAsync(viewerId, conversationId, ct);
        presence.SetTyping(conversationId, viewerId);
    }

    // -------------------------------------------------------------- candidates

    /// <summary>
    /// Who to offer on the new-message screen.
    /// <para>
    /// Sorted by the weight already on the edge between you, then by whether the edge runs both ways,
    /// then by how close the graph puts you. That ordering is the whole point: the accounts you talk to
    /// are the accounts you interact with, and the interaction weight is already sitting on the edge
    /// because the feed put it there.
    /// </para>
    /// </summary>
    public async Task<IReadOnlyList<ChatCandidate>> CandidatesAsync(
        int viewerId, string? query, int limit, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);
        var wall = graph.WalledFor(viewerId);

        var term = (query ?? string.Empty).Trim().ToLowerInvariant();

        // Friends first — the reciprocal edges — then everyone else you follow, then everyone who
        // follows you. A search widens it to every account that matches.
        var pool = graph.Friends(viewerId)
            .Concat(graph.Following(viewerId))
            .Concat(graph.Followers(viewerId))
            .Where(id => id != viewerId && !wall.Contains(id))
            .Distinct()
            .ToList();

        List<User> users;

        if (term.Length > 0)
        {
            users = await db.Users
                .AsNoTracking()
                .Where(u => u.IsActive && u.Id != viewerId)
                .Where(u => u.Username.Contains(term) || u.FullName.Contains(term))
                .Take(limit * 3)
                .ToListAsync(ct);

            users = users.Where(u => !wall.Contains(u.Id)).ToList();
        }
        else
        {
            var ids = pool.Take(200).ToList();

            users = await db.Users
                .AsNoTracking()
                .Where(u => ids.Contains(u.Id) && u.IsActive)
                .ToListAsync(ct);
        }

        var userIds = users.Select(u => u.Id).ToList();

        // Which of them you already have a thread with, so the row can say "open" rather than "start".
        var existing = await ExistingPairThreadsAsync(viewerId, userIds, ct);

        var ranked = users
            .Select(u => new
            {
                User = u,
                Weight = graph.EdgeWeight(viewerId, u.Id) + graph.EdgeWeight(u.Id, viewerId),
                Mutual = graph.IsMutual(viewerId, u.Id),
                Following = graph.IsFollowing(viewerId, u.Id),
                FollowsYou = graph.IsFollowing(u.Id, viewerId),
                MutualCount = graph.MutualCount(viewerId, u.Id)
            })
            .OrderByDescending(x => x.Weight)
            .ThenByDescending(x => x.Mutual)
            .ThenByDescending(x => x.Following)
            .ThenByDescending(x => x.MutualCount)
            .ThenBy(x => x.User.Username)
            .Take(limit)
            .ToList();

        var me = await db.Users.AsNoTracking().FirstAsync(u => u.Id == viewerId, ct);

        return ranked.Select(x => new ChatCandidate
        {
            Id = x.User.Id,
            Username = x.User.Username,
            FullName = x.User.FullName,
            AvatarUrl = x.User.AvatarUrl,
            IsPrivate = x.User.IsPrivate,
            IsVerified = x.User.IsVerified,
            IsMe = false,
            IsFollowing = x.Following,
            FollowsYou = x.FollowsYou,
            IsFriend = x.Mutual,
            Reason = x.Mutual
                ? "You follow each other"
                : x.Following
                    ? "You follow them"
                    : x.FollowsYou
                        ? "Follows you"
                        : x.MutualCount > 0
                            ? $"{x.MutualCount} mutual {(x.MutualCount == 1 ? "connection" : "connections")}"
                            : "Not connected",
            HasThread = existing.ContainsKey(x.User.Id),
            ConversationId = existing.GetValueOrDefault(x.User.Id),
            IsOnline = CanSeePresence(me, x.User) && presence.IsOnline(x.User.Id)
        }).ToList();
    }

    // ---------------------------------------------------------------- internals

    /// <summary>
    /// The caller's membership, or the same answer a conversation that never existed gives.
    /// <para>
    /// Somebody who left a group keeps their row — their old messages still need an author — but they are
    /// not a member any more, so the thread stops existing for them at the moment they left rather than
    /// quietly continuing to arrive.
    /// </para>
    /// </summary>
    private async Task<ConversationMember> MemberAsync(int viewerId, int conversationId, CancellationToken ct)
    {
        var membership = await db.ConversationMembers
            .FirstOrDefaultAsync(m => m.ConversationId == conversationId && m.UserId == viewerId, ct);

        if (membership is null || membership.LeftAt is not null)
        {
            throw AppException.NotFound("That conversation does not exist.");
        }

        return membership;
    }

    private async Task<List<ConversationMember>> OtherMembersAsync(
        int conversationId, int viewerId, CancellationToken ct) =>
        await db.ConversationMembers
            .Include(m => m.User)
            .Where(m => m.ConversationId == conversationId && m.UserId != viewerId && m.LeftAt == null)
            .ToListAsync(ct);

    /// <summary>
    /// Finds the existing one-to-one thread or opens a new one, applying the gate on the way in.
    /// </summary>
    private async Task<Conversation> FindOrCreateAsync(
        int viewerId, IReadOnlyList<User> targets, string? title, CancellationToken ct)
    {
        var isGroup = targets.Count > 1;

        await GuardWallAsync(viewerId, targets.Select(t => t.Id).ToList(), ct);

        if (!isGroup)
        {
            var key = PairKeyFor(viewerId, targets[0].Id);

            var existing = await db.Conversations.FirstOrDefaultAsync(c => c.PairKey == key, ct);

            if (existing is not null)
            {
                // The thread is back in your inbox the moment you open it again, even if you deleted it.
                var mine = await db.ConversationMembers
                    .FirstAsync(m => m.ConversationId == existing.Id && m.UserId == viewerId, ct);

                if (mine.IsHidden)
                {
                    mine.IsHidden = false;
                    await db.SaveChangesAsync(ct);
                }

                return existing;
            }
        }

        foreach (var target in targets)
        {
            GuardAudience(viewerId, target, await graphProvider.GetAsync(ct));
        }

        var conversation = new Conversation
        {
            IsGroup = isGroup,
            Title = isGroup ? (title?.Trim() is { Length: > 0 } t ? t : null) : null,
            PairKey = isGroup ? null : PairKeyFor(viewerId, targets[0].Id),
            CreatedById = viewerId,
            LastMessageAt = DateTime.UtcNow
        };

        db.Conversations.Add(conversation);

        conversation.Members.Add(new ConversationMember
        {
            UserId = viewerId,
            State = MemberState.Accepted
        });

        var graph = await graphProvider.GetAsync(ct);

        foreach (var target in targets)
        {
            conversation.Members.Add(new ConversationMember
            {
                UserId = target.Id,

                // The gate, and the only place the graph decides which folder a thread lands in: an edge
                // from them back to the sender means the inbox, and no edge means Requests. Nothing else
                // about the message is examined.
                State = graph.IsFollowing(target.Id, viewerId) ? MemberState.Accepted : MemberState.Pending
            });
        }

        await db.SaveChangesAsync(ct);

        return conversation;
    }

    /// <summary>
    /// Saves a message and moves everything that hangs off it: the thread's order in the inbox, whether
    /// the recipients' copies come back from a delete, whether the request tripped a hidden word, and the
    /// weight on the edges between the people talking.
    /// </summary>
    private async Task ApplySendAsync(
        int viewerId,
        int conversationId,
        ConversationMember mine,
        List<ConversationMember> others,
        Message message,
        CancellationToken ct)
    {
        var conversation = await db.Conversations.FirstAsync(c => c.Id == conversationId, ct);
        conversation.LastMessageAt = DateTime.UtcNow;

        // Sending into a thread you had filed under Requests accepts it — answering somebody is the
        // clearest possible way of saying they are not a stranger.
        if (mine.State == MemberState.Pending)
        {
            mine.State = MemberState.Accepted;
        }

        mine.IsHidden = false;

        foreach (var other in others)
        {
            // A deleted chat reappears when something new arrives, empty above the new message.
            other.IsHidden = false;

            if (other.State == MemberState.Pending && TripsHiddenWords(other.User, message.Text))
            {
                other.State = MemberState.Spam;
            }
        }

        await BumpInteractionAsync(viewerId, others.Select(o => o.UserId).ToList(), ct);

        await db.SaveChangesAsync(ct);

        // Only now, with an id on the row and the transaction committed, does anybody get told.
        await PushMessageAsync(message.Id, RealtimeEvents.Message, ct);
    }

    /// <summary>
    /// Pushes one message to everybody in its thread, mapped once per person.
    /// <para>
    /// The payload is built per recipient rather than broadcast to a room, because "is this mine" and
    /// "did I react to this" are facts about the viewer. Answering them on the server is one extra send
    /// per group member and removes a whole class of client-side guessing.
    /// </para>
    /// </summary>
    private async Task PushMessageAsync(int messageId, string method, CancellationToken ct)
    {
        var message = await db.Messages
            .AsNoTracking()
            .Include(m => m.Sender)
            .Include(m => m.SharedPost).ThenInclude(p => p!.Author)
            .Include(m => m.SharedUser)
            .Include(m => m.SharedStory).ThenInclude(st => st!.Author)
            .Include(m => m.ReplyToMessage).ThenInclude(r => r!.Sender)
            .Include(m => m.Reactions).ThenInclude(r => r.User)
            .FirstOrDefaultAsync(m => m.Id == messageId, ct);

        if (message is null)
        {
            return;
        }

        var memberIds = await db.ConversationMembers
            .AsNoTracking()
            .Where(m => m.ConversationId == message.ConversationId && m.LeftAt == null)
            .Select(m => m.UserId)
            .ToListAsync(ct);

        foreach (var userId in memberIds)
        {
            await realtime.ToUserAsync(
                userId,
                method,
                new { conversationId = message.ConversationId, message = ToResponse(message, userId) },
                ct);
        }
    }

    /// <summary>
    /// Adds to the weight on every edge that exists between the sender and the people they messaged.
    /// <para>
    /// This is the one line that ties messaging back into the rest of the app. <c>InteractionScore</c> is
    /// the affinity term in the feed's ranking, so a conversation quietly lifts that person's photos —
    /// the same thing likes and comments already do, along an edge that likes and comments do not reach.
    /// </para>
    /// </summary>
    private async Task BumpInteractionAsync(int viewerId, IReadOnlyList<int> otherIds, CancellationToken ct)
    {
        if (otherIds.Count == 0)
        {
            return;
        }

        var edges = await db.Follows
            .Where(f => !f.IsPending
                        && ((f.FollowerId == viewerId && otherIds.Contains(f.FolloweeId))
                            || (f.FolloweeId == viewerId && otherIds.Contains(f.FollowerId))))
            .ToListAsync(ct);

        foreach (var edge in edges)
        {
            edge.InteractionScore += MessageInteractionWeight;
        }

        if (edges.Count > 0)
        {
            // The weights the snapshot is holding are now out of date.
            graphProvider.Invalidate();
        }
    }

    /// <summary>Blocked in either direction, and neither side is told which.</summary>
    private async Task GuardWallAsync(int viewerId, IReadOnlyList<int> otherIds, CancellationToken ct)
    {
        if (otherIds.Count == 0)
        {
            return;
        }

        var graph = await graphProvider.GetAsync(ct);

        if (otherIds.Any(id => graph.IsWalled(viewerId, id)))
        {
            throw AppException.NotFound("That account does not exist.");
        }
    }

    /// <summary>
    /// The recipient's own rule about who may open a thread with them, expressed entirely in edges.
    /// <para>
    /// <c>NoOne</c> is the strict reading on purpose: it refuses every new thread, including one from
    /// somebody they follow, because a setting called "no one" that quietly means "almost no one" is
    /// worse than no setting at all. Threads that already exist are untouched.
    /// </para>
    /// </summary>
    private static void GuardAudience(int viewerId, User target, SocialGraph graph)
    {
        var allowed = target.MessagesFrom switch
        {
            Audience.Everyone => true,
            Audience.Following => graph.IsFollowing(target.Id, viewerId),
            Audience.Friends => graph.IsMutual(target.Id, viewerId),
            _ => false
        };

        if (!allowed)
        {
            throw AppException.Forbidden($"{target.Username} does not accept new messages.");
        }
    }

    private async Task GuardCanSeePostAsync(int viewerId, Post post, CancellationToken ct)
    {
        if (post.AuthorId == viewerId)
        {
            return;
        }

        var graph = await graphProvider.GetAsync(ct);

        if (graph.IsWalled(viewerId, post.AuthorId))
        {
            throw AppException.NotFound("That post no longer exists.");
        }

        if (post.Author.IsPrivate && !graph.IsFollowing(viewerId, post.AuthorId))
        {
            throw AppException.Forbidden("That account is private.");
        }
    }

    private static bool TripsHiddenWords(User recipient, string text)
    {
        if (string.IsNullOrWhiteSpace(recipient.HiddenWords) || string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        var words = recipient.HiddenWords
            .Split([',', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        return words.Any(word => text.Contains(word, StringComparison.OrdinalIgnoreCase));
    }

    private static string PairKeyFor(int a, int b) => a < b ? $"{a}:{b}" : $"{b}:{a}";

    private async Task<Dictionary<int, int>> ExistingPairThreadsAsync(
        int viewerId, IReadOnlyList<int> otherIds, CancellationToken ct)
    {
        if (otherIds.Count == 0)
        {
            return [];
        }

        var keys = otherIds.Select(id => PairKeyFor(viewerId, id)).ToList();

        var rows = await db.Conversations
            .AsNoTracking()
            .Where(c => c.PairKey != null && keys.Contains(c.PairKey))
            .Select(c => new { c.Id, c.PairKey })
            .ToListAsync(ct);

        var map = new Dictionary<int, int>();

        foreach (var id in otherIds)
        {
            var key = PairKeyFor(viewerId, id);
            var row = rows.FirstOrDefault(r => r.PairKey == key);

            if (row is not null)
            {
                map[id] = row.Id;
            }
        }

        return map;
    }

    private async Task<Dictionary<int, Message>> LastMessagesAsync(
        IReadOnlyList<int> conversationIds, CancellationToken ct)
    {
        var newestIds = await db.Messages
            .Where(m => conversationIds.Contains(m.ConversationId))
            .GroupBy(m => m.ConversationId)
            .Select(g => g.Max(m => m.Id))
            .ToListAsync(ct);

        var messages = await db.Messages
            .AsNoTracking()
            .Include(m => m.Sender)
            .Where(m => newestIds.Contains(m.Id))
            .ToListAsync(ct);

        return messages.ToDictionary(m => m.ConversationId);
    }

    /// <summary>
    /// Unread counts for a page of threads in one query.
    /// <para>
    /// Each member has their own watermark, which SQL cannot compare per row in a single predicate, so
    /// the query is bounded by the lowest watermark on the page and the per-thread comparison is done in
    /// memory. Only ids come back, and only ones newer than something already unread.
    /// </para>
    /// </summary>
    private async Task<Dictionary<int, int>> UnreadCountsAsync(
        int viewerId, IReadOnlyList<ConversationMember> memberships, CancellationToken ct)
    {
        if (memberships.Count == 0)
        {
            return [];
        }

        var watermarks = memberships.ToDictionary(m => m.ConversationId, m => m.LastReadMessageId ?? 0);
        var conversationIds = watermarks.Keys.ToList();
        var floor = watermarks.Values.Min();

        var rows = await db.Messages
            .AsNoTracking()
            .Where(m => conversationIds.Contains(m.ConversationId)
                        && m.Id > floor
                        && m.SenderId != viewerId
                        && !m.IsUnsent)
            .Select(m => new { m.ConversationId, m.Id })
            .ToListAsync(ct);

        var counts = conversationIds.ToDictionary(id => id, _ => 0);

        foreach (var row in rows)
        {
            if (row.Id > watermarks[row.ConversationId])
            {
                counts[row.ConversationId]++;
            }
        }

        return counts;
    }

    /// <summary>Live notes from the accounts on this page, subject to who each note was written for.</summary>
    private async Task<Dictionary<int, string>> LiveNotesAsync(
        int viewerId, IReadOnlyList<int> userIds, CancellationToken ct)
    {
        if (userIds.Count == 0)
        {
            return [];
        }

        var now = DateTime.UtcNow;

        var notes = await db.Notes
            .AsNoTracking()
            .Where(n => userIds.Contains(n.UserId) && n.ExpiresAt > now && n.UserId != viewerId)
            .ToListAsync(ct);

        if (notes.Count == 0)
        {
            return [];
        }

        var graph = await graphProvider.GetAsync(ct);

        // A note goes to the accounts whose edge runs both ways, and a private one only to the writer's
        // close-friends list.
        var authorIds = notes.Select(n => n.UserId).Distinct().ToList();

        var closeTo = await db.UserListEntries
            .AsNoTracking()
            .Where(e => e.Kind == UserListKind.CloseFriends
                        && e.UserId == viewerId
                        && authorIds.Contains(e.OwnerId))
            .Select(e => e.OwnerId)
            .ToListAsync(ct);

        return notes
            .Where(n => graph.IsMutual(viewerId, n.UserId)
                        && (!n.CloseFriendsOnly || closeTo.Contains(n.UserId)))
            .ToDictionary(n => n.UserId, n => n.Text);
    }

    private async Task<MessageResponse> LoadResponseAsync(int messageId, int viewerId, CancellationToken ct)
    {
        var message = await db.Messages
            .AsNoTracking()
            .Include(m => m.Sender)
            .Include(m => m.SharedPost).ThenInclude(p => p!.Author)
            .Include(m => m.SharedUser)
            .Include(m => m.SharedStory).ThenInclude(st => st!.Author)
            .Include(m => m.ReplyToMessage).ThenInclude(r => r!.Sender)
            .Include(m => m.Reactions).ThenInclude(r => r.User)
            .FirstAsync(m => m.Id == messageId, ct);

        return ToResponse(message, viewerId);
    }

    private static MessageResponse ToResponse(Message message, int viewerId) => new()
    {
        Id = message.Id,
        ConversationId = message.ConversationId,
        Sender = message.Sender.ToSummary(),
        Kind = message.Kind.ToString(),
        Text = message.Text,
        ImageUrl = message.ImageUrl,
        SharedPost = message.SharedPost is null
            ? null
            : message.SharedPost.ToResponse(viewerId, isLiked: false),
        SharedUser = message.SharedUser?.ToSummary(),
        SharedStory = message.SharedStory is null
            ? null
            : new StoryResponse
            {
                Id = message.SharedStory.Id,
                Author = message.SharedStory.Author.ToSummary(),
                ImageUrl = message.SharedStory.ImageUrl,
                Caption = message.SharedStory.Caption,
                CreatedAt = message.SharedStory.CreatedAt,
                ExpiresAt = message.SharedStory.ExpiresAt
            },
        ReplyTo = message.ReplyToMessage is null
            ? null
            : new MessageQuote
            {
                Id = message.ReplyToMessage.Id,
                Author = message.ReplyToMessage.Sender.Username,
                Preview = QuoteOf(message.ReplyToMessage),
                IsUnsent = message.ReplyToMessage.IsUnsent
            },
        IsMine = message.SenderId == viewerId,
        IsUnsent = message.IsUnsent,
        CreatedAt = message.CreatedAt,
        Reactions = Summarise(message.Reactions, viewerId)
    };

    private static IReadOnlyList<ReactionSummary> Summarise(
        IEnumerable<MessageReaction> reactions, int viewerId) =>
        reactions
            .GroupBy(r => r.Emoji)
            .Select(g => new ReactionSummary
            {
                Emoji = g.Key,
                Count = g.Count(),
                Mine = g.Any(r => r.UserId == viewerId),
                Users = g.Where(r => r.User is not null).Select(r => r.User.ToSummary()).ToList()
            })
            .OrderByDescending(r => r.Count)
            .ToList();

    private static string QuoteOf(Message message) => message.IsUnsent
        ? "Unsent message"
        : message.Kind switch
        {
            MessageKind.Image => "Photo",
            MessageKind.PostShare => "Post",
            MessageKind.ProfileShare => "Profile",
            MessageKind.StoryReply => "Story reply",
            _ => message.Text
        };

    private static string Preview(Message? message, int viewerId, bool isGroup)
    {
        if (message is null)
        {
            return "Say hi.";
        }

        var body = message.IsUnsent
            ? "Unsent a message"
            : message.Kind switch
            {
                MessageKind.Image => "Sent a photo",
                MessageKind.PostShare => "Shared a post",
                MessageKind.ProfileShare => "Shared a profile",
                MessageKind.StoryReply => string.IsNullOrWhiteSpace(message.Text) ? "Replied to a story" : message.Text,
                MessageKind.Heart => "❤️",
                MessageKind.System => message.Text,
                _ => message.Text
            };

        if (message.Kind == MessageKind.System)
        {
            return body;
        }

        if (message.SenderId == viewerId)
        {
            return $"You: {body}";
        }

        return isGroup ? $"{message.Sender.Username}: {body}" : body;
    }

    private static string TitleFor(Conversation conversation, IReadOnlyList<ConversationMember> others)
    {
        if (!string.IsNullOrWhiteSpace(conversation.Title))
        {
            return conversation.Title;
        }

        if (others.Count == 0)
        {
            return "Just you";
        }

        if (others.Count == 1)
        {
            var user = others[0].User;
            return string.IsNullOrWhiteSpace(user.FullName) ? user.Username : user.FullName;
        }

        return string.Join(", ", others.Take(3).Select(o => o.User.Username))
               + (others.Count > 3 ? $" +{others.Count - 3}" : string.Empty);
    }

    private ChatParticipant Participant(User user, User viewer)
    {
        var visible = CanSeePresence(viewer, user);

        return new ChatParticipant
        {
            Id = user.Id,
            Username = user.Username,
            FullName = user.FullName,
            AvatarUrl = user.AvatarUrl,
            IsPrivate = user.IsPrivate,
            IsVerified = user.IsVerified,
            IsOnline = visible && presence.IsOnline(user.Id),
            LastActiveAt = visible ? presence.LastSeen(user.Id) ?? user.LastActiveAt : null
        };
    }

    /// <summary>
    /// Presence is symmetric. Switching your own activity status off hides everybody else's from you as
    /// well — otherwise the setting would let somebody watch without being watched.
    /// </summary>
    private static bool CanSeePresence(User viewer, User other) =>
        viewer.ShowActivityStatus && other.ShowActivityStatus;

    /// <summary>
    /// Why this person is in your inbox — the graph's answer, spelled out. Only shown on a thread you
    /// have not accepted, which is the only place somebody unconnected to you can appear.
    /// </summary>
    private async Task<ChatContext> ContextAsync(int viewerId, User other, CancellationToken ct)
    {
        var graph = await graphProvider.GetAsync(ct);

        var mutualIds = graph.MutualConnections(viewerId, other.Id);
        var previewIds = mutualIds.Take(3).ToList();

        var preview = previewIds.Count == 0
            ? []
            : await db.Users
                .AsNoTracking()
                .Where(u => previewIds.Contains(u.Id))
                .Select(u => new UserSummary
                {
                    Id = u.Id,
                    Username = u.Username,
                    FullName = u.FullName,
                    AvatarUrl = u.AvatarUrl,
                    IsPrivate = u.IsPrivate,
                    IsVerified = u.IsVerified
                })
                .ToListAsync(ct);

        var distance = graph.Distance(viewerId, other.Id);

        var summary = mutualIds.Count > 0
            ? $"Followed by {string.Join(", ", preview.Select(p => p.Username))}"
              + (mutualIds.Count > preview.Count ? $" + {mutualIds.Count - preview.Count} more" : string.Empty)
            : graph.IsFollowing(other.Id, viewerId)
                ? "Follows you"
                : distance > 0
                    ? $"{distance} hops away in your network"
                    : "Not connected to you";

        return new ChatContext
        {
            FollowsYou = graph.IsFollowing(other.Id, viewerId),
            IsFollowing = graph.IsFollowing(viewerId, other.Id),
            MutualCount = mutualIds.Count,
            Mutuals = preview,
            Distance = distance,
            FollowerCount = other.FollowerCount,
            Summary = summary
        };
    }
}
