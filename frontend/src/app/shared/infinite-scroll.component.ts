import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

/**
 * A sentinel that asks for the next page as it scrolls into view.
 *
 * Uses IntersectionObserver rather than a scroll listener: the browser reports the crossing itself, so
 * there is no handler running on every scroll frame doing layout maths. The <code>rootMargin</code>
 * fires it 400px early, which is enough for the next page to arrive before the reader reaches the end
 * and the list never visibly stalls.
 */
@Component({
  selector: 'app-infinite-scroll',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #sentinel class="sentinel" aria-hidden="true"></div>

    @if (loading()) {
      <div class="row center" style="padding: 18px 0 28px">
        <div class="spinner" style="margin: 0"></div>
      </div>
    } @else if (!hasMore() && showEnd()) {
      <p class="tiny muted" style="text-align:center; padding: 20px 0 32px">{{ endLabel() }}</p>
    }
  `,
  styles: [
    `
      .sentinel {
        height: 1px;
        width: 100%;
      }
    `,
  ],
})
export class InfiniteScrollComponent implements OnDestroy {
  readonly hasMore = input(false);
  readonly loading = input(false);
  readonly showEnd = input(true);
  readonly endLabel = input('No more posts');

  readonly more = output<void>();

  private readonly sentinel = viewChild.required<ElementRef<HTMLElement>>('sentinel');
  private observer?: IntersectionObserver;

  constructor() {
    effect(() => {
      const target = this.sentinel().nativeElement;

      // Rebuilt whenever the inputs change so a stale observer cannot keep firing after the list ends.
      this.observer?.disconnect();

      if (!this.hasMore()) {
        return;
      }

      this.observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting) && this.hasMore() && !this.loading()) {
            this.more.emit();
          }
        },
        { root: null, rootMargin: '400px 0px', threshold: 0 },
      );

      this.observer.observe(target);
    });
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }
}
