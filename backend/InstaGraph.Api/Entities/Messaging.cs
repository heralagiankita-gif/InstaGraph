namespace InstaGraph.Api.Entities;

/// <summary>
/// A thread. One row per conversation, whether it holds two people or twenty.
/// <para>
/// Messaging is a second graph laid over the follow graph, and it is a different kind of graph: the
/// follow edge is directed, unweighted and permanent, while a conversation is undirected, weighted by how
/// much traffic runs along it, and can exist between two accounts that follow each other in neither
/// direction. Keeping it in its own tables rather than hanging it off <see cref="Follow"/> is what makes
/// that difference visible — and what lets a message arrive from somebody who is not connected to you at
/// all, which is exactly what a message request is.
/// </para>
/// </summary>
public class Conversation
{
    public int Id { get; set; }

    /// <summary>Three or more people. A group has a title and cannot be deduplicated by its members.</summary>
    public bool IsGroup { get; set; }

    /// <summary>Only groups carry one; a one-to-one thread is named after whoever you are talking to.</summary>
    public string? Title { get; set; }

    /// <summary>
    /// For a one-to-one thread: the two account ids, smaller first, as <c>"3:17"</c>. Unique, so opening
    /// the same chat twice can never produce two threads. Null on a group, because two groups with the
    /// same members are legitimately two different groups.
    /// </summary>
    public string? PairKey { get; set; }

    public int CreatedById { get; set; }
    public User CreatedBy { get; set; } = null!;

    /// <summary>Denormalised so the inbox can be ordered without touching the message table.</summary>
    public DateTime LastMessageAt { get; set; } = DateTime.UtcNow;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ConversationMember> Members { get; set; } = new List<ConversationMember>();
    public ICollection<Message> Messages { get; set; } = new List<Message>();
}

/// <summary>Which folder of the inbox this thread sits in, for one particular member.</summary>
public enum MemberState
{
    /// <summary>In the inbox proper.</summary>
    Accepted = 0,

    /// <summary>Under Requests — somebody you do not follow started it.</summary>
    Pending = 1,

    /// <summary>Under Spam — a request that tripped a hidden word, or one you marked yourself.</summary>
    Spam = 2
}

/// <summary>
/// One person's membership of one thread, and everything that is true of the thread only for them: which
/// folder it is in, how far they have read, whether they muted or pinned it, and when they last cleared it.
/// <para>
/// All of that is per-member on purpose. A message request is pending for the person who received it and
/// perfectly ordinary for the person who sent it; deleting a chat empties your copy and leaves theirs
/// standing. Storing any of it on the conversation would make one person's action change what somebody
/// else sees.
/// </para>
/// </summary>
public class ConversationMember
{
    public int Id { get; set; }

    public int ConversationId { get; set; }
    public Conversation Conversation { get; set; } = null!;

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public MemberState State { get; set; } = MemberState.Accepted;

    /// <summary>Everything sent up to here has been seen. Drives both the badge and the "Seen" line.</summary>
    public DateTime? LastReadAt { get; set; }

    public int? LastReadMessageId { get; set; }

    /// <summary>Muted threads still arrive, they just stop counting towards the badge.</summary>
    public bool IsMuted { get; set; }

    public bool IsPinned { get; set; }

    /// <summary>
    /// Deleting a chat hides it until the next message arrives, rather than destroying anything the other
    /// side can still see.
    /// </summary>
    public bool IsHidden { get; set; }

    /// <summary>Messages older than this are not shown to this member — the rest of the delete.</summary>
    public DateTime? ClearedAt { get; set; }

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Set when somebody leaves a group. The row stays so their old messages keep an author.</summary>
    public DateTime? LeftAt { get; set; }
}

public enum MessageKind
{
    Text = 0,

    /// <summary>A photo sent straight into the chat.</summary>
    Image = 1,

    /// <summary>A post shared into the chat — it renders as a card that opens the photo.</summary>
    PostShare = 2,

    /// <summary>An account shared into the chat.</summary>
    ProfileShare = 3,

    /// <summary>The heart button. Its own kind so it can be drawn large and without a bubble.</summary>
    Heart = 4,

    /// <summary>"nila added ravi", "ravi left" — written by the server, attributed to nobody.</summary>
    System = 5,

    /// <summary>An answer to somebody's story. Carries the story so the bubble can show what it answers.</summary>
    StoryReply = 6
}

public class Message
{
    public int Id { get; set; }

    public int ConversationId { get; set; }
    public Conversation Conversation { get; set; } = null!;

    public int SenderId { get; set; }
    public User Sender { get; set; } = null!;

    public MessageKind Kind { get; set; } = MessageKind.Text;

    public string Text { get; set; } = string.Empty;

    /// <summary>Set on <see cref="MessageKind.Image"/> — the same upload pipeline a post uses.</summary>
    public string? ImageUrl { get; set; }

    /// <summary>Set on <see cref="MessageKind.PostShare"/>.</summary>
    public int? SharedPostId { get; set; }

    public Post? SharedPost { get; set; }

    /// <summary>Set on <see cref="MessageKind.ProfileShare"/>.</summary>
    public int? SharedUserId { get; set; }

    public User? SharedUser { get; set; }

    /// <summary>Set on <see cref="MessageKind.StoryReply"/>. Null once the story has expired and been swept.</summary>
    public int? SharedStoryId { get; set; }

    public Story? SharedStory { get; set; }

    /// <summary>The message this one answers. Self-referencing, one level, like a comment reply.</summary>
    public int? ReplyToMessageId { get; set; }

    public Message? ReplyToMessage { get; set; }

    /// <summary>
    /// Unsent. The row survives so replies and reactions pointing at it still resolve; the text is
    /// cleared and every recipient sees "This message was unsent" instead.
    /// </summary>
    public bool IsUnsent { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<MessageReaction> Reactions { get; set; } = new List<MessageReaction>();
}

/// <summary>One emoji from one person on one message. Double-tapping sends a heart.</summary>
public class MessageReaction
{
    public int Id { get; set; }

    public int MessageId { get; set; }
    public Message Message { get; set; } = null!;

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public string Emoji { get; set; } = "❤️";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
