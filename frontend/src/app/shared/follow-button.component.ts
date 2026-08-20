import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { Api } from '../core/api.service';
import { UserRelation } from '../core/models';
import { Toasts } from '../core/toast.service';
import { AvatarComponent } from './ui';

/**
 * The follow button, everywhere.
 *
 * A follow is a directed edge, so the button has five states rather than two, and every one of them is a
 * different fact about the graph:
 *
 * | Edges | Button | What clicking it does |
 * |---|---|---|
 * | neither | **Follow** | adds your edge |
 * | theirs only | **Follow back** | closes the cycle |
 * | yours pending | **Requested** | opens the sheet, to cancel |
 * | yours only | **Following** | opens the sheet, to unfollow |
 * | both | **Friends** | opens the sheet, to unfollow |
 *
 * The distinction that matters is the last two. "Following" and "Friends" look alike and are not: one is
 * a single edge, the other is a two-cycle, and unfollowing does something different in each case —
 * leaving in the second one an edge from them to you that you did not touch. The sheet says so, because
 * a destructive action ought to state what survives it.
 *
 * A button that took no relationship as input would have to assume "not following", which is exactly how
 * a list ends up offering to follow somebody you already follow.
 */
@Component({
  selector: 'app-follow-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarComponent],
  template: `
    @if (!state().isMe) {
      <button
        type="button"
        class="btn"
        [class.btn-sm]="size() === 'sm'"
        [class.btn-secondary]="!look().primary"
        [class.block]="block()"
        [disabled]="busy()"
        (click)="onClick()">
        @if (look().icon) {
          <i class="bi" [class]="look().icon"></i>
        }
        {{ look().label }}
      </button>
    }

    <!-- Instagram's confirm sheet. Adding an edge is one click; removing one asks. -->
    @if (sheet()) {
      <div class="modal-backdrop" (click)="sheet.set(false)">
        <div class="modal sheet" (click)="$event.stopPropagation()">
          <div class="sheet-head">
            <app-avatar [user]="state()" [size]="72" />
            <strong style="margin-top:10px">{{ state().username }}</strong>
            <p class="tiny muted">{{ blurb() }}</p>
          </div>

          <button type="button" class="menu-item danger" [disabled]="busy()" (click)="confirm()">
            {{ state().followRequested ? 'Cancel request' : 'Unfollow' }}
          </button>
          <button type="button" class="menu-item" (click)="sheet.set(false)">Cancel</button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .block {
        width: 100%;
        justify-content: center;
      }

      .sheet {
        max-width: 340px;
        text-align: center;
      }

      .sheet-head {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 22px 20px 14px;
        border-bottom: 1px solid var(--border);
      }

      .sheet-head p {
        margin: 6px 0 0;
        line-height: 1.45;
      }
    `,
  ],
})
export class FollowButtonComponent {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  readonly user = input.required<UserRelation>();
  readonly size = input<'sm' | 'md'>('sm');
  readonly block = input(false);

  /** Emitted with the new relationship whenever an edge is added or removed. */
  readonly changed = output<UserRelation>();

  /**
   * Seeded from the input and writable on top of it, so an optimistic click paints immediately and a
   * fresh input — navigating to another profile, reloading a list — resets it without any bookkeeping.
   */
  protected readonly state = linkedSignal<UserRelation, UserRelation>({
    source: this.user,
    computation: (incoming) => incoming,
  });

  protected readonly busy = signal(false);
  protected readonly sheet = signal(false);

  protected readonly look = computed(() => {
    const user = this.state();

    if (user.followRequested) return { label: 'Requested', primary: false, icon: 'bi-hourglass' };
    if (user.isFriend) return { label: 'Friends', primary: false, icon: 'bi-people-fill' };
    if (user.isFollowing) return { label: 'Following', primary: false, icon: 'bi-check-lg' };
    if (user.followsYou) return { label: 'Follow back', primary: true, icon: '' };

    return { label: 'Follow', primary: true, icon: '' };
  });

  protected blurb(): string {
    const user = this.state();

    if (user.followRequested) {
      return `Your request to follow ${user.username} will be withdrawn. Nothing is sent to tell them.`;
    }

    if (user.isFriend) {
      return `You follow each other. Unfollowing removes your edge only — ${user.username} will still follow you, and is not told.`;
    }

    return `${user.username} will not be notified that you unfollowed them.`;
  }

  protected onClick() {
    const user = this.state();

    // Adding an edge is a click. Removing one goes through the sheet.
    if (user.isFollowing || user.followRequested) {
      this.sheet.set(true);
      return;
    }

    this.follow();
  }

  private follow() {
    const before = this.state();

    // Optimistic, and honest about which of the two outcomes is coming: a private account yields a
    // request, a public one yields the edge itself.
    this.state.set({
      ...before,
      isFollowing: !before.isPrivate,
      followRequested: before.isPrivate,
      isFriend: !before.isPrivate && before.followsYou,
    });

    this.busy.set(true);

    this.api.follow(before.username).subscribe({
      next: (result) => {
        const next: UserRelation = {
          ...before,
          isFollowing: result.isFollowing,
          followRequested: result.followRequested,
          isFriend: result.isFollowing && before.followsYou,
        };

        this.settle(next);

        this.toasts.show(
          result.followRequested
            ? `Requested to follow ${before.username}.`
            : next.isFriend
              ? `You and ${before.username} now follow each other.`
              : `You now follow ${before.username}.`,
        );
      },
      error: (err) => {
        // The edge was never created, so the button goes back to what it was.
        this.settle(before, { emit: false });
        this.toasts.error(err.error?.message ?? 'Could not follow that account.');
      },
    });
  }

  protected confirm() {
    const before = this.state();
    const wasRequest = before.followRequested;

    this.state.set({ ...before, isFollowing: false, followRequested: false, isFriend: false });
    this.busy.set(true);
    this.sheet.set(false);

    this.api.unfollow(before.username).subscribe({
      next: () => {
        this.settle({ ...before, isFollowing: false, followRequested: false, isFriend: false });

        this.toasts.show(
          wasRequest
            ? `Request to ${before.username} withdrawn.`
            : before.isFriend
              ? `Unfollowed ${before.username}. They still follow you.`
              : `Unfollowed ${before.username}.`,
        );
      },
      error: (err) => {
        this.settle(before, { emit: false });
        this.toasts.error(err.error?.message ?? 'Could not unfollow that account.');
      },
    });
  }

  private settle(next: UserRelation, options?: { emit: boolean }) {
    this.state.set(next);
    this.busy.set(false);

    if (options?.emit !== false) {
      this.changed.emit(next);
    }
  }
}
