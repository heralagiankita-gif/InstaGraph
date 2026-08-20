import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Clock, parseApiDate } from '../core/clock.service';
import { Notification, UserSummary } from '../core/models';
import { Toasts } from '../core/toast.service';
import { AgoPipe, AvatarComponent } from '../shared/ui';

/** One heading and the notifications that fall under it. */
interface Bucket {
  label: string;
  items: Notification[];
}

/**
 * Notifications, as the panel that slides out of the sidebar rather than a page of its own.
 *
 * <p>
 * The route at /activity still exists and still works — this is the same data in the place the real one
 * puts it, so the sidebar never has to hand the whole screen over to a list of one-line events.
 * </p>
 */
@Component({
  selector: 'app-notifications-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AvatarComponent, AgoPipe],
  template: `
    <h2 class="panel-title">Notifications</h2>

    <div class="scroll">
      @if (requests().length > 0) {
        <h3 class="bucket">Follow requests</h3>

        @for (person of requests(); track person.id) {
          <div class="item">
            <a [routerLink]="['/', person.username]" (click)="close.emit()">
              <app-avatar [user]="person" [size]="44" />
            </a>

            <div class="text">
              <a class="username" [routerLink]="['/', person.username]" (click)="close.emit()">
                {{ person.username }}
              </a>
              <span class="muted"> wants to follow you.</span>
            </div>

            <button class="btn btn-sm" type="button" (click)="respond(person, true)">Confirm</button>
            <button class="btn btn-sm btn-secondary" type="button" (click)="respond(person, false)">
              Delete
            </button>
          </div>
        }
      }

      @if (loading() && items().length === 0) {
        @for (i of [1, 2, 3, 4, 5, 6]; track i) {
          <div class="item">
            <span class="sk sk-circle" style="width:44px;height:44px"></span>
            <span class="sk" style="height:10px;flex:1"></span>
          </div>
        }
      } @else if (items().length === 0 && requests().length === 0) {
        <div class="blank">
          <span class="ring"><i class="bi bi-heart"></i></span>
          <p class="strong">Activity on your posts</p>
          <p class="muted small">When somebody likes or comments on your photos, you will see it here.</p>
        </div>
      } @else {
        @for (bucket of buckets(); track bucket.label) {
          <h3 class="bucket">{{ bucket.label }}</h3>

          @for (item of bucket.items; track item.id) {
            <div class="item">
              <a [routerLink]="['/', item.actor.username]" (click)="close.emit()">
                <app-avatar [user]="item.actor" [size]="44" />
              </a>

              <div class="text">
                <a class="username" [routerLink]="['/', item.actor.username]" (click)="close.emit()">
                  {{ item.actor.username }}
                </a>
                <span> {{ describe(item) }}</span>
                <span class="muted"> {{ item.createdAt | ago: clock.now() }}</span>
              </div>

              @if (item.postId && item.postImageUrl) {
                <a [routerLink]="['/p', item.postId]" (click)="close.emit()">
                  <img class="thumb" [src]="api.imageUrl(item.postImageUrl)" alt="" />
                </a>
              }
            </div>
          }
        }

        @if (hasMore()) {
          <button type="button" class="more" (click)="loadMore()" [disabled]="loading()">
            {{ loading() ? 'Loading…' : 'Show more' }}
          </button>
        }
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-height: 0;
        height: 100%;
      }

      .panel-title {
        font-size: 24px;
        font-weight: 700;
        letter-spacing: -0.4px;
        margin: 0;
        padding: 30px 24px 16px;
      }

      .scroll {
        flex: 1;
        overflow-y: auto;
        padding-bottom: 24px;
      }

      .bucket {
        margin: 0;
        padding: 14px 24px 8px;
        font-size: 15px;
        font-weight: 700;
      }

      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 24px;
      }

      .item:hover {
        background: var(--hover);
      }

      .text {
        flex: 1;
        min-width: 0;
        font-size: 14px;
        line-height: 18px;
      }

      .thumb {
        width: 44px;
        height: 44px;
        object-fit: cover;
        flex: none;
        border-radius: 4px;
      }

      .more {
        display: block;
        margin: 12px auto 0;
        border: 0;
        background: transparent;
        color: var(--accent);
        font-weight: 600;
        font-size: 14px;
      }

      .blank {
        text-align: center;
        padding: 60px 24px;
      }

      .blank .ring {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        border: 2px solid var(--ink);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 26px;
        margin-bottom: 16px;
      }

      .blank p {
        margin: 0 0 6px;
      }
    `,
  ],
})
export class NotificationsPanelComponent implements OnInit {
  protected readonly api = inject(Api);
  protected readonly clock = inject(Clock);
  private readonly auth = inject(Auth);
  private readonly toasts = inject(Toasts);

  readonly close = output<void>();

  protected readonly items = signal<Notification[]>([]);
  protected readonly requests = signal<UserSummary[]>([]);
  protected readonly loading = signal(true);
  protected readonly hasMore = signal(false);

  private page = 1;

  /**
   * Today, then this week, then this month, then everything older. Each window starts where the
   * previous one ended, so nothing is counted twice and nothing falls between them.
   */
  protected readonly buckets = computed<Bucket[]>(() => {
    const day = 86_400_000;
    const now = Date.now();

    const cuts: Array<[string, number]> = [
      ['Today', day],
      ['This week', 7 * day],
      ['This month', 30 * day],
      ['Earlier', Number.POSITIVE_INFINITY],
    ];

    let floor = 0;
    const out: Bucket[] = [];

    for (const [label, ceiling] of cuts) {
      const from = floor;

      const items = this.items().filter((item) => {
        const age = now - (parseApiDate(item.createdAt)?.getTime() ?? 0);
        return age >= from && age < ceiling;
      });

      if (items.length > 0) {
        out.push({ label, items });
      }

      floor = ceiling;
    }

    return out;
  });

  ngOnInit() {
    this.load();

    this.api.followRequests().subscribe({
      next: (people) => this.requests.set(people),
      error: () => undefined,
    });

    // Opening the panel is what "seeing" them means, so the badge clears here.
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
