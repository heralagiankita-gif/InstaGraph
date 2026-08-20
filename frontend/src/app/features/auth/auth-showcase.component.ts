import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The phone beside the sign-in form.
 *
 * Instagram puts a rotating carousel of screenshots there. Screenshots of an app nobody has signed into
 * yet would be screenshots of an empty database, so this shows the thing the app is actually built on
 * instead: a social graph assembling itself — accounts appearing, edges connecting them, and a route
 * lighting up between two people who have never met.
 *
 * It is one SVG and a stack of CSS keyframes on a twelve-second loop. No canvas, no simulation, no
 * library: the positions are designed rather than solved, because a real force layout of nine nodes
 * spends most of its time being ugly and this has one job, which is to look like the idea.
 */
@Component({
  selector: 'app-auth-showcase',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="phone" aria-hidden="true">
      <div class="screen">
        <svg viewBox="0 0 240 420" class="graph">
          <defs>
            <linearGradient id="edgeGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#f9ce34" />
              <stop offset="45%" stop-color="#ee2a7b" />
              <stop offset="100%" stop-color="#6228d7" />
            </linearGradient>

            <radialGradient id="nodeGrad">
              <stop offset="0%" stop-color="#ffffff" stop-opacity="0.95" />
              <stop offset="100%" stop-color="#ffffff" stop-opacity="0.55" />
            </radialGradient>

            <filter id="soften" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
          </defs>

          <!-- The washes behind everything, so the screen is never flat black. -->
          <circle class="bloom b1" cx="72" cy="120" r="58" fill="#ee2a7b" filter="url(#soften)" />
          <circle class="bloom b2" cx="176" cy="286" r="62" fill="#6228d7" filter="url(#soften)" />

          <!-- Edges are drawn with a dash offset animated to zero, so each one draws itself on. -->
          <g class="edges" stroke="url(#edgeGrad)" stroke-width="1.6" fill="none" stroke-linecap="round">
            <line class="edge e1" x1="120" y1="96" x2="62" y2="168" />
            <line class="edge e2" x1="120" y1="96" x2="182" y2="164" />
            <line class="edge e3" x1="62" y1="168" x2="104" y2="246" />
            <line class="edge e4" x1="182" y1="164" x2="104" y2="246" />
            <line class="edge e5" x1="104" y1="246" x2="60" y2="326" />
            <line class="edge e6" x1="104" y1="246" x2="176" y2="330" />
            <line class="edge e7" x1="182" y1="164" x2="176" y2="330" />
          </g>

          <!-- The route: the same three edges again, thicker and brighter, travelling on a delay. -->
          <g class="route" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round">
            <line class="hop h1" x1="120" y1="96" x2="182" y2="164" />
            <line class="hop h2" x1="182" y1="164" x2="176" y2="330" />
          </g>

          <g class="nodes">
            <circle class="node n1" cx="120" cy="96" r="13" fill="url(#nodeGrad)" />
            <circle class="node n2" cx="62" cy="168" r="9" fill="url(#nodeGrad)" />
            <circle class="node n3" cx="182" cy="164" r="10" fill="url(#nodeGrad)" />
            <circle class="node n4" cx="104" cy="246" r="8" fill="url(#nodeGrad)" />
            <circle class="node n5" cx="60" cy="326" r="7" fill="url(#nodeGrad)" />
            <circle class="node n6" cx="176" cy="330" r="12" fill="url(#nodeGrad)" />
          </g>
        </svg>

        <!-- The captions cycle on the same clock as the drawing, so the words match the picture. -->
        <div class="captions">
          <span class="cap c1">every account is a node</span>
          <span class="cap c2">every follow is an edge</span>
          <span class="cap c3">your feed is a question asked of them</span>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .phone {
        width: 268px;
        height: 462px;
        border-radius: 34px;
        padding: 10px;
        background: linear-gradient(160deg, #2b2b2b, #0c0c0c);
        box-shadow:
          0 0 0 1px rgba(255, 255, 255, 0.06),
          0 30px 70px rgba(0, 0, 0, 0.45);
        position: relative;
      }

      /* The notch. Purely so the shape reads as a phone rather than a rounded rectangle. */
      .phone::before {
        content: '';
        position: absolute;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        width: 92px;
        height: 20px;
        border-radius: 0 0 12px 12px;
        background: #0c0c0c;
        z-index: 2;
      }

      .screen {
        position: relative;
        height: 100%;
        border-radius: 26px;
        overflow: hidden;
        background: radial-gradient(120% 90% at 50% 0%, #241a3d 0%, #0b0b12 60%, #050507 100%);
      }

      .graph {
        width: 100%;
        height: 100%;
        display: block;
      }

      .bloom {
        opacity: 0.32;
        animation: drift 14s var(--ease, ease-in-out) infinite alternate;
      }

      .b2 {
        animation-delay: -7s;
      }

      @keyframes drift {
        from {
          transform: translate(0, 0);
        }
        to {
          transform: translate(14px, -18px);
        }
      }

      /* Each edge is its own length, so they are all given a dash long enough for the longest of them
         and simply drawn from nothing to full. Exactness is not worth a measurement here. */
      .edge {
        stroke-dasharray: 200;
        stroke-dashoffset: 200;
        animation: draw 12s var(--ease, ease-out) infinite;
      }

      .e1 { animation-delay: 0.4s; }
      .e2 { animation-delay: 0.7s; }
      .e3 { animation-delay: 1s; }
      .e4 { animation-delay: 1.3s; }
      .e5 { animation-delay: 1.6s; }
      .e6 { animation-delay: 1.9s; }
      .e7 { animation-delay: 2.2s; }

      @keyframes draw {
        0% { stroke-dashoffset: 200; opacity: 0; }
        6% { opacity: 0.85; }
        22% { stroke-dashoffset: 0; opacity: 0.85; }
        88% { stroke-dashoffset: 0; opacity: 0.85; }
        100% { stroke-dashoffset: 0; opacity: 0; }
      }

      /* The route runs late in the loop, once the graph it travels over has finished drawing. */
      .hop {
        stroke-dasharray: 200;
        stroke-dashoffset: 200;
        opacity: 0;
        animation: trace 12s var(--ease, ease-in-out) infinite;
        filter: drop-shadow(0 0 6px rgba(255, 255, 255, 0.65));
      }

      .h1 { animation-delay: 6.4s; }
      .h2 { animation-delay: 6.9s; }

      @keyframes trace {
        0%, 4% { stroke-dashoffset: 200; opacity: 0; }
        12% { opacity: 1; }
        20% { stroke-dashoffset: 0; opacity: 1; }
        40% { stroke-dashoffset: 0; opacity: 1; }
        52% { stroke-dashoffset: 0; opacity: 0; }
        100% { stroke-dashoffset: 0; opacity: 0; }
      }

      .node {
        opacity: 0;
        transform-box: fill-box;
        transform-origin: center;
        animation: pop 12s var(--ease, ease-out) infinite;
      }

      .n1 { animation-delay: 0.1s; }
      .n2 { animation-delay: 0.5s; }
      .n3 { animation-delay: 0.8s; }
      .n4 { animation-delay: 1.4s; }
      .n5 { animation-delay: 1.7s; }
      .n6 { animation-delay: 2s; }

      @keyframes pop {
        0% { opacity: 0; transform: scale(0.2); }
        5% { opacity: 1; transform: scale(1.25); }
        9% { transform: scale(1); }
        90% { opacity: 1; transform: scale(1); }
        100% { opacity: 0; transform: scale(1); }
      }

      .captions {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 34px;
        text-align: center;
        padding: 0 22px;
        height: 34px;
      }

      .cap {
        position: absolute;
        left: 22px;
        right: 22px;
        opacity: 0;
        color: #fff;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.2px;
        animation: caption 12s var(--ease, ease-in-out) infinite;
      }

      .c1 { animation-delay: 0.6s; }
      .c2 { animation-delay: 4.6s; }
      .c3 { animation-delay: 8s; }

      @keyframes caption {
        0% { opacity: 0; transform: translateY(6px); }
        4% { opacity: 1; transform: translateY(0); }
        26% { opacity: 1; transform: translateY(0); }
        32% { opacity: 0; transform: translateY(-6px); }
        100% { opacity: 0; transform: translateY(-6px); }
      }

      /* Nothing here is information, so somebody who has asked for stillness simply gets the last
         frame of it rather than a version that moves more slowly. */
      @media (prefers-reduced-motion: reduce) {
        .bloom,
        .edge,
        .hop,
        .node,
        .cap {
          animation: none;
        }

        .edge,
        .node {
          opacity: 1;
          stroke-dashoffset: 0;
        }

        .hop {
          opacity: 1;
          stroke-dashoffset: 0;
        }

        .c1 {
          opacity: 1;
        }
      }
    `,
  ],
})
export class AuthShowcaseComponent {}
