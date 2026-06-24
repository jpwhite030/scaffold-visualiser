import type { NextRequest } from 'next/server';

// Lightweight, dependency-free protection for the public API routes.
//
// The app itself is open (no login), but the API routes must not be free game
// for scripts/bots — /api/analyze spends money on every call (Anthropic) and
// /api/log-correction writes to Blob storage. Two cheap layers, no external
// services or env setup:
//
//   1. Same-origin check — a browser request made from this app carries an
//      Origin (on POST) or Referer (on GET) header pointing back at our own
//      host. A raw curl/script/bot call usually has neither, so we drop it.
//      This is spoofable by a determined attacker, but it stops the casual
//      "someone found the endpoint and is hammering it" abuse outright.
//
//   2. Per-IP rate limit — caps how fast any one client can call. State is an
//      in-memory Map living in the warm serverless instance, so across Vercel's
//      multiple instances / cold starts it's best-effort, not a hard ceiling.
//      Good enough to blunt a single abuser without adding Redis/KV.

interface Bucket {
  count: number;
  resetAt: number;
}

// Module-scoped: persists for the life of a warm serverless instance.
const buckets = new Map<string, Bucket>();

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim(); // first hop = the real client on Vercel
  return request.headers.get('x-real-ip') ?? 'unknown';
}

/** True if the request looks like it came from a page served by this same host. */
function isSameOrigin(request: NextRequest): boolean {
  const host = request.headers.get('host');
  if (!host) return false;

  // Browsers send Origin on every non-GET request (incl. same-origin POSTs).
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  // Same-origin GETs omit Origin but still send Referer — use it as a fallback.
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  // Neither header present → a direct, non-browser call → reject.
  return false;
}

export interface GuardOptions {
  /** Max requests allowed per IP within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/**
 * Gate an API route. Returns a `Response` to send back (request rejected), or
 * `null` to let the handler continue. Call it as the first line of the handler:
 *
 *   const blocked = guard(request, { limit: 10, windowMs: 60_000 });
 *   if (blocked) return blocked;
 */
export function guard(request: NextRequest, opts: GuardOptions): Response | null {
  if (!isSameOrigin(request)) {
    return Response.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const ip = clientIp(request);
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now > bucket.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + opts.windowMs });
  } else {
    bucket.count++;
    if (bucket.count > opts.limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      return Response.json(
        { error: 'Too many requests — please slow down and try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } }
      );
    }
  }

  // Opportunistic cleanup so the Map can't grow unbounded on a long-lived instance.
  if (buckets.size > 5000) {
    for (const [key, b] of buckets) {
      if (now > b.resetAt) buckets.delete(key);
    }
  }

  return null;
}
