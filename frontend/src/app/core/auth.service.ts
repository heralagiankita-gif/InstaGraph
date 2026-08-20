import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { Api } from './api.service';
import { AuthResult, PasswordChangedResult, UserSummary } from './models';

const STORAGE_KEY = 'instagraph.session';

interface Session {
  token: string;
  expiresAt: string;
  user: UserSummary;
}

/**
 * The signed-in account, held in a signal and mirrored to localStorage so a refresh does not sign you
 * out. Everything that needs to know who you are reads it from here.
 */
@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  private readonly session = signal<Session | null>(restore());

  readonly user = computed(() => this.session()?.user ?? null);
  readonly token = computed(() => this.session()?.token ?? null);
  readonly isSignedIn = computed(() => this.session() !== null);
  readonly username = computed(() => this.session()?.user.username ?? '');

  /** Unread badge on the sidebar, refreshed after anything that could change it. */
  readonly unread = signal(0);

  login(login: string, password: string) {
    return this.api.login(login, password).pipe(tap((result) => this.store(result)));
  }

  /**
   * Creates the account and stops there.
   *
   * <p>
   * Deliberately no {@link store}: register no longer returns a session, and the new account is sent to
   * the login screen to sign in for itself. The one moment somebody is most likely to forget the
   * password they just chose is the moment straight after choosing it.
   * </p>
   */
  register(body: {
    username: string;
    email: string;
    password: string;
    fullName: string;
    dateOfBirth: string;
    verificationToken: string;
  }) {
    return this.api.register(body);
  }

  /**
   * Adopts the session that a password change or reset handed back.
   *
   * <p>
   * Both of those end every token issued before them, so the one this browser is holding has just
   * stopped working. Storing the replacement is what turns "your password changed, sign in again" into
   * nothing happening at all from where the user is sitting — while every other browser is signed out,
   * which was the point.
   * </p>
   */
  adoptSession(result: PasswordChangedResult) {
    this.store({ token: result.token, expiresAt: result.expiresAt, user: result.user });
  }

  /** Called after editing the profile or the avatar, so the sidebar updates with it. */
  patchUser(user: UserSummary) {
    const current = this.session();
    if (!current) return;

    this.session.set({ ...current, user });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, user }));
  }

  refreshUnread() {
    if (!this.isSignedIn()) return;
    this.api.unreadCount().subscribe({
      next: (count) => this.unread.set(count),
      // A failed badge refresh is not worth interrupting anybody over.
      error: () => undefined,
    });
  }

  signOut() {
    localStorage.removeItem(STORAGE_KEY);
    this.session.set(null);
    this.unread.set(0);
    this.router.navigate(['/login']);
  }

  private store(result: AuthResult) {
    const session: Session = { token: result.token, expiresAt: result.expiresAt, user: result.user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    this.session.set(session);
  }
}

function restore(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const session = JSON.parse(raw) as Session;

    // An expired token would only produce a wall of 401s, so treat it as signed out from the start.
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return session;
  } catch {
    return null;
  }
}
