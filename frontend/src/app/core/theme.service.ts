import { Injectable, computed, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'instagraph.theme';

/**
 * Light, dark, or whatever the operating system says.
 *
 * "System" writes no attribute at all, which lets the `prefers-color-scheme`
 * block in styles.css decide; the other two stamp `data-theme` on <html> and
 * override it in either direction.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(read());

  /** Whether the page is actually painting dark right now, following the system when asked to. */
  readonly isDark = computed(() => {
    const chosen = this.theme();
    if (chosen !== 'system') return chosen === 'dark';
    return this.systemDark();
  });

  /** Kept in a signal rather than read on demand, so isDark() repaints when the OS flips. */
  private readonly systemDark = signal(
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches,
  );

  constructor() {
    this.apply(this.theme());

    if (typeof matchMedia === 'function') {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) =>
        this.systemDark.set(e.matches),
      );
    }
  }

  /** What the appearance switch does: on means dark, off means light — never back to "system". */
  setDark(dark: boolean) {
    this.set(dark ? 'dark' : 'light');
  }

  set(theme: Theme) {
    this.theme.set(theme);
    localStorage.setItem(STORAGE_KEY, theme);
    this.apply(theme);
  }

  /** Cycles light → dark → system, which is what a single toolbar button needs. */
  cycle() {
    const order: Theme[] = ['light', 'dark', 'system'];
    const next = order[(order.indexOf(this.theme()) + 1) % order.length];
    this.set(next);
  }

  /** The icon for the current choice. */
  icon(): string {
    switch (this.theme()) {
      case 'light':
        return 'bi-sun';
      case 'dark':
        return 'bi-moon-stars';
      default:
        return 'bi-circle-half';
    }
  }

  label(): string {
    switch (this.theme()) {
      case 'light':
        return 'Light';
      case 'dark':
        return 'Dark';
      default:
        return 'System';
    }
  }

  private apply(theme: Theme) {
    const root = document.documentElement;

    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
  }
}

function read(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
}
