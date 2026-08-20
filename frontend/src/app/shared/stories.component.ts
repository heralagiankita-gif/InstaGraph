import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, output, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { StoryTray } from '../core/models';
import { Realtime } from '../core/realtime.service';
import { StoryViewerComponent } from '../features/stories/story-viewer.component';
import { AvatarComponent } from './ui';

/**
 * The ring row across the top of the feed.
 *
 * <p>
 * Each ring is an account you follow with a story still alive. That is a one-hop question — your own
 * out-edges and nothing further — so a new account sees only its own tile until it follows somebody,
 * which is the honest answer rather than a row of strangers.
 * </p>
 *
 * <p>
 * A gradient ring means there is something you have not opened; a grey one means you have seen it all.
 * That single flag is the whole reason the row is worth looking at, so it is computed per viewer on the
 * server rather than guessed at here.
 * </p>
 */
@Component({
  selector: 'app-stories',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarComponent, StoryViewerComponent],
  template: `
    <div class="strip">
      <div class="track">
        <!-- Your own tile is always first, and always opens the composer if you have nothing live. -->
        @if (auth.user(); as me) {
          <button type="button" class="story" (click)="openMine()">
            <span class="ring" [class.plain]="!mine()" [class.seen]="mine() && !mine()!.hasUnseen">
              <span class="inner">
                <app-avatar [user]="me" [size]="58" />
              </span>
              <span class="plus"><i class="bi bi-plus"></i></span>
            </span>
            <span class="name tiny">Your story</span>
          </button>
        }

        @if (loading()) {
          @for (i of [1, 2, 3, 4]; track i) {
            <span class="story">
              <span class="sk sk-circle" style="width:66px;height:66px"></span>
              <span class="sk" style="width:44px;height:8px;margin-top:8px"></span>
            </span>
          }
        } @else {
          @for (item of others(); track item.user.id; let i = $index) {
            <button type="button" class="story" (click)="open(item)">
              <span class="ring" [class.seen]="!item.hasUnseen">
                <span class="inner">
                  <app-avatar [user]="item.user" [size]="58" />
                </span>
                @if (item.storyCount > 1) {
                  <span class="count tiny">{{ item.storyCount }}</span>
                }
              </span>
              <span class="name tiny ellipsis">{{ item.user.username }}</span>
            </button>
          }

          @if (others().length === 0) {
            <span class="hint tiny muted">
              Follow someone and their stories show up here for 24 hours.
            </span>
          }
        }
      </div>
    </div>

    @if (viewerOpen()) {
      <app-story-viewer
        [trays]="playable()"
        [startAt]="startAt()"
        (seen)="onSeen($event)"
        (close)="closeViewer()" />
    }
  `,
  styles: [
    `
      /* No card around it: on the real thing the tray is a bare row above the first post, held to the
         same width as the feed and separated by a hairline. */
      .strip {
        max-width: 470px;
        margin: 0 auto 16px;
        padding: 0 0 16px;
        border-bottom: 1px solid var(--border);
        overflow: hidden;
      }

      .track {
        display: flex;
        gap: 14px;
        overflow-x: auto;
        padding: 0 2px;
        scrollbar-width: none;
      }

      .track::-webkit-scrollbar {
        display: none;
      }

      .story {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 7px;
        width: 74px;
        flex: none;
        border: 0;
        background: transparent;
        padding: 0;
        color: var(--ink-2);
      }

      /*
        The gradient sits on the outer ring; the inner disc is the gap.

        An unopened ring turns, slowly. It is the one thing in the tray that says "there is something
        here" without a badge or a colour change, and it stops the moment the ring goes grey — so a
        row of seen stories is completely still and the one live one is the only thing moving.
      */
      .ring {
        width: 66px;
        height: 66px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        transition: transform 0.2s var(--spring);
      }

      /* The gradient lives on its own layer so it can spin while the ring itself is being scaled by
         a hover — one element cannot be doing both to its transform at once. */
      .ring::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: var(--ring);
        animation: turn 7s linear infinite;
      }

      @keyframes turn {
        to {
          transform: rotate(360deg);
        }
      }

      .story:hover .ring {
        transform: scale(1.06);
      }

      .story:hover .ring::before {
        animation-duration: 2.5s;
      }

      .story:active .ring {
        transform: scale(0.95);
      }

      /* Everything above the gradient layer has to be told it is above it. .plus and .count are
         already positioned, so they only need the index. */
      .inner {
        position: relative;
      }

      .inner,
      .plus,
      .count {
        z-index: 1;
      }

      @media (prefers-reduced-motion: reduce) {
        .ring::before {
          animation: none;
        }
      }

      /* Everything already opened: the ring stays, the colour goes — and so does the movement. */
      .ring.seen::before,
      .ring.plain::before {
        background: var(--border);
        animation: none;
      }

      .inner {
        width: 62px;
        height: 62px;
        border-radius: 50%;
        background: var(--surface);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .plus {
        position: absolute;
        right: -2px;
        bottom: -2px;
        width: 21px;
        height: 21px;
        border-radius: 50%;
        background: var(--accent);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid var(--surface);
        font-size: 13px;
      }

      .count {
        position: absolute;
        right: -2px;
        top: -2px;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        border-radius: 9px;
        background: var(--ink);
        color: var(--surface);
        display: flex;
        align-items: center;
        justify-content: center;
        border: 2px solid var(--surface);
        font-weight: 700;
      }

      .name {
        max-width: 72px;
        color: var(--ink-2);
      }

      .hint {
        align-self: center;
        padding: 22px 8px;
        max-width: 320px;
      }
    `,
  ],
})
export class StoriesComponent implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly realtime = inject(Realtime);
  protected readonly auth = inject(Auth);

  /** Asked for when the tile with the plus on it is pressed and there is nothing live to show. */
  readonly compose = output<void>();

  protected readonly trays = signal<StoryTray[]>([]);
  protected readonly loading = signal(true);
  protected readonly viewerOpen = signal(false);
  protected readonly startAt = signal(0);

  /** The trays the viewer will play, which is the same row minus anybody with nothing in it. */
  protected readonly playable = signal<StoryTray[]>([]);

  private subscriptions: Subscription[] = [];

  protected mine() {
    return this.trays().find((t) => t.isMine) ?? null;
  }

  protected others() {
    return this.trays().filter((t) => !t.isMine);
  }

  ngOnInit() {
    this.load();

    // A story posted by somebody you follow appears without a refresh, and so does one you posted from
    // another tab.
    this.subscriptions.push(this.realtime.story$.subscribe(() => this.load(true)));
    this.subscriptions.push(this.realtime.resynced$.subscribe(() => this.load(true)));
  }

  ngOnDestroy() {
    this.subscriptions.forEach((s) => s.unsubscribe());
  }

  protected load(quiet = false) {
    if (!quiet) this.loading.set(true);

    this.api.storyTray().subscribe({
      next: (trays) => {
        this.loading.set(false);
        this.trays.set(trays);
      },
      error: () => this.loading.set(false),
    });
  }

  protected open(item: StoryTray) {
    // The viewer plays on from where you tapped, so reaching the end of one account continues into the
    // next rather than dumping you back on the feed.
    const list = this.trays().filter((t) => t.stories.length > 0);
    const at = list.findIndex((t) => t.user.id === item.user.id);

    if (at < 0) return;

    this.playable.set(list);
    this.startAt.set(at);
    this.viewerOpen.set(true);
  }

  protected openMine() {
    const mine = this.mine();

    if (mine && mine.stories.length > 0) {
      this.open(mine);
      return;
    }

    this.compose.emit();
  }

  protected closeViewer() {
    this.viewerOpen.set(false);

    // The rings are stale the moment something has been watched.
    this.load(true);
  }

  /** Drops the gradient as soon as a story is opened, without waiting for the next fetch. */
  protected onSeen(storyId: number) {
    this.trays.update((trays) =>
      trays.map((tray) => {
        if (!tray.stories.some((s) => s.id === storyId)) return tray;

        const stories = tray.stories.map((s) => (s.id === storyId ? { ...s, isSeen: true } : s));

        return { ...tray, stories, hasUnseen: stories.some((s) => !s.isSeen) };
      }),
    );
  }
}
