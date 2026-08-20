import { Injectable, OnDestroy, signal } from '@angular/core';

/**
 * One ticking clock for the whole app.
 *
 * Relative timestamps ("3 m", "2 h") are stale the moment they render. A pure pipe will not re-run on
 * its own, so a post that said "just now" would still say it half an hour later. Components read
 * <code>clock.now()</code> and pass it into the pipe, which both re-evaluates the pipe and marks the
 * OnPush component dirty — one interval for the entire application rather than a timer per card.
 *
 * Thirty seconds is chosen to match the smallest unit displayed: nothing shown is finer than a minute,
 * so ticking faster would repaint without changing a single character.
 */
@Injectable({ providedIn: 'root' })
export class Clock implements OnDestroy {
  readonly now = signal(Date.now());

  private readonly handle = setInterval(() => this.now.set(Date.now()), 30_000);

  ngOnDestroy() {
    clearInterval(this.handle);
  }
}

/**
 * Parses a timestamp the API sent us, defensively.
 *
 * The API now stamps every date with a Z, but a bare `2026-08-14T07:56:24` would be read by the browser
 * as *local* time — silently shifting every timestamp by the viewer's UTC offset. If no timezone marker
 * is present, one is added, so the client cannot be wrong even if a future endpoint forgets.
 */
export function parseApiDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;

  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  const parsed = new Date(hasZone ? value : value + 'Z');

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
