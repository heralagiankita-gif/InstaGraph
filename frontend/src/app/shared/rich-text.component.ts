import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

interface Segment {
  text: string;
  tag?: string;
  mention?: string;
}

/**
 * Renders a caption or a comment with its #hashtags and @mentions turned into links.
 *
 * Split rather than interpolated as HTML: the text comes from other people, and building markup out of
 * it would be the one place an injection could get in. Every piece stays a bound text node.
 */
@Component({
  selector: 'app-rich-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `@for (segment of segments(); track $index) {
    @if (segment.tag) {
      <a class="link" [routerLink]="['/tags', segment.tag]">{{ segment.text }}</a>
    } @else if (segment.mention) {
      <a class="link" [routerLink]="['/', segment.mention]">{{ segment.text }}</a>
    } @else {
      <span>{{ segment.text }}</span>
    }
  }`,
  styles: [
    `
      :host {
        white-space: pre-wrap;
        word-break: break-word;
      }

      /*
        A mention or a hashtag, in the current vibe. Mixing the accent towards the ink rather than
        naming two colours means one rule covers light and dark: against black ink the accent darkens
        and stays readable, against white ink it lightens, and it follows the vibe either way.
      */
      .link {
        color: color-mix(in srgb, var(--accent) 74%, var(--ink));
        font-weight: 600;
      }

      .link:hover {
        text-decoration: underline;
      }
    `,
  ],
})
export class RichTextComponent {
  readonly text = input('');

  protected readonly segments = computed<Segment[]>(() =>
    (this.text() ?? '')
      // One split that keeps the delimiters, so the pieces reassemble into the original string.
      .split(/(#[\p{L}0-9_]+|@[a-z0-9._]{3,30})/giu)
      .filter((part) => part.length > 0)
      .map((part) => {
        if (part.startsWith('#')) {
          return { text: part, tag: part.slice(1).toLowerCase() };
        }

        if (part.startsWith('@')) {
          return { text: part, mention: part.slice(1).toLowerCase() };
        }

        return { text: part };
      }),
  );
}
