import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Post } from '../../core/models';
import { Toasts } from '../../core/toast.service';
import { RichTextComponent } from '../../shared/rich-text.component';
import { ShareSheetComponent } from '../../shared/share-sheet.component';
import { PostMediaComponent } from '../../shared/post-media.component';
import { AvatarComponent, VerifiedBadgeComponent } from '../../shared/ui';

/**
 * Reels: one clip at a time, full height, swiped vertically.
 *
 * The scrolling is CSS rather than JavaScript — `scroll-snap-type: y mandatory` on the column and
 * `scroll-snap-align: start` on each slide. A hand-written scroll handler would have to fight the
 * browser's own momentum on every platform separately, and lose on at least one of them.
 *
 * What is not left to CSS is which clip is allowed to play. A scroll listener works out which slide is
 * centred and marks it active; every other card is told it is not, and pauses. Without that, six clips
 * decode at once and the fan comes on.
 */
@Component({
  selector: 'app-reels',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DecimalPipe,
    PostMediaComponent,
    AvatarComponent,
    VerifiedBadgeComponent,
    RichTextComponent,
    ShareSheetComponent,
  ],
  template: `
    <!-- The page follows the theme like every other screen. Only the 9:16 stage stays black, because
         that is the letterbox a clip is projected onto, not page background — which is why anything
         drawn ON the stage (the overlay, the rail, the bar over a full-bleed clip) is still given
         light-on-dark colours, while anything drawn on the page itself uses the theme. -->
    <header class="bar">
      <span class="wordmark">Reels</span>
      <a class="cam" routerLink="/create" aria-label="Post a video"><i class="bi bi-camera-video"></i></a>
    </header>

    <div class="reels" #scroller (scroll)="onScroll()" (keydown)="onKey($event)" tabindex="0">
      @for (reel of items(); track reel.id; let i = $index) {
        <section class="slide">
          <div class="stage">
            <app-post-media
              [post]="reel"
              [fill]="true"
              [active]="i === active()"
              (doubleTap)="onDoubleTap(reel)"
              (watched)="countView(reel)" />

            <!-- The author and caption sit over the clip rather than under it: on a full-height video
                 there is no "under". -->
            <div class="overlay">
              <div class="row gap-8">
                <a [routerLink]="['/', reel.author.username]">
                  <app-avatar [user]="reel.author" [size]="32" />
                </a>
                <a class="username light" [routerLink]="['/', reel.author.username]">
                  {{ reel.author.username }}
                </a>
                <app-verified [user]="reel.author" />

                <!-- Instagram puts Follow right on the clip, because the whole point of the surface is
                     showing people you have not followed yet. Drawn only when the API actually said
                     which way the edge runs; null means it did not, and no button is better than a
                     wrong one. -->
                @if (reel.authorIsFollowed === false) {
                  <button type="button" class="follow" (click)="follow(reel)">Follow</button>
                } @else if (reel.authorIsFollowed === true) {
                  <span class="following tiny">Following</span>
                }
              </div>

              @if (reel.caption) {
                <div class="caption light" [class.clamped]="expanded() !== reel.id">
                  <app-rich-text [text]="reel.caption" />
                </div>

                @if (expanded() !== reel.id && reel.caption.length > 90) {
                  <button type="button" class="more" (click)="expanded.set(reel.id)">more</button>
                }
              }

              @if (reel.location) {
                <span class="tiny light"><i class="bi bi-geo-alt"></i> {{ reel.location }}</span>
              }
            </div>

            <!-- The rail of controls down the right-hand edge, in the order the real one uses. -->
            <div class="rail">
              <button type="button" (click)="toggleLike(reel)" [attr.aria-label]="reel.isLiked ? 'Unlike' : 'Like'">
                <i class="bi" [class.bi-heart-fill]="reel.isLiked" [class.bi-heart]="!reel.isLiked"
                   [class.liked]="reel.isLiked"></i>
                @if (!reel.hideCounts || reel.isMine) {
                  <span class="tiny">{{ reel.likeCount | number }}</span>
                }
              </button>

              @if (!reel.commentsDisabled) {
                <a [routerLink]="['/p', reel.id]" aria-label="Comments">
                  <i class="bi bi-chat"></i>
                  <span class="tiny">{{ reel.commentCount | number }}</span>
                </a>
              }

              <button type="button" (click)="sharing.set(reel.id)" aria-label="Share">
                <i class="bi bi-send"></i>
              </button>

              <button
                type="button"
                (click)="toggleSave(reel)"
                [attr.aria-label]="reel.isSaved ? 'Remove from saved' : 'Save'">
                <i class="bi" [class.bi-bookmark-fill]="reel.isSaved" [class.bi-bookmark]="!reel.isSaved"></i>
              </button>

              @if (!reel.hideCounts || reel.isMine) {
                <span class="views tiny">
                  <i class="bi bi-play"></i>
                  {{ reel.viewCount | number }}
                </span>
              }
            </div>
          </div>
        </section>
      }

      @if (loading() && items().length === 0) {
        <div class="slide centred">
          <div class="reel-spinner"></div>
        </div>
      }

      @if (!loading() && items().length === 0) {
        <div class="slide centred">
          <div class="blank">
            <span class="blank-ring"><i class="bi bi-play-btn"></i></span>
            <h3>No reels yet</h3>
            <p>Post a video and it shows up here.</p>
            <a class="btn" routerLink="/create"><i class="bi bi-camera-video"></i> Post a video</a>
            <a class="ghost" routerLink="/discover">Find people to follow</a>
          </div>
        </div>
      }
    </div>

    @if (sharing(); as id) {
      <app-share-sheet [postId]="id" (close)="sharing.set(null)" />
    }
  `,
  styles: [
    `
      :host {
        display: block;
        /* The shell pads its content area. A screen that is meant to *be* the screen has to undo that,
           by exactly the amount the shell uses — hence the second rule at its own breakpoint. */
        margin: -28px -20px -60px;
      }

      @media (max-width: 767px) {
        :host {
          /* Matches the shell's mobile padding exactly, insets included, so the clip runs edge to edge
             under the bars instead of leaving a band of page background above and below it. */
          margin: calc((60px + env(safe-area-inset-top)) * -1) 0 calc((60px + env(safe-area-inset-bottom)) * -1);
        }
      }

      .bar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 18px;
        padding-top: max(14px, env(safe-area-inset-top));
        color: var(--ink);
        pointer-events: none;
      }

      .bar .wordmark {
        font-size: 24px;
      }

      .bar .cam {
        color: var(--ink);
        font-size: 22px;
        pointer-events: auto;
      }

      /* Below this width the stage fills the window, so the bar is no longer over the page — it is
         over the clip, and has to be readable against whatever frame is playing underneath it. */
      @media (max-width: 767px) {
        .bar {
          color: #fff;
          /* Fades out rather than sitting on a bar, so the clip is never boxed in at the top. */
          background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0));
        }

        .bar .cam {
          color: #fff;
        }
      }

      .reels {
        height: 100dvh;
        overflow-y: auto;
        outline: none;
        scroll-snap-type: y mandatory;
        background: var(--bg);
        /* Hidden rather than styled: a scrollbar on a full-bleed video feed is only ever noise. */
        scrollbar-width: none;
      }

      .reels::-webkit-scrollbar {
        display: none;
      }

      .slide {
        height: 100dvh;
        scroll-snap-align: start;
        scroll-snap-stop: always;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .slide.centred {
        color: var(--ink);
        padding: 24px;
      }

      /* With no reels there is no stage either, so this sits on the page — and takes the theme. */
      .blank {
        max-width: 320px;
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }

      .blank-ring {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        font-size: 34px;
        color: var(--brand-ink);
        background: var(--brand);
        box-shadow: 0 14px 36px -14px var(--glow);
        margin-bottom: 4px;
      }

      .blank h3 {
        margin: 0;
        font-family: var(--display);
        font-size: 22px;
        font-weight: 800;
        letter-spacing: -0.03em;
        color: var(--ink);
      }

      .blank p {
        margin: 0 0 6px;
        font-size: 13px;
        line-height: 1.5;
        color: var(--ink-3);
      }

      .blank .ghost {
        color: var(--ink-2);
        font-size: 13px;
        font-weight: 600;
      }

      .reel-spinner {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid var(--border);
        border-top-color: var(--accent);
        animation: spin 0.8s linear infinite;
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }

      /* 9:16 is the shape a reel is shot in, so the stage is capped to it rather than stretching one
         clip across a monitor. It stays black in every theme: this is the letterbox the clip is
         projected onto, and a light band around a dark frame is what every video player does. */
      .stage {
        position: relative;
        height: 100%;
        aspect-ratio: 9 / 16;
        max-width: 100%;
        background: #000;
        overflow: hidden;
      }

      /* Wide enough that the stage no longer fills the window, so it needs to read as a deliberate
         frame sitting on the page rather than as a black stripe down the middle of it. */
      @media (min-width: 768px) {
        .stage {
          height: calc(100% - 32px);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-lg);
        }
      }

      .stage app-post-media {
        height: 100%;
      }

      .overlay {
        position: absolute;
        left: 0;
        right: 64px;
        bottom: 0;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        /* A gradient rather than a panel: the words have to be readable over a bright frame without
           putting a grey slab across the bottom third of every clip. */
        background: linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0));
        pointer-events: none;
      }

      .overlay a,
      .overlay button {
        pointer-events: auto;
      }

      .light {
        color: #fff;
      }

      .follow {
        border: 1px solid rgba(255, 255, 255, 0.7);
        background: transparent;
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        padding: 4px 12px;
        border-radius: var(--pill);
      }

      .follow:hover {
        background: rgba(255, 255, 255, 0.15);
      }

      .following {
        color: rgba(255, 255, 255, 0.65);
        font-weight: 600;
      }

      .caption {
        font-size: 14px;
        line-height: 1.4;
      }

      .caption.clamped {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .more {
        border: 0;
        background: transparent;
        color: rgba(255, 255, 255, 0.75);
        padding: 0;
        font-size: 13px;
        align-self: flex-start;
      }

      .rail {
        position: absolute;
        right: 6px;
        bottom: 16px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 18px;
      }

      /* Each action sits in its own frosted disc rather than floating loose on the video: over a
         bright frame a bare white glyph disappears no matter how much shadow it is given. */
      .rail button,
      .rail a {
        border: 0;
        background: transparent;
        color: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        font-size: 25px;
        line-height: 1;
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
        transition: transform 0.2s var(--spring);
      }

      .rail button:hover,
      .rail a:hover {
        transform: scale(1.1);
      }

      .rail button:active,
      .rail a:active {
        transform: scale(0.88);
      }

      .rail button > i:first-child,
      .rail a > i:first-child {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: rgba(255, 255, 255, 0.16);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }

      .rail .liked {
        color: var(--danger, #ed4956);
      }

      .rail .tiny {
        font-size: 11px;
        font-weight: 600;
      }

      .views {
        color: #fff;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        font-size: 20px;
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
      }
    `,
  ],
})
export class ReelsComponent {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  protected readonly items = signal<Post[]>([]);
  protected readonly loading = signal(true);
  protected readonly active = signal(0);
  protected readonly expanded = signal<number | null>(null);
  protected readonly sharing = signal<number | null>(null);

  private page = 1;
  private more = true;

  constructor() {
    this.load();
  }

  private load() {
    if (!this.more && this.page > 1) return;

    this.loading.set(true);

    this.api.reels(this.page).subscribe({
      next: (result) => {
        this.items.update((list) => [...list, ...result.items]);
        this.more = result.hasMore;
        this.page++;
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /**
   * Works out which slide is centred, and pulls the next page in before the bottom is reached.
   *
   * Rounding rather than measuring each child: every slide is exactly one viewport tall, so the index is
   * the scroll position divided by that height, and there is no reason to ask the layout engine.
   */
  protected onScroll() {
    const element = this.scroller().nativeElement;
    const height = element.clientHeight || 1;
    const index = Math.round(element.scrollTop / height);

    if (index !== this.active()) {
      this.active.set(index);
    }

    // Two clips from the end. Any later and the swipe lands on a blank screen while the request runs.
    if (!this.loading() && this.more && index >= this.items().length - 2) {
      this.load();
    }
  }

  private replace(updated: Post) {
    this.items.update((list) => list.map((item) => (item.id === updated.id ? updated : item)));
  }

  protected onDoubleTap(reel: Post) {
    // Double-tapping something already liked must not unlike it — that is a way to lose a like by
    // accident on a gesture people make without looking.
    if (!reel.isLiked) {
      this.toggleLike(reel);
    }
  }

  protected toggleLike(reel: Post) {
    const liking = !reel.isLiked;

    // Optimistic: a round trip is long enough that waiting for it makes the tap feel broken.
    this.replace({ ...reel, isLiked: liking, likeCount: Math.max(0, reel.likeCount + (liking ? 1 : -1)) });

    const request = liking ? this.api.like(reel.id) : this.api.unlike(reel.id);

    request.subscribe({
      next: (result) => this.replace({ ...reel, isLiked: result.isLiked, likeCount: result.likeCount }),
      error: (err) => {
        this.replace(reel);
        this.toasts.error(err.error?.message ?? 'Could not update that like.');
      },
    });
  }

  protected toggleSave(reel: Post) {
    const saving = !reel.isSaved;
    this.replace({ ...reel, isSaved: saving });

    const request = saving ? this.api.save(reel.id) : this.api.unsave(reel.id);

    request.subscribe({
      next: () => this.toasts.show(saving ? 'Saved.' : 'Removed from saved.'),
      error: (err) => {
        this.replace(reel);
        this.toasts.error(err.error?.message ?? 'Could not save that reel.');
      },
    });
  }

  protected follow(reel: Post) {
    // Optimistic, and put back if the server disagrees — the same shape every other follow in the app
    // uses. A private account answers with followRequested instead, which is not "following" and must
    // not be painted as though it were.
    this.replace({ ...reel, authorIsFollowed: true });

    this.api.follow(reel.author.username).subscribe({
      next: (result) => {
        this.replace({ ...reel, authorIsFollowed: result.isFollowing });

        if (result.followRequested) {
          this.toasts.show(`Requested to follow ${reel.author.username}.`);
        }
      },
      error: (err) => {
        this.replace(reel);
        this.toasts.error(err.error?.message ?? 'Could not follow that account.');
      },
    });
  }

  /** Up and down move a reel on a desktop keyboard; the snap column does the rest. */
  protected onKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();

    const element = this.scroller().nativeElement;
    const step = element.clientHeight;

    element.scrollBy({ top: event.key === 'ArrowDown' ? step : -step, behavior: 'smooth' });
  }

  protected countView(reel: Post) {
    this.api.viewPost(reel.id).subscribe({
      // The count on screen is the server's answer, so a watch that lands is reflected without a reload.
      next: (viewCount) => this.replace({ ...reel, viewCount }),
      error: () => undefined,
    });
  }
}
