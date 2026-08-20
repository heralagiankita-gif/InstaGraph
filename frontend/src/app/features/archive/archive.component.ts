import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Post, Story } from '../../core/models';
import { Toasts } from '../../core/toast.service';
import { AgoPipe, EmptyComponent, SpinnerComponent } from '../../shared/ui';
import { Clock } from '../../core/clock.service';

/**
 * The archive: everything you have put away, and everything that expired on its own.
 *
 * Two tabs because they are two different kinds of thing, even though they look alike. A post is archived
 * by a decision — you took it off your grid — and can be put straight back. A story is archived by the
 * clock, without anybody deciding anything, and there is nothing to restore it to: the way it comes back
 * is by being kept in a highlight, which is what the second tab is really for.
 */
@Component({
  selector: 'app-archive',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, AgoPipe, SpinnerComponent, EmptyComponent],
  template: `
    <header class="head">
      <h3 class="grow">Archive</h3>
    </header>

    <div class="tabs">
      <button type="button" [class.on]="tab() === 'posts'" (click)="tab.set('posts')">
        <i class="bi bi-archive"></i> Posts
      </button>
      <button type="button" [class.on]="tab() === 'stories'" (click)="show('stories')">
        <i class="bi bi-clock-history"></i> Stories
      </button>
    </div>

    @if (tab() === 'posts') {
      <p class="tiny muted mb-16">
        Only you can see these. Bringing one back puts it on your grid where it was.
      </p>

      @if (loadingPosts()) {
        <app-spinner />
      } @else if (posts().length === 0) {
        <app-empty
          icon="bi-archive"
          title="Nothing archived"
          message="Archiving a post takes it off your grid without deleting it." />
      } @else {
        <div class="grid">
          @for (post of posts(); track post.id) {
            <div class="cell">
              <a [routerLink]="['/p', post.id]">
                <img [src]="api.imageUrl(post.imageUrl)" [alt]="post.caption || 'Photo'" loading="lazy" />

                @if (post.isReel) {
                  <span class="mark"><i class="bi bi-play-btn-fill"></i></span>
                } @else if (post.media.length > 1) {
                  <span class="mark"><i class="bi bi-images"></i></span>
                }
              </a>

              <button type="button" class="btn btn-secondary btn-block btn-sm" (click)="restore(post)">
                Show on profile
              </button>
            </div>
          }
        </div>
      }
    } @else {
      <p class="tiny muted mb-16">
        Every story you have posted. Keep the ones worth keeping in a highlight on your profile.
      </p>

      @if (loadingStories()) {
        <app-spinner />
      } @else if (stories().length === 0) {
        <app-empty
          icon="bi-clock-history"
          title="No stories yet"
          message="Stories land here automatically once their day is up." />
      } @else {
        @if (chosen().length > 0) {
          <div class="bar card">
            <span class="grow small">
              {{ chosen().length }} selected
            </span>

            <input
              class="input"
              style="max-width:200px"
              placeholder="Highlight name"
              maxlength="40"
              [ngModel]="title()"
              (ngModelChange)="title.set($event)" />

            <button type="button" class="btn" [disabled]="saving() || !title().trim()" (click)="keep()">
              {{ saving() ? 'Saving…' : 'Create highlight' }}
            </button>

            <button type="button" class="btn-ghost" (click)="picked.set([])">Clear</button>
          </div>
        }

        <div class="grid">
          @for (story of stories(); track story.id) {
            <button
              type="button"
              class="cell story"
              [class.on]="isChosen(story)"
              (click)="toggle(story)">
              <img [src]="api.imageUrl(story.imageUrl)" alt="" loading="lazy" />

              <span class="when tiny">{{ story.createdAt | ago: clock.now() }}</span>

              @if (isChosen(story)) {
                <span class="tick"><i class="bi bi-check-lg"></i></span>
              }
            </button>
          }
        </div>
      }
    }
  `,
  styles: [
    `
      .head {
        display: flex;
        align-items: center;
        margin-bottom: 8px;
      }

      .tabs {
        display: flex;
        gap: 24px;
        border-top: 1px solid var(--border);
        margin-bottom: 16px;
      }

      .tabs button {
        border: 0;
        border-top: 1px solid transparent;
        background: transparent;
        color: var(--ink-3);
        padding: 14px 4px;
        margin-top: -1px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.6px;
        text-transform: uppercase;
      }

      .tabs button.on {
        color: var(--ink);
        border-top-color: var(--ink);
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px;
      }

      .cell {
        position: relative;
        border: 0;
        padding: 0;
        background: transparent;
        display: block;
      }

      .cell img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        display: block;
        background: var(--border-soft);
      }

      .cell.story.on img {
        outline: 3px solid var(--accent);
        outline-offset: -3px;
      }

      .mark,
      .when,
      .tick {
        position: absolute;
        color: #fff;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
      }

      .mark {
        top: 8px;
        right: 8px;
        font-size: 15px;
      }

      .when {
        left: 8px;
        bottom: 8px;
      }

      .tick {
        top: 8px;
        right: 8px;
        width: 22px;
        height: 22px;
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: var(--accent);
        text-shadow: none;
      }

      .bar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }

      @media (min-width: 720px) {
        .grid {
          grid-template-columns: repeat(4, 1fr);
        }
      }
    `,
  ],
})
export class ArchiveComponent {
  protected readonly api = inject(Api);
  protected readonly clock = inject(Clock);
  private readonly toasts = inject(Toasts);

  protected readonly tab = signal<'posts' | 'stories'>('posts');

  protected readonly posts = signal<Post[]>([]);
  protected readonly stories = signal<Story[]>([]);
  protected readonly loadingPosts = signal(true);
  protected readonly loadingStories = signal(false);

  protected readonly picked = signal<number[]>([]);
  protected readonly title = signal('');
  protected readonly saving = signal(false);

  /** In the order they were picked, because that is the order the highlight will play in. */
  protected readonly chosen = computed(() => this.picked());

  private storiesLoaded = false;

  constructor() {
    this.api.archived(1, 36).subscribe({
      next: (page) => {
        this.posts.set(page.items);
        this.loadingPosts.set(false);
      },
      error: () => this.loadingPosts.set(false),
    });
  }

  /** The second tab costs a request, so it is only paid for if somebody opens it. */
  protected show(tab: 'posts' | 'stories') {
    this.tab.set(tab);

    if (tab !== 'stories' || this.storiesLoaded) return;

    this.storiesLoaded = true;
    this.loadingStories.set(true);

    this.api.storyArchive(1, 60).subscribe({
      next: (page) => {
        this.stories.set(page.items);
        this.loadingStories.set(false);
      },
      error: () => this.loadingStories.set(false),
    });
  }

  protected restore(post: Post) {
    this.api.unarchivePost(post.id).subscribe({
      next: () => {
        this.posts.update((list) => list.filter((p) => p.id !== post.id));
        this.toasts.show('Back on your profile.');
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not restore that post.'),
    });
  }

  protected isChosen(story: Story) {
    return this.picked().includes(story.id);
  }

  protected toggle(story: Story) {
    this.picked.update((list) =>
      list.includes(story.id) ? list.filter((id) => id !== story.id) : [...list, story.id],
    );
  }

  protected keep() {
    const ids = this.picked();
    const name = this.title().trim();

    if (ids.length === 0 || !name || this.saving()) return;

    this.saving.set(true);

    this.api.createStoryHighlight(name, ids).subscribe({
      next: () => {
        this.saving.set(false);
        this.picked.set([]);
        this.title.set('');
        this.toasts.show('Highlight added to your profile.');
      },
      error: (err) => {
        this.saving.set(false);
        this.toasts.error(err.error?.message ?? 'Could not create that highlight.');
      },
    });
  }
}
