using InstaGraph.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Post> Posts => Set<Post>();
    public DbSet<PostLike> PostLikes => Set<PostLike>();
    public DbSet<SavedPost> SavedPosts => Set<SavedPost>();
    public DbSet<Comment> Comments => Set<Comment>();
    public DbSet<Follow> Follows => Set<Follow>();
    public DbSet<Block> Blocks => Set<Block>();
    public DbSet<Mute> Mutes => Set<Mute>();
    public DbSet<CommentLike> CommentLikes => Set<CommentLike>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<Hashtag> Hashtags => Set<Hashtag>();
    public DbSet<PostHashtag> PostHashtags => Set<PostHashtag>();
    public DbSet<PostMedia> PostMedia => Set<PostMedia>();
    public DbSet<PostTag> PostTags => Set<PostTag>();
    public DbSet<PostView> PostViews => Set<PostView>();
    public DbSet<Collection> Collections => Set<Collection>();

    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ConversationMember> ConversationMembers => Set<ConversationMember>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<MessageReaction> MessageReactions => Set<MessageReaction>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<UserListEntry> UserListEntries => Set<UserListEntry>();
    public DbSet<Story> Stories => Set<Story>();
    public DbSet<StoryView> StoryViews => Set<StoryView>();
    public DbSet<Highlight> Highlights => Set<Highlight>();
    public DbSet<HighlightStory> HighlightStories => Set<HighlightStory>();
    public DbSet<EmailVerification> EmailVerifications => Set<EmailVerification>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        // ------------------------------------------------------------------ user
        b.Entity<User>(e =>
        {
            e.Property(u => u.Username).HasMaxLength(30).IsRequired();
            e.Property(u => u.Email).HasMaxLength(160).IsRequired();
            e.Property(u => u.PasswordHash).HasMaxLength(200).IsRequired();
            e.Property(u => u.FullName).HasMaxLength(80);
            e.Property(u => u.Bio).HasMaxLength(300);
            e.Property(u => u.AvatarUrl).HasMaxLength(400);
            e.Property(u => u.HiddenWords).HasMaxLength(600);

            e.HasIndex(u => u.Username).IsUnique();
            e.HasIndex(u => u.Email).IsUnique();
        });

        // ---------------------------------------------------- email confirmation
        b.Entity<EmailVerification>(e =>
        {
            e.Property(v => v.Email).HasMaxLength(160).IsRequired();
            e.Property(v => v.CodeHash).HasMaxLength(64).IsRequired();
            e.Property(v => v.VerificationToken).HasMaxLength(64);

            // Every read is "the newest unconsumed row for this address, for this purpose", so that is
            // the index. Purpose is in the key rather than filtered afterwards because a sign-up code and
            // a reset code for the same address are live at the same time often enough to matter.
            e.HasIndex(v => new { v.Email, v.Purpose, v.ConsumedAt });

            // Register looks the row up by token alone; unique so a token cannot collide into somebody
            // else's pending sign-up.
            e.HasIndex(v => v.VerificationToken).IsUnique().HasFilter("[VerificationToken] IS NOT NULL");
        });

        // ------------------------------------------------------------------ post
        b.Entity<Post>(e =>
        {
            e.Property(p => p.Caption).HasMaxLength(2200);
            e.Property(p => p.ImageUrl).HasMaxLength(400).IsRequired();
            e.Property(p => p.Location).HasMaxLength(120);

            e.HasOne(p => p.Author)
                .WithMany(u => u.Posts)
                .HasForeignKey(p => p.AuthorId)
                .OnDelete(DeleteBehavior.Restrict);

            // The feed always reads an author's posts newest first.
            e.HasIndex(p => new { p.AuthorId, p.CreatedAt });
            e.HasIndex(p => p.CreatedAt);

            // Reels are their own surface, drawn from every video in the app newest first, so they get
            // their own index rather than a scan of the post table with a filter on the end.
            e.HasIndex(p => new { p.IsReel, p.CreatedAt });
        });

        // ----------------------------------------------------------- post media
        b.Entity<PostMedia>(e =>
        {
            e.Property(m => m.Url).HasMaxLength(400).IsRequired();
            e.Property(m => m.PosterUrl).HasMaxLength(400);

            e.HasOne(m => m.Post)
                .WithMany(p => p.Media)
                .HasForeignKey(m => m.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            // A carousel is an ordered list, so two items may not claim the same place in it. Enforced
            // here rather than in code: the order is the only thing that makes it a carousel and not a bag.
            e.HasIndex(m => new { m.PostId, m.Position }).IsUnique();
        });

        // ------------------------------------------------------------- post tag
        b.Entity<PostTag>(e =>
        {
            e.HasOne(t => t.Post)
                .WithMany(p => p.Tags)
                .HasForeignKey(t => t.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(t => t.User)
                .WithMany()
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            // Naming somebody twice on the same photo is naming them once.
            e.HasIndex(t => new { t.PostId, t.UserId }).IsUnique();

            // "Photos of this person" — the whole of the Tagged tab is this index.
            e.HasIndex(t => t.UserId);
        });

        // ------------------------------------------------------------ post view
        b.Entity<PostView>(e =>
        {
            e.HasOne(v => v.Post)
                .WithMany()
                .HasForeignKey(v => v.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(v => v.Viewer)
                .WithMany()
                .HasForeignKey(v => v.ViewerId)
                .OnDelete(DeleteBehavior.Restrict);

            // Watching something twice is still watching it once.
            e.HasIndex(v => new { v.PostId, v.ViewerId }).IsUnique();
        });

        // ------------------------------------------------------------------ like
        b.Entity<PostLike>(e =>
        {
            e.HasOne(l => l.Post)
                .WithMany(p => p.Likes)
                .HasForeignKey(l => l.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(l => l.User)
                .WithMany(u => u.Likes)
                .HasForeignKey(l => l.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            // One like per person per photo, enforced by the database rather than by a check in code.
            e.HasIndex(l => new { l.PostId, l.UserId }).IsUnique();
        });

        // ----------------------------------------------------------------- save
        b.Entity<SavedPost>(e =>
        {
            e.HasOne(s => s.Post)
                .WithMany()
                .HasForeignKey(s => s.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(s => s.User)
                .WithMany()
                .HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(s => new { s.PostId, s.UserId }).IsUnique();

            // The saved tab reads one person's bookmarks newest first.
            e.HasIndex(s => new { s.UserId, s.CreatedAt });

            // Deleting a folder unfiles what was in it. It does not unsave any of it — the bookmark and
            // the filing are two different decisions, and only one of them was being undone.
            e.HasOne(s => s.Collection)
                .WithMany()
                .HasForeignKey(s => s.CollectionId)
                .OnDelete(DeleteBehavior.SetNull);

            e.HasIndex(s => new { s.UserId, s.CollectionId });
        });

        // ------------------------------------------------------------ collection
        b.Entity<Collection>(e =>
        {
            e.Property(c => c.Name).HasMaxLength(60).IsRequired();
            e.Property(c => c.CoverUrl).HasMaxLength(400);

            e.HasOne(c => c.Owner)
                .WithMany()
                .HasForeignKey(c => c.OwnerId)
                .OnDelete(DeleteBehavior.Restrict);

            // One folder of a given name per person; two called "Recipes" is a mistake, not a feature.
            e.HasIndex(c => new { c.OwnerId, c.Name }).IsUnique();
        });

        // --------------------------------------------------------------- comment
        b.Entity<Comment>(e =>
        {
            e.Property(c => c.Text).HasMaxLength(1000).IsRequired();

            e.HasOne(c => c.Post)
                .WithMany(p => p.Comments)
                .HasForeignKey(c => c.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(c => c.Author)
                .WithMany(u => u.Comments)
                .HasForeignKey(c => c.AuthorId)
                .OnDelete(DeleteBehavior.Restrict);

            // A comment can answer another comment. Restrict rather than cascade: SQL Server refuses a
            // cascade on a self-reference, so replies are removed explicitly by the service.
            e.HasOne(c => c.Parent)
                .WithMany(c => c.Replies)
                .HasForeignKey(c => c.ParentId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(c => new { c.PostId, c.CreatedAt });
            e.HasIndex(c => c.ParentId);
        });

        // ---------------------------------------------------------------- follow
        b.Entity<Follow>(e =>
        {
            e.HasOne(f => f.Follower)
                .WithMany(u => u.Following)
                .HasForeignKey(f => f.FollowerId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasOne(f => f.Followee)
                .WithMany(u => u.Followers)
                .HasForeignKey(f => f.FolloweeId)
                .OnDelete(DeleteBehavior.Restrict);

            // The edge is directed, so the pair is unique in the order (from, to) and not as a set.
            e.HasIndex(f => new { f.FollowerId, f.FolloweeId }).IsUnique();

            // Both directions get an index: "who do I follow" and "who follows me" are different scans.
            e.HasIndex(f => f.FolloweeId);

            // No self-loops. A node cannot be its own neighbour.
            e.ToTable(t => t.HasCheckConstraint("CK_Follow_NoSelfEdge", "[FollowerId] <> [FolloweeId]"));
        });

        // ------------------------------------------------------ block and mute
        b.Entity<Block>(e =>
        {
            e.HasOne(x => x.Blocker)
                .WithMany()
                .HasForeignKey(x => x.BlockerId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasOne(x => x.Blocked)
                .WithMany()
                .HasForeignKey(x => x.BlockedId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(x => new { x.BlockerId, x.BlockedId }).IsUnique();

            // The filter is applied from both ends, so the reverse lookup needs an index too.
            e.HasIndex(x => x.BlockedId);

            e.ToTable(t => t.HasCheckConstraint("CK_Block_NotSelf", "[BlockerId] <> [BlockedId]"));
        });

        b.Entity<Mute>(e =>
        {
            e.HasOne(x => x.Muter)
                .WithMany()
                .HasForeignKey(x => x.MuterId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasOne(x => x.Muted)
                .WithMany()
                .HasForeignKey(x => x.MutedId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(x => new { x.MuterId, x.MutedId }).IsUnique();

            e.ToTable(t => t.HasCheckConstraint("CK_Mute_NotSelf", "[MuterId] <> [MutedId]"));
        });

        b.Entity<CommentLike>(e =>
        {
            e.HasOne(l => l.Comment)
                .WithMany()
                .HasForeignKey(l => l.CommentId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(l => l.User)
                .WithMany()
                .HasForeignKey(l => l.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(l => new { l.CommentId, l.UserId }).IsUnique();
        });

        // ---------------------------------------------------------- notification
        b.Entity<Notification>(e =>
        {
            e.HasOne(n => n.Recipient)
                .WithMany()
                .HasForeignKey(n => n.RecipientId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasOne(n => n.Actor)
                .WithMany()
                .HasForeignKey(n => n.ActorId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasOne(n => n.Post)
                .WithMany()
                .HasForeignKey(n => n.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(n => new { n.RecipientId, n.CreatedAt });
        });

        // --------------------------------------------------------------- hashtag
        b.Entity<Hashtag>(e =>
        {
            e.Property(h => h.Tag).HasMaxLength(60).IsRequired();
            e.HasIndex(h => h.Tag).IsUnique();
        });

        b.Entity<PostHashtag>(e =>
        {
            e.HasKey(ph => new { ph.PostId, ph.HashtagId });

            e.HasOne(ph => ph.Post)
                .WithMany(p => p.Hashtags)
                .HasForeignKey(ph => ph.PostId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(ph => ph.Hashtag)
                .WithMany(h => h.Posts)
                .HasForeignKey(ph => ph.HashtagId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        // ---------------------------------------------------------- conversation
        b.Entity<Conversation>(e =>
        {
            e.Property(c => c.Title).HasMaxLength(80);
            e.Property(c => c.PairKey).HasMaxLength(40);

            e.HasOne(c => c.CreatedBy)
                .WithMany()
                .HasForeignKey(c => c.CreatedById)
                .OnDelete(DeleteBehavior.Restrict);

            // Opening the same one-to-one chat twice must land on the same thread, so the pair of ids is
            // unique. Filtered, because every group leaves it null and SQL Server would otherwise treat
            // all those nulls as duplicates of each other.
            e.HasIndex(c => c.PairKey)
                .IsUnique()
                .HasFilter("[PairKey] IS NOT NULL");

            // The inbox is "my threads, newest first" — that is this index, read backwards.
            e.HasIndex(c => c.LastMessageAt);
        });

        b.Entity<ConversationMember>(e =>
        {
            e.HasOne(m => m.Conversation)
                .WithMany(c => c.Members)
                .HasForeignKey(m => m.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(m => m.User)
                .WithMany()
                .HasForeignKey(m => m.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            // One membership per person per thread.
            e.HasIndex(m => new { m.ConversationId, m.UserId }).IsUnique();

            // "Everything in my inbox, in this folder" — the query behind every tab.
            e.HasIndex(m => new { m.UserId, m.State });
        });

        // -------------------------------------------------------------- message
        b.Entity<Message>(e =>
        {
            e.Property(m => m.Text).HasMaxLength(2000);
            e.Property(m => m.ImageUrl).HasMaxLength(400);

            e.HasOne(m => m.Conversation)
                .WithMany(c => c.Messages)
                .HasForeignKey(m => m.ConversationId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(m => m.Sender)
                .WithMany()
                .HasForeignKey(m => m.SenderId)
                .OnDelete(DeleteBehavior.Restrict);

            // A shared post keeps working after the sender deletes it from their own grid, so the delete
            // path clears these explicitly rather than cascading.
            e.HasOne(m => m.SharedPost)
                .WithMany()
                .HasForeignKey(m => m.SharedPostId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasOne(m => m.SharedUser)
                .WithMany()
                .HasForeignKey(m => m.SharedUserId)
                .OnDelete(DeleteBehavior.Restrict);

            // A story reply outlives the story it answers: the reference is cleared when the story is
            // swept, and the bubble falls back to plain text rather than disappearing from the thread.
            e.HasOne(m => m.SharedStory)
                .WithMany()
                .HasForeignKey(m => m.SharedStoryId)
                .OnDelete(DeleteBehavior.SetNull);

            // Self-referencing, exactly like a comment reply: SQL Server will not cascade one, so an
            // unsend keeps the row and empties it instead of deleting it out from under the answer.
            e.HasOne(m => m.ReplyToMessage)
                .WithMany()
                .HasForeignKey(m => m.ReplyToMessageId)
                .OnDelete(DeleteBehavior.Restrict);

            // A thread is read newest-first and paged backwards; this is that scan.
            e.HasIndex(m => new { m.ConversationId, m.Id });
        });

        b.Entity<MessageReaction>(e =>
        {
            e.Property(r => r.Emoji).HasMaxLength(16).IsRequired();

            e.HasOne(r => r.Message)
                .WithMany(m => m.Reactions)
                .HasForeignKey(r => r.MessageId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(r => r.User)
                .WithMany()
                .HasForeignKey(r => r.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            // One reaction per person per message — sending a second one replaces the first.
            e.HasIndex(r => new { r.MessageId, r.UserId }).IsUnique();
        });

        // ----------------------------------------------------------------- note
        b.Entity<Note>(e =>
        {
            e.Property(n => n.Text).HasMaxLength(60).IsRequired();

            e.HasOne(n => n.User)
                .WithMany()
                .HasForeignKey(n => n.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            // One live note per account: writing a new one replaces the old.
            e.HasIndex(n => n.UserId).IsUnique();
        });

        // ------------------------------------------------- close friends / favourites
        b.Entity<UserListEntry>(e =>
        {
            e.HasOne(x => x.Owner)
                .WithMany()
                .HasForeignKey(x => x.OwnerId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasOne(x => x.User)
                .WithMany()
                .HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(x => new { x.OwnerId, x.Kind, x.UserId }).IsUnique();

            e.ToTable(t => t.HasCheckConstraint("CK_UserList_NotSelf", "[OwnerId] <> [UserId]"));
        });

        // ---------------------------------------------------------------- story
        b.Entity<Story>(e =>
        {
            e.Property(s => s.ImageUrl).HasMaxLength(400).IsRequired();
            e.Property(s => s.Caption).HasMaxLength(300);

            e.HasOne(s => s.Author)
                .WithMany()
                .HasForeignKey(s => s.AuthorId)
                .OnDelete(DeleteBehavior.Restrict);

            // The tray asks "whose stories are still alive, newest first" for a set of accounts.
            e.HasIndex(s => new { s.AuthorId, s.ExpiresAt });
            e.HasIndex(s => s.ExpiresAt);
        });

        b.Entity<StoryView>(e =>
        {
            e.HasOne(v => v.Story)
                .WithMany(s => s.Views)
                .HasForeignKey(v => v.StoryId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasOne(v => v.Viewer)
                .WithMany()
                .HasForeignKey(v => v.ViewerId)
                .OnDelete(DeleteBehavior.Restrict);

            // Seeing something twice is still seeing it once.
            e.HasIndex(v => new { v.StoryId, v.ViewerId }).IsUnique();

            // "Which of these have I already seen" — the question the ring is drawn from.
            e.HasIndex(v => v.ViewerId);
        });

        // ------------------------------------------------------------- highlight
        b.Entity<Highlight>(e =>
        {
            e.Property(h => h.Title).HasMaxLength(40).IsRequired();
            e.Property(h => h.CoverUrl).HasMaxLength(400);

            e.HasOne(h => h.Owner)
                .WithMany()
                .HasForeignKey(h => h.OwnerId)
                .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(h => new { h.OwnerId, h.CreatedAt });
        });

        b.Entity<HighlightStory>(e =>
        {
            e.HasOne(x => x.Highlight)
                .WithMany(h => h.Stories)
                .HasForeignKey(x => x.HighlightId)
                .OnDelete(DeleteBehavior.Cascade);

            // A highlight is a second reference to a story, not a copy of it: delete the story and it
            // leaves every highlight holding it, because there is no longer anything to play.
            e.HasOne(x => x.Story)
                .WithMany()
                .HasForeignKey(x => x.StoryId)
                .OnDelete(DeleteBehavior.Cascade);

            e.HasIndex(x => new { x.HighlightId, x.StoryId }).IsUnique();
        });
    }
}
