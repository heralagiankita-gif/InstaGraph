import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { Api } from '../../core/api.service';
import { Post } from '../../core/models';
import { InfiniteScrollComponent } from '../../shared/infinite-scroll.component';
import { PostGridComponent } from '../../shared/post-grid.component';
import { GridSkeletonComponent } from '../../shared/skeletons';
import { EmptyComponent } from '../../shared/ui';

/** Everything posted under one hashtag. */
@Component({
  selector: 'app-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PostGridComponent, InfiniteScrollComponent, GridSkeletonComponent, EmptyComponent],
  template: `
    <div class="page">
      <header class="row gap-16 mb-24">
        <span class="tag-icon"><i class="bi bi-hash"></i></span>
        <div class="col">
          <h1 class="title">#{{ tag() }}</h1>
          <span class="muted small">{{ total() }} {{ total() === 1 ? 'post' : 'posts' }}</span>
        </div>
      </header>

      @if (loading() && posts().length === 0) {
        <app-grid-skeleton [count]="9" />
      } @else if (posts().length === 0) {
        <app-empty icon="bi-hash" title="No posts with this tag" />
      } @else {
        <app-post-grid [posts]="posts()" />

        <app-infinite-scroll [hasMore]="hasMore()" [loading]="loading()" (more)="loadMore()" />
      }
    </div>
  `,
  styles: [
    `
      .page {
        max-width: 935px;
        margin: 0 auto;
        padding: 0 4px;
      }

      .tag-icon {
        width: 76px;
        height: 76px;
        border-radius: 50%;
        background: var(--border-soft);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        flex: none;
      }
    `,
  ],
})
export class TagComponent {
  private readonly api = inject(Api);

  /** Bound from the route by withComponentInputBinding(). */
  readonly tag = input.required<string>();

  protected readonly posts = signal<Post[]>([]);
  protected readonly loading = signal(true);
  protected readonly hasMore = signal(false);
  protected readonly total = signal(0);

  private page = 1;

  constructor() {
    // Navigating from one tag straight to another reuses the component, so the reload has to be tied to
    // the input rather than to ngOnInit.
    effect(() => {
      const tag = this.tag();
      this.page = 1;
      this.posts.set([]);
      this.total.set(0);
      this.load(tag);
    });
  }

  protected loadMore() {
    if (this.loading() || !this.hasMore()) return;

    this.page++;
    this.load(this.tag());
  }

  private load(tag: string) {
    this.loading.set(true);

    this.api.hashtagPosts(tag, this.page).subscribe({
      next: (result) => {
        this.posts.update((existing) => [...existing, ...result.items]);
        this.total.update((n) => n + result.items.length);
        this.hasMore.set(result.hasMore);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
