import { Injectable, inject, signal } from '@angular/core';
import { merge } from 'rxjs';
import { auditTime } from 'rxjs/operators';
import { Api } from './api.service';
import { Auth } from './auth.service';
import { Realtime } from './realtime.service';

/**
 * The two numbers on the messages icon, and the timer that keeps them current.
 *
 * <p>
 * There is no socket here on purpose. Every screen in this app polls something it can ask for cheaply —
 * the graph watcher asks for a hash, this asks for two integers — and a poll that returns two integers
 * is both simpler to reason about and honest about its cost. What it buys you is that the badge, the
 * inbox and an open thread each choose their own rate: twenty seconds for a badge nobody is watching,
 * three for a conversation somebody is in the middle of.
 * </p>
 *
 * <p>
 * Polling is ref-counted and hidden-tab aware, so a background tab spends nothing.
 * </p>
 */
@Injectable({ providedIn: 'root' })
export class Messages {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly realtime = inject(Realtime);

  /** Threads with something unread in them — conversations, not messages. */
  readonly unread = signal(0);

  /** Message requests waiting. Drawn separately, because a request is not a message yet. */
  readonly requests = signal(0);

  /**
   * The fallback interval, not the main mechanism. The socket moves the badge the instant something
   * happens; this exists so that a browser which refused to upgrade — a corporate proxy, a dead
   * connection nobody noticed — still ends up with a correct number rather than a stuck one.
   */
  private readonly period = 60_000;

  private handle?: ReturnType<typeof setInterval>;
  private watching = 0;
  private inFlight = false;

  constructor() {
    // The socket says "something arrived", not "the badge is now four". Recomputing it costs two
    // integers, and auditTime collapses a burst of messages into a single request.
    merge(this.realtime.message$, this.realtime.resynced$)
      .pipe(auditTime(400))
      .subscribe(() => this.refresh());

    // The server can also push the numbers directly, which skips the round trip entirely.
    this.realtime.counts$.subscribe((counts) => {
      this.unread.set(counts.unread);
      this.requests.set(counts.requests);
    });
  }

  start() {
    this.watching++;

    if (this.handle) return;

    this.refresh();
    this.handle = setInterval(() => this.refresh(), this.period);
  }

  stop() {
    this.watching = Math.max(0, this.watching - 1);

    if (this.watching > 0 || !this.handle) return;

    clearInterval(this.handle);
    this.handle = undefined;
  }

  /** Ask now — worth calling straight after reading or sending something. */
  refresh() {
    if (this.inFlight || !this.auth.isSignedIn() || document.hidden) return;

    this.inFlight = true;

    this.api.inboxCounts().subscribe({
      next: (counts) => {
        this.inFlight = false;
        this.unread.set(counts.unread);
        this.requests.set(counts.requests);
      },
      error: () => {
        this.inFlight = false;
      },
    });
  }
}
