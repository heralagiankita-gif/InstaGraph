import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Realtime } from '../../core/realtime.service';
import { Post } from '../../core/models';
import { DiscoverRowComponent } from '../../shared/discover-row.component';
import { InfiniteScrollComponent } from '../../shared/infinite-scroll.component';
import { PostCardComponent } from '../../shared/post-card.component';
import { FeedSkeletonComponent } from '../../shared/skeletons';
import { ComposerComponent } from '../../shared/composer.component';
import { StoriesComponent } from '../../shared/stories.component';
import { SuggestionsComponent } from '../../shared/suggestions.component';
import { AvatarComponent } from '../../shared/ui';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PostCardComponent,
    StoriesComponent,
    SuggestionsComponent,
    DiscoverRowComponent,
    InfiniteScrollComponent,
    FeedSkeletonComponent,
    AvatarComponent,
    ComposerComponent,
  ],
  template: `
    <div class="layout">
      <section class="feed">
        @if (freshPosts() > 0) {
          <button type="button" class="fresh" (click)="refresh()">
            <i class="bi bi-arrow-up"></i>
            {{ freshPosts() === 1 ? 'New post' : freshPosts() + ' new posts' }}
          </button>
        }

        <app-stories (compose)="storyComposer.set(true)" />

        @if (loading() && posts().length === 0) {
          <app-feed-skeleton [count]="2" />
        } @else if (posts().length === 0) {
          <!-- Nothing to show yet. Rather than an apology, the three things that
               will actually fill this screen, in the order they make sense. -->
          <div class="card welcome fade-in">
            <!-- The graph as it actually stands: one lit node, which is you, and the edges that do not
                 exist yet — dashed, drifting, landing on nobody. The sign-in page draws this motif
                 finished; here it is deliberately unfinished, because that is the true state of the
                 account and the three rows underneath are how it gets closed. -->
            <div class="constellation" aria-hidden="true">
              <span class="wash"></span>

              @for (ghost of ghosts; track ghost.angle) {
                <span class="ghost" [style.--a]="ghost.angle + 'deg'" [style.--d]="ghost.delay + 's'">
                  <span class="edge"></span>
                  <span class="dot"></span>
                </span>
              }

              <span class="you">
                <span class="halo"></span>
                @if (auth.user(); as me) {
                  <app-avatar [user]="me" [size]="60" />
                }
              </span>
            </div>

            <h2 class="title">
              Welcome to InstaGraph<span class="name">{{ firstName() ? ', ' + firstName() : '' }}</span>
              <span class="wave">👋</span>
            </h2>

            <p class="muted mb-8">Your feed fills up with posts from the people you follow.</p>

            <p class="tally tiny mb-24">1 node · 0 edges</p>

            <a class="step" routerLink="/create">
              <span class="num">1</span>
              <span class="col grow">
                <span class="strong">Share your first photo</span>
                <span class="tiny muted">Pick a photo, add a caption.</span>
              </span>
              <i class="bi bi-chevron-right chev"></i>
            </a>

            <a class="step" routerLink="/discover">
              <span class="num">2</span>
              <span class="col grow">
                <span class="strong">Find people to follow</span>
                <span class="tiny muted">Your feed grows from who you follow.</span>
              </span>
              <i class="bi bi-chevron-right chev"></i>
            </a>

            @if (auth.user(); as me) {
              <!-- The one step the client can actually check for itself: the avatar is on the session
                   already, so this ticks without asking the API anything. Steps 1 and 2 are left
                   unticked rather than guessed at — a checkbox that lies is worse than no checkbox. -->
              <a class="step" [class.done]="hasAvatar()" [routerLink]="['/', me.username]">
                <span class="num">
                  @if (hasAvatar()) {
                    <i class="bi bi-check-lg"></i>
                  } @else {
                    3
                  }
                </span>
                <span class="col grow">
                  <span class="strong">Finish your profile</span>
                  <span class="tiny muted">
                    @if (hasAvatar()) {
                      Photo added. Now add a bio.
                    } @else {
                      Add a photo and a bio.
                    }
                  </span>
                </span>
                <i class="bi bi-chevron-right chev"></i>
              </a>
            }
          </div>

          <!-- The rail is hidden on narrow screens, so suggestions repeat inline. -->
          <div class="card inline-suggestions">
            <app-suggestions [limit]="5" heading="Suggested for you" />
          </div>
        } @else {
          @for (post of posts(); track post.id; let i = $index) {
            <app-post-card
              [post]="post"
              (changed)="replace($event)"
              (deleted)="remove($event)"
              (hidden)="removeAuthor($event)" />

            <!-- Graph output, dropped into the middle of the feed the way Instagram does it. -->
            @if (i === 2) {
              <app-discover-row />
            }
          }

          <app-infinite-scroll
            [hasMore]="hasMore()"
            [loading]="loading()"
            [showEnd]="false"
            (more)="loadMore()" />

          @if (!hasMore() && !loading()) {
            <div class="caught-up">
              <span class="tick"><i class="bi bi-check-lg"></i></span>
              <span class="strong">You're all caught up</span>
              <span class="small muted">You've seen every new post from the people you follow.</span>
            </div>
          }
        }
      </section>

      <aside class="rail">
        @if (auth.user(); as me) {
          <div class="row gap-12 mb-24">
            <a [routerLink]="['/', me.username]">
              <app-avatar [user]="me" [size]="52" />
            </a>
            <div class="col grow" style="min-width:0">
              <a class="username" [routerLink]="['/', me.username]">{{ me.username }}</a>
              <span class="tiny muted ellipsis">{{ me.fullName }}</span>
            </div>
            <button type="button" class="btn-ghost tiny" (click)="auth.signOut()">Switch</button>
          </div>
        }

        <app-suggestions [limit]="5" />

        <p class="tiny muted footer">
          About · Help · Press · API · Jobs · Privacy · Terms · Locations · Language<br />
          <span class="copyright">© 2026 InstaGraph</span>
        </p>
      </aside>
    </div>

    @if (storyComposer()) {
      <app-composer initialMode="story" (close)="storyComposer.set(false)" />
    }
  `,
  styles: [
    `
      .layout {
        display: flex;
        gap: 64px;
        justify-content: center;
        margin: 0 auto;
        max-width: 935px;
      }

      /* Sticks under the top bar so it is reachable from anywhere down the feed. */
      .fresh {
        position: sticky;
        top: 12px;
        z-index: 20;
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 auto 14px;
        border: 0;
        border-radius: var(--pill);
        padding: 10px 20px;
        background: var(--brand);
        color: var(--brand-ink);
        font-weight: 800;
        font-size: 13px;
        box-shadow: 0 10px 26px -8px var(--glow);
        animation: fadeUp 0.3s var(--spring) both;
        transition: transform 0.18s var(--spring), box-shadow 0.18s var(--ease);
      }

      .fresh:hover {
        transform: translateY(-2px) scale(1.03);
        box-shadow: 0 14px 32px -8px var(--glow);
      }

      .fresh:active {
        transform: scale(0.96);
      }

      .feed {
        width: 100%;
        max-width: 470px;
      }

      .rail {
        width: 320px;
        flex: none;
        position: sticky;
        top: 28px;
        align-self: flex-start;
        padding-top: 6px;
      }

      .footer {
        margin-top: 26px;
        line-height: 1.7;
        font-size: 11px;
      }

      .copyright {
        text-transform: uppercase;
        display: inline-block;
        margin-top: 12px;
      }

      /* ---------------------------------------------------------- welcome */

      /* The frost comes from .card in styles.css; this only sets the box. */
      .welcome {
        padding: 28px 24px;
        margin-bottom: 20px;
      }

      .welcome .title {
        font-family: var(--display);
        font-size: 26px;
        line-height: 1.2;
        letter-spacing: -0.4px;
        margin-bottom: 8px;
      }

      /* Only the name is painted in the vibe. The sentence around it stays ink, so the gradient
         reads as "this is you" rather than as decoration sprayed over the whole heading. */
      .welcome .name {
        background: var(--brand);
        background-size: 200% 100%;
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        animation: drift 9s ease-in-out infinite;
      }

      .wave {
        display: inline-block;
        transform-origin: 70% 80%;
        animation: wave 3.4s var(--ease) infinite;
      }

      @keyframes wave {
        0%,
        60%,
        100% {
          transform: rotate(0deg);
        }
        70% {
          transform: rotate(16deg);
        }
        80% {
          transform: rotate(-8deg);
        }
        90% {
          transform: rotate(12deg);
        }
      }

      /* The count, said plainly. It is the smallest number in the app and the only one that is
         allowed to be zero without it being a bug. */
      .tally {
        color: var(--ink-4);
        letter-spacing: 0.3px;
      }

      /* ---------------------------------------------------- your graph so far */

      .constellation {
        position: relative;
        height: 176px;
        margin: -6px 0 16px;
        display: grid;
        place-items: center;
        isolation: isolate;
      }

      /* The vibe, bloomed out behind the node. Two blobs rather than one so the colour moves across
         the panel instead of sitting as a flat disc behind the avatar. */
      .wash {
        position: absolute;
        inset: 6% 12%;
        z-index: -1;
        border-radius: 50%;
        background: radial-gradient(
            42% 58% at 32% 40%,
            color-mix(in srgb, var(--aura-1) 30%, transparent),
            transparent 70%
          ),
          radial-gradient(
            46% 62% at 70% 58%,
            color-mix(in srgb, var(--aura-3) 26%, transparent),
            transparent 70%
          );
        filter: blur(14px);
        animation: bob 9s ease-in-out infinite;
      }

      /* Each ghost is one arm: a dashed edge laid along it, a dot parked at the far end. Rotating
         the arm is cheaper than positioning eight elements by hand, and the angle is the only thing
         that differs between them. */
      .ghost {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 78px;
        height: 2px;
        transform-origin: 0 50%;
        transform: rotate(var(--a, 0deg));
        animation: reach 6s ease-in-out infinite;
        animation-delay: var(--d, 0s);
      }

      .edge {
        position: absolute;
        inset: 0 10px 0 26px;
        border-top: 2px dashed color-mix(in srgb, var(--ink) 22%, transparent);
      }

      .dot {
        position: absolute;
        right: 0;
        top: 50%;
        width: 11px;
        height: 11px;
        margin-top: -5.5px;
        border-radius: 50%;
        border: 2px dashed color-mix(in srgb, var(--ink) 28%, transparent);
        /* Kept upright while the arm it rides on is rotated. */
        transform: rotate(calc(-1 * var(--a, 0deg)));
      }

      /* Nothing is connected, so the arms only ever reach — they never arrive. */
      @keyframes reach {
        50% {
          transform: rotate(var(--a, 0deg)) scaleX(1.1);
          opacity: 0.55;
        }
      }

      .you {
        position: relative;
        display: grid;
        place-items: center;
        border-radius: 50%;
        padding: 4px;
        background: var(--brand);
        box-shadow: 0 14px 38px -14px var(--glow);
      }

      /* The one solid thing on the panel gets a pulse outwards, which is also the only motion that
         starts at the centre rather than at the edges. */
      .halo {
        position: absolute;
        inset: -6px;
        border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--accent) 55%, transparent);
        animation: pulse-out 3.2s var(--ease) infinite;
      }

      @keyframes pulse-out {
        0% {
          opacity: 0.7;
          transform: scale(1);
        }
        70%,
        100% {
          opacity: 0;
          transform: scale(1.55);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .wash,
        .ghost,
        .halo,
        .wave,
        .welcome .name {
          animation: none;
        }
      }

      /* ---------------------------------------------------------------- steps */

      .step {
        position: relative;
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 14px 14px 12px;
        border-radius: var(--radius);
        border: 1px solid var(--border);
        margin-bottom: 10px;
        overflow: hidden;
        transition: background 0.14s var(--ease), transform 0.2s var(--spring),
          border-color 0.14s var(--ease), box-shadow 0.2s var(--ease);
      }

      /* A spine of the vibe down the leading edge, which only arrives on hover. It is what makes the
         row feel picked up rather than merely tinted. */
      .step::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 3px;
        background: var(--brand);
        transform: scaleY(0);
        transform-origin: 50% 100%;
        transition: transform 0.22s var(--spring);
      }

      .step:hover,
      .step:focus-visible {
        background: var(--hover);
        border-color: color-mix(in srgb, var(--accent) 45%, transparent);
        transform: translateX(4px);
        box-shadow: 0 12px 26px -18px var(--glow);
      }

      .step:hover::before,
      .step:focus-visible::before {
        transform: scaleY(1);
      }

      .chev {
        color: var(--ink-4);
        transition: transform 0.2s var(--spring), color 0.14s var(--ease);
      }

      .step:hover .chev {
        color: var(--accent);
        transform: translateX(3px);
      }

      /* Done reads as done: the row steps back so the two that still want doing are the loud ones. */
      .step.done .strong {
        color: var(--ink-3);
      }

      .step.done .num {
        background: none;
        background-color: color-mix(in srgb, var(--accent) 16%, transparent);
        color: var(--accent);
        font-size: 15px;
      }

      .num {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        background: var(--brand);
        color: var(--brand-ink);
        font-weight: 700;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex: none;
      }

      .inline-suggestions {
        padding: 18px 20px;
        display: none;
      }

      /* ------------------------------------------------------- caught up */

      .caught-up {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        text-align: center;
        padding: 28px 20px 48px;
      }

      /* Filled rather than outlined: reaching the end of the feed is the one moment in the app worth
         a small piece of confetti, and a hairline circle is not it. */
      .tick {
        width: 52px;
        height: 52px;
        border-radius: 50%;
        background: var(--brand);
        color: var(--brand-ink);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        margin-bottom: 8px;
        box-shadow: 0 12px 30px -12px var(--glow);
        animation: bob 4s ease-in-out infinite;
      }

      /* The same width the real one gives up the rail at, and the same width the sidebar drops its
         labels at — the two happen together or the page looks lopsided in between. */
      @media (max-width: 1264px) {
        .rail {
          display: none;
        }

        .inline-suggestions {
          display: block;
        }
      }

      @media (max-width: 767px) {
        .feed {
          max-width: 100%;
        }
      }
    `,
  ],
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  protected readonly auth = inject(Auth);
  private readonly realtime = inject(Realtime);

  /** The story composer, opened from the plus on your own ring. */
  protected readonly storyComposer = signal(false);

  protected readonly posts = signal<Post[]>([]);
  protected readonly loading = signal(true);
  protected readonly hasMore = signal(false);

  protected readonly firstName = computed(() => (this.auth.user()?.fullName ?? '').split(' ')[0] ?? '');

  /** Ticks the profile step off. The avatar is already on the session, so this costs no request. */
  protected readonly hasAvatar = computed(() => !!this.auth.user()?.avatarUrl);

  /**
   * The edges that do not exist yet, on the welcome panel. Angles are uneven on purpose — evenly
   * spaced arms read as a loading spinner, and this is not loading, it is empty.
   */
  protected readonly ghosts = [
    { angle: -142, delay: 0 },
    { angle: -78, delay: 0.7 },
    { angle: -24, delay: 1.4 },
    { angle: 34, delay: 0.35 },
    { angle: 96, delay: 2.1 },
    { angle: 158, delay: 1.05 },
  ];

  /** How many accounts have posted since this feed was drawn. Drives the pill at the top. */
  protected readonly freshPosts = signal(0);

  private page = 1;
  private readonly subscriptions: Subscription[] = [];

  ngOnInit() {
    this.load();

    // A ranked feed cannot have a post inserted into it from outside — where it belongs is a question
    // only the ranking can answer. So the socket offers a refresh rather than reordering the page under
    // somebody who is halfway down it.
    this.subscriptions.push(this.realtime.post$.subscribe(() => this.freshPosts.update((n) => n + 1)));
  }

  ngOnDestroy() {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  /** Draws the feed again from the top, which is what the pill promises. */
  protected refresh() {
    this.freshPosts.set(0);
    this.page = 1;
    this.posts.set([]);
    this.load();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected loadMore() {
    // The observer can fire again while a page is still in flight; without this guard the same page
    // is requested twice and every post appears duplicated.
    if (this.loading() || !this.hasMore()) return;

    this.page++;
    this.load();
  }

  private load() {
    this.loading.set(true);

    this.api.feed(this.page).subscribe({
      next: (result) => {
        // Appending rather than replacing, so "show more" does not lose what is already on screen.
        this.posts.update((existing) => [...existing, ...result.items]);
        this.hasMore.set(result.hasMore);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected replace(post: Post) {
    this.posts.update((all) => all.map((p) => (p.id === post.id ? post : p)));
  }

  protected remove(id: number) {
    this.posts.update((all) => all.filter((p) => p.id !== id));
  }

  /** Blocking or muting takes everything by that author out of the list straight away. */
  protected removeAuthor(username: string) {
    this.posts.update((all) => all.filter((p) => p.author.username !== username));
  }
}
