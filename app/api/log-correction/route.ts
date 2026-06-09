import { put } from '@vercel/blob';
import { NextRequest } from 'next/server';

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

    await put(key, JSON.stringify(record), {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error('log-correction error:', err);
    // Never surface an error to the client — logging is best-effort.
    return Response.json({ ok: false });
  }
}
