/**
 * The filter strip.
 *
 * Each one is a plain CSS filter string. The same string does two jobs: it styles the live preview via
 * `style.filter`, and it is handed to `canvas.getContext('2d').filter` to bake the effect into the file
 * that actually gets uploaded. So what you see before pressing Share is what is stored.
 */
export interface PhotoFilter {
  name: string;
  css: string;
}

export const FILTERS: PhotoFilter[] = [
  { name: 'Original', css: 'none' },
  { name: 'Clarendon', css: 'contrast(1.2) saturate(1.35) brightness(1.05)' },
  { name: 'Gingham', css: 'brightness(1.05) hue-rotate(-10deg) contrast(0.9)' },
  { name: 'Moon', css: 'grayscale(1) contrast(1.1) brightness(1.1)' },
  { name: 'Lark', css: 'contrast(0.9) brightness(1.1) saturate(1.1)' },
  { name: 'Reyes', css: 'sepia(0.22) brightness(1.1) contrast(0.85) saturate(0.75)' },
  { name: 'Juno', css: 'saturate(1.4) contrast(1.1) sepia(0.08)' },
  { name: 'Slumber', css: 'saturate(0.66) brightness(1.05) sepia(0.12)' },
  { name: 'Crema', css: 'sepia(0.25) contrast(1.05) brightness(1.04) saturate(0.9)' },
  { name: 'Aden', css: 'hue-rotate(-20deg) contrast(0.9) saturate(0.85) brightness(1.1)' },
  { name: 'Perpetua', css: 'contrast(1.1) brightness(1.05) saturate(1.15) hue-rotate(8deg)' },
  { name: 'Inkwell', css: 'grayscale(1) brightness(1.15) contrast(1.25)' },
];

/**
 * Redraws the image through the chosen filter and returns a new file.
 *
 * Falls back to the original whenever anything is missing — an unfiltered upload is a much better
 * outcome than a failed one, and `ctx.filter` is not supported everywhere.
 */
export async function applyFilter(file: File, css: string, maxEdge = 1440): Promise<File> {
  if (!css || css === 'none') {
    return file;
  }

  try {
    const bitmap = await loadBitmap(file);

    // Large phone photos are shrunk on the way through: 1440px is more than any of these layouts show,
    // and it keeps the upload well under the size limit.
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');

    if (!ctx || !('filter' in ctx)) {
      return file;
    }

    ctx.filter = css;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    );

    if (!blob) {
      return file;
    }

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

function loadBitmap(file: File): Promise<HTMLImageElement | ImageBitmap> {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };

    img.src = url;
  });
}
