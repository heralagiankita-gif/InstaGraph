import { Injectable, isDevMode } from '@angular/core';

/**
 * Installs the service worker in a real build, and makes sure there is never one during development.
 *
 * The second half is the important one. A service worker in front of a dev server is a trap: the dev
 * server hands out freshly hashed chunks on every rebuild, the worker answers from a cache that still
 * remembers the previous set, and the lazily loaded screens — which is most of them — start failing to
 * resolve. The app shell keeps rendering, so it looks like "some pages stopped working" rather than like
 * a caching problem, which is what makes it worth this much comment.
 *
 * Unregistering is not enough on its own either. A worker that has already been installed stays
 * installed, in that browser, until something removes it — so development actively tears down anything
 * it finds and empties the caches behind it, rather than merely declining to add one.
 */
@Injectable({ providedIn: 'root' })
export class Pwa {
  install(): void {
    if (!('serviceWorker' in navigator)) {
      return;
    }

    if (isDevMode()) {
      void this.tearDown();
      return;
    }

    // After load, so it never competes with the first paint for bandwidth.
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        // No offline support. Everything else still works, so there is nothing to tell anybody.
      });
    });
  }

  /** Removes any worker and cache left behind by a previous production build or an earlier mistake. */
  private async tearDown(): Promise<void> {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();

      if (registrations.length === 0) {
        return;
      }

      await Promise.all(registrations.map((registration) => registration.unregister()));

      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith('instagraph')).map((key) => caches.delete(key)));
      }

      // The page in front of you was very likely served by the worker that has just been removed, so it
      // is still the stale copy. One reload, once, puts that right.
      location.reload();
    } catch {
      // Private mode, or a browser that refuses to enumerate. Nothing further to try.
    }
  }
}
