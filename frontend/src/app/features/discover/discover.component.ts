import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { NetworkStats, SuggestedUser, SuggestionCategory, UserRelation } from '../../core/models';
import { FollowButtonComponent } from '../../shared/follow-button.component';
import { ListSkeletonComponent } from '../../shared/skeletons';
import { AvatarComponent, EmptyComponent } from '../../shared/ui';

type Tab = { key: SuggestionCategory | 'all'; label: string; blurb: string };

/**
 * Find people — the same ranking as the sidebar, split by the signal that produced each row.
 *
 * The tabs are not cosmetic. Each one isolates a different question asked of the follow graph: who has
 * already pointed an edge at you, who your two-hop neighbourhood agrees on, who your circle of trust
 * endorses, who the random walk reaches past two hops, and who label propagation put in the same cluster
 * as you. Reading them separately is the clearest way to see what each measure is actually good at.
 */
@Component({
  selector: 'app-discover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    DecimalPipe,
    AvatarComponent,
    FollowButtonComponent,
    ListSkeletonComponent,
    EmptyComponent,
  ],
  template: `
    <div class="wrap">
      <header class="head">
        <div>
          <h1 class="title">Discover people</h1>
          <p class="small muted" style="margin-top:2px">
            Ranked out of the follow graph — no content is read to produce any of this.
          </p>
        </div>

        <a class="btn-ghost strong small" routerLink="/network">
          <i class="bi bi-diagram-3"></i> Your network
        </a>
      </header>

      <!-- Where you sit, in one line. Context for why the lists below look the way they do. -->
      @if (stats(); as s) {
        <div class="stats">
          <span><strong>{{ s.following }}</strong> following</span>
          <span><strong>{{ s.followers }}</strong> followers</span>
          <span><strong>{{ s.reach2 }}</strong> within 2 hops</span>
          <span><strong>{{ s.reach3 }}</strong> within 3</span>
          <span title="Share of your follows who follow you back">
            <strong>{{ (s.reciprocity * 100) | number: '1.0-0' }}%</strong> mutual
          </span>
        </div>
      }

      <nav class="tabs">
        @for (tab of tabs; track tab.key) {
          <button
            type="button"
            class="tab"
            [class.active]="active().key === tab.key"
            (click)="select(tab)">
            {{ tab.label }}
          </button>
        }
      </nav>

      <p class="small muted blurb">{{ active().blurb }}</p>

      @if (loading()) {
        <app-list-skeleton [count]="6" />
      } @else if (people().length === 0) {
        <app-empty
          icon="bi-people"
          title="Nothing under this signal yet"
          message="This measure needs edges to work with. Follow a few accounts and it will start returning people." />
      } @else {
        <div class="grid">
          @for (person of people(); track person.id) {
            <article class="card fade-in">
              <a [routerLink]="['/', person.username]" class="col center">
                <app-avatar [user]="person" [size]="72" />
                <span class="username" style="margin-top:8px">{{ person.username }}</span>
                <span class="tiny muted ellipsis">{{ person.fullName }}</span>
              </a>

              <span class="chip" [class]="'c-' + person.category">{{ person.categoryLabel }}</span>

              <p class="tiny muted reason">{{ person.reason }}</p>

              @if (person.via.length > 0) {
                <div class="via">
                  @for (friend of person.via; track friend.id) {
                    <a [routerLink]="['/', friend.username]" [title]="friend.username">
                      <app-avatar [user]="friend" [size]="22" />
                    </a>
                  }
                  <span class="tiny muted">{{ person.mutualCount }} mutual</span>
                </div>
              }

              <app-follow-button
                class="full"
                [user]="person"
                [block]="true"
                (changed)="onChanged(person, $event)" />
            </article>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .wrap {
        max-width: 940px;
        margin: 0 auto;
      }

      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }

      .stats {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 18px;
        margin: 14px 0 6px;
        padding: 10px 14px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 12px);
        font-size: 13px;
        color: var(--ink-2);
      }

      .tabs {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        margin: 14px 0 4px;
        padding-bottom: 4px;
      }

      .tab {
        border: 1px solid var(--border);
        background: transparent;
        color: var(--ink-2);
        border-radius: 999px;
        padding: 6px 14px;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
      }

      .tab.active {
        background: var(--ink);
        color: var(--surface);
        border-color: var(--ink);
      }

      .blurb {
        margin: 6px 0 16px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 14px;
      }

      .card {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 12px);
        padding: 18px 14px 14px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        text-align: center;
      }

      .center {
        align-items: center;
      }

      .reason {
        margin: 0;
        min-height: 30px;
      }

      .via {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .full {
        width: 100%;
      }

      .chip {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--border-soft);
        color: var(--ink-2);
      }

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

      .ellipsis {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
      }
    `,
  ],
})
export class DiscoverComponent implements OnInit {
  private readonly api = inject(Api);

  protected readonly tabs: Tab[] = [
    {
      key: 'all',
      label: 'For you',
      blurb: 'Every signal blended, then re-ranked so one well-connected friend cannot fill the page.',
    },
    {
      key: 'FollowsYou',
      label: 'Follows you',
      blurb: 'The edge already exists in one direction. Half a connection, waiting for the other half.',
    },
    {
      key: 'MutualFriends',
      label: 'Friends of friends',
      blurb:
        'Two hops out, scored by Adamic–Adar: a mutual who follows thirty accounts is evidence, one who follows fifty thousand is noise.',
    },
    {
      key: 'PopularInCircle',
      label: 'Popular in your circle',
      blurb:
        'SALSA over your circle of trust — what the people you actually trust endorse, which is not the same as what has the most followers.',
    },
    {
      key: 'ExtendedNetwork',
      label: 'Extended network',
      blurb:
        'Reached by the random walk past two hops. No direct mutual, but many short routes lead there.',
    },
    {
      key: 'SameCommunity',
      label: 'Same community',
      blurb:
        'Label propagation put you in the same cluster. Nobody chose those boundaries — the edges did.',
    },
  ];

  protected readonly active = signal<Tab>(this.tabs[0]);
  protected readonly people = signal<SuggestedUser[]>([]);
  protected readonly stats = signal<NetworkStats | null>(null);
  protected readonly loading = signal(true);

  ngOnInit() {
    this.api.networkStats().subscribe({ next: (s) => this.stats.set(s), error: () => {} });
    this.load();
  }

  protected select(tab: Tab) {
    if (tab.key === this.active().key) return;

    this.active.set(tab);
    this.load();
  }

  private load() {
    this.loading.set(true);

    this.api.graphSuggestions(24, this.active().key).subscribe({
      next: (people) => {
        this.people.set(people);
        this.loading.set(false);
      },
      error: () => {
        this.people.set([]);
        this.loading.set(false);
      },
    });
  }

  /**
   * A card stays where it is once followed rather than vanishing — a row disappearing under the cursor
   * is how you lose track of what you just did. The next load will drop it, because the ranking excludes
   * accounts you follow.
   */
  protected onChanged(person: SuggestedUser, relation: UserRelation) {
    this.people.update((people) =>
      people.map((p) => (p.id === person.id ? { ...p, ...relation } : p)),
    );

    // Following somebody moves your own position in the graph, so the header figures are re-read.
    this.api.networkStats().subscribe({ next: (s) => this.stats.set(s), error: () => {} });
  }
}
