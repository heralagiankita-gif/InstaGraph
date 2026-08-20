import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Post, PostMedia } from '../core/models';

/**
 * Sound, for every clip at once.
 *
 * Deliberately not per-card: unmuting one and having the next start silent again is the single most
 * irritating thing a video feed can do. Module-level rather than a service because it is a preference
 * about this session and nothing else needs to inject it.
 */
const soundOff = signal(true);

/**
 * The thing you actually look at: one photo, a swipeable run of up to ten, or a clip that plays itself.
 *
 * It is one component rather than three because from the outside they are the same object — a post has
 * media, and the number of items and what kind they are is a detail of the data, not a different feature
 * with a different card around it. Everything else in the app hands it a post and stops caring.
 *
 * Two behaviours are worth stating because they are the ones people notice when they are missing:
 *
 * - **The space is reserved before the file lands.** The container is sized from the stored aspect ratio,
 *   so the feed does not jump when an image decodes. Without it every card is laid out at a guessed
 *   height and then shoved down, and the post you were reading moves out from under you.
 * - **Only the clip on screen plays.** An `IntersectionObserver` starts the one in view and pauses every
 *   other, so scrolling past six reels does not leave six videos decoding at once.
 */
@Component({
  selector: 'app-post-media',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div
      class="frame"
      [class.reel]="fill()"
      [style.aspect-ratio]="fill() ? null : ratio()"
      (dblclick)="doubleTap.emit()"
      (touchstart)="onTouchStart($event)"
      (touchend)="onTouchEnd($event)">
      <div class="track" [style.transform]="'translateX(' + index() * -100 + '%)'">
        @for (item of items(); track item.position) {
          <div class="slide">
            @if (item.kind === 'Video') {
              <!-- Muted and inline: every browser refuses to autoplay a clip with sound, and iOS
                   refuses to play one at all unless it is told to stay inside its box. -->
              <video
                #player
                [attr.data-position]="item.position"
                [src]="url(item.url)"
                [poster]="item.posterUrl ? url(item.posterUrl) : null"
                [muted]="muted()"
                [loop]="true"
                playsinline
                preload="metadata"
                (click)="onVideoTap(item)"
                (timeupdate)="onProgress($event)"></video>

              @if (!playing() && index() === item.position) {
                <button type="button" class="glyph" (click)="onVideoTap(item)" aria-label="Play">
                  <i class="bi bi-play-fill"></i>
                </button>
              }
            } @else {
              <img
                [src]="url(item.url)"
                [alt]="alt()"
                loading="lazy"
                (click)="labelsOpen.set(!labelsOpen())" />
            }

            <!-- Labels are hidden until the photo is tapped, the same as the real one: they belong to
                 the photo, not on top of it. -->
            @if (labelsOpen()) {
              @for (tag of tagsFor(item.position); track tag.user.id) {
                <a
                  class="label"
                  [style.left.%]="tag.x * 100"
                  [style.top.%]="tag.y * 100"
                  [routerLink]="['/', tag.user.username]"
                  (click)="$event.stopPropagation()">
                  {{ tag.user.username }}
                </a>
              }
            }
          </div>
        }
      </div>

      @if (hasVideo() && index() === currentVideoPosition()) {
        <button type="button" class="chip sound" (click)="toggleMute()"
                [attr.aria-label]="muted() ? 'Unmute' : 'Mute'">
          <i class="bi" [class.bi-volume-mute-fill]="muted()" [class.bi-volume-up-fill]="!muted()"></i>
        </button>
      }

      @if (count() > 1) {
        <!-- The counter and the arrows are a desktop affordance; on a phone the swipe is the control. -->
        <span class="chip counter">{{ index() + 1 }}/{{ count() }}</span>

        @if (index() > 0) {
          <button type="button" class="arrow left" (click)="go(-1)" aria-label="Previous">
            <i class="bi bi-chevron-left"></i>
          </button>
        }

        @if (index() < count() - 1) {
          <button type="button" class="arrow right" (click)="go(1)" aria-label="Next">
            <i class="bi bi-chevron-right"></i>
          </button>
        }
      }

      @if (tagsFor(index()).length > 0 && !labelsOpen()) {
        <span class="chip tags" aria-hidden="true"><i class="bi bi-person-square"></i></span>
      }

      <ng-content />
    </div>

    @if (count() > 1) {
      <div class="dots">
        @for (item of items(); track item.position) {
          <button
            type="button"
            class="dot"
            [class.on]="item.position === index()"
            (click)="index.set(item.position)"
            [attr.aria-label]="'Go to item ' + (item.position + 1)"></button>
        }
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .frame {
        position: relative;
        overflow: hidden;
        background: #000;
        border: 1px solid var(--border-soft);
        border-radius: var(--radius-lg);
        /* A very tall photo is letterboxed rather than allowed to push the whole card off screen. */
        max-height: 680px;
      }

      /* Reels fill their container instead of being sized by the photo: the frame is the screen. */
      .frame.reel {
        height: 100%;
        max-height: none;
        border: 0;
        border-radius: 0;
      }

      .track {
        display: flex;
        height: 100%;
        transition: transform 0.28s var(--ease, cubic-bezier(0.4, 0, 0.2, 1));
        will-change: transform;
      }

      .slide {
        position: relative;
        flex: 0 0 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .slide img,
      .slide video {
        width: 100%;
        height: 100%;
        object-fit: contain;
        display: block;
      }

      .frame.reel .slide video,
      .frame.reel .slide img {
        object-fit: cover;
      }

      .glyph {
        position: absolute;
        inset: 0;
        margin: auto;
        width: 68px;
        height: 68px;
        border: 0;
        border-radius: 50%;
        background: rgba(0, 0, 0, 0.45);
        color: #fff;
        font-size: 34px;
        display: grid;
        place-items: center;
        pointer-events: none;
      }

      .chip {
        position: absolute;
        display: inline-grid;
        place-items: center;
        background: rgba(0, 0, 0, 0.6);
        color: #fff;
        border: 0;
        font-size: 12px;
        font-weight: 600;
        border-radius: 999px;
      }

      .counter {
        top: 12px;
        right: 12px;
        padding: 3px 9px;
      }

      .sound {
        bottom: 12px;
        right: 12px;
        width: 28px;
        height: 28px;
        font-size: 13px;
      }

      .tags {
        bottom: 12px;
        left: 12px;
        width: 26px;
        height: 26px;
        font-size: 12px;
      }

      .arrow {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.85);
        color: #262626;
        font-size: 14px;
        display: grid;
        place-items: center;
        opacity: 0;
        transition: opacity 0.15s var(--ease, ease);
      }

      .frame:hover .arrow {
        opacity: 1;
      }

      /* Nothing hovers on a touch screen, so there the arrows are simply always there. */
      @media (hover: none) {
        .arrow {
          opacity: 0.9;
        }
      }

      .arrow.left {
        left: 8px;
      }

      .arrow.right {
        right: 8px;
      }

      .label {
        position: absolute;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.72);
        color: #fff;
        font-size: 12px;
        font-weight: 600;
        padding: 5px 9px;
        border-radius: 4px;
        white-space: nowrap;
        max-width: 60%;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .dots {
        display: flex;
        justify-content: center;
        gap: 4px;
        padding: 8px 0 2px;
      }

      .dot {
        width: 6px;
        height: 6px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--border);
        transition:
          background 0.15s var(--ease, ease),
          transform 0.15s var(--ease, ease);
      }

      .dot.on {
        background: var(--accent, #0095f6);
        transform: scale(1.1);
      }
    `,
  ],
})
export class PostMediaComponent implements OnDestroy {
  private readonly api = inject(Api);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly post = input.required<Post>();

  /** Reels fill the screen; a feed card is sized by its photo. */
  readonly fill = input(false);

  /**
   * Whether this card is allowed to play at all. The reels feed sets it so that only the clip you have
   * swiped to plays, which a visibility test alone cannot decide when two are on screen at once.
   */
  readonly active = input(true);

  readonly doubleTap = output<void>();

  /** Emitted the first time a clip has played long enough to count as watched. */
  readonly watched = output<void>();

  protected readonly index = signal(0);
  protected readonly playing = signal(false);
  protected readonly labelsOpen = signal(false);

  protected readonly muted = soundOff;

  private readonly players = viewChildren<ElementRef<HTMLVideoElement>>('player');

  private observer?: IntersectionObserver;
  private visible = false;
  private counted = false;
  private touchX = 0;

  protected readonly items = computed<PostMedia[]>(() => {
    const media = this.post().media ?? [];

    // A post from before media became a list still has its single photo on the post itself. The server
    // already fills this in, so this is only ever reached by something built by hand in a test.
    return media.length > 0
      ? media
      : [
          {
            kind: 'Image',
            url: this.post().imageUrl,
            posterUrl: null,
            position: 0,
            aspectRatio: 1,
            durationMs: 0,
          },
        ];
  });

  protected readonly count = computed(() => this.items().length);
  protected readonly hasVideo = computed(() => this.items().some((m) => m.kind === 'Video'));
  protected readonly alt = computed(() => `Photo by ${this.post().author.username}`);

  /** Which slide holds the clip, so the sound button only appears while it is the one on screen. */
  protected readonly currentVideoPosition = computed(
    () => this.items().find((m) => m.kind === 'Video' && m.position === this.index())?.position ?? -1,
  );

  /**
   * The shape of the item on screen, clamped to the range Instagram itself allows — a 5:1 panorama would
   * otherwise be drawn as a letterbox slot two hundred pixels tall.
   */
  protected readonly ratio = computed(() => {
    const item = this.items()[this.index()] ?? this.items()[0];
    return Math.min(1.91, Math.max(0.6, item.aspectRatio || 1));
  });

  constructor() {
    // Playback follows three things at once: whether the card is on screen, whether the parent says it
    // is the active one, and which slide of the carousel is showing. Any of them changing has to be able
    // to start or stop the clip, so they are resolved in one place rather than three.
    effect(() => {
      this.index();
      this.active();
      this.sync();
    });

    this.observe();
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  protected url(path: string) {
    return this.api.imageUrl(path);
  }

  protected tagsFor(position: number) {
    return (this.post().tags ?? []).filter((tag) => tag.mediaPosition === position);
  }

  protected go(delta: number) {
    this.index.update((current) => Math.min(this.count() - 1, Math.max(0, current + delta)));
    this.labelsOpen.set(false);
  }

  protected toggleMute() {
    soundOff.set(!soundOff());

    // The binding covers elements yet to be created; the one already playing needs telling directly.
    for (const player of this.players()) {
      player.nativeElement.muted = soundOff();
    }
  }

  protected onVideoTap(item: PostMedia) {
    const player = this.playerAt(item.position);
    if (!player) return;

    if (player.paused) {
      void player.play().catch(() => undefined);
      this.playing.set(true);
    } else {
      player.pause();
      this.playing.set(false);
    }
  }

  /**
   * A play counts once the clip has actually been watched for a moment.
   *
   * Counting on `play` would count a clip that scrolled past in a tenth of a second, which is the thing
   * that makes view numbers meaningless. Three seconds, or the whole thing if it is shorter.
   */
  protected onProgress(event: Event) {
    if (this.counted) return;

    const player = event.target as HTMLVideoElement;
    const enough = Math.min(3, player.duration || 3);

    if (player.currentTime >= enough) {
      this.counted = true;
      this.watched.emit();
    }
  }

  // ------------------------------------------------------------------ swiping

  protected onTouchStart(event: TouchEvent) {
    this.touchX = event.changedTouches[0]?.clientX ?? 0;
  }

  protected onTouchEnd(event: TouchEvent) {
    if (this.count() < 2) return;

    const travelled = (event.changedTouches[0]?.clientX ?? 0) - this.touchX;

    // Forty pixels: below that it is a tap that wandered, not a swipe.
    if (Math.abs(travelled) > 40) {
      this.go(travelled < 0 ? 1 : -1);
    }
  }

  // ----------------------------------------------------------------- playback

  private observe() {
    if (typeof IntersectionObserver === 'undefined') {
      // No observer means no way to know what is on screen, so nothing plays by itself and the play
      // button does the work. Better than every clip in the feed running at once.
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        this.visible = entries[0]?.isIntersecting ?? false;
        this.sync();
      },
      // Half of the card has to be showing. A clip that is one row down has not been reached yet.
      { threshold: 0.5 },
    );

    this.observer.observe(this.host.nativeElement);
  }

  /** Starts the clip on the current slide if it should be running, and pauses everything else. */
  private sync() {
    const wanted = this.visible && this.active() ? this.index() : -1;

    for (const ref of this.players()) {
      const player = ref.nativeElement;
      const position = Number(player.dataset['position'] ?? -1);

      if (position === wanted) {
        player.muted = this.muted();
        void player.play().then(
          () => this.playing.set(true),
          // Autoplay refused — normal on a browser that wants a tap first. The play button is there.
          () => this.playing.set(false),
        );
      } else if (!player.paused) {
        player.pause();
        this.playing.set(false);
      }
    }
  }

  private playerAt(position: number): HTMLVideoElement | null {
    return (
      this.players().find((p) => Number(p.nativeElement.dataset['position']) === position)?.nativeElement ??
      null
    );
  }
}
