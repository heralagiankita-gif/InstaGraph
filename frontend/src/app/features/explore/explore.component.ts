import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Hashtag, Post } from '../../core/models';
import { InfiniteScrollComponent } from '../../shared/infinite-scroll.component';
import { PostGridComponent } from '../../shared/post-grid.component';
import { GridSkeletonComponent } from '../../shared/skeletons';
import { SuggestionsComponent } from '../../shared/suggestions.component';
import { EmptyComponent } from '../../shared/ui';

/**
 * Explore: photos from accounts you do not follow. The API decides the order — most engaged first, with
 * anything two hops away lifted above complete strangers.
 */
@Component({
  selector: 'app-explore',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PostGridComponent,
    GridSkeletonComponent,
    SuggestionsComponent,
    InfiniteScrollComponent,
    EmptyComponent,
  ],
  template: `
    <div class="page">
      <header class="top fade-in">
        <span class="eyebrow">Beyond your follows</span>
        <h1 class="title">Explore</h1>
      </header>

      @if (tags().length > 0) {
        <!-- One line that scrolls rather than a block that wraps: ten tags wrapping over three rows
             pushes the grid below the fold on a laptop, and the grid is the page. -->
        <div class="tags no-bar fade-in">
          @for (tag of tags(); track tag.tag; let i = $index) {
            <a class="chip stagger" [style.--i]="i" [routerLink]="['/tags', tag.tag]">
              #{{ tag.tag }} <span class="muted tiny">{{ tag.postCount }}</span>
            </a>
          }
        </div>
      }

      @if (loading() && posts().length === 0) {
        <app-grid-skeleton [count]="9" />
      } @else if (posts().length === 0) {
        <app-empty
          icon="bi-compass"
          title="Nothing to explore yet"
          message="Explore shows photos from accounts you don't follow. Once other people start posting, they land here." />

        <div class="card discover">
          <app-suggestions [limit]="6" heading="People on InstaGraph" />
        </div>
      } @else {
        <app-post-grid [posts]="posts()" [masonry]="true" />

        <app-infinite-scroll
          [hasMore]="hasMore()"
          [loading]="loading()"
          endLabel="That's everything for now"
          (more)="loadMore()" />
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

      .top {
        margin-bottom: 16px;
      }

      .top .title {
        font-size: 34px;
        background: var(--brand);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      .tags {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        padding-bottom: 4px;
        margin-bottom: 22px;
      }

      .tags .chip {
        flex: none;
      }

      .discover {
        max-width: 420px;
        margin: 0 auto;
        padding: 18px 22px;
      }
    `,
  ],
})
export class ExploreComponent implements OnInit {
  private readonly api = inject(Api);

  protected readonly posts = signal<Post[]>([]);
  protected readonly tags = signal<Hashtag[]>([]);
  protected readonly loading = signal(true);
  protected readonly hasMore = signal(false);

  private page = 1;

  ngOnInit() {
    this.load();
    this.api.trending(10).subscribe({ next: (tags) => this.tags.set(tags), error: () => undefined });
  }

  protected loadMore() {
    if (this.loading() || !this.hasMore()) return;

    this.page++;
    this.load();
  }

  private load() {
    this.loading.set(true);

    this.api.explore(this.page).subscribe({
      next: (result) => {
        this.posts.update((existing) => [...existing, ...result.items]);
        this.hasMore.set(result.hasMore);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
