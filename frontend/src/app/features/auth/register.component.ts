import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { UsernameAvailability } from '../../core/models';
import { Toasts } from '../../core/toast.service';
import { AuthShowcaseComponent } from './auth-showcase.component';
import { scorePassword } from '../../shared/password-strength';
import { authStyles } from './auth.styles';

/** Which of the three screens is showing. */
type Step = 'details' | 'code' | 'done';

/**
 * Signing up, in three screens: your details, the six digits we emailed you, and a hand-off to the
 * login page.
 *
 * <p>
 * The order matters and is not cosmetic. The address is confirmed <em>before</em> the account exists,
 * so an unconfirmed address never becomes a row in <c>Users</c> — which is what makes "one account per
 * email" a fact about the database rather than a promise in a form. See <c>AuthService</c>.
 * </p>
 *
 * <p>
 * Validation happens twice on purpose. Everything here is also checked on the server, because a rule
 * enforced only in a browser is not enforced; the copy here exists so somebody finds out about a taken
 * username while they are still typing it rather than after filling in five more fields.
 * </p>
 */
@Component({
  selector: 'app-register',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AuthShowcaseComponent],
  template: `
    <div class="col" style="align-items:center;width:100%">
      <div class="stage">
        <div class="showcase"><app-auth-showcase /></div>

        <div class="wrap">
          <div class="panel">
            @switch (step()) {
              <!-- ------------------------------------------------------ details -->
              @case ('details') {
                <h1 class="wordmark">InstaGraph</h1>
                <span class="kicker">Sign up to see photos from the people you follow.</span>

                <form (ngSubmit)="sendCode()">
                  <label class="field">
                    <input
                      class="input"
                      name="email"
                      type="email"
                      placeholder=" "
                      autocomplete="email"
                      autocapitalize="none"
                      spellcheck="false"
                      [ngModel]="email()"
                      (ngModelChange)="email.set($event.trim())" />
                    <span class="label">Email address</span>
                  </label>
                  @if (touched() && emailProblem(); as message) {
                    <p class="field-error">{{ message }}</p>
                  }

                  <label class="field">
                    <input
                      class="input"
                      name="password"
                      [type]="reveal() ? 'text' : 'password'"
                      placeholder=" "
                      autocomplete="new-password"
                      [ngModel]="password()"
                      (ngModelChange)="password.set($event)" />
                    <span class="label">Password</span>

                    @if (password().length > 0) {
                      <button type="button" class="peek" (click)="reveal.set(!reveal())">
                        {{ reveal() ? 'Hide' : 'Show' }}
                      </button>
                    }
                  </label>

                  <!-- Four segments that fill as the password gets harder, rather than a rule nobody
                       reads. The label under it says the one thing still missing. -->
                  @if (password().length > 0) {
                    <div class="meter" [attr.data-score]="strength().score">
                      @for (bar of [0, 1, 2, 3]; track bar) {
                        <span [class.on]="strength().score > bar"></span>
                      }
                    </div>
                    <p class="field-note" [class.bad]="!strength().acceptable">{{ strength().label }}</p>
                  }

                  <div class="dob">
                    <span class="group-label">Date of birth</span>
                    <div class="dob-row">
                      <select class="input" name="day" [ngModel]="day()" (ngModelChange)="day.set(+$event)">
                        <option [value]="0" disabled>Day</option>
                        @for (d of days(); track d) {
                          <option [value]="d">{{ d }}</option>
                        }
                      </select>

                      <select class="input" name="month" [ngModel]="month()" (ngModelChange)="month.set(+$event)">
                        <option [value]="0" disabled>Month</option>
                        @for (m of months; track m.value) {
                          <option [value]="m.value">{{ m.label }}</option>
                        }
                      </select>

                      <select class="input" name="year" [ngModel]="year()" (ngModelChange)="year.set(+$event)">
                        <option [value]="0" disabled>Year</option>
                        @for (y of years; track y) {
                          <option [value]="y">{{ y }}</option>
                        }
                      </select>
                    </div>
                    @if (touched() && dobProblem(); as message) {
                      <p class="field-error">{{ message }}</p>
                    }
                  </div>

                  <label class="field">
                    <input
                      class="input"
                      name="fullName"
                      placeholder=" "
                      autocomplete="name"
                      maxlength="80"
                      [ngModel]="fullName()"
                      (ngModelChange)="fullName.set($event)" />
                    <span class="label">Full name</span>
                  </label>
                  @if (touched() && !fullName().trim()) {
                    <p class="field-error">Tell us your name.</p>
                  }

                  <label class="field">
                    <input
                      class="input"
                      name="username"
                      placeholder=" "
                      autocomplete="username"
                      autocapitalize="none"
                      spellcheck="false"
                      maxlength="30"
                      [ngModel]="username()"
                      (ngModelChange)="onUsername($event)" />
                    <span class="label">Username</span>

                    @if (checking()) {
                      <span class="peek muted">Checking…</span>
                    } @else if (availability()?.available) {
                      <span class="peek ok"><i class="bi bi-check-lg"></i></span>
                    }
                  </label>

                  @if (usernameProblem(); as message) {
                    <p class="field-error">{{ message }}</p>
                  }

                  <!-- Free variations on a taken name, from the server. One tap fills the field. -->
                  @if (availability()?.suggestions?.length) {
                    <div class="suggests">
                      @for (name of availability()!.suggestions; track name) {
                        <button type="button" class="chip" (click)="onUsername(name)">{{ name }}</button>
                      }
                    </div>
                  }

                  <p class="legal">
                    By tapping <strong>Sign up</strong>, you agree to our Terms, Privacy Policy and
                    Cookies Policy.
                  </p>

                  <button class="btn btn-block" type="submit" [disabled]="busy()">
                    {{ busy() ? 'Sending code…' : 'Sign up' }}
                  </button>

                  @if (error()) {
                    <p class="error">{{ error() }}</p>
                  }
                </form>
              }

              <!-- --------------------------------------------------------- code -->
              @case ('code') {
                <button type="button" class="back-link" (click)="backToDetails()" aria-label="Back">
                  <i class="bi bi-chevron-left"></i>
                </button>

                <h2 class="step-title">Enter the confirmation code</h2>
                <p class="step-sub">
                  To confirm your account, enter the 6-digit code that we've sent to
                  <strong>{{ email() }}</strong
                  >.
                </p>

                <!-- Honest rather than convenient: with no mail server configured, the code went to the
                     API's console, and saying so beats leaving somebody watching an inbox. -->
                @if (devCode(); as shown) {
                  <div class="dev-note">
                    <span class="eyebrow">No mail server configured</span>
                    <p>
                      The code was written to the API log instead of being emailed. It is
                      <strong class="dev-code">{{ shown }}</strong
                      >. Set <code>Email:SmtpHost</code> in <code>appsettings.json</code> to send for real.
                    </p>
                    <button type="button" class="chip" (click)="useDevCode()">Fill it in</button>
                  </div>
                }

                <form (ngSubmit)="verify()">
                  <label class="field">
                    <input
                      #codeInput
                      class="input code-input"
                      name="code"
                      inputmode="numeric"
                      autocomplete="one-time-code"
                      maxlength="6"
                      placeholder=" "
                      [ngModel]="code()"
                      (ngModelChange)="onCode($event)" />
                    <span class="label">Confirmation code</span>
                  </label>

                  <button class="btn btn-block" type="submit" [disabled]="code().length !== 6 || busy()">
                    {{ busy() ? 'Checking…' : 'Continue' }}
                  </button>

                  <!--
                    A disabled button that says nothing is indistinguishable from a broken one: you press
                    it, nothing happens, and the app has given you no way to find out why. This is the
                    sentence that was missing.
                  -->
                  @if (code().length !== 6 && !busy()) {
                    <p class="await-code">
                      {{
                        code().length === 0
                          ? 'Enter the 6-digit code above to continue.'
                          : 'That is ' + code().length + ' of 6 digits.'
                      }}
                    </p>
                  }

                  <button
                    type="button"
                    class="btn btn-secondary btn-block mt-8"
                    [disabled]="cooldown() > 0 || busy()"
                    (click)="resend()">
                    {{ cooldown() > 0 ? 'Ask again in ' + cooldown() + 's' : "I didn't get the code" }}
                  </button>

                  @if (error()) {
                    <p class="error">{{ error() }}</p>
                  }
                </form>

                <a class="already" routerLink="/login">I already have an account</a>
              }

              <!-- --------------------------------------------------------- done -->
              @case ('done') {
                <span class="done-ring"><i class="bi bi-check-lg"></i></span>
                <h2 class="step-title center">You're on InstaGraph</h2>
                <p class="step-sub center">
                  <strong>{{ '@' + username() }}</strong> is yours. Log in to start following people —
                  your feed is built from the accounts you follow, so it begins empty on purpose.
                </p>

                <a class="btn btn-block" [routerLink]="['/login']" [queryParams]="{ u: username() }">
                  Log in
                </a>
              }
            }
          </div>

          @if (step() === 'details') {
            <div class="alt">
              Have an account?
              <a class="strong" style="color:var(--accent)" routerLink="/login">Log in</a>
            </div>
          }
        </div>
      </div>

      <footer class="foot">
        <nav>
          <span>About</span>
          <span>Help</span>
          <span>API</span>
          <span>Privacy</span>
          <span>Terms</span>
          <span>Locations</span>
        </nav>
        <span>English (UK) · © {{ thisYear }} InstaGraph</span>
      </footer>
    </div>
  `,
  styles: [
    authStyles,
    `
      .field-error {
        color: var(--danger);
        font-size: 12px;
        line-height: 1.4;
        margin: -2px 0 10px;
        text-align: left;
      }

      .field-note {
        font-size: 12px;
        color: var(--ink-3);
        margin: 2px 0 10px;
        text-align: left;
      }

      .field-note.bad {
        color: var(--ink-3);
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

      /* --------------------------------------------------------- date of birth */

      .dob {
        margin-bottom: 10px;
      }

      .group-label {
        display: block;
        font-size: 12px;
        font-weight: 700;
        color: var(--ink-3);
        text-align: left;
        margin: 6px 0 6px 2px;
      }

      .dob-row {
        display: grid;
        grid-template-columns: 1fr 1.3fr 1fr;
        gap: 8px;
      }

      .dob-row .input {
        height: 46px;
        padding: 0 10px;
        font-size: 13px;
        appearance: none;
        background-image: linear-gradient(45deg, transparent 50%, var(--ink-3) 50%),
          linear-gradient(135deg, var(--ink-3) 50%, transparent 50%);
        background-position: calc(100% - 16px) 21px, calc(100% - 11px) 21px;
        background-size: 5px 5px, 5px 5px;
        background-repeat: no-repeat;
      }

      /* ------------------------------------------------------------ username */

      .peek.ok {
        color: #2ecc71;
      }

      .peek.muted {
        color: var(--ink-3);
        font-size: 12px;
      }

      .suggests {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 0 0 12px;
      }

      .suggests .chip {
        font-size: 12px;
        padding: 5px 11px;
      }

      .legal {
        font-size: 11px;
        line-height: 1.5;
        color: var(--ink-3);
        margin: 14px 0 0;
      }

      /* --------------------------------------------------------- code screen */

      .back-link {
        display: block;
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 20px;
        padding: 0;
        margin-bottom: 10px;
        text-align: left;
        width: 100%;
      }

      .step-title {
        font-family: var(--display);
        font-size: 24px;
        font-weight: 800;
        letter-spacing: -0.03em;
        margin: 0 0 6px;
        text-align: left;
      }

      .step-sub {
        font-size: 14px;
        line-height: 1.5;
        color: var(--ink-3);
        margin: 0 0 20px;
        text-align: left;
      }

      .step-title.center,
      .step-sub.center {
        text-align: center;
      }

      .code-input {
        letter-spacing: 8px;
        font-size: 18px !important;
        font-weight: 700;
      }

      .already {
        display: block;
        margin-top: 20px;
        font-size: 14px;
        font-weight: 700;
        color: var(--accent);
      }

      .dev-note {
        border: 1px dashed color-mix(in srgb, var(--accent) 50%, transparent);
        background: color-mix(in srgb, var(--accent) 8%, transparent);
        border-radius: var(--radius);
        padding: 12px 14px;
        margin-bottom: 18px;
        text-align: left;
      }

      .dev-note p {
        margin: 4px 0 10px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--ink-2);
      }

      .dev-note code {
        font-family: ui-monospace, monospace;
        font-size: 11px;
      }

      .dev-code {
        font-family: ui-monospace, monospace;
        font-size: 15px;
        letter-spacing: 2px;
      }

      /* ---------------------------------------------------------- done screen */

      .done-ring {
        width: 74px;
        height: 74px;
        border-radius: 50%;
        margin: 6px auto 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        background: var(--brand);
        color: var(--brand-ink);
        box-shadow: 0 14px 34px -14px var(--glow);
      }

      .mt-8 {
        margin-top: 8px;
      }
    `,
  ],
})
export class RegisterComponent implements OnDestroy {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);

  protected readonly step = signal<Step>('details');

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly fullName = signal('');
  protected readonly username = signal('');
  protected readonly day = signal(0);
  protected readonly month = signal(0);
  protected readonly year = signal(0);

  protected readonly code = signal('');
  protected readonly devCode = signal<string | null>(null);
  private verificationToken = '';

  protected readonly busy = signal(false);
  protected readonly reveal = signal(false);
  protected readonly error = signal('');

  /** Errors stay hidden until the first submit, so a blank form is not a wall of red. */
  protected readonly touched = signal(false);

  protected readonly checking = signal(false);
  protected readonly availability = signal<UsernameAvailability | null>(null);

  /** Seconds left before "I didn't get the code" does anything. */
  protected readonly cooldown = signal(0);
  private cooldownTimer?: ReturnType<typeof setInterval>;

  protected readonly thisYear = new Date().getFullYear();

  protected readonly months = [
    { value: 1, label: 'January' },
    { value: 2, label: 'February' },
    { value: 3, label: 'March' },
    { value: 4, label: 'April' },
    { value: 5, label: 'May' },
    { value: 6, label: 'June' },
    { value: 7, label: 'July' },
    { value: 8, label: 'August' },
    { value: 9, label: 'September' },
    { value: 10, label: 'October' },
    { value: 11, label: 'November' },
    { value: 12, label: 'December' },
  ];

  /** 13 is the floor the server enforces, so there is no point offering anything younger. */
  protected readonly years = Array.from({ length: 108 }, (_, i) => this.thisYear - 13 - i);

  /** February has 28 days in most years and 29 in some; the list follows the month and year chosen. */
  protected readonly days = computed(() => {
    const month = this.month();
    const year = this.year();
    const count = month === 0 ? 31 : new Date(year || 2000, month, 0).getDate();
    return Array.from({ length: count }, (_, i) => i + 1);
  });

  private readonly typedUsername = new Subject<string>();

  constructor() {
    // The code box exists only on the second step, so it cannot be focused at construction — this runs
    // when it appears.
    effect(() => this.codeInput()?.nativeElement.focus());

    // One request per pause in typing, never the same name twice, and always the newest answer:
    // switchMap drops an in-flight check when another keystroke arrives.
    this.typedUsername
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        switchMap((name) => this.api.usernameAvailable(name)),
      )
      .subscribe({
        next: (result) => {
          this.checking.set(false);

          // A late answer for a name that has since been edited must not overwrite the field's state.
          if (result.username === this.username()) this.availability.set(result);
        },
        error: () => this.checking.set(false),
      });

    // A day that no longer exists — 31 February, 29 February in a common year — is cleared rather than
    // silently rolled forward into March.
    effect(() => {
      const max = this.days().length;
      if (this.day() > max) this.day.set(0);
    });
  }

  ngOnDestroy() {
    clearInterval(this.cooldownTimer);
  }

  // ------------------------------------------------------------------ validation

  protected readonly emailProblem = computed(() => {
    const value = this.email();
    if (!value) return 'Enter your email address.';

    // Deliberately loose. The only test that actually proves an address works is sending to it, which
    // is the next thing this form does.
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? '' : 'That does not look like an email address.';
  });

  protected readonly dobProblem = computed(() => {
    if (!this.day() || !this.month() || !this.year()) return 'Enter your date of birth.';
    return '';
  });

  protected readonly usernameProblem = computed(() => {
    const name = this.username();
    if (!name) return this.touched() ? 'Pick a username.' : '';

    if (!/^[a-z0-9._]{3,30}$/.test(name)) {
      return 'Usernames are 3–30 characters: lower-case letters, numbers, dots and underscores.';
    }

    const checked = this.availability();
    return checked && checked.username === name && !checked.available ? (checked.reason ?? '') : '';
  });

  /**
   * A score out of four and the one thing still missing, from the shared rule in
   * `shared/password-strength`. It used to be written out here; it is written out nowhere now, because
   * the reset screen and the settings screen ask the same question and three copies of a rule is three
   * chances for one of them to disagree with the server.
   */
  protected readonly strength = computed(() => scorePassword(this.password(), this.username()));

  private detailsValid(): boolean {
    return (
      !this.emailProblem() &&
      !this.dobProblem() &&
      !!this.fullName().trim() &&
      !this.usernameProblem() &&
      /^[a-z0-9._]{3,30}$/.test(this.username()) &&
      this.strength().acceptable
    );
  }

  // ---------------------------------------------------------------------- typing

  protected onUsername(value: string) {
    const name = value.toLowerCase().replace(/[^a-z0-9._]/g, '');
    this.username.set(name);
    this.availability.set(null);

    if (/^[a-z0-9._]{3,30}$/.test(name)) {
      this.checking.set(true);
      this.typedUsername.next(name);
    } else {
      this.checking.set(false);
    }
  }

  /**
   * Puts the caret in the code box as soon as the step appears.
   *
   * <p>
   * Worth doing deliberately: the screen arrives with one thing to do and a button that cannot be
   * pressed until it is done, so landing anywhere other than that field is landing in the wrong place.
   * </p>
   */
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected onCode(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6);

    this.code.set(digits);
    this.error.set('');

    // Six digits is the whole form. Asking for a second gesture to submit a field that cannot hold
    // anything else is asking somebody to confirm they meant to finish typing.
    if (digits.length === 6 && !this.busy()) {
      this.verify();
    }
  }

  // ----------------------------------------------------------------- step one

  protected sendCode() {
    this.touched.set(true);
    this.error.set('');

    if (!this.detailsValid() || this.busy()) {
      // Nothing else to say: every field that is wrong is already saying so under itself.
      if (!this.strength().acceptable && this.password()) this.error.set(this.strength().label);
      return;
    }

    this.busy.set(true);

    this.api.startSignUp(this.email()).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.devCode.set(result.devCode);
        this.code.set('');
        this.step.set('code');
        this.startCooldown(result.resendInSeconds);
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err.error?.message ?? 'Could not send a code to that address.');
      },
    });
  }

  protected backToDetails() {
    this.step.set('details');
    this.error.set('');
  }

  // ----------------------------------------------------------------- step two

  protected verify() {
    if (this.code().length !== 6 || this.busy()) return;

    this.busy.set(true);
    this.error.set('');

    this.api.verifyCode(this.email(), this.code()).subscribe({
      next: (result) => {
        this.verificationToken = result.verificationToken;
        this.createAccount();
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err.error?.message ?? 'That code did not work.');
      },
    });
  }

  protected resend() {
    if (this.cooldown() > 0 || this.busy()) return;

    this.busy.set(true);
    this.error.set('');

    this.api.resendCode(this.email()).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.devCode.set(result.devCode);
        this.startCooldown(result.resendInSeconds);
        this.toasts.show(result.delivered ? 'A new code is on its way.' : 'A new code is in the API log.');
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err.error?.message ?? 'Could not send another code.');
      },
    });
  }

  protected useDevCode() {
    const shown = this.devCode();

    // Through onCode rather than straight at the signal, so filling the box does the same thing as
    // typing into it — including submitting once the sixth digit is there. Setting the signal directly
    // filled the field and then sat there waiting for a press, which is the one thing this button
    // exists to save somebody.
    if (shown) this.onCode(shown);
  }

  private startCooldown(seconds: number) {
    clearInterval(this.cooldownTimer);
    this.cooldown.set(seconds);

    this.cooldownTimer = setInterval(() => {
      this.cooldown.update((left) => Math.max(0, left - 1));
      if (this.cooldown() === 0) clearInterval(this.cooldownTimer);
    }, 1000);
  }

  // --------------------------------------------------------------- step three

  /**
   * Runs straight off a successful verify rather than behind another button. The account details were
   * filled in two screens ago; making somebody press "create" again would be asking them to confirm a
   * decision they have not been given any new information about.
   */
  private createAccount() {
    this.auth
      .register({
        username: this.username(),
        email: this.email(),
        password: this.password(),
        fullName: this.fullName().trim(),
        dateOfBirth: this.isoDob(),
        verificationToken: this.verificationToken,
      })
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.step.set('done');

          // The password is out of memory the moment it is no longer needed.
          this.password.set('');
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(err.error?.message ?? 'Could not create that account.');

          // A rejected username or email is a problem with the first screen, so that is where to go.
          const message: string = err.error?.message ?? '';
          if (/username|email/i.test(message)) {
            this.step.set('details');
            this.availability.set(null);
          }
        },
      });
  }

  /** yyyy-MM-dd, built by hand — toISOString would shift the date by the browser's offset. */
  private isoDob(): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${this.year()}-${pad(this.month())}-${pad(this.day())}`;
  }
}
