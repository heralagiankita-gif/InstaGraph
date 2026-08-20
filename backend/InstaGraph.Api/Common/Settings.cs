namespace InstaGraph.Api.Common;

public class JwtSettings
{
    public const string SectionName = "Jwt";

    public string SecretKey { get; set; } = string.Empty;
    public string Issuer { get; set; } = string.Empty;
    public string Audience { get; set; } = string.Empty;
    public int DurationInMinutes { get; set; } = 480;
}

public class UploadSettings
{
    public const string SectionName = "Uploads";

    public string Folder { get; set; } = "uploads";
    public long MaxBytes { get; set; } = 8 * 1024 * 1024;
    public string[] AllowedExtensions { get; set; } = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

    /// <summary>
    /// Video gets its own list and its own ceiling. A separate limit rather than one raised for
    /// everything: a 40 MB photo is somebody's mistake, while a 40 MB clip is an ordinary reel.
    /// </summary>
    public string[] VideoExtensions { get; set; } = [".mp4", ".webm", ".mov", ".m4v"];

    public long MaxVideoBytes { get; set; } = 60 * 1024 * 1024;

    /// <summary>How many photos or clips one post may carry. Instagram's own limit.</summary>
    public int MaxMediaPerPost { get; set; } = 10;
}

/// <summary>
/// The knobs on the home feed. Exposed as configuration because the only way to understand what a
/// ranking weight does is to change it and look at the result.
/// </summary>
public class FeedSettings
{
    public const string SectionName = "Feed";

    /// <summary>How much the strength of your edge to the author counts.</summary>
    public double AffinityWeight { get; set; } = 3.0;

    /// <summary>How much likes and comments already on the post count.</summary>
    public double EngagementWeight { get; set; } = 1.0;

    /// <summary>How much being recent counts.</summary>
    public double RecencyWeight { get; set; } = 5.0;

    /// <summary>Hours after which a post's freshness score has halved.</summary>
    public double RecencyHalfLifeHours { get; set; } = 20.0;

    /// <summary>Share of the home feed reserved for posts from beyond the people you follow.</summary>
    public double SuggestedSlice { get; set; } = 0.25;

    /// <summary>
    /// Added to affinity for an account on your favourites list. Deliberately large: a favourite is the
    /// one signal in the whole ranking that the person stated out loud rather than the graph inferred, so
    /// it should outrank anything inferred about somebody they did not name.
    /// </summary>
    public double FavoriteBoost { get; set; } = 2.5;

    /// <summary>How long the in-memory copy of the follow graph may be reused before it is rebuilt.</summary>
    public int SnapshotCacheSeconds { get; set; } = 20;
}

/// <summary>
/// The knobs on the suggestion engine — one weight per graph signal.
/// <para>
/// These are deliberately configuration rather than constants. Every one of them expresses a judgement
/// about what a connection is worth, and the honest way to defend a judgement like that is to let somebody
/// move it and see the list change.
/// </para>
/// </summary>
public class GraphSettings
{
    public const string SectionName = "Graph";

    /// <summary>Two hops out, rare intermediaries counted for more. The most precise signal there is.</summary>
    public double AdamicAdarWeight { get; set; } = 1.0;

    /// <summary>The random walk with restart — sees past two hops, at the cost of some precision.</summary>
    public double PageRankWeight { get; set; } = 0.8;

    /// <summary>SALSA over your circle of trust: what the people you trust collectively endorse.</summary>
    public double CircleAuthorityWeight { get; set; } = 0.7;

    /// <summary>Overlap between your following list and theirs, as a ratio rather than a count.</summary>
    public double JaccardWeight { get; set; } = 0.5;

    /// <summary>They already follow you. Half the edge exists, so this is weighted heavily.</summary>
    public double ReciprocityWeight { get; set; } = 1.1;

    /// <summary>Label propagation put you in the same cluster.</summary>
    public double CommunityWeight { get; set; } = 0.35;

    /// <summary>Global PageRank, as a mild prior for accounts nothing personal reaches.</summary>
    public double PopularityWeight { get; set; } = 0.2;

    /// <summary>
    /// Subtracted in proportion to how famous an account is <em>in absolute terms</em>. Without it every
    /// list converges on the same few accounts.
    /// </summary>
    public double CelebrityPenalty { get; set; } = 0.3;

    /// <summary>
    /// The follower count at which an account counts as fully famous, and the damping reaches its full
    /// weight.
    /// <para>
    /// This exists because the alternative — measuring fame against the most-followed account in the
    /// candidate pool — means the damping has no idea what scale it is on. In a pool where the leader has
    /// a million followers that is right; in one where the leader has a single follower it treats them as
    /// a celebrity and penalises them for it. Since the penalty outweighs the popularity reward by
    /// design, that inverts the ordering on a young graph and pushes the emptiest accounts to the top.
    /// </para>
    /// </summary>
    public double CelebrityFollowers { get; set; } = 10000;

    /// <summary>How many accounts make up the circle of trust the SALSA pass runs over.</summary>
    public int CircleOfTrustSize { get; set; } = 50;

    /// <summary>Chance the walker teleports back to you at each step. Higher keeps suggestions closer.</summary>
    public double RestartProbability { get; set; } = 0.25;

    /// <summary>How many hops the walk is carried out to before the remaining mass is dropped.</summary>
    public int WalkDepth { get; set; } = 6;

    /// <summary>How many suggestions may arrive through the same intermediary.</summary>
    public int MaxPerIntermediary { get; set; } = 2;

    /// <summary>How deep the pool goes before the expensive similarity pass runs.</summary>
    public int CandidatePoolSize { get; set; } = 200;

    /// <summary>Accounts drawn in the network view. A picture of ten thousand nodes says nothing.</summary>
    public int NetworkNodeLimit { get; set; } = 90;

    /// <summary>
    /// How recently an account must have joined to be described as new, in days.
    /// <para>
    /// This is the one label the app applies to an account rather than to a relationship, so it is worth
    /// being able to move. A week is right for a busy site and far too short for a quiet one, where
    /// somebody who signed up a fortnight ago is still, in every sense that matters to a stranger
    /// deciding whether to follow them, new.
    /// </para>
    /// </summary>
    public int NewAccountDays { get; set; } = 7;

    /// <summary>
    /// The most followers an account may have and still be described as new.
    /// <para>
    /// Recency alone is not enough: an account that arrived yesterday and already has two hundred
    /// followers is not what anybody means by new, and saying so would read as an excuse rather than a
    /// description. The two conditions together are what make the label true.
    /// </para>
    /// </summary>
    public int NewAccountFollowers { get; set; } = 1;
}

/// <summary>
/// Where the sign-up code goes. With no <see cref="SmtpHost"/> the API writes the message to the log
/// instead of sending it, and says so rather than pretending otherwise.
/// </summary>
public class EmailSettings
{
    public const string SectionName = "Email";

    public string SmtpHost { get; set; } = string.Empty;
    public int SmtpPort { get; set; } = 587;
    public bool UseSsl { get; set; } = true;

    public string Username { get; set; } = string.Empty;
    public string Password { get; set; } = string.Empty;

    /// <summary>
    /// Set only for a relay that takes mail without credentials — a postfix on localhost, or a catcher
    /// like MailHog. Off by default, because the alternative is that a host typed in without a password
    /// yet makes the app claim it can deliver, stop showing the code on screen, and then fail on every
    /// send. That is the worst of the three possible states and it should not be reachable by accident.
    /// </summary>
    public bool AllowAnonymousRelay { get; set; }

    /// <summary>
    /// Who the mail says it is from. Left empty it follows <see cref="Username"/>, which is what Gmail
    /// and most providers insist on anyway — they reject a From header that is not the account that
    /// authenticated, with a 5.7.0 that reads like a permissions problem rather than a config one.
    /// </summary>
    public string FromAddress { get; set; } = string.Empty;

    public string FromName { get; set; } = "InstaGraph";

    /// <summary>How long a six-digit code stays usable.</summary>
    public int CodeLifetimeMinutes { get; set; } = 10;

    /// <summary>How long the proof-of-verification is good for, once the code has been accepted.</summary>
    public int TokenLifetimeMinutes { get; set; } = 30;

    /// <summary>Wrong guesses allowed before the code is burned and a new one has to be requested.</summary>
    public int MaxAttempts { get; set; } = 5;

    /// <summary>How many codes one address may be sent before it has to wait for the current one to expire.</summary>
    public int MaxSends { get; set; } = 5;

    /// <summary>The shortest gap between two sends to the same address.</summary>
    public int ResendCooldownSeconds { get; set; } = 30;
}
