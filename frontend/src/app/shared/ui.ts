import { ChangeDetectionStrategy, Component, Pipe, PipeTransform, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { parseApiDate } from '../core/clock.service';
import { UserSummary } from '../core/models';

/**
 * "now", "5m", "3h", "2d", "5w" — then an actual date once it is more than a year old, which is what
 * Instagram does and what stops "63w" appearing on an old photo.
 *
 * Pass <code>clock.now()</code> as the argument to make it live: the pipe stays pure, but its input
 * changes every thirty seconds so it re-runs and the OnPush component repaints.
 */
@Pipe({ name: 'ago' })
export class AgoPipe implements PipeTransform {
  transform(value: string | Date | null | undefined, now: number = Date.now()): string {
    const then = parseApiDate(value);
    if (!then) return '';

    // Clamped at zero: a clock a few seconds ahead of the server should read "now", not "in 4s".
    const seconds = Math.max(0, Math.floor((now - then.getTime()) / 1000));

    if (seconds < 60) return 'now';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;

    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d`;

    const weeks = Math.floor(days / 7);
    if (weeks < 52) return `${weeks}w`;

    // Past a year, a relative figure stops being useful.
    return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
}

/** The exact local date and time, for the tooltip behind every relative stamp. */
@Pipe({ name: 'exact' })
export class ExactDatePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    const date = parseApiDate(value);
    if (!date) return '';

    return date.toLocaleString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}

/** A long-form date for a post's own page — "14 August 2026". */
@Pipe({ name: 'postDate' })
export class PostDatePipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    const date = parseApiDate(value);
    if (!date) return '';

    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }
}

/**
 * A profile photo. Falls back to initials on a colour derived from the username, so an account without an
 * uploaded picture still looks like a distinct person rather than a grey blank.
 */
@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (src()) {
      <img
        [src]="src()"
        [alt]="user().username"
        [style.width.px]="size()"
        [style.height.px]="size()"
        class="av" />
    } @else {
      <span
        class="av fallback"
        [style.width.px]="size()"
        [style.height.px]="size()"
        [style.font-size.px]="size() * 0.4"
        [style.background]="colour()"
        >{{ initials() }}</span
      >
    }
  `,
  styles: [
    `
      .av {
        border-radius: 50%;
        object-fit: cover;
        flex: none;
        display: block;
        background: var(--border-soft);
      }

      .fallback {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #fff;
        font-weight: 600;
        letter-spacing: 0.3px;
        user-select: none;
      }
    `,
  ],
})
export class AvatarComponent {
  private readonly api = inject(Api);

  readonly user = input.required<UserSummary>();
  readonly size = input(38);

  protected readonly src = computed(() => this.api.imageUrl(this.user().avatarUrl));

  protected readonly initials = computed(() =>
    this.user()
      .username.split(/[._]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join(''),
  );

  /** Same string always produces the same hue, so an account keeps one colour everywhere. */
  protected readonly colour = computed(() => {
    const name = this.user().username;
    let hash = 5381;

    for (let i = 0; i < name.length; i++) {
      hash = (hash * 33) ^ name.charCodeAt(i);
    }

    const hue = Math.abs(hash) % 360;
    return `linear-gradient(135deg, hsl(${hue}, 65%, 58%), hsl(${(hue + 40) % 360}, 60%, 45%))`;
  });
}

/**
 * The blue tick.
 *
 * Drawn as an inline SVG rather than an icon-font glyph because it has to sit on the text baseline next
 * to a username at half a dozen different sizes, and a glyph brings its own line-height along with it.
 * Takes the whole person rather than a boolean, so a caller cannot accidentally draw one on somebody who
 * has not got it.
 */
@Component({
  selector: 'app-verified',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (user().isVerified) {
      <svg
        class="tick"
        [style.width.px]="size()"
        [style.height.px]="size()"
        viewBox="0 0 24 24"
        aria-label="Verified"
        role="img">
        <title>Verified</title>
        <path
          fill="currentColor"
          d="M12 1.6 14.6 4l3.4-.4 1 3.3 3.1 1.5-1.1 3.3 1.1 3.3-3.1 1.5-1 3.3-3.4-.4L12 22.4 9.4 20l-3.4.4-1-3.3-3.1-1.5L3 12.3 1.9 9l3.1-1.5 1-3.3 3.4.4L12 1.6Z" />
        <path
          fill="var(--surface, #fff)"
          d="m10.9 15.4-3-3 1.3-1.3 1.7 1.7 4-4L16.2 10l-5.3 5.4Z" />
      </svg>
    }
  `,
  styles: [
    `
      .tick {
        color: #0095f6;
        flex: none;
        vertical-align: -2px;
      }
    `,
  ],
})
export class VerifiedBadgeComponent {
  readonly user = input.required<UserSummary>();
  readonly size = input(14);
}

/** Avatar + name + handle, used in every list of people. */
@Component({
  selector: 'app-user-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AvatarComponent, VerifiedBadgeComponent],
  template: `
    <a class="row gap-12 grow" [routerLink]="['/', user().username]">
      <app-avatar [user]="user()" [size]="size()" />
      <span class="col" style="min-width:0">
        <span class="row gap-4">
          <span class="username">{{ user().username }}</span>
          <app-verified [user]="user()" />
        </span>
        <span class="tiny muted ellipsis">{{ subtitle() || user().fullName }}</span>
      </span>
    </a>
    <ng-content />
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 0;
      }

      .ellipsis {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class UserRowComponent {
  readonly user = input.required<UserSummary>();
  readonly subtitle = input('');
  readonly size = input(44);
}

/** The centred icon-and-message block used wherever a list comes back empty. */
@Component({
  selector: 'app-empty',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="empty fade-in">
      <span class="ring"><i class="bi" [class]="icon()"></i></span>
      <h4>{{ title() }}</h4>
      @if (message()) {
        <p class="small">{{ message() }}</p>
      }
      <!-- Projected actions get their own row, so a button can never land on the message. -->
      <div class="empty-actions"><ng-content /></div>
    </div>
  `,
})
export class EmptyComponent {
  readonly icon = input('bi-camera');
  readonly title = input('Nothing here yet');
  readonly message = input('');
}

/** The loading circle. */
@Component({
  selector: 'app-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="spinner"></div>`,
})
export class SpinnerComponent {}
