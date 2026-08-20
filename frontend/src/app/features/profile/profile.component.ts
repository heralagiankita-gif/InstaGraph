import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import {
  Collection,
  ConnectionPath,
  Post,
  Profile,
  StoryHighlight,
  UserRelation,
  UserSummary,
} from '../../core/models';
import { StoryTray } from '../../core/models';
import { Toasts } from '../../core/toast.service';
import { StoryViewerComponent } from '../stories/story-viewer.component';
import { ThemeService } from '../../core/theme.service';
import { FollowButtonComponent } from '../../shared/follow-button.component';
import { InfiniteScrollComponent } from '../../shared/infinite-scroll.component';
import { PostGridComponent } from '../../shared/post-grid.component';
import { ProfileCardComponent } from '../../shared/profile-card.component';
import { RichTextComponent } from '../../shared/rich-text.component';
import { GridSkeletonComponent, ListSkeletonComponent } from '../../shared/skeletons';
import {
  AvatarComponent,
  EmptyComponent,
  SpinnerComponent,
  UserRowComponent,
  VerifiedBadgeComponent,
} from '../../shared/ui';

type ListKind = 'followers' | 'following' | 'friends' | null;

@Component({
  selector: 'app-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    DecimalPipe,
    PostGridComponent,
    InfiniteScrollComponent,
    GridSkeletonComponent,
    ListSkeletonComponent,
    AvatarComponent,
    UserRowComponent,
    FollowButtonComponent,
    ProfileCardComponent,
    EmptyComponent,
    SpinnerComponent,
    RichTextComponent,
    StoryViewerComponent,
    VerifiedBadgeComponent,
  ],
  template: `
    <div class="page">
      @if (loadError(); as problem) {
        <!-- Something went wrong, and it says so. Before this, every failure here left the spinner
             turning for ever: a profile that could not load was indistinguishable from one that was
             still loading, which is the worst of the two to look at because there is nothing to do
             about it. -->
        <app-empty icon="bi-exclamation-circle" title="Could not open that profile" [message]="problem">
          <button type="button" class="btn" (click)="retry()">Try again</button>
          <a class="btn btn-secondary" routerLink="/">Go home</a>
        </app-empty>
      } @else if (!profile()) {
        <app-spinner />
      } @else if (profile(); as user) {
        <!-- ------------------------------------------------------- header -->
        <header class="head">
          <div class="avatar-wrap">
            <!-- A live story turns the profile picture into the way into it, the same as the row on
                 the feed. No ring at all when there is nothing to open. -->
            @if (stories(); as tray) {
              <button type="button" class="story-ring" [class.seen]="!tray.hasUnseen" (click)="openStories()">
                <span class="ring-inner">
                  <app-avatar [user]="user" [size]="140" />
                </span>
              </button>
            } @else {
              <app-avatar [user]="user" [size]="150" />
            }

            @if (user.isMe) {
              <label class="avatar-edit" title="Change profile photo">
                <i class="bi bi-camera-fill"></i>
                <input type="file" accept="image/*" hidden (change)="changeAvatar($event)" />
              </label>
            }
          </div>

          <div class="details">
            <div class="row wrap gap-12 mb-16">
              <h1 class="handle">{{ user.username }}</h1>
              <app-verified [user]="user" [size]="18" />

              @if (user.isMe) {
                <button class="btn btn-secondary btn-sm" type="button" (click)="openEdit()">Edit profile</button>
                <a class="btn btn-secondary btn-sm" routerLink="/settings">Settings</a>
                <!-- The profile as something you can actually post somewhere else. -->
                <button class="btn btn-secondary btn-sm" type="button" (click)="cardOpen.set(true)"
                        title="Share your profile card">
                  <i class="bi bi-qr-code"></i>
                </button>
                <button class="btn btn-secondary btn-sm" type="button" (click)="menuOpen.set(true)"
                        aria-label="Settings">
                  <i class="bi bi-gear"></i>
                </button>
              } @else if (user.isBlocked) {
                <button class="btn btn-secondary btn-sm" type="button" (click)="unblock()">Unblock</button>
              } @else {
                <!--
                  One component for all five states, shared with every list and card in the app, so a
                  follow button can never disagree with itself from one screen to the next.
                -->
                <app-follow-button [user]="user" (changed)="onRelationChanged($event)" />

                <!--
                  Messaging does not need a follow in either direction. Without one the thread simply
                  lands under their Requests instead of their inbox, which is the whole gate.
                -->
                <button class="btn btn-secondary btn-sm" type="button" (click)="message(user.username)">
                  Message
                </button>

                <!-- Their request is waiting on your private account: answer it from here. -->
                @if (user.requestedYou) {
                  <button class="btn btn-sm" type="button" (click)="confirmRequest()">Confirm</button>
                }

                <button class="btn btn-secondary btn-sm" type="button" (click)="cardOpen.set(true)"
                        title="Share this profile">
                  <i class="bi bi-qr-code"></i>
                </button>

                <button class="btn btn-secondary btn-sm" type="button" (click)="menuOpen.set(true)"
                        aria-label="More options">
                  <i class="bi bi-three-dots"></i>
                </button>
              }
            </div>

            <!-- Four tiles rather than a sentence of numbers. Three of them open a list, so they are
                 targets as well as figures, and a target the size of a word is a poor one. -->
            <div class="counts mb-16">
              <span class="tile">
                <b class="count">{{ user.postCount }}</b>
                <em>posts</em>
              </span>
              <button type="button" class="tile" (click)="openList('followers')">
                <b class="count">{{ user.followerCount }}</b>
                <em>followers</em>
              </button>
              <button type="button" class="tile" (click)="openList('following')">
                <b class="count">{{ user.followingCount }}</b>
                <em>following</em>
              </button>
              <!-- Not a stored count: the size of the intersection of their two adjacency lists. -->
              <button type="button" class="tile" (click)="openList('friends')" title="Follows each other">
                <b class="count">{{ user.friendCount }}</b>
                <em>friends</em>
              </button>
            </div>

            <div class="col gap-4 about">
              <span class="strong">{{ user.fullName }}</span>

              @if (user.bio) {
                <app-rich-text class="bio" [text]="user.bio" />
              } @else if (user.isMe) {
                <button type="button" class="add-bio tiny" (click)="openEdit()">
                  <i class="bi bi-plus-lg"></i> Add a bio
                </button>
              }

              <div class="row gap-8 wrap mt-4">
                <!-- Both edges is a different fact from one, and gets a different word. -->
                @if (user.isFriend && !user.isMe) {
                  <span class="pill tiny friend"><i class="bi bi-people-fill"></i> Friends</span>
                } @else if (user.followsYou && !user.isMe) {
                  <span class="pill tiny">Follows you</span>
                } @else if (user.requestedYou && !user.isMe) {
                  <span class="pill tiny"><i class="bi bi-hourglass"></i> Requested to follow you</span>
                }
                @if (user.isPrivate) {
                  <span class="pill tiny"><i class="bi bi-lock-fill"></i> Private</span>
                }
                @if (user.isMuted) {
                  <span class="pill tiny"><i class="bi bi-volume-mute-fill"></i> Muted</span>
                }
              </div>
            </div>

            <!-- The graph, showing itself only as a sentence about people you both know. -->
            @if (user.mutualFollowerCount > 0) {
              <div class="row gap-8 mt-12 mutuals">
                <span class="stack">
                  @for (m of user.mutualFollowers; track m.id) {
                    <app-avatar [user]="m" [size]="22" />
                  }
                </span>
                <span class="tiny muted">{{ mutualText(user) }}</span>
              </div>
            }

            <!--
              And the same graph showing its working: the shortest route between the two of you, with the
              accounts in between named. "2nd degree" is a claim; the chain is the evidence.
            -->
            @if (!user.isMe && connection(); as link) {
              <div class="connection">
                <span class="pill tiny" title="Shortest route through the follow graph">
                  <i class="bi bi-diagram-2"></i> {{ link.summary }}
                </span>

                @if (link.sameCommunity) {
                  <span class="pill tiny" title="Label propagation put you both in the same cluster">
                    <i class="bi bi-people"></i> Same community
                  </span>
                }

                @if (link.similarity > 0) {
                  <span class="pill tiny" title="Jaccard overlap of what you each follow">
                    <i class="bi bi-intersect"></i>
                    {{ link.similarity * 100 | number: '1.0-0' }}% shared follows
                  </span>
                }

                @if (link.path.length > 2) {
                  <span class="route">
                    @for (step of link.path; track $index; let last = $last) {
                      <a [routerLink]="['/', step.username]" class="tiny">{{ $index === 0 ? 'you' : step.username }}</a>
                      @if (!last) {
                        <span class="tiny muted">→</span>
                      }
                    }
                  </span>
                }
              </div>
            }
          </div>
        </header>

        <!-- --------------------------------------------------- story highlights -->
        @if (highlights().length > 0 || user.isMe) {
          <div class="rings">
            @for (highlight of highlights(); track highlight.id) {
              <button type="button" class="ring" (click)="openHighlight(highlight)">
                <span class="ring-art">
                  @if (highlight.coverUrl) {
                    <img [src]="api.imageUrl(highlight.coverUrl)" alt="" />
                  } @else {
                    <i class="bi bi-images"></i>
                  }
                </span>
                <span class="tiny ellipsis">{{ highlight.title }}</span>
              </button>
            }

            @if (user.isMe) {
              <!-- Highlights are built out of the story archive, so the button goes where the stories
                   are rather than opening a picker with nothing in it. -->
              <a class="ring" routerLink="/archive">
                <span class="ring-art new"><i class="bi bi-plus-lg"></i></span>
                <span class="tiny">New</span>
              </a>
            }
          </div>
        }

        <!-- ---------------------------------------------------------- tabs -->
        <nav class="tabs">
          <button type="button" class="tab" [class.on]="tab() === 'posts'" (click)="showTab('posts')">
            <i class="bi bi-grid-3x3"></i> POSTS
          </button>

          <button type="button" class="tab" [class.on]="tab() === 'tagged'" (click)="showTab('tagged')">
            <i class="bi bi-person-square"></i> TAGGED
          </button>

          @if (user.isMe) {
            <button type="button" class="tab" [class.on]="tab() === 'saved'" (click)="showTab('saved')">
              <i class="bi bi-bookmark"></i> SAVED
            </button>
          }
        </nav>

        <!-- --------------------------------------------------------- grid -->
        @if (user.isBlocked) {
          <app-empty
            icon="bi-slash-circle"
            title="You blocked this account"
            message="Neither of you can see the other's posts, and neither can appear in the other's suggestions. Unblocking lifts that — it does not restore the follows." />
        } @else if (user.isLocked) {
          <app-empty
            icon="bi-lock"
            title="This account is private"
            [message]="
              user.followRequested
                ? 'Your request is waiting to be approved.'
                : 'Follow this account to see their photos.'
            " />
        } @else if (tab() === 'tagged') {
          @if (loadingTagged()) {
            <app-grid-skeleton [count]="6" />
          } @else if (tagged().length === 0) {
            <app-empty
              icon="bi-person-square"
              [title]="user.isMe ? 'No photos of you yet' : 'No tagged photos'"
              message="When somebody names this account in a photo, it shows up here." />
          } @else {
            <app-post-grid [posts]="tagged()" />
          }
        } @else if (tab() === 'saved') {
          <!-- Folders first, then whatever is not in one. A collection only sorts what is already
               saved, so opening one is a filter rather than a different list. -->
          <div class="folders">
            @for (folder of collections(); track folder.id) {
              <button
                type="button"
                class="folder"
                [class.on]="folder.id === openFolder()"
                (click)="openCollection(folder.id === openFolder() ? null : folder.id)">
                <span class="folder-art">
                  @if (folder.coverUrl) {
                    <img [src]="api.imageUrl(folder.coverUrl)" alt="" />
                  } @else {
                    <i class="bi bi-collection"></i>
                  }
                </span>
                <span class="tiny ellipsis">{{ folder.name }}</span>
                <span class="tiny muted">{{ folder.itemCount }}</span>
              </button>
            }

            <button type="button" class="folder" (click)="newCollection()">
              <span class="folder-art new"><i class="bi bi-plus-lg"></i></span>
              <span class="tiny">New</span>
            </button>
          </div>

          @if (loadingSaved()) {
            <app-grid-skeleton [count]="6" />
          } @else if (saved().length === 0) {
            <app-empty
              icon="bi-bookmark"
              [title]="openFolder() ? 'Nothing filed here yet' : 'Save photos for later'"
              [message]="
                openFolder()
                  ? 'Open a saved post and file it into this collection.'
                  : 'Tap the bookmark on any post and it appears here. Only you can see what you save.'
              " />
          } @else {
            <app-post-grid [posts]="saved()" />
          }
        } @else if (loadingPosts() && posts().length === 0) {
          <app-grid-skeleton [count]="6" />
        } @else if (posts().length === 0) {
          <app-empty
            icon="bi-camera"
            [title]="user.isMe ? 'Share your first photo' : 'No posts yet'"
            [message]="
              user.isMe
                ? 'When you share photos, they will appear on your profile.'
                : 'This account has not posted anything.'
            ">
            @if (user.isMe) {
              <a class="btn" routerLink="/create"><i class="bi bi-plus-lg"></i> Share a photo</a>
            }
          </app-empty>
        } @else {
          <app-post-grid [posts]="posts()" />

          <app-infinite-scroll
            [hasMore]="hasMore()"
            [loading]="loadingPosts()"
            [showEnd]="false"
            (more)="loadMorePosts()" />
        }
      }
    </div>

    <!-- ----------------------------------------------- followers / following -->
    @if (listKind()) {
      <div class="modal-backdrop" (click)="listKind.set(null)">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">{{ listTitle() }}</div>

          <div style="padding:8px 16px 16px">
            @if (listPeople() === null) {
              <app-list-skeleton [count]="5" />
            } @else if (listPeople()!.length === 0) {
              <p class="muted small" style="text-align:center;padding:20px">
                {{
                  listKind() === 'friends'
                    ? 'No edges here run both ways yet.'
                    : 'Nobody yet.'
                }}
              </p>
            } @else {
              @for (person of listPeople()!; track person.id) {
                <app-user-row [user]="person" [subtitle]="rowSubtitle(person)">
                  <!-- Every row knows the relationship, so no row can offer to follow a friend. -->
                  <app-follow-button [user]="person" (changed)="onRowChanged(person, $event)" />
                </app-user-row>
              }
            }
          </div>
        </div>
      </div>
    }

    <!-- ------------------------------------------------------ actions menu -->
    @if (menuOpen() && profile(); as user) {
      <div class="modal-backdrop" (click)="menuOpen.set(false)">
        <div class="modal menu" style="max-width:340px" (click)="$event.stopPropagation()">
          @if (user.isMe) {
            <button type="button" class="menu-item" (click)="openBlocked()">Blocked accounts</button>
            <button type="button" class="menu-item" (click)="openEdit(); menuOpen.set(false)">
              {{ user.isPrivate ? 'Account is private' : 'Account is public' }}
            </button>
            <button type="button" class="menu-item" (click)="theme.cycle()">Theme · {{ theme.label() }}</button>
            <button type="button" class="menu-item danger" (click)="signOut()">Log out</button>
            <button type="button" class="menu-item" (click)="menuOpen.set(false)">Cancel</button>
          } @else {
          <button type="button" class="menu-item danger" (click)="block()">Block</button>

          @if (user.isFollowing) {
            <button type="button" class="menu-item" (click)="toggleMute()">
              {{ user.isMuted ? 'Unmute' : 'Mute' }}
            </button>
            <button type="button" class="menu-item" (click)="toggleFollow(); menuOpen.set(false)">Unfollow</button>
          }

          @if (user.followRequested) {
            <button type="button" class="menu-item" (click)="toggleFollow(); menuOpen.set(false)">
              Cancel follow request
            </button>
          }

          @if (user.followsYou) {
            <button type="button" class="menu-item" (click)="removeFollower()">Remove this follower</button>
          }

          <button type="button" class="menu-item" (click)="menuOpen.set(false)">Cancel</button>
          }
        </div>
      </div>
    }

    <!-- --------------------------------------------------- blocked accounts -->
    @if (blockedOpen()) {
      <div class="modal-backdrop" (click)="blockedOpen.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">Blocked accounts</div>

          <div style="padding:8px 16px 16px">
            @if (blockedList() === null) {
              <app-list-skeleton [count]="3" />
            } @else if (blockedList()!.length === 0) {
              <p class="muted small" style="text-align:center;padding:24px 8px">
                You haven't blocked anyone.
              </p>
            } @else {
              @for (person of blockedList()!; track person.id) {
                <app-user-row [user]="person">
                  <button class="btn btn-secondary btn-sm" type="button" (click)="unblockFrom(person.username)">
                    Unblock
                  </button>
                </app-user-row>
              }
            }
          </div>
        </div>
      </div>
    }

    <!-- ------------------------------------------------------ edit profile -->
    @if (editing()) {
      <div class="modal-backdrop" (click)="editing.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">Edit profile</div>

          <div style="padding:16px">
            <div class="field">
              <label class="label" for="fullName">Name</label>
              <input
                id="fullName"
                class="input"
                name="fullName"
                maxlength="80"
                [ngModel]="editName()"
                (ngModelChange)="editName.set($event)" />
            </div>

            <div class="field">
              <label class="label" for="bio">Bio</label>
              <textarea
                id="bio"
                class="textarea"
                name="bio"
                maxlength="300"
                [ngModel]="editBio()"
                (ngModelChange)="editBio.set($event)"></textarea>
            </div>

            <label class="row gap-8 mb-16" style="cursor:pointer">
              <input
                type="checkbox"
                [checked]="editPrivate()"
                (change)="editPrivate.set($any($event.target).checked)" />
              <span class="col">
                <span class="small strong">Private account</span>
                <span class="tiny muted">New followers have to be approved first.</span>
              </span>
            </label>

            <button class="btn btn-block" type="button" [disabled]="saving()" (click)="saveProfile()">
              {{ saving() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (storyViewerOpen() && stories()) {
      <app-story-viewer
        [trays]="[stories()!]"
        (seen)="onStorySeen()"
        (close)="storyViewerOpen.set(false)" />
    }

    @if (cardOpen() && profile(); as user) {
      <app-profile-card [user]="user" (close)="cardOpen.set(false)" />
    }
  `,
  styles: [
    `
      .story-ring {
        position: relative;
        width: 158px;
        height: 158px;
        border-radius: 50%;
        border: 0;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s var(--spring);
      }

      /* Same trick as the story tray: the gradient turns on its own layer, so hovering can scale the
         button without the two transforms fighting. */
      .story-ring::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: var(--ring);
        animation: turn 9s linear infinite;
      }

      @keyframes turn {
        to {
          transform: rotate(360deg);
        }
      }

      .story-ring:hover {
        transform: scale(1.03);
      }

      /* Everything already watched: the ring stays, the colour and the movement go. */
      .story-ring.seen::before {
        background: var(--border);
        animation: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .story-ring::before {
          animation: none;
        }
      }

      .ring-inner {
        position: relative;
        width: 150px;
        height: 150px;
        border-radius: 50%;
        background: var(--surface);
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .page {
        max-width: 935px;
        margin: 0 auto;
        padding: 0 4px;
      }

      /* Instagram's proportions: a fixed avatar column with the photo centred in it, then the details.
         Without the fixed column the gap changes with the length of the name. */
      .head {
        display: flex;
        align-items: flex-start;
        padding: 16px 0 28px;
      }

      .avatar-wrap {
        position: relative;
        flex: none;
        width: 290px;
        display: flex;
        justify-content: center;
      }

      .avatar-edit {
        position: absolute;
        right: 62px;
        bottom: 4px;
        width: 34px;
        height: 34px;
        border-radius: 50%;
        background: var(--accent);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        border: 2px solid var(--surface);
      }

      .details {
        flex: 1;
        min-width: 0;
      }

      .handle {
        font-family: var(--display);
        font-size: 26px;
        font-weight: 800;
        margin: 0;
        letter-spacing: -0.03em;
      }

      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .tile {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0;
        min-width: 92px;
        padding: 10px 14px;
        border: 1px solid var(--border-soft);
        border-radius: var(--radius);
        background: color-mix(in srgb, var(--surface) 65%, transparent);
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        color: var(--ink);
        text-align: left;
        transition: transform 0.18s var(--spring), border-color 0.14s var(--ease),
          box-shadow 0.18s var(--ease);
      }

      button.tile:hover {
        transform: translateY(-3px);
        border-color: color-mix(in srgb, var(--accent) 45%, transparent);
        box-shadow: 0 10px 24px -14px var(--glow);
      }

      button.tile:active {
        transform: scale(0.97);
      }

      .tile b {
        font-size: 19px;
        line-height: 1.2;
      }

      .tile em {
        font-style: normal;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-3);
      }

      .about {
        max-width: 460px;
      }

      .bio {
        display: block;
        line-height: 1.5;
      }

      .add-bio {
        align-self: flex-start;
        border: 0;
        background: transparent;
        color: var(--accent);
        padding: 2px 0;
        font-weight: 600;
      }

      /* Small factual labels: follows you, private, muted. */
      .pill {
        background: var(--border-soft);
        color: var(--ink-3);
        border-radius: 5px;
        padding: 3px 7px;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-weight: 500;
      }

      .stack {
        display: flex;
      }

      .stack app-avatar:not(:first-child) {
        margin-left: -8px;
      }

      .mutuals {
        align-items: center;
      }

      .connection {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin-top: 10px;
      }

      /* The route gets its own line on a phone, where three handles and two arrows will not fit beside
         the pills. */
      .route {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border: 1px dashed var(--border);
        border-radius: 999px;
      }

      .route a {
        color: var(--ink-2);
        font-weight: 600;
      }

      .rings {
        display: flex;
        gap: 20px;
        overflow-x: auto;
        padding: 4px 0 20px;
        scrollbar-width: none;
      }

      .rings::-webkit-scrollbar {
        display: none;
      }

      .ring,
      .folder {
        border: 0;
        background: transparent;
        color: var(--ink);
        padding: 0;
        flex: none;
        width: 76px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
      }

      .ring-art,
      .folder-art {
        width: 66px;
        height: 66px;
        border-radius: 50%;
        overflow: hidden;
        display: grid;
        place-items: center;
        background: var(--border-soft);
        border: 1px solid var(--border);
        color: var(--ink-3);
        font-size: 20px;
      }

      .ring-art img,
      .folder-art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .ring-art.new,
      .folder-art.new {
        border-style: dashed;
      }

      .folders {
        display: flex;
        gap: 16px;
        overflow-x: auto;
        padding: 4px 0 16px;
        scrollbar-width: none;
      }

      .folders::-webkit-scrollbar {
        display: none;
      }

      .folder-art {
        border-radius: 8px;
      }

      .folder.on .folder-art {
        border-color: var(--ink);
        border-width: 2px;
      }

      .ellipsis {
        max-width: 100%;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* Both edges run: the only pill that reports a closed cycle rather than a setting. */
      .pill.friend {
        border-color: transparent;
        background: var(--brand);
        color: #fff;
      }

      .tabs {
        display: flex;
        justify-content: center;
        gap: 60px;
        border-top: 1px solid var(--border);
        margin-top: 8px;
      }

      .tab {
        border: 0;
        background: transparent;
        color: var(--ink-3);
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 1px;
        padding: 16px 4px;
        border-top: 1px solid transparent;
        margin-top: -1px;
        display: flex;
        align-items: center;
        gap: 6px;
        transition: color 0.14s var(--ease);
      }

      .tab.on {
        color: var(--ink);
        border-top-color: var(--ink);
      }

      @media (max-width: 735px) {
        .tabs {
          gap: 40px;
        }
      }

      /* The menu shares the post card's sheet styling. */
      .menu {
        padding: 0;
        overflow: hidden;
      }

      .menu-item {
        display: block;
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--ink);
        padding: 14px;
        font-size: 14px;
        text-align: center;
        border-bottom: 1px solid var(--border);
      }

      .menu-item:last-child {
        border-bottom: 0;
      }

      .menu-item:hover {
        background: var(--border-soft);
      }

      .menu-item.danger {
        color: var(--danger);
        font-weight: 600;
      }

      @media (max-width: 735px) {
        .head {
          gap: 20px;
          padding: 8px 12px 20px;
        }

        .avatar-wrap {
          width: auto;
        }

        .avatar-wrap app-avatar {
          display: block;
        }

        /* The big photo is the wrong scale on a phone. */
        .avatar-wrap ::ng-deep .av {
          width: 84px !important;
          height: 84px !important;
          font-size: 34px !important;
        }

        .avatar-edit {
          right: -4px;
          bottom: -4px;
          width: 28px;
          height: 28px;
        }

        .about {
          padding: 0 12px;
        }

        .counts {
          gap: 20px;
          font-size: 14px;
        }
      }
    `,
  ],
})
export class ProfileComponent {
  protected readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly toasts = inject(Toasts);
  protected readonly theme = inject(ThemeService);

  private readonly router = inject(Router);

  protected signOut() {
    this.menuOpen.set(false);
    this.auth.signOut();
  }

  /** Opens the thread with them, creating it if this is the first message either way. */
  /**
   * Loads their stories alongside the header. A refusal is the ordinary answer for somebody who does
   * not follow them, so it clears the ring rather than surfacing an error.
   */
  private loadStories(username: string) {
    this.stories.set(null);

    this.api.storiesOf(username).subscribe({
      next: (tray) => this.stories.set(tray.stories.length > 0 ? tray : null),
      error: () => this.stories.set(null),
    });
  }

  protected openStories() {
    this.storyViewerOpen.set(true);
  }

  /** Once watched, the ring goes grey without waiting for a refetch. */
  protected onStorySeen() {
    this.stories.update((tray) => (tray ? { ...tray, hasUnseen: false } : tray));
  }

  protected message(username: string) {
    this.api.startChat([username]).subscribe({
      next: (chat) => this.router.navigate(['/messages', chat.id]),
      error: (error) => this.toasts.error(error.error?.message ?? 'Could not open that chat.'),
    });
  }

  readonly username = input.required<string>();

  /** Bound from ?tab= on the URL, which is how the sidebar's "Saved" gets here. */
  readonly wantedTab = input<string | undefined>(undefined, { alias: 'tab' });

  protected readonly profile = signal<Profile | null>(null);

  /** Non-empty when the header could not be fetched. Drives the error state instead of the spinner. */
  protected readonly loadError = signal('');

  /** Their live stories, or null when there are none — or when you are not allowed to see them. */
  protected readonly stories = signal<StoryTray | null>(null);
  protected readonly storyViewerOpen = signal(false);

  /** The shortest route from you to them, fetched alongside the header. */
  protected readonly connection = signal<ConnectionPath | null>(null);

  protected readonly posts = signal<Post[]>([]);
  protected readonly loadingPosts = signal(true);
  protected readonly hasMore = signal(false);

  protected readonly tab = signal<'posts' | 'tagged' | 'saved'>('posts');

  protected readonly saved = signal<Post[]>([]);
  protected readonly loadingSaved = signal(false);
  private savedLoaded = false;

  protected readonly tagged = signal<Post[]>([]);
  protected readonly loadingTagged = signal(false);
  private taggedLoaded = false;

  /** The circles under the bio. Covers only — a highlight's photos come when it is opened. */
  protected readonly highlights = signal<StoryHighlight[]>([]);

  protected readonly collections = signal<Collection[]>([]);

  /** Which folder the saved grid is filtered to, or null for everything saved. */
  protected readonly openFolder = signal<number | null>(null);

  protected readonly listKind = signal<ListKind>(null);
  protected readonly listPeople = signal<UserRelation[] | null>(null);

  protected readonly menuOpen = signal(false);

  /** The shareable card. Opened from the QR button next to the handle. */
  protected readonly cardOpen = signal(false);

  protected readonly blockedOpen = signal(false);
  protected readonly blockedList = signal<UserSummary[] | null>(null);

  protected readonly editing = signal(false);
  protected readonly editName = signal('');
  protected readonly editBio = signal('');
  protected readonly editPrivate = signal(false);
  protected readonly saving = signal(false);

  private page = 1;

  constructor() {
    // The route param changes when you click through from one profile to another, and Angular reuses the
    // component rather than rebuilding it — so the reload hangs off the input, not off ngOnInit.
    effect(() => this.reload(this.username()));

    // "Saved" in the sidebar menu is a link to your own profile with ?tab=saved on it, so the tab is
    // openable and shareable rather than a state only a click can reach. It waits for the header,
    // because reload() puts the tab back to photos when the profile lands.
    effect(() => {
      const wanted = this.wantedTab();
      const profile = this.profile();

      if (wanted === 'saved' && profile?.isMe && this.tab() !== 'saved') {
        this.showTab('saved');
      }
    });
  }

  /** Fetches the header, then the grid. Also used after a block, which changes both. */
  private reload(username: string) {
    this.profile.set(null);
    this.loadError.set('');
    this.connection.set(null);
    this.posts.set([]);
    this.page = 1;
    this.loadingPosts.set(true);

    // Moving to a different profile drops back to their photos, and forgets whatever was in the saved
    // tab — those bookmarks belong to the viewer, not to the profile being looked at.
    this.tab.set('posts');
    this.saved.set([]);
    this.savedLoaded = false;
    this.tagged.set([]);
    this.taggedLoaded = false;
    this.openFolder.set(null);
    this.highlights.set([]);

    this.loadStories(username);
    this.loadHighlights(username);

    this.api.profile(username).subscribe({
      next: (profile) => {
        this.profile.set(profile);

        // The route is a graph question, not a content one, so it is asked even for a locked account —
        // how you two are connected is exactly what a private profile should still be able to tell you.
        if (!profile.isMe) {
          this.api.connectionPath(username).subscribe({
            next: (link) => this.connection.set(link),
            error: () => this.connection.set(null),
          });
        }

        if (profile.isLocked) {
          this.loadingPosts.set(false);
          return;
        }

        this.loadPosts(username);
      },
      error: (err) => {
        this.loadingPosts.set(false);

        // A 404 and a dead API are different problems with different fixes, so they get different
        // sentences. Status 0 is the browser's way of saying the request never arrived anywhere.
        this.loadError.set(
          err.status === 0
            ? 'The API is not responding. Check that it is running on port 5120.'
            : (err.error?.message ?? `No account called "${username}".`),
        );
      },
    });
  }

  protected retry() {
    this.reload(this.username());
  }

  protected mutualText(user: Profile): string {
    const names = user.mutualFollowers.map((m) => m.username);
    const rest = user.mutualFollowerCount - names.length;

    if (names.length === 0) return '';
    if (rest > 0) return `Followed by ${names.join(', ')} + ${rest} more`;

    return `Followed by ${names.join(', ')}`;
  }

  protected showTab(tab: 'posts' | 'tagged' | 'saved') {
    this.tab.set(tab);

    // Each one is fetched the first time it is opened, then kept. A profile nobody opens the tagged tab
    // on should not pay for the query.
    if (tab === 'saved' && !this.savedLoaded) {
      this.savedLoaded = true;
      this.loadSaved();
      this.loadCollections();
    }

    if (tab === 'tagged' && !this.taggedLoaded) {
      this.taggedLoaded = true;
      this.loadingTagged.set(true);

      this.api.taggedPosts(this.username(), 1, 24).subscribe({
        next: (result) => {
          this.tagged.set(result.items);
          this.loadingTagged.set(false);
        },
        error: () => this.loadingTagged.set(false),
      });
    }
  }

  private loadSaved() {
    this.loadingSaved.set(true);

    this.api.saved(1, 24, this.openFolder()).subscribe({
      next: (result) => {
        this.saved.set(result.items);
        this.loadingSaved.set(false);
      },
      error: () => this.loadingSaved.set(false),
    });
  }

  private loadCollections() {
    this.api.collections().subscribe({
      next: (list) => this.collections.set(list),
      error: () => this.collections.set([]),
    });
  }

  /** Opening a folder filters the same grid rather than navigating: a collection is a view, not a place. */
  protected openCollection(id: number | null) {
    this.openFolder.set(id);
    this.loadSaved();
  }

  protected newCollection() {
    const name = prompt('Name this collection')?.trim();
    if (!name) return;

    this.api.createCollection(name).subscribe({
      next: (created) => {
        this.collections.update((list) => [created, ...list]);
        this.toasts.show(`Created "${created.name}".`);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not create that collection.'),
    });
  }

  // -------------------------------------------------------------- highlights

  private loadHighlights(username: string) {
    this.api.storyHighlights(username).subscribe({
      next: (list) => this.highlights.set(list),
      // A private account, a block, or simply none. Either way the row is empty rather than broken.
      error: () => this.highlights.set([]),
    });
  }

  /**
   * Opens a highlight in the story viewer.
   *
   * The photos are fetched here rather than with the row, because a profile with twelve highlights on it
   * would otherwise carry every photo in all twelve before anybody tapped one.
   */
  protected openHighlight(highlight: StoryHighlight) {
    this.api.storyHighlight(highlight.id).subscribe({
      next: (full) => {
        if (full.stories.length === 0) {
          this.toasts.show('There is nothing left in that highlight.');
          return;
        }

        this.stories.set({
          user: this.profile()!,
          storyCount: full.stories.length,
          hasUnseen: false,
          isMine: full.isMine,
          previewUrl: full.stories[0].imageUrl,
          latestAt: full.stories[full.stories.length - 1].createdAt,
          stories: full.stories,
        });

        this.storyViewerOpen.set(true);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not open that highlight.'),
    });
  }

  protected loadMorePosts() {
    if (this.loadingPosts() || !this.hasMore()) return;

    this.page++;
    this.loadPosts(this.username());
  }

  private loadPosts(username: string) {
    this.loadingPosts.set(true);

    this.api.userPosts(username, this.page).subscribe({
      next: (result) => {
        this.posts.update((existing) => [...existing, ...result.items]);
        this.hasMore.set(result.hasMore);
        this.loadingPosts.set(false);
      },
      error: () => this.loadingPosts.set(false),
    });
  }

  // ------------------------------------------------------------------ follow

  /**
   * The shared button owns the request; the profile only reconciles what changing that edge means for
   * the rest of the page — the counts, whether a private account is now open, and whether the two of you
   * have become friends.
   */
  protected onRelationChanged(relation: UserRelation) {
    const user = this.profile();
    if (!user) return;

    this.profile.set({
      ...user,
      ...relation,
      // Their follower count moved by exactly one, in whichever direction the edge went.
      followerCount: Math.max(0, user.followerCount + (relation.isFollowing ? 1 : 0) - (user.isFollowing ? 1 : 0)),
      friendCount: Math.max(0, user.friendCount + (relation.isFriend ? 1 : 0) - (user.isFriend ? 1 : 0)),
      // A private account opens the moment the edge exists, and closes again when it goes.
      isLocked: user.isPrivate && !relation.isFollowing,
    });

    if (relation.isFollowing && this.posts().length === 0) {
      this.page = 1;
      this.loadPosts(user.username);
    }

    if (!relation.isFollowing && user.isPrivate) {
      this.posts.set([]);
    }

    // The route between you two has changed, so the connection line is re-read rather than left stale.
    this.api.connectionPath(user.username).subscribe({
      next: (link) => this.connection.set(link),
      error: () => this.connection.set(null),
    });
  }

  /** Accepts a request waiting on your own private account, from their profile. */
  protected confirmRequest() {
    const user = this.profile();
    if (!user) return;

    this.api.respondToRequest(user.username, true).subscribe({
      next: () => {
        this.reload(user.username);
        this.toasts.show(`${user.username} now follows you.`);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not confirm that request.'),
    });
  }

  /** Re-reads the header after something changed it from inside a list. */
  private refreshHeader() {
    const user = this.profile();
    if (!user) return;

    this.api.profile(user.username).subscribe({
      next: (fresh) => this.profile.set(fresh),
      error: () => {},
    });
  }

  protected toggleFollow() {
    const user = this.profile();
    if (!user) return;

    const request =
      user.isFollowing || user.followRequested
        ? this.api.unfollow(user.username)
        : this.api.follow(user.username);

    request.subscribe({
      next: (result) => {
        this.profile.set({
          ...user,
          isFollowing: result.isFollowing,
          followRequested: result.followRequested,
          followerCount: result.followerCount,
          // A private account opens up the moment the edge exists, and closes again when it goes.
          isLocked: user.isPrivate && !result.isFollowing,
        });

        if (result.isFollowing && this.posts().length === 0) {
          this.page = 1;
          this.loadPosts(user.username);
        }

        if (!result.isFollowing && user.isPrivate) {
          this.posts.set([]);
        }
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not update that follow.'),
    });
  }

  // -------------------------------------------------------- block and mute

  protected block() {
    const user = this.profile();
    if (!user) return;

    this.menuOpen.set(false);

    this.api.block(user.username).subscribe({
      next: () => {
        // Blocking deletes the edges, so the whole header is stale — reload rather than patch.
        this.reload(user.username);
        this.toasts.show(`Blocked ${user.username}.`);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not block that account.'),
    });
  }

  protected unblock() {
    const user = this.profile();
    if (!user) return;

    this.api.unblock(user.username).subscribe({
      next: () => {
        this.reload(user.username);
        this.toasts.show(`Unblocked ${user.username}. You are not following them again.`);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not unblock that account.'),
    });
  }

  protected toggleMute() {
    const user = this.profile();
    if (!user) return;

    this.menuOpen.set(false);
    const request = user.isMuted ? this.api.unmute(user.username) : this.api.mute(user.username);

    request.subscribe({
      next: (result) => {
        this.profile.set({ ...user, isMuted: result.isMuted });
        this.toasts.show(
          result.isMuted
            ? `Muted ${user.username}. You still follow them, and they are not told.`
            : `Unmuted ${user.username}.`,
        );
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not update that.'),
    });
  }

  protected removeFollower() {
    const user = this.profile();
    if (!user) return;

    this.menuOpen.set(false);

    this.api.removeFollower(user.username).subscribe({
      next: () => {
        this.profile.set({ ...user, followsYou: false });
        this.toasts.show(`${user.username} no longer follows you.`);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not remove that follower.'),
    });
  }

  protected openBlocked() {
    this.menuOpen.set(false);
    this.blockedOpen.set(true);
    this.blockedList.set(null);

    this.api.blocked().subscribe({
      next: (people) => this.blockedList.set(people),
      error: () => this.blockedList.set([]),
    });
  }

  protected unblockFrom(username: string) {
    this.api.unblock(username).subscribe({
      next: () => {
        this.blockedList.update((all) => (all ?? []).filter((p) => p.username !== username));
        this.toasts.show(`Unblocked ${username}.`);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not unblock that account.'),
    });
  }

  // ------------------------------------------------------- followers listing

  protected listTitle(): string {
    return { followers: 'Followers', following: 'Following', friends: 'Friends' }[
      this.listKind() ?? 'followers'
    ];
  }

  /** Says what the row is, in the vocabulary of the edge rather than of the list it came from. */
  protected rowSubtitle(person: UserRelation): string {
    if (person.isMe) return 'You';
    if (person.isFriend) return 'You follow each other';
    if (person.followsYou) return 'Follows you';
    if (person.isFollowing) return 'You follow them';

    return person.fullName;
  }

  protected onRowChanged(person: UserRelation, relation: UserRelation) {
    this.listPeople.update((people) =>
      (people ?? []).map((p) => (p.id === person.id ? { ...p, ...relation } : p)),
    );

    // Following somebody from inside a list changes your own counts on the profile behind it.
    this.refreshHeader();
  }

  protected openList(kind: Exclude<ListKind, null>) {
    const user = this.profile();
    if (!user) return;

    this.listKind.set(kind);
    this.listPeople.set(null);

    const request =
      kind === 'followers'
        ? this.api.followers(user.username)
        : kind === 'friends'
          ? this.api.friends(user.username)
          : this.api.following(user.username);

    request.subscribe({
      next: (page) => this.listPeople.set(page.items),
      error: (err) => {
        this.listKind.set(null);
        this.toasts.error(err.error?.message ?? 'That list is not visible.');
      },
    });
  }

  // ------------------------------------------------------------------- edit

  protected openEdit() {
    const user = this.profile();
    if (!user) return;

    this.editName.set(user.fullName);
    this.editBio.set(user.bio);
    this.editPrivate.set(user.isPrivate);
    this.editing.set(true);
  }

  protected saveProfile() {
    this.saving.set(true);

    this.api
      .updateProfile({ fullName: this.editName(), bio: this.editBio(), isPrivate: this.editPrivate() })
      .subscribe({
        next: (updated) => {
          this.profile.set(updated);
          this.auth.patchUser(updated);
          this.saving.set(false);
          this.editing.set(false);
          this.toasts.show('Profile updated.');
        },
        error: (err) => {
          this.saving.set(false);
          this.toasts.error(err.error?.message ?? 'Could not save that.');
        },
      });
  }

  protected changeAvatar(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;

    this.api.updateAvatar(file).subscribe({
      next: (user) => {
        const current = this.profile();
        if (current) {
          this.profile.set({ ...current, avatarUrl: user.avatarUrl });
        }

        this.auth.patchUser(user);
        this.toasts.show('Profile photo updated.');
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not update that photo.'),
    });
  }
}
