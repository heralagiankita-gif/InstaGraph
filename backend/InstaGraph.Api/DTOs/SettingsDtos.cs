using System.ComponentModel.DataAnnotations;

namespace InstaGraph.Api.DTOs;

/// <summary>
/// Everything under Settings and activity, in one payload.
/// <para>
/// Almost none of these are content rules. <c>MessagesFrom</c>, <c>CommentsFrom</c>, close friends and
/// favourites are all statements about the follow edge — who may cross it, and which subset of it gets
/// treated differently — which is why they read so much like the privacy gate on a private account.
/// </para>
/// </summary>
public record SettingsResponse
{
    public bool IsPrivate { get; init; }

    /// <summary>Everyone, Following, Friends or NoOne.</summary>
    public string MessagesFrom { get; init; } = "Everyone";

    public string CommentsFrom { get; init; } = "Everyone";

    public bool ShowActivityStatus { get; init; }
    public bool ShowReadReceipts { get; init; }
    public bool HideLikeCounts { get; init; }

    /// <summary>Comma-separated. Trips a message request into Spam and refuses a comment.</summary>
    public string HiddenWords { get; init; } = string.Empty;

    public int CloseFriendCount { get; init; }
    public int FavoriteCount { get; init; }
    public int BlockedCount { get; init; }
    public int MutedCount { get; init; }
}

public record UpdateSettingsRequest
{
    public bool IsPrivate { get; init; }

    [Required]
    public string MessagesFrom { get; init; } = "Everyone";

    [Required]
    public string CommentsFrom { get; init; } = "Everyone";

    public bool ShowActivityStatus { get; init; } = true;
    public bool ShowReadReceipts { get; init; } = true;
    public bool HideLikeCounts { get; init; }

    [StringLength(600)]
    public string HiddenWords { get; init; } = string.Empty;
}

/// <summary>A person on one of your lists, with the edge that makes them eligible for it.</summary>
public record ListMember : UserRelation
{
    public bool OnList { get; init; }
}

/// <summary>Your activity, summarised — the numbers behind "Your activity" in the settings list.</summary>
public record ActivitySummary
{
    public int Posts { get; init; }
    public int LikesGiven { get; init; }
    public int CommentsWritten { get; init; }
    public int Saved { get; init; }
    public int MessagesSent { get; init; }
    public int Conversations { get; init; }

    public int Following { get; init; }
    public int Followers { get; init; }

    /// <summary>Accounts you follow who follow you back.</summary>
    public int Friends { get; init; }

    public DateTime JoinedAt { get; init; }
}
