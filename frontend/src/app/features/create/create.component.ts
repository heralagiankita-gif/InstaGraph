import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api, NewPostMedia } from '../../core/api.service';
import { Auth } from '../../core/auth.service';
import { Toasts } from '../../core/toast.service';
import { UserSummary } from '../../core/models';
import { AvatarComponent } from '../../shared/ui';
import { FILTERS, PhotoFilter, applyFilter } from './filters';
import {
  MAX_IMAGE_BYTES,
  MAX_ITEMS,
  MAX_VIDEO_BYTES,
  PickedMedia,
  formatDuration,
  inspect,
  kindOf,
} from './media';

/** One label being placed on a photo, before the post exists to attach it to. */
interface DraftTag {
  user: UserSummary;
  /** Which picked item it belongs to, by that item's stable id rather than its position. */
  mediaId: number;
  x: number;
  y: number;
}

/**
 * Create a post. Three steps, like the app it copies: pick what to post, arrange and filter it, then
 * write the caption next to a preview. Nothing is sent until Share is pressed.
 *
 * It handles a single photo, a run of up to ten, and video, because on the real thing those are not three
 * different screens — they are the same screen with a different number of things on it. The one place
 * they genuinely diverge is the filter strip, which is hidden on a clip: baking a CSS filter into a video
 * would mean re-encoding it in the browser, and offering a control that silently does nothing is worse
 * than not offering it.
 *
 * Tags are placed here but sent afterwards, as a second call once the post has an id. Instagram works the
 * same way — you can edit who is tagged long after posting — and it keeps the upload a plain multipart
 * form rather than one carrying a JSON document alongside ten files.
 */
@Component({
  selector: 'app-create',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AvatarComponent],
  template: `
    <div class="sheet card">
      <header class="head">
        @if (items().length > 0) {
          <button type="button" class="btn-ghost" (click)="reset()">Back</button>
        } @else {
          <span></span>
        }

        <span class="strong">Create new post</span>

        @if (items().length > 0) {
          <button type="button" class="btn-ghost strong" [disabled]="busy()" (click)="share()">
            {{ busy() ? 'Sharing…' : 'Share' }}
          </button>
        } @else {
          <span></span>
        }
      </header>

      @if (items().length === 0) {
        <!-- step one: choose what to post -->
        <div
          class="dropzone"
          [class.over]="dragging()"
          (dragover)="onDragOver($event)"
          (dragleave)="dragging.set(false)"
          (drop)="onDrop($event)">
          <i class="bi bi-images"></i>
          <p class="mb-16">Drag photos and videos here</p>

          <label class="btn">
            Select from computer
            <input type="file" accept="image/*,video/*" multiple hidden (change)="onPicked($event)" />
          </label>

          <p class="tiny muted mt-16">
            Up to {{ maxItems }} items · JPG, PNG, GIF, WEBP to 8 MB · MP4, WEBM, MOV to 60 MB
          </p>
        </div>
      } @else {
        <!-- step two: arrange, filter, caption -->
        <div class="editor">
          <div class="stage">
            <div class="preview" (click)="onStageClick($event)" #stage>
              @if (current(); as item) {
                @if (item.kind === 'Video') {
                  <video [src]="item.previewUrl" controls playsinline muted loop></video>
                } @else {
                  <img [src]="item.previewUrl" [style.filter]="item.filter.css" alt="Preview" />
                }

                <!-- Labels are drawn over whichever item is showing, and only ever on a photo:
                     a label pinned to a moving picture has nowhere to sit. -->
                @for (tag of tagsFor(item.id); track tag.user.id) {
                  <button
                    type="button"
                    class="label"
                    [style.left.%]="tag.x * 100"
                    [style.top.%]="tag.y * 100"
                    (click)="removeTag(tag); $event.stopPropagation()"
                    title="Remove this tag">
                    {{ tag.user.username }} <i class="bi bi-x"></i>
                  </button>
                }

                @if (tagging()) {
                  <div class="hint tiny">Tap the photo to place a tag</div>
                }
              }
            </div>

            @if (items().length > 1) {
              <!-- The run, in the order it will be swiped through. Reordering here is the only place
                   the order is decided; the server stores whatever arrives. -->
              <div class="strip">
                @for (item of items(); track item.id; let i = $index) {
                  <div class="thumb" [class.chosen]="i === index()">
                    <button type="button" class="pick" (click)="index.set(i)">
                      <img [src]="posterFor(item)" [style.filter]="item.filter.css" alt="" />

                      @if (item.kind === 'Video') {
                        <span class="badge"><i class="bi bi-play-fill"></i></span>
                      }
                    </button>

                    <div class="thumb-tools">
                      <button type="button" [disabled]="i === 0" (click)="move(i, -1)" aria-label="Move earlier">
                        <i class="bi bi-chevron-left"></i>
                      </button>
                      <button type="button" (click)="remove(i)" aria-label="Remove">
                        <i class="bi bi-trash"></i>
                      </button>
                      <button
                        type="button"
                        [disabled]="i === items().length - 1"
                        (click)="move(i, 1)"
                        aria-label="Move later">
                        <i class="bi bi-chevron-right"></i>
                      </button>
                    </div>
                  </div>
                }
              </div>
            }

            @if (current()?.kind === 'Image') {
              <!-- The same CSS string styles this strip and is baked into the upload. -->
              <div class="filters">
                @for (option of filters; track option.name) {
                  <button
                    type="button"
                    class="filter"
                    [class.chosen]="option.name === current()!.filter.name"
                    (click)="setFilter(option)">
                    <img [src]="current()!.previewUrl" [style.filter]="option.css" alt="" />
                    <span class="tiny">{{ option.name }}</span>
                  </button>
                }
              </div>
            } @else if (current(); as clip) {
              <div class="clip-note tiny muted">
                <i class="bi bi-play-btn"></i>
                Video · {{ duration(clip.durationMs) }} · posts as a reel
              </div>
            }
          </div>

          <div class="side">
            @if (auth.user(); as me) {
              <div class="row gap-8 mb-16">
                <app-avatar [user]="me" [size]="30" />
                <span class="username small">{{ me.username }}</span>
              </div>
            }

            <textarea
              class="textarea caption-box"
              name="caption"
              placeholder="Write a caption… use #tags to make it findable"
              maxlength="2200"
              [ngModel]="caption()"
              (ngModelChange)="caption.set($event)"></textarea>

            <div class="row between tiny muted mb-16">
              <span>
                @if (hashtags().length > 0) {
                  {{ hashtags().length }} tag{{ hashtags().length === 1 ? '' : 's' }}:
                  {{ hashtags().join(' ') }}
                }
              </span>
              <span>{{ caption().length }}/2200</span>
            </div>

            <input
              class="input mb-16"
              name="location"
              placeholder="Add location"
              maxlength="120"
              [ngModel]="location()"
              (ngModelChange)="location.set($event)" />

            <label class="btn btn-secondary btn-block mb-16">
              <i class="bi bi-plus-lg"></i> Add more
              <input type="file" accept="image/*,video/*" multiple hidden (change)="onPicked($event)" />
            </label>

            <!-- tag people -->
            <button
              type="button"
              class="row between line"
              (click)="tagging.set(!tagging()); searchOpen()"
              [disabled]="current()?.kind === 'Video'">
              <span>
                Tag people
                @if (tags().length > 0) {
                  <span class="muted">· {{ tags().length }}</span>
                }
              </span>
              <i class="bi" [class.bi-chevron-down]="!tagging()" [class.bi-chevron-up]="tagging()"></i>
            </button>

            @if (tagging()) {
              <div class="panel">
                <input
                  class="input mb-8"
                  placeholder="Search for someone"
                  [ngModel]="query()"
                  (ngModelChange)="search($event)" />

                @for (person of found(); track person.id) {
                  <button type="button" class="found" (click)="choose(person)">
                    <app-avatar [user]="person" [size]="28" />
                    <span class="col" style="min-width:0">
                      <span class="username tiny">{{ person.username }}</span>
                      <span class="tiny muted ellipsis">{{ person.fullName }}</span>
                    </span>
                  </button>
                }

                @if (pending(); as person) {
                  <p class="tiny muted">Now tap the photo to place {{ person.username }}.</p>
                }
              </div>
            }

            <!-- advanced settings -->
            <button type="button" class="row between line" (click)="advanced.set(!advanced())">
              <span>Advanced settings</span>
              <i class="bi" [class.bi-chevron-down]="!advanced()" [class.bi-chevron-up]="advanced()"></i>
            </button>

            @if (advanced()) {
              <div class="panel">
                <label class="row between switch">
                  <span class="col">
                    <span>Turn off commenting</span>
                    <span class="tiny muted">You can turn this back on at any time.</span>
                  </span>
                  <input
                    type="checkbox"
                    [ngModel]="commentsDisabled()"
                    (ngModelChange)="commentsDisabled.set($event)" />
                </label>

                <label class="row between switch">
                  <span class="col">
                    <span>Hide like and view counts</span>
                    <span class="tiny muted">Only you will see the numbers on this post.</span>
                  </span>
                  <input type="checkbox" [ngModel]="hideCounts()" (ngModelChange)="hideCounts.set($event)" />
                </label>
              </div>
            }

            <button class="btn btn-block mt-16" type="button" [disabled]="busy()" (click)="share()">
              {{ busy() ? 'Sharing…' : 'Share' }}
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .sheet {
        max-width: 920px;
        margin: 0 auto;
        overflow: hidden;
      }

      .head {
        display: grid;
        grid-template-columns: 1fr auto 1fr;
        align-items: center;
        padding: 8px 12px;
        border-bottom: 1px solid var(--border);
      }

      .head > :last-child {
        text-align: right;
      }

      .dropzone {
        min-height: 420px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 40px;
        transition: background 0.15s ease;
      }

      .dropzone.over {
        background: var(--border-soft);
      }

      .dropzone i {
        font-size: 64px;
        color: var(--ink-3);
        margin-bottom: 18px;
      }

      .editor {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 360px;
      }

      .stage {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      .preview {
        position: relative;
        background: #000;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 380px;
        flex: 1;
      }

      .preview img,
      .preview video {
        max-height: 500px;
        width: 100%;
        object-fit: contain;
        transition: filter 0.2s var(--ease);
      }

      .label {
        position: absolute;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.75);
        color: #fff;
        border: 0;
        font-size: 12px;
        font-weight: 600;
        padding: 5px 8px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .hint {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        padding: 5px 10px;
        border-radius: 999px;
      }

      .strip {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding: 10px 12px;
        border-top: 1px solid var(--border);
        background: var(--surface);
        scrollbar-width: thin;
      }

      .thumb {
        flex: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .pick {
        position: relative;
        border: 0;
        padding: 0;
        background: transparent;
        display: block;
      }

      .pick img {
        width: 72px;
        height: 72px;
        object-fit: cover;
        border-radius: 6px;
        border: 2px solid transparent;
      }

      .thumb.chosen .pick img {
        border-color: var(--accent);
      }

      .badge {
        position: absolute;
        right: 4px;
        bottom: 4px;
        background: rgba(0, 0, 0, 0.65);
        color: #fff;
        border-radius: 4px;
        font-size: 11px;
        line-height: 1;
        padding: 2px 4px;
      }

      .thumb-tools {
        display: flex;
        justify-content: space-between;
      }

      .thumb-tools button {
        border: 0;
        background: transparent;
        color: var(--ink-3);
        font-size: 12px;
        padding: 2px 4px;
      }

      .thumb-tools button:disabled {
        opacity: 0.3;
      }

      .filters {
        display: flex;
        gap: 10px;
        overflow-x: auto;
        padding: 12px;
        border-top: 1px solid var(--border);
        background: var(--surface);
        scrollbar-width: thin;
      }

      .filter {
        border: 0;
        background: transparent;
        padding: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
        flex: none;
        color: var(--ink-3);
      }

      .filter img {
        width: 66px;
        height: 66px;
        object-fit: cover;
        border-radius: 6px;
        border: 2px solid transparent;
        transition:
          border-color 0.14s var(--ease),
          transform 0.14s var(--ease);
      }

      .filter:hover img {
        transform: translateY(-2px);
      }

      .filter.chosen img {
        border-color: var(--accent);
      }

      .filter.chosen {
        color: var(--accent);
        font-weight: 600;
      }

      .clip-note {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 12px;
        border-top: 1px solid var(--border);
      }

      .side {
        padding: 16px;
        border-left: 1px solid var(--border);
        overflow-y: auto;
        max-height: 640px;
      }

      .caption-box {
        border: 0;
        padding: 0;
        min-height: 130px;
        background: transparent;
        margin-bottom: 8px;
      }

      .line {
        width: 100%;
        border: 0;
        border-top: 1px solid var(--border);
        background: transparent;
        color: var(--ink);
        padding: 13px 0;
        font-size: 14px;
        text-align: left;
      }

      .line:disabled {
        opacity: 0.45;
      }

      .panel {
        padding: 0 0 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .found {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--ink);
        padding: 5px 0;
        text-align: left;
      }

      .found:hover {
        background: var(--hover);
      }

      .switch {
        gap: 12px;
        align-items: flex-start;
      }

      .ellipsis {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media (max-width: 860px) {
        .editor {
          grid-template-columns: 1fr;
        }

        .side {
          border-left: 0;
          border-top: 1px solid var(--border);
          max-height: none;
        }
      }
    `,
  ],
})
export class CreateComponent {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly auth = inject(Auth);

  protected readonly filters = FILTERS;
  protected readonly maxItems = MAX_ITEMS;
  protected readonly duration = formatDuration;

  protected readonly items = signal<PickedMedia[]>([]);
  protected readonly index = signal(0);
  protected readonly caption = signal('');
  protected readonly location = signal('');
  protected readonly busy = signal(false);
  protected readonly dragging = signal(false);
  protected readonly advanced = signal(false);
  protected readonly commentsDisabled = signal(false);
  protected readonly hideCounts = signal(false);

  protected readonly tagging = signal(false);
  protected readonly tags = signal<DraftTag[]>([]);
  protected readonly query = signal('');
  protected readonly found = signal<UserSummary[]>([]);
  protected readonly pending = signal<UserSummary | null>(null);

  /** Ids only have to be unique within one composing session, so a counter is enough. */
  private nextId = 1;

  protected readonly current = computed<PickedMedia | null>(() => this.items()[this.index()] ?? null);

  /** Live echo of the tags the caption will produce, using the same rule the server applies. */
  protected readonly hashtags = computed(() => this.caption().match(/#[\p{L}0-9_]+/gu) ?? []);

  // ------------------------------------------------------------------- picking

  protected onPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    void this.accept(Array.from(input.files ?? []));

    // Reset, so picking the same file twice in a row still fires a change event.
    input.value = '';
  }

  protected onDragOver(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(true);
  }

  protected onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragging.set(false);
    void this.accept(Array.from(event.dataTransfer?.files ?? []));
  }

  /**
   * Checked here as well as on the server, so an obvious mistake does not cost an upload.
   *
   * A batch with one bad file in it still posts the rest: dropping nine good photos because the tenth
   * was a PDF would be an unhelpful way to be strict.
   */
  private async accept(files: File[]) {
    if (files.length === 0) return;

    const room = MAX_ITEMS - this.items().length;

    if (room <= 0) {
      this.toasts.error(`A post can hold up to ${MAX_ITEMS} photos or videos.`);
      return;
    }

    const picked: PickedMedia[] = [];

    for (const file of files.slice(0, room)) {
      const kind = kindOf(file);

      if (!kind) {
        this.toasts.error(`${file.name} is not a photo or a video.`);
        continue;
      }

      const limit = kind === 'Video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

      if (file.size > limit) {
        this.toasts.error(`${file.name} is larger than ${Math.round(limit / (1024 * 1024))} MB.`);
        continue;
      }

      picked.push(await inspect(file, this.nextId++, FILTERS[0]));
    }

    if (files.length > room) {
      this.toasts.show(`Only the first ${room} were added — a post holds ${MAX_ITEMS}.`);
    }

    if (picked.length > 0) {
      this.items.update((list) => [...list, ...picked]);
    }
  }

  protected posterFor(item: PickedMedia) {
    // A clip's thumbnail is the frame grabbed when it was picked; when that failed there is nothing to
    // draw, so the object URL is used and the browser shows whatever it can of the first frame.
    return item.kind === 'Video' && item.poster ? URL.createObjectURL(item.poster) : item.previewUrl;
  }

  protected setFilter(filter: PhotoFilter) {
    const at = this.index();
    this.items.update((list) => list.map((item, i) => (i === at ? { ...item, filter } : item)));
  }

  protected move(from: number, delta: number) {
    const to = from + delta;
    const list = [...this.items()];

    if (to < 0 || to >= list.length) return;

    [list[from], list[to]] = [list[to], list[from]];
    this.items.set(list);
    this.index.set(to);
  }

  protected remove(at: number) {
    const item = this.items()[at];
    if (!item) return;

    URL.revokeObjectURL(item.previewUrl);

    // The labels belong to the item, not to its position, so they go with it.
    this.tags.update((list) => list.filter((tag) => tag.mediaId !== item.id));
    this.items.update((list) => list.filter((_, i) => i !== at));
    this.index.update((current) => Math.max(0, Math.min(current, this.items().length - 1)));
  }

  protected reset() {
    for (const item of this.items()) {
      // Object URLs hold the file in memory until they are revoked.
      URL.revokeObjectURL(item.previewUrl);
    }

    this.items.set([]);
    this.tags.set([]);
    this.index.set(0);
    this.tagging.set(false);
    this.pending.set(null);
  }

  // -------------------------------------------------------------------- tagging

  protected tagsFor(mediaId: number) {
    return this.tags().filter((tag) => tag.mediaId === mediaId);
  }

  protected searchOpen() {
    if (this.found().length === 0 && this.query().trim().length === 0) {
      this.search('');
    }
  }

  protected search(value: string) {
    this.query.set(value);
    const term = value.trim();

    if (term.length === 0) {
      this.found.set([]);
      return;
    }

    this.api.search(term).subscribe({
      next: (results) => this.found.set(results.users.slice(0, 6)),
      error: () => this.found.set([]),
    });
  }

  protected choose(person: UserSummary) {
    this.pending.set(person);
    this.found.set([]);
    this.query.set('');
  }

  /**
   * Places the label where the photo was tapped.
   *
   * Stored as a fraction of the frame rather than in pixels, so the same label lands in the same place
   * on a phone, on a grid cell and on the post's own page.
   */
  protected onStageClick(event: MouseEvent) {
    const person = this.pending();
    const item = this.current();

    if (!person || !item || item.kind === 'Video') return;

    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();

    this.tags.update((list) => [
      ...list.filter((tag) => !(tag.mediaId === item.id && tag.user.id === person.id)),
      {
        user: person,
        mediaId: item.id,
        x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
        y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
      },
    ]);

    this.pending.set(null);
  }

  protected removeTag(tag: DraftTag) {
    this.tags.update((list) => list.filter((t) => t !== tag));
  }

  // -------------------------------------------------------------------- sharing

  protected async share() {
    const items = this.items();
    if (items.length === 0 || this.busy()) return;

    this.busy.set(true);

    try {
      // The filter is baked in here rather than stored as metadata, so the photo looks the same to
      // everybody regardless of what renders it. Clips go up untouched.
      const media: NewPostMedia[] = [];

      for (const item of items) {
        const file =
          item.kind === 'Image' ? await applyFilter(item.file, item.filter.css) : item.file;

        media.push({
          file,
          aspectRatio: item.aspectRatio,
          durationMs: item.durationMs,
          poster: item.poster,
        });
      }

      // Positions are resolved now, against the final order, rather than being carried around as one.
      const order = new Map(items.map((item, position) => [item.id, position]));

      const labels = this.tags()
        .filter((tag) => order.has(tag.mediaId))
        .map((tag) => ({
          userId: tag.user.id,
          mediaPosition: order.get(tag.mediaId)!,
          x: tag.x,
          y: tag.y,
        }));

      this.api
        .createPost(media, this.caption().trim(), this.location().trim(), {
          commentsDisabled: this.commentsDisabled(),
          hideCounts: this.hideCounts(),
        })
        .subscribe({
          next: (post) => {
            const done = () => {
              this.busy.set(false);
              this.reset();
              this.caption.set('');
              this.location.set('');
              this.toasts.show('Shared.');
              this.router.navigate(['/p', post.id]);
            };

            if (labels.length === 0) {
              done();
              return;
            }

            // The post exists either way. A failed tag is worth saying out loud but not worth
            // pretending the whole thing failed over.
            this.api.setPostTags(post.id, labels).subscribe({
              next: done,
              error: () => {
                this.toasts.error('Shared, but the tags did not save.');
                done();
              },
            });
          },
          error: (err) => {
            this.busy.set(false);
            this.toasts.error(err.error?.message ?? 'Could not share that post.');
          },
        });
    } catch {
      this.busy.set(false);
      this.toasts.error('That file could not be processed.');
    }
  }
}
