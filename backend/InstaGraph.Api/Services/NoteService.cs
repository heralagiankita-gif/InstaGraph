using InstaGraph.Api.Common;
using InstaGraph.Api.Data;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Graph;
using Microsoft.EntityFrameworkCore;

namespace InstaGraph.Api.Services;

public interface INoteService
{
    /// <summary>Your own note first, then everybody whose note is allowed to reach you.</summary>
    Task<IReadOnlyList<NoteResponse>> ListAsync(int viewerId, CancellationToken ct = default);

    Task<NoteResponse> WriteAsync(int viewerId, WriteNoteRequest request, CancellationToken ct = default);

    Task ClearAsync(int viewerId, CancellationToken ct = default);
}

/// <summary>
/// Notes — the row of small bubbles above the inbox.
/// <para>
/// Worth having next to posts because it is the same edge set answering a narrower question. A post
/// reaches everyone with an edge pointing at you. A note reaches only the accounts whose edge runs both
/// ways, and a private one only the subset of those you named. One graph, three audiences, and none of
/// them is stored as a list of recipients — each is computed from the edges at the moment somebody looks.
/// </para>
/// </summary>
public class NoteService(AppDbContext db, IGraphSnapshotProvider graphProvider) : INoteService
{
    public async Task<IReadOnlyList<NoteResponse>> ListAsync(int viewerId, CancellationToken ct = default)
    {
        var graph = await graphProvider.GetAsync(ct);
        var now = DateTime.UtcNow;

        // The audience: accounts you follow who follow you back. Not a stored list — one linear merge
        // over two sorted adjacency lists, recomputed every time.
        var friends = graph.Friends(viewerId);
        var wall = graph.WalledFor(viewerId);

        var eligible = friends.Where(id => !wall.Contains(id)).ToList();
        eligible.Add(viewerId);

        var notes = await db.Notes
            .AsNoTracking()
            .Include(n => n.User)
            .Where(n => eligible.Contains(n.UserId) && n.ExpiresAt > now)
            .OrderByDescending(n => n.CreatedAt)
            .ToListAsync(ct);

        if (notes.Count == 0)
        {
            return [];
        }

        // Whose close-friends list you are on, so their private notes reach you and nobody else's do.
        var authorIds = notes.Select(n => n.UserId).Where(id => id != viewerId).ToList();

        var closeTo = authorIds.Count == 0
            ? []
            : await db.UserListEntries
                .AsNoTracking()
                .Where(e => e.Kind == UserListKind.CloseFriends
                            && e.UserId == viewerId
                            && authorIds.Contains(e.OwnerId))
                .Select(e => e.OwnerId)
                .ToListAsync(ct);

        return notes
            .Where(n => n.UserId == viewerId || !n.CloseFriendsOnly || closeTo.Contains(n.UserId))
            // Yours pins to the front, because that is the one you can edit.
            .OrderByDescending(n => n.UserId == viewerId)
            .ThenByDescending(n => n.CreatedAt)
            .Select(n => ToResponse(n, viewerId))
            .ToList();
    }

    public async Task<NoteResponse> WriteAsync(
        int viewerId, WriteNoteRequest request, CancellationToken ct = default)
    {
        var text = request.Text.Trim();

        if (text.Length == 0)
        {
            throw AppException.BadRequest("Write something first.");
        }

        var note = await db.Notes.Include(n => n.User).FirstOrDefaultAsync(n => n.UserId == viewerId, ct);

        if (note is null)
        {
            note = new Note { UserId = viewerId };
            db.Notes.Add(note);
        }

        note.Text = text;
        note.CloseFriendsOnly = request.CloseFriendsOnly;
        note.CreatedAt = DateTime.UtcNow;

        // Writing a new one restarts the day rather than inheriting what was left of the old one.
        note.ExpiresAt = DateTime.UtcNow.AddHours(24);

        await db.SaveChangesAsync(ct);

        note.User ??= await db.Users.FirstAsync(u => u.Id == viewerId, ct);

        return ToResponse(note, viewerId);
    }

    public async Task ClearAsync(int viewerId, CancellationToken ct = default)
    {
        var note = await db.Notes.FirstOrDefaultAsync(n => n.UserId == viewerId, ct);

        if (note is null)
        {
            return;
        }

        db.Notes.Remove(note);
        await db.SaveChangesAsync(ct);
    }

    private static NoteResponse ToResponse(Note note, int viewerId) => new()
    {
        User = note.User.ToSummary(),
        Text = note.Text,
        CloseFriendsOnly = note.CloseFriendsOnly,
        IsMine = note.UserId == viewerId,
        CreatedAt = note.CreatedAt,
        ExpiresAt = note.ExpiresAt
    };
}
