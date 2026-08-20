import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * The error envelope the Angular client already reads. Matching the .NET API's shape exactly is what
 * lets the frontend stay untouched: `interceptors.ts` and every screen look for `error.message`, and a
 * different field name here would turn every server-side rule into a silent generic failure.
 */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message: string) => new HttpError(401, message);
export const notFound = (message: string) => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
export const tooMany = (message: string) => new HttpError(429, message);

/**
 * Wraps a handler so thrown errors become the JSON envelope rather than Vercel's HTML crash page.
 *
 * The HTML matters more than it looks: the client distinguishes "this API said no" from "there is no
 * API here" by whether the body parses as JSON, so an unhandled throw would be reported to the user as
 * a missing backend.
 */
export function handler(
  fn: (req: VercelRequest, res: VercelResponse) => Promise<unknown>,
): (req: VercelRequest, res: VercelResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const body = await fn(req, res);

      if (!res.writableEnded) {
        res.status(200).json(body ?? {});
      }
    } catch (error) {
      const known = error instanceof HttpError;
      const status = known ? error.status : 500;

      // Only messages we wrote are shown. An unexpected failure could carry a connection string or a
      // query in its text, and that is not something to hand to a browser.
      const message = known
        ? error.message
        : 'Something went wrong on the server. Please try again.';

      if (!known) {
        console.error('Unhandled error in API handler:', error);
      }

      res.status(status).json({
        statusCode: status,
        message,
        path: req.url ?? '',
        timestamp: new Date().toISOString(),
      });
    }
  };
}

/** Rejects anything but the verb this route implements, so a stray GET is a clear 405, not a crash. */
export function methods(req: VercelRequest, ...allowed: string[]): void {
  if (!allowed.includes((req.method ?? 'GET').toUpperCase())) {
    throw new HttpError(405, `This endpoint accepts ${allowed.join(' or ')}.`);
  }
}

/** Vercel parses JSON bodies already; this only guards the shape so handlers can index it safely. */
export function body(req: VercelRequest): Record<string, unknown> {
  const parsed = typeof req.body === 'string' ? safeParse(req.body) : req.body;

  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function text(value: unknown, field: string, max = 400): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field} is required.`);
  }

  const trimmed = value.trim();

  if (trimmed.length > max) {
    throw badRequest(`${field} is too long.`);
  }

  return trimmed;
}
