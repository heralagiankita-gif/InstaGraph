using System.ComponentModel.DataAnnotations;

namespace InstaGraph.Api.DTOs;

/// <summary>A person in a chat: the usual summary plus whether they are around right now.</summary>
public record ChatParticipant : UserSummary
{
    /// <summary>
    /// Active in the last minute — and willing to say so. Somebody who turned activity status off is
    /// never online to anybody, and never sees anybody else's either.
    /// </summary>
    public bool IsOnline { get; init; }

    /// <summary>Null when either side has activity status switched off.</summary>
    public DateTime? LastActiveAt { get; init; }
}

/// <summary>One row of the inbox.</summary>
public record ConversationSummary
{
    public int Id { get; init; }

    public bool IsGroup { get; init; }

    /// <summary>The group's name, or the other person's — whatever goes in bold on the row.</summary>
    public string Title { get; init; } = string.Empty;

    /// <summary>Everybody except you. One person on a normal chat, several on a group.</summary>
    public IReadOnlyList<ChatParticipant> Participants { get; init; } = [];

    /// <summary>The last thing said, already flattened to "You: sent a photo" and the like.</summary>
    public string Preview { get; init; } = string.Empty;

    public DateTime? LastMessageAt { get; init; }

    /// <summary>How many messages arrived after this member last read the thread.</summary>
    public int UnreadCount { get; init; }

    /// <summary>The last message was yours and the other side has read it.</summary>
    public bool LastMessageSeen { get; init; }

    /// <summary>The last message was yours. Drives "Seen" versus a bold unread row.</summary>
    public bool LastMessageMine { get; init; }

    public bool IsMuted { get; init; }
    public bool IsPinned { get; init; }

    /// <summary>Inbox, Requests or Spam — which folder this thread is in for you.</summary>
    public string State { get; init; } = "Accepted";

    /// <summary>Somebody in this thread is typing right now.</summary>
    public bool IsTyping { get; init; }

    /// <summary>Their live note, if they have written one and you are allowed to see it.</summary>
    public string? Note { get; init; }
}

/// <summary>One emoji and everybody who sent it.</summary>
public record ReactionSummary
{
    public string Emoji { get; init; } = string.Empty;
    public int Count { get; init; }

    /// <summary>You are one of them, so the client can draw it as selected.</summary>
    public bool Mine { get; init; }

    public IReadOnlyList<UserSummary> Users { get; init; } = [];
}

public record MessageResponse
{
    public int Id { get; init; }
    public int ConversationId { get; init; }

    public UserSummary Sender { get; init; } = new();

    /// <summary>Text, Image, PostShare, ProfileShare, Heart or System.</summary>
    public string Kind { get; init; } = "Text";

    public string Text { get; init; } = string.Empty;
    public string? ImageUrl { get; init; }

    /// <summary>The shared photo, ready to render as a card. Null if it has since been deleted.</summary>
    public PostResponse? SharedPost { get; init; }

    public UserSummary? SharedUser { get; init; }

    /// <summary>The story this answers, or null once it has expired. The text survives either way.</summary>
    public StoryResponse? SharedStory { get; init; }

    /// <summary>The message this one answers, flattened to a single quoted line.</summary>
    public MessageQuote? ReplyTo { get; init; }

    public bool IsMine { get; init; }
    public bool IsUnsent { get; init; }

    public DateTime CreatedAt { get; init; }

    public IReadOnlyList<ReactionSummary> Reactions { get; init; } = [];
}

/// <summary>The one-line version of a message, for the bar above a reply.</summary>
public record MessageQuote
{
    public int Id { get; init; }
    public string Author { get; init; } = string.Empty;
    public string Preview { get; init; } = string.Empty;
    public bool IsUnsent { get; init; }
}

/// <summary>Everything a thread screen needs on open.</summary>
public record ConversationDetail
{
    public int Id { get; init; }
    public bool IsGroup { get; init; }
    public string Title { get; init; } = string.Empty;

    public IReadOnlyList<ChatParticipant> Participants { get; init; } = [];

    /// <summary>Oldest first, so the client can append without reversing.</summary>
    public IReadOnlyList<MessageResponse> Messages { get; init; } = [];

    /// <summary>There is older history above this page.</summary>
    public bool HasMore { get; init; }

    /// <summary>Requests and Spam get an accept/delete bar instead of a composer.</summary>
    public string State { get; init; } = "Accepted";

    public bool IsMuted { get; init; }
    public bool IsPinned { get; init; }

    /// <summary>Names of anybody typing right now.</summary>
    public IReadOnlyList<string> TypingUsernames { get; init; } = [];

    /// <summary>The id of your newest message that the other side has read, or null.</summary>
    public int? SeenUpToMessageId { get; init; }

    /// <summary>
    /// How you two stand: how many follow each other, whether they follow you, the distance through the
    /// graph. The header of a request uses it to say why this person is in your inbox at all.
    /// </summary>
    public ChatContext? Context { get; init; }
}

/// <summary>
/// The graph answer to "who is this?", shown at the top of a thread you have not accepted yet.
/// <para>
/// A message request is the one place in the app where somebody with no edge to you can reach you, so it
/// is the one place that has to explain the connection instead of assuming it.
/// </para>
/// </summary>
public record ChatContext
{
    public bool FollowsYou { get; init; }
    public bool IsFollowing { get; init; }
    public int MutualCount { get; init; }
    public IReadOnlyList<UserSummary> Mutuals { get; init; } = [];

    /// <summary>Hops along the shortest route, or -1 when nothing links you.</summary>
    public int Distance { get; init; }

    public int FollowerCount { get; init; }

    /// <summary>"Followed by nila and 2 others" or "Not connected to you".</summary>
    public string Summary { get; init; } = string.Empty;
}

public record SendMessageRequest
{
    [StringLength(2000)]
    public string Text { get; init; } = string.Empty;

    /// <summary>Share a photo into the chat.</summary>
    public int? SharedPostId { get; init; }

    /// <summary>Share an account into the chat.</summary>
    public string? SharedUsername { get; init; }

    /// <summary>Answers a story. Set by the story screen; the bubble shows what it answers.</summary>
    public int? SharedStoryId { get; init; }

    /// <summary>Answers an earlier message in the same thread.</summary>
    public int? ReplyToMessageId { get; init; }

    /// <summary>The heart button rather than typed text.</summary>
    public bool IsHeart { get; init; }
}

/// <summary>Opens a chat with one person or several, without sending anything yet.</summary>
public record StartConversationRequest
{
    [Required, MinLength(1)]
    public IReadOnlyList<string> Usernames { get; init; } = [];

    /// <summary>Optional name for a group.</summary>
    [StringLength(80)]
    public string? Title { get; init; }
}

public record ReactRequest
{
    /// <summary>The emoji to leave, or empty to take yours back.</summary>
    [StringLength(16)]
    public string Emoji { get; init; } = "❤️";
}

/// <summary>The badge on the sidebar, and whether anything is waiting under Requests.</summary>
public record InboxCounts
{
    public int Unread { get; init; }
    public int Requests { get; init; }
}

/// <summary>A note above the inbox — one line, gone in a day.</summary>
public record NoteResponse
{
    public UserSummary User { get; init; } = new();
    public string Text { get; init; } = string.Empty;
    public bool CloseFriendsOnly { get; init; }
    public bool IsMine { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime ExpiresAt { get; init; }
}

public record WriteNoteRequest
{
    [Required, StringLength(60, MinimumLength = 1)]
    public string Text { get; init; } = string.Empty;

    public bool CloseFriendsOnly { get; init; }
}

/// <summary>
/// Somebody worth starting a chat with, and the reason they are on the list.
/// <para>
/// The order is not alphabetical and not "most recent": it is the interaction weight on the edge between
/// you, then whether the edge runs both ways, then everything the suggestion engine already knows. The
/// people you actually talk to rise to the top on their own.
/// </para>
/// </summary>
public record ChatCandidate : UserRelation
{
    /// <summary>"You follow each other", "Followed by nila + 2 more", "Not connected".</summary>
    public string Reason { get; init; } = string.Empty;

    public bool HasThread { get; init; }
    public int ConversationId { get; init; }
    public bool IsOnline { get; init; }
}
