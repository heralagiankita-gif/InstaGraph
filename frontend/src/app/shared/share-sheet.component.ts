import { ChangeDetectionStrategy, Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, switchMap } from 'rxjs';
import { Api } from '../core/api.service';
import { ChatCandidate } from '../core/models';
import { Toasts } from '../core/toast.service';
import { AvatarComponent } from './ui';

/**
 * The share sheet behind the paper plane: sends a post into one or more chats.
 *
 * <p>
 * The list is not alphabetical and not "most recent". It is ordered by the interaction weight already
 * sitting on the edge between you and each account — the same number the feed uses as affinity — so the
 * people you actually talk to are the people offered first. Sharing then adds to that same weight, which
 * is what makes the ordering get better the more the app is used.
 * </p>
 */
@Component({
  selector: 'app-share-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AvatarComponent],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal" style="max-width:420px" (click)="$event.stopPropagation()">
        <div class="modal-head">Share</div>

        <div class="pad">
          <span class="search-box">
            <i class="bi bi-search"></i>
            <input
              class="bare"
              placeholder="Search"
              [ngModel]="term()"
              (ngModelChange)="onSearch($event)" />
          </span>
        </div>

        <p class="tiny muted pad" style="padding-top:0;padding-bottom:6px">
          @if (term()) {
            Accounts matching “{{ term() }}”
          } @else {
            Ordered by how much you interact, not alphabetically
          }
        </p>

        <div class="people">
          @for (person of candidates(); track person.id) {
            <button type="button" class="person" (click)="toggle(person)">
              <span class="av" [class.on]="isPicked(person)">
                <app-avatar [user]="person" [size]="56" />
                @if (isPicked(person)) {
                  <span class="tick"><i class="bi bi-check"></i></span>
                }
              </span>
              <span class="tiny ellipsis">{{ person.username }}</span>
            </button>
          }

          @if (candidates().length === 0) {
            <p class="muted small" style="padding:8px 16px">Nobody to send this to yet.</p>
          }
        </div>

        <div class="pad">
          <input class="input" placeholder="Write a message…" [(ngModel)]="note" />
        </div>

        <div class="pad" style="padding-top:0">
          <button type="button" class="btn btn-block" [disabled]="picked().length === 0 || sending()" (click)="send()">
            {{ sending() ? 'Sending…' : 'Send' }}
          </button>

          <button type="button" class="btn btn-secondary btn-block mt-8" (click)="copyLink()">
            Copy link
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .pad {
        padding: 12px 16px;
      }

      .search-box {
        display: flex;
        align-items: center;
        gap: 8px;
        background: var(--border-soft);
        border-radius: 10px;
        padding: 8px 10px;
        color: var(--ink-3);
      }

      .bare {
        border: 0;
        background: transparent;
        outline: none;
        color: var(--ink);
        font-family: inherit;
        font-size: 14px;
        width: 100%;
      }

      .people {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        padding: 0 16px 8px;
        max-height: 44vh;
        overflow-y: auto;
      }

      .person {
        border: 0;
        background: transparent;
        color: var(--ink);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 0;
        min-width: 0;
      }

      .person .av {
        position: relative;
        border-radius: 50%;
      }

      .person .av.on {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      .tick {
        position: absolute;
        right: -2px;
        bottom: -2px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--accent);
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        border: 2px solid var(--surface);
      }

      .person span:last-child {
        max-width: 76px;
      }
    `,
  ],
})
export class ShareSheetComponent implements OnInit {
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  readonly postId = input.required<number>();
  readonly close = output<void>();

  protected readonly candidates = signal<ChatCandidate[]>([]);
  protected readonly picked = signal<ChatCandidate[]>([]);
  protected readonly term = signal('');
  protected readonly sending = signal(false);
  protected note = '';

  private readonly typed = new Subject<string>();

  constructor() {
    this.typed
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => this.api.chatCandidates(q, 24)),
      )
      .subscribe({ next: (people) => this.candidates.set(people) });
  }

  ngOnInit() {
    this.api.chatCandidates('', 24).subscribe({ next: (people) => this.candidates.set(people) });
  }

  protected onSearch(value: string) {
    this.term.set(value);
    this.typed.next(value.trim());
  }

  protected isPicked(person: ChatCandidate) {
    return this.picked().some((p) => p.id === person.id);
  }

  protected toggle(person: ChatCandidate) {
    this.picked.update((all) =>
      all.some((p) => p.id === person.id) ? all.filter((p) => p.id !== person.id) : [...all, person],
    );
  }

  protected send() {
    const usernames = this.picked().map((p) => p.username);
    if (usernames.length === 0) return;

    this.sending.set(true);

    this.api.sharePost(this.postId(), usernames, this.note.trim()).subscribe({
      next: (result) => {
        this.sending.set(false);
        this.toasts.show(result.sent === 1 ? 'Sent.' : `Sent to ${result.sent} chats.`);
        this.close.emit();
      },
      error: (error) => {
        this.sending.set(false);
        this.toasts.error(error.error?.message ?? 'Could not send that.');
      },
    });
  }

  protected copyLink() {
    const url = `${location.origin}/p/${this.postId()}`;

    navigator.clipboard
      ?.writeText(url)
      .then(() => this.toasts.show('Link copied.'))
      .catch(() => this.toasts.error('Could not copy that link.'));

    this.close.emit();
  }
}
