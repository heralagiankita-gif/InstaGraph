namespace InstaGraph.Api.Entities;

/// <summary>
/// Who is allowed to do something to you. Every one of these is a rule about the follow edge rather than
/// about content: "everyone" ignores the graph, "following" asks for an edge from you to them,
/// "friends" asks for the edge to run both ways, and "no one" refuses regardless.
/// </summary>
public enum Audience
{
    Everyone = 0,

    /// <summary>Only accounts you follow.</summary>
    Following = 1,

    /// <summary>Only accounts you follow who follow you back.</summary>
    Friends = 2,

    NoOne = 3
}

/// <summary>
/// An account. In graph terms this is a node; everything in <see cref="Follow"/> is an edge between two
/// of them. Nothing in the API ever says so.
/// </summary>
public class User
{
    public int Id { get; set; }

    public string Username { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;

    /// <summary>
    /// True for every account created through the code flow, which is all of them from now on. It is
    /// stored rather than assumed so that the accounts predating email confirmation are distinguishable
    /// from the ones that went through it.
    /// </summary>
    public bool EmailConfirmed { get; set; }

    /// <summary>
    /// Collected at sign-up and used for one thing: the minimum age. Never shown on a profile, and not
    /// in <see cref="Services.Mapper"/>'s output at all.
    /// </summary>
    public DateOnly? DateOfBirth { get; set; }

    public string FullName { get; set; } = string.Empty;
    public string Bio { get; set; } = string.Empty;

    /// <summary>Relative path such as <c>/uploads/abc.jpg</c>, or null for the generated initial avatar.</summary>
    public string? AvatarUrl { get; set; }

    public bool IsPrivate { get; set; }
    public bool IsActive { get; set; } = true;

    /// <summary>
    /// The blue tick. Set by an administrator against the database rather than by anything in the API — a
    /// badge an account can award itself is not a badge.
    /// </summary>
    public bool IsVerified { get; set; }

    /// <summary>
    /// Denormalised degrees. Kept in the same transaction as the edge that moves them so a profile never
    /// has to count rows to render a header.
    /// </summary>
    public int FollowerCount { get; set; }

    public int FollowingCount { get; set; }
    public int PostCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// When the password was last changed, or null for an account still on the one it signed up with.
    ///
    /// <para>
    /// Every token issued before this moment is refused, which is what makes changing a password end the
    /// sessions somebody else was holding rather than only the one in front of you. See
    /// <see cref="Services.ISessionRevocations"/> — this column is the durable copy of what that keeps in
    /// memory, so a restart does not hand those sessions back.
    /// </para>
    /// </summary>
    public DateTime? PasswordChangedAt { get; set; }

    // ------------------------------------------------------------------ settings

    /// <summary>
    /// Who may open a chat with you. This is the message request gate: anybody outside the audience you
    /// picked cannot start a thread at all, and anybody inside it who is not already connected to you
    /// lands in Requests rather than the inbox.
    /// </summary>
    public Audience MessagesFrom { get; set; } = Audience.Everyone;

    /// <summary>Who may comment on your photos.</summary>
    public Audience CommentsFrom { get; set; } = Audience.Everyone;

    /// <summary>
    /// Off hides the green dot and "Active now" from everybody — and, because it would otherwise be a
    /// one-way mirror, hides theirs from you as well.
    /// </summary>
    public bool ShowActivityStatus { get; set; } = true;

    /// <summary>Off stops "Seen" appearing under the messages you have read. Symmetric, for the same reason.</summary>
    public bool ShowReadReceipts { get; set; } = true;

    /// <summary>Hides the number under a like on every post you see. Yours are still counted.</summary>
    public bool HideLikeCounts { get; set; }

    /// <summary>
    /// Comma-separated words. A message request containing one goes straight to Spam and a comment
    /// containing one is refused. Nobody is told which word they tripped.
    /// </summary>
    public string HiddenWords { get; set; } = string.Empty;

    /// <summary>Last authenticated request. Powers the green dot, subject to <see cref="ShowActivityStatus"/>.</summary>
    public DateTime? LastActiveAt { get; set; }

    public ICollection<Post> Posts { get; set; } = new List<Post>();
    public ICollection<Follow> Following { get; set; } = new List<Follow>();
    public ICollection<Follow> Followers { get; set; } = new List<Follow>();
    public ICollection<PostLike> Likes { get; set; } = new List<PostLike>();
    public ICollection<Comment> Comments { get; set; } = new List<Comment>();
}
