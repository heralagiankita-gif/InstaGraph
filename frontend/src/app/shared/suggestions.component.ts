import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { SuggestedUser, UserRelation } from '../core/models';
import { FollowButtonComponent } from './follow-button.component';
import { ListSkeletonComponent } from './skeletons';
import { AvatarComponent } from './ui';

/**
 * "Suggested for you". The list arrives already ranked and already carrying its evidence — which signals
 * fired, how strongly, and through whom — so nothing here decides who is worth showing.
 *
 * What it does add is the ability to ask why. A recommendation nobody can interrogate is a recommendation
 * nobody can disagree with, and the breakdown behind the info button is the same set of numbers the
 * ranking actually used.
 */
@Component({
  selector: 'app-suggestions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AvatarComponent, FollowButtonComponent, ListSkeletonComponent],
  template: `
    <div class="section-head">
      <h3>{{ title() }}</h3>
      @if (showAllLink()) {
        <a class="tiny strong" routerLink="/discover">See all</a>
      }
    </div>

    @if (loading()) {
      <app-list-skeleton [count]="3" />
    } @else if (people().length === 0) {
      <p class="tiny muted" style="padding:2px 0 6px">
        No suggestions yet. Follow a few people and they'll show up here.
      </p>
    } @else {
      @if (bootstrapping()) {
        <!-- Said once, at the top, rather than repeated on every row: none of these came out of the
             graph, because there is not yet a graph to walk. Following one of them is what turns this
             list into a real one. -->
        <p class="tiny muted" style="padding:0 0 8px">
          You are not following anyone yet, so there is no path to follow out. Follow somebody and their
          connections start appearing here.
        </p>
      }

      @for (person of people(); track person.id) {
        <div class="person fade-in">
          <div class="row gap-12">
            <a [routerLink]="['/', person.username]">
              <app-avatar [user]="person" [size]="44" />
            </a>

            <div class="col grow" style="min-width:0">
              <a class="username small" [routerLink]="['/', person.username]">{{ person.username }}</a>
              <span class="tiny muted ellipsis">{{ person.reason }}</span>

              <!-- One reason line and nothing else, the way Instagram's row reads. The category chip
                   that used to sit here only ever restated the reason above it. How far away they are is
                   different information, so that stays — but only when there is a route to describe. -->
              @if (person.distance > 1) {
                <span class="chips">
                  <span class="chip ghost">{{ person.distance }} hops away</span>
                </span>
              }
            </div>

            <div class="col actions">
              <app-follow-button [user]="person" (changed)="onChanged(person, $event)" />

              <span class="row gap-8">
                <button type="button" class="icon" title="Why this account?" (click)="toggleWhy(person.id)">
                  <i class="bi" [class]="open() === person.id ? 'bi-info-circle-fill' : 'bi-info-circle'"></i>
                </button>
                <button type="button" class="icon" title="Not interested" (click)="dismiss(person)">
                  <i class="bi bi-x-lg"></i>
                </button>
              </span>
            </div>
          </div>

          <!-- The derivation, straight from the ranking. Nothing here is written for the occasion. -->
          @if (open() === person.id) {
            <div class="why fade-in">
              @if (person.via.length > 0) {
                <div class="via">
                  <span class="tiny muted">Through</span>
                  @for (friend of person.via; track friend.id) {
                    <a [routerLink]="['/', friend.username]" [title]="friend.username">
                      <app-avatar [user]="friend" [size]="20" />
                    </a>
                  }
                  @if (person.mutualCount > person.via.length) {
                    <span class="tiny muted">+{{ person.mutualCount - person.via.length }}</span>
                  }
                </div>
              }

              @for (signal of person.signals; track signal.name) {
                <div class="signal">
                  <span class="tiny">{{ signal.name }}</span>
                  <span class="bar">
                    <span
                      class="fill"
                      [class.negative]="signal.contribution < 0"
                      [style.width.%]="width(signal.contribution, person)"></span>
                  </span>
                  <span class="tiny muted num">{{ signal.contribution > 0 ? '+' : ''
                    }}{{ signal.contribution.toFixed(2) }}</span>
                </div>
              }

              <div class="signal total">
                <span class="tiny strong">Score</span>
                <span class="bar"></span>
                <span class="tiny strong num">{{ person.score.toFixed(2) }}</span>
              </div>
            </div>
          }
        </div>
      }
    }
  `,
  styles: [
    `
      .person {
        padding: 5px 0;
      }

      .actions {
        align-items: flex-end;
        gap: 2px;
      }

      .icon {
        border: 0;
        background: transparent;
        color: var(--ink-3);
        font-size: 12px;
        padding: 2px;
        line-height: 1;
      }

      .icon:hover {
        color: var(--ink);
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        margin-top: 3px;
      }

      .chip {
        font-size: 10px;
        font-weight: 600;
        padding: 1px 7px;
        border-radius: 999px;
        background: var(--border-soft);
        color: var(--ink-2);
        white-space: nowrap;
      }

      /* One colour per signal, so the same reason always looks the same wherever it appears. */
      .chip.c-FollowsYou {
        background: color-mix(in srgb, var(--accent, #3897f0) 18%, transparent);
        color: var(--accent, #3897f0);
      }

      .chip.c-MutualFriends {
        background: color-mix(in srgb, #2ecc71 18%, transparent);
        color: #1f9d55;
      }

      .chip.c-PopularInCircle {
        background: color-mix(in srgb, #f39c12 20%, transparent);
        color: #b9770e;
      }

      .chip.c-SameCommunity {
        background: color-mix(in srgb, #9b59b6 18%, transparent);
        color: #8e44ad;
      }

      .chip.ghost {
        background: transparent;
        border: 1px solid var(--border);
      }

      .why {
        margin: 6px 0 10px 56px;
        padding: 8px 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 10px);
        background: var(--border-soft);
      }

      .via {
        display: flex;
        align-items: center;
        gap: 5px;
        padding-bottom: 7px;
        margin-bottom: 7px;
        border-bottom: 1px solid var(--border);
      }

      .signal {
        display: grid;
        grid-template-columns: 108px 1fr 44px;
        align-items: center;
        gap: 8px;
        padding: 2px 0;
      }

      .signal.total {
        border-top: 1px solid var(--border);
        margin-top: 5px;
        padding-top: 5px;
      }

      .bar {
        height: 4px;
        border-radius: 2px;
        background: var(--border);
        overflow: hidden;
      }

      .fill {
        display: block;
        height: 100%;
        background: linear-gradient(90deg, #f9ce34, #ee2a7b 60%, #6228d7);
      }

      .fill.negative {
        background: var(--danger, #ed4956);
      }

      .num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .ellipsis {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class SuggestionsComponent implements OnInit {
  private readonly api = inject(Api);

  readonly limit = input(5);
  readonly heading = input('Suggested for you');
  readonly showAllLink = input(true);

  /** Everything fetched, including the spares that replace anything dismissed. */
  private readonly pool = signal<SuggestedUser[]>([]);
  private readonly hidden = signal(new Set<number>());

  protected readonly loading = signal(true);
  protected readonly open = signal<number | null>(null);

  /**
   * Whether any of this came out of the graph at all.
   *
   * A suggestion with no intermediary and no route is not something the graph worked out — it is the
   * bootstrap list every network needs before it knows anything about you. Worth distinguishing, because
   * a heading that says "Suggested for you" over a list of strangers the app cannot justify is the one
   * claim this whole thing is not supposed to make.
   */
  protected readonly bootstrapping = computed(
    () => this.people().length > 0 && this.people().every((p) => p.via.length === 0 && p.distance < 0),
  );

  /** The heading follows the same distinction, unless the caller asked for a specific one. */
  protected readonly title = computed(() =>
    this.heading() !== 'Suggested for you' ? this.heading() : this.bootstrapping() ? 'People on InstaGraph' : 'Suggested for you',
  );

  protected readonly people = computed(() =>
    this.pool()
      .filter((person) => !this.hidden().has(person.id))
      .slice(0, this.limit()),
  );

  ngOnInit() {
    // A few more than are shown, so dismissing one fills the gap without another round trip.
    this.api.graphSuggestions(this.limit() + 6).subscribe({
      next: (people) => {
        this.pool.set(people);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected toggleWhy(id: number) {
    this.open.update((current) => (current === id ? null : id));
  }

  /** Local only — the next page load ranks from the graph again, exactly as it did before. */
  protected dismiss(person: SuggestedUser) {
    this.hidden.update((set) => new Set(set).add(person.id));
  }

  /** Bars are drawn against the largest contribution on the same card, not across cards. */
  protected width(contribution: number, person: SuggestedUser): number {
    const peak = Math.max(...person.signals.map((s) => Math.abs(s.contribution)), 0.0001);
    return Math.min(100, (Math.abs(contribution) / peak) * 100);
  }

  /**
   * The button owns the request; the rail only has to keep the row it is sitting on in step, so a
   * re-render cannot hand a stale relationship back to the button it came from.
   */
  protected onChanged(person: SuggestedUser, relation: UserRelation) {
    this.pool.update((people) =>
      people.map((p) => (p.id === person.id ? { ...p, ...relation } : p)),
    );
  }
}
