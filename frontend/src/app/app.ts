import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { Pwa } from './core/pwa.service';
import { Toasts } from './core/toast.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, NgTemplateOutlet],
  template: `
    <router-outlet />

    <!--
      Two regions rather than one, because a screen reader treats them differently and the difference
      is the point: a confirmation waits for a gap in whatever is being read out, an error interrupts.
      A single region would have to pick one of those for both.
    -->
    <div class="toast-host">
      <div aria-live="polite" aria-atomic="false" class="toast-lane">
        @for (toast of toasts.items(); track toast.id) {
          @if (!toast.error) {
            <ng-container *ngTemplateOutlet="pill; context: { $implicit: toast }" />
          }
        }
      </div>

      <div role="alert" aria-live="assertive" aria-atomic="false" class="toast-lane">
        @for (toast of toasts.items(); track toast.id) {
          @if (toast.error) {
            <ng-container *ngTemplateOutlet="pill; context: { $implicit: toast }" />
          }
        }
      </div>
    </div>

    <ng-template #pill let-toast>
      <!-- Hovering holds the countdown: a pill must not expire out from under somebody reading it. -->
      <div
        class="toast"
        [class.error]="toast.error"
        (mouseenter)="toasts.pause(toast.id)"
        (mouseleave)="toasts.resume(toast.id)"
        (focusin)="toasts.pause(toast.id)"
        (focusout)="toasts.resume(toast.id)">
        <span class="toast-text">{{ toast.text }}</span>

        @if (toast.count > 1) {
          <span class="toast-count" [attr.aria-label]="toast.count + ' times'">×{{ toast.count }}</span>
        }

        @if (toast.action; as action) {
          <button type="button" class="toast-action" (click)="toasts.run(toast)">{{ action.label }}</button>
        }

        <button
          type="button"
          class="toast-close"
          aria-label="Dismiss"
          (click)="toasts.dismiss(toast.id)">
          <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
      </div>
    </ng-template>
  `,
})
export class AppComponent {
  protected readonly toasts = inject(Toasts);

  constructor() {
    // Installs the worker in a real build, and tears down any that a development session left behind.
    inject(Pwa).install();
  }
}
