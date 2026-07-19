import type { NextRequest } from 'next/server';
import { guard } from '@/lib/apiGuard';

// Address → lat/lng via OpenStreetMap Nominatim, proxied server-side so the
// browser never hits the geocoder directly (CORS + rate-limit etiquette).
// Low volume — one call per saved job — well inside Nominatim's usage policy.
export const maxDuration = 15;

export async function GET(request: NextRequest) {
  const blocked = guard(request, { limit: 10, windowMs: 60_000 });
  if (blocked) return blocked;

  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) return Response.json({ ok: false, error: 'Missing q.' }, { status: 400 });

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'scaffold-visualiser/1.0 (jack@skelscaff.com.au)' },
      cache: 'no-store',
    });
    if (!res.ok) return Response.json({ ok: false, error: `Geocoder returned ${res.status}.` });

    const results = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    if (!Array.isArray(results) || results.length === 0) {
      return Response.json({ ok: false, error: 'Address not found — set the pin manually.' });
    }
    const top = results[0];
    const lat = Number(top.lat), lng = Number(top.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json({ ok: false, error: 'Geocoder returned an unusable result.' });
    }
    return Response.json({ ok: true, lat, lng, display: top.display_name });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}
