import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Clock } from '../../core/clock.service';
import { Notification, UserSummary } from '../../core/models';
import { Toasts } from '../../core/toast.service';
import { InfiniteScrollComponent } from '../../shared/infinite-scroll.component';
import { ListSkeletonComponent } from '../../shared/skeletons';
import { AgoPipe, AvatarComponent, EmptyComponent } from '../../shared/ui';

@Component({
  selector: 'app-activity',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    AvatarComponent,
    AgoPipe,
    EmptyComponent,
    ListSkeletonComponent,
    InfiniteScrollComponent,
  ],
  template: `
    <div class="page">
      <h1 class="title mb-24">Notifications</h1>

      @if (requests().length > 0) {
        <h3 class="small strong mb-8">Follow requests</h3>

        @for (person of requests(); track person.id) {
          <div class="row gap-12 item">
            <a [routerLink]="['/', person.username]"><app-avatar [user]="person" [size]="44" /></a>

            <div class="col grow" style="min-width:0">
              <a class="username small" [routerLink]="['/', person.username]">{{ person.username }}</a>
              <span class="tiny muted">wants to follow you</span>
            </div>

            <button class="btn btn-sm" type="button" (click)="respond(person, true)">Confirm</button>
            <button class="btn btn-sm btn-secondary" type="button" (click)="respond(person, false)">Delete</button>
          </div>
        }

        <hr class="rule" />
      }

      @if (loading() && items().length === 0) {
        <app-list-skeleton [count]="6" />
      } @else if (items().length === 0) {
        <app-empty
          icon="bi-heart"
          title="Activity on your posts"
          message="When somebody likes or comments on your photos, you'll see it here." />
      } @else {
        @for (item of items(); track item.id) {
          <div class="row gap-12 item" [class.unread]="!item.isRead">
            <a [routerLink]="['/', item.actor.username]"><app-avatar [user]="item.actor" [size]="44" /></a>

            <div class="grow" style="min-width:0">
              <a class="username small" [routerLink]="['/', item.actor.username]">{{ item.actor.username }}</a>
              <span class="small"> {{ describe(item) }} </span>
              <span class="tiny muted">{{ item.createdAt | ago: clock.now() }}</span>
            </div>

            @if (item.postId && item.postImageUrl) {
              <a [routerLink]="['/p', item.postId]">
                <img class="thumb" [src]="api.imageUrl(item.postImageUrl)" alt="The photo involved" />
              </a>
            }
          </div>
        }

        <app-infinite-scroll
          [hasMore]="hasMore()"
          [loading]="loading()"
          endLabel="That's all your activity"
          (more)="loadMore()" />
      }
    </div>
  `,
  styles: [
    `
      .page {
        max-width: 620px;
        margin: 0 auto;
      }

      .item {
        padding: 10px 12px;
        border-radius: var(--radius);
      }

      .item.unread {
        background: var(--border-soft);
      }

      .thumb {
        width: 44px;
        height: 44px;
        object-fit: cover;
        border-radius: 4px;
        flex: none;
      }
    `,
  ],
})
export class ActivityComponent implements OnInit {
  protected readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly toasts = inject(Toasts);
  protected readonly clock = inject(Clock);

  protected readonly items = signal<Notification[]>([]);
  protected readonly requests = signal<UserSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly hasMore = signal(false);

  private page = 1;

  ngOnInit() {
    this.load();

    this.api.followRequests().subscribe({
      next: (people) => this.requests.set(people),
      error: () => undefined,
    });

    // Opening this screen is what "seeing" them means, so the badge clears here.
    this.api.markAllRead().subscribe({
      next: () => this.auth.unread.set(0),
      error: () => undefined,
    });
  }

  protected describe(item: Notification): string {
    switch (item.kind) {
      case 'Like':
        return 'liked your photo.';
      case 'Comment':
        return 'commented on your photo.';
      case 'Follow':
        return 'started following you.';
      case 'FollowRequest':
        return 'requested to follow you.';
      case 'Mention':
        return 'mentioned you.';
      case 'Reply':
        return 'replied to your comment.';
      case 'CommentLike':
        return 'liked your comment.';
      case 'Tag':
        return 'tagged you in a photo.';
      default:
        return '';
    }
  }

  protected respond(person: UserSummary, accept: boolean) {
    this.api.respondToRequest(person.username, accept).subscribe({
      next: () => {
        this.requests.update((all) => all.filter((p) => p.id !== person.id));
        this.toasts.show(accept ? `${person.username} now follows you.` : 'Request removed.');
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not answer that request.'),
    });
  }

  protected loadMore() {
    if (this.loading() || !this.hasMore()) return;

    this.page++;
    this.load();
  }

  private load() {
    this.loading.set(true);

    this.api.notifications(this.page).subscribe({
      next: (result) => {
        this.items.update((existing) => [...existing, ...result.items]);
        this.hasMore.set(result.hasMore);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
