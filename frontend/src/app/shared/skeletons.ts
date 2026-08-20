import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Placeholders shaped like the thing that is loading.
 *
 * A spinner tells you to wait; a skeleton tells you what is coming and stops the page jumping when it
 * arrives, because the space is already the right size.
 */
@Component({
  selector: 'app-feed-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (i of items(); track i) {
      <div class="card post">
        <div class="row gap-12 head">
          <span class="sk sk-circle" style="width:34px;height:34px"></span>
          <span class="col gap-4 grow">
            <span class="sk" style="width:120px;height:11px"></span>
            <span class="sk" style="width:70px;height:9px"></span>
          </span>
        </div>

        <div class="sk media"></div>

        <div class="col gap-8 body">
          <span class="sk" style="width:90px;height:11px"></span>
          <span class="sk" style="width:100%;height:11px"></span>
          <span class="sk" style="width:60%;height:11px"></span>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .post {
        margin-bottom: 20px;
        overflow: hidden;
      }

      .head {
        padding: 12px;
      }

      .media {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 0;
      }

      .body {
        padding: 14px;
      }
    `,
  ],
})
export class FeedSkeletonComponent {
  readonly count = input(2);

  protected items() {
    return Array.from({ length: this.count() }, (_, i) => i);
  }
}

@Component({
  selector: 'app-grid-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid">
      @for (i of items(); track i) {
        <span class="sk tile"></span>
      }
    </div>
  `,
  styles: [
    `
      .tile {
        aspect-ratio: 1;
        display: block;
        border-radius: 4px;
      }
    `,
  ],
})
export class GridSkeletonComponent {
  readonly count = input(9);

  protected items() {
    return Array.from({ length: this.count() }, (_, i) => i);
  }
}

@Component({
  selector: 'app-list-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (i of items(); track i) {
      <div class="row gap-12" style="padding:8px 0">
        <span class="sk sk-circle" style="width:44px;height:44px"></span>
        <span class="col gap-4 grow">
          <span class="sk" style="width:130px;height:11px"></span>
          <span class="sk" style="width:90px;height:9px"></span>
        </span>
      </div>
    }
  `,
})
export class ListSkeletonComponent {
  readonly count = input(4);

  protected items() {
    return Array.from({ length: this.count() }, (_, i) => i);
  }
}
