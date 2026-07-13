import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { NextRequest } from 'next/server';
import { ensureCCW, footprintBounds } from '@/lib/buildingTypes';
import { SiteData, SiteBuilding, SiteBuildingKind, SiteSurface, SurfaceKind, centerSite, newSiteBuilding, syncFaceArrays, siteUid } from '@/lib/siteTypes';
import { guard } from '@/lib/apiGuard';

const client = new Anthropic();
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const SYSTEM_PROMPT = `You are an expert at reading Australian residential SITE PLANS and extracting the whole block for 3D modelling: the lot boundary, every building on the site, and the driveway. Scaffolders use this to plan scaffold across the entire job site.

═══ PART 1 — LOT BOUNDARY ═══

The lot boundary is the outermost property line, usually drawn as a heavy or dash-dot line enclosing everything, with boundary dimensions written along each side (metre values like "20.115", "44.72" — often with bearings like 273°15').

CRITICAL RULES for the boundary:
• Boundary corners are OFTEN NOT 90° — battle-axe blocks, corner lots and irregular subdivisions have angled sides. Trace the true angles; do NOT square them up.
• ANCHOR THE SCALE to the boundary dimension labels: the length of each boundary edge in your coordinates must equal its printed metre value. These printed boundary lengths are the most reliable numbers on a site plan — derive every other coordinate from this scale.
• Typical Australian residential lots are 10–30 m wide and 25–50 m deep (300–1000 m²). If your boundary is far outside this, re-check the scale.

═══ PART 2 — BUILDINGS ═══

Identify every roofed structure inside the boundary and classify it from its label:
• "PROPOSED DWELLING" / "RESIDENCE" / "DWELLING" / "HOUSE" → kind "house"
• "GARAGE" / "CARPORT" → kind "garage"
• "GRANNY FLAT" / "SECONDARY DWELLING" / "STUDIO" → kind "granny_flat"
• "SHED" / "WORKSHOP" → kind "shed"
Include existing AND proposed structures. An attached garage under the same roof as the dwelling is part of the house footprint, not a separate building.

Building outlines on a site plan:
• Building corners ARE 90° — trace rectangles and L-shapes with right angles.
• SETBACK dimensions (boundary → wall distances like "4.5", "900") are the best cross-check for each building's POSITION inside the lot — use them to place footprints accurately.
• Trace the wall line, not the roof/eave overhang line (the roof line is usually a thin outer line ~0.45–0.6 m outside the walls).
• num_stories: only if labelled (e.g. "TWO STOREY", "2 STOREY") — otherwise 1.
• Heights are NOT shown on site plans. Do not guess them; the reviewer sets heights later.

═══ PART 3 — SURFACES ═══

• Driveway: polygon labelled "DRIVEWAY" or hatched concrete from the street crossover to the garage → kind "driveway"
• Paths labelled "PATH"/"PAVING" → kind "path"
• Swimming pool clearly drawn → kind "pool"
Only include surfaces that are clearly drawn. Skip landscaping, grass, and easements.

═══ COORDINATES ═══

X = horizontal (left=neg, right=pos), Z = vertical in plan (bottom=neg, top=pos). Use one shared metre coordinate system for the boundary, all buildings and all surfaces, centred roughly on the middle of the lot. Everything must be in the SAME frame so buildings sit at their true positions inside the boundary.

═══ OUTPUT ═══

Respond with ONLY this raw JSON — no explanation, no markdown, no code fences:
{"site_width_m":<m>,"site_depth_m":<m>,"boundary":[[x,z],...],"buildings":[{"kind":"house"|"garage"|"granny_flat"|"shed","label":"<label from plan>","footprint":[[x,z],...],"num_stories":<1|2>}],"surfaces":[{"kind":"driveway"|"path"|"pool","polygon":[[x,z],...]}]}

site_width_m / site_depth_m = the boundary's overall bounding-box width and depth in metres.`;

const USER_PROMPT = `Extract the whole site from this site plan: lot boundary, every building, and the driveway. Output ONLY the JSON — no explanation, no markdown.

STEP 1 — Find the lot boundary (the outermost property line) and read the printed boundary dimensions on each side. Build the boundary polygon so each edge length equals its printed metre value. Keep angled sides angled.
STEP 2 — Trace each building's wall outline (90° corners) in the same coordinate frame, using setback dimensions to position it inside the boundary. Classify each from its label (house / garage / granny_flat / shed) and read storeys only if labelled.
STEP 3 — Trace the driveway polygon (and any clear path or pool).
STEP 4 — Cross-check: every building and surface must sit inside the boundary; the boundary bbox must match site_width_m × site_depth_m; a residential lot is typically 300–1000 m².`;

// Opus 4.8 + adaptive thinking on a plan can take a while — give the function
// room so it isn't killed mid-analysis.
export const maxDuration = 60;

function polygonArea(pts: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(area) / 2;
}

function centroid(pts: [number, number][]): [number, number] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [cx, cz];
}

function isPolygon(v: unknown): v is [number, number][] {
  return Array.isArray(v) && v.length >= 3 &&
    v.every(p => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number' &&
      Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

const BUILDING_KINDS: SiteBuildingKind[] = ['house', 'garage', 'granny_flat', 'shed'];
const SURFACE_KINDS: SurfaceKind[] = ['driveway', 'path', 'pool'];

export async function POST(request: NextRequest) {
  // Costly endpoint (spends Anthropic credits) — keep callers same-origin and
  // rate-limited so the key can't be scripted now the login gate is gone.
  const blocked = guard(request, { limit: 10, windowMs: 60_000 });
  if (blocked) return blocked;

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return Response.json({ error: 'No file provided.' }, { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const imageBase64 = Buffer.from(arrayBuffer).toString('base64');
    const mediaType = file.type;

    let userMessage: MessageParam;
    if (mediaType === 'application/pdf') {
      userMessage = {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } },
          { type: 'text', text: USER_PROMPT },
        ],
      };
    } else {
      userMessage = {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType as ImageMediaType, data: imageBase64 } },
          { type: 'text', text: USER_PROMPT },
        ],
      };
    }

    const message = await client.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 8000,
      // Adaptive thinking lets the model reason through boundary dimensions and
      // setbacks before committing to coordinates. Effort kept low so the call
      // finishes well under Vercel's 60s function limit (same tuning as /api/analyze).
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low' },
      system: SYSTEM_PROMPT,
      messages: [userMessage],
    });

    const textBlock = message.content.find(b => b.type === 'text');
    const text = textBlock?.type === 'text' ? textBlock.text.trim() : '';

    console.log('AI raw response:', text);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found in response:', text);
      return Response.json({ error: 'Could not read the site plan. Try starting with a blank site.' }, { status: 422 });
    }

    const raw = JSON.parse(jsonMatch[0]);

    // ── Boundary — required, sane size ─────────────────────────────────────────
    if (!isPolygon(raw.boundary)) {
      return Response.json({ error: 'Could not find a lot boundary on this plan. Is it a site plan? Try starting with a blank site.' }, { status: 422 });
    }
    const boundary = ensureCCW(raw.boundary);
    const bb = footprintBounds(boundary);
    const lotW = bb.maxX - bb.minX;
    const lotD = bb.maxZ - bb.minZ;
    if (lotW < 8 || lotD < 8 || lotW > 120 || lotD > 120) {
      return Response.json({ error: 'The traced lot boundary is an unrealistic size. Try starting with a blank site and drawing it manually.' }, { status: 422 });
    }

    // ── Buildings — validate, filter, expand to full SiteBuilding ─────────────
    const buildings: SiteBuilding[] = [];
    if (Array.isArray(raw.buildings)) {
      for (const rb of raw.buildings.slice(0, 6)) {
        if (!rb || !isPolygon(rb.footprint)) continue;
        const fp = ensureCCW(rb.footprint);
        const area = polygonArea(fp);
        if (area < 6 || area > 600) continue;
        // Drop hallucinated buildings placed outside the lot (small tolerance)
        const [cx, cz] = centroid(fp);
        if (cx < bb.minX - 2 || cx > bb.maxX + 2 || cz < bb.minZ - 2 || cz > bb.maxZ + 2) continue;

        const kind: SiteBuildingKind = BUILDING_KINDS.includes(rb.kind) ? rb.kind : 'house';
        const base = newSiteBuilding(kind);
        const stories = rb.num_stories === 2 ? 2 : 1;
        const eave = base.data.wall_height_m * stories;
        buildings.push({
          ...base,
          label: typeof rb.label === 'string' && rb.label.trim() ? rb.label.trim().slice(0, 40) : base.label,
          data: syncFaceArrays({
            ...base.data,
            num_stories: stories,
            eave_height_m: eave,
            face_eave_heights: undefined,
          }, fp),
        });
      }
    }

    // ── Surfaces ───────────────────────────────────────────────────────────────
    const surfaces: SiteSurface[] = [];
    if (Array.isArray(raw.surfaces)) {
      for (const rs of raw.surfaces.slice(0, 6)) {
        if (!rs || !isPolygon(rs.polygon)) continue;
        const kind: SurfaceKind = SURFACE_KINDS.includes(rs.kind) ? rs.kind : 'driveway';
        surfaces.push({ id: siteUid(), kind, polygon: ensureCCW(rs.polygon) });
      }
    }

    // Centre the SITE (boundary bbox at origin) — buildings keep their positions
    // within the lot, unlike the single-building flow which centres the footprint.
    const site: SiteData = centerSite({
      boundary,
      site_width_m: Math.round(lotW * 10) / 10,
      site_depth_m: Math.round(lotD * 10) / 10,
      buildings,
      surfaces,
    });

    return Response.json(site);
  } catch (err) {
    console.error('Analyze-site error:', err);
    return Response.json({ error: 'Analysis failed. Please try again or start with a blank site.' }, { status: 500 });
  }
}
