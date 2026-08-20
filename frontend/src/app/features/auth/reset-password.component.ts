import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Toasts } from '../../core/toast.service';
import { PasswordFieldComponent } from '../../shared/password-field.component';
import { scorePassword } from '../../shared/password-strength';
import { AuthShowcaseComponent } from './auth-showcase.component';
import { authStyles } from './auth.styles';

type Step = 'identify' | 'code' | 'password' | 'done';

/**
 * Getting back in without the password.
 *
 * <p>
 * Three screens, deliberately the same three as signing up: who you are, the six digits, and then the
 * thing they authorise. It is the same mechanism pointed at the other end of an account's life, and
 * looking identical is the honest way to present that.
 * </p>
 *
 * <p>
 * The first screen never says whether the account exists. It cannot: an unauthenticated form that
 * confirms which usernames are real hands back exactly what the login screen refuses to say, and it is
 * the easier of the two to find. So it always advances to the code screen, and what comes back is a
 * masked address — enough to recognise your own inbox, useless for learning anybody else's.
 * </p>
 *
 * <p>
 * The last screen signs you straight in, because by then you have proved control of the address and
 * chosen a password; sending somebody to a login form to immediately retype what they just invented is
 * ceremony. Sign-up hands off to login for the opposite reason — there, the password is a minute old
 * and worth practising once.
 * </p>
 */
@Component({
  selector: 'app-reset-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AuthShowcaseComponent, PasswordFieldComponent],
  template: `
    <div class="col" style="align-items:center;width:100%">
      <div class="stage">
        <div class="showcase"><app-auth-showcase /></div>

        <div class="wrap">
          <div class="panel">
            @switch (step()) {
              <!-- ----------------------------------------------------- identify -->
              @case ('identify') {
                <span class="lock-ring"><i class="bi bi-shield-lock"></i></span>

                <h2 class="step-title center">Trouble logging in?</h2>
                <p class="step-sub center">
                  Enter your username or the email address you signed up with, and we'll send you a code
                  to get back into your account.
                </p>

                <form (ngSubmit)="start()">
                  <label class="field">
                    <input
                      class="input"
                      name="login"
                      placeholder=" "
                      autocomplete="username"
                      autocapitalize="none"
                      spellcheck="false"
                      maxlength="160"
                      [ngModel]="loginId()"
                      (ngModelChange)="loginId.set($event)" />
                    <span class="label">Username or email</span>
                  </label>

                  <button class="btn btn-block" type="submit" [disabled]="!canStart() || busy()">
                    {{ busy() ? 'Sending…' : 'Send code' }}
                  </button>

                  @if (error()) {
                    <p class="error">{{ error() }}</p>
                  }
                </form>

                <div class="divider">OR</div>

                <a class="row center gap-8 strong small" routerLink="/register">
                  <i class="bi bi-person-plus"></i> Create a new account
                </a>
              }

              <!-- --------------------------------------------------------- code -->
              @case ('code') {
                <button type="button" class="back-link" (click)="step.set('identify')" aria-label="Back">
                  <i class="bi bi-chevron-left"></i>
                </button>

                <h2 class="step-title">Enter the code we sent</h2>

                <!--
                  Careful wording. "If an account matches" rather than "we sent it to", because the
                  server will not tell this screen whether one did, and a sentence that asserts more
                  than the app knows is a sentence that will one day be wrong in a way that matters.
                -->
                <p class="step-sub">
                  If an account matches <strong>{{ loginId() }}</strong
                  >, a six-digit code is on its way to <strong>{{ maskedEmail() }}</strong
                  >.
                </p>

                @if (devCode(); as shown) {
                  <div class="dev-note">
                    <span class="eyebrow">No mail server configured</span>
                    <p>
                      The code went to the API log instead of an inbox. It is
                      <strong class="dev-code">{{ shown }}</strong
                      >. Set <code>Email:SmtpHost</code> in <code>appsettings.json</code> to send for real.
                    </p>
                    <button type="button" class="chip" (click)="onCode(shown)">Fill it in</button>
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

                <a class="already" routerLink="/login">Back to logging in</a>
              }

              <!-- ----------------------------------------------------- password -->
              @case ('password') {
                <h2 class="step-title">Choose a new password</h2>
                <p class="step-sub">
                  Pick something you have not used here before. Setting it will sign you out everywhere
                  else — which is the point, if somebody else knew the old one.
                </p>

                <form (ngSubmit)="finish()">
                  <app-password-field
                    [(value)]="password"
                    label="New password"
                    name="newPassword"
                    [username]="usernameHint()" />

                  <app-password-field
                    [(value)]="confirm"
                    label="Confirm new password"
                    name="confirmPassword"
                    [meter]="false" />

                  @if (confirm().length > 0 && confirm() !== password()) {
                    <p class="field-error">Those two do not match.</p>
                  }

                  <button class="btn btn-block" type="submit" [disabled]="!canFinish() || busy()">
                    {{ busy() ? 'Saving…' : 'Change password' }}
                  </button>

                  @if (error()) {
                    <p class="error">{{ error() }}</p>
                  }
                </form>
              }

              <!-- --------------------------------------------------------- done -->
              @case ('done') {
                <span class="done-ring"><i class="bi bi-check-lg"></i></span>
                <h2 class="step-title center">Your password is changed</h2>
                <p class="step-sub center">
                  You're signed in here, and signed out of every other browser that was using the old
                  one.
                </p>

                <a class="btn btn-block" routerLink="/">Go to your feed</a>
              }
            }
          </div>

          @if (step() === 'identify') {
            <div class="alt">
              Remembered it?
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
        <span>English (UK) · © {{ year }} InstaGraph</span>
      </footer>
    </div>
  `,
  styles: [
    authStyles,
    `
      .lock-ring,
      .done-ring {
        display: grid;
        place-items: center;
        width: 74px;
        height: 74px;
        margin: 4px auto 18px;
        border-radius: 50%;
        font-size: 30px;
        color: var(--brand-ink, #fff);
        background: var(--brand);
      }

      .step-title {
        font-size: 20px;
        font-weight: 700;
        margin: 0 0 8px;
        text-align: left;
      }

      .step-title.center {
        text-align: center;
      }

      .step-sub {
        font-size: 13px;
        line-height: 1.5;
        color: var(--ink-3);
        margin: 0 0 20px;
        text-align: left;
      }

      .step-sub.center {
        text-align: center;
      }

      .back-link {
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 20px;
        padding: 0 0 10px;
        display: block;
      }

      .code-input {
        letter-spacing: 8px;
        font-size: 16px;
        font-weight: 700;
      }

      .field-error {
        color: var(--danger);
        font-size: 12px;
        line-height: 1.4;
        margin: -2px 0 10px;
        text-align: left;
      }

      /* Honest rather than convenient: with no mail server there is no inbox to watch, and saying so
         beats a screen that asks for a number nobody can see. */
      .dev-note {
        border: 1px dashed color-mix(in srgb, var(--accent) 50%, transparent);
        background: color-mix(in srgb, var(--accent) 8%, transparent);
        border-radius: var(--radius);
        padding: 12px 14px;
        margin: 0 0 16px;
        text-align: left;
      }

      .dev-note .eyebrow {
        display: block;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.6px;
        text-transform: uppercase;
        color: var(--ink-3);
        margin-bottom: 4px;
      }

      .dev-note p {
        margin: 0 0 8px;
        font-size: 12px;
        line-height: 1.5;
        color: var(--ink-2);
      }

      .dev-code {
        letter-spacing: 3px;
        font-size: 14px;
      }

      .chip {
        border: 1px solid var(--border);
        background: var(--surface);
        border-radius: 999px;
        font-size: 12px;
        font-weight: 600;
        padding: 5px 12px;
      }

      .already {
        display: inline-block;
        margin-top: 16px;
        font-size: 13px;
        font-weight: 600;
        color: var(--ink-2);
      }

      .mt-8 {
        margin-top: 8px;
      }
    `,
  ],
})
export class ResetPasswordComponent implements OnDestroy {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly toasts = inject(Toasts);

  protected readonly step = signal<Step>('identify');

  protected readonly loginId = signal('');
  protected readonly code = signal('');
  protected readonly password = signal('');
  protected readonly confirm = signal('');

  protected readonly maskedEmail = signal('');
  protected readonly devCode = signal<string | null>(null);
  protected readonly cooldown = signal(0);

  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly year = new Date().getFullYear();

  private resetToken = '';
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => this.codeInput()?.nativeElement.focus());

    // Arriving from the login screen with something already typed into its username box. Carrying it
    // over is the difference between one form and two.
    const handed = this.route.snapshot.queryParamMap.get('u');
    if (handed) this.loginId.set(handed);
  }

  ngOnDestroy() {
    this.stopTicker();
  }

  /**
   * Only used where the username is genuinely known — the password rule refuses a password containing
   * it, and guessing wrong would produce an error about a username that is not theirs.
   */
  protected usernameHint() {
    return this.loginId().includes('@') ? '' : this.loginId().trim().toLowerCase();
  }

  protected canStart() {
    return this.loginId().trim().length >= 3;
  }

  protected canFinish() {
    return scorePassword(this.password(), this.usernameHint()).acceptable
      && this.confirm() === this.password();
  }

  /** Focused as soon as the step appears — see the note on the register screen. */
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('codeInput');

  protected onCode(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 6);

    this.code.set(digits);
    this.error.set('');

    if (digits.length === 6 && !this.busy()) {
      this.verify();
    }
  }

  // ------------------------------------------------------------------- step one

  protected start() {
    if (!this.canStart() || this.busy()) return;

    this.busy.set(true);
    this.error.set('');

    this.api.forgotPassword(this.loginId().trim()).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.maskedEmail.set(result.maskedEmail);
        this.devCode.set(result.devCode ?? null);
        this.startCooldown(result.resendInSeconds);
        this.step.set('code');
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err.error?.message ?? 'Could not start a reset. Is the API running?');
      },
    });
  }

  protected resend() {
    if (this.cooldown() > 0 || this.busy()) return;

    this.busy.set(true);
    this.error.set('');

    this.api.resendResetCode(this.loginId().trim()).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.maskedEmail.set(result.maskedEmail);
        this.devCode.set(result.devCode ?? null);
        this.startCooldown(result.resendInSeconds);
        this.toasts.show('Another code is on its way.');
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err.error?.message ?? 'Could not send another code.');
      },
    });
  }

  // ------------------------------------------------------------------- step two

  protected verify() {
    if (this.code().length !== 6 || this.busy()) return;

    this.busy.set(true);
    this.error.set('');

    this.api.verifyResetCode(this.loginId().trim(), this.code()).subscribe({
      next: (result) => {
        this.busy.set(false);
        this.resetToken = result.verificationToken;
        this.step.set('password');
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(err.error?.message ?? 'That code did not work.');
      },
    });
  }

  // ----------------------------------------------------------------- step three

  protected finish() {
    if (!this.canFinish() || this.busy()) return;

    this.busy.set(true);
    this.error.set('');

    this.api.resetPassword(this.loginId().trim(), this.resetToken, this.password()).subscribe({
      next: (result) => {
        this.busy.set(false);

        // The reset ended every session issued before it, including any this browser was holding. The
        // replacement travels with the response precisely so this screen does not have to bounce
        // somebody who has just proved who they are back to a login form.
        this.auth.adoptSession(result);
        this.step.set('done');
      },
      error: (err) => {
        this.busy.set(false);
        const message = err.error?.message ?? 'Could not change your password.';
        this.error.set(message);

        // An expired or spent token cannot be retried from this screen — the only way forward is a new
        // code, so say so and put them back where they can ask for one.
        if (/expired|already been used|no longer valid/i.test(message)) {
          this.resetToken = '';
          this.code.set('');
          this.step.set('identify');
        }
      },
    });
  }

  // --------------------------------------------------------------------- timing

  private startCooldown(seconds: number) {
    this.cooldown.set(Math.max(0, seconds));
    this.stopTicker();

    if (this.cooldown() === 0) return;

    this.ticker = setInterval(() => {
      const left = this.cooldown() - 1;
      this.cooldown.set(Math.max(0, left));
      if (left <= 0) this.stopTicker();
    }, 1000);
  }

  private stopTicker() {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}
