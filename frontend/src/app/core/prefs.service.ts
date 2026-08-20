import { Injectable, computed, inject, signal } from '@angular/core';
import { Api } from './api.service';
import { Settings } from './models';

/**
 * The signed-in account's own settings, loaded once and shared.
 *
 * <p>
 * Only one of them changes what other screens draw — "hide like and share counts" is a preference about
 * every post card in the app, not about the post — so it is held here rather than fetched per card. The
 * rest are read by the settings screen itself and kept in the same place so that saving there updates
 * the feed without a reload.
 * </p>
 */
@Injectable({ providedIn: 'root' })
export class Prefs {
  private readonly api = inject(Api);

  readonly settings = signal<Settings | null>(null);

  /** Defaults to showing counts: a preference nobody has loaded yet must not blank the interface. */
  readonly hideLikeCounts = computed(() => this.settings()?.hideLikeCounts ?? false);

  private loading = false;

  /** Called by the shell once per session. Safe to call again; it will not re-request. */
  load(force = false) {
    if (this.loading || (this.settings() && !force)) return;

    this.loading = true;

    this.api.settings().subscribe({
      next: (settings) => {
        this.loading = false;
        this.settings.set(settings);
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  set(settings: Settings) {
    this.settings.set(settings);
  }

  clear() {
    this.settings.set(null);
  }
}
