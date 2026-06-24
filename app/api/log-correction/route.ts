import { put } from '@vercel/blob';
import { NextRequest } from 'next/server';
import { guard } from '@/lib/apiGuard';

// Silently captures footprint corrections as a training dataset:
// (plan image, the AI's original outline, the user's corrected outline).
// Fire-and-forget from the client — failures here must never block the user,
// so everything is wrapped and we always return 200.
//
// Requires a Vercel Blob store connected to the project (env var
// BLOB_READ_WRITE_TOKEN, auto-injected by Vercel). If it's absent we no-op.
export const maxDuration = 30;

interface CorrectionPayload {
  imageDataUrl?: string | null;
  original?: [number, number][];
  corrected?: [number, number][];
  worldW?: number;
  worldD?: number;
  wasEdited?: boolean;
}

export async function POST(request: NextRequest) {
  // Writes to Blob storage — same-origin + rate-limited so it can't be spammed.
  const blocked = guard(request, { limit: 30, windowMs: 60_000 });
  if (blocked) return blocked;

  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      // Storage not configured yet — accept and discard so the client flow is unaffected.
      return Response.json({ ok: false, reason: 'storage_not_configured' });
    }

    const body = (await request.json()) as CorrectionPayload;

    const record = {
      capturedAt: new Date().toISOString(),
      worldW: body.worldW ?? null,
      worldD: body.worldD ?? null,
      wasEdited: body.wasEdited ?? null,
      original: body.original ?? null,
      corrected: body.corrected ?? null,
      imageDataUrl: body.imageDataUrl ?? null,
    };

    const key = `corrections/${record.capturedAt.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.json`;

    const blob = await put(key, JSON.stringify(record), {
      access: 'public',                // 'private' silently failed to write
      contentType: 'application/json',
      addRandomSuffix: true,           // unguessable URL
    });

    return Response.json({ ok: true, url: blob.url });
  } catch (err) {
    console.error('log-correction error:', err);
    // Surface the reason (still a 200 so the client flow never breaks) so this
    // is debuggable from the network tab.
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
