import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { SuggestedUser } from '../core/models';
import { Toasts } from '../core/toast.service';
import { AvatarComponent } from './ui';

/**
 * "Discover people" — a horizontal card row dropped into the middle of the feed.
 *
 * Every card is output from the two-hop traversal, and each one shows the reason it was produced
 * ("Followed by ben + 2 more"). It sits inside the feed rather than only in the sidebar because the
 * sidebar does not exist on a phone, and because a suggestion is far more likely to be acted on where
 * the reader already is.
 */
@Component({
  selector: 'app-discover-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AvatarComponent],
  template: `
    @if (people().length > 0) {
      <section class="card wrap fade-in">
        <header class="row between head">
          <span class="strong small">Discover people</span>
          <a class="tiny" routerLink="/explore">See all</a>
        </header>

        <div class="track">
          @for (person of people(); track person.id) {
            <article class="tile">
              <button
                type="button"
                class="dismiss"
                (click)="dismiss(person.id)"
                [attr.aria-label]="'Dismiss ' + person.username">
                <i class="bi bi-x"></i>
              </button>

              <a [routerLink]="['/', person.username]" class="col" style="align-items:center;gap:8px">
                <app-avatar [user]="person" [size]="76" />
                <span class="username small ellipsis" style="max-width:120px">{{ person.username }}</span>
              </a>

              <span class="tiny muted reason">{{ person.reason }}</span>

              <button
                type="button"
                class="btn btn-sm follow"
                [class.btn-secondary]="followed().has(person.username)"
                [disabled]="pending().has(person.username)"
                (click)="follow(person)">
                {{ followed().has(person.username) ? 'Following' : 'Follow' }}
              </button>
            </article>
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      .wrap {
        margin-bottom: 20px;
        overflow: hidden;
      }

      .head {
        padding: 12px 14px;
        border-bottom: 1px solid var(--border);
      }

      .track {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding: 14px;
        scroll-snap-type: x mandatory;
        scrollbar-width: thin;
      }

      .tile {
        position: relative;
        flex: none;
        width: 158px;
        border: 1px solid var(--border-soft);
        border-radius: var(--radius-lg);
        padding: 18px 12px 14px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        text-align: center;
        scroll-snap-align: start;
        background: color-mix(in srgb, var(--surface) 70%, transparent);
        backdrop-filter: blur(16px) saturate(160%);
        -webkit-backdrop-filter: blur(16px) saturate(160%);
        transition: transform 0.2s var(--spring), border-color 0.14s var(--ease),
          box-shadow 0.2s var(--ease);
      }

      .tile:hover {
        transform: translateY(-4px);
        border-color: color-mix(in srgb, var(--accent) 45%, transparent);
        box-shadow: 0 14px 30px -18px var(--glow);
      }

      .dismiss {
        position: absolute;
        top: 4px;
        right: 4px;
        border: 0;
        background: transparent;
        color: var(--ink-3);
        font-size: 14px;
        line-height: 1;
        padding: 4px;
        border-radius: 50%;
      }

      .dismiss:hover {
        background: var(--border-soft);
        color: var(--ink);
      }

      .reason {
        min-height: 30px;
        line-height: 1.35;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .follow {
        width: 100%;
      }
    `,
  ],
})
export class DiscoverRowComponent implements OnInit {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  protected readonly people = signal<SuggestedUser[]>([]);
  protected readonly followed = signal(new Set<string>());
  protected readonly pending = signal(new Set<string>());

  ngOnInit() {
    this.api.suggestions(10).subscribe({
      next: (people) => this.people.set(people),
      // A failed suggestion fetch should leave the feed alone, not interrupt it.
      error: () => this.people.set([]),
    });
  }

  /** Dismissing is local only — there is no "not interested" endpoint, and pretending otherwise would lie. */
  protected dismiss(id: number) {
    this.people.update((all) => all.filter((p) => p.id !== id));
  }

  protected follow(person: SuggestedUser) {
    if (this.followed().has(person.username)) return;

    this.pending.update((set) => new Set(set).add(person.username));

    this.api.follow(person.username).subscribe({
      next: (result) => {
        this.clearPending(person.username);
        this.followed.update((set) => new Set(set).add(person.username));

        this.toasts.show(
          result.followRequested
            ? `Requested to follow ${person.username}.`
            : `You now follow ${person.username}.`,
        );
      },
      error: (err) => {
        this.clearPending(person.username);
        this.toasts.error(err.error?.message ?? 'Could not follow that account.');
      },
    });
  }

  private clearPending(username: string) {
    this.pending.update((set) => {
      const next = new Set(set);
      next.delete(username);
      return next;
    });
  }
}
