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

      if (error.status === 0) {
        toasts.error('Cannot reach the server. Is the API running on port 5120?');
      } else if (!signingIn && error.status >= 500) {
        toasts.error(error.error?.message ?? 'Something went wrong.');
      }

      return throwError(() => error);
    }),
  );
};
