import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards';

/**
 * Two shells: bare screens for signing in, and the app shell — sidebar and all — for everything else.
 * Every feature is lazily loaded, so the first paint only carries the screen you asked for.
 */
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Log in • InstaGraph',
    loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    title: 'Sign up • InstaGraph',
    loadComponent: () => import('./features/auth/register.component').then((m) => m.RegisterComponent),
  },
  {
    // Signed-out like the two above it: somebody who has forgotten their password is, by definition,
    // not carrying a session — and somebody who is would use Settings instead.
    path: 'reset-password',
    canActivate: [guestGuard],
    title: 'Reset your password • InstaGraph',
    loadComponent: () =>
      import('./features/auth/reset-password.component').then((m) => m.ResetPasswordComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'InstaGraph',
        loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'explore',
        title: 'Explore • InstaGraph',
        loadComponent: () => import('./features/explore/explore.component').then((m) => m.ExploreComponent),
      },
      {
        path: 'reels',
        title: 'Reels • InstaGraph',
        loadComponent: () => import('./features/reels/reels.component').then((m) => m.ReelsComponent),
      },
      {
        path: 'archive',
        title: 'Archive • InstaGraph',
        loadComponent: () => import('./features/archive/archive.component').then((m) => m.ArchiveComponent),
      },
      {
        path: 'discover',
        title: 'Discover people • InstaGraph',
        loadComponent: () =>
          import('./features/discover/discover.component').then((m) => m.DiscoverComponent),
      },
      {
        path: 'network',
        title: 'Your network • InstaGraph',
        loadComponent: () =>
          import('./features/network/network.component').then((m) => m.NetworkComponent),
      },
      {
        path: 'create',
        title: 'New post • InstaGraph',
        loadComponent: () => import('./features/create/create.component').then((m) => m.CreateComponent),
      },
      {
        // The inbox is the frame; the open thread is a child of it, so the desktop keeps both on
        // screen and the phone swaps one for the other with plain CSS.
        path: 'messages',
        title: 'Messages • InstaGraph',
        loadComponent: () =>
          import('./features/messages/messages.component').then((m) => m.MessagesComponent),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('./features/messages/messages.component').then((m) => m.ChatPlaceholderComponent),
          },
          {
            path: ':id',
            loadComponent: () =>
              import('./features/messages/thread.component').then((m) => m.ThreadComponent),
          },
        ],
      },
      {
        path: 'settings',
        title: 'Settings • InstaGraph',
        loadComponent: () =>
          import('./features/settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'activity',
        title: 'Notifications • InstaGraph',
        loadComponent: () => import('./features/activity/activity.component').then((m) => m.ActivityComponent),
      },
      {
        path: 'p/:id',
        title: 'Photo • InstaGraph',
        loadComponent: () => import('./features/post/post.component').then((m) => m.PostComponent),
      },
      {
        path: 'tags/:tag',
        title: 'Tag • InstaGraph',
        loadComponent: () => import('./features/tag/tag.component').then((m) => m.TagComponent),
      },
      {
        // Last, so it cannot swallow /explore and friends.
        path: ':username',
        title: 'Profile • InstaGraph',
        loadComponent: () => import('./features/profile/profile.component').then((m) => m.ProfileComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
