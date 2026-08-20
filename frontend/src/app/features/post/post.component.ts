import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Api } from '../../core/api.service';
import { Clock } from '../../core/clock.service';
import { Comment, Post } from '../../core/models';
import { Toasts } from '../../core/toast.service';
import { RichTextComponent } from '../../shared/rich-text.component';
import { PostMediaComponent } from '../../shared/post-media.component';
import {
  AgoPipe,
  AvatarComponent,
  PostDatePipe,
  SpinnerComponent,
  VerifiedBadgeComponent,
} from '../../shared/ui';

/** One photo, full size, with the whole comment thread beside it. */
@Component({
  selector: 'app-post',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    FormsModule,
    DecimalPipe,
    AvatarComponent,
    AgoPipe,
    PostDatePipe,
    SpinnerComponent,
    RichTextComponent,
    PostMediaComponent,
    VerifiedBadgeComponent,
  ],
  template: `
    @if (!post()) {
      <app-spinner />
    } @else if (post(); as p) {
      <div class="card wrapper">
        <div class="photo">
          <app-post-media [post]="p" (doubleTap)="onDoubleTap()" (watched)="countView()" />
        </div>

        <div class="panel">
          <header class="row gap-10 panel-head">
            <a [routerLink]="['/', p.author.username]"><app-avatar [user]="p.author" [size]="34" /></a>

            <div class="col grow" style="min-width:0">
              <span class="row gap-4">
                <a class="username" [routerLink]="['/', p.author.username]">{{ p.author.username }}</a>
                <app-verified [user]="p.author" />
              </span>
              @if (p.location) {
                <span class="tiny muted">{{ p.location }}</span>
              }
            </div>

            @if (p.isMine) {
              <button class="btn-ghost" type="button" (click)="openEdit()">Edit</button>
              <button class="btn-ghost btn-danger" type="button" (click)="remove()">Delete</button>
            }
          </header>

          <div class="thread">
            @if (p.caption) {
              <div class="row gap-10 entry">
                <app-avatar [user]="p.author" [size]="32" />
                <div class="col">
                  <div>
                    <a class="username" [routerLink]="['/', p.author.username]">{{ p.author.username }}</a>
                    <app-rich-text [text]="p.caption" />
                  </div>
                  <span class="tiny muted">{{ p.createdAt | ago: clock.now() }}</span>
                </div>
              </div>
            }

            @if (loadingComments()) {
              <app-spinner />
            } @else if (comments().length === 0) {
              <div class="col center" style="padding:36px 0;text-align:center">
                <span class="strong">No comments yet</span>
                <span class="small muted">Start the conversation.</span>
              </div>
            } @else {
              @for (comment of comments(); track comment.id) {
                <div class="col gap-8">
                  <!-- top-level -->
                  <div class="row gap-10 entry">
                    <a [routerLink]="['/', comment.author.username]">
                      <app-avatar [user]="comment.author" [size]="32" />
                    </a>

                    <div class="col grow" style="min-width:0">
                      <div>
                        <a class="username" [routerLink]="['/', comment.author.username]">
                          {{ comment.author.username }}
                        </a>
                        <app-rich-text [text]="comment.text" />
                      </div>

                      <div class="row gap-12 meta">
                        <span class="tiny muted">{{ comment.createdAt | ago: clock.now() }}</span>
                        @if (comment.likeCount > 0) {
                          <span class="tiny muted">{{ comment.likeCount }} {{ comment.likeCount === 1 ? 'like' : 'likes' }}</span>
                        }
                        <button class="tiny plain" type="button" (click)="startReply(comment)">Reply</button>
                        @if (comment.isMine || p.isMine) {
                          <button class="tiny plain" type="button" (click)="removeComment(comment)">Delete</button>
                        }
                      </div>
                    </div>

                    <button type="button" class="heart" (click)="toggleCommentLike(comment)"
                            [attr.aria-label]="comment.isLiked ? 'Unlike comment' : 'Like comment'">
                      <i class="bi" [class.bi-heart-fill]="comment.isLiked" [class.bi-heart]="!comment.isLiked"
                         [class.liked]="comment.isLiked"></i>
                    </button>
                  </div>

                  <!-- its replies, one level only -->
                  @if (comment.replies.length > 0) {
                    <div class="replies">
                      @if (!expanded().has(comment.id)) {
                        <button class="tiny plain line" type="button" (click)="expand(comment.id)">
                          — View {{ comment.replies.length }}
                          {{ comment.replies.length === 1 ? 'reply' : 'replies' }}
                        </button>
                      } @else {
                        @for (reply of comment.replies; track reply.id) {
                          <div class="row gap-10 entry">
                            <a [routerLink]="['/', reply.author.username]">
                              <app-avatar [user]="reply.author" [size]="26" />
                            </a>

                            <div class="col grow" style="min-width:0">
                              <div>
                                <a class="username" [routerLink]="['/', reply.author.username]">
                                  {{ reply.author.username }}
                                </a>
                                <app-rich-text [text]="reply.text" />
                              </div>
                              <div class="row gap-12 meta">
                                <span class="tiny muted">{{ reply.createdAt | ago: clock.now() }}</span>
                                <button class="tiny plain" type="button" (click)="startReply(comment, reply)">
                                  Reply
                                </button>
                                @if (reply.isMine || p.isMine) {
                                  <button class="tiny plain" type="button" (click)="removeComment(reply)">
                                    Delete
                                  </button>
                                }
                              </div>
                            </div>

                            <button type="button" class="heart" (click)="toggleCommentLike(reply)">
                              <i class="bi" [class.bi-heart-fill]="reply.isLiked" [class.bi-heart]="!reply.isLiked"
                                 [class.liked]="reply.isLiked"></i>
                            </button>
                          </div>
                        }

                        <button class="tiny plain line" type="button" (click)="collapse(comment.id)">
                          — Hide replies
                        </button>
                      }
                    </div>
                  }
                </div>
              }
            }
          </div>

          <div class="actions">
            <button type="button" class="icon" (click)="toggleLike()" aria-label="Like">
              <i class="bi" [class.bi-heart-fill]="p.isLiked" [class.bi-heart]="!p.isLiked"
                 [class.liked]="p.isLiked"></i>
            </button>
            <button type="button" class="icon" (click)="copyLink()" aria-label="Copy link">
              <i class="bi bi-send"></i>
            </button>

            <span class="grow"></span>

            <button type="button" class="icon" (click)="toggleSave()" aria-label="Save">
              <i class="bi" [class.bi-bookmark-fill]="p.isSaved" [class.bi-bookmark]="!p.isSaved"></i>
            </button>
          </div>

          <div class="counts">
            <div class="strong">{{ p.likeCount | number }} {{ p.likeCount === 1 ? 'like' : 'likes' }}</div>
            <div class="tiny muted">{{ p.createdAt | postDate }}</div>
          </div>

          @if (replyingTo(); as target) {
            <div class="replying tiny muted">
              Replying to <span class="strong">&#64;{{ target.username }}</span>
              <button type="button" class="plain tiny" (click)="cancelReply()">Cancel</button>
            </div>
          }

          <form class="comment-bar" (ngSubmit)="submit()">
            <input
              #commentBox
              class="comment-input"
              name="text"
              [placeholder]="replyingTo() ? 'Write a reply…' : 'Add a comment…'"
              maxlength="1000"
              [ngModel]="draft()"
              (ngModelChange)="draft.set($event)" />
            <button type="submit" class="btn-ghost strong" [disabled]="!draft().trim() || posting()">Post</button>
          </form>
        </div>
      </div>
    }

    <!-- ------------------------------------------------------ edit caption -->
    @if (editing()) {
      <div class="modal-backdrop" (click)="editing.set(false)">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-head">Edit post</div>

          <div style="padding:16px">
            <textarea
              class="textarea mb-12"
              name="caption"
              maxlength="2200"
              placeholder="Write a caption… #tags and @mentions both work"
              [ngModel]="editCaption()"
              (ngModelChange)="editCaption.set($event)"></textarea>

            <input
              class="input mb-16"
              name="location"
              maxlength="120"
              placeholder="Location"
              [ngModel]="editLocation()"
              (ngModelChange)="editLocation.set($event)" />

            <label class="row between switch">
              <span class="col">
                <span class="small">Turn off commenting</span>
                <span class="tiny muted">Existing comments stay; no new ones can be left.</span>
              </span>
              <input
                type="checkbox"
                [ngModel]="editComments()"
                (ngModelChange)="editComments.set($event)"
                name="comments" />
            </label>

            <label class="row between switch mb-16">
              <span class="col">
                <span class="small">Hide like and view counts</span>
                <span class="tiny muted">Only you will see the numbers on this post.</span>
              </span>
              <input
                type="checkbox"
                [ngModel]="editHideCounts()"
                (ngModelChange)="editHideCounts.set($event)"
                name="hideCounts" />
            </label>

            <button class="btn btn-block" type="button" [disabled]="savingCaption()" (click)="saveCaption()">
              {{ savingCaption() ? 'Saving…' : 'Save' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      /* The same proportions as the dialog the real one opens on a grid tile: the photo on black,
         a fixed 405px column of comments beside it. */
      .wrapper {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 405px;
        max-width: 1035px;
        margin: 0 auto;
        overflow: hidden;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 4px;
      }

      .photo {
        background: #000;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .photo app-post-media {
        width: 100%;
      }

      .panel {
        display: flex;
        flex-direction: column;
        border-left: 1px solid var(--border);
        max-height: 78vh;
      }

      .panel-head {
        padding: 12px 14px;
        border-bottom: 1px solid var(--border);
        gap: 10px;
      }

      .thread {
        flex: 1;
        overflow-y: auto;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      .entry span {
        white-space: pre-wrap;
      }

      .entry .username {
        margin-right: 5px;
      }

      .tag {
        color: color-mix(in srgb, var(--accent) 74%, var(--ink));
      }

      .actions {
        display: flex;
        gap: 4px;
        padding: 6px 8px 0;
        border-top: 1px solid var(--border);
      }

      .icon {
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 22px;
        padding: 6px 8px;
        line-height: 1;
      }

      .icon .liked {
        color: var(--danger);
      }

      .counts {
        padding: 0 14px 8px;
      }

      .plain {
        border: 0;
        background: transparent;
        color: var(--ink-3);
        padding: 0;
        font-weight: 600;
      }

      .plain:hover {
        color: var(--ink);
      }

      .meta {
        margin-top: 2px;
      }

      .heart {
        border: 0;
        background: transparent;
        color: var(--ink);
        font-size: 12px;
        padding: 2px;
        align-self: flex-start;
      }

      .heart .liked {
        color: var(--danger);
      }

      /* Replies are indented and share one guide line, so a thread reads as one block. */
      .replies {
        margin-left: 42px;
        padding-left: 12px;
        border-left: 1px solid var(--border);
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .line {
        align-self: flex-start;
      }

      .replying {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 14px;
        border-top: 1px solid var(--border);
        background: var(--border-soft);
      }

      .comment-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        border-top: 1px solid var(--border);
        padding: 6px 12px;
      }

      .comment-input {
        flex: 1;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--ink);
        font-family: inherit;
        font-size: 14px;
        padding: 10px 0;
      }

      @media (max-width: 900px) {
        .wrapper {
          grid-template-columns: 1fr;
        }

        .panel {
          border-left: 0;
          border-top: 1px solid var(--border);
          max-height: none;
        }
      }
    `,
  ],
})
export class PostComponent {
  protected readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);
  protected readonly clock = inject(Clock);

  readonly id = input.required<string>();

  protected readonly post = signal<Post | null>(null);
  protected readonly comments = signal<Comment[]>([]);
  protected readonly loadingComments = signal(true);
  protected readonly draft = signal('');
  protected readonly posting = signal(false);

  /** Which top-level comments have their replies open. */
  protected readonly expanded = signal(new Set<number>());

  /** The comment being answered, if any — always the top-level one it belongs to. */
  protected readonly replyingTo = signal<{ id: number; username: string } | null>(null);

  protected readonly editing = signal(false);
  protected readonly editComments = signal(false);
  protected readonly editHideCounts = signal(false);
  protected readonly editCaption = signal('');
  protected readonly editLocation = signal('');
  protected readonly savingCaption = signal(false);

  constructor() {
    effect(() => {
      const id = Number(this.id());

      this.post.set(null);
      this.comments.set([]);
      this.loadingComments.set(true);

      this.api.post(id).subscribe({
        next: (post) => this.post.set(post),
        error: (err) => {
          this.toasts.error(err.error?.message ?? 'That post is not available.');
          this.router.navigate(['/']);
        },
      });

      this.api.comments(id, 1, 50).subscribe({
        next: (page) => {
          this.comments.set(page.items);
          this.loadingComments.set(false);
        },
        error: () => this.loadingComments.set(false),
      });
    });
  }

  /**
   * Double-tapping something already liked shows nothing and changes nothing. Unliking on a double tap
   * is a way to lose a like by accident, so the gesture only ever adds one.
   */
  protected onDoubleTap() {
    if (!this.post()?.isLiked) {
      this.toggleLike();
    }
  }

  /** A clip has been watched. Counted once per viewer server-side, so this fires and forgets. */
  protected countView() {
    const current = this.post();
    if (!current) return;

    this.api.viewPost(current.id).subscribe({ error: () => undefined });
  }

  protected toggleLike() {
    const current = this.post();
    if (!current) return;

    const request = current.isLiked ? this.api.unlike(current.id) : this.api.like(current.id);

    request.subscribe({
      next: (result) => this.post.set({ ...current, isLiked: result.isLiked, likeCount: result.likeCount }),
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not update that like.'),
    });
  }

  protected toggleSave() {
    const current = this.post();
    if (!current) return;

    const request = current.isSaved ? this.api.unsave(current.id) : this.api.save(current.id);

    request.subscribe({
      next: (result) => {
        this.post.set({ ...current, isSaved: result.isSaved });
        this.toasts.show(result.isSaved ? 'Saved.' : 'Removed from saved.');
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not save that post.'),
    });
  }

  // ----------------------------------------------------------- the thread

  protected expand(id: number) {
    this.expanded.update((set) => new Set(set).add(id));
  }

  protected collapse(id: number) {
    this.expanded.update((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
  }

  /**
   * Answering a reply still attaches to the top-level comment — one level of nesting only — but the
   * @handle is pre-filled so it is clear who is being answered.
   */
  protected startReply(root: Comment, reply?: Comment) {
    const target = reply ?? root;
    this.replyingTo.set({ id: root.id, username: target.author.username });
    this.expand(root.id);

    if (!this.draft().startsWith(`@${target.author.username}`)) {
      this.draft.set(`@${target.author.username} `);
    }
  }

  protected cancelReply() {
    this.replyingTo.set(null);
    this.draft.set('');
  }

  protected submit() {
    const current = this.post();
    const text = this.draft().trim();
    if (!current || !text || this.posting()) return;

    this.posting.set(true);
    const parent = this.replyingTo();

    this.api.addComment(current.id, text, parent?.id).subscribe({
      next: (comment) => {
        if (parent) {
          this.comments.update((all) =>
            all.map((c) =>
              c.id === parent.id
                ? { ...c, replies: [...c.replies, comment], replyCount: c.replyCount + 1 }
                : c,
            ),
          );
          this.expand(parent.id);
        } else {
          this.comments.update((all) => [...all, comment]);
        }

        this.post.set({ ...current, commentCount: current.commentCount + 1 });
        this.draft.set('');
        this.replyingTo.set(null);
        this.posting.set(false);
      },
      error: (err) => {
        this.posting.set(false);
        this.toasts.error(err.error?.message ?? 'Could not post that comment.');
      },
    });
  }

  protected toggleCommentLike(comment: Comment) {
    const request = comment.isLiked
      ? this.api.unlikeComment(comment.id)
      : this.api.likeComment(comment.id);

    request.subscribe({
      next: (result) => {
        const patch = (c: Comment): Comment =>
          c.id === comment.id
            ? { ...c, isLiked: result.isLiked, likeCount: result.likeCount }
            : { ...c, replies: c.replies.map(patch) };

        this.comments.update((all) => all.map(patch));
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not update that like.'),
    });
  }

  protected removeComment(comment: Comment) {
    const current = this.post();
    if (!current) return;

    // Deleting a top-level comment takes its replies with it, so the count drops by the whole subtree.
    const removed = 1 + (comment.replies?.length ?? 0);

    this.api.deleteComment(comment.id).subscribe({
      next: () => {
        this.comments.update((all) =>
          all
            .filter((c) => c.id !== comment.id)
            .map((c) => ({
              ...c,
              replies: c.replies.filter((r) => r.id !== comment.id),
              replyCount: c.replies.some((r) => r.id === comment.id)
                ? Math.max(0, c.replyCount - 1)
                : c.replyCount,
            })),
        );

        this.post.set({ ...current, commentCount: Math.max(0, current.commentCount - removed) });
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not delete that comment.'),
    });
  }

  // ------------------------------------------------------------ edit caption

  protected openEdit() {
    const current = this.post();
    if (!current) return;

    this.editCaption.set(current.caption);
    this.editLocation.set(current.location ?? '');
    this.editComments.set(current.commentsDisabled);
    this.editHideCounts.set(current.hideCounts);
    this.editing.set(true);
  }

  protected saveCaption() {
    const current = this.post();
    if (!current) return;

    this.savingCaption.set(true);

    this.api
      .updateCaption(current.id, this.editCaption().trim(), this.editLocation().trim(), {
        commentsDisabled: this.editComments(),
        hideCounts: this.editHideCounts(),
      })
      .subscribe({
        next: (updated) => {
          this.post.set(updated);
          this.savingCaption.set(false);
          this.editing.set(false);
          this.toasts.show('Post updated.');
        },
        error: (err) => {
          this.savingCaption.set(false);
          this.toasts.error(err.error?.message ?? 'Could not update that post.');
        },
      });
  }

  protected remove() {
    const current = this.post();
    if (!current) return;

    this.api.deletePost(current.id).subscribe({
      next: () => {
        this.toasts.show('Post deleted.');
        this.router.navigate(['/', current.author.username]);
      },
      error: (err) => this.toasts.error(err.error?.message ?? 'Could not delete that post.'),
    });
  }

  protected copyLink() {
    navigator.clipboard?.writeText(location.href).then(
      () => this.toasts.show('Link copied.'),
      () => undefined,
    );
  }
}
