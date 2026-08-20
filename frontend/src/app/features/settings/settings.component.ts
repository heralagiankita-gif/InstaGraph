import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Prefs } from '../../core/prefs.service';
import { ActivitySummary, AudienceValue, ListMember, Settings, UserSummary } from '../../core/models';
import { ThemeService } from '../../core/theme.service';
import { Vibe, VibeService } from '../../core/vibe.service';
import { Toasts } from '../../core/toast.service';
import { PasswordFieldComponent } from '../../shared/password-field.component';
import { scorePassword } from '../../shared/password-strength';
import { AvatarComponent, EmptyComponent, SpinnerComponent } from '../../shared/ui';

type Page =
  | 'root'
  | 'privacy'
  | 'close-friends'
  | 'favorites'
  | 'blocked'
  | 'muted'
  | 'messages'
  | 'comments'
  | 'hidden-words'
  | 'interactions'
  | 'password'
  | 'activity'
  | 'theme'
  | 'about';

interface Row {
  icon: string;
  label: string;
  page?: Page;
  link?: string;
  value?: () => string;
}

interface Section {
  title: string;
  rows: Row[];
}

/**
 * Settings and activity.
 *
 * <p>
 * Read the list and almost every row turns out to be a statement about the follow edge rather than about
 * content. Account privacy is a gate on the edge. Close friends is a named subset of the edges pointing
 * at you, favourites a named subset of the edges pointing away. "Who can message you" and "who can
 * comment" are the same test — does an edge exist, and does it run both ways — applied to two different
 * surfaces. Blocked deletes edges and raises a wall; muted keeps the edge and drops the content.
 * </p>
 *
 * <p>
 * That is why they are all on one screen: they are six ways of writing on the same graph.
 * </p>
 */
@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    AvatarComponent,
    EmptyComponent,
    SpinnerComponent,
    PasswordFieldComponent,
  ],
  template: `
    <div class="wrap">
      <header class="head">
        @if (page() !== 'root') {
          <button type="button" class="icon-btn" aria-label="Back" (click)="back()"><i class="bi bi-arrow-left"></i></button>
        }
        <h1 class="title">{{ heading() }}</h1>
      </header>

      @if (!settings() && page() !== 'theme' && page() !== 'about' && page() !== 'password') {
        <app-spinner />
      } @else {
        @switch (page()) {
          <!-- ------------------------------------------------------- root -->
          @case ('root') {
            <input
              class="input mb-16"
              placeholder="Search settings"
              [ngModel]="filter()"
              (ngModelChange)="filter.set($event)" />

            @for (section of visibleSections(); track section.title) {
              <p class="section">{{ section.title }}</p>

              <div class="card group">
                @for (row of section.rows; track row.label) {
                  @if (row.link) {
                    <a class="row" [routerLink]="row.link">
                      <i class="bi" [class]="row.icon"></i>
                      <span class="grow">{{ row.label }}</span>
                      <i class="bi bi-chevron-right muted tiny"></i>
                    </a>
                  } @else {
                    <button type="button" class="row" (click)="go(row.page!)">
                      <i class="bi" [class]="row.icon"></i>
                      <span class="grow">{{ row.label }}</span>
                      @if (row.value) {
                        <span class="muted small">{{ row.value() }}</span>
                      }
                      <i class="bi bi-chevron-right muted tiny"></i>
                    </button>
                  }
                }
              </div>
            }

            @if (visibleSections().length === 0) {
              <app-empty icon="bi-search" title="Nothing matches" [message]="'No setting called “' + filter() + '”.'" />
            }

            <button type="button" class="btn btn-secondary btn-block mt-24" (click)="auth.signOut()">
              Log out
            </button>
          }

          <!-- ---------------------------------------------------- privacy -->
          @case ('privacy') {
            <div class="card group">
              <button type="button" class="row" (click)="setPrivate(false)">
                <span class="col grow">
                  <span>Public</span>
                  <span class="tiny muted">Anybody can follow you, and the edge exists immediately.</span>
                </span>
                <span class="radio" [class.on]="!draft().isPrivate"></span>
              </button>
              <button type="button" class="row" (click)="setPrivate(true)">
                <span class="col grow">
                  <span>Private</span>
                  <span class="tiny muted">
                    A follow becomes a request. Until you accept it, the edge does not exist — so nothing
                    downstream has to special-case you.
                  </span>
                </span>
                <span class="radio" [class.on]="draft().isPrivate"></span>
              </button>
            </div>

            <p class="note small muted">
              Going public accepts everyone already waiting. Leaving them pending would be a queue nobody
              could clear.
            </p>
          }

          <!-- --------------------------------------------------- messages -->
          @case ('messages') {
            <p class="note small muted">
              Who may open a chat with you. Anybody allowed but not already connected lands under
              Requests rather than in your inbox — that split is decided by one question about the edge.
            </p>

            <div class="card group">
              @for (option of audiences; track option.value) {
                <button type="button" class="row" (click)="setMessagesFrom(option.value)">
                  <span class="col grow">
                    <span>{{ option.label }}</span>
                    <span class="tiny muted">{{ option.hint }}</span>
                  </span>
                  <span class="radio" [class.on]="draft().messagesFrom === option.value"></span>
                </button>
              }
            </div>
          }

          <!-- --------------------------------------------------- comments -->
          @case ('comments') {
            <p class="note small muted">Who may comment on your photos. The same test, on another surface.</p>

            <div class="card group">
              @for (option of audiences; track option.value) {
                <button type="button" class="row" (click)="setCommentsFrom(option.value)">
                  <span class="col grow">
                    <span>{{ option.label }}</span>
                    <span class="tiny muted">{{ option.hint }}</span>
                  </span>
                  <span class="radio" [class.on]="draft().commentsFrom === option.value"></span>
                </button>
              }
            </div>
          }

          <!-- ----------------------------------------------- hidden words -->
          @case ('hidden-words') {
            <p class="note small muted">
              Comma separated. A message request containing one of these is filed under Spam and a comment
              containing one is refused — with the same wording somebody outside your audience gets, so
              nobody can work out which word they tripped.
            </p>

            <textarea
              class="textarea"
              rows="4"
              placeholder="e.g. crypto, free followers, dm me"
              [ngModel]="draft().hiddenWords"
              (ngModelChange)="patch({ hiddenWords: $event })"></textarea>

            <button type="button" class="btn btn-block mt-12" (click)="save()">Save</button>
          }

          <!-- ------------------------------------------------ interactions -->
          @case ('interactions') {
            <div class="card group">
              <label class="row">
                <span class="col grow">
                  <span>Show activity status</span>
                  <span class="tiny muted">
                    Off hides your green dot from everybody — and theirs from you, because a setting that
                    only worked one way would be a one-way mirror.
                  </span>
                </span>
                <input
                  type="checkbox"
                  [ngModel]="draft().showActivityStatus"
                  (ngModelChange)="patch({ showActivityStatus: $event }); save()" />
              </label>

              <label class="row">
                <span class="col grow">
                  <span>Show read receipts</span>
                  <span class="tiny muted">Off stops “Seen” appearing under messages — in both directions.</span>
                </span>
                <input
                  type="checkbox"
                  [ngModel]="draft().showReadReceipts"
                  (ngModelChange)="patch({ showReadReceipts: $event }); save()" />
              </label>

              <label class="row">
                <span class="col grow">
                  <span>Hide like and share counts</span>
                  <span class="tiny muted">Hides the number on every post you see. Yours are still counted.</span>
                </span>
                <input
                  type="checkbox"
                  [ngModel]="draft().hideLikeCounts"
                  (ngModelChange)="patch({ hideLikeCounts: $event }); save()" />
              </label>
            </div>
          }

          <!-- ------------------------------------------------------ lists -->
          @case ('close-friends') {
            <p class="note small muted">
              Drawn from the accounts that follow you — a private note is no use to somebody who could
              never see it. Adding somebody creates no edge and tells them nothing.
            </p>

            @if (listLoading()) {
              <app-spinner />
            } @else if (list().length === 0) {
              <app-empty
                icon="bi-star"
                title="Nobody follows you yet"
                message="Close friends is a subset of your followers, so it fills up as they arrive." />
            } @else {
              <div class="card group">
                @for (person of list(); track person.id) {
                  <div class="row">
                    <app-avatar [user]="person" [size]="40" />
                    <span class="col grow" style="min-width:0">
                      <span class="strong ellipsis">{{ person.username }}</span>
                      <span class="tiny muted ellipsis">{{ person.fullName }}</span>
                    </span>
                    <button
                      type="button"
                      class="btn btn-sm"
                      [class.btn-secondary]="person.onList"
                      (click)="toggleList('close-friends', person)">
                      {{ person.onList ? 'Remove' : 'Add' }}
                    </button>
                  </div>
                }
              </div>
            }
          }

          @case ('favorites') {
            <p class="note small muted">
              Drawn from the accounts you follow. A favourite is the only signal in the feed ranking that
              you stated rather than the graph inferred, so it is added on top of everything else.
            </p>

            @if (listLoading()) {
              <app-spinner />
            } @else if (list().length === 0) {
              <app-empty
                icon="bi-bookmark-star"
                title="You follow nobody yet"
                message="Favourites is a subset of the accounts you follow." />
            } @else {
              <div class="card group">
                @for (person of list(); track person.id) {
                  <div class="row">
                    <app-avatar [user]="person" [size]="40" />
                    <span class="col grow" style="min-width:0">
                      <span class="strong ellipsis">{{ person.username }}</span>
                      <span class="tiny muted ellipsis">{{ person.fullName }}</span>
                    </span>
                    <button
                      type="button"
                      class="btn btn-sm"
                      [class.btn-secondary]="person.onList"
                      (click)="toggleList('favorites', person)">
                      {{ person.onList ? 'Remove' : 'Add' }}
                    </button>
                  </div>
                }
              </div>
            }
          }

          <!-- --------------------------------------------- blocked/muted -->
          @case ('blocked') {
            <p class="note small muted">
              A block deletes both edges and raises a wall every later traversal respects — including
              routes through somebody you both follow.
            </p>

            @if (people().length === 0) {
              <app-empty icon="bi-slash-circle" title="Nobody is blocked" />
            } @else {
              <div class="card group">
                @for (person of people(); track person.id) {
                  <div class="row">
                    <app-avatar [user]="person" [size]="40" />
                    <span class="col grow" style="min-width:0">
                      <span class="strong ellipsis">{{ person.username }}</span>
                      <span class="tiny muted ellipsis">{{ person.fullName }}</span>
                    </span>
                    <button type="button" class="btn btn-sm btn-secondary" (click)="unblock(person)">
                      Unblock
                    </button>
                  </div>
                }
              </div>
            }
          }

          @case ('muted') {
            <p class="note small muted">
              Muting changes no edges at all. You still follow them, they still see you as a follower, and
              they are never told — only the feed stops treating their posts as candidates.
            </p>

            @if (people().length === 0) {
              <app-empty icon="bi-bell-slash" title="Nobody is muted" />
            } @else {
              <div class="card group">
                @for (person of people(); track person.id) {
                  <div class="row">
                    <app-avatar [user]="person" [size]="40" />
                    <span class="col grow" style="min-width:0">
                      <span class="strong ellipsis">{{ person.username }}</span>
                      <span class="tiny muted ellipsis">{{ person.fullName }}</span>
                    </span>
                    <button type="button" class="btn btn-sm btn-secondary" (click)="unmute(person)">
                      Unmute
                    </button>
                  </div>
                }
              </div>
            }
          }

          <!-- --------------------------------------------------- activity -->
          @case ('activity') {
            @if (activity(); as summary) {
              <div class="stats">
                @for (stat of stats(); track stat.label) {
                  <div class="stat card">
                    <span class="n">{{ stat.value }}</span>
                    <span class="tiny muted">{{ stat.label }}</span>
                  </div>
                }
              </div>

              <p class="note small muted">
                “Friends” is not stored anywhere: it is the accounts you follow intersected with the
                accounts that follow you — the only symmetric relationship a directed edge set has.
              </p>
            } @else {
              <app-spinner />
            }
          }

          <!-- ------------------------------------------------------ theme -->
          @case ('theme') {
            <p class="section">Light and dark</p>

            <div class="card group">
              @for (option of themes; track option.value) {
                <button type="button" class="row" (click)="theme.set(option.value)">
                  <i class="bi" [class]="option.icon"></i>
                  <span class="grow">{{ option.label }}</span>
                  <span class="radio" [class.on]="theme.theme() === option.value"></span>
                </button>
              }
            </div>

            <!-- The colour half of the same decision. It is deliberately a separate list rather than
                 seven more radio rows: a colour is chosen by looking at it, not by reading its name. -->
            <p class="section">Vibe</p>

            <div class="vibes">
              @for (v of vibes.all; track v.id) {
                <button
                  type="button"
                  class="vibe"
                  [class.on]="vibes.vibe() === v.id"
                  (click)="vibes.set(v.id)">
                  <span class="paint" [style.background]="paint(v)">
                    @if (vibes.vibe() === v.id) {
                      <i class="bi bi-check-lg"></i>
                    }
                  </span>
                  <span class="vibe-name">{{ v.name }}</span>
                </button>
              }
            </div>

            <div class="card group">
              <button
                type="button"
                class="row"
                role="switch"
                [attr.aria-checked]="vibes.aura()"
                (click)="vibes.setAura(!vibes.aura())">
                <i class="bi bi-stars"></i>
                <span class="col grow" style="text-align:left">
                  <span>Aura background</span>
                  <span class="tiny muted">The colour drifting behind every page.</span>
                </span>
                <span class="switch" [attr.aria-checked]="vibes.aura()"></span>
              </button>
            </div>
          }

          <!-- --------------------------------------------------- password -->
          @case ('password') {
            @if (changed()) {
              <div class="card done" style="padding:22px;text-align:center">
                <span class="done-ring"><i class="bi bi-check-lg"></i></span>
                <p class="strong" style="margin:0 0 6px">Your password is changed</p>
                <p class="small muted" style="margin:0">
                  Every other browser signed in as
                  <strong>&#64;{{ auth.username() }}</strong> has been signed out. This one carried on
                  because it was handed a new session with the answer.
                </p>
              </div>

              <button type="button" class="btn btn-secondary btn-block mt-16" (click)="back()">
                Done
              </button>
            } @else {
              <form (ngSubmit)="changePassword()">
                <div class="card" style="padding:18px">
                  <app-password-field
                    [(value)]="currentPassword"
                    label="Current password"
                    name="currentPassword"
                    autocomplete="current-password"
                    [meter]="false" />

                  <hr class="rule" />

                  <app-password-field
                    [(value)]="newPassword"
                    label="New password"
                    name="newPassword"
                    [username]="auth.username()" />

                  <app-password-field
                    [(value)]="confirmPassword"
                    label="Confirm new password"
                    name="confirmPassword"
                    [meter]="false" />

                  @if (confirmPassword().length > 0 && confirmPassword() !== newPassword()) {
                    <p class="small" style="color:var(--danger);margin:-4px 0 8px">
                      Those two do not match.
                    </p>
                  }
                </div>

                <button
                  class="btn btn-block mt-16"
                  type="submit"
                  [disabled]="!canChangePassword() || saving()">
                  {{ saving() ? 'Changing…' : 'Change password' }}
                </button>

                @if (passwordError()) {
                  <p class="small" style="color:var(--danger);margin:12px 0 0">{{ passwordError() }}</p>
                }
              </form>

              <!--
                Said before it happens rather than after. Ending other sessions is the useful half of
                changing a password, and it is also the half that surprises somebody who was signed in
                on a phone — so it belongs above the button, not in a toast behind it.
              -->
              <p class="note small muted">
                <i class="bi bi-shield-lock"></i>
                Changing your password signs out every other browser and phone using the old one. This
                one stays signed in.
              </p>

              <p class="note small muted">
                <a routerLink="/reset-password">Forgotten your current password?</a> You will need to be
                signed out to reset it by email.
              </p>
            }
          }

          <!-- ------------------------------------------------------ about -->
          @case ('about') {
            <div class="card" style="padding:18px">
              <p class="strong mb-8">InstaGraph</p>
              <p class="small muted">
                A photo-sharing app whose feed, suggestions, story row, explore grid, message requests and
                notes are all questions asked of one directed edge set. Follows are the edges; everything
                else is a traversal.
              </p>
              <hr class="rule" />
              <p class="small muted" style="margin:0">
                Messaging adds a second graph on top: undirected, weighted by traffic, and able to exist
                between two accounts with no follow between them at all. Every message you send adds to
                the weight on whatever follow edges do exist, and that weight is the affinity term in your
                feed — which is why talking to somebody quietly moves their photos up it.
              </p>
            </div>
          }
        }
      }
    </div>
  `,
  styles: [
    `
      .wrap {
        max-width: 640px;
        margin: 0 auto;
        padding-bottom: 40px;
      }

      .head {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 18px;
      }

      .icon-btn {
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 20px;
        padding: 0;
        line-height: 1;
      }

      .section {
        font-size: 12px;
        font-weight: 600;
        color: var(--ink-3);
        margin: 20px 2px 8px;
      }

      .group {
        overflow: hidden;
      }

      .row {
        display: flex;
        align-items: center;
        gap: 14px;
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--ink);
        text-align: left;
        padding: 14px 16px;
        font-size: 14px;
        border-bottom: 1px solid var(--border-soft);
      }

      .row:last-child {
        border-bottom: 0;
      }

      button.row:hover,
      a.row:hover,
      label.row:hover {
        background: var(--border-soft);
      }

      .row i.bi {
        font-size: 18px;
        width: 20px;
        flex: none;
      }

      .radio {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 1.5px solid var(--ink-4);
        flex: none;
        position: relative;
      }

      .radio.on {
        border-color: var(--accent);
        border-width: 6px;
      }

      /* ------------------------------------------------------------- vibes */

      .vibes {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
        gap: 10px;
        margin-bottom: 22px;
      }

      .vibe {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 12px 6px;
        border: 1.5px solid var(--border);
        border-radius: var(--radius);
        background: var(--surface);
        color: var(--ink);
        transition: transform 0.18s var(--spring), border-color 0.14s var(--ease),
          box-shadow 0.18s var(--ease);
      }

      .vibe:hover {
        transform: translateY(-3px);
        border-color: var(--ink-4);
      }

      .vibe.on {
        border-color: transparent;
        box-shadow: 0 0 0 2px var(--accent), 0 10px 24px -14px var(--glow);
      }

      .paint {
        width: 46px;
        height: 46px;
        border-radius: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 18px;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
      }

      .vibe-name {
        font-size: 12px;
        font-weight: 700;
      }

      .note {
        margin: 0 2px 14px;
        line-height: 1.6;
      }

      .note a {
        color: var(--accent);
        font-weight: 600;
      }

      /* The same tick the sign-up flow finishes on, so "that worked" looks the same everywhere. */
      .done-ring {
        display: grid;
        place-items: center;
        width: 62px;
        height: 62px;
        margin: 0 auto 14px;
        border-radius: 50%;
        font-size: 26px;
        color: var(--brand-ink, #fff);
        background: var(--brand);
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 10px;
        margin-bottom: 16px;
      }

      .stat {
        padding: 16px 10px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }

      .stat .n {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.5px;
      }

      @media (max-width: 560px) {
        .stats {
          grid-template-columns: repeat(2, 1fr);
        }
      }
    `,
  ],
})
export class SettingsComponent implements OnInit {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly prefs = inject(Prefs);
  protected readonly auth = inject(Auth);
  protected readonly theme = inject(ThemeService);
  protected readonly vibes = inject(VibeService);

  /** Each swatch paints itself from the vibe's own stops; only the selected one's --brand is in scope. */
  protected paint(v: Vibe): string {
    return `linear-gradient(135deg, ${v.stops[0]} 0%, ${v.stops[1]} 50%, ${v.stops[2]} 100%)`;
  }

  protected readonly page = signal<Page>('root');
  protected readonly filter = signal('');
  protected readonly settings = signal<Settings | null>(null);
  protected readonly draft = signal<Settings>(blank());

  protected readonly list = signal<ListMember[]>([]);
  protected readonly listLoading = signal(false);
  protected readonly people = signal<UserSummary[]>([]);
  protected readonly activity = signal<ActivitySummary | null>(null);

  protected readonly audiences: { value: AudienceValue; label: string; hint: string }[] = [
    { value: 'Everyone', label: 'Everyone', hint: 'No test on the edge at all.' },
    { value: 'Following', label: 'People you follow', hint: 'There must be an edge from you to them.' },
    { value: 'Friends', label: 'People you follow who follow you', hint: 'The edge has to run both ways.' },
    { value: 'NoOne', label: 'No one', hint: 'Refuses everybody new. Existing conversations are untouched.' },
  ];

  protected readonly themes = [
    { value: 'light' as const, label: 'Light', icon: 'bi-sun' },
    { value: 'dark' as const, label: 'Dark', icon: 'bi-moon-stars' },
    { value: 'system' as const, label: 'Follow the system', icon: 'bi-circle-half' },
  ];

  private readonly sections = computed<Section[]>(() => {
    const s = this.settings();

    return [
      {
        title: 'How you use InstaGraph',
        rows: [
          { icon: 'bi-person', label: 'Edit profile', link: `/${this.auth.username()}` },
          { icon: 'bi-bookmark', label: 'Saved', link: `/${this.auth.username()}` },
          { icon: 'bi-activity', label: 'Your activity', page: 'activity' },
          { icon: 'bi-bell', label: 'Notifications', link: '/activity' },
          { icon: 'bi-diagram-3', label: 'Your network', link: '/network' },
        ],
      },
      {
        title: 'Who can see your content',
        rows: [
          {
            icon: 'bi-lock',
            label: 'Account privacy',
            page: 'privacy',
            value: () => (s?.isPrivate ? 'Private' : 'Public'),
          },
          {
            icon: 'bi-star',
            label: 'Close friends',
            page: 'close-friends',
            value: () => String(s?.closeFriendCount ?? 0),
          },
          {
            icon: 'bi-slash-circle',
            label: 'Blocked',
            page: 'blocked',
            value: () => String(s?.blockedCount ?? 0),
          },
          {
            icon: 'bi-bell-slash',
            label: 'Muted accounts',
            page: 'muted',
            value: () => String(s?.mutedCount ?? 0),
          },
        ],
      },
      {
        title: 'How others can interact with you',
        rows: [
          {
            icon: 'bi-chat-dots',
            label: 'Messages and story replies',
            page: 'messages',
            value: () => label(s?.messagesFrom),
          },
          {
            icon: 'bi-chat-square-text',
            label: 'Comments',
            page: 'comments',
            value: () => label(s?.commentsFrom),
          },
          { icon: 'bi-fonts', label: 'Hidden words', page: 'hidden-words' },
          { icon: 'bi-toggles', label: 'Activity, receipts and counts', page: 'interactions' },
        ],
      },
      {
        title: 'What you see',
        rows: [
          {
            icon: 'bi-bookmark-star',
            label: 'Favourites',
            page: 'favorites',
            value: () => String(s?.favoriteCount ?? 0),
          },
          { icon: 'bi-compass', label: 'Explore', link: '/explore' },
          { icon: 'bi-person-plus', label: 'Discover people', link: '/discover' },
        ],
      },
      {
        title: 'Password and security',
        rows: [
          {
            icon: 'bi-key',
            label: 'Change password',
            page: 'password',
          },
        ],
      },
      {
        title: 'Your app and media',
        rows: [
          {
            icon: 'bi-palette2',
            label: 'Appearance and vibe',
            page: 'theme',
            value: () => `${this.vibes.current().name} · ${this.theme.label()}`,
          },
        ],
      },
      {
        title: 'More info and support',
        rows: [{ icon: 'bi-info-circle', label: 'About', page: 'about' }],
      },
    ];
  });

  // ------------------------------------------------------------------ password

  protected readonly currentPassword = signal('');
  protected readonly newPassword = signal('');
  protected readonly confirmPassword = signal('');
  protected readonly passwordError = signal('');
  protected readonly saving = signal(false);
  protected readonly changed = signal(false);

  protected canChangePassword() {
    return (
      this.currentPassword().length > 0 &&
      scorePassword(this.newPassword(), this.auth.username()).acceptable &&
      this.confirmPassword() === this.newPassword() &&
      this.newPassword() !== this.currentPassword()
    );
  }

  protected changePassword() {
    if (!this.canChangePassword() || this.saving()) return;

    this.saving.set(true);
    this.passwordError.set('');

    this.api.changePassword(this.currentPassword(), this.newPassword()).subscribe({
      next: (result) => {
        this.saving.set(false);

        // The change has just invalidated the token this browser was using. Adopting the replacement is
        // what keeps the screen it happened on working — without it, the very next request 401s and the
        // app signs itself out to celebrate a successful password change.
        this.auth.adoptSession(result);

        this.currentPassword.set('');
        this.newPassword.set('');
        this.confirmPassword.set('');
        this.changed.set(true);
      },
      error: (err) => {
        this.saving.set(false);
        this.passwordError.set(err.error?.message ?? 'Could not change your password.');
      },
    });
  }

  protected readonly visibleSections = computed(() => {
    const term = this.filter().trim().toLowerCase();
    if (!term) return this.sections();

    return this.sections()
      .map((section) => ({
        ...section,
        rows: section.rows.filter((row) => row.label.toLowerCase().includes(term)),
      }))
      .filter((section) => section.rows.length > 0);
  });

  protected readonly stats = computed(() => {
    const a = this.activity();
    if (!a) return [];

    return [
      { label: 'posts', value: a.posts },
      { label: 'followers', value: a.followers },
      { label: 'following', value: a.following },
      { label: 'friends', value: a.friends },
      { label: 'likes given', value: a.likesGiven },
      { label: 'comments', value: a.commentsWritten },
      { label: 'saved', value: a.saved },
      { label: 'messages sent', value: a.messagesSent },
      { label: 'conversations', value: a.conversations },
    ];
  });

  ngOnInit() {
    this.reload();
  }

  private reload() {
    this.api.settings().subscribe({
      next: (settings) => {
        this.settings.set(settings);
        this.draft.set(settings);
        this.prefs.set(settings);
      },
    });
  }

  private clearPasswordForm() {
    this.currentPassword.set('');
    this.newPassword.set('');
    this.confirmPassword.set('');
    this.passwordError.set('');
    this.changed.set(false);
  }

  protected heading() {
    return {
      root: 'Settings and activity',
      privacy: 'Account privacy',
      'close-friends': 'Close friends',
      favorites: 'Favourites',
      blocked: 'Blocked accounts',
      muted: 'Muted accounts',
      messages: 'Messages',
      comments: 'Comments',
      'hidden-words': 'Hidden words',
      interactions: 'Interactions',
      password: 'Change password',
      activity: 'Your activity',
      theme: 'Appearance',
      about: 'About',
    }[this.page()];
  }

  protected go(page: Page) {
    this.page.set(page);

    if (page === 'password') {
      this.clearPasswordForm();
    }

    if (page === 'close-friends' || page === 'favorites') {
      this.loadList(page);
    } else if (page === 'blocked') {
      this.api.blocked().subscribe({ next: (people) => this.people.set(people) });
    } else if (page === 'muted') {
      this.api.muted().subscribe({ next: (people) => this.people.set(people) });
    } else if (page === 'activity') {
      this.api.activitySummary().subscribe({ next: (summary) => this.activity.set(summary) });
    }
  }

  protected back() {
    this.page.set('root');
    this.clearPasswordForm();
    this.reload();
  }

  // ------------------------------------------------------------------- saving

  protected patch(change: Partial<Settings>) {
    this.draft.update((current) => ({ ...current, ...change }));
  }

  protected setPrivate(isPrivate: boolean) {
    this.patch({ isPrivate });
    this.save();
  }

  protected setMessagesFrom(messagesFrom: AudienceValue) {
    this.patch({ messagesFrom });
    this.save();
  }

  protected setCommentsFrom(commentsFrom: AudienceValue) {
    this.patch({ commentsFrom });
    this.save();
  }

  protected save() {
    const d = this.draft();

    this.api
      .updateSettings({
        isPrivate: d.isPrivate,
        messagesFrom: d.messagesFrom,
        commentsFrom: d.commentsFrom,
        showActivityStatus: d.showActivityStatus,
        showReadReceipts: d.showReadReceipts,
        hideLikeCounts: d.hideLikeCounts,
        hiddenWords: d.hiddenWords,
      })
      .subscribe({
        next: (settings) => {
          this.settings.set(settings);
          this.draft.set(settings);
          this.prefs.set(settings);
          this.toasts.show('Saved.');
        },
        error: (error) => this.toasts.error(error.error?.message ?? 'Could not save that.'),
      });
  }

  // -------------------------------------------------------------------- lists

  private loadList(kind: 'close-friends' | 'favorites') {
    this.listLoading.set(true);

    this.api.userList(kind).subscribe({
      next: (page) => {
        this.listLoading.set(false);
        this.list.set(page.items);
      },
      error: () => this.listLoading.set(false),
    });
  }

  protected toggleList(kind: 'close-friends' | 'favorites', person: ListMember) {
    const next = !person.onList;

    this.api.setListEntry(kind, person.username, next).subscribe({
      next: () =>
        this.list.update((all) =>
          all.map((p) => (p.id === person.id ? { ...p, onList: next } : p)),
        ),
      error: (error) => this.toasts.error(error.error?.message ?? 'Could not change that list.'),
    });
  }

  protected unblock(person: UserSummary) {
    this.api.unblock(person.username).subscribe({
      next: () => {
        this.people.update((all) => all.filter((p) => p.id !== person.id));
        this.toasts.show('Unblocked. Nobody was re-followed.');
      },
    });
  }

  protected unmute(person: UserSummary) {
    this.api.unmute(person.username).subscribe({
      next: () => {
        this.people.update((all) => all.filter((p) => p.id !== person.id));
        this.toasts.show('Unmuted. Their posts are candidates again.');
      },
    });
  }
}

function blank(): Settings {
  return {
    isPrivate: false,
    messagesFrom: 'Everyone',
    commentsFrom: 'Everyone',
    showActivityStatus: true,
    showReadReceipts: true,
    hideLikeCounts: false,
    hiddenWords: '',
    closeFriendCount: 0,
    favoriteCount: 0,
    blockedCount: 0,
    mutedCount: 0,
  };
}

function label(value: AudienceValue | undefined): string {
  return {
    Everyone: 'Everyone',
    Following: 'People you follow',
    Friends: 'Friends',
    NoOne: 'No one',
  }[value ?? 'Everyone'];
}
