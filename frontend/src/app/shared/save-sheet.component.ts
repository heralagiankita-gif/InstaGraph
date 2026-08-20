import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api.service';
import { Collection } from '../core/models';
import { Toasts } from '../core/toast.service';
import { SpinnerComponent } from './ui';

/**
 * Files a saved post into a collection.
 *
 * Opening this saves the post if it was not already, because filing something you have not saved is not
 * a state the data has — a collection sorts bookmarks, it does not create them. The alternative would be
 * to grey the whole sheet out until somebody pressed the bookmark first, which is a worse way of saying
 * the same thing.
 */
@Component({
  selector: 'app-save-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SpinnerComponent],
  template: `
    <div class="modal-backdrop" (click)="close.emit()">
      <div class="modal" style="max-width:400px" (click)="$event.stopPropagation()">
        <div class="modal-head">Save to collection</div>

        <div class="body">
          @if (loading()) {
            <app-spinner />
          } @else {
            <button type="button" class="row" (click)="file(null)">
              <span class="art"><i class="bi bi-bookmark"></i></span>
              <span class="col grow">
                <span class="small">All saved</span>
                <span class="tiny muted">Saved, but not filed anywhere</span>
              </span>
              @if (current() === null) {
                <i class="bi bi-check-lg"></i>
              }
            </button>

            @for (folder of collections(); track folder.id) {
              <button type="button" class="row" (click)="file(folder.id)">
                <span class="art">
                  @if (folder.coverUrl) {
                    <img [src]="api.imageUrl(folder.coverUrl)" alt="" />
                  } @else {
                    <i class="bi bi-collection"></i>
                  }
                </span>
                <span class="col grow" style="min-width:0">
                  <span class="small ellipsis">{{ folder.name }}</span>
                  <span class="tiny muted">{{ folder.itemCount }} saved</span>
                </span>
                @if (current() === folder.id) {
                  <i class="bi bi-check-lg"></i>
                }
              </button>
            }

            <form class="new" (ngSubmit)="create()">
              <input
                class="input"
                placeholder="New collection"
                maxlength="60"
                [ngModel]="name()"
                (ngModelChange)="name.set($event)"
                name="name" />
              <button type="submit" class="btn btn-sm" [disabled]="!name().trim() || busy()">Create</button>
            </form>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .body {
        padding: 8px 16px 16px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        max-height: 60vh;
        overflow-y: auto;
      }

      .row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--ink);
        padding: 8px 4px;
        text-align: left;
        border-radius: 8px;
      }

      .row:hover {
        background: var(--hover);
      }

      .art {
        width: 42px;
        height: 42px;
        flex: none;
        border-radius: 8px;
        overflow: hidden;
        display: grid;
        place-items: center;
        background: var(--border-soft);
        color: var(--ink-3);
      }

      .art img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .new {
        display: flex;
        gap: 8px;
        margin-top: 10px;
        padding-top: 12px;
        border-top: 1px solid var(--border);
      }

      .ellipsis {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class SaveSheetComponent {
  protected readonly api = inject(Api);
  private readonly toasts = inject(Toasts);

  readonly postId = input.required<number>();

  /** Whether the post is already saved, so the sheet only saves it when it has to. */
  readonly alreadySaved = input(false);

  readonly close = output<void>();

  /** Emitted once the post is definitely saved, so the card's bookmark can fill in. */
  readonly saved = output<void>();

  protected readonly collections = signal<Collection[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly name = signal('');

  /** Which folder it is in now. Unknown until something files it, so it starts unfiled. */
  protected readonly current = signal<number | null>(null);

  constructor() {
    this.api.collections().subscribe({
      next: (list) => {
        this.collections.set(list);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  protected create() {
    const name = this.name().trim();
    if (!name || this.busy()) return;

    this.busy.set(true);

    this.api.createCollection(name).subscribe({
      next: (created) => {
        this.busy.set(false);
        this.name.set('');
        this.collections.update((list) => [created, ...list]);

        // Creating one from here is almost always a way of filing this post into it.
        this.file(created.id);
      },
      error: (err) => {
        this.busy.set(false);
        this.toasts.error(err.error?.message ?? 'Could not create that collection.');
      },
    });
  }

  protected file(collectionId: number | null) {
    // Saving first, because the API files a bookmark and there is no bookmark yet.
    const ensure = this.alreadySaved()
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) =>
          this.api.save(this.postId()).subscribe({ next: () => resolve(), error: reject }),
        );

    ensure
      .then(() => {
        this.saved.emit();

        this.api.filePost(this.postId(), collectionId).subscribe({
          next: () => {
            this.current.set(collectionId);

            const folder = this.collections().find((c) => c.id === collectionId);
            this.toasts.show(folder ? `Saved to "${folder.name}".` : 'Saved.');
            this.close.emit();
          },
          error: (err) => this.toasts.error(err.error?.message ?? 'Could not file that post.'),
        });
      })
      .catch(() => this.toasts.error('Could not save that post.'));
  }
}
