namespace InstaGraph.Api.Entities;

public class Hashtag
{
    public int Id { get; set; }

    /// <summary>Stored lower-case and without the leading '#'.</summary>
    public string Tag { get; set; } = string.Empty;

    public int PostCount { get; set; }

    public ICollection<PostHashtag> Posts { get; set; } = new List<PostHashtag>();
}

/// <summary>Join row for the many-to-many between posts and tags.</summary>
public class PostHashtag
{
    public int PostId { get; set; }
    public Post Post { get; set; } = null!;

    public int HashtagId { get; set; }
    public Hashtag Hashtag { get; set; } = null!;
}
