import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostBinding,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, filter, switchMap } from 'rxjs';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Messages } from '../core/messages.service';
import { SearchResults, UserSummary } from '../core/models';
import { Prefs } from '../core/prefs.service';
import { Realtime } from '../core/realtime.service';
import { ComposerComponent } from '../shared/composer.component';
import { ThemeService } from '../core/theme.service';
import { Toasts } from '../core/toast.service';
import { VibeService } from '../core/vibe.service';
import { AvatarComponent } from '../shared/ui';
import { VibeSheetComponent } from '../shared/vibe-sheet.component';
import { NotificationsPanelComponent } from './notifications-panel.component';

/** A search result somebody actually opened, kept so the panel has something to show next time. */
interface Recent {
  kind: 'user' | 'tag';
  label: string;
  sub: string;
  avatarUrl: string | null;
}

const RECENTS_KEY = 'instagraph.recents';

/** Below this the sidebar drops its labels and keeps only icons — the same width the real one uses. */
const NARROW_AT = 1264;

/**
 * The app frame: a fixed sidebar on the desktop, a top bar and a bottom bar on a phone, and the panels
 * — search and notifications — that slide over the top of the page from behind the sidebar.
 *
 * <p>
 * Opening a panel collapses the sidebar to icons, which is the behaviour that makes the panel feel
 * attached to the button that opened it rather than dropped on top of the page.
 * </p>
 */
@Component({
  selector: 'app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    FormsModule,
    AvatarComponent,
    ComposerComponent,
    NotificationsPanelComponent,
    VibeSheetComponent,
  ],
  template: `
    <!-- Only ever visible when the socket is genuinely down. Says what is true rather than "offline":
         everything still works over HTTP, it is just no longer instant. -->
    @if (!realtime.connected()) {
      <div class="reconnecting tiny">
        <span class="pulse"></span> Reconnecting — messages may be a moment behind
      </div>
    }

    <!-- ------------------------------------------------------------ sidebar -->
    <nav class="sidebar">
      <a class="brand" routerLink="/" (click)="closePanels()">
        <span class="wordmark">InstaGraph</span>
        <i class="bi bi-camera glyph"></i>
      </a>

      <a
        class="nav-item"
        routerLink="/"
        routerLinkActive="active"
        [routerLinkActiveOptions]="{ exact: true }"
        (click)="closePanels()"
        #home="routerLinkActive">
        <i class="bi" [class.bi-house-door-fill]="home.isActive" [class.bi-house-door]="!home.isActive"></i>
        <span class="nav-text">Home</span>
      </a>

      <button type="button" class="nav-item" [class.active]="panel() === 'search'" (click)="togglePanel('search')">
        <i class="bi bi-search"></i>
        <span class="nav-text">Search</span>
      </button>

      <a
        class="nav-item"
        routerLink="/explore"
        routerLinkActive="active"
        (click)="closePanels()"
        #explore="routerLinkActive">
        <i class="bi" [class.bi-compass-fill]="explore.isActive" [class.bi-compass]="!explore.isActive"></i>
        <span class="nav-text">Explore</span>
      </a>

      <a
        class="nav-item"
        routerLink="/reels"
        routerLinkActive="active"
        (click)="closePanels()"
        #reels="routerLinkActive">
        <i class="bi" [class.bi-play-btn-fill]="reels.isActive" [class.bi-play-btn]="!reels.isActive"></i>
        <span class="nav-text">Reels</span>
      </a>

      <a
        class="nav-item"
        routerLink="/messages"
        routerLinkActive="active"
        (click)="closePanels()"
        #dms="routerLinkActive">
        <span class="icon-wrap">
          <i class="bi" [class.bi-send-fill]="dms.isActive" [class.bi-send]="!dms.isActive"></i>
          @if (messages.unread() + messages.requests() > 0) {
            <span class="badge">{{ badge() }}</span>
          }
        </span>
        <span class="nav-text">Messages</span>
      </a>

      <button
        type="button"
        class="nav-item"
        [class.active]="panel() === 'notifications'"
        (click)="togglePanel('notifications')">
        <span class="icon-wrap">
          <i
            class="bi"
            [class.bi-heart-fill]="panel() === 'notifications'"
            [class.bi-heart]="panel() !== 'notifications'"></i>
          @if (auth.unread() > 0) {
            <span class="badge">{{ auth.unread() > 9 ? '9+' : auth.unread() }}</span>
          }
        </span>
        <span class="nav-text">Notifications</span>
      </button>

      <button type="button" class="nav-item" (click)="openComposer('post')">
        <i class="bi bi-plus-square"></i><span class="nav-text">Create</span>
      </button>

      @if (auth.user(); as me) {
        <a
          class="nav-item"
          [routerLink]="['/', me.username]"
          routerLinkActive="active"
          (click)="closePanels()"
          #mine="routerLinkActive">
          <span class="me" [class.on]="mine.isActive"><app-avatar [user]="me" [size]="24" /></span>
          <span class="nav-text">Profile</span>
        </a>
      }

      <div class="grow"></div>

      <!-- Everything that does not earn a permanent row lives behind this one, the way it does on the
           real thing: settings, the graph screens, appearance, and the way out. -->
      <div class="more-anchor">
        @if (moreOpen()) {
          <div class="more-menu" (click)="$event.stopPropagation()">
            @if (moreView() === 'root') {
              <a class="menu-item" routerLink="/settings" (click)="closeMore()">
                <i class="bi bi-gear"></i> Settings
              </a>
              <a class="menu-item" routerLink="/activity" (click)="closeMore()">
                <i class="bi bi-clock-history"></i> Your activity
              </a>
              <button type="button" class="menu-item" (click)="goSaved()">
                <i class="bi bi-bookmark"></i> Saved
              </button>
              <a class="menu-item" routerLink="/archive" (click)="closeMore()">
                <i class="bi bi-archive"></i> Archive
              </a>
              <a class="menu-item" routerLink="/discover" (click)="closeMore()">
                <i class="bi bi-person-plus"></i> Discover people
              </a>
              <a class="menu-item" routerLink="/network" (click)="closeMore()">
                <i class="bi bi-diagram-3"></i> Your network
              </a>
              <!-- Colour and light/dark are one decision as far as anybody making it is concerned,
                   so they share a sheet rather than living two taps apart. -->
              <button type="button" class="menu-item vibe-row" (click)="closeMore(); vibeOpen.set(true)">
                <i class="bi bi-palette2"></i> Switch vibe
                <span class="grow"></span>
                <span class="vibe-dot"></span>
                <span class="tiny muted">{{ vibes.current().name }}</span>
              </button>

              <button type="button" class="menu-item" (click)="moreView.set('appearance')">
                <i class="bi bi-moon"></i> Switch appearance
                <span class="grow"></span>
                <i class="bi bi-chevron-right tiny muted"></i>
              </button>
              <button type="button" class="menu-item" (click)="closeMore(); shortcutsOpen.set(true)">
                <i class="bi bi-keyboard"></i> Keyboard shortcuts
              </button>
              <button type="button" class="menu-item" (click)="reportProblem()">
                <i class="bi bi-exclamation-triangle"></i> Report a problem
              </button>

              <div class="menu-gap"></div>

              <button type="button" class="menu-item logout" (click)="closeMore(); auth.signOut()">
                Log out
              </button>
            } @else {
              <button type="button" class="menu-item strong" (click)="moreView.set('root')">
                <i class="bi bi-arrow-left"></i> Switch appearance
                <span class="grow"></span>
                <i class="bi bi-moon"></i>
              </button>

              <button
                type="button"
                class="menu-item"
                role="switch"
                [attr.aria-checked]="theme.isDark()"
                (click)="theme.setDark(!theme.isDark())">
                Dark mode
                <span class="grow"></span>
                <span class="switch" [attr.aria-checked]="theme.isDark()"></span>
              </button>
            }
          </div>
        }

        <button type="button" class="nav-item" [class.active]="moreOpen()" (click)="toggleMore($event)">
          <i class="bi bi-list"></i><span class="nav-text">More</span>
        </button>
      </div>
    </nav>

    <!-- ------------------------------------------------------- mobile top bar -->
    <header class="topbar">
      <a class="brand" routerLink="/"><span class="wordmark">InstaGraph</span></a>

      <span class="row gap-20">
        <a class="plain" routerLink="/activity" aria-label="Notifications">
          <span class="icon-wrap">
            <i class="bi bi-heart"></i>
            @if (auth.unread() > 0) {
              <span class="badge dot"></span>
            }
          </span>
        </a>
        <a class="plain" routerLink="/messages" aria-label="Messages">
          <span class="icon-wrap">
            <i class="bi bi-send"></i>
            @if (messages.unread() + messages.requests() > 0) {
              <span class="badge">{{ badge() }}</span>
            }
          </span>
        </a>
      </span>
    </header>

    <!-- --------------------------------------------------------------- pages -->
    <main class="content">
      <router-outlet />
    </main>

    <!-- ---------------------------------------------------- mobile bottom bar -->
    <nav class="bottombar">
      <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }" #mh="routerLinkActive">
        <i class="bi" [class.bi-house-door-fill]="mh.isActive" [class.bi-house-door]="!mh.isActive"></i>
      </a>
      <button type="button" class="bar-btn" aria-label="Search" (click)="togglePanel('search')"><i class="bi bi-search"></i></button>
      <a routerLink="/explore" routerLinkActive="active" #me2="routerLinkActive">
        <i class="bi" [class.bi-compass-fill]="me2.isActive" [class.bi-compass]="!me2.isActive"></i>
      </a>
      <button type="button" class="bar-btn create" aria-label="New post" (click)="openComposer('post')">
        <i class="bi bi-plus-lg"></i>
      </button>
      <a routerLink="/reels" routerLinkActive="active" #mr="routerLinkActive">
        <i class="bi" [class.bi-play-btn-fill]="mr.isActive" [class.bi-play-btn]="!mr.isActive"></i>
      </a>
      @if (auth.user(); as me) {
        <a [routerLink]="['/', me.username]" routerLinkActive="active" #mp="routerLinkActive">
          <span class="me" [class.on]="mp.isActive"><app-avatar [user]="me" [size]="24" /></span>
        </a>
      }
    </nav>

    <!-- ------------------------------------------------------------ shortcuts -->
    @if (shortcutsOpen()) {
      <div class="modal-backdrop" (click)="shortcutsOpen.set(false)">
        <div class="modal" style="max-width:380px" (click)="$event.stopPropagation()">
          <div class="modal-head">Keyboard shortcuts</div>

          <div class="keys">
            @for (row of shortcuts; track row.keys) {
              <div class="key-row">
                <span class="small">{{ row.label }}</span>
                <span class="row gap-4">
                  @for (k of row.keys.split(' '); track k) {
                    <kbd>{{ k }}</kbd>
                  }
                </span>
              </div>
            }
          </div>
        </div>
      </div>
    }

    <!-- ---------------------------------------------------------- composer -->
    @if (composer(); as mode) {
      <app-composer [initialMode]="mode" (close)="composer.set(null)" (created)="onCreated()" />
    }

    <!-- --------------------------------------------------------------- vibe -->
    @if (vibeOpen()) {
      <app-vibe-sheet (close)="vibeOpen.set(false)" />
    }

    <!-- ------------------------------------------------------------- panels -->
    @if (panel()) {
      <div class="panel-backdrop" (click)="closePanels()"></div>

      <aside class="panel" (click)="$event.stopPropagation()">
        @if (panel() === 'search') {
          <div class="search-head">
            <h2 class="panel-title">Search</h2>

            <div class="search-box">
              <i class="bi bi-search"></i>
              <input
                #searchInput
                placeholder="Search"
                autocomplete="off"
                [ngModel]="term()"
                (ngModelChange)="onSearch($event)" />
              @if (term()) {
                <button type="button" class="clear" (click)="onSearch('')" aria-label="Clear">
                  <i class="bi bi-x-circle-fill"></i>
                </button>
              }
            </div>
          </div>

          <div class="panel-scroll">
            @if (term().length === 0) {
              <div class="row between recents-head">
                <span class="strong">Recent</span>
                @if (recents().length > 0) {
                  <button type="button" class="btn-ghost small" (click)="clearRecents()">Clear all</button>
                }
              </div>

              @if (recents().length === 0) {
                <p class="muted small blank-line">No recent searches.</p>
              } @else {
                @for (item of recents(); track item.kind + item.label) {
                  <a
                    class="result"
                    [routerLink]="item.kind === 'user' ? ['/', item.label] : ['/tags', item.label]"
                    (click)="closePanels()">
                    @if (item.kind === 'user') {
                      <app-avatar [user]="asUser(item)" [size]="44" />
                    } @else {
                      <span class="tag-icon"><i class="bi bi-hash"></i></span>
                    }
                    <span class="col grow" style="min-width:0">
                      <span class="username">{{ item.kind === 'user' ? item.label : '#' + item.label }}</span>
                      <span class="tiny muted ellipsis">{{ item.sub }}</span>
                    </span>
                    <button
                      type="button"
                      class="drop"
                      (click)="$event.preventDefault(); $event.stopPropagation(); forget(item)"
                      aria-label="Remove">
                      <i class="bi bi-x-lg"></i>
                    </button>
                  </a>
                }
              }
            } @else if (!results()) {
              <div class="spinner"></div>
            } @else {
              @for (user of results()!.users; track user.id) {
                <a class="result" [routerLink]="['/', user.username]" (click)="remember(user); closePanels()">
                  <app-avatar [user]="user" [size]="44" />
                  <span class="col grow" style="min-width:0">
                    <span class="username">{{ user.username }}</span>
                    <span class="tiny muted ellipsis">{{ user.fullName }}</span>
                  </span>
                </a>
              }

              @for (tag of results()!.hashtags; track tag.tag) {
                <a
                  class="result"
                  [routerLink]="['/tags', tag.tag]"
                  (click)="rememberTag(tag.tag, tag.postCount); closePanels()">
                  <span class="tag-icon"><i class="bi bi-hash"></i></span>
                  <span class="col grow" style="min-width:0">
                    <span class="username">#{{ tag.tag }}</span>
                    <span class="tiny muted">{{ tag.postCount }} posts</span>
                  </span>
                </a>
              }

              @if (results()!.users.length === 0 && results()!.hashtags.length === 0) {
                <p class="muted small blank-line">No results for “{{ term() }}”.</p>
              }
            }
          </div>
        } @else {
          <app-notifications-panel (close)="closePanels()" />
        }
      </aside>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100vh;
      }

      /* ------------------------------------------------------------ sidebar */

      /* Frosted rather than solid, so the aura behind the page shows through it and the rail reads
         as part of the same surface as the feed rather than a panel bolted to the side. */
      .sidebar {
        position: fixed;
        top: 0;
        left: 0;
        bottom: 0;
        width: var(--sidebar-w);
        border-right: 1px solid var(--border-soft);
        background: color-mix(in srgb, var(--surface) 74%, transparent);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        padding: 8px 12px 20px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        z-index: 90;
        transition: width 0.2s var(--ease);
      }

      @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
        .sidebar {
          background: var(--surface);
        }
      }

      .brand {
        display: flex;
        align-items: center;
        padding: 25px 12px 16px;
        height: 73px;
        font-size: 22px;
      }

      /* The camera glyph stands in for the wordmark once the labels are gone. */
      .brand .glyph {
        display: none;
        font-size: 24px;
      }

      .nav-item {
        position: relative;
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px;
        border-radius: var(--pill);
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 16px;
        line-height: 20px;
        width: 100%;
        text-align: left;
        transition: background 0.14s var(--ease), color 0.14s var(--ease);
      }

      .nav-item i {
        font-size: 24px;
        line-height: 1;
        flex: none;
        transition: transform 0.2s var(--spring);
      }

      .nav-item:hover {
        background: var(--hover);
      }

      .nav-item:hover i {
        transform: scale(1.12) rotate(-4deg);
      }

      .nav-item:active i {
        transform: scale(0.9);
      }

      /*
        The current screen gets a tinted pill and an accent icon, not just a bold label. On a page
        washed in colour a weight change alone stops being legible at a glance — and the pill is what
        the icon-only rail falls back to once the labels are gone.
      */
      .nav-item.active {
        font-weight: 800;
        color: var(--accent);
        background: color-mix(in srgb, var(--accent) 12%, transparent);
      }

      .nav-item.active:hover {
        background: color-mix(in srgb, var(--accent) 18%, transparent);
      }

      /* A short bar off the left edge, so the active row is findable even with colour turned down. */
      .nav-item.active::before {
        content: '';
        position: absolute;
        left: -12px;
        top: 50%;
        width: 4px;
        height: 22px;
        margin-top: -11px;
        border-radius: 0 4px 4px 0;
        background: var(--brand);
      }

      /* --------------------------------------------------------- vibe row */

      .vibe-row .vibe-dot {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        flex: none;
        background: var(--brand);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
      }

      .nav-text {
        overflow: hidden;
        white-space: nowrap;
      }

      /* Your own avatar picks up a ring when you are on your profile — the stand-in for a filled icon. */
      .me {
        display: inline-flex;
        border-radius: 50%;
        padding: 2px;
        margin: -2px;
        border: 2px solid transparent;
      }

      .me.on {
        border-color: var(--accent);
      }

      .icon-wrap {
        position: relative;
        display: inline-flex;
      }

      .badge {
        position: absolute;
        top: -4px;
        right: -8px;
        background: var(--brand);
        color: var(--brand-ink);
        font-size: 10px;
        font-weight: 800;
        min-width: 18px;
        height: 18px;
        border-radius: 9px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 5px;
        box-shadow: 0 0 0 2px var(--surface), 0 3px 10px -3px var(--glow);
      }

      .badge.dot {
        min-width: 9px;
        height: 9px;
        top: -2px;
        right: -3px;
        padding: 0;
      }

      /* ---------------------------------------------------------- more menu */

      .more-anchor {
        position: relative;
      }

      .more-menu {
        position: absolute;
        bottom: calc(100% + 12px);
        left: 0;
        width: 266px;
        background: color-mix(in srgb, var(--surface-2) 88%, transparent);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid var(--border-soft);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        animation: lift 0.22s var(--spring);
        z-index: 5;

        /* This sheet grows upwards out of the More row, so its height is only ever as free as the
           window is tall. Twelve rows on a short laptop screen ran straight off the top and took
           Settings with them, unreachable — nothing here scrolled, because nothing here was allowed
           to. Capped to the room that actually exists above the row, and scrolled inside itself when
           the list wants more than that. The 96px is the row, the sidebar's bottom padding and the
           12px gap, plus a little daylight at the top. */
        max-height: calc(100vh - 96px);
        overflow: hidden auto;
        /* Reaching the end of the list must not start scrolling the page underneath it. */
        overscroll-behavior: contain;
        scrollbar-width: thin;
        scrollbar-color: var(--border) transparent;
      }

      /* Rows tighten before the list resorts to scrolling — on most short windows this is the whole
         difference between a sheet that fits and one that does not. */
      @media (max-height: 820px) {
        .more-menu .menu-item {
          padding: 11px 16px;
        }
      }

      /* The thick divider that separates "log out" from everything above it. */
      .menu-gap {
        height: 6px;
        background: var(--border-soft);
      }

      /* Once the sheet scrolls, the way out is the one row that should never be the reason you have
         to scroll, so it stays parked at the bottom. It needs its own backdrop: the sheet's frost is
         painted behind the whole list, and rows would otherwise slide past underneath it. */
      .more-menu .logout {
        position: sticky;
        bottom: 0;
        border-bottom: 0;
        background: color-mix(in srgb, var(--surface-2) 92%, transparent);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
      }

      @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
        .more-menu .logout {
          background: var(--surface-2);
        }
      }

      .reconnecting {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 300;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 5px 12px;
        background: var(--ink-2);
        color: var(--bg);
        font-weight: 600;
      }

      .pulse {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: currentColor;
        animation: blink 1.2s ease-in-out infinite;
      }

      @keyframes blink {
        50% {
          opacity: 0.25;
        }
      }

      /* ------------------------------------------------------------ content */

      .content {
        margin-left: var(--sidebar-w);
        padding: 28px 20px 60px;
        min-height: 100vh;
        transition: margin-left 0.2s var(--ease);
      }

      .topbar,
      .bottombar {
        display: none;
      }

      /* ------------------------------------------------ collapsed sidebar */

      /* Opening a panel, or a window under 1264px, drops the labels. The icons stay put so nothing
         jumps sideways as it happens. */
      :host(.narrow) .sidebar {
        width: var(--sidebar-narrow);
        padding: 8px 8px 20px;
      }

      :host(.narrow) .nav-text,
      :host(.narrow) .wordmark {
        display: none;
      }

      :host(.narrow) .brand .glyph {
        display: block;
      }

      :host(.narrow) .brand {
        justify-content: center;
        padding: 25px 0 16px;
      }

      :host(.narrow) .nav-item {
        justify-content: center;
      }

      /* The edge bar would sit outside the 8px rail and be clipped; the pill alone carries it. */
      :host(.narrow) .nav-item.active::before {
        display: none;
      }

      :host(.narrow) .more-menu {
        left: 8px;
      }

      :host(.narrow) .content {
        margin-left: var(--sidebar-narrow);
      }

      /* -------------------------------------------------------------- panel */

      .panel-backdrop {
        position: fixed;
        inset: 0;
        z-index: 70;
      }

      /* Slides out from behind the sidebar, and is rounded and lifted on its free edge only. */
      .panel {
        position: fixed;
        top: 0;
        left: var(--sidebar-narrow);
        bottom: 0;
        width: 397px;
        max-width: 88vw;
        background: color-mix(in srgb, var(--surface) 80%, transparent);
        backdrop-filter: blur(26px) saturate(180%);
        -webkit-backdrop-filter: blur(26px) saturate(180%);
        border-right: 1px solid var(--border-soft);
        border-radius: 0 var(--radius-xl) var(--radius-xl) 0;
        box-shadow: var(--shadow-md);
        z-index: 80;
        display: flex;
        flex-direction: column;
        animation: slide 0.2s var(--ease);
      }

      @keyframes slide {
        from {
          transform: translateX(-24px);
          opacity: 0;
        }
      }

      .panel-title {
        font-family: var(--display);
        font-size: 26px;
        font-weight: 800;
        letter-spacing: -0.03em;
        margin: 0;
        padding: 30px 24px 24px;
      }

      .search-head {
        border-bottom: 1px solid var(--border);
        padding-bottom: 16px;
      }

      /* The grey pill, with the magnifier tucked inside it. */
      .search-box {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 16px;
        padding: 0 14px;
        height: 42px;
        border-radius: var(--pill);
        background: var(--secondary);
        color: var(--ink-3);
      }

      .search-box input {
        flex: 1;
        min-width: 0;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--ink);
        font-family: inherit;
        font-size: 16px;
      }

      .search-box .clear {
        border: 0;
        background: transparent;
        color: var(--ink-4);
        padding: 0;
        font-size: 15px;
      }

      .panel-scroll {
        flex: 1;
        overflow-y: auto;
        padding-bottom: 24px;
      }

      .recents-head {
        padding: 18px 24px 8px;
      }

      .blank-line {
        padding: 8px 24px;
      }

      .result {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 24px;
      }

      .result:hover {
        background: var(--hover);
      }

      .result .drop {
        border: 0;
        background: transparent;
        color: var(--ink-3);
        font-size: 14px;
        padding: 4px;
      }

      .tag-icon {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 1px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        flex: none;
      }

      .plain {
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 24px;
        line-height: 1;
      }

      .gap-20 {
        gap: 20px;
      }

      .keys {
        padding: 8px 18px 20px;
        display: grid;
        gap: 2px;
      }

      .key-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 9px 0;
        border-bottom: 1px solid var(--border-soft);
      }

      .key-row:last-child {
        border-bottom: 0;
      }

      kbd {
        font-family: var(--mono, ui-monospace, monospace);
        font-size: 11px;
        min-width: 22px;
        text-align: center;
        padding: 3px 6px;
        border: 1px solid var(--border);
        border-bottom-width: 2px;
        border-radius: 5px;
        background: var(--border-soft);
        color: var(--ink-2);
      }

      /* -------------------------------------------------------------- phone */

      @media (max-width: 767px) {
        .sidebar {
          display: none;
        }

        /* The bars are fixed, so the scrolling column has to reserve their height — and on a notched
           phone the top bar is taller than 60px by however much the notch takes. */
        .content,
        :host(.narrow) .content {
          margin-left: 0;
          padding: calc(60px + env(safe-area-inset-top)) 0 calc(60px + env(safe-area-inset-bottom));
        }

        .topbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: calc(60px + env(safe-area-inset-top));
          padding-top: env(safe-area-inset-top);
          background: color-mix(in srgb, var(--surface) 72%, transparent);
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
          border-bottom: 1px solid var(--border-soft);
          display: flex;
          align-items: center;
          justify-content: space-between;
          /* The inset has to be padding, not just extra height, or the row centres itself inside the
             notch instead of below it. */
          padding: env(safe-area-inset-top) 16px 0;
          z-index: 60;
        }

        .topbar .brand {
          padding: 0;
          height: auto;
        }

        .topbar .wordmark {
          font-size: 26px;
        }

        .bottombar {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 0;
          height: 54px;
          background: color-mix(in srgb, var(--surface) 72%, transparent);
          backdrop-filter: blur(22px) saturate(180%);
          -webkit-backdrop-filter: blur(22px) saturate(180%);
          border-top: 1px solid var(--border-soft);
          display: flex;
          align-items: center;
          justify-content: space-around;
          z-index: 60;
          font-size: 24px;
          padding-bottom: env(safe-area-inset-bottom);
        }

        .bottombar a,
        .bottombar .bar-btn {
          padding: 6px 14px;
          color: var(--ink-3);
          border: 0;
          background: transparent;
          font-size: inherit;
          line-height: 1;
          transition: color 0.14s var(--ease), transform 0.2s var(--spring);
        }

        .bottombar a:active,
        .bottombar .bar-btn:active {
          transform: scale(0.86);
        }

        .bottombar a.active {
          color: var(--accent);
        }

        /* The one thing on the bar that makes something rather than goes somewhere, so it is the one
           thing wearing the gradient. */
        .bottombar .bar-btn.create {
          width: 42px;
          height: 32px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--pill);
          background: var(--brand);
          color: var(--brand-ink);
          font-size: 19px;
          box-shadow: 0 6px 18px -6px var(--glow);
        }

        .panel {
          left: 0;
          top: calc(60px + env(safe-area-inset-top));
          width: 100%;
          max-width: 100%;
          border-radius: 0;
          box-shadow: none;
          animation: none;
        }
      }
    `,
  ],
})
export class ShellComponent implements OnInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly prefs = inject(Prefs);
  private readonly toasts = inject(Toasts);
  protected readonly auth = inject(Auth);
  protected readonly theme = inject(ThemeService);
  protected readonly vibes = inject(VibeService);
  protected readonly realtime = inject(Realtime);
  protected readonly messages = inject(Messages);

  /** Unread threads and waiting requests share one badge, the way the real one does. */
  protected readonly badge = computed(() => {
    const total = this.messages.unread() + this.messages.requests();
    return total > 9 ? '9+' : String(total);
  });

  /** Which slide-out is showing, if any. */
  protected readonly panel = signal<'search' | 'notifications' | null>(null);

  protected readonly term = signal('');
  protected readonly results = signal<SearchResults | null>(null);
  protected readonly shortcutsOpen = signal(false);
  protected readonly recents = signal<Recent[]>(readRecents());

  protected readonly moreOpen = signal(false);
  protected readonly moreView = signal<'root' | 'appearance'>('root');

  /** The colour picker, opened from More and from the "v" shortcut. */
  protected readonly vibeOpen = signal(false);

  /** Which tab the composer sheet opens on, or null when it is closed. */
  protected readonly composer = signal<'post' | 'story' | null>(null);

  /** The field inside the search panel, so opening the panel puts the caret in it. */
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  private readonly width = signal(typeof window === 'undefined' ? 1400 : window.innerWidth);

  /** The inbox wants the whole width, and gets it the same way the real one does. */
  private readonly onMessages = signal(false);

  /**
   * Icons only: a panel has taken the space, the inbox is open, or the window is too narrow for
   * labels at all.
   */
  protected readonly narrow = computed(
    () => this.panel() !== null || this.onMessages() || this.width() <= NARROW_AT,
  );

  @HostBinding('class.narrow')
  protected get isNarrow() {
    return this.narrow();
  }

  protected readonly shortcuts = [
    { keys: 'g h', label: 'Go home' },
    { keys: 'g e', label: 'Go to explore' },
    { keys: 'g d', label: 'Discover people' },
    { keys: 'g n', label: 'Your network' },
    { keys: 'g a', label: 'Go to notifications' },
    { keys: 'g m', label: 'Go to messages' },
    { keys: 'g s', label: 'Go to settings' },
    { keys: 'g p', label: 'Go to your profile' },
    { keys: 'n', label: 'New post' },
    { keys: '/', label: 'Search' },
    { keys: 't', label: 'Switch theme' },
    { keys: 'v', label: 'Switch vibe' },
    { keys: '?', label: 'This list' },
    { keys: 'Esc', label: 'Close anything open' },
  ];

  /** Set by "g", cleared a second later — this is what makes "g h" a chord rather than two keys. */
  private goPending = false;
  private goTimer?: ReturnType<typeof setTimeout>;

  private readonly typed = new Subject<string>();

  @HostListener('window:resize')
  protected onResize() {
    this.width.set(window.innerWidth);
  }

  /** Anywhere outside the More popup closes it — including the rest of the sidebar. */
  @HostListener('document:click')
  protected onDocumentClick() {
    this.closeMore();
  }

  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent) {
    // Never steal a key from someone who is typing.
    const target = event.target as HTMLElement | null;
    const typing =
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable === true;

    if (event.key === 'Escape') {
      this.closePanels();
      this.closeMore();
      this.shortcutsOpen.set(false);
      this.vibeOpen.set(false);
      return;
    }

    if (typing || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    if (this.goPending) {
      this.clearGo();

      const destination = {
        h: '/',
        e: '/explore',
        a: '/activity',
        d: '/discover',
        n: '/network',
        m: '/messages',
        s: '/settings',
        p: `/${this.auth.username()}`,
      }[event.key.toLowerCase()];

      if (destination) {
        event.preventDefault();
        this.router.navigateByUrl(destination);
      }

      return;
    }

    switch (event.key) {
      case 'g':
        this.goPending = true;
        this.goTimer = setTimeout(() => this.clearGo(), 1200);
        break;
      case 'n':
        event.preventDefault();
        this.composer.set('post');
        break;
      case '/':
        event.preventDefault();
        this.panel.set('search');
        break;
      case 't':
        this.theme.cycle();
        break;
      case 'v':
        this.vibeOpen.update((open) => !open);
        break;
      case '?':
        this.shortcutsOpen.update((open) => !open);
        break;
    }
  }

  private clearGo() {
    this.goPending = false;
    clearTimeout(this.goTimer);
  }

  constructor() {
    // The panel is worth nothing if you then have to click the box: opening it types straight into it.
    effect(() => {
      const field = this.searchInput();
      if (field) field.nativeElement.focus();
    });

    // One request per pause in typing rather than one per keystroke, and never the same query twice.
    this.typed
      .pipe(
        debounceTime(280),
        distinctUntilChanged(),
        switchMap((q) => this.api.search(q)),
      )
      .subscribe({
        next: (res) => this.results.set(res),
        error: () => this.results.set({ users: [], hashtags: [] }),
      });

    // The activity badge is pushed rather than polled: the server already knows the number when it
    // writes the notification, so there is nothing to ask it.
    this.realtime.activityCount$.subscribe((count) => this.auth.unread.set(count));

    // A like, comment, follow or mention arriving while you are on another screen says so once, briefly.
    // Deliberately not for direct messages: those have their own badge, and a toast per message would be
    // unbearable in a live conversation.
    this.realtime.notification$.subscribe((notification) => {
      const actor = notification.actor.username;

      const what = {
        Like: 'liked your photo',
        Comment: 'commented on your photo',
        Follow: 'started following you',
        FollowRequest: 'requested to follow you',
        Mention: 'mentioned you',
        Reply: 'replied to your comment',
        CommentLike: 'liked your comment',
        Tag: 'tagged you in a photo',
      }[notification.kind];

      if (what) {
        this.toasts.show(`${actor} ${what}`);
      }
    });

    // Navigating anywhere closes the panels and re-checks the badge.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.onMessages.set(this.router.url.startsWith('/messages'));
      this.closePanels();
      this.closeMore();
      this.auth.refreshUnread();
      this.messages.refresh();
    });
  }

  ngOnInit() {
    this.auth.refreshUnread();

    // The badge and the like-count preference are the two things every screen depends on, so the shell
    // is the one place that asks for them.
    this.messages.start();
    this.prefs.load();

    // One socket for the whole application, opened here because the shell is the first thing that exists
    // once somebody is signed in and the last thing to go when they are not.
    void this.realtime.start();
  }

  ngOnDestroy() {
    this.messages.stop();
    void this.realtime.stop();
  }

  /** Something was just posted; the feed and the ring row behind the sheet should catch up. */
  protected onCreated() {
    this.composer.set(null);
  }

  protected openComposer(mode: 'post' | 'story') {
    this.closePanels();
    this.composer.set(mode);
  }

  protected togglePanel(which: 'search' | 'notifications') {
    const next = this.panel() === which ? null : which;

    this.panel.set(next);
    this.closeMore();

    if (next !== 'search') {
      this.term.set('');
      this.results.set(null);
    }
  }

  protected closePanels() {
    this.panel.set(null);
    this.term.set('');
    this.results.set(null);
  }

  protected toggleMore(event: MouseEvent) {
    // Without this the document listener that closes the menu would fire on the very click opening it.
    event.stopPropagation();

    this.moreOpen.update((open) => !open);
    this.moreView.set('root');
  }

  protected closeMore() {
    this.moreOpen.set(false);
  }

  protected goSaved() {
    this.closeMore();
    void this.router.navigate(['/', this.auth.username()], { queryParams: { tab: 'saved' } });
  }

  protected reportProblem() {
    this.closeMore();
    this.toasts.show('Thanks — that has been noted.');
  }

  protected onSearch(value: string) {
    this.term.set(value);

    if (value.trim().length === 0) {
      this.results.set(null);
      return;
    }

    this.results.set(null);
    this.typed.next(value.trim());
  }

  /** The avatar component wants a user; a remembered search only kept the parts it needs. */
  protected asUser(item: Recent): UserSummary {
    return {
      id: 0,
      username: item.label,
      fullName: item.sub,
      avatarUrl: item.avatarUrl,
      isPrivate: false,
      // A remembered search never kept this, and a tick drawn from a guess would be worse than none.
      isVerified: false,
    };
  }

  protected remember(user: UserSummary) {
    this.push({
      kind: 'user',
      label: user.username,
      sub: user.fullName,
      avatarUrl: user.avatarUrl ?? null,
    });
  }

  protected rememberTag(tag: string, postCount: number) {
    this.push({ kind: 'tag', label: tag, sub: `${postCount} posts`, avatarUrl: null });
  }

  protected forget(item: Recent) {
    this.recents.update((all) => all.filter((r) => !(r.kind === item.kind && r.label === item.label)));
    this.saveRecents();
  }

  protected clearRecents() {
    this.recents.set([]);
    this.saveRecents();
  }

  /** Most recent first, no duplicates, and never more than eight. */
  private push(item: Recent) {
    this.recents.update((all) => [
      item,
      ...all.filter((r) => !(r.kind === item.kind && r.label === item.label)),
    ].slice(0, 8));

    this.saveRecents();
  }

  private saveRecents() {
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(this.recents()));
    } catch {
      /* private mode: recents are a convenience, not worth an error */
    }
  }
}

function readRecents(): Recent[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as Recent[]) : [];
  } catch {
    return [];
  }
}
