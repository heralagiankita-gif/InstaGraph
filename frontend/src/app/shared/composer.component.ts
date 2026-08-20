import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../core/api.service';
import { Auth } from '../core/auth.service';
import { Toasts } from '../core/toast.service';
import { FILTERS, PhotoFilter, applyFilter } from '../features/create/filters';
import { inspect } from '../features/create/media';
import { AvatarComponent } from './ui';

type Mode = 'post' | 'story';

/**
 * The composer, as a sheet over whatever you were already looking at.
 *
 * <p>
 * One surface for both things you can put a photo into, because they differ in almost nothing: the same
 * pick, the same filter strip baked into the same upload. What actually changes is where it goes
 * afterwards — a post is pulled, ranked into feeds and kept; a story is pushed to your followers, in
 * order, and gone in a day. So the choice is two buttons rather than two screens.
 * </p>
 */
@Component({
  selector: 'app-composer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AvatarComponent],
  template: `
    <div class="modal-backdrop" (click)="tryClose()">
      <div class="sheet" (click)="$event.stopPropagation()">
        <!-- ------------------------------------------------------------ head -->
        <header class="head">
          @if (file()) {
            <button type="button" class="plain" aria-label="Remove photo" (click)="clear()"><i class="bi bi-arrow-left"></i></button>
          } @else {
            <button type="button" class="plain" aria-label="Close" (click)="close.emit()"><i class="bi bi-x-lg"></i></button>
          }

          <span class="strong">{{ mode() === 'story' ? 'Create new story' : 'Create new post' }}</span>

          @if (file()) {
            <button type="button" class="btn-ghost strong" [disabled]="busy()" (click)="share()">
              {{ busy() ? 'Sharing…' : 'Share' }}
            </button>
          } @else {
            <span style="width:44px"></span>
          }
        </header>

        <!-- ------------------------------------------------------------ tabs -->
        <div class="tabs">
          <button type="button" [class.on]="mode() === 'post'" (click)="mode.set('post')">
            <i class="bi bi-grid-3x3"></i> Post
          </button>
          <button type="button" [class.on]="mode() === 'story'" (click)="mode.set('story')">
            <i class="bi bi-plus-circle"></i> Story
          </button>
        </div>

        @if (!file()) {
          <!-- --------------------------------------------------------- picker -->
          <label
            class="drop"
            [class.over]="dragging()"
            (dragover)="onDragOver($event)"
            (dragleave)="dragging.set(false)"
            (drop)="onDrop($event)">
            <i class="bi bi-images"></i>
            <p class="strong" style="margin:14px 0 4px">Drag a photo here</p>
            <p class="tiny muted" style="margin:0 0 18px">JPG, PNG, GIF or WEBP, up to 8 MB</p>
            <span class="btn btn-sm">Select from computer</span>
            <input type="file" accept="image/*" hidden (change)="pick($event)" />
          </label>

          <p class="tiny muted foot-note">
            {{
              mode() === 'story'
                ? 'A story goes to everyone who follows you, in order, and disappears after a day.'
                : 'A post stays on your profile and is ranked into the feeds of people who follow you.'
            }}
          </p>
        } @else {
          <!-- -------------------------------------------------------- editing -->
          <div class="editor">
            <div class="preview" [class.story-shape]="mode() === 'story'">
              <img [src]="preview()" alt="" [style.filter]="filter().css" />
            </div>

            <div class="side">
              @if (auth.user(); as me) {
                <div class="row gap-8 mb-12">
                  <app-avatar [user]="me" [size]="30" />
                  <span class="strong small">{{ me.username }}</span>
                </div>
              }

              <textarea
                class="textarea"
                [rows]="mode() === 'story' ? 2 : 4"
                [maxlength]="mode() === 'story' ? 300 : 2200"
                [placeholder]="mode() === 'story' ? 'Add a line over the photo…' : 'Write a caption…'"
                [ngModel]="caption()"
                (ngModelChange)="caption.set($event)"></textarea>

              @if (mode() === 'post') {
                <input
                  class="input mt-8"
                  maxlength="120"
                  placeholder="Add a location"
                  [ngModel]="location()"
                  (ngModelChange)="location.set($event)" />

                @if (tags().length > 0) {
                  <p class="tiny muted mt-8">
                    Tags:
                    @for (tag of tags(); track tag) {
                      <span class="tag">#{{ tag }}</span>
                    }
                  </p>
                }
              } @else {
                <label class="row gap-8 mt-12" style="cursor:pointer">
                  <input type="checkbox" [ngModel]="closeFriends()" (ngModelChange)="closeFriends.set($event)" />
                  <span class="col">
                    <span class="small strong">Close friends only</span>
                    <span class="tiny muted">
                      Narrows it from every follower to the list you picked yourself.
                    </span>
                  </span>
                </label>
              }

              <!-- The same CSS string styles the preview and is baked into the upload. -->
              <p class="tiny muted mt-16 mb-4">Filter</p>
              <div class="filters">
                @for (option of filters; track option.name) {
                  <button
                    type="button"
                    class="filter"
                    [class.on]="filter().name === option.name"
                    (click)="filter.set(option)">
                    <img [src]="preview()" alt="" [style.filter]="option.css" />
                    <span class="tiny">{{ option.name }}</span>
                  </button>
                }
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .sheet {
        background: var(--surface);
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 880px;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: var(--shadow-lg);
        animation: lift 0.18s var(--ease);
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-bottom: 1px solid var(--border);
        flex: none;
      }

      .plain {
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 17px;
        padding: 4px;
        line-height: 1;
        width: 44px;
        text-align: left;
      }

      .tabs {
        display: flex;
        border-bottom: 1px solid var(--border);
        flex: none;
      }

      .tabs button {
        flex: 1;
        border: 0;
        background: transparent;
        color: var(--ink-3);
        font-weight: 600;
        font-size: 13px;
        padding: 11px 8px;
        border-bottom: 2px solid transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
      }

      .tabs button.on {
        color: var(--ink);
        border-bottom-color: var(--ink);
      }

      /* ------------------------------------------------------------- picker */

      .drop {
        flex: 1;
        min-height: 320px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 40px 20px;
        cursor: pointer;
        border: 2px dashed transparent;
        transition: background 0.15s var(--ease), border-color 0.15s var(--ease);
      }

      .drop i {
        font-size: 54px;
        color: var(--ink-3);
      }

      .drop.over {
        background: var(--border-soft);
        border-color: var(--accent);
      }

      .foot-note {
        text-align: center;
        padding: 0 24px 20px;
        margin: 0;
      }

      /* ------------------------------------------------------------ editing */

      .editor {
        display: grid;
        grid-template-columns: 1fr 320px;
        min-height: 0;
        flex: 1;
        overflow: hidden;
      }

      .preview {
        background: #000;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .preview img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }

      /* A story is a tall frame, so the preview says so before it is posted. */
      .preview.story-shape img {
        aspect-ratio: 9 / 16;
        object-fit: cover;
        width: 100%;
        max-height: 100%;
      }

      .side {
        padding: 16px;
        overflow-y: auto;
        border-left: 1px solid var(--border);
      }

      .tag {
        color: var(--accent);
        margin-right: 6px;
      }

      .filters {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding-bottom: 6px;
        scrollbar-width: thin;
      }

      .filter {
        border: 0;
        background: transparent;
        padding: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        flex: none;
        color: var(--ink-3);
      }

      .filter img {
        width: 62px;
        height: 62px;
        object-fit: cover;
        border-radius: 8px;
        border: 2px solid transparent;
      }

      .filter.on {
        color: var(--ink);
        font-weight: 600;
      }

      .filter.on img {
        border-color: var(--ink);
      }

      @media (max-width: 780px) {
        .editor {
          grid-template-columns: 1fr;
          grid-template-rows: minmax(0, 1fr) auto;
        }

        .side {
          border-left: 0;
          border-top: 1px solid var(--border);
          max-height: 44vh;
        }
      }
    `,
  ],
})
export class ComposerComponent {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly auth = inject(Auth);

  /** Which tab to open on. The + in the nav opens a post; the story ring opens a story. */
  readonly initialMode = input<Mode>('post');

  readonly close = output<void>();

  /** Emitted after something was actually created, so the screen behind can refresh. */
  readonly created = output<Mode>();

  protected readonly filters = FILTERS;

  protected readonly mode = signal<Mode>('post');
  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal('');
  protected readonly caption = signal('');
  protected readonly location = signal('');
  protected readonly closeFriends = signal(false);
  protected readonly filter = signal<PhotoFilter>(FILTERS[0]);
  protected readonly busy = signal(false);
  protected readonly dragging = signal(false);

  /** Echoed back live, so it is obvious which words became tags before anything is shared. */
  protected readonly tags = computed(() =>
    [...this.caption().matchAll(/#([\p{L}0-9_]{1,60})/gu)].map((m) => m[1].toLowerCase()),
  );

  constructor() {
    // input() is not readable in a field initialiser, so the starting tab is taken on first render.
    queueMicrotask(() => this.mode.set(this.initialMode()));
  }

  protected onDragOver(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(false);

    const file = event.dataTransfer?.files?.[0];
    if (file) this.accept(file);
  }

  protected pick(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) this.accept(file);
  }

  private accept(file: File) {
    if (!file.type.startsWith('image/')) {
      this.toasts.error('That file is not a photo.');
      return;
    }

    this.file.set(file);
    this.preview.set(URL.createObjectURL(file));
    this.filter.set(FILTERS[0]);
  }

  protected clear() {
    const url = this.preview();
    if (url) URL.revokeObjectURL(url);

    this.file.set(null);
    this.preview.set('');
    this.caption.set('');
    this.location.set('');
  }

  /** Closing with something half-written asks first; closing an empty sheet does not. */
  protected tryClose() {
    if (this.file() && !confirm('Discard this?')) {
      return;
    }

    this.close.emit();
  }

  protected async share() {
    const original = this.file();
    if (!original || this.busy()) return;

    this.busy.set(true);

    try {
      // Baked in here rather than stored as metadata, so the photo looks the same to everybody.
      const file = await applyFilter(original, this.filter().css);

      if (this.mode() === 'story') {
        this.api.postStory(file, this.caption().trim(), this.closeFriends()).subscribe({
          next: () => {
            this.busy.set(false);
            this.toasts.show('Story shared. It disappears in 24 hours.');
            this.created.emit('story');
            this.close.emit();
          },
          error: (error) => {
            this.busy.set(false);
            this.toasts.error(error.error?.message ?? 'That story did not upload.');
          },
        });

        return;
      }

      // The quick sheet stays one photo — the full editor at /create is where a run of ten is built.
      // It still measures the file, so the feed reserves the right space before the photo lands.
      const item = await inspect(file, 0, this.filter());

      this.api
        .createPost(
          [{ file, aspectRatio: item.aspectRatio, durationMs: 0, poster: null }],
          this.caption().trim(),
          this.location().trim(),
        )
        .subscribe({
          next: (post) => {
            this.busy.set(false);
            this.toasts.show('Shared.');
            this.created.emit('post');
            this.close.emit();
            this.router.navigate(['/p', post.id]);
          },
          error: (error) => {
            this.busy.set(false);
            this.toasts.error(error.error?.message ?? 'That photo did not upload.');
          },
        });
    } catch {
      this.busy.set(false);
      this.toasts.error('That photo could not be processed.');
    }
  }
}
