import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Story, StoryTray, StoryViewer } from '../../core/models';
import { Toasts } from '../../core/toast.service';
import { AgoPipe, AvatarComponent } from '../../shared/ui';
import { Clock } from '../../core/clock.service';

/** How long one photo is held before it moves on, in milliseconds. */
const SEGMENT_MS = 5000;

/** How often the progress bar repaints. Sixty milliseconds is smooth and costs nothing. */
const TICK_MS = 60;

/**
 * The full-screen story player.
 *
 * <p>
 * It plays one account at a time and then moves to the next, which is the behaviour worth getting right:
 * the segmented bar across the top belongs to the <em>current account</em>, not to the whole tray, so you
 * always know how much of this person is left rather than how much of everybody is left.
 * </p>
 *
 * <p>
 * Tap the right half to advance, the left half to go back, hold anywhere to pause. Replying opens a
 * direct message that carries the story it answers — and goes through the same request gate every other
 * message does, so answering a story from somebody who does not follow you back lands in their requests.
 * </p>
 */
@Component({
  selector: 'app-story-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AvatarComponent, AgoPipe],
  template: `
    @if (currentTray(); as tray) {
      <div class="viewer" (pointerdown)="hold()" (pointerup)="release()" (pointercancel)="release()">
        <!-- ------------------------------------------------------- progress -->
        <div class="bars">
          @for (story of tray.stories; track story.id; let i = $index) {
            <span class="bar">
              <span
                class="fill"
                [style.width.%]="i < index() ? 100 : i === index() ? progress() : 0"></span>
            </span>
          }
        </div>

        <!-- --------------------------------------------------------- header -->
        <header class="head">
          <a class="row gap-8 grow" [routerLink]="['/', tray.user.username]" (click)="close.emit()">
            <app-avatar [user]="tray.user" [size]="34" />
            <span class="row gap-8" style="min-width:0">
              <span class="strong white ellipsis">{{ tray.user.username }}</span>
              @if (current(); as story) {
                <span class="tiny faint">{{ story.createdAt | ago: clock.now() }}</span>
                @if (story.closeFriendsOnly) {
                  <span class="close-badge tiny"><i class="bi bi-star-fill"></i> Close friends</span>
                }
              }
            </span>
          </a>

          @if (current(); as story) {
            @if (story.isMine) {
              <button type="button" class="plain" (click)="remove(story)" title="Delete">
                <i class="bi bi-trash"></i>
              </button>
            }
          }

          <button type="button" class="plain" (click)="togglePause()" [title]="paused() ? 'Play' : 'Pause'">
            <i class="bi" [class.bi-play-fill]="paused()" [class.bi-pause-fill]="!paused()"></i>
          </button>

          <button type="button" class="plain" (click)="close.emit()" title="Close">
            <i class="bi bi-x-lg"></i>
          </button>
        </header>

        <!-- ---------------------------------------------------------- photo -->
        @if (current(); as story) {
          <div class="stage">
            <img [src]="api.imageUrl(story.imageUrl)" [alt]="'Story by ' + tray.user.username" />

            @if (story.caption) {
              <p class="caption">{{ story.caption }}</p>
            }
          </div>

          <!-- Halves rather than arrows: the whole surface is the control, as it is on a phone. -->
          <button type="button" class="half left" (click)="previous()" aria-label="Previous"></button>
          <button type="button" class="half right" (click)="next()" aria-label="Next"></button>

          <!-- ------------------------------------------------------- footer -->
          <footer class="foot" (pointerdown)="$event.stopPropagation()">
            @if (story.isMine) {
              <button type="button" class="viewers" (click)="openViewers(story)">
                <i class="bi bi-eye"></i>
                {{ story.viewCount }} {{ story.viewCount === 1 ? 'view' : 'views' }}
              </button>
            } @else {
              <form class="reply" (ngSubmit)="send(story)">
                <input
                  class="bare"
                  [placeholder]="'Reply to ' + tray.user.username + '…'"
                  [ngModel]="draft()"
                  (ngModelChange)="onDraft($event)"
                  name="reply"
                  autocomplete="off" />

                @if (draft().trim()) {
                  <button type="submit" class="send" [disabled]="sending()">Send</button>
                } @else {
                  <button type="button" class="send heart" aria-label="Send a heart" (click)="quickHeart(story)">
                    <i class="bi bi-heart"></i>
                  </button>
                }
              </form>
            }
          </footer>
        }

        <!-- Where you are in the tray, when there is more than one account in it. -->
        @if (trays().length > 1) {
          <span class="tray-position tiny faint">
            {{ trayIndex() + 1 }} / {{ trays().length }}
          </span>
        }
      </div>

      <!-- ------------------------------------------------------- seen by -->
      @if (viewersFor(); as story) {
        <div class="modal-backdrop" (click)="viewersFor.set(null)">
          <div class="modal" style="max-width:400px" (click)="$event.stopPropagation()">
            <div class="modal-head">Viewers</div>

            <div style="padding:8px 16px 16px">
              @if (viewers() === null) {
                <div class="spinner"></div>
              } @else if (viewers()!.length === 0) {
                <p class="muted small" style="padding:12px 0">
                  Nobody has opened this yet. Only you can see this list.
                </p>
              } @else {
                @for (viewer of viewers()!; track viewer.user.id) {
                  <a
                    class="row gap-12"
                    style="padding:7px 0"
                    [routerLink]="['/', viewer.user.username]"
                    (click)="close.emit()">
                    <app-avatar [user]="viewer.user" [size]="42" />
                    <span class="col grow" style="min-width:0">
                      <span class="username">{{ viewer.user.username }}</span>
                      <span class="tiny muted">{{ viewer.viewedAt | ago: clock.now() }}</span>
                    </span>
                    @if (viewer.followsYou) {
                      <span class="tiny muted">Follows you</span>
                    }
                  </a>
                }
              }
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 400;
        background: #000;
        display: block;
      }

      .viewer {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        max-width: 460px;
        margin: 0 auto;
        background: #0a0a0a;
        overflow: hidden;
      }

      @media (min-width: 720px) {
        .viewer {
          top: 20px;
          bottom: 20px;
          border-radius: 12px;
        }
      }

      /* ---------------------------------------------------------- progress */

      .bars {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        display: flex;
        gap: 3px;
        padding: 10px 10px 0;
        z-index: 3;
      }

      .bar {
        flex: 1;
        height: 2.5px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.34);
        overflow: hidden;
      }

      .fill {
        display: block;
        height: 100%;
        background: #fff;
        /* Matches the tick, so the bar slides instead of stepping. */
        transition: width 0.06s linear;
      }

      /* ------------------------------------------------------------ header */

      .head {
        position: absolute;
        top: 18px;
        left: 0;
        right: 0;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 12px;
        z-index: 3;
        /* A dark wash so a white username stays readable over a bright photo. */
        background: linear-gradient(180deg, rgba(0, 0, 0, 0.55), transparent);
      }

      .white {
        color: #fff;
      }

      .faint {
        color: rgba(255, 255, 255, 0.72);
      }

      .close-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(46, 204, 113, 0.9);
        color: #fff;
        border-radius: 999px;
        padding: 1px 7px;
        white-space: nowrap;
      }

      .plain {
        border: 0;
        background: transparent;
        color: #fff;
        font-size: 17px;
        padding: 4px;
        line-height: 1;
        flex: none;
      }

      /* ------------------------------------------------------------- photo */

      .stage {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        min-height: 0;
      }

      .stage img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      .caption {
        position: absolute;
        left: 16px;
        right: 16px;
        bottom: 18%;
        margin: 0;
        text-align: center;
        color: #fff;
        font-size: 17px;
        font-weight: 500;
        line-height: 1.45;
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
      }

      .half {
        position: absolute;
        top: 60px;
        bottom: 78px;
        width: 34%;
        border: 0;
        background: transparent;
        cursor: pointer;
        z-index: 2;
      }

      .half.left {
        left: 0;
      }

      .half.right {
        right: 0;
        width: 66%;
      }

      /* ------------------------------------------------------------ footer */

      .foot {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 12px;
        z-index: 3;
        background: linear-gradient(0deg, rgba(0, 0, 0, 0.6), transparent);
      }

      .reply {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid rgba(255, 255, 255, 0.5);
        border-radius: 22px;
        padding: 7px 14px;
      }

      .bare {
        flex: 1;
        border: 0;
        background: transparent;
        outline: none;
        color: #fff;
        font-family: inherit;
        font-size: 14px;
      }

      .bare::placeholder {
        color: rgba(255, 255, 255, 0.65);
      }

      .send {
        border: 0;
        background: transparent;
        color: #fff;
        font-weight: 600;
        font-size: 14px;
        padding: 0 2px;
      }

      .send.heart {
        font-size: 18px;
      }

      .viewers {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        border: 0;
        background: rgba(255, 255, 255, 0.16);
        color: #fff;
        border-radius: 999px;
        padding: 8px 16px;
        font-size: 13px;
        font-weight: 600;
      }

      .tray-position {
        position: absolute;
        bottom: 6px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 4;
      }
    `,
  ],
})
export class StoryViewerComponent implements OnInit, OnDestroy {
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  protected readonly api = inject(Api);
  protected readonly clock = inject(Clock);

  /** Every account with something to show, in the order the tray was drawn. */
  readonly trays = input.required<StoryTray[]>();

  /** Which account to start on. */
  readonly startAt = input(0);

  readonly close = output<void>();

  /** Emitted when a story is opened, so the tray behind can drop its gradient ring. */
  readonly seen = output<number>();

  protected readonly trayIndex = signal(0);
  protected readonly index = signal(0);
  protected readonly progress = signal(0);
  protected readonly paused = signal(false);
  protected readonly draft = signal('');
  protected readonly sending = signal(false);

  protected readonly viewersFor = signal<Story | null>(null);
  protected readonly viewers = signal<StoryViewer[] | null>(null);

  protected readonly currentTray = computed(() => this.trays()[this.trayIndex()] ?? null);
  protected readonly current = computed(() => this.currentTray()?.stories[this.index()] ?? null);

  private timer?: ReturnType<typeof setInterval>;
  private holdTimer?: ReturnType<typeof setTimeout>;
  private markedSeen = new Set<number>();

  ngOnInit() {
    this.trayIndex.set(Math.max(0, Math.min(this.startAt(), this.trays().length - 1)));

    // Open on the first thing they have not already seen, rather than making somebody sit through
    // yesterday's again.
    const tray = this.currentTray();
    const firstUnseen = tray?.stories.findIndex((s) => !s.isSeen) ?? -1;
    this.index.set(firstUnseen >= 0 ? firstUnseen : 0);

    this.markCurrentSeen();
    this.play();
  }

  ngOnDestroy() {
    this.stop();
    clearTimeout(this.holdTimer);
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        this.close.emit();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.next();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.previous();
        break;
      case ' ':
        event.preventDefault();
        this.togglePause();
        break;
    }
  }

  // ------------------------------------------------------------------ playback

  private play() {
    this.stop();
    this.progress.set(0);

    this.timer = setInterval(() => {
      if (this.paused() || this.viewersFor() || this.draft()) {
        return;
      }

      const next = this.progress() + (TICK_MS / SEGMENT_MS) * 100;

      if (next >= 100) {
        this.next();
        return;
      }

      this.progress.set(next);
    }, TICK_MS);
  }

  private stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  protected togglePause() {
    this.paused.update((p) => !p);
  }

  /** Holding pauses; a quick press does not, so a tap still counts as a tap. */
  protected hold() {
    this.holdTimer = setTimeout(() => this.paused.set(true), 220);
  }

  protected release() {
    clearTimeout(this.holdTimer);
    this.paused.set(false);
  }

  protected next() {
    const tray = this.currentTray();
    if (!tray) return;

    if (this.index() < tray.stories.length - 1) {
      this.index.update((i) => i + 1);
      this.markCurrentSeen();
      this.play();
      return;
    }

    // End of this account: move to the next one, or leave.
    if (this.trayIndex() < this.trays().length - 1) {
      this.trayIndex.update((i) => i + 1);
      this.index.set(0);
      this.draft.set('');
      this.markCurrentSeen();
      this.play();
      return;
    }

    this.close.emit();
  }

  protected previous() {
    if (this.index() > 0) {
      this.index.update((i) => i - 1);
      this.play();
      return;
    }

    if (this.trayIndex() > 0) {
      this.trayIndex.update((i) => i - 1);
      const tray = this.currentTray();
      this.index.set(Math.max(0, (tray?.stories.length ?? 1) - 1));
      this.draft.set('');
      this.play();
      return;
    }

    // Already at the very beginning: restart this one rather than doing nothing.
    this.play();
  }

  /**
   * Records the view once per story per session. Failing to record it is not worth telling anybody
   * about — the photo is on screen either way.
   */
  private markCurrentSeen() {
    const story = this.current();

    if (!story || story.isMine || this.markedSeen.has(story.id)) {
      return;
    }

    this.markedSeen.add(story.id);
    this.seen.emit(story.id);

    this.api.markStorySeen(story.id).subscribe({ error: () => undefined });
  }

  // ------------------------------------------------------------------- replies

  protected onDraft(value: string) {
    this.draft.set(value);
  }

  protected send(story: Story) {
    const text = this.draft().trim();
    if (!text || this.sending()) return;

    this.sending.set(true);

    this.api.replyToStory(story.id, text).subscribe({
      next: () => {
        this.sending.set(false);
        this.draft.set('');
        this.toasts.show('Reply sent.');
        this.play();
      },
      error: (error) => {
        this.sending.set(false);
        this.toasts.error(error.error?.message ?? 'That reply did not send.');
      },
    });
  }

  protected quickHeart(story: Story) {
    this.draft.set('❤️');
    this.send(story);
  }

  // -------------------------------------------------------------------- author

  protected openViewers(story: Story) {
    this.viewersFor.set(story);
    this.viewers.set(null);
    this.paused.set(true);

    this.api.storyViewers(story.id).subscribe({
      next: (viewers) => this.viewers.set(viewers),
      error: () => this.viewers.set([]),
    });
  }

  protected remove(story: Story) {
    this.api.deleteStory(story.id).subscribe({
      next: () => {
        this.toasts.show('Story deleted.');
        this.close.emit();
      },
      error: (error) => this.toasts.error(error.error?.message ?? 'Could not delete that.'),
    });
  }
}
