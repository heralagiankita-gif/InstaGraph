import { DecimalPipe } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { GraphWatcher } from '../../core/graph-watcher.service';
import { NetworkGraph, NetworkNode, NetworkStats } from '../../core/models';

/** A node with the simulation state the layout needs on top of what the API returned. */
interface Placed extends NetworkNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

/**
 * One line between two accounts. A pair that follows each other is drawn once, as a single undirected
 * link, rather than as two arrows lying on top of one another.
 */
interface Link {
  a: Placed;
  b: Placed;
  mutual: boolean;
  weight: number;
}

type ColourMode = 'community' | 'relationship' | 'hop';

/**
 * Your neighbourhood, drawn.
 *
 * The layout is a force simulation, which is itself a graph algorithm: every pair of nodes repels, every
 * edge pulls its two ends together, and each ring is held at a radius matching its hop count. Left to run,
 * that settles into a picture where distance on screen approximates distance in the graph.
 *
 * Everything drawn comes from the edge set — colour, size, the arrowheads and the rings. The one thing
 * the drawing has to work at is saying when a ring is *empty*, because a depth that adds nothing looks
 * exactly like a depth control that does nothing.
 */
@Component({
  selector: 'app-network',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DecimalPipe],
  template: `
    <div class="wrap">
      <header class="head">
        <div>
          <h1 class="title">Your network</h1>
          <p class="small muted" style="margin-top:2px">
            {{ nodeCount() }} {{ nodeCount() === 1 ? 'account' : 'accounts' }},
            {{ linkCount() }} {{ linkCount() === 1 ? 'connection' : 'connections' }}
            @if (mutualCount() > 0) {
              ({{ mutualCount() }} mutual),
            } @else {
              ,
            }
            {{ communityCount() }} {{ communityCount() === 1 ? 'community' : 'communities' }} in view.
          </p>
          @if (changeNote()) {
            <p class="small strong" style="margin-top:2px;color:#6228d7">
              <i class="bi bi-arrow-repeat"></i> {{ changeNote() }}
            </p>
          }
        </div>

        <a class="btn-ghost strong small" routerLink="/discover">
          <i class="bi bi-person-plus"></i> Find people
        </a>
      </header>

      <div class="controls">
        <span class="tiny muted">Depth</span>
        @for (option of depths; track option) {
          <button
            type="button"
            class="pill"
            [class.active]="depth() === option"
            [class.hollow]="option > 1 && addedAt(option) === 0"
            [title]="depthHint(option)"
            (click)="setDepth(option)">
            {{ option }} hop{{ option === 1 ? '' : 's' }}
            <span class="count">{{ option === 1 ? reachAt(1) : '+' + addedAt(option) }}</span>
          </button>
        }

        <span class="divider"></span>

        <span class="tiny muted">Colour</span>
        @for (mode of colourModes; track mode.key) {
          <button
            type="button"
            class="pill"
            [class.active]="colourBy() === mode.key"
            [title]="mode.hint"
            (click)="setColour(mode.key)">
            {{ mode.label }}
          </button>
        }

        <span class="grow"></span>

        <button type="button" class="pill" (click)="reheat()" title="Shake the layout loose">
          <i class="bi bi-arrow-repeat"></i> Re-layout
        </button>
      </div>

      <!--
        The honest explanation for why deeper rings can look identical. Without it a correct picture reads
        as a broken control.
      -->
      @if (shapeNote(); as note) {
        <p class="note small">
          <i class="bi bi-info-circle"></i>
          <span>{{ note }}</span>
        </p>
      }

      <div class="stage">
        <canvas
          #canvas
          (mousemove)="onMove($event)"
          (mouseleave)="onLeave()"
          (click)="onClick()"></canvas>

        @if (loading()) {
          <div class="overlay"><div class="spinner"></div></div>
        } @else if (nodeCount() <= 1) {
          <div class="overlay">
            <p class="small muted" style="max-width:300px;text-align:center">
              An account with no edges is an isolated node — there is genuinely nothing to draw. Follow
              somebody and this fills in.
            </p>
          </div>
        }

        @if (hovered(); as node) {
          <div class="tip">
            <strong>{{ node.username }}</strong>
            @if (node.fullName) {
              <span class="tiny muted">{{ node.fullName }}</span>
            }
            <span class="tiny">{{ describe(node) }}</span>
            <span class="tiny muted">
              {{ node.followerCount }} {{ node.followerCount === 1 ? 'follower' : 'followers' }} ·
              community {{ node.community }}
            </span>
            @if (!node.isYou) {
              <span class="tiny muted">Click to open the profile</span>
            }
          </div>
        }
      </div>

      <div class="legend">
        @for (item of legend(); track item.label) {
          <span><i class="dot" [style.background]="item.colour"></i> {{ item.label }}</span>
        }
        <span><i class="dot big ghost"></i> Size = PageRank influence</span>
        <span><i class="line mutual"></i> Follow each other</span>
        <span><i class="line arrow"></i> One-way follow</span>
      </div>

      @if (stats(); as s) {
        <section class="cards">
          <article class="stat">
            <span class="big">{{ s.reach1 }} / {{ s.reach2 }} / {{ s.reach3 }}</span>
            <span class="tiny muted">Accounts within 1 / 2 / 3 hops</span>
            <p class="tiny muted">
              Breadth-first from you, counted cumulatively. When the three figures are equal, your
              neighbourhood is closed — nothing new is reachable by going further out.
            </p>
          </article>

          <article class="stat">
            <span class="big">{{ s.reciprocity * 100 | number: '1.0-0' }}%</span>
            <span class="tiny muted">Reciprocity</span>
            <p class="tiny muted">
              Share of your follows that point back at you. High means friends; low means you are reading
              rather than talking.
            </p>
          </article>

          <article class="stat">
            <span class="big">{{ s.clustering * 100 | number: '1.0-0' }}%</span>
            <span class="tiny muted">Clustering coefficient</span>
            <p class="tiny muted">
              How many of your neighbours follow each other. At 0% you are a hub joining people who have
              no other route to one another, which is why friend-of-friend suggestions stay empty.
            </p>
          </article>

          <article class="stat">
            <span class="big">{{ s.influencePercentile * 100 | number: '1.0-0' }}th</span>
            <span class="tiny muted">Influence percentile</span>
            <p class="tiny muted">
              Global PageRank against every other account — endorsements weighted by who is endorsing, not
              a follower count.
            </p>
          </article>

          <article class="stat">
            <span class="big">{{ s.communitySize }}</span>
            <span class="tiny muted">Accounts in your community</span>
            <p class="tiny muted">
              One of {{ s.graphCommunities }}
              {{ s.graphCommunities === 1 ? 'cluster' : 'clusters' }} label propagation found. Nobody
              chose the boundaries — the edges did.
            </p>
          </article>

          <article class="stat">
            <span class="big">{{ s.graphNodes }} / {{ s.graphEdges }}</span>
            <span class="tiny muted">Whole graph: nodes / edges</span>
            <p class="tiny muted">
              Held in memory as adjacency lists. A matrix would need {{ s.graphNodes }}² cells for the
              same answers.
            </p>
          </article>
        </section>
      }
    </div>
  `,
  styles: [
    `
      .wrap {
        max-width: 1000px;
        margin: 0 auto;
      }

      .head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }

      .controls {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 16px 0 10px;
        flex-wrap: wrap;
      }

      .divider {
        width: 1px;
        height: 18px;
        background: var(--border);
        margin: 0 6px;
      }

      .pill {
        border: 1px solid var(--border);
        background: transparent;
        color: var(--ink-2);
        border-radius: 999px;
        padding: 5px 13px;
        font-size: 12px;
        font-weight: 600;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .pill.active {
        background: var(--ink);
        color: var(--surface);
        border-color: var(--ink);
      }

      /* A depth that adds nobody is shown as available but empty, rather than looking broken. */
      .pill.hollow:not(.active) {
        opacity: 0.55;
        border-style: dashed;
      }

      .count {
        font-variant-numeric: tabular-nums;
        opacity: 0.65;
        font-weight: 500;
      }

      .note {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin: 0 0 12px;
        padding: 9px 12px;
        border: 1px solid var(--border);
        border-left-width: 3px;
        border-radius: var(--radius-lg, 10px);
        background: var(--border-soft);
        color: var(--ink-2);
        line-height: 1.5;
      }

      .stage {
        position: relative;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 12px);
        overflow: hidden;
        background: var(--surface);
        height: 560px;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
        cursor: default;
      }

      .overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      }

      .tip {
        position: absolute;
        left: 12px;
        bottom: 12px;
        display: flex;
        flex-direction: column;
        gap: 1px;
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 10px);
        background: var(--surface);
        box-shadow: var(--shadow-md);
        pointer-events: none;
        max-width: 260px;
      }

      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 20px;
        margin: 12px 0 4px;
        font-size: 12px;
        color: var(--ink-3);
        align-items: center;
      }

      .legend span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
      }

      .dot.big {
        width: 15px;
        height: 15px;
      }

      .dot.ghost {
        background: var(--ink-3);
      }

      .line {
        width: 18px;
        height: 1px;
        background: var(--ink-3);
      }

      .line.mutual {
        height: 3px;
        background: var(--ink-2);
        border-radius: 2px;
      }

      .line.arrow {
        position: relative;
      }

      .line.arrow::after {
        content: '';
        position: absolute;
        right: -1px;
        top: -3px;
        border: 3.5px solid transparent;
        border-left-color: var(--ink-3);
      }

      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 14px;
        margin-top: 22px;
      }

      .stat {
        border: 1px solid var(--border);
        border-radius: var(--radius-lg, 12px);
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .stat .big {
        font-size: 22px;
        font-weight: 700;
        letter-spacing: -0.4px;
      }

      .stat p {
        margin: 6px 0 0;
      }

      @media (max-width: 700px) {
        .stage {
          height: 420px;
        }
      }
    `,
  ],
})
export class NetworkComponent implements AfterViewInit, OnDestroy {
  private readonly api = inject(Api);
  private readonly zone = inject(NgZone);
  private readonly router = inject(Router);
  private readonly watcher = inject(GraphWatcher);

  /**
   * Repaint when the server says the edge set has moved.
   *
   * The first version to arrive is only recorded, not acted on: the initial load is already in flight
   * against that same snapshot, and refetching it would be a wasted round trip.
   */
  private readonly sync = effect(() => {
    const version = this.watcher.version();

    if (!version || version === this.drawnVersion) return;

    const first = this.drawnVersion === null;
    this.drawnVersion = version;

    if (!first) this.load(true);
  });

  @ViewChild('canvas') private canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly depths = [1, 2, 3];

  protected readonly colourModes: { key: ColourMode; label: string; hint: string }[] = [
    {
      key: 'community',
      label: 'Community',
      hint: 'The cluster label propagation assigned. Useless when everybody is in one cluster.',
    },
    {
      key: 'relationship',
      label: 'Relationship',
      hint: 'Which way the edges run between you and them.',
    },
    { key: 'hop', label: 'Distance', hint: 'How many hops from you.' },
  ];

  protected readonly depth = signal(2);
  protected readonly colourBy = signal<ColourMode>('relationship');
  protected readonly graph = signal<NetworkGraph | null>(null);
  protected readonly stats = signal<NetworkStats | null>(null);
  protected readonly loading = signal(true);
  protected readonly hovered = signal<Placed | null>(null);

  protected readonly nodeCount = computed(() => this.graph()?.nodes.length ?? 0);
  protected readonly communityCount = computed(() => this.graph()?.communityCount ?? 0);

  /** Undirected pairs, so a mutual follow counts once rather than twice. */
  protected readonly linkCount = signal(0);
  protected readonly mutualCount = signal(0);

  /** Set for a few seconds after an automatic update, so a picture that moves on its own says why. */
  protected readonly changeNote = signal<string | null>(null);

  private nodes: Placed[] = [];
  private links: Link[] = [];
  private byId = new Map<number, Placed>();

  /** The snapshot the current drawing came from, compared against the watcher to spot staleness. */
  private drawnVersion: string | null = null;
  private noteTimer?: ReturnType<typeof setTimeout>;

  /** Simulation temperature. Decays to nothing, which is what makes the picture settle rather than jitter. */
  private alpha = 1;
  private frame = 0;
  private observer?: ResizeObserver;
  private width = 0;
  private height = 0;

  /** Set every frame by the fit pass, and reused by hit-testing so the two never disagree. */
  private scale = 1;

  ngAfterViewInit() {
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.canvasRef.nativeElement.parentElement!);

    this.load();
    this.watcher.start();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    this.watcher.stop();
    clearTimeout(this.noteTimer);
  }

  // ------------------------------------------------------------------ controls

  protected setDepth(depth: number) {
    if (depth === this.depth()) return;

    this.depth.set(depth);
    this.load();
  }

  protected setColour(mode: ColourMode) {
    this.colourBy.set(mode);
    this.draw();
  }

  protected reheat() {
    this.alpha = 1;
    this.run();
  }

  /** Cumulative accounts within n hops, straight off the breadth-first counts. */
  protected reachAt(hops: number): number {
    const s = this.stats();
    if (!s) return 0;

    return [0, s.reach1, s.reach2, s.reach3][hops] ?? 0;
  }

  /** How many accounts this depth adds that the one before it did not already reach. */
  protected addedAt(hops: number): number {
    return Math.max(0, this.reachAt(hops) - this.reachAt(hops - 1));
  }

  protected depthHint(hops: number): string {
    const added = this.addedAt(hops);

    if (hops === 1) {
      return `${this.reachAt(1)} accounts you follow`;
    }

    return added === 0
      ? `Nobody new at ${hops} hops — this draws the same picture as ${hops - 1}`
      : `${added} more accounts at ${hops} hops`;
  }

  /**
   * Says out loud what the shape of the neighbourhood is. A star and a dense cluster produce very
   * different pictures for the same node count, and the depth control behaves differently in each.
   */
  protected shapeNote(): string | null {
    const s = this.stats();
    if (!s || s.following === 0) return null;

    if (s.reach2 === s.reach1 && s.reach1 > 0) {
      const mutual = s.reciprocity === 1;

      return (
        `Nothing sits two hops out: everyone you follow follows only you back` +
        `${mutual ? ' — every edge here is mutual' : ''}. ` +
        `That shape is a star, so 1, 2 and 3 hops all draw the same picture. ` +
        `Suggestions stay empty for the same reason: friend-of-friend has no friend-of-friend to find.`
      );
    }

    if (s.clustering === 0 && s.following > 1) {
      return (
        'None of the accounts you follow follow each other, so you are the only route between them. ' +
        'That is what a clustering coefficient of 0% looks like.'
      );
    }

    return null;
  }

  protected describe(node: Placed): string {
    if (node.isYou) return 'This is you';
    if (node.isFollowing && node.followsYou) return `Friends · ${node.hop} hop away`;
    if (node.isFollowing) return `You follow them · ${node.hop} hop away`;
    if (node.followsYou) return 'Follows you';

    return `${node.hop} hops away`;
  }

  protected legend(): { label: string; colour: string }[] {
    switch (this.colourBy()) {
      case 'relationship':
        return [
          { label: 'You', colour: 'var(--ink)' },
          { label: 'Friends', colour: '#2ecc71' },
          { label: 'You follow them', colour: '#3897f0' },
          { label: 'They follow you', colour: '#f39c12' },
          { label: 'No edge with you', colour: '#9aa0a6' },
        ];
      case 'hop':
        return [
          { label: 'You', colour: 'var(--ink)' },
          { label: '1 hop', colour: '#6228d7' },
          { label: '2 hops', colour: '#a06bea' },
          { label: '3 hops', colour: '#d0b6f2' },
        ];
      default:
        return [
          { label: 'You', colour: 'var(--ink)' },
          { label: 'Colour = community', colour: 'hsl(275, 62%, 55%)' },
        ];
    }
  }

  // ---------------------------------------------------------------------- data

  /**
   * @param soft An update the user did not ask for — triggered by the graph changing underneath them.
   * Keeps the spinner away and folds the new snapshot into the picture already on screen instead of
   * rebuilding it, because a drawing that reshuffles itself while being read is worse than a stale one.
   */
  private load(soft = false) {
    if (!soft) this.loading.set(true);

    this.drawnVersion = this.watcher.version();

    this.api.network(this.depth(), 110).subscribe({
      next: (graph) => {
        this.graph.set(graph);

        if (soft && this.nodes.length > 0) {
          this.merge(graph);
        } else {
          this.seed(graph);
          this.reheat();
        }

        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    // The stats move with the graph, so they are refreshed alongside it rather than only on first paint.
    this.api.networkStats().subscribe({ next: (s) => this.stats.set(s), error: () => {} });
  }

  /**
   * Fold a fresh snapshot into the layout already on screen.
   *
   * Re-seeding would throw every account back onto its hop ring, so following one person would look like a
   * different graph. Instead, anyone already placed keeps their coordinates and velocity, and only genuinely
   * new accounts are positioned — next to whoever introduced them, which is roughly where the simulation was
   * going to pull them anyway.
   */
  private merge(graph: NetworkGraph) {
    const previous = this.byId;
    const rings = [0, 150, 270, 360];

    this.nodes = graph.nodes.map((node) => {
      const settled = previous.get(node.id);
      const radius = node.isYou ? 15 : 6 + Math.sqrt(node.influence) * 12;

      if (settled) {
        return { ...node, x: settled.x, y: settled.y, vx: settled.vx, vy: settled.vy, radius };
      }

      // A new account. Drop it beside a neighbour that is already placed so it slides into position rather
      // than flying in from the middle; fall back to its hop ring when nobody it connects to is on screen.
      const anchor = graph.edges
        .map((edge) =>
          edge.source === node.id
            ? previous.get(edge.target)
            : edge.target === node.id
              ? previous.get(edge.source)
              : undefined,
        )
        .find((n): n is Placed => !!n);

      const angle = Math.random() * Math.PI * 2;
      const ring = rings[Math.min(node.hop, rings.length - 1)];

      return {
        ...node,
        x: (anchor?.x ?? Math.cos(angle) * ring) + Math.cos(angle) * 26,
        y: (anchor?.y ?? Math.sin(angle) * ring) + Math.sin(angle) * 26,
        vx: 0,
        vy: 0,
        radius,
      };
    });

    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.rebuildLinks(graph);

    const arrived = this.nodes.filter((n) => !previous.has(n.id)).length;
    const gone = [...previous.keys()].filter((id) => !this.byId.has(id)).length;
    this.note(arrived, gone);

    // Warm, not hot. Enough for the layout to absorb the change without rearranging the whole picture.
    this.alpha = Math.max(this.alpha, 0.35);
    this.run();
  }

  private note(arrived: number, gone: number) {
    const parts: string[] = [];

    if (arrived > 0) parts.push(`+${arrived} account${arrived === 1 ? '' : 's'}`);
    if (gone > 0) parts.push(`−${gone} gone`);

    this.changeNote.set(parts.length > 0 ? `${parts.join(', ')} · updated just now` : 'Updated just now');

    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => this.changeNote.set(null), 6000);
  }

  /**
   * Starting positions matter more than they look. Dropping every node at random needs hundreds of ticks
   * to untangle; seeding each ring on the circle its hop count implies means the simulation only has to
   * refine an arrangement that is already roughly right.
   */
  private seed(graph: NetworkGraph) {
    const rings = [0, 150, 270, 360];
    const perHop = new Map<number, number>();

    graph.nodes.forEach((n) => perHop.set(n.hop, (perHop.get(n.hop) ?? 0) + 1));

    const placedSoFar = new Map<number, number>();

    this.nodes = graph.nodes.map((node) => {
      const index = placedSoFar.get(node.hop) ?? 0;
      placedSoFar.set(node.hop, index + 1);

      const count = perHop.get(node.hop) ?? 1;

      // Offset each ring by half a step so ring 2 does not sit directly behind ring 1.
      const angle = ((index + (node.hop % 2) * 0.5) / count) * Math.PI * 2;
      const radius = rings[Math.min(node.hop, rings.length - 1)];

      return {
        ...node,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
        // Influence arrives normalised against the biggest node in this drawing, so the scale is honest
        // within one picture and meaningless across two.
        radius: node.isYou ? 15 : 6 + Math.sqrt(node.influence) * 12,
      };
    });

    this.byId = new Map(this.nodes.map((n) => [n.id, n]));
    this.rebuildLinks(graph);
  }

  /**
   * Two directed rows for a mutual pair are one line on screen. Collapsing them here means the drawing
   * never paints an arrow on top of its own opposite, and the count in the header is honest.
   */
  private rebuildLinks(graph: NetworkGraph) {
    const seen = new Map<string, Link>();

    for (const edge of graph.edges) {
      const a = this.byId.get(edge.source);
      const b = this.byId.get(edge.target);

      if (!a || !b) continue;

      const key = edge.source < edge.target
        ? `${edge.source}-${edge.target}`
        : `${edge.target}-${edge.source}`;

      const existing = seen.get(key);

      if (existing) {
        existing.mutual = true;
        existing.weight = Math.max(existing.weight, edge.weight);
        continue;
      }

      seen.set(key, { a, b, mutual: edge.mutual, weight: edge.weight });
    }

    this.links = [...seen.values()];
    this.linkCount.set(this.links.length);
    this.mutualCount.set(this.links.filter((l) => l.mutual).length);
  }

  // -------------------------------------------------------------------- layout

  private tick() {
    const nodes = this.nodes;
    const n = nodes.length;

    if (n === 0) return;

    // Ideal separation for the area available — the classic Fruchterman–Reingold constant.
    const k = Math.sqrt((this.width * this.height) / Math.max(n, 1)) * 0.42;

    // Repulsion. O(n²), which is fine because the node count is capped for legibility anyway.
    for (let i = 0; i < n; i++) {
      const a = nodes[i];

      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.hypot(dx, dy);

        if (dist < 0.01) {
          // Two nodes exactly on top of each other have no direction to separate along, so one is nudged.
          dx = (i % 2 === 0 ? 1 : -1) * 0.5;
          dy = 0.5;
          dist = 0.7;
        }

        const force = (k * k) / dist;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
    }

    // Attraction along every edge.
    for (const link of this.links) {
      const dx = link.a.x - link.b.x;
      const dy = link.a.y - link.b.y;
      const dist = Math.max(0.01, Math.hypot(dx, dy));

      // A heavier edge — more likes and comments between the two — pulls harder, so the people you
      // actually talk to sit closer to you than the ones you followed and forgot.
      const strength = (dist * dist) / k / (link.mutual ? 0.7 : 1) / (1 + Math.log(1 + link.weight) * 0.2);

      const fx = (dx / dist) * strength;
      const fy = (dy / dist) * strength;

      link.a.vx -= fx;
      link.a.vy -= fy;
      link.b.vx += fx;
      link.b.vy += fy;
    }

    // Each ring is held near the radius its hop count implies, which keeps the picture readable as
    // "you, then them, then theirs" instead of an undifferentiated blob.
    const rings = [0, 150, 270, 360];

    for (const node of nodes) {
      const target = rings[Math.min(node.hop, rings.length - 1)];
      const dist = Math.max(0.01, Math.hypot(node.x, node.y));
      const pull = (dist - target) * 0.06;

      node.vx -= (node.x / dist) * pull;
      node.vy -= (node.y / dist) * pull;
    }

    // Integrate, with the step capped by the temperature so early ticks move far and late ticks barely.
    const limit = 14 * this.alpha;

    for (const node of nodes) {
      if (node.isYou) {
        // You are the frame of reference. Pinning the centre stops the whole drawing from drifting.
        node.x = 0;
        node.y = 0;
        node.vx = 0;
        node.vy = 0;
        continue;
      }

      const speed = Math.hypot(node.vx, node.vy);

      if (speed > limit) {
        node.vx = (node.vx / speed) * limit;
        node.vy = (node.vy / speed) * limit;
      }

      node.x += node.vx * this.alpha;
      node.y += node.vy * this.alpha;

      node.vx *= 0.82;
      node.vy *= 0.82;
    }

    this.alpha *= 0.985;
  }

  // ---------------------------------------------------------------------- paint

  private run() {
    cancelAnimationFrame(this.frame);

    // Outside Angular: sixty frames a second must not mean sixty change-detection passes a second.
    this.zone.runOutsideAngular(() => {
      const loop = () => {
        this.tick();
        this.draw();

        if (this.alpha > 0.006) {
          this.frame = requestAnimationFrame(loop);
        }
      };

      this.frame = requestAnimationFrame(loop);
    });
  }

  private resize() {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const box = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;

    this.width = box.width;
    this.height = box.height;

    canvas.width = Math.round(box.width * ratio);
    canvas.height = Math.round(box.height * ratio);

    this.draw();
  }

  /**
   * Scales the drawing so it fills the box it was given.
   * <para>
   * A fixed scale wastes the panel whenever the neighbourhood is small — five nodes in a 560px box is
   * mostly empty space — and overflows it whenever the neighbourhood is large. Measuring the laid-out
   * extent each frame costs one pass over the nodes and makes the picture the right size in both cases.
   * </para>
   */
  private fit(): number {
    if (this.nodes.length === 0) return 1;

    let extent = 1;

    for (const node of this.nodes) {
      extent = Math.max(extent, Math.hypot(node.x, node.y) + node.radius);
    }

    // Room for the label that hangs below the outermost node.
    const padding = 54;
    const available = Math.min(this.width, this.height) / 2 - padding;

    return Math.max(0.25, Math.min(2.2, available / extent));
  }

  private draw() {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (this.width === 0) {
      this.resize();
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    const style = getComputedStyle(document.documentElement);
    const ink = style.getPropertyValue('--ink').trim() || '#111';
    const border = style.getPropertyValue('--border').trim() || '#dbdbdb';
    const surface = style.getPropertyValue('--surface').trim() || '#fff';
    const faint = style.getPropertyValue('--ink-3').trim() || '#8e8e8e';

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // Everything is laid out around the origin, so one translate puts it on screen.
    ctx.save();
    ctx.translate(this.width / 2, this.height / 2);

    this.scale = this.fit();
    ctx.scale(this.scale, this.scale);

    const focus = this.hovered();
    const near = focus ? this.neighboursOf(focus) : null;

    this.drawRings(ctx, faint);

    // Edges first, so no line is drawn over a face.
    for (const link of this.links) {
      const lit = !near || near.has(link.a.id) || near.has(link.b.id);

      ctx.globalAlpha = lit ? 0.95 : 0.14;
      this.drawLink(ctx, link, lit ? (link.mutual ? faint : border) : border);
    }

    ctx.globalAlpha = 1;

    // Below this many nodes every label fits, and a drawing you have to hover to read is worse than one
    // that is slightly busy.
    const labelAll = this.nodes.length <= 40;

    for (const node of this.nodes) {
      const lit = !near || near.has(node.id);

      ctx.globalAlpha = lit ? 1 : 0.2;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = this.nodeColour(node, ink);
      ctx.fill();

      // A ring in the page background separates nodes that overlap.
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeStyle = surface;
      ctx.stroke();

      if (labelAll || node.isYou || node === focus) {
        ctx.globalAlpha = lit ? 1 : 0.3;
        ctx.fillStyle = ink;
        ctx.font = `${node.isYou ? 700 : 600} ${(node.isYou ? 13 : 11) / this.scale}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(
          node.isYou ? 'you' : node.username,
          node.x,
          node.y + node.radius + 14 / this.scale,
        );
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * Faint guide circles at each hop radius. Drawing the ring even when it holds nobody is the point: an
   * empty ring 2 shows at a glance that the neighbourhood stops at ring 1.
   */
  private drawRings(ctx: CanvasRenderingContext2D, colour: string) {
    const rings = [150, 270, 360];

    ctx.save();
    ctx.setLineDash([3 / this.scale, 5 / this.scale]);
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeStyle = colour;
    ctx.font = `500 ${10 / this.scale}px system-ui, sans-serif`;
    ctx.fillStyle = colour;
    ctx.textAlign = 'center';

    for (let hop = 1; hop <= this.depth(); hop++) {
      const radius = rings[hop - 1];
      const populated = this.nodes.some((n) => n.hop === hop);

      ctx.globalAlpha = populated ? 0.28 : 0.16;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = populated ? 0.6 : 0.4;
      ctx.fillText(
        populated ? `${hop} hop${hop === 1 ? '' : 's'}` : `${hop} hops · empty`,
        0,
        -radius - 6 / this.scale,
      );
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * One line per pair. A one-way follow gets an arrowhead, because the graph is directed and a plain
   * segment throws that away — which is the single most important thing a picture of follows can show.
   */
  private drawLink(ctx: CanvasRenderingContext2D, link: Link, colour: string) {
    const dx = link.b.x - link.a.x;
    const dy = link.b.y - link.a.y;
    const dist = Math.max(0.01, Math.hypot(dx, dy));
    const ux = dx / dist;
    const uy = dy / dist;

    // Stop the line at the rim of each circle rather than under it, so an arrowhead is visible.
    const gap = link.mutual ? 0 : 4 / this.scale;
    const sx = link.a.x + ux * link.a.radius;
    const sy = link.a.y + uy * link.a.radius;
    const tx = link.b.x - ux * (link.b.radius + gap);
    const ty = link.b.y - uy * (link.b.radius + gap);

    ctx.strokeStyle = colour;
    ctx.lineWidth = (link.mutual ? 2.4 : 1.1) / this.scale;

    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    if (link.mutual) return;

    const size = 7 / this.scale;
    const angle = Math.atan2(uy, ux);

    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(
      tx - size * Math.cos(angle - Math.PI / 7),
      ty - size * Math.sin(angle - Math.PI / 7),
    );
    ctx.lineTo(
      tx - size * Math.cos(angle + Math.PI / 7),
      ty - size * Math.sin(angle + Math.PI / 7),
    );
    ctx.closePath();
    ctx.fill();
  }

  /** The node itself plus everything one edge away — what stays lit when something is hovered. */
  private neighboursOf(node: Placed): Set<number> {
    const set = new Set<number>([node.id]);

    for (const link of this.links) {
      if (link.a.id === node.id) set.add(link.b.id);
      if (link.b.id === node.id) set.add(link.a.id);
    }

    return set;
  }

  private nodeColour(node: Placed, ink: string): string {
    if (node.isYou) return ink;

    switch (this.colourBy()) {
      case 'relationship':
        if (node.isFollowing && node.followsYou) return '#2ecc71';
        if (node.isFollowing) return '#3897f0';
        if (node.followsYou) return '#f39c12';
        return '#9aa0a6';

      case 'hop':
        return ['#6228d7', '#a06bea', '#d0b6f2'][Math.min(node.hop, 3) - 1] ?? '#d0b6f2';

      default: {
        // Golden-angle hue stepping, so adjacent community ids never land on adjacent colours.
        const hue = Math.abs(Math.round(node.community * 137.508)) % 360;
        return `hsl(${hue}, 62%, 55%)`;
      }
    }
  }

  // --------------------------------------------------------------- interaction

  protected onMove(event: MouseEvent) {
    const canvas = this.canvasRef.nativeElement;
    const box = canvas.getBoundingClientRect();

    // The same scale the last frame drew with, so the hit box is exactly where the circle looks.
    const x = (event.clientX - box.left - this.width / 2) / this.scale;
    const y = (event.clientY - box.top - this.height / 2) / this.scale;

    let found: Placed | null = null;

    for (const node of this.nodes) {
      if (Math.hypot(node.x - x, node.y - y) <= node.radius + 4) {
        found = node;
        break;
      }
    }

    canvas.style.cursor = found ? 'pointer' : 'default';

    // Only touch the signal when the answer actually changed — otherwise every mouse move would run
    // change detection for nothing.
    if (found?.id !== this.hovered()?.id) {
      this.zone.run(() => this.hovered.set(found));
      this.draw();
    }
  }

  protected onLeave() {
    if (this.hovered()) {
      this.zone.run(() => this.hovered.set(null));
      this.draw();
    }
  }

  protected onClick() {
    const node = this.hovered();

    if (node && !node.isYou) {
      this.router.navigate(['/', node.username]);
    }
  }
}
