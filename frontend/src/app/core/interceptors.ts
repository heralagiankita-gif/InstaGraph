import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Auth } from './auth.service';
import { Toasts } from './toast.service';

/** Attaches the bearer token to every call that is not the sign-in call itself. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(Auth).token();

  if (!token || req.url.includes('/auth/login') || req.url.includes('/auth/register')) {
    return next(req);
  }

  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};

/**
 * One place where a failed call becomes something a person can read. The API always answers with
 * { message }, so there is exactly one field to look at.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const toasts = inject(Toasts);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      // A 401 on the sign-in call is a wrong password; the form shows it. Anywhere else it means the
      // token has stopped being accepted, and the only sensible response is to sign out.
      const signingIn = req.url.includes('/auth/login') || req.url.includes('/auth/register');

      if (error.status === 401 && !signingIn) {
        auth.signOut();
        router.navigate(['/login']);
        return throwError(() => error);
      }

      // Nothing answering at all, or something answering that is not this API. Status 0 is a refused
      // or blocked connection; a 404 carrying a string body is a static host's own not-found page,
      // because every real 404 from this API arrives as JSON with a message in it.
      //
      // Worth separating from an ordinary failure. Left alone, each screen falls back to a guess about
      // its own corner of the app — the sign-up form blames the email, the feed blames the feed — and
      // a missing backend gets reported as five unrelated bugs.
      const apiMissing = error.status === 0 || (error.status === 404 && typeof error.error === 'string');

      if (apiMissing) {
        const message = "Can't reach the API. This deployment has no backend connected.";

        toasts.error(message);

        // Re-shaped into the envelope the rest of the app reads, so the screens show this rather than
        // their own fallback text.
        return throwError(() => new HttpErrorResponse({
          error: { message },
          status: error.status,
          statusText: error.statusText,
          url: error.url ?? undefined,
        }));
      }

      if (!signingIn && error.status >= 500) {
        toasts.error(error.error?.message ?? 'Something went wrong.');
      }

      return throwError(() => error);
    }),
  );
};
