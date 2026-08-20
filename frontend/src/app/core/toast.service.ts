import { Injectable, signal } from '@angular/core';

/** An optional button on the pill — "Undo" on something destructive, "Retry" on something that failed. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  text: string;
  error: boolean;
  action?: ToastAction;
  /** How many times this same message has arrived while it was on screen. */
  count: number;
}

/** Confirmations are read in passing. Errors have to be read, and sometimes read twice. */
const LIFE_OK = 3400;
const LIFE_ERROR = 6500;

/**
 * The little black pill at the bottom of the screen, and the app's only channel for telling anybody
 * that something worked or did not — a hundred-odd call sites report through here.
 *
 * <para>
 * The rules it follows, all of which exist because the naive version gets them wrong:
 * an error stays up roughly twice as long as a confirmation, because the two are not read the same
 * way; hovering freezes the countdown, so a pill cannot expire while it is being read; the same
 * message arriving twice bumps a counter rather than stacking a second identical pill, which matters
 * because the HTTP interceptor toasts every failed request and a flaky connection would otherwise
 * bury the screen; and no more than three are ever on screen at once.
 * </para>
 */
@Injectable({ providedIn: 'root' })
export class Toasts {
  private nextId = 1;

  /** Live countdowns, keyed by toast id. `left` is only meaningful while paused. */
  private readonly timers = new Map<number, { handle: ReturnType<typeof setTimeout>; due: number; left: number }>();

  readonly items = signal<Toast[]>([]);

  /**
   * @param action Optional button on the pill. Running it dismisses the toast.
   * @returns The toast's id, so a caller that knows the thing it announced is finished with can take
   *   it down early rather than leaving a stale message up.
   */
  show(text: string, error = false, action?: ToastAction): number {
    // The same message arriving again is nearly always the same cause firing repeatedly — a retry
    // loop, a click that is not landing. One pill with a count says that; five identical pills just
    // cover the screen with it.
    const existing = this.items().find((t) => t.text === text && t.error === error);

    if (existing) {
      this.items.update((all) =>
        all.map((t) => (t.id === existing.id ? { ...t, count: t.count + 1, action: action ?? t.action } : t)),
      );

      this.arm(existing.id, error ? LIFE_ERROR : LIFE_OK);
      return existing.id;
    }

    const toast: Toast = { id: this.nextId++, text, error, action, count: 1 };

    this.items.update((all) => {
      const next = [...all, toast];
      // Oldest first out. Anything past the third is not being read anyway.
      const dropped = next.slice(0, Math.max(0, next.length - 3));
      dropped.forEach((t) => this.clear(t.id));
      return next.slice(-3);
    });

    this.arm(toast.id, error ? LIFE_ERROR : LIFE_OK);
    return toast.id;
  }

  error(text: string, action?: ToastAction): number {
    return this.show(text, true, action);
  }

  dismiss(id: number) {
    this.clear(id);
    this.items.update((all) => all.filter((t) => t.id !== id));
  }

  /** Runs the pill's button and takes the pill down — the action is the answer, so the ask can go. */
  run(toast: Toast) {
    toast.action?.run();
    this.dismiss(toast.id);
  }

  /** Freezes the countdown while the pointer is on the pill, or focus is inside it. */
  pause(id: number) {
    const timer = this.timers.get(id);
    if (!timer) return;

    clearTimeout(timer.handle);
    timer.left = Math.max(0, timer.due - Date.now());
  }

  resume(id: number) {
    const timer = this.timers.get(id);
    if (!timer) return;

    this.arm(id, timer.left || LIFE_OK);
  }

  /** (Re)starts a toast's countdown. Arming an already-armed toast replaces the old one. */
  private arm(id: number, ms: number) {
    this.clear(id);

    this.timers.set(id, {
      handle: setTimeout(() => this.dismiss(id), ms),
      due: Date.now() + ms,
      left: ms,
    });
  }

  private clear(id: number) {
    const timer = this.timers.get(id);
    if (!timer) return;

    clearTimeout(timer.handle);
    this.timers.delete(id);
  }
}
