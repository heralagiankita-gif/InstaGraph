import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Auth } from './auth.service';

/** Keeps the app behind a sign-in. */
export const authGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.isSignedIn() ? true : router.createUrlTree(['/login']);
};

/** Keeps a signed-in person off the sign-in screen. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(Auth);
  const router = inject(Router);

  return auth.isSignedIn() ? router.createUrlTree(['/']) : true;
};
