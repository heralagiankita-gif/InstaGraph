using InstaGraph.Api.Common;
using InstaGraph.Api.DTOs;
using InstaGraph.Api.Entities;
using InstaGraph.Api.Services;
using Microsoft.AspNetCore.Mvc;

namespace InstaGraph.Api.Controllers;

/// <summary>
/// Direct messages. The inbox is split into three folders by one question about the follow graph — does
/// the recipient have an edge pointing back at whoever started the thread — and everything else here is
/// ordinary chat.
/// </summary>
[Route("api/messages")]
public class MessagesController(IMessagingService messages, ICurrentUser currentUser)
    : ApiControllerBase(currentUser)
{
    /// <summary>
    /// The inbox. <c>folder</c> is <c>inbox</c>, <c>requests</c> or <c>spam</c>.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<Page<ConversationSummary>>> Inbox(
        [FromQuery] string folder = "inbox",
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken ct = default)
    {
        var (p, size) = Paging(page, pageSize, 20, 50);
        return Ok(await messages.InboxAsync(UserId, ParseFolder(folder), p, size, ct));
    }

    /// <summary>Unread threads and waiting requests — the two numbers the sidebar draws.</summary>
    [HttpGet("counts")]
    public async Task<ActionResult<InboxCounts>> Counts(CancellationToken ct) =>
        Ok(await messages.CountsAsync(UserId, ct));

    /// <summary>
    /// One thread. <c>before</c> pages backwards through the history, newest page first.
    /// </summary>
    [HttpGet("{conversationId:int}")]
    public async Task<ActionResult<ConversationDetail>> Thread(
        int conversationId,
        [FromQuery] int? before = null,
        [FromQuery] int take = 40,
        CancellationToken ct = default) =>
        Ok(await messages.ThreadAsync(UserId, conversationId, before, Math.Clamp(take, 1, 80), ct));

    /// <summary>Opens a chat with one person or several, without sending anything.</summary>
    [HttpPost]
    public async Task<ActionResult<ConversationSummary>> Start(
        StartConversationRequest request, CancellationToken ct) =>
        Ok(await messages.StartAsync(UserId, request, ct));

    [HttpPost("{conversationId:int}/messages")]
    public async Task<ActionResult<MessageResponse>> Send(
        int conversationId, SendMessageRequest request, CancellationToken ct) =>
        Ok(await messages.SendAsync(UserId, conversationId, request, ct));

    /// <summary>A photo straight into the chat. Multipart, field name <c>image</c>.</summary>
    [HttpPost("{conversationId:int}/photo")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<ActionResult<MessageResponse>> SendPhoto(
        int conversationId, IFormFile image, CancellationToken ct) =>
        Ok(await messages.SendImageAsync(UserId, conversationId, image, ct));

    /// <summary>Sends one post to several accounts at once — the share sheet behind the paper plane.</summary>
    [HttpPost("share")]
    public async Task<ActionResult<object>> Share(ShareToChatRequest request, CancellationToken ct)
    {
        var sent = await messages.ShareAsync(UserId, request.PostId, request.Usernames, request.Text, ct);
        return Ok(new { sent });
    }

    /// <summary>Unsends your own message. The row stays, emptied, so replies to it still resolve.</summary>
    [HttpDelete("messages/{messageId:int}")]
    public async Task<IActionResult> Unsend(int messageId, CancellationToken ct)
    {
        await messages.UnsendAsync(UserId, messageId, ct);
        return NoContent();
    }

    /// <summary>Leaves an emoji, replaces the one you left, or takes it back if it is the same one.</summary>
    [HttpPost("messages/{messageId:int}/react")]
    public async Task<ActionResult<IReadOnlyList<ReactionSummary>>> React(
        int messageId, ReactRequest request, CancellationToken ct) =>
        Ok(await messages.ReactAsync(UserId, messageId, request.Emoji, ct));

    [HttpPost("{conversationId:int}/read")]
    public async Task<IActionResult> Read(int conversationId, CancellationToken ct)
    {
        await messages.MarkReadAsync(UserId, conversationId, ct);
        return NoContent();
    }

    /// <summary>
    /// Says you are typing. Held in memory for a few seconds and never written down — a fact that is
    /// worthless the moment it is stale does not belong in a table.
    /// </summary>
    [HttpPost("{conversationId:int}/typing")]
    public async Task<IActionResult> Typing(int conversationId, CancellationToken ct)
    {
        await messages.SetTypingAsync(UserId, conversationId, ct);
        return NoContent();
    }

    /// <summary>Accepts a message request, moving it out of Requests and into the inbox.</summary>
    [HttpPost("{conversationId:int}/accept")]
    public async Task<IActionResult> Accept(int conversationId, CancellationToken ct)
    {
        await messages.RespondToRequestAsync(UserId, conversationId, accept: true, markSpam: false, ct);
        return NoContent();
    }

    /// <summary>Deletes a request. <c>spam=true</c> files it under Spam so the same account cannot return.</summary>
    [HttpPost("{conversationId:int}/decline")]
    public async Task<IActionResult> Decline(
        int conversationId, [FromQuery] bool spam = false, CancellationToken ct = default)
    {
        await messages.RespondToRequestAsync(UserId, conversationId, accept: false, markSpam: spam, ct);
        return NoContent();
    }

    /// <summary>Mutes or pins the thread. Both are yours alone; the other side is not told.</summary>
    [HttpPut("{conversationId:int}")]
    public async Task<IActionResult> Update(
        int conversationId, UpdateConversationRequest request, CancellationToken ct)
    {
        await messages.UpdateMemberAsync(UserId, conversationId, request.IsMuted, request.IsPinned, ct);
        return NoContent();
    }

    /// <summary>Deletes the chat from your inbox. Their copy is untouched.</summary>
    [HttpDelete("{conversationId:int}")]
    public async Task<IActionResult> Delete(int conversationId, CancellationToken ct)
    {
        await messages.DeleteConversationAsync(UserId, conversationId, ct);
        return NoContent();
    }

    [HttpPost("{conversationId:int}/leave")]
    public async Task<IActionResult> Leave(int conversationId, CancellationToken ct)
    {
        await messages.LeaveAsync(UserId, conversationId, ct);
        return NoContent();
    }

    /// <summary>
    /// Who to offer on the new-message screen, ordered by the weight already on the edge between you.
    /// </summary>
    [HttpGet("candidates")]
    public async Task<ActionResult<IReadOnlyList<ChatCandidate>>> Candidates(
        [FromQuery] string? q = null, [FromQuery] int limit = 20, CancellationToken ct = default) =>
        Ok(await messages.CandidatesAsync(UserId, q, Math.Clamp(limit, 1, 50), ct));

    private static MemberState ParseFolder(string folder) => folder.Trim().ToLowerInvariant() switch
    {
        "inbox" or "accepted" or "" => MemberState.Accepted,
        "requests" or "pending" => MemberState.Pending,
        "spam" or "hidden" => MemberState.Spam,
        _ => throw AppException.BadRequest("Folder is one of inbox, requests or spam.")
    };
}

public record ShareToChatRequest
{
    public int PostId { get; init; }
    public IReadOnlyList<string> Usernames { get; init; } = [];
    public string Text { get; init; } = string.Empty;
}

public record UpdateConversationRequest
{
    public bool? IsMuted { get; init; }
    public bool? IsPinned { get; init; }
}
