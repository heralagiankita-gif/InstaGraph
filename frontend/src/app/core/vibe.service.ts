import { Injectable, signal } from '@angular/core';

/**
 * The colour half of the interface, independently of light and dark.
 *
 * <p>
 * A vibe swaps the accent, the gradient behind the wordmark and the story rings, the glow under a
 * primary button, and the three blobs washing the page background. It never touches the neutral scale,
 * so every vibe works in either theme and the two choices can be made in any order.
 * </p>
 *
 * <p>
 * Aurora writes no attribute at all — the same trick the theme service uses for "system" — so the
 * defaults in styles.css are the ones a first-time visitor gets, with no flash of another palette while
 * the app boots.
 * </p>
 */
export type VibeId = 'aurora' | 'sunset' | 'y2k' | 'matcha' | 'cyber' | 'bubblegum' | 'classic';

export interface Vibe {
  id: VibeId;
  name: string;
  /** The one line under the name in the picker. */
  blurb: string;
  /** The three stops drawn in the swatch. Duplicated from the CSS on purpose: the picker has to paint
      every vibe at once, and only the selected one's custom properties are in scope. */
  stops: [string, string, string];
  /** Text colour that stays readable across all three stops — the --brand-ink of the same vibe. */
  ink: string;
}

export const VIBES: readonly Vibe[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    blurb: 'Pink, violet, ice blue',
    stops: ['#ff5f9e', '#a44cff', '#35d3ff'],
    ink: '#ffffff',
  },
  {
    id: 'sunset',
    name: 'Sunset',
    blurb: 'Golden hour, every hour',
    stops: ['#ffc531', '#ff5a36', '#ff2d78'],
    ink: '#2a0d05',
  },
  {
    id: 'y2k',
    name: 'Y2K',
    blurb: 'Chrome, cyan and hot pink',
    stops: ['#59f0ff', '#b39dff', '#ff35c8'],
    ink: '#0d0a22',
  },
  {
    id: 'matcha',
    name: 'Matcha',
    blurb: 'Quiet greens, easy on the eyes',
    stops: ['#d7f56b', '#3fa34d', '#0f766e'],
    ink: '#08210f',
  },
  {
    id: 'cyber',
    name: 'Cyber',
    blurb: 'Acid green on midnight',
    stops: ['#00e5a0', '#7cf03d', '#b14bff'],
    ink: '#04120d',
  },
  {
    id: 'bubblegum',
    name: 'Bubblegum',
    blurb: 'Soft, sweet, a bit much',
    stops: ['#ffd6e8', '#ff6392', '#7ec8ff'],
    ink: '#2b0f1c',
  },
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'The original blue',
    stops: ['#f9ce34', '#ee2a7b', '#6228d7'],
    ink: '#2b1004',
  },
];

const VIBE_KEY = 'instagraph.vibe';
const AURA_KEY = 'instagraph.aura';

@Injectable({ providedIn: 'root' })
export class VibeService {
  readonly vibe = signal<VibeId>(readVibe());

  /** The drifting blobs behind the page. Off is a plain background, for anyone who finds it busy. */
  readonly aura = signal<boolean>(readAura());

  readonly all = VIBES;

  constructor() {
    // The boot script in index.html has already stamped both attributes; re-applying them here costs
    // nothing and keeps this service the single source of truth once the app is running.
    this.applyVibe(this.vibe());
    this.applyAura(this.aura());
  }

  set(id: VibeId) {
    this.vibe.set(id);
    safeWrite(VIBE_KEY, id);
    this.applyVibe(id);
  }

  setAura(on: boolean) {
    this.aura.set(on);
    safeWrite(AURA_KEY, on ? 'on' : 'off');
    this.applyAura(on);
  }

  /** The vibe currently on, as an object — for anything that wants its name or its stops. */
  current(): Vibe {
    return VIBES.find((v) => v.id === this.vibe()) ?? VIBES[0];
  }

  private applyVibe(id: VibeId) {
    const root = document.documentElement;

    if (id === 'aurora') {
      root.removeAttribute('data-vibe');
    } else {
      root.setAttribute('data-vibe', id);
    }
  }

  private applyAura(on: boolean) {
    const root = document.documentElement;

    if (on) {
      root.removeAttribute('data-aura');
    } else {
      root.setAttribute('data-aura', 'off');
    }
  }
}

function readVibe(): VibeId {
  const stored = safeRead(VIBE_KEY);
  return VIBES.some((v) => v.id === stored) ? (stored as VibeId) : 'aurora';
}

function readAura(): boolean {
  return safeRead(AURA_KEY) !== 'off';
}

/** localStorage throws outright in private mode on some browsers, and a colour is not worth a crash. */
function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nothing to do: the choice lasts for this session only */
  }
}
