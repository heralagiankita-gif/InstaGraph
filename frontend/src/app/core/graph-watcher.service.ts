import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api.service';

/**
 * Asks the API one cheap question on a timer — "has the follow graph changed?" — and publishes the answer
 * as a signal that anything drawing the graph can watch.
 *
 * <p>
 * The graph itself is far too big to re-fetch on a timer, and the snapshot's own build time is no use as a
 * change marker: it moves every time the server's twenty-second cache expires, whether the edges changed or
 * not, so polling that would make the drawing rebuild every twenty seconds for nothing. The server hashes
 * the edge set instead, and this reports a new version only when the content genuinely differs.
 * </p>
 *
 * <p>
 * Polling is ref-counted and started by whatever is on screen rather than at construction: every endpoint
 * here needs a bearer token, so a service that polled from application start would spend the login screen
 * collecting 401s.
 * </p>
 */
@Injectable({ providedIn: 'root' })
export class GraphWatcher {
  private readonly api = inject(Api);

  /** Content hash of the current snapshot. Changes only when nodes, edges, weights or blocks change. */
  readonly version = signal<string | null>(null);

  readonly nodes = signal(0);
  readonly edges = signal(0);
  readonly checkedAt = signal<number | null>(null);

  /** One small request; the response is four numbers and a hash. */
  private readonly period = 10_000;

  private handle?: ReturnType<typeof setInterval>;
  private watching = 0;
  private inFlight = false;

  /** Ref-counted, so two views watching at once still produce one poll. */
  start() {
    this.watching++;

    if (this.handle) return;

    this.check();
    this.handle = setInterval(() => this.check(), this.period);
  }

  stop() {
    this.watching = Math.max(0, this.watching - 1);

    if (this.watching > 0 || !this.handle) return;

    clearInterval(this.handle);
    this.handle = undefined;
  }

  /**
   * Check now rather than on the next tick. Worth calling straight after a write that moves an edge — a
   * follow, a like — so the picture reacts immediately instead of up to ten seconds later.
   */
  refresh() {
    if (this.watching === 0) return;

    this.check();
  }

  private check() {
    // A hidden tab does not need to know, and a second request would only race the one already going.
    if (this.inFlight || document.hidden) return;

    this.inFlight = true;

    this.api.graphVersion().subscribe({
      next: (snapshot) => {
        this.inFlight = false;
        this.nodes.set(snapshot.nodes);
        this.edges.set(snapshot.edges);
        this.checkedAt.set(Date.now());

        // Set last: this is the signal every consumer keys off, so everything else should already be true
        // by the time it fires.
        this.version.set(snapshot.version);
      },
      error: () => {
        this.inFlight = false;
      },
    });
  }
}
