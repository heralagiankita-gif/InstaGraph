import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { Api } from '../core/api.service';
import { Profile } from '../core/models';
import { Toasts } from '../core/toast.service';
import { VibeService } from '../core/vibe.service';

/**
 * A profile as a card worth screenshotting: the gradient of the current vibe, the avatar, the handle,
 * three numbers and the link.
 *
 * <p>
 * The card on screen is HTML, and the download is a second copy of it painted onto a canvas at 2×.
 * Drawing it twice is deliberate — rasterising a live DOM node needs either an
 * <code>&lt;foreignObject&gt;</code> round trip, which taints the canvas as soon as the avatar comes
 * from another origin, or a third-party library. The layout is simple enough that a hundred lines of
 * canvas calls is the cheaper answer, and it means the download is pixel-identical on every browser
 * rather than "whatever that browser renders SVG text as".
 * </p>
 */
@Component({
  selector: 'app-profile-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="wrap" (click)="$event.stopPropagation()">
        <div
          class="card"
          [style.background]="paint()"
          [style.color]="vibes.current().ink"
          [style.--scrim]="scrim()">
          <div class="glare"></div>

          <div class="top">
            <span class="mark">InstaGraph</span>
            <span class="vibe">{{ vibes.current().name }}</span>
          </div>

          <div class="face">
            @if (avatar()) {
              <img [src]="avatar()!" [alt]="user().username" />
            } @else {
              <span class="initials">{{ initials() }}</span>
            }
          </div>

          <div class="who">
            <span class="handle">{{ '@' + user().username }}</span>
            @if (user().fullName) {
              <span class="name">{{ user().fullName }}</span>
            }
          </div>

          <div class="stats">
            <span class="stat">
              <b>{{ short(user().postCount) }}</b>
              <em>posts</em>
            </span>
            <span class="stat">
              <b>{{ short(user().followerCount) }}</b>
              <em>followers</em>
            </span>
            <span class="stat">
              <b>{{ short(user().friendCount) }}</b>
              <em>friends</em>
            </span>
          </div>

          <div class="foot">{{ shortLink() }}</div>
        </div>

        <div class="controls">
          <button type="button" class="btn btn-brand" (click)="download()" [disabled]="working()">
            <i class="bi bi-download"></i> {{ working() ? 'Rendering…' : 'Save as image' }}
          </button>
          <button type="button" class="btn btn-secondary" (click)="copy()">
            <i class="bi bi-link-45deg"></i> Copy link
          </button>
          <button type="button" class="btn btn-secondary" (click)="close.emit()">Done</button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 18px;
      }

      .card {
        position: relative;
        overflow: hidden;
        width: 320px;
        height: 480px;
        border-radius: 30px;
        padding: 26px 24px 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        box-shadow: 0 30px 70px -20px rgba(0, 0, 0, 0.6);
        animation: lift 0.3s var(--spring);
      }

      /* The diagonal sheen that stops a flat gradient reading as a coloured rectangle. */
      .glare {
        position: absolute;
        inset: 0;
        background: linear-gradient(115deg, rgba(255, 255, 255, 0.34) 0%, transparent 42%),
          radial-gradient(60% 40% at 50% 105%, rgba(0, 0, 0, 0.3), transparent);
        pointer-events: none;
      }

      .top {
        position: relative;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .mark {
        font-family: 'Grand Hotel', cursive;
        font-size: 25px;
        line-height: 1;
      }

      .vibe {
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        padding: 5px 10px;
        border-radius: 999px;
        background: color-mix(in srgb, currentColor 16%, transparent);
      }

      .face {
        position: relative;
        margin-top: 42px;
        width: 132px;
        height: 132px;
        border-radius: 50%;
        overflow: hidden;
        border: 4px solid color-mix(in srgb, currentColor 22%, rgba(255, 255, 255, 0.7));
        background: var(--scrim);
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 14px 34px -12px rgba(0, 0, 0, 0.55);
      }

      .face img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .initials {
        font-family: var(--display);
        font-size: 46px;
        font-weight: 800;
      }

      .who {
        position: relative;
        margin-top: 20px;
        text-align: center;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-width: 100%;
      }

      .handle {
        font-family: var(--display);
        font-size: 25px;
        font-weight: 800;
        letter-spacing: -0.03em;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .name {
        font-size: 13px;
        opacity: 0.85;
      }

      .stats {
        position: relative;
        margin-top: auto;
        width: 100%;
        display: flex;
        border-radius: 18px;
        background: color-mix(in srgb, currentColor 14%, transparent);
        padding: 12px 0;
      }

      .stat {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1px;
      }

      .stat + .stat {
        border-left: 1px solid color-mix(in srgb, currentColor 24%, transparent);
      }

      .stat b {
        font-family: var(--display);
        font-size: 19px;
        font-weight: 800;
        letter-spacing: -0.02em;
      }

      .stat em {
        font-style: normal;
        font-size: 10px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        opacity: 0.85;
      }

      .foot {
        position: relative;
        margin-top: 14px;
        font-size: 11px;
        letter-spacing: 0.06em;
        opacity: 0.85;
      }

      .controls {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        justify-content: center;
      }
    `,
  ],
})
export class ProfileCardComponent {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  protected readonly vibes = inject(VibeService);

  readonly user = input.required<Profile>();
  readonly close = output<void>();

  protected readonly working = signal(false);

  protected readonly avatar = computed(() => this.api.imageUrl(this.user().avatarUrl));

  protected readonly initials = computed(() =>
    this.user()
      .username.split(/[._]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join(''),
  );

  /**
   * What goes behind the initials when there is no avatar: a wash in the opposite direction to the ink,
   * so the two letters have something to sit on whichever way round the vibe is.
   */
  protected scrim(): string {
    return this.vibes.current().ink === '#ffffff' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.55)';
  }

  /** The gradient is read from the vibe's own stops, so the card matches the app it was made in. */
  protected paint(): string {
    const [a, b, c] = this.vibes.current().stops;
    return `linear-gradient(150deg, ${a} 0%, ${b} 52%, ${c} 100%)`;
  }

  protected link(): string {
    return `${location.origin}/${this.user().username}`;
  }

  /** What goes on the card: the host without its scheme, which is how a link is written on a poster. */
  protected shortLink(): string {
    return `${location.host}/${this.user().username}`;
  }

  protected short(value: number): string {
    if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
    if (value >= 1_000) return `${trim(value / 1_000)}K`;
    return String(value);
  }

  protected copy() {
    navigator.clipboard
      .writeText(this.link())
      .then(() => this.toasts.show('Link copied.'))
      .catch(() => this.toasts.error('Could not copy that link.'));
  }

  /** Paints the card at 2× and hands the file over. */
  protected async download() {
    if (this.working()) return;
    this.working.set(true);

    try {
      const blob = await this.render();
      if (!blob) throw new Error('render failed');

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `instagraph-${this.user().username}.png`;
      anchor.click();

      // Revoked on the next tick rather than immediately: Safari has not finished with the URL when
      // click() returns.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      this.toasts.error('Could not build that image.');
    } finally {
      this.working.set(false);
    }
  }

  private async render(): Promise<Blob | null> {
    const scale = 2;
    const w = 320;
    const h = 480;

    const canvas = document.createElement('canvas');
    canvas.width = w * scale;
    canvas.height = h * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.scale(scale, scale);

    const user = this.user();
    const vibe = this.vibes.current();
    const [c1, c2, c3] = vibe.stops;
    const ink = vibe.ink;

    // Background, matching the 150deg of the CSS closely enough that the two read as the same card.
    const gradient = ctx.createLinearGradient(0, 0, w * 0.55, h);
    gradient.addColorStop(0, c1);
    gradient.addColorStop(0.52, c2);
    gradient.addColorStop(1, c3);

    roundRect(ctx, 0, 0, w, h, 30);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.save();
    ctx.clip();

    // The sheen.
    const sheen = ctx.createLinearGradient(0, 0, w, h * 0.6);
    sheen.addColorStop(0, 'rgba(255,255,255,0.34)');
    sheen.addColorStop(0.42, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = ink;
    ctx.textBaseline = 'alphabetic';

    // Wordmark.
    ctx.font = "25px 'Grand Hotel', cursive";
    ctx.textAlign = 'left';
    ctx.fillText('InstaGraph', 24, 44);

    // Vibe pill.
    const label = this.vibes.current().name.toUpperCase();
    ctx.font = "800 10px 'Plus Jakarta Sans', sans-serif";
    const pillW = ctx.measureText(label).width + 20;
    roundRect(ctx, w - 24 - pillW, 26, pillW, 22, 11);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.fillText(label, w - 24 - pillW / 2, 41);

    // Avatar, or initials when there is not one.
    const cx = w / 2;
    const cy = 154;
    const r = 66;

    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill();

    const image = await this.loadAvatar();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    if (image) {
      // cover, not stretch: the shorter side fills the circle and the rest is cropped.
      const side = Math.min(image.width, image.height);
      ctx.drawImage(
        image,
        (image.width - side) / 2,
        (image.height - side) / 2,
        side,
        side,
        cx - r,
        cy - r,
        r * 2,
        r * 2,
      );
    } else {
      ctx.fillStyle = this.scrim();
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.fillStyle = ink;
      ctx.font = "800 46px 'Bricolage Grotesque', 'Plus Jakarta Sans', sans-serif";
      ctx.textAlign = 'center';
      ctx.fillText(this.initials(), cx, cy + 16);
    }

    ctx.restore();

    // Handle and name.
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.font = "800 25px 'Bricolage Grotesque', 'Plus Jakarta Sans', sans-serif";
    ctx.fillText(ellipsis(ctx, `@${user.username}`, w - 56), cx, 262);

    if (user.fullName) {
      ctx.globalAlpha = 0.85;
      ctx.font = "500 13px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText(ellipsis(ctx, user.fullName, w - 56), cx, 282);
      ctx.globalAlpha = 1;
    }

    // The three numbers.
    const boxY = 372;
    const boxH = 62;
    roundRect(ctx, 24, boxY, w - 48, boxH, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();

    const cells: Array<[string, string]> = [
      [this.short(user.postCount), 'POSTS'],
      [this.short(user.followerCount), 'FOLLOWERS'],
      [this.short(user.friendCount), 'FRIENDS'],
    ];

    const cellW = (w - 48) / 3;

    cells.forEach(([value, caption], i) => {
      const x = 24 + cellW * i + cellW / 2;

      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(24 + cellW * i, boxY + 12);
        ctx.lineTo(24 + cellW * i, boxY + boxH - 12);
        ctx.strokeStyle = 'rgba(255,255,255,0.24)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.fillStyle = ink;
      ctx.font = "800 19px 'Bricolage Grotesque', 'Plus Jakarta Sans', sans-serif";
      ctx.fillText(value, x, boxY + 28);

      ctx.globalAlpha = 0.85;
      ctx.font = "700 10px 'Plus Jakarta Sans', sans-serif";
      ctx.fillText(caption, x, boxY + 45);
      ctx.globalAlpha = 1;
    });

    // The link along the bottom.
    ctx.globalAlpha = 0.85;
    ctx.font = "600 11px 'Plus Jakarta Sans', sans-serif";
    ctx.fillText(ellipsis(ctx, this.shortLink(), w - 48), cx, 458);
    ctx.globalAlpha = 1;

    ctx.restore();

    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  /**
   * The avatar, or null.
   *
   * <p>
   * crossOrigin is set before the src so the API's CORS headers are honoured; without it a
   * cross-origin picture would load fine and then taint the canvas, and toBlob would throw at the very
   * end. A picture that will not load this way is not worth failing the whole card over — the initials
   * are drawn instead.
   * </p>
   */
  private loadAvatar(): Promise<HTMLImageElement | null> {
    const src = this.avatar();
    if (!src) return Promise.resolve(null);

    return new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
  }
}

function trim(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
}

/** Canvas has no border-radius, and roundRect is still missing on enough browsers to be worth this. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Canvas will not wrap or clip text on its own; a 40-character name has to be cut by hand. */
function ellipsis(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;

  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) {
    cut = cut.slice(0, -1);
  }

  return `${cut}…`;
}
