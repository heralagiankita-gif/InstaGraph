import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { Vibe, VibeService } from '../core/vibe.service';
import { ThemeService } from '../core/theme.service';

/**
 * The vibe picker.
 *
 * <p>
 * Every swatch paints its own gradient from the stops on the {@link Vibe} rather than from custom
 * properties, because only the selected vibe's properties are in scope — a grid drawn from
 * <code>var(--brand)</code> would be seven copies of the same thing.
 * </p>
 *
 * <p>
 * Choosing applies immediately and does not close the sheet. Picking a colour is a thing people do by
 * looking, and a sheet that shuts on the first tap makes you reopen it to compare.
 * </p>
 */
@Component({
  selector: 'app-vibe-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal glass" style="max-width:460px" (click)="$event.stopPropagation()">
        <div class="head">
          <div class="col">
            <span class="eyebrow">Make it yours</span>
            <h3 class="title">Pick a vibe</h3>
          </div>
          <button type="button" class="x pop" (click)="close.emit()" aria-label="Close">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>

        <div class="grid" role="radiogroup" aria-label="Vibe">
          @for (v of vibes.all; track v.id; let i = $index) {
            <button
              type="button"
              class="swatch stagger"
              role="radio"
              [style.--i]="i"
              [attr.aria-checked]="vibes.vibe() === v.id"
              [class.on]="vibes.vibe() === v.id"
              (click)="vibes.set(v.id)">
              <span class="chipart" [style.background]="paint(v)">
                @if (vibes.vibe() === v.id) {
                  <i class="bi bi-check-lg"></i>
                }
              </span>
              <span class="col" style="min-width:0">
                <span class="name">{{ v.name }}</span>
                <span class="tiny muted ellipsis">{{ v.blurb }}</span>
              </span>
            </button>
          }
        </div>

        <div class="rows">
          <button
            type="button"
            class="switch-row"
            role="switch"
            [attr.aria-checked]="theme.isDark()"
            (click)="theme.setDark(!theme.isDark())">
            <i class="bi" [class.bi-moon-stars-fill]="theme.isDark()" [class.bi-sun-fill]="!theme.isDark()"></i>
            <span class="col grow" style="text-align:left">
              <span class="strong">Dark mode</span>
              <span class="tiny muted">Vibes work in either.</span>
            </span>
            <span class="switch" [attr.aria-checked]="theme.isDark()"></span>
          </button>

          <button
            type="button"
            class="switch-row"
            role="switch"
            [attr.aria-checked]="vibes.aura()"
            (click)="vibes.setAura(!vibes.aura())">
            <i class="bi bi-stars"></i>
            <span class="col grow" style="text-align:left">
              <span class="strong">Aura background</span>
              <span class="tiny muted">The colour drifting behind the page.</span>
            </span>
            <span class="switch" [attr.aria-checked]="vibes.aura()"></span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .head {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 22px 22px 6px;
      }

      .head .col {
        flex: 1;
      }

      .x {
        border: 0;
        background: var(--secondary);
        color: var(--ink);
        width: 32px;
        height: 32px;
        border-radius: 50%;
        flex: none;
        font-size: 13px;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
        padding: 16px 22px 4px;
      }

      .swatch {
        display: flex;
        align-items: center;
        gap: 11px;
        padding: 9px;
        border-radius: var(--radius);
        border: 1.5px solid var(--border);
        background: var(--surface);
        color: var(--ink);
        text-align: left;
        min-width: 0;
        transition: transform 0.18s var(--spring), border-color 0.14s var(--ease),
          box-shadow 0.18s var(--ease);
      }

      .swatch:hover {
        transform: translateY(-2px);
        border-color: var(--ink-4);
      }

      .swatch:active {
        transform: scale(0.97);
      }

      /* The selected one keeps its own gradient rather than the accent, so the row still reads as a
         set of seven options with one ticked rather than as one option in a different colour. */
      .swatch.on {
        border-color: transparent;
        box-shadow: 0 0 0 2px var(--accent), 0 10px 24px -12px var(--glow);
      }

      .chipart {
        width: 40px;
        height: 40px;
        border-radius: 13px;
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-size: 16px;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.28);
      }

      .name {
        font-weight: 700;
        font-size: 14px;
      }

      .ellipsis {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .rows {
        padding: 14px 22px 20px;
        display: grid;
        gap: 4px;
      }

      .switch-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--ink);
        padding: 10px 8px;
        border-radius: var(--radius);
        font-family: inherit;
        font-size: 14px;
      }

      .switch-row:hover {
        background: var(--hover);
      }

      .switch-row > i {
        font-size: 18px;
        width: 22px;
        flex: none;
        color: var(--accent);
      }

      @media (max-width: 480px) {
        .grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class VibeSheetComponent {
  protected readonly vibes = inject(VibeService);
  protected readonly theme = inject(ThemeService);

  readonly close = output<void>();

  /** The swatch fill. Same angle as --brand, so it matches what the app will actually look like. */
  protected paint(v: Vibe): string {
    return `linear-gradient(135deg, ${v.stops[0]} 0%, ${v.stops[1]} 50%, ${v.stops[2]} 100%)`;
  }
}
