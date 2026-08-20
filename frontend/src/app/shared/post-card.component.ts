import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Comment, Post, UserSummary } from '../core/models';
import { Toasts } from '../core/toast.service';
import { Clock } from '../core/clock.service';
import { RichTextComponent } from './rich-text.component';
import { Prefs } from '../core/prefs.service';
import { ShareSheetComponent } from './share-sheet.component';
import { PostMediaComponent } from './post-media.component';
import { SaveSheetComponent } from './save-sheet.component';
import { AgoPipe, AvatarComponent, ExactDatePipe, VerifiedBadgeComponent } from './ui';

@Component({
  selector: 'app-post-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    DecimalPipe,
    AvatarComponent,
    AgoPipe,
    ExactDatePipe,
    RichTextComponent,
    ShareSheetComponent,
    PostMediaComponent,
    SaveSheetComponent,
    VerifiedBadgeComponent,
  ],
  template: `
    <article class="post">
      <header class="head">
        <a [routerLink]="['/', post().author.username]">
          <app-avatar [user]="post().author" [size]="32" />
        </a>

        <div class="col grow" style="min-width:0">
          <div class="row gap-4">
            <a class="username" [routerLink]="['/', post().author.username]">
              {{ post().author.username }}
            </a>
            <app-verified [user]="post().author" />

            @if (post().isPinned) {
              <i class="bi bi-pin-angle-fill tiny muted" title="Pinned to profile"></i>
            }

            <span class="tiny muted" [title]="post().createdAt | exact">
              • {{ post().createdAt | ago: clock.now() }}
            </span>
          </div>

          @if (post().location) {
            <span class="tiny muted">{{ post().location }}</span>
          }
        </div>

        <button class="more" type="button" (click)="menuOpen.set(!menuOpen())" aria-label="More options">
          <i class="bi bi-three-dots"></i>
        </button>
      </header>

      @if (post().suggestedReason) {
        <!-- Set by the API for posts that arrived from beyond the accounts you follow. -->
        <div class="suggested tiny muted">{{ post().suggestedReason }}</div>
      }

      <!-- One photo, ten photos or a clip: the card hands the post over and stops caring which. -->
      <app-post-media [post]="post()" (doubleTap)="onDoubleTap()" (watched)="countView()">
        @if (burst()) {
          <i class="bi bi-heart-fill burst"></i>
        }
      </app-post-media>

      <div class="actions">
        <button type="button" class="icon" (click)="toggleLike()" [attr.aria-label]="post().isLiked ? 'Unlike' : 'Like'">
          <i class="bi" [class.bi-heart-fill]="post().isLiked" [class.bi-heart]="!post().isLiked"
             [class.liked]="post().isLiked"></i>

          <!-- Six sparks, thrown once when the heart fills. Tracked by a counter rather than held in
               a boolean, so liking twice in a row builds a new element and replays the animation
               instead of reusing one that has already finished. -->
          @for (run of sparkRun(); track run) {
            <span class="confetti" aria-hidden="true">
              @for (spark of sparkAngles; track spark.a) {
                <i [style.--a]="spark.a + 'deg'" [style.--c]="spark.c"></i>
              }
            </span>
          }
        </button>

        @if (!post().commentsDisabled) {
          <a class="icon" [routerLink]="['/p', post().id]" aria-label="Comment">
            <i class="bi bi-chat"></i>
          </a>
        }

        <button type="button" class="icon" (click)="shareOpen.set(true)" aria-label="Share">
          <i class="bi bi-send"></i>
        </button>

        <span class="grow"></span>

        <button
          type="button"
          class="icon"
          (click)="toggleSave()"
          [attr.aria-label]="post().isSaved ? 'Remove from saved' : 'Save'">
          <i class="bi" [class.bi-bookmark-fill]="post().isSaved" [class.bi-bookmark]="!post().isSaved"></i>
        </button>
      </div>

      <div class="body">
        <!-- A reel is measured by how many people watched it, not by how many tapped the heart. -->
        @if (post().isReel && post().viewCount > 0) {
          <span class="strong small">{{ post().viewCount | number }} views</span>
        }

        <!-- Two different switches land here. "Hide like and share counts" is the viewer's own setting
             and applies to everybody's posts; hideCounts is the author's, on this one post. Either way
             the number goes and the list behind it stays — and the author still sees their own. -->
        @if (post().likeCount > 0 && !prefs.hideLikeCounts() && !(post().hideCounts && !post().isMine)) {
          <button type="button" class="likes strong" (click)="openLikes()">
            {{ post().likeCount | number }} {{ post().likeCount === 1 ? 'like' : 'likes' }}
          </button>
        } @else if (post().likeCount > 0) {
          <button type="button" class="likes strong" (click)="openLikes()">
            Liked by <span class="username">others</span>
          </button>
        }

        @if (post().caption) {
          <div class="caption" [class.clamped]="!captionOpen()">
            <a class="username" [routerLink]="['/', post().author.username]">{{ post().author.username }}</a>
            <app-rich-text [text]="post().caption" />
          </div>

          <!-- Only offered when there is something folded away: a caption of four words never gets a
               "more" it would do nothing to open. -->
          @if (!captionOpen() && longCaption()) {
            <button type="button" class="more-caption" (click)="captionOpen.set(true)">more</button>
          }
        }

        @if (post().commentsDisabled) {
          <span class="muted small block">Comments are turned off.</span>
        } @else if (post().commentCount > (post().previewComments.length || 0)) {
          <a class="muted small block" [routerLink]="['/p', post().id]">
            View all {{ post().commentCount | number }} comments
          </a>
        }

        @for (comment of previews(); track comment.id) {
          <div class="preview-comment">
            <a class="username" [routerLink]="['/', comment.author.username]">{{ comment.author.username }}</a>
            <app-rich-text [text]="comment.text" />
          </div>
        }
      </div>

      @if (!post().commentsDisabled) {
      <form class="comment-bar" (ngSubmit)="submitComment()">
        <input
          class="comment-input"
          name="comment"
          placeholder="Add a comment…"
          maxlength="1000"
          [ngModel]="draft()"
          (ngModelChange)="draft.set($event)" />

        @if (draft().trim()) {
          <button type="submit" class="btn-ghost strong" [disabled]="posting()">Post</button>
        }

        <div class="emoji-anchor">
          <button type="button" class="emoji" (click)="emojiOpen.set(!emojiOpen())" aria-label="Emoji">
            <i class="bi bi-emoji-smile"></i>
          </button>

          @if (emojiOpen()) {
            <div class="emoji-pad">
              @for (glyph of emojis; track glyph) {
                <button type="button" (click)="addEmoji(glyph)">{{ glyph }}</button>
              }
            </div>
          }
        </div>
      </form>
      }
    </article>

    @if (menuOpen()) {
      <div class="modal-backdrop" (click)="menuOpen.set(false)">
        <div class="modal menu" style="max-width:340px" (click)="$event.stopPropagation()">
          @if (post().isMine) {
            <button type="button" class="menu-item danger" (click)="remove()">Delete</button>
            <a class="menu-item" [routerLink]="['/p', post().id]" (click)="menuOpen.set(false)">Edit caption</a>

            <!-- Archiving is the softer thing a delete is not: off the grid, out of every feed, still
                 yours and still restorable. -->
            <button type="button" class="menu-item" (click)="archive()">Archive</button>

            <button type="button" class="menu-item" (click)="togglePin()">
              {{ post().isPinned ? 'Unpin from profile' : 'Pin to your profile' }}
            </button>
          } @else {
            <!-- Blocking deletes the edges both ways; muting keeps them and only hides the posts. -->
            <button type="button" class="menu-item danger" (click)="block()">
              Block {{ post().author.username }}
            </button>
            <button type="button" class="menu-item" (click)="mute()">Mute</button>
          }

          <a class="menu-item" [routerLink]="['/p', post().id]" (click)="menuOpen.set(false)">Go to post</a>
          <a class="menu-item" [routerLink]="['/', post().author.username]" (click)="menuOpen.set(false)">
            About this account
          </a>
          <button type="button" class="menu-item" (click)="toggleSave(); menuOpen.set(false)">
            {{ post().isSaved ? 'Remove from saved' : 'Save' }}
          </button>
          <button type="button" class="menu-item" (click)="menuOpen.set(false); collectOpen.set(true)">
            Save to collection
          </button>
          <button type="button" class="menu-item" (click)="copyLink(); menuOpen.set(false)">Copy link</button>
          <button type="button" class="menu-item" (click)="menuOpen.set(false)">Cancel</button>
        </div>
      </div>
    }

    @if (likesOpen()) {
      <div class="modal-backdrop" (click)="likesOpen.set(false)">
        <div class="modal" style="max-width:400px" (click)="$event.stopPropagation()">
          <div class="modal-head">Likes</div>

          <div style="padding:8px 16px 16px">
            @if (likers() === null) {
              <div class="spinner"></div>
            } @else {
              @for (person of likers()!; track person.id) {
                <a class="row gap-12" style="padding:7px 0" [routerLink]="['/', person.username]"
                   (click)="likesOpen.set(false)">
                  <app-avatar [user]="person" [size]="42" />
                  <span class="col">
                    <span class="username">{{ person.username }}</span>
                    <span class="tiny muted">{{ person.fullName }}</span>
                  </span>
                </a>
              }
            }
          </div>
        </div>
      </div>
    }

    @if (shareOpen()) {
      <app-share-sheet [postId]="post().id" (close)="shareOpen.set(false)" />
    }

    @if (collectOpen()) {
      <app-save-sheet
        [postId]="post().id"
        [alreadySaved]="post().isSaved"
        (saved)="changed.emit({ ...post(), isSaved: true })"
        (close)="collectOpen.set(false)" />
    }
  `,
  styles: [
    `
      /* No card: on the real thing a post is just a column of rows the width of the photo, with
         nothing drawn around it. The photo is the only thing with an edge. */
      .post {
        display: block;
        max-width: 470px;
        margin: 0 auto 16px;
      }

      .head {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 4px;
      }

      .more {
        border: 0;
        background: transparent;
        color: var(--ink);
        padding: 4px 6px;
        font-size: 16px;
      }

      .suggested {
        padding: 0 4px 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      /* The heart that lands on the photo after a double-tap. It overshoots, settles, then leaves —
         see the "bloom" keyframes in styles.css. */
      .burst {
        position: absolute;
        inset: 0;
        margin: auto;
        width: 104px;
        height: 104px;
        font-size: 104px;
        line-height: 1;
        color: #fff;
        filter: drop-shadow(0 4px 22px rgba(0, 0, 0, 0.5));
        animation: bloom 0.75s var(--spring) forwards;
        pointer-events: none;
      }

      /* The row of icons sits flush with the edge of the photo, so the first one is pulled back by
         exactly its own padding. */
      .actions {
        display: flex;
        align-items: center;
        gap: 0;
        padding: 6px 0 4px;
        margin-left: -4px;
      }

      .icon {
        /* The anchor for the sparks, which sit outside the button's own box. */
        position: relative;
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 24px;
        padding: 8px;
        line-height: 1;
        display: inline-flex;
      }

      .icon:hover {
        color: var(--accent);
      }

      .icon:hover i {
        transform: scale(1.12);
      }

      .icon:active i {
        transform: scale(0.82);
      }

      .icon i {
        transition: transform 0.2s var(--spring);
      }

      .icon .liked {
        color: var(--danger);
        animation: kick 0.4s var(--spring);
      }

      .icon:hover .liked {
        color: var(--danger);
      }

      /* Saving is the vibe's colour rather than ink: it is the only action on the row that is only
         ever about you, and it is worth being able to spot a saved card at a glance. */
      .icon .bi-bookmark-fill {
        color: var(--accent);
        animation: kick 0.4s var(--spring);
      }

      .likes {
        border: 0;
        background: transparent;
        color: var(--ink);
        padding: 0;
        font-weight: 600;
        font-size: 14px;
        align-self: flex-start;
      }

      .likes:hover {
        color: var(--ink-3);
      }

      .body {
        padding: 0 4px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      /* Two lines of caption, then "more" — expanding is a one-way door, the same as the real one. */
      .caption.clamped {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .more-caption {
        border: 0;
        background: transparent;
        color: var(--ink-3);
        padding: 0;
        font-size: 14px;
      }

      .caption span,
      .preview-comment span {
        white-space: pre-wrap;
      }

      .caption .username,
      .preview-comment .username {
        margin-right: 5px;
      }

      .tag {
        color: color-mix(in srgb, var(--accent) 74%, var(--ink));
      }

      .block {
        display: block;
      }

      .comment-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        border-top: 1px solid var(--border-soft);
        margin-top: 8px;
        padding: 4px 4px 0;
      }

      .emoji-anchor {
        position: relative;
      }

      .emoji {
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 16px;
        padding: 6px 2px;
        line-height: 1;
        display: inline-flex;
      }

      /* Eight glyphs is what the real picker opens on, and enough to be worth the button. */
      .emoji-pad {
        position: absolute;
        bottom: calc(100% + 8px);
        right: 0;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 2px;
        padding: 6px;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        box-shadow: var(--shadow-md);
        z-index: 5;
      }

      .emoji-pad button {
        border: 0;
        background: transparent;
        font-size: 20px;
        line-height: 1;
        padding: 5px;
        border-radius: 6px;
      }

      .emoji-pad button:hover {
        background: var(--hover);
      }

      .comment-input {
        flex: 1;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--ink);
        font-family: inherit;
        font-size: 14px;
        padding: 8px 0;
      }

      .comment-input::placeholder {
        color: var(--ink-4);
      }

      .menu {
        padding: 0;
        overflow: hidden;
      }

      .menu-item {
        display: block;
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--ink);
        padding: 14px;
        font-size: 14px;
        text-align: center;
        border-bottom: 1px solid var(--border);
      }

      .menu-item:last-child {
        border-bottom: 0;
      }

      .menu-item:hover {
        background: var(--border-soft);
      }

      .menu-item.danger {
        color: var(--danger);
        font-weight: 600;
      }
    `,
  ],
})
export class PostCardComponent {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  /** Read in the template so relative timestamps re-render as time passes. */
  protected readonly clock = inject(Clock);

  /** Only one setting reaches this far: whether like counts are drawn at all. */
  protected readonly prefs = inject(Prefs);

  readonly post = input.required<Post>();

  /** The parent owns the list, so changes are handed back rather than mutated in place. */
  readonly changed = output<Post>();
  readonly deleted = output<number>();

  /** Emitted with a username when everything by that author should leave the list. */
  readonly hidden = output<string>();

  protected readonly draft = signal('');
  protected readonly posting = signal(false);
  protected readonly menuOpen = signal(false);
  protected readonly burst = signal(false);
  protected readonly likesOpen = signal(false);
  protected readonly shareOpen = signal(false);
  protected readonly collectOpen = signal(false);
  protected readonly likers = signal<UserSummary[] | null>(null);
  protected readonly captionOpen = signal(false);
  protected readonly emojiOpen = signal(false);

  /** The eight the real picker opens on. */
  protected readonly emojis = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];

  /**
   * At most one entry, holding the id of the burst currently playing. Empty the rest of the time, so
   * a feed of forty cards carries no spark elements at all until somebody taps one.
   */
  protected readonly sparkRun = signal<number[]>([]);

  /** Where each spark flies and what colour it is. Fixed rather than random: six evenly spaced sparks
      read as a burst, and six randomly placed ones read as a mistake. */
  protected readonly sparkAngles = [
    { a: -90, c: '#ff4d6d' },
    { a: -40, c: '#ffb03a' },
    { a: 10, c: '#4ad9ff' },
    { a: 60, c: '#b06bff' },
    { a: 130, c: '#ff4d6d' },
    { a: -160, c: '#37e39b' },
  ];

  private sparkSeq = 0;
  private sparkTimer?: ReturnType<typeof setTimeout>;

  protected readonly previews = computed(() => this.post().previewComments ?? []);

  /**
   * Roughly two lines at the width of a post. Measuring the rendered height would be exact, but it
   * would also mean a layout read on every card in the feed for a button that says "more".
   */
  protected readonly longCaption = computed(() => {
    const caption = this.post().caption ?? '';
    return caption.length > 125 || caption.includes('\n');
  });

  /**
   * A clip has been watched. Counted server-side once per viewer, so this fires and forgets — the number
   * on screen is not worth a re-render and the failure of a view count is not worth telling anybody about.
   */
  protected countView() {
    this.api.viewPost(this.post().id).subscribe({ error: () => undefined });
  }

  /** Off the grid and out of every feed, without destroying anything. */
  protected archive() {
    this.menuOpen.set(false);
    const id = this.post().id;

    this.api.archivePost(id).subscribe({
      next: () => {
        // Archiving is the one destructive-feeling action here that is genuinely reversible, so it is
        // the one that can honestly offer to take it back. Deleting cannot, and does not pretend to.
        // The card is gone by the time Undo can be pressed, so this deliberately reports the result
        // rather than emitting it: an output from a destroyed card reaches nobody. The post is back
        // server-side and returns with the next load, which is the same reason the feed offers a
        // refresh pill instead of splicing a new post into a ranking it was not scored against.
        this.toasts.show('Moved to your archive.', false, {
          label: 'Undo',
          run: () =>
            this.api.unarchivePost(id).subscribe({
              next: () => this.toasts.show('Back on your profile. Refresh to see it in the feed.'),
              error: (err) =>
                this.toasts.error(err.error?.message ?? 'Could not put that post back.'),
            }),
        });

        this.deleted.emit(id);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not archive that post.'),
    });
  }

  protected togglePin() {
    this.menuOpen.set(false);
    const current = this.post();
    const pinning = !current.isPinned;

    const request = pinning ? this.api.pinPost(current.id) : this.api.unpinPost(current.id);

    request.subscribe({
      next: (updated) => {
        this.changed.emit(updated);
        this.toasts.show(pinning ? 'Pinned to your profile.' : 'Unpinned.');
      },
      // The three-pin limit is refused by the server, and its wording is the useful one.
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not pin that post.'),
    });
  }

  protected addEmoji(glyph: string) {
    this.draft.update((text) => text + glyph);
    this.emojiOpen.set(false);
  }

  /** Hides the card from the list once its author is blocked or muted. */
  protected block() {
    const author = this.post().author.username;
    this.menuOpen.set(false);

    this.api.block(author).subscribe({
      next: () => {
        this.toasts.show(`Blocked ${author}.`);
        this.hidden.emit(author);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not block that account.'),
    });
  }

  protected mute() {
    const author = this.post().author.username;
    this.menuOpen.set(false);

    this.api.mute(author).subscribe({
      next: () => {
        this.toasts.show(`Muted ${author}. You still follow them.`);
        this.hidden.emit(author);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not mute that account.'),
    });
  }

  /**
   * Optimistic: the heart fills and the count moves immediately, then the server confirms it.
   *
   * A round trip is 30–80ms on localhost and far more on a real network — long enough that waiting for
   * it makes the tap feel broken. If the call fails the previous state is put back and the person is
   * told, which is the only honest way to be optimistic.
   */
  protected toggleLike() {
    const current = this.post();
    const liking = !current.isLiked;

    // Only on the way in. Sparks on an unlike would celebrate the wrong thing.
    if (liking) this.throwSparks();

    this.changed.emit({
      ...current,
      isLiked: liking,
      likeCount: Math.max(0, current.likeCount + (liking ? 1 : -1)),
    });

    const request = liking ? this.api.like(current.id) : this.api.unlike(current.id);

    request.subscribe({
      // The server is the authority on the count — somebody else may have liked it in the meantime.
      next: (result) =>
        this.changed.emit({ ...current, isLiked: result.isLiked, likeCount: result.likeCount }),
      error: (err) => {
        this.changed.emit(current);
        this.toasts.error(err.error?.message ?? 'Could not update that like.');
      },
    });
  }

  /** Saving is private — nobody is told, and it changes nothing on the post itself. */
  protected toggleSave() {
    const current = this.post();
    const saving = !current.isSaved;

    this.changed.emit({ ...current, isSaved: saving });

    const request = saving ? this.api.save(current.id) : this.api.unsave(current.id);

    request.subscribe({
      next: () => this.toasts.show(saving ? 'Saved.' : 'Removed from saved.'),
      error: (err) => {
        this.changed.emit(current);
        this.toasts.error(err.error?.message ?? 'Could not save that post.');
      },
    });
  }

  protected openLikes() {
    this.likesOpen.set(true);
    this.likers.set(null);

    this.api.likedBy(this.post().id).subscribe({
      next: (page) => this.likers.set(page.items),
      error: () => this.likers.set([]),
    });
  }

  protected onDoubleTap() {
    if (this.post().isLiked) {
      // Double-tapping something already liked should not unlike it — that is a way to lose a like by
      // accident. Show the heart, change nothing.
      this.flash();
      return;
    }

    this.flash();
    this.toggleLike();
  }

  private flash() {
    this.burst.set(true);
    setTimeout(() => this.burst.set(false), 750);
  }

  /** Replaces whatever burst is on screen with a fresh one, and takes it away when it has finished. */
  private throwSparks() {
    clearTimeout(this.sparkTimer);
    this.sparkRun.set([++this.sparkSeq]);
    this.sparkTimer = setTimeout(() => this.sparkRun.set([]), 650);
  }

  protected submitComment() {
    const text = this.draft().trim();
    if (!text || this.posting()) return;

    this.posting.set(true);
    const current = this.post();

    this.api.addComment(current.id, text).subscribe({
      next: (comment: Comment) => {
        this.draft.set('');
        this.posting.set(false);
        this.changed.emit({
          ...current,
          commentCount: current.commentCount + 1,
          previewComments: [...current.previewComments, comment].slice(-2),
        });
      },
      error: (err) => {
        this.posting.set(false);
        this.toasts.error(err.error?.message ?? 'Could not post that comment.');
      },
    });
  }

  protected remove() {
    this.menuOpen.set(false);
    const id = this.post().id;

    this.api.deletePost(id).subscribe({
      next: () => {
        this.toasts.show('Post deleted.');
        this.deleted.emit(id);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not delete that post.'),
    });
  }

  protected copyLink() {
    const url = `${location.origin}/p/${this.post().id}`;

    navigator.clipboard?.writeText(url).then(
      () => this.toasts.show('Link copied.'),
      // Clipboard access is blocked outside a secure context, so fall back to simply going there.
      () => this.router.navigate(['/p', this.post().id]),
    );
  }
}
