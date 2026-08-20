import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { Subject, Subscription, auditTime, debounceTime, distinctUntilChanged, filter, merge, switchMap } from 'rxjs';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Clock } from '../../core/clock.service';
import { Messages } from '../../core/messages.service';
import { Realtime } from '../../core/realtime.service';
import { ChatCandidate, Conversation, Note } from '../../core/models';
import { Toasts } from '../../core/toast.service';
import { AgoPipe, AvatarComponent, EmptyComponent } from '../../shared/ui';

type Folder = 'inbox' | 'requests' | 'spam';

/**
 * The inbox, and the frame the open thread sits in.
 *
 * <p>
 * Three folders over one table. Which one a thread is in was decided by a single question about the
 * follow graph when it was created — does the person who received it have an edge pointing back at the
 * person who started it — and nothing about the message itself. That is the whole message-request
 * mechanism, and it is the same shape as the gate on a private account: the connection has to exist
 * before the content arrives.
 * </p>
 */
@Component({
  selector: 'app-messages',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, FormsModule, AvatarComponent, AgoPipe, EmptyComponent],
  template: `
    <div class="dm" [class.thread-open]="threadOpen()">
      <!-- ------------------------------------------------------------- list -->
      <aside class="list">
        <header class="list-head">
          <button type="button" class="handle" [routerLink]="['/', auth.username()]">
            <span class="strong">{{ auth.username() }}</span>
            <i class="bi bi-chevron-down tiny"></i>
          </button>

          <button type="button" class="icon-btn" (click)="openCompose()" title="New message">
            <i class="bi bi-pencil-square"></i>
          </button>
        </header>

        <div class="search-wrap">
          <span class="search-box">
            <i class="bi bi-search"></i>
            <input
              class="bare"
              placeholder="Search"
              [ngModel]="term()"
              (ngModelChange)="onSearch($event)" />
            @if (term()) {
              <button type="button" class="icon-btn small" (click)="clearSearch()" aria-label="Clear search">
                <i class="bi bi-x-circle-fill"></i>
              </button>
            }
          </span>
        </div>

        @if (term()) {
          <!-- Searching swaps the list for people you could start a chat with. -->
          <div class="rows">
            @if (searching()) {
              <div class="spinner"></div>
            } @else if (candidates().length === 0) {
              <p class="muted small pad">No accounts match “{{ term() }}”.</p>
            } @else {
              @for (person of candidates(); track person.id) {
                <button type="button" class="row-btn" (click)="openWith(person)">
                  <span class="av-wrap">
                    <app-avatar [user]="person" [size]="44" />
                    @if (person.isOnline) {
                      <span class="dot"></span>
                    }
                  </span>
                  <span class="col grow" style="min-width:0">
                    <span class="strong ellipsis">{{ person.username }}</span>
                    <span class="tiny muted ellipsis">{{ person.reason }}</span>
                  </span>
                </button>
              }
            }
          </div>
        } @else {
          <!-- ---------------------------------------------------------- notes -->
          <!-- Always drawn: your own bubble is the composer, so an empty row is still a control. -->
          <div class="notes">
            <button type="button" class="note" (click)="openNoteEditor()">
                <span class="bubble" [class.placeholder]="!myNote()">
                  {{ myNote()?.text || 'Note…' }}
                </span>
                @if (auth.user(); as me) {
                  <app-avatar [user]="me" [size]="52" />
                }
                <span class="tiny muted ellipsis">Your note</span>
              </button>

              @for (note of otherNotes(); track note.user.id) {
                <button type="button" class="note" (click)="openWithUsername(note.user.username)">
                  <span class="bubble">
                    {{ note.text }}
                    @if (note.closeFriendsOnly) {
                      <i class="bi bi-star-fill close-star"></i>
                    }
                  </span>
                  <app-avatar [user]="note.user" [size]="52" />
                  <span class="tiny muted ellipsis">{{ note.user.username }}</span>
                </button>
              }
          </div>

          <!-- ---------------------------------------------------------- tabs -->
          <div class="tabs">
            <button type="button" [class.on]="folder() === 'inbox'" (click)="setFolder('inbox')">
              Messages
            </button>
            <button type="button" [class.on]="folder() === 'requests'" (click)="setFolder('requests')">
              Requests
              @if (messages.requests() > 0) {
                <span class="pill">{{ messages.requests() }}</span>
              }
            </button>
            <button type="button" [class.on]="folder() === 'spam'" (click)="setFolder('spam')">
              Spam
            </button>
          </div>

          @if (folder() === 'requests') {
            <p class="notice small">
              Started by accounts that do not follow you. They are not told you have seen this.
            </p>
          } @else if (folder() === 'spam') {
            <p class="notice small">
              Requests that tripped one of your hidden words, or that you marked as spam.
            </p>
          }

          <!-- ---------------------------------------------------- the threads -->
          <div class="rows">
            @if (loading() && conversations().length === 0) {
              @for (i of [1, 2, 3, 4, 5]; track i) {
                <div class="row-btn">
                  <span class="sk sk-circle" style="width:44px;height:44px"></span>
                  <span class="col grow gap-4">
                    <span class="sk" style="width:40%;height:11px"></span>
                    <span class="sk" style="width:65%;height:10px"></span>
                  </span>
                </div>
              }
            } @else if (conversations().length === 0) {
              <app-empty
                icon="bi-send"
                [title]="emptyTitle()"
                [message]="emptyMessage()" />
            } @else {
              @for (chat of conversations(); track chat.id) {
                <a
                  class="row-btn"
                  [class.active]="openId() === chat.id"
                  [class.unread]="chat.unreadCount > 0"
                  [routerLink]="['/messages', chat.id]">
                  <span class="av-wrap">
                    @if (chat.participants[0]; as other) {
                      <app-avatar [user]="other" [size]="52" />
                      @if (other.isOnline) {
                        <span class="dot"></span>
                      }
                    }
                    @if (chat.isGroup && chat.participants[1]; as second) {
                      <span class="stack"><app-avatar [user]="second" [size]="30" /></span>
                    }
                  </span>

                  <span class="col grow" style="min-width:0">
                    <span class="row between gap-8">
                      <span class="strong ellipsis">{{ chat.title }}</span>
                      @if (chat.isPinned) {
                        <i class="bi bi-pin-angle-fill tiny muted"></i>
                      }
                    </span>

                    <span class="tiny muted ellipsis preview">
                      @if (chat.isTyping) {
                        <em class="typing-text">typing…</em>
                      } @else {
                        {{ chat.preview }}
                      }
                      @if (chat.lastMessageAt) {
                        · {{ chat.lastMessageAt | ago: clock.now() }}
                      }
                    </span>
                  </span>

                  <span class="col gap-4 trailing">
                    @if (chat.unreadCount > 0) {
                      <span class="blue-dot"></span>
                    } @else if (chat.lastMessageMine && chat.lastMessageSeen) {
                      <span class="tiny muted">Seen</span>
                    }
                    @if (chat.isMuted) {
                      <i class="bi bi-bell-slash tiny muted"></i>
                    }
                  </span>
                </a>
              }
            }
          </div>
        }
      </aside>

      <!-- ----------------------------------------------------------- thread -->
      <section class="pane">
        <router-outlet />
      </section>
    </div>

    <!-- ---------------------------------------------------------- compose -->
    @if (composeOpen()) {
      <div class="modal-backdrop" (click)="composeOpen.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head row between" style="padding-left:16px">
            <button type="button" class="icon-btn" aria-label="Close" (click)="composeOpen.set(false)">
              <i class="bi bi-x-lg"></i>
            </button>
            <span>New message</span>
            <button type="button" class="btn-ghost" [disabled]="picked().length === 0" (click)="startChat()">
              Chat
            </button>
          </div>

          <div class="pad">
            <div class="row gap-8 wrap mb-8">
              <span class="strong">To:</span>
              @for (person of picked(); track person.id) {
                <span class="token">
                  {{ person.username }}
                  <button type="button" aria-label="Remove" (click)="toggle(person)"><i class="bi bi-x"></i></button>
                </span>
              }
              <input
                class="bare grow"
                placeholder="Search…"
                [ngModel]="composeTerm()"
                (ngModelChange)="onComposeSearch($event)" />
            </div>

            @if (picked().length > 1) {
              <input class="input mb-8" placeholder="Group name (optional)" [(ngModel)]="groupName" />
            }
          </div>

          <hr class="rule" style="margin:0" />

          <p class="tiny muted pad" style="padding-bottom:0">
            @if (composeTerm()) {
              Accounts matching “{{ composeTerm() }}”
            } @else {
              Suggested — ordered by how much you actually interact, not alphabetically
            }
          </p>

          <div class="rows" style="max-height:46vh">
            @for (person of composeCandidates(); track person.id) {
              <button type="button" class="row-btn" (click)="toggle(person)">
                <app-avatar [user]="person" [size]="44" />
                <span class="col grow" style="min-width:0">
                  <span class="strong ellipsis">{{ person.username }}</span>
                  <span class="tiny muted ellipsis">{{ person.reason }}</span>
                </span>
                <span class="check" [class.on]="isPicked(person)">
                  @if (isPicked(person)) {
                    <i class="bi bi-check"></i>
                  }
                </span>
              </button>
            }

            @if (composeCandidates().length === 0) {
              <p class="muted small pad">No accounts to show.</p>
            }
          </div>
        </div>
      </div>
    }

    <!-- ------------------------------------------------------- note editor -->
    @if (noteOpen()) {
      <div class="modal-backdrop" (click)="noteOpen.set(false)">
        <div class="modal" style="max-width:400px" (click)="$event.stopPropagation()">
          <div class="modal-head">New note</div>

          <div class="pad">
            <p class="tiny muted mb-8">
              Shared with the accounts you follow who follow you back — for a day.
            </p>

            <input
              class="input"
              maxlength="60"
              placeholder="Share a thought…"
              [(ngModel)]="noteText"
              (keyup.enter)="saveNote()" />

            <p class="tiny muted mt-4">{{ noteText.length }}/60</p>

            <label class="row gap-8 mt-12" style="cursor:pointer">
              <input type="checkbox" [(ngModel)]="noteCloseFriends" />
              <span class="col">
                <span class="small strong">Close friends only</span>
                <span class="tiny muted">Narrows it again, to the list you picked yourself.</span>
              </span>
            </label>
          </div>

          <div class="row gap-8 pad" style="padding-top:0">
            @if (myNote()) {
              <button type="button" class="btn btn-secondary grow" (click)="deleteNote()">Delete</button>
            }
            <button type="button" class="btn grow" [disabled]="!noteText.trim()" (click)="saveNote()">
              Share
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        /* Wider than the 1100px this used to sit at. Every other screen in the app is a single column
           that reads better narrow; this one is two panes side by side, and capping it early spent the
           extra desk space on empty page either side instead of on the thread. */
        max-width: 1400px;
        margin: 0 auto;
      }

      .dm {
        display: grid;
        grid-template-columns: 350px 1fr;
        /*
          The row has to be pinned, not left to "auto".

          An auto-sized grid row is allowed to grow past its container when its content is taller than
          the container — and since .dm clips its overflow, a long thread simply had its newest messages
          cut off the bottom with nothing to scroll. minmax(0, 1fr) holds the row at exactly the
          container height, which is what lets the .scroll inside the thread become the scroller.
        */
        grid-template-rows: minmax(0, 1fr);
        /*
          The shell pads its content area 28px above and 60px below, and this used to stop a further
          28px short of that — so the card ended well up the window with a dead band underneath it.

          It now claims most of that back. The negative margin is what keeps the page from scrolling
          once the card is taller than the space the shell left for it:
          28 (shell top) + (100vh - 56) + (-32) + 60 (shell bottom) = 100vh exactly.
        */
        height: calc(100vh - 56px);
        margin-bottom: -32px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        overflow: hidden;
        background: var(--surface);
      }

      .list {
        border-right: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .list-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px 10px;
      }

      .handle {
        display: flex;
        align-items: center;
        gap: 6px;
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 16px;
        padding: 0;
      }

      .icon-btn {
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 20px;
        padding: 4px;
        line-height: 1;
      }

      .icon-btn.small {
        font-size: 14px;
        color: var(--ink-4);
      }

      .search-wrap {
        padding: 0 16px 10px;
      }

      .search-box {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--border-soft);
        border-radius: 10px;
        padding: 8px 10px;
        color: var(--ink-3);
      }

      .bare {
        border: 0;
        background: transparent;
        outline: none;
        color: var(--ink);
        font-family: inherit;
        font-size: 14px;
        width: 100%;
      }

      /* ------------------------------------------------------------- notes */

      .notes {
        display: flex;
        gap: 14px;
        overflow-x: auto;
        padding: 10px 16px 14px;
        scrollbar-width: none;
      }

      .notes::-webkit-scrollbar {
        display: none;
      }

      .note {
        border: 0;
        background: transparent;
        padding: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        width: 68px;
        flex: none;
        color: var(--ink);
      }

      .note .bubble {
        position: relative;
        background: var(--border-soft);
        border-radius: 14px;
        padding: 6px 9px;
        font-size: 11px;
        line-height: 1.25;
        max-width: 68px;
        max-height: 40px;
        overflow: hidden;
        margin-bottom: -6px;
        z-index: 1;
        text-align: center;
      }

      /* The two little tails that make it read as a speech bubble rather than a label. */
      .note .bubble::after,
      .note .bubble::before {
        content: '';
        position: absolute;
        background: var(--border-soft);
        border-radius: 50%;
      }

      .note .bubble::after {
        width: 8px;
        height: 8px;
        bottom: -4px;
        left: 12px;
      }

      .note .bubble::before {
        width: 4px;
        height: 4px;
        bottom: -9px;
        left: 9px;
      }

      .note .bubble.placeholder {
        color: var(--ink-4);
      }

      .close-star {
        font-size: 8px;
        color: #2ecc71;
        margin-left: 2px;
      }

      .note span:last-child {
        max-width: 68px;
      }

      /* -------------------------------------------------------------- tabs */

      .tabs {
        display: flex;
        gap: 4px;
        padding: 0 12px;
        border-bottom: 1px solid var(--border);
      }

      .tabs button {
        border: 0;
        background: transparent;
        color: var(--ink-3);
        font-weight: 600;
        font-size: 13px;
        padding: 10px 8px;
        border-bottom: 2px solid transparent;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .tabs button.on {
        color: var(--ink);
        border-bottom-color: var(--ink);
      }

      .pill {
        background: var(--danger);
        color: #fff;
        border-radius: 9px;
        font-size: 10px;
        padding: 1px 6px;
      }

      .notice {
        margin: 0;
        padding: 10px 16px;
        color: var(--ink-3);
        background: var(--bg);
        border-bottom: 1px solid var(--border);
      }

      /* ------------------------------------------------------------- rows */

      .rows {
        flex: 1;
        overflow-y: auto;
        padding: 6px 0 20px;
        min-height: 0;
      }

      .row-btn {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--ink);
        text-align: left;
        padding: 8px 16px;
      }

      .row-btn:hover {
        background: var(--border-soft);
      }

      .row-btn.active {
        background: var(--border-soft);
      }

      .row-btn.unread .strong,
      .row-btn.unread .preview {
        color: var(--ink);
        font-weight: 600;
      }

      .av-wrap {
        position: relative;
        flex: none;
      }

      .stack {
        position: absolute;
        right: -6px;
        bottom: -4px;
        border-radius: 50%;
        border: 2px solid var(--surface);
      }

      .dot {
        position: absolute;
        right: 0;
        bottom: 2px;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #31a24c;
        border: 2px solid var(--surface);
      }

      .blue-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--accent);
      }

      .trailing {
        align-items: flex-end;
        flex: none;
      }

      .preview {
        display: block;
      }

      .typing-text {
        color: var(--accent);
        font-style: normal;
      }

      /* ------------------------------------------------------------- pane */

      /* min-height:0 for the same reason as the row above: without it the thread inside refuses to
         shrink below its own content and the scroller never gets a bounded height. */
      .pane {
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .pad {
        padding: 14px 16px;
      }

      .token {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(0, 149, 246, 0.12);
        color: var(--accent);
        border-radius: 6px;
        padding: 3px 6px;
        font-size: 13px;
        font-weight: 600;
      }

      .token button {
        border: 0;
        background: transparent;
        color: inherit;
        padding: 0;
        line-height: 1;
      }

      .check {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1.5px solid var(--ink-4);
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
        color: #fff;
      }

      .check.on {
        background: var(--accent);
        border-color: var(--accent);
      }

      /* ------------------------------------------------------------ phone */

      @media (max-width: 900px) {
        .dm {
          grid-template-columns: 1fr;
          height: calc(100vh - 144px);
          /* The desktop rule borrows against the shell's bottom padding; down here the bottom bar is
             sitting in it, so there is nothing to borrow. */
          margin-bottom: 0;
          border: 0;
          border-radius: 0;
        }

        .list {
          border-right: 0;
        }

        /* One pane at a time: opening a thread replaces the list rather than squeezing it. */
        .dm.thread-open .list {
          display: none;
        }

        .dm:not(.thread-open) .pane {
          display: none;
        }
      }
    `,
  ],
})
export class MessagesComponent implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly auth = inject(Auth);
  protected readonly clock = inject(Clock);
  protected readonly messages = inject(Messages);
  private readonly realtime = inject(Realtime);

  protected readonly folder = signal<Folder>('inbox');
  protected readonly conversations = signal<Conversation[]>([]);
  protected readonly loading = signal(true);
  protected readonly notes = signal<Note[]>([]);

  protected readonly term = signal('');
  protected readonly candidates = signal<ChatCandidate[]>([]);
  protected readonly searching = signal(false);

  protected readonly composeOpen = signal(false);
  protected readonly composeTerm = signal('');
  protected readonly composeCandidates = signal<ChatCandidate[]>([]);
  protected readonly picked = signal<ChatCandidate[]>([]);
  protected groupName = '';

  protected readonly noteOpen = signal(false);
  protected noteText = '';
  protected noteCloseFriends = false;

  /** Which thread the outlet is showing, read off the URL rather than passed down. */
  protected readonly openId = signal<number | null>(null);
  protected readonly threadOpen = computed(() => this.openId() !== null);

  protected readonly myNote = computed(() => this.notes().find((n) => n.isMine) ?? null);
  protected readonly otherNotes = computed(() => this.notes().filter((n) => !n.isMine));

  private readonly typed = new Subject<string>();
  private readonly composeTyped = new Subject<string>();
  private timer?: ReturnType<typeof setInterval>;
  private readonly subscriptions: Subscription[] = [];

  constructor() {
    this.typed
      .pipe(
        debounceTime(260),
        distinctUntilChanged(),
        switchMap((q) => this.api.chatCandidates(q, 20)),
      )
      .subscribe({
        next: (people) => {
          this.searching.set(false);
          this.candidates.set(people);
        },
        error: () => this.searching.set(false),
      });

    this.composeTyped
      .pipe(
        debounceTime(260),
        distinctUntilChanged(),
        switchMap((q) => this.api.chatCandidates(q, 25)),
      )
      .subscribe({ next: (people) => this.composeCandidates.set(people) });

    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.readOpenId());
  }

  ngOnInit() {
    this.readOpenId();
    this.load();
    this.loadNotes();

    // A message, a reaction or a reconnection all mean the same thing to a list of threads: it is out
    // of date. auditTime collapses a burst into one refresh rather than one per event.
    this.subscriptions.push(
      merge(this.realtime.message$, this.realtime.messageChanged$, this.realtime.resynced$)
        .pipe(auditTime(400))
        .subscribe(() => {
          if (!this.term()) this.load(true);
        }),
    );

    // Typing shows on the row itself, the way it does in the real inbox.
    this.subscriptions.push(
      this.realtime.typing$.subscribe((event) => {
        this.conversations.update((all) =>
          all.map((c) => (c.id === event.conversationId ? { ...c, isTyping: true } : c)),
        );

        setTimeout(
          () =>
            this.conversations.update((all) =>
              all.map((c) => (c.id === event.conversationId ? { ...c, isTyping: false } : c)),
            ),
          4_000,
        );
      }),
    );

    // A green dot going on or off does not need the whole list refetched.
    this.subscriptions.push(
      this.realtime.presence$.subscribe((event) => {
        this.conversations.update((all) =>
          all.map((c) => ({
            ...c,
            participants: c.participants.map((p) =>
              p.id === event.userId ? { ...p, isOnline: event.online } : p,
            ),
          })),
        );
      }),
    );

    // The fallback, and only the fallback: while the socket is up this never fires a request.
    this.timer = setInterval(() => {
      if (!document.hidden && !this.term() && !this.realtime.connected()) {
        this.load(true);
      }
    }, 15_000);
  }

  ngOnDestroy() {
    clearInterval(this.timer);
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  protected setFolder(folder: Folder) {
    if (this.folder() === folder) return;

    this.folder.set(folder);
    this.conversations.set([]);
    this.load();
  }

  protected load(quiet = false) {
    if (!quiet) this.loading.set(true);

    this.api.inbox(this.folder()).subscribe({
      next: (page) => {
        this.loading.set(false);
        this.conversations.set(page.items);
      },
      error: () => this.loading.set(false),
    });

    this.messages.refresh();
  }

  private loadNotes() {
    this.api.notes().subscribe({ next: (notes) => this.notes.set(notes) });
  }

  private readOpenId() {
    const match = /\/messages\/(\d+)/.exec(this.router.url);
    this.openId.set(match ? Number(match[1]) : null);

    // Opening a thread clears its row without waiting for the next poll.
    if (match) {
      const id = Number(match[1]);
      this.conversations.update((all) =>
        all.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)),
      );
    }
  }

  // ------------------------------------------------------------------ search

  protected onSearch(value: string) {
    this.term.set(value);

    if (!value.trim()) {
      this.candidates.set([]);
      return;
    }

    this.searching.set(true);
    this.typed.next(value.trim());
  }

  protected clearSearch() {
    this.term.set('');
    this.candidates.set([]);
  }

  protected openWith(person: ChatCandidate) {
    if (person.hasThread && person.conversationId) {
      this.clearSearch();
      this.router.navigate(['/messages', person.conversationId]);
      return;
    }

    this.openWithUsername(person.username);
  }

  protected openWithUsername(username: string) {
    this.api.startChat([username]).subscribe({
      next: (chat) => {
        this.clearSearch();
        this.load(true);
        this.router.navigate(['/messages', chat.id]);
      },
      error: (error) => this.toasts.error(error.error?.message ?? 'Could not open that chat.'),
    });
  }

  // ----------------------------------------------------------------- compose

  protected openCompose() {
    this.composeOpen.set(true);
    this.picked.set([]);
    this.composeTerm.set('');
    this.groupName = '';

    this.api.chatCandidates('', 25).subscribe({ next: (people) => this.composeCandidates.set(people) });
  }

  protected onComposeSearch(value: string) {
    this.composeTerm.set(value);
    this.composeTyped.next(value.trim());
  }

  protected isPicked(person: ChatCandidate) {
    return this.picked().some((p) => p.id === person.id);
  }

  protected toggle(person: ChatCandidate) {
    this.picked.update((all) =>
      all.some((p) => p.id === person.id) ? all.filter((p) => p.id !== person.id) : [...all, person],
    );
  }

  protected startChat() {
    const usernames = this.picked().map((p) => p.username);
    if (usernames.length === 0) return;

    this.api.startChat(usernames, this.groupName.trim() || undefined).subscribe({
      next: (chat) => {
        this.composeOpen.set(false);
        this.load(true);
        this.router.navigate(['/messages', chat.id]);
      },
      error: (error) => this.toasts.error(error.error?.message ?? 'Could not start that chat.'),
    });
  }

  // ------------------------------------------------------------------- notes

  protected openNoteEditor() {
    const mine = this.myNote();
    this.noteText = mine?.text ?? '';
    this.noteCloseFriends = mine?.closeFriendsOnly ?? false;
    this.noteOpen.set(true);
  }

  protected saveNote() {
    const text = this.noteText.trim();
    if (!text) return;

    this.api.writeNote(text, this.noteCloseFriends).subscribe({
      next: () => {
        this.noteOpen.set(false);
        this.loadNotes();
        this.toasts.show('Note shared.');
      },
      error: (error) => this.toasts.error(error.error?.message ?? 'Could not share that note.'),
    });
  }

  protected deleteNote() {
    this.api.clearNote().subscribe({
      next: () => {
        this.noteOpen.set(false);
        this.loadNotes();
      },
    });
  }

  // ------------------------------------------------------------------ labels

  protected emptyTitle() {
    return {
      inbox: 'Your messages',
      requests: 'No message requests',
      spam: 'Nothing in spam',
    }[this.folder()];
  }

  protected emptyMessage() {
    return {
      inbox: 'Message someone you follow to start a conversation.',
      requests: 'Messages from people you do not follow land here first.',
      spam: 'Requests with one of your hidden words are filed here.',
    }[this.folder()];
  }
}

/** What the right-hand pane shows before a thread is picked. */
@Component({
  selector: 'app-chat-placeholder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="col center" style="height:100%;align-items:center;justify-content:center;padding:24px">
      <span class="ring"><i class="bi bi-send"></i></span>
      <h3 style="margin:16px 0 6px;font-weight:300;font-size:22px">Your messages</h3>
      <p class="muted small" style="max-width:280px;text-align:center;margin:0">
        Pick a conversation, or start a new one.
      </p>
    </div>
  `,
  styles: [
    `
      .ring {
        width: 92px;
        height: 92px;
        border-radius: 50%;
        border: 2px solid var(--ink);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 38px;
      }
    `,
  ],
})
export class ChatPlaceholderComponent {}
