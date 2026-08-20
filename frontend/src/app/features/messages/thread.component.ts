import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Messages } from '../../core/messages.service';
import { Realtime } from '../../core/realtime.service';
import { ChatMessage, ConversationDetail } from '../../core/models';
import { Toasts } from '../../core/toast.service';
import { AvatarComponent, ExactDatePipe } from '../../shared/ui';

/** The emoji offered on the little reaction bar. Instagram's set, in Instagram's order. */
const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'];

/**
 * One conversation.
 *
 * <p>
 * Almost everything here is ordinary chat — bubbles, replies, reactions, an unsend that leaves the row
 * standing so replies to it still resolve. The part that belongs to this app is the header on a thread
 * you have not accepted: it explains, from the graph, who is writing to you and how they reach you,
 * because a message request is the one surface where somebody with no edge to you can appear at all.
 * </p>
 */
@Component({
  selector: 'app-thread',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AvatarComponent, ExactDatePipe],
  template: `
    @if (thread(); as chat) {
      <!-- ------------------------------------------------------------ head -->
      <header class="head">
        <a class="back" routerLink="/messages"><i class="bi bi-arrow-left"></i></a>

        @if (chat.participants[0]; as other) {
          <a class="row gap-12 grow" [routerLink]="chat.isGroup ? null : ['/', other.username]">
            <span class="av-wrap">
              <app-avatar [user]="other" [size]="40" />
              @if (other.isOnline) {
                <span class="dot"></span>
              }
            </span>
            <span class="col" style="min-width:0">
              <span class="strong ellipsis">{{ chat.title }}</span>
              <span class="tiny muted ellipsis">{{ presenceLine() }}</span>
            </span>
          </a>
        }

        <div class="menu-wrap">
          <button type="button" class="icon-btn" aria-label="Conversation options" (click)="menuOpen.set(!menuOpen())">
            <i class="bi bi-three-dots"></i>
          </button>

          @if (menuOpen()) {
            <div class="menu" (click)="menuOpen.set(false)">
              <button type="button" (click)="setMuted(!chat.isMuted)">
                {{ chat.isMuted ? 'Unmute' : 'Mute' }} notifications
              </button>
              <button type="button" (click)="setPinned(!chat.isPinned)">
                {{ chat.isPinned ? 'Unpin' : 'Pin' }} to the top
              </button>
              @if (chat.isGroup) {
                <button type="button" class="danger" (click)="leave()">Leave group</button>
              }
              <button type="button" class="danger" (click)="remove()">Delete chat</button>
            </div>
          }
        </div>
      </header>

      <!-- --------------------------------------------------- request banner -->
      @if (chat.state !== 'Accepted' && chat.context; as context) {
        <div class="request">
          <p class="small mb-4">
            <span class="strong">{{ chat.participants[0]?.username }}</span> wants to send you a message.
          </p>
          <p class="tiny muted mb-8">
            {{ context.summary }} ·
            {{ context.followerCount }} {{ context.followerCount === 1 ? 'follower' : 'followers' }}
            @if (context.distance > 0) {
              · {{ context.distance }} {{ context.distance === 1 ? 'hop' : 'hops' }} away
            }
          </p>
          <div class="row gap-8">
            <button type="button" class="btn btn-sm grow" (click)="accept()">Accept</button>
            <button type="button" class="btn btn-sm btn-secondary grow" (click)="decline(false)">
              Delete
            </button>
            <button type="button" class="btn btn-sm btn-secondary grow" (click)="decline(true)">
              Spam
            </button>
          </div>
        </div>
      }

      <!-- ------------------------------------------------------- the thread -->
      <div class="scroll" #scroller (scroll)="onScroll()">
        @if (loadingMore()) {
          <div class="spinner"></div>
        } @else if (chat.hasMore) {
          <button type="button" class="btn-ghost older" (click)="loadOlder()">Load older messages</button>
        } @else {
          <div class="intro">
            @if (chat.participants[0]; as other) {
              <app-avatar [user]="other" [size]="76" />
              <p class="strong mt-8" style="margin-bottom:2px">{{ chat.title }}</p>
              @if (!chat.isGroup) {
                <a class="tiny muted" [routerLink]="['/', other.username]">{{ other.username }}</a>
              }
              @if (chat.context; as context) {
                <p class="tiny muted mt-8" style="max-width:300px;text-align:center">
                  {{ context.summary }}
                </p>
              }
            }
          </div>
        }

        @for (group of grouped(); track group.day) {
          <p class="day">{{ group.day }}</p>

          @for (message of group.items; track message.id) {
            @if (message.kind === 'System') {
              <p class="system tiny muted">{{ message.text }}</p>
            } @else {
              <div class="line" [class.mine]="message.isMine">
                @if (!message.isMine && chat.isGroup) {
                  <app-avatar [user]="message.sender" [size]="26" />
                }

                <div class="bubble-wrap">
                  @if (message.replyTo; as quote) {
                    <span class="quote tiny muted">
                      <i class="bi bi-reply"></i>
                      {{ quote.author }}: {{ quote.isUnsent ? 'unsent message' : quote.preview }}
                    </span>
                  }

                  <div
                    class="bubble"
                    [class.mine]="message.isMine"
                    [class.unsent]="message.isUnsent"
                    [class.plain]="message.kind === 'Heart' || message.kind === 'Image'"
                    [class.pending]="message.pending"
                    [title]="message.createdAt | exact"
                    (dblclick)="quickReact(message)">
                    @if (message.isUnsent) {
                      <span class="tiny">This message was unsent</span>
                    } @else if (message.kind === 'Heart') {
                      <span class="heart-big">{{ message.text || '❤️' }}</span>
                    } @else if (message.kind === 'Image' && message.imageUrl) {
                      <img class="photo" [src]="api.imageUrl(message.imageUrl)" alt="" />
                    } @else if (message.kind === 'PostShare') {
                      @if (message.sharedPost; as post) {
                        <a class="share-card" [routerLink]="['/p', post.id]">
                          <img [src]="api.imageUrl(post.imageUrl)" alt="" />
                          <span class="col pad-8">
                            <span class="tiny strong">{{ post.author.username }}</span>
                            <span class="tiny muted ellipsis">{{ post.caption || 'Photo' }}</span>
                          </span>
                        </a>
                      } @else {
                        <span class="tiny">That post is no longer available</span>
                      }
                      @if (message.text) {
                        <span class="share-note">{{ message.text }}</span>
                      }
                    } @else if (message.kind === 'StoryReply') {
                      <!-- The story it answers, if it has not expired yet. The text outlives it. -->
                      @if (message.sharedStory; as story) {
                        <span class="story-quote">
                          <img [src]="api.imageUrl(story.imageUrl)" alt="" />
                          <span class="tiny">Replied to their story</span>
                        </span>
                      } @else {
                        <span class="tiny faded">Replied to a story</span>
                      }
                      <span class="story-text">{{ message.text }}</span>
                    } @else if (message.kind === 'ProfileShare' && message.sharedUser) {
                      <a class="share-user" [routerLink]="['/', message.sharedUser.username]">
                        <app-avatar [user]="message.sharedUser" [size]="40" />
                        <span class="col">
                          <span class="tiny strong">{{ message.sharedUser.username }}</span>
                          <span class="tiny muted">{{ message.sharedUser.fullName }}</span>
                        </span>
                      </a>
                    } @else {
                      {{ message.text }}
                    }

                    @if (message.reactions.length > 0) {
                      <span class="reactions">
                        @for (reaction of message.reactions; track reaction.emoji) {
                          <button
                            type="button"
                            [class.mine]="reaction.mine"
                            (click)="react(message, reaction.emoji)">
                            {{ reaction.emoji }}
                            @if (reaction.count > 1) {
                              <span class="tiny">{{ reaction.count }}</span>
                            }
                          </button>
                        }
                      </span>
                    }
                  </div>

                  @if (!message.isUnsent && !message.pending) {
                    <span class="actions">
                      <button type="button" (click)="toggleReactionBar(message.id)" title="React">
                        <i class="bi bi-emoji-smile"></i>
                      </button>
                      <button type="button" (click)="startReply(message)" title="Reply">
                        <i class="bi bi-reply"></i>
                      </button>
                      @if (message.isMine) {
                        <button type="button" (click)="unsend(message)" title="Unsend">
                          <i class="bi bi-arrow-counterclockwise"></i>
                        </button>
                      }
                    </span>
                  }

                  @if (reactionBarFor() === message.id) {
                    <span class="reaction-bar">
                      @for (emoji of quickReactions; track emoji) {
                        <button type="button" (click)="react(message, emoji)">{{ emoji }}</button>
                      }
                    </span>
                  }
                </div>
              </div>

              @if (message.failed) {
                <p class="tiny failed">Not delivered · <button type="button" (click)="retry(message)">retry</button></p>
              }
            }
          }
        }

        @if (seenLine()) {
          <p class="seen tiny muted">{{ seenLine() }}</p>
        }

        @if (chat.typingUsernames.length > 0) {
          <div class="line">
            <div class="bubble typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        }
      </div>

      <!-- -------------------------------------------------------- composer -->
      @if (chat.state === 'Accepted') {
        @if (replyTo(); as quote) {
          <div class="replying tiny">
            <span class="muted grow ellipsis">
              Replying to {{ quote.isMine ? 'yourself' : quote.sender.username }}: {{ quote.text || 'photo' }}
            </span>
            <button type="button" class="icon-btn" aria-label="Cancel reply" (click)="replyTo.set(null)"><i class="bi bi-x"></i></button>
          </div>
        }

        <form class="composer" (ngSubmit)="send()">
          <input
            class="bare grow"
            placeholder="Message…"
            [ngModel]="draft()"
            (ngModelChange)="onDraft($event)"
            name="draft"
            autocomplete="off" />

          <label class="icon-btn" title="Send a photo">
            <i class="bi bi-image"></i>
            <input type="file" accept="image/*" hidden (change)="sendPhoto($event)" />
          </label>

          @if (draft().trim()) {
            <button type="submit" class="btn-ghost">Send</button>
          } @else {
            <button type="button" class="icon-btn" (click)="sendHeart()" title="Send a heart">
              <i class="bi bi-heart"></i>
            </button>
          }
        </form>
      } @else {
        <p class="locked small muted">
          Accept this request to reply. Until you do, they are not told that you have read it.
        </p>
      }
    } @else if (loading()) {
      <div class="spinner"></div>
    } @else {
      <div class="col center" style="height:100%;justify-content:center;align-items:center">
        <p class="muted small">That conversation is not there.</p>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }

      .head {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--border);
        flex: none;
      }

      .back {
        display: none;
        font-size: 20px;
      }

      .av-wrap {
        position: relative;
        flex: none;
      }

      .dot {
        position: absolute;
        right: -1px;
        bottom: 0;
        width: 11px;
        height: 11px;
        border-radius: 50%;
        background: #31a24c;
        border: 2px solid var(--surface);
      }

      .icon-btn {
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 18px;
        padding: 4px;
        line-height: 1;
        cursor: pointer;
      }

      .menu-wrap {
        position: relative;
      }

      .menu {
        position: absolute;
        right: 0;
        top: 30px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        box-shadow: var(--shadow-md);
        min-width: 190px;
        z-index: 40;
        overflow: hidden;
      }

      .menu button {
        display: block;
        width: 100%;
        text-align: left;
        border: 0;
        background: transparent;
        color: var(--ink);
        padding: 11px 14px;
        font-size: 13px;
      }

      .menu button:hover {
        background: var(--border-soft);
      }

      .menu button.danger {
        color: var(--danger);
      }

      /* ----------------------------------------------------------- request */

      .request {
        padding: 14px 16px;
        border-bottom: 1px solid var(--border);
        background: var(--bg);
        flex: none;
      }

      /* ------------------------------------------------------------ thread */

      .scroll {
        flex: 1;
        overflow-y: auto;
        padding: 14px 16px 8px;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .intro {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 22px 0 26px;
        border-bottom: 1px solid var(--border-soft);
        margin-bottom: 14px;
      }

      .older {
        align-self: center;
        margin-bottom: 10px;
      }

      .day {
        text-align: center;
        font-size: 11px;
        color: var(--ink-4);
        font-weight: 600;
        margin: 14px 0 10px;
      }

      .system {
        text-align: center;
        margin: 6px 0;
      }

      .line {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        margin-bottom: 3px;
      }

      .line.mine {
        justify-content: flex-end;
      }

      .bubble-wrap {
        position: relative;
        display: flex;
        flex-direction: column;
        max-width: 74%;
      }

      .line.mine .bubble-wrap {
        align-items: flex-end;
      }

      .quote {
        padding: 0 12px 3px;
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .bubble {
        position: relative;
        background: var(--border-soft);
        color: var(--ink);
        border-radius: 20px;
        padding: 9px 14px;
        font-size: 14px;
        line-height: 1.4;
        word-break: break-word;
        white-space: pre-wrap;
        /* A reaction chip hangs off the bottom edge and must not be clipped. */
        margin-bottom: 6px;
      }

      /*
        Your own messages, in the vibe. The gradient runs between the accent and its hover shade rather
        than across the full brand ramp: the brand ramp passes through some very light stops in a couple
        of vibes, and text has to stay readable on every bubble, not on most of them.
      */
      .bubble.mine {
        background: linear-gradient(135deg, var(--accent), var(--accent-hover));
        color: var(--accent-ink);
        box-shadow: 0 4px 14px -6px var(--glow);
      }

      .bubble.plain {
        background: transparent;
        padding: 0;
      }

      .bubble.unsent {
        background: transparent;
        border: 1px solid var(--border);
        color: var(--ink-3);
      }

      .bubble.pending {
        opacity: 0.55;
      }

      .heart-big {
        font-size: 42px;
        line-height: 1.1;
      }

      .photo {
        max-width: 240px;
        border-radius: 16px;
      }

      .share-card {
        display: block;
        width: 210px;
        border: 1px solid var(--border);
        border-radius: 14px;
        overflow: hidden;
        background: var(--surface);
        color: var(--ink);
      }

      .share-card img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
      }

      .pad-8 {
        padding: 8px 10px;
        min-width: 0;
      }

      .share-note {
        display: block;
        margin-top: 6px;
      }

      .share-user {
        display: flex;
        align-items: center;
        gap: 10px;
        color: inherit;
      }

      /* A story reply carries a thumbnail of what it answers, above the text. */
      .story-quote {
        display: flex;
        align-items: center;
        gap: 8px;
        opacity: 0.85;
        margin-bottom: 6px;
      }

      .story-quote img {
        width: 34px;
        height: 46px;
        object-fit: cover;
        border-radius: 6px;
        flex: none;
      }

      .story-text {
        display: block;
      }

      .faded {
        opacity: 0.7;
        display: block;
        margin-bottom: 4px;
      }

      .reactions {
        position: absolute;
        bottom: -11px;
        right: 8px;
        display: flex;
        gap: 2px;
      }

      .reactions button {
        border: 1px solid var(--border);
        background: var(--surface);
        border-radius: 999px;
        padding: 1px 5px;
        font-size: 11px;
        line-height: 1.5;
        display: inline-flex;
        align-items: center;
        gap: 2px;
        color: var(--ink);
      }

      .reactions button.mine {
        border-color: var(--accent);
      }

      .actions {
        position: absolute;
        top: 4px;
        display: none;
        gap: 2px;
      }

      .line:not(.mine) .actions {
        left: 100%;
        margin-left: 6px;
      }

      .line.mine .actions {
        right: 100%;
        margin-right: 6px;
      }

      .bubble-wrap:hover .actions {
        display: flex;
      }

      .actions button {
        border: 0;
        background: transparent;
        color: var(--ink-3);
        font-size: 13px;
        padding: 2px;
      }

      .actions button:hover {
        color: var(--ink);
      }

      .reaction-bar {
        position: absolute;
        top: -34px;
        display: flex;
        gap: 2px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 4px 6px;
        box-shadow: var(--shadow-md);
        z-index: 20;
      }

      .line.mine .reaction-bar {
        right: 0;
      }

      .reaction-bar button {
        border: 0;
        background: transparent;
        font-size: 17px;
        padding: 0 2px;
      }

      .reaction-bar button:hover {
        transform: scale(1.25);
      }

      .seen {
        text-align: right;
        margin: 2px 2px 6px;
      }

      .failed {
        text-align: right;
        color: var(--danger);
        margin: 0 2px 6px;
      }

      .failed button {
        border: 0;
        background: transparent;
        color: var(--danger);
        text-decoration: underline;
        padding: 0;
        font-size: inherit;
      }

      /* Three dots that rise in turn — the only animation in the thread. */
      .bubble.typing {
        display: flex;
        gap: 4px;
        align-items: center;
        padding: 12px 14px;
      }

      .bubble.typing span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--ink-4);
        animation: bounce 1.1s infinite;
      }

      .bubble.typing span:nth-child(2) {
        animation-delay: 0.15s;
      }

      .bubble.typing span:nth-child(3) {
        animation-delay: 0.3s;
      }

      @keyframes bounce {
        0%,
        60%,
        100% {
          transform: translateY(0);
          opacity: 0.5;
        }
        30% {
          transform: translateY(-4px);
          opacity: 1;
        }
      }

      /* ---------------------------------------------------------- composer */

      .replying {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        border-top: 1px solid var(--border);
        background: var(--bg);
        flex: none;
      }

      .composer {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 10px 14px 14px;
        border: 1px solid var(--border);
        border-radius: 22px;
        padding: 6px 14px;
        flex: none;
      }

      .bare {
        border: 0;
        background: transparent;
        outline: none;
        color: var(--ink);
        font-family: inherit;
        font-size: 14px;
        padding: 5px 0;
      }

      .locked {
        margin: 0;
        padding: 16px;
        border-top: 1px solid var(--border);
        text-align: center;
        flex: none;
      }

      @media (max-width: 900px) {
        .back {
          display: block;
        }
      }
    `,
  ],
})
export class ThreadComponent implements OnDestroy {
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  private readonly messages = inject(Messages);
  private readonly realtime = inject(Realtime);
  protected readonly api = inject(Api);
  protected readonly auth = inject(Auth);

  /** Bound from the route by withComponentInputBinding. */
  readonly id = input.required<string>();

  protected readonly quickReactions = QUICK_REACTIONS;

  protected readonly thread = signal<ConversationDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadingMore = signal(false);
  protected readonly draft = signal('');
  protected readonly replyTo = signal<ChatMessage | null>(null);
  protected readonly menuOpen = signal(false);
  protected readonly reactionBarFor = signal<number | null>(null);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  private timer?: ReturnType<typeof setInterval>;
  private typingTimer?: ReturnType<typeof setTimeout>;
  private subscriptions: Subscription[] = [];
  private lastTypingPing = 0;
  private pinToBottom = true;
  private nextTempId = -1;

  /** Messages split into days, so a long thread carries its own dates. */
  protected readonly grouped = computed(() => {
    const groups: { day: string; items: ChatMessage[] }[] = [];

    for (const message of this.thread()?.messages ?? []) {
      const day = dayLabel(message.createdAt);
      const last = groups.at(-1);

      if (last?.day === day) {
        last.items.push(message);
      } else {
        groups.push({ day, items: [message] });
      }
    }

    return groups;
  });

  /** "Seen" under the newest of your own messages, when they have read that far. */
  protected readonly seenLine = computed(() => {
    const chat = this.thread();
    if (!chat || chat.seenUpToMessageId === null) return '';

    const mine = [...chat.messages].reverse().find((m) => m.isMine && !m.pending);
    if (!mine || mine.id > chat.seenUpToMessageId) return '';

    return 'Seen';
  });

  protected readonly presenceLine = computed(() => {
    const chat = this.thread();
    const other = chat?.participants[0];

    if (!chat || !other) return '';
    if (chat.isGroup) return `${chat.participants.length + 1} people`;
    if (chat.typingUsernames.length > 0) return 'typing…';
    if (other.isOnline) return 'Active now';
    if (other.lastActiveAt) return `Active ${relative(other.lastActiveAt)}`;

    return other.fullName || other.username;
  });

  constructor() {
    // The route parameter arrives as an input, so a change of thread is a change of input rather than
    // a re-created component — this is what reloads it.
    effect(() => {
      const id = Number(this.id());
      if (!Number.isFinite(id)) return;

      this.reset();
      this.load(id);
    });

    // ------------------------------------------------------------- live wiring

    // A message arriving for this thread is appended straight in. The payload was built for this
    // viewer on the server, so "is it mine" and "did I react" are already answered.
    this.subscriptions.push(
      this.realtime.message$.subscribe((event) => {
        if (event.conversationId !== this.thread()?.id) return;

        this.append(event.message);

        if (!event.message.isMine) {
          this.markRead(event.conversationId);
        }
      }),
    );

    // An unsend or a reaction replaces the bubble in place rather than reloading the thread.
    this.subscriptions.push(
      this.realtime.messageChanged$.subscribe((event) => {
        if (event.conversationId !== this.thread()?.id) return;

        this.thread.update((chat) =>
          chat
            ? {
                ...chat,
                messages: chat.messages.map((m) => (m.id === event.message.id ? event.message : m)),
              }
            : chat,
        );
      }),
    );

    this.subscriptions.push(
      this.realtime.typing$.subscribe((event) => {
        if (event.conversationId !== this.thread()?.id) return;

        this.thread.update((chat) =>
          chat ? { ...chat, typingUsernames: [event.username] } : chat,
        );

        // The server holds a typing flag for six seconds; the bubble clears itself a little sooner, so
        // it never lingers after somebody has stopped.
        clearTimeout(this.typingTimer);
        this.typingTimer = setTimeout(
          () => this.thread.update((chat) => (chat ? { ...chat, typingUsernames: [] } : chat)),
          4_000,
        );
      }),
    );

    // "Seen" appears the moment it becomes true, rather than on the next fetch.
    this.subscriptions.push(
      this.realtime.read$.subscribe((event) => {
        if (event.conversationId !== this.thread()?.id) return;

        this.thread.update((chat) =>
          chat
            ? { ...chat, seenUpToMessageId: Math.max(chat.seenUpToMessageId ?? 0, event.messageId) }
            : chat,
        );
      }),
    );

    // Presence changes the line under the name without touching anything else.
    this.subscriptions.push(
      this.realtime.presence$.subscribe((event) => {
        this.thread.update((chat) =>
          chat
            ? {
                ...chat,
                participants: chat.participants.map((p) =>
                  p.id === event.userId
                    ? { ...p, isOnline: event.online, lastActiveAt: event.lastActiveAt }
                    : p,
                ),
              }
            : chat,
        );
      }),
    );

    // Anything that happened while the socket was down was never delivered. Ask again.
    this.subscriptions.push(this.realtime.resynced$.subscribe(() => this.poll()));

    // The fallback, and only the fallback. While the socket is up this does nothing at all; it exists
    // so a browser that could not open one still ends up with a correct thread.
    this.timer = setInterval(() => {
      if (!document.hidden && !this.realtime.connected()) {
        this.poll();
      }
    }, 5_000);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
    clearTimeout(this.typingTimer);
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  /** Adds a message that arrived over the socket, unless it is one we already drew ourselves. */
  private append(message: ChatMessage) {
    this.thread.update((chat) => {
      if (!chat || chat.messages.some((m) => m.id === message.id)) {
        return chat;
      }

      // Our own message echoes back over the socket as well; it replaces the optimistic bubble rather
      // than appearing beside it.
      const messages = message.isMine
        ? [...chat.messages.filter((m) => !m.pending), message]
        : [...chat.messages, message];

      return { ...chat, messages };
    });

    if (this.pinToBottom) {
      queueMicrotask(() => this.scrollToBottom());
    }
  }

  private reset() {
    this.thread.set(null);
    this.loading.set(true);
    this.draft.set('');
    this.replyTo.set(null);
    this.reactionBarFor.set(null);
    this.pinToBottom = true;
  }

  private load(id: number) {
    this.api.thread(id).subscribe({
      next: (chat) => {
        this.loading.set(false);
        this.thread.set(chat);
        this.markRead(id);
        queueMicrotask(() => this.scrollToBottom());
      },
      error: () => {
        this.loading.set(false);
        this.thread.set(null);
      },
    });
  }

  /**
   * Re-reads the newest page and merges it in, keeping anything still in flight. Replacing the array
   * outright would make an optimistic bubble flicker out and back in again.
   */
  private poll() {
    const chat = this.thread();
    if (!chat) return;

    this.api.thread(chat.id).subscribe({
      next: (fresh) => {
        const current = this.thread()?.messages ?? [];

        // The poll only ever returns the newest page. Anything already on screen that is older than the
        // top of that page was loaded by "load older" and has to survive, or scrolling back through a
        // conversation would undo itself every three seconds.
        const oldest = fresh.messages[0]?.id ?? Number.MAX_SAFE_INTEGER;
        const history = current.filter((m) => !m.pending && !m.failed && m.id > 0 && m.id < oldest);
        const inFlight = current.filter((m) => m.pending || m.failed);

        const merged = [...history, ...fresh.messages, ...inFlight];
        const grew = merged.length !== current.length;

        this.thread.set({
          ...fresh,
          messages: merged,
          // Only the server can say whether there is more history; but once we are holding some, the
          // answer belongs to the oldest page we actually fetched.
          hasMore: history.length > 0 ? chat.hasMore : fresh.hasMore,
        });

        if (grew && this.pinToBottom) {
          queueMicrotask(() => this.scrollToBottom());
        }

        if (fresh.messages.some((m) => !m.isMine)) {
          this.markRead(chat.id);
        }
      },
      error: () => undefined,
    });
  }

  private markRead(id: number) {
    this.api.markChatRead(id).subscribe({
      next: () => this.messages.refresh(),
      error: () => undefined,
    });
  }

  protected onScroll() {
    const element = this.scroller()?.nativeElement;
    if (!element) return;

    // Only follow new messages down when the reader is already at the bottom; yanking somebody out of
    // the history they scrolled up to read is worse than a missed message.
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    this.pinToBottom = distance < 90;
  }

  private scrollToBottom() {
    const element = this.scroller()?.nativeElement;
    if (element) element.scrollTop = element.scrollHeight;
  }

  protected loadOlder() {
    const chat = this.thread();
    const oldest = chat?.messages.find((m) => !m.pending);

    if (!chat || !oldest) return;

    this.loadingMore.set(true);

    this.api.thread(chat.id, oldest.id).subscribe({
      next: (older) => {
        this.loadingMore.set(false);
        this.thread.set({ ...chat, messages: [...older.messages, ...chat.messages], hasMore: older.hasMore });
      },
      error: () => this.loadingMore.set(false),
    });
  }

  // ------------------------------------------------------------------ typing

  protected onDraft(value: string) {
    this.draft.set(value);

    const chat = this.thread();
    if (!chat || !value) return;

    // One ping every two seconds, not one per keystroke. The server holds it for six.
    const now = Date.now();
    if (now - this.lastTypingPing < 2_000) return;

    this.lastTypingPing = now;

    // Over the socket rather than a POST: a keystroke is the highest-frequency event in the app and the
    // cheapest possible thing to send.
    this.realtime.typing(chat.id);
  }

  // ------------------------------------------------------------------ sending

  protected send() {
    const chat = this.thread();
    const text = this.draft().trim();

    if (!chat || !text) return;

    this.draft.set('');
    const reply = this.replyTo();
    this.replyTo.set(null);

    this.push(this.optimistic({ text, kind: 'Text' }));

    this.api.sendMessage(chat.id, { text, replyToMessageId: reply?.id }).subscribe({
      next: (message) => this.settle(message),
      error: (error) => {
        this.fail();
        this.toasts.error(error.error?.message ?? 'That message did not send.');
      },
    });
  }

  protected sendHeart() {
    const chat = this.thread();
    if (!chat) return;

    this.push(this.optimistic({ text: '❤️', kind: 'Heart' }));

    this.api.sendMessage(chat.id, { isHeart: true }).subscribe({
      next: (message) => this.settle(message),
      error: () => this.fail(),
    });
  }

  protected sendPhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const chat = this.thread();

    if (!file || !chat) return;

    input.value = '';

    this.api.sendChatPhoto(chat.id, file).subscribe({
      next: (message) => {
        // settle, not push: the hub echoes this one back too, and it would otherwise land twice for
        // the same reason a text message did.
        this.settle(message);
        this.pinToBottom = true;
        queueMicrotask(() => this.scrollToBottom());
      },
      error: (error) => this.toasts.error(error.error?.message ?? 'That photo did not send.'),
    });
  }

  protected retry(message: ChatMessage) {
    const chat = this.thread();
    if (!chat) return;

    this.thread.update((current) =>
      current ? { ...current, messages: current.messages.filter((m) => m.id !== message.id) } : current,
    );

    this.draft.set(message.text);
    this.send();
  }

  private optimistic(partial: Partial<ChatMessage>): ChatMessage {
    const me = this.auth.user()!;

    return {
      id: this.nextTempId--,
      conversationId: this.thread()!.id,
      sender: me,
      kind: 'Text',
      text: '',
      imageUrl: null,
      sharedPost: null,
      sharedUser: null,
      sharedStory: null,
      replyTo: this.replyTo()
        ? { id: this.replyTo()!.id, author: this.replyTo()!.sender.username, preview: this.replyTo()!.text, isUnsent: false }
        : null,
      isMine: true,
      isUnsent: false,
      createdAt: new Date().toISOString(),
      reactions: [],
      pending: true,
      ...partial,
    };
  }

  private push(message: ChatMessage) {
    this.thread.update((chat) => (chat ? { ...chat, messages: [...chat.messages, message] } : chat));
    this.pinToBottom = true;
    queueMicrotask(() => this.scrollToBottom());
  }

  /**
   * Swaps the optimistic bubble for the real one the server gave back.
   *
   * <p>
   * The two deliveries race. The POST response and the hub's own echo of the same message can arrive
   * in either order, and when the echo won, {@link append} had already put the real message in the
   * list — so appending it again here drew the sender their own message twice. (Only the sender: the
   * recipient never had an optimistic bubble or a POST response, just the one echo.)
   * </p>
   *
   * <p>
   * So this replaces by id when the message is already there and appends only when it is not, which
   * makes it idempotent and leaves the two arrival orders indistinguishable.
   * </p>
   */
  private settle(message: ChatMessage) {
    this.thread.update((chat) => {
      if (!chat) return chat;

      const withoutPending = chat.messages.filter((m) => !m.pending);
      const already = withoutPending.some((m) => m.id === message.id);

      return {
        ...chat,
        messages: already
          ? withoutPending.map((m) => (m.id === message.id ? message : m))
          : [...withoutPending, message],
      };
    });

    this.messages.refresh();
  }

  private fail() {
    this.thread.update((chat) =>
      chat
        ? {
            ...chat,
            messages: chat.messages.map((m) => (m.pending ? { ...m, pending: false, failed: true } : m)),
          }
        : chat,
    );
  }

  // ---------------------------------------------------------------- reactions

  protected toggleReactionBar(id: number) {
    this.reactionBarFor.update((current) => (current === id ? null : id));
  }

  protected quickReact(message: ChatMessage) {
    this.react(message, '❤️');
  }

  protected react(message: ChatMessage, emoji: string) {
    this.reactionBarFor.set(null);

    if (message.id < 0) return;

    this.api.reactToMessage(message.id, emoji).subscribe({
      next: (reactions) =>
        this.thread.update((chat) =>
          chat
            ? {
                ...chat,
                messages: chat.messages.map((m) => (m.id === message.id ? { ...m, reactions } : m)),
              }
            : chat,
        ),
      error: () => undefined,
    });
  }

  protected startReply(message: ChatMessage) {
    this.replyTo.set(message);
  }

  protected unsend(message: ChatMessage) {
    this.api.unsendMessage(message.id).subscribe({
      next: () =>
        this.thread.update((chat) =>
          chat
            ? {
                ...chat,
                messages: chat.messages.map((m) =>
                  m.id === message.id ? { ...m, isUnsent: true, text: '', reactions: [] } : m,
                ),
              }
            : chat,
        ),
      error: (error) => this.toasts.error(error.error?.message ?? 'Could not unsend that.'),
    });
  }

  // ------------------------------------------------------------------ actions

  protected accept() {
    const chat = this.thread();
    if (!chat) return;

    this.api.acceptChat(chat.id).subscribe({
      next: () => {
        this.thread.set({ ...chat, state: 'Accepted' });
        this.messages.refresh();
        this.toasts.show('Request accepted.');
      },
    });
  }

  protected decline(spam: boolean) {
    const chat = this.thread();
    if (!chat) return;

    this.api.declineChat(chat.id, spam).subscribe({
      next: () => {
        this.messages.refresh();
        this.router.navigate(['/messages']);
        this.toasts.show(spam ? 'Marked as spam.' : 'Request deleted.');
      },
    });
  }

  protected setMuted(muted: boolean) {
    const chat = this.thread();
    if (!chat) return;

    this.api.updateChat(chat.id, { isMuted: muted }).subscribe({
      next: () => this.thread.set({ ...chat, isMuted: muted }),
    });
  }

  protected setPinned(pinned: boolean) {
    const chat = this.thread();
    if (!chat) return;

    this.api.updateChat(chat.id, { isPinned: pinned }).subscribe({
      next: () => this.thread.set({ ...chat, isPinned: pinned }),
    });
  }

  protected remove() {
    const chat = this.thread();
    if (!chat) return;

    this.api.deleteChat(chat.id).subscribe({
      next: () => {
        this.toasts.show('Chat deleted for you. Their copy is untouched.');
        this.router.navigate(['/messages']);
      },
    });
  }

  protected leave() {
    const chat = this.thread();
    if (!chat) return;

    this.api.leaveChat(chat.id).subscribe({
      next: () => this.router.navigate(['/messages']),
    });
  }
}

/** "Today", "Yesterday", then the actual date. */
function dayLabel(iso: string): string {
  const date = new Date(iso.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z');
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);

  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();

  if (same(date, today)) return 'Today';
  if (same(date, yesterday)) return 'Yesterday';

  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "4 m ago", "3 h ago", "2 d ago" — only used on the presence line. */
function relative(iso: string): string {
  const then = new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60_000));

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  return `${Math.floor(hours / 24)} d ago`;
}
