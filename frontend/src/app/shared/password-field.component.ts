import { ChangeDetectionStrategy, Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PasswordStrength, scorePassword } from './password-strength';

/**
 * A password box: the floating label, the Show/Hide button that only appears once there is something to
 * reveal, and — when asked for — the four-segment meter under it.
 *
 * <p>
 * It exists because three screens now want exactly this and one of them already had it written out
 * inline. The meter is the part worth sharing: four bars that fill as the password gets harder, with a
 * line under them naming the one thing still missing, rather than a paragraph of rules nobody reads
 * before typing.
 * </p>
 *
 * <p>
 * The bar goes red rather than one-quarter full when the password would be refused. A meter that shows
 * a little progress on something the server is about to reject is describing the wrong axis: the
 * question at that point is not how strong it is but whether it is allowed at all.
 * </p>
 */
@Component({
  selector: 'app-password-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <label class="field">
      <input
        class="input"
        [name]="name()"
        [type]="reveal() ? 'text' : 'password'"
        placeholder=" "
        [autocomplete]="autocomplete()"
        [attr.maxlength]="120"
        [ngModel]="value()"
        (ngModelChange)="value.set($event)" />
      <span class="label">{{ label() }}</span>

      @if (value().length > 0) {
        <button
          type="button"
          class="peek"
          [attr.aria-label]="reveal() ? 'Hide password' : 'Show password'"
          (click)="reveal.set(!reveal())">
          {{ reveal() ? 'Hide' : 'Show' }}
        </button>
      }
    </label>

    @if (meter() && value().length > 0) {
      <div
        class="meter"
        [attr.data-score]="strength().score"
        role="meter"
        aria-label="Password strength"
        [attr.aria-valuenow]="strength().score"
        aria-valuemin="0"
        aria-valuemax="4">
        @for (bar of bars; track bar) {
          <span [class.on]="strength().score > bar"></span>
        }
      </div>
      <p class="note" [class.bad]="!strength().acceptable">{{ strength().label }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* Instagram's field: the placeholder is a label that shrinks into the top of the box once there
         is something in it. Done with :placeholder-shown rather than JavaScript, so it follows the
         input's real state — including autofill, which no keystroke handler ever hears about. */
      .field {
        position: relative;
        display: block;
        margin-bottom: 6px;
      }

      .field .input {
        width: 100%;
        background: color-mix(in srgb, var(--bg) 70%, transparent);
        border: 1px solid var(--border);
        border-radius: var(--radius);
        font-size: 13px;
        padding: 18px 14px 6px;
        height: 46px;
      }

      .field .label {
        position: absolute;
        left: 14px;
        top: 14px;
        font-size: 12px;
        color: var(--ink-3);
        pointer-events: none;
        transform-origin: left top;
        transition: transform 0.12s var(--ease), opacity 0.12s var(--ease);
      }

      .field .input:placeholder-shown:not(:focus) + .label {
        transform: translateY(0) scale(1);
      }

      .field .input:not(:placeholder-shown) + .label,
      .field .input:focus + .label {
        transform: translateY(-8px) scale(0.75);
      }

      .peek {
        position: absolute;
        right: 4px;
        top: 50%;
        transform: translateY(-50%);
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 13px;
        font-weight: 600;
        padding: 6px 8px;
      }

      /* ------------------------------------------------------- strength meter */

      .meter {
        display: flex;
        gap: 4px;
        margin: 6px 0 0;
      }

      .meter span {
        flex: 1;
        height: 4px;
        border-radius: 999px;
        background: var(--border);
        transition: background 0.2s var(--ease);
      }

      .meter[data-score='1'] span.on {
        background: #ed4956;
      }

      .meter[data-score='2'] span.on {
        background: #f5a623;
      }

      .meter[data-score='3'] span.on {
        background: #7cc576;
      }

      .meter[data-score='4'] span.on {
        background: #2ecc71;
      }

      .note {
        font-size: 12px;
        color: var(--ink-3);
        margin: 2px 0 10px;
        text-align: left;
      }
    `,
  ],
})
export class PasswordFieldComponent {
  /** Two-way, so the parent keeps the value in its own signal and this stays presentational. */
  readonly value = model.required<string>();

  readonly label = input('Password');
  readonly name = input('password');

  /** `new-password` on the screens that set one, `current-password` where one is being proved. */
  readonly autocomplete = input('new-password');

  /** Off for the box that only confirms a password already being scored above it. */
  readonly meter = input(true);

  /** Scored against this when the screen knows it, so "cannot contain your username" can be said. */
  readonly username = input('');

  protected readonly reveal = signal(false);
  protected readonly bars = [0, 1, 2, 3];

  readonly strength = computed<PasswordStrength>(() => scorePassword(this.value(), this.username()));
}
