import { PhotoFilter } from './filters';

/**
 * Reading a file well enough to post it.
 *
 * All of this happens in the browser because the browser is the only place it is cheap. It has already
 * decoded the image to show a preview, so its width and height are free; it can already play the video,
 * so the first frame and the duration are free. On the server none of that is true — there is no video
 * tooling behind the API, and a poster frame grabbed after the upload would mean decoding an MP4 in C#
 * to produce a thumbnail the client had in its hands a second earlier.
 */
export type MediaKind = 'Image' | 'Video';

/** One item picked in the composer, before anything has been sent. */
export interface PickedMedia {
  /** Stable across reorders, so an @for track and a tag's item reference survive a drag. */
  id: number;
  kind: MediaKind;
  /** What was chosen. The filter is applied to a copy at the moment of sharing. */
  file: File;
  /** An object URL for the preview. Revoked when the item is dropped. */
  previewUrl: string;
  aspectRatio: number;
  durationMs: number;
  /** The first frame of a clip. Null on a photo, and null when the grab failed. */
  poster: Blob | null;
  /** Photos only — there is no way to bake a CSS filter into a video without re-encoding it. */
  filter: PhotoFilter;
}

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'];

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

/** Instagram's own limit, and the API's. */
export const MAX_ITEMS = 10;

export function kindOf(file: File): MediaKind | null {
  if (IMAGE_TYPES.includes(file.type)) return 'Image';
  if (VIDEO_TYPES.includes(file.type)) return 'Video';

  // Some browsers hand back an empty type for a .mov dragged off a desktop, so the extension gets a
  // second look before the file is refused outright.
  return /\.(mp4|webm|mov|m4v)$/i.test(file.name) ? 'Video' : null;
}

/**
 * Measures a file and, for a clip, grabs its first frame.
 *
 * Never rejects: a missing measurement falls back to a square, and a missing poster falls back to the
 * browser drawing the first frame itself. Refusing to post something because its thumbnail could not be
 * captured would be the wrong trade.
 */
export async function inspect(file: File, id: number, filter: PhotoFilter): Promise<PickedMedia> {
  const kind = kindOf(file) ?? 'Image';
  const previewUrl = URL.createObjectURL(file);

  const base: PickedMedia = {
    id,
    kind,
    file,
    previewUrl,
    aspectRatio: 1,
    durationMs: 0,
    poster: null,
    filter,
  };

  try {
    return kind === 'Video'
      ? { ...base, ...(await inspectVideo(previewUrl)) }
      : { ...base, aspectRatio: await imageRatio(previewUrl) };
  } catch {
    return base;
  }
}

function imageRatio(url: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();

    img.onload = () => resolve(img.naturalWidth / Math.max(1, img.naturalHeight));
    img.onerror = () => resolve(1);
    img.src = url;
  });
}

/**
 * Loads enough of a clip to know its shape and length, then paints one frame onto a canvas.
 *
 * It seeks a tenth of a second in rather than to zero: the very first frame of a video is often black,
 * and a black thumbnail on a grid looks like a broken image rather than a video.
 */
function inspectVideo(
  url: string,
): Promise<{ aspectRatio: number; durationMs: number; poster: Blob | null }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const done = (poster: Blob | null) =>
      resolve({
        aspectRatio: video.videoWidth / Math.max(1, video.videoHeight) || 1,
        durationMs: Number.isFinite(video.duration) ? video.duration * 1000 : 0,
        poster,
      });

    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');

        if (!ctx || !canvas.width) {
          done(null);
          return;
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => done(blob), 'image/jpeg', 0.85);
      } catch {
        // A cross-origin or otherwise tainted canvas cannot be read. Nothing to do but go without.
        done(null);
      }
    };

    video.onerror = () => resolve({ aspectRatio: 1, durationMs: 0, poster: null });

    video.src = url;
  });
}

/** "0:42" — the length badge on a clip. */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
