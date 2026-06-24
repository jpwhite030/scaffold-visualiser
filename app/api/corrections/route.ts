import { list } from '@vercel/blob';
import type { NextRequest } from 'next/server';
import { guard } from '@/lib/apiGuard';

// Lists the captured footprint corrections.
// Used by the /corrections viewer to confirm logging works and to pull the data.
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  // Same-origin + rate-limited so the dataset listing isn't trivially scraped.
  const blocked = guard(request, { limit: 30, windowMs: 60_000 });
  if (blocked) return blocked;

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return Response.json({ ok: false, reason: 'storage_not_configured', count: 0, items: [] });
    }

    const items: { url: string; pathname: string; size: number; uploadedAt: string }[] = [];
    let cursor: string | undefined;
    do {
      const res = await list({ prefix: 'corrections/', cursor, limit: 1000 });
      for (const b of res.blobs) {
        items.push({ url: b.url, pathname: b.pathname, size: b.size, uploadedAt: String(b.uploadedAt) });
      }
      cursor = res.hasMore ? res.cursor : undefined;
    } while (cursor);

    items.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1)); // newest first
    return Response.json({ ok: true, count: items.length, items });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err), count: 0, items: [] });
  }
}
