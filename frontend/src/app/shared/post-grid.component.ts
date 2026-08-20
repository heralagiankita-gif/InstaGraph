import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../core/api.service';
import { Post } from '../core/models';

/**
 * The three-across grid used by Explore, a hashtag page and a profile.
 *
 * <p>
 * Set <code>masonry</code> and every ninth tile becomes twice as tall, which is what gives Explore its
 * uneven, magazine look. Dense packing fills the gap that leaves in the row beside it, so the grid never
 * has a hole in it.
 * </p>
 */
@Component({
  selector: 'app-post-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="grid" [class.masonry]="masonry()">
      @for (post of posts(); track post.id; let i = $index) {
        <a class="grid-tile" [class.tall]="masonry() && i % 9 === 4" [routerLink]="['/p', post.id]">
          <!-- Always the cover, never the run: a grid of thirty tiles should not load thirty carousels
               to draw thirty thumbnails. -->
          <img [src]="api.imageUrl(post.imageUrl)" [alt]="post.caption || 'Photo'" loading="lazy" />

          <!-- The corner mark says what opening this will get you — a clip, or something to swipe. -->
          @if (post.isReel) {
            <span class="mark"><i class="bi bi-play-btn-fill"></i></span>
          } @else if (post.media.length > 1) {
            <span class="mark"><i class="bi bi-images"></i></span>
          }

          @if (post.isPinned) {
            <span class="mark left"><i class="bi bi-pin-angle-fill"></i></span>
          }

          @if (post.commentCount > 0 || post.likeCount > 0) {
            <span class="overlay">
              <span><i class="bi bi-heart-fill"></i> {{ post.likeCount }}</span>
              <span><i class="bi bi-chat-fill"></i> {{ post.commentCount }}</span>
            </span>
          } @else {
            <span class="overlay"></span>
          }
        </a>
      }
    </div>
  `,
  styles: [
    `
      .grid.masonry {
        grid-auto-flow: row dense;
      }

      .mark {
        position: absolute;
        top: 8px;
        right: 8px;
        color: #fff;
        font-size: 15px;
        line-height: 1;
        /* No plate behind it — a shadow reads on a light photo and a dark one alike, and does not
           put a grey box in the corner of every tile. */
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.55);
        pointer-events: none;
      }

      .mark.left {
        right: auto;
        left: 8px;
      }
    `,
  ],
})
export class PostGridComponent {
  protected readonly api = inject(Api);

  readonly posts = input.required<Post[]>();
  readonly masonry = input(false);
}
