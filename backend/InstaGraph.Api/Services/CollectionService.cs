using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Services;

public interface ICollectionService
{
    Task<IReadOnlyList<CollectionResponse>> ListAsync(int userId, CancellationToken ct = default);

    Task<CollectionResponse> CreateAsync(
        int userId, CreateCollectionRequest request, CancellationToken ct = default);

    Task<CollectionResponse> RenameAsync(
        int userId, int collectionId, CreateCollectionRequest request, CancellationToken ct = default);

    Task DeleteAsync(int userId, int collectionId, CancellationToken ct = default);

    /// <summary>Moves a saved post into a folder, or out of every folder when the id is null.</summary>
    Task FileAsync(int userId, int postId, int? collectionId, CancellationToken ct = default);
}

/// <summary>
/// Folders inside the saved tab.
/// <para>
/// Saving is already private, so a collection adds no privacy — it only sorts. That is why the folder is a
/// column on the bookmark rather than the post moving into it: a post can be saved without being filed,
/// filing it changes nothing about the post, and deleting a folder puts its contents back into the
/// unsorted list instead of quietly unsaving twenty things.
/// </para>
/// </summary>
public class CollectionService(AppDbContext db) : ICollectionService
{
    public async Task<IReadOnlyList<CollectionResponse>> ListAsync(
        int userId, CancellationToken ct = default) =>
        await db.Collections
            .AsNoTracking()
            .Where(c => c.OwnerId == userId)
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new CollectionResponse
            {
                Id = c.Id,
                Name = c.Name,
                CoverUrl = c.CoverUrl,
                ItemCount = c.ItemCount,
                CreatedAt = c.CreatedAt
            })
            .ToListAsync(ct);

    public async Task<CollectionResponse> CreateAsync(
        int userId, CreateCollectionRequest request, CancellationToken ct = default)
    {
        var name = request.Name.Trim();

        if (await db.Collections.AnyAsync(c => c.OwnerId == userId && c.Name == name, ct))
        {
            throw AppException.Conflict("You already have a collection with that name.");
        }

        var collection = new Collection { OwnerId = userId, Name = name };

        db.Collections.Add(collection);
        await db.SaveChangesAsync(ct);

        return ToResponse(collection);
    }

    public async Task<CollectionResponse> RenameAsync(
        int userId, int collectionId, CreateCollectionRequest request, CancellationToken ct = default)
    {
        var collection = await LoadOwnAsync(userId, collectionId, ct);
        var name = request.Name.Trim();

        if (await db.Collections.AnyAsync(c => c.OwnerId == userId && c.Name == name && c.Id != collectionId, ct))
        {
            throw AppException.Conflict("You already have a collection with that name.");
        }

        collection.Name = name;
        await db.SaveChangesAsync(ct);

        return ToResponse(collection);
    }

    public async Task DeleteAsync(int userId, int collectionId, CancellationToken ct = default)
    {
        var collection = await LoadOwnAsync(userId, collectionId, ct);

        // The bookmarks survive; only the filing goes. The foreign key is SetNull for exactly this, so the
        // posts land back in the unsorted list rather than being unsaved along with the folder.
        db.Collections.Remove(collection);
        await db.SaveChangesAsync(ct);
    }

    public async Task FileAsync(
        int userId, int postId, int? collectionId, CancellationToken ct = default)
    {
        var saved = await db.SavedPosts
            .Include(s => s.Post)
            .FirstOrDefaultAsync(s => s.PostId == postId && s.UserId == userId, ct)
            ?? throw AppException.NotFound("Save that post before filing it.");

        Collection? target = null;

        if (collectionId is int id)
        {
            target = await LoadOwnAsync(userId, id, ct);
        }

        var previousId = saved.CollectionId;

        if (previousId == collectionId)
        {
            return;
        }

        if (previousId is int oldId)
        {
            var old = await db.Collections.FirstOrDefaultAsync(c => c.Id == oldId, ct);

            if (old is not null)
            {
                old.ItemCount = Math.Max(0, old.ItemCount - 1);
            }
        }

        saved.CollectionId = collectionId;

        if (target is not null)
        {
            target.ItemCount++;

            // The newest thing filed is what the folder shows. Cheaper than a join every time the list of
            // folders is drawn, and it is the same rule the real one uses.
            target.CoverUrl = saved.Post.ImageUrl;
        }

        await db.SaveChangesAsync(ct);
    }

    // ---------------------------------------------------------------- internals

    private async Task<Collection> LoadOwnAsync(int userId, int collectionId, CancellationToken ct)
    {
        var collection = await db.Collections.FirstOrDefaultAsync(c => c.Id == collectionId, ct)
                         ?? throw AppException.NotFound("That collection no longer exists.");

        // Somebody else's folder gets the same answer as one that was never there. A collection is
        // private, so confirming it exists would already be telling them something.
        if (collection.OwnerId != userId)
        {
            throw AppException.NotFound("That collection no longer exists.");
        }

        return collection;
    }

    private static CollectionResponse ToResponse(Collection c) => new()
    {
        Id = c.Id,
        Name = c.Name,
        CoverUrl = c.CoverUrl,
        ItemCount = c.ItemCount,
        CreatedAt = c.CreatedAt
    };
}
