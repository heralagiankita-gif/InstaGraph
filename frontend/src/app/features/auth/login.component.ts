import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Auth } from '../../core/auth.service';
import { AuthShowcaseComponent } from './auth-showcase.component';
import { authStyles } from './auth.styles';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, AuthShowcaseComponent],
  template: `
    <div class="col" style="align-items:center;width:100%">
      <div class="stage">
        <div class="showcase"><app-auth-showcase /></div>

        <div class="wrap">
          <div class="panel">
            <h1 class="wordmark">InstaGraph</h1>
            <span class="kicker">Everyone you know is a hop away.</span>

            @if (justSignedUp()) {
              <p class="welcome">
                Account created. Log in as <strong>{{ login() }}</strong> to finish.
              </p>
            }

            <form (ngSubmit)="submit()">
              <label class="field">
                <input
                  class="input"
                  name="login"
                  placeholder=" "
                  autocomplete="username"
                  autocapitalize="none"
                  spellcheck="false"
                  [ngModel]="login()"
                  (ngModelChange)="login.set($event)" />
                <span class="label">Username or email</span>
              </label>

              <label class="field">
                <input
                  class="input"
                  name="password"
                  [type]="reveal() ? 'text' : 'password'"
                  placeholder=" "
                  autocomplete="current-password"
                  [ngModel]="password()"
                  (ngModelChange)="password.set($event)" />
                <span class="label">Password</span>

                @if (password().length > 0) {
                  <button type="button" class="peek" (click)="reveal.set(!reveal())">
                    {{ reveal() ? 'Hide' : 'Show' }}
                  </button>
                }
              </label>

              <button class="btn btn-block" type="submit" [disabled]="!canSubmit() || busy()">
                {{ busy() ? 'Logging in…' : 'Log in' }}
              </button>

              @if (error()) {
                <p class="error">{{ error() }}</p>

                <!-- A lockout is not a wrong password, and the way out of it is not to try harder.
                     The link only appears once the app is actually saying so. -->
                @if (lockedOut()) {
                  <a class="forgot" [routerLink]="['/reset-password']" [queryParams]="{ u: login().trim() || null }">
                    Reset your password instead
                  </a>
                }
              }
            </form>

            <div class="divider">OR</div>

            <a class="row center gap-8 strong small" routerLink="/register">
              <i class="bi bi-person-plus"></i> Create a new account
            </a>

            <!-- Carries whatever is already in the username box across, so the reset screen does not
                 open an empty form asking for something that was just typed. -->
            <a class="forgot" [routerLink]="['/reset-password']" [queryParams]="{ u: login().trim() || null }">
              Forgotten your password?
            </a>
          </div>

          <div class="alt">
            Don't have an account?
            <a class="strong" style="color:var(--accent)" routerLink="/register">Sign up</a>
          </div>

          <div class="pitch">
            <span class="badge"><i class="bi bi-diagram-3-fill"></i> Built on a social graph</span>
            <p>
              Your feed, your suggestions and who your story reaches are all questions asked of the same
              set of edges. Nothing is seeded — the first account is genuinely the first node.
            </p>
          </div>
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
      .welcome {
        border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
        background: color-mix(in srgb, var(--accent) 10%, transparent);
        border-radius: var(--radius);
        padding: 10px 12px;
        margin: 0 0 18px;
        font-size: 13px;
        line-height: 1.45;
        color: var(--ink-2);
      }
    `,
  ],
})
export class LoginComponent {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** Shows the one-line welcome above the form, and only on the first paint after signing up. */
  protected readonly justSignedUp = signal(false);

  protected readonly login = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly reveal = signal(false);
  protected readonly error = signal('');

  /** True once the API answers 429 — too many wrong passwords, and it has stopped checking them. */
  protected readonly lockedOut = signal(false);

  protected readonly year = new Date().getFullYear();

  constructor() {
    // Arriving from the last screen of sign-up, with the new username already known. Filling it in and
    // putting the caret in the password box is the whole reason register hands off here rather than
    // signing the account straight in.
    const handedOver = this.route.snapshot.queryParamMap.get('u');

    if (handedOver) {
      this.login.set(handedOver);
      this.justSignedUp.set(true);
    }
  }

  protected canSubmit() {
    return this.login().trim().length > 0 && this.password().length > 0;
  }

  protected submit() {
    if (!this.canSubmit() || this.busy()) return;

    this.busy.set(true);
    this.error.set('');
    this.lockedOut.set(false);

    this.auth.login(this.login().trim(), this.password()).subscribe({
      next: () => this.router.navigate(['/']),
      error: (err) => {
        this.busy.set(false);
        this.lockedOut.set(err.status === 429);
        this.error.set(err.error?.message ?? 'Could not log in. Is the API running?');
      },
    });
  }
}
