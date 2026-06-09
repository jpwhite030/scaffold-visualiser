import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import { NextRequest } from 'next/server';
import { centerFootprint, ensureCCW } from '@/lib/buildingTypes';

const client = new Anthropic();
type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const SYSTEM_PROMPT = `You are an expert at reading Australian residential architectural plans and extracting building data for 3D scaffold modelling. Scaffolders need this to set up Kwikstage scaffold at the correct height on each face of the building.

═══ PART 1 — FOOTPRINT (from floor plan) ═══

Use the floor plan that best shows the full building perimeter (Ground Floor or First Floor — whichever has clearer external wall dimensions).

IDENTIFY EXTERIOR WALLS FIRST:
Exterior walls are drawn with THICK, BOLD solid lines — they are noticeably heavier than interior partition walls. Interior walls (between rooms) are thin lines. Only trace the THICK outer perimeter. Ignore all thin partition walls inside the building.

The outer perimeter is the boundary between the building and the outside world (garden, driveway, outdoor space). Walk around the outside of the building in your mind — every wall you would touch from outside is an exterior wall.

CRITICAL RULES for the footprint:
• Exterior walls ALWAYS meet at RIGHT ANGLES (0° or 90°). Every corner must be 90°.
• IGNORE all diagonal/angled lines — they are PROPERTY BOUNDARIES, site setback lines, or survey marks. NEVER part of a building wall.
• IGNORE: eave overhangs, porches, uncovered alfresco areas, driveways, north arrows, title blocks, detail drawings, legend boxes.
• Attached garages ARE part of the footprint. Open/uncovered areas (alfresco, balcony without roof, pergola) are NOT.
• A covered alfresco (with a roof structure, e.g. "PITCHING BEAM" noted) IS enclosed and IS part of the footprint.

COORDINATE SYSTEM: X = horizontal (left=neg, right=pos), Z = vertical in plan (bottom=neg, top=pos). Widest dimension on X axis.

SHAPE: Rectangle=4 corners (all 90°), L-shape=6 corners (all 90°), T/U-shape=8+ corners (all 90°). If there is ANY indentation, setback, or step in the exterior walls — trace it accurately with extra corners. Do NOT simplify a stepped shape to a rectangle.

DIMENSION READING — Australian plans often show dimensions as a chain of SUB-SPANS, not one total:
• Along the bottom edge you might see: 590 + 2410 + 470 + 545 + 590 + ... — ADD THEM ALL UP to get the total width.
• The total overall width is the SUM of all sub-spans along that edge.
• Do NOT use just one sub-span as the total building width.

MANDATORY DIMENSION CROSS-CHECK — do this BEFORE finalising the footprint:
1. Find ALL sub-span dimension strings along the bottom edge. Add them to get total width.
2. Find ALL sub-span dimension strings along the top edge. Add them to get top width.
3. Find ALL sub-span dimension strings along the left edge. Add them to get total depth.
4. Find ALL sub-span dimension strings along the right edge. Add them to get right depth.
5. If bottom ≠ top, there is a step — trace it. If left ≠ right, there is a step — trace it.
6. Verify: sum of your X-coordinates across the widest row = total width. Fix if not.

SIZE SANITY CHECK: A typical Australian house footprint is 120 m² to 500 m² (roughly 10×12m to 20×25m). If your computed footprint area (width × depth) is less than 80 m², you have almost certainly traced interior partition walls or a room — NOT the outer perimeter. Start over and trace only the thick outer boundary walls.

DIMENSIONS: Read mm strings (e.g. "18340"→18.34m, "11 250"→11.25m).

═══ PART 2 — EAVE HEIGHTS PER FACE (from elevation drawings) ═══

⚠️ FFL TRAP — READ THIS FIRST:
Australian plans show FFL (Finished Floor Level) annotations like "FFL. 8.590" or "FFL 2.590". These are heights above an external SITE DATUM (like AHD sea level) — they are NOT building heights. NEVER use any FFL value for wall_height_m or eave_height_m.

VALID height sources:
• Elevation drawings: dimension string from ±0.000 ground line to the fascia/gutter — this is the ONLY reliable eave height source
• Stud/plate height annotations: "2700 STUD", "PLATE HT = 2.745", "WH 2.4" — use for wall_height_m
• Reasonable residential ranges: wall_height_m = 2.4–3.2m; eave = 2.4–3.5m (1 storey) or 4.8–6.5m (2 storey)

If no elevation drawings are present, use defaults: wall_height_m = 2.7, eave_height_m = wall_height_m × num_stories.

For EACH elevation drawing found: measure from the ±0.000 ground line to the TOP OF FASCIA/GUTTER. Match to footprint edge:
• Rectangle (4 edges): Edge 0=bottom/front, Edge 1=right, Edge 2=top/rear, Edge 3=left
• L-shape (6 edges): continue counter-clockwise from bottom-left

Output face_eave_heights as an array of N numbers in edge order. If an elevation is missing, use eave_height_m for that face.

═══ OUTPUT ═══

Respond with ONLY this raw JSON — no explanation, no markdown, no code fences:
{"footprint":[[x,z],...],"wall_height_m":<m>,"num_stories":<1|2>,"roof_type":"gable"|"hip"|"flat","roof_pitch_degrees":<deg>,"eave_height_m":<max eave m>,"face_eave_heights":[<m per edge>]}

Defaults if not visible: wall_height_m=2.7, roof_pitch_degrees=22, roof_type="gable", eave_height_m=wall_height_m×num_stories
If NO elevation drawings are in the uploaded document, default roof_type to "gable" — do NOT output "flat" unless a flat roof is clearly shown.`;

const USER_PROMPT = `Extract the building footprint AND per-face eave heights from this plan set. Output ONLY the JSON — no explanation, no markdown.

STEP 1 — Identify the THICK outer perimeter walls (exterior walls are heavier/bolder lines than interior partitions). Ignore all thin interior partition walls.
STEP 2 — Add up ALL sub-span dimensions along the bottom edge to get total width. Do the same for top, left, right edges.
STEP 3 — Trace only the thick exterior wall polygon (all 90° corners). If top-total ≠ bottom-total, trace the step. If left-total ≠ right-total, trace that step too.
STEP 4 — Sanity check: footprint area must be > 80 m². If not, you traced interior walls — start over with the thick outer boundary.
STEP 5 — Face heights: read each elevation drawing for ground-to-gutter. If no elevations, use defaults (wall_height_m=2.7, roof_type="gable").

PRECISION — the polygon must match the plan, not approximate it:
• Trace the OUTERMOST face of the thick exterior walls — the line where the building meets the outside. Your vertices sit ON that outer wall face, NOT on the wall centreline and NOT on the inner (room-side) face. A common mistake is tracing slightly inside the building; push every point out to the outer edge of the thick wall.
• Capture the FULL extent. The leftmost, rightmost, topmost and bottommost vertices must each sit on the outermost wall on that side — do not stop short of a wing or room. Sweep the entire drawing: the building often extends further right/left than the central rooms (e.g. a Study, Rumpus, Garage or covered Balcony on one end is still part of the footprint). Include covered/roofed balconies and alfrescos that sit under the main roof or have support posts.
• Build coordinates on a real metre grid. Pick the bottom-left exterior corner as the origin, then WALK the perimeter corner-by-corner: each edge advances by the EXACT summed dimension for that wall, turning 90° at each corner. Every vertex must land precisely on a real wall corner.
• The RATIO between edges in your output must equal the ratio of the read dimensions (a 12 m wall must be exactly twice the length of a 6 m wall in your coordinates). Do not eyeball pixel positions — derive every coordinate from the measured millimetres.
• Re-trace every step/jog/setback in the exterior wall with its own vertices. Match the number of corners to the actual outline — do not round a stepped shape down to a rectangle.
• Before finalising: confirm the walk returns exactly to the origin (the loop closes), that opposite-side dimension totals agree with any step you traced, and that no part of the outer wall lies outside your polygon.`;

// Opus 4.8 + adaptive thinking on a plan can take a while — give the function
// room so it isn't killed mid-analysis.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
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
      // Adaptive thinking lets the model reason through the dimension chains
      // before committing to coordinates — meaningfully more accurate tracing.
      // Effort kept low so the call finishes well under Vercel's 60s function
      // limit (effort 'high' was causing 504 timeouts on complex plans). Opus
      // 4.8's high-res vision still does most of the accuracy work.
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
      return Response.json({ error: 'Could not extract dimensions. Try entering them manually.' }, { status: 422 });
    }

    const raw = JSON.parse(jsonMatch[0]);

    if (Array.isArray(raw.footprint) && raw.footprint.length >= 4) {
      raw.footprint = ensureCCW(centerFootprint(raw.footprint));

      // ── Sanity checks — catch common AI mistakes on Australian plans ──────────

      // Wall height: must be in realistic residential range
      if (!raw.wall_height_m || raw.wall_height_m < 2.0 || raw.wall_height_m > 4.5) {
        raw.wall_height_m = 2.7;
      }
      const wallH = raw.wall_height_m;

      // FFL trap: "FFL. 8.590" is a site datum level, NOT a building height.
      // If eave > 8 m it's almost certainly a misread FFL — recalculate from wall height.
      if (!raw.eave_height_m || raw.eave_height_m > 8.0 || raw.eave_height_m < 1.5) {
        const stories = (raw.num_stories && raw.num_stories >= 2) ? 2 : 1;
        raw.eave_height_m = wallH * stories;
      }

      // Auto-correct num_stories from actual heights
      if (raw.eave_height_m > wallH * 1.5) raw.num_stories = 2;
      else raw.num_stories = 1;

      // Fix any face heights that fell into the same FFL trap
      if (Array.isArray(raw.face_eave_heights)) {
        raw.face_eave_heights = raw.face_eave_heights.map((h: number) =>
          (!h || h > 8.0 || h < 1.5) ? raw.eave_height_m : h
        );
      }

      // Ensure face_eave_heights has correct length; pad with eave_height_m if short
      const n = raw.footprint.length;
      if (!Array.isArray(raw.face_eave_heights) || raw.face_eave_heights.length === 0) {
        raw.face_eave_heights = Array(n).fill(raw.eave_height_m ?? 2.7);
      } else if (raw.face_eave_heights.length < n) {
        const def = raw.eave_height_m ?? 2.7;
        while (raw.face_eave_heights.length < n) raw.face_eave_heights.push(def);
      }
    } else {
      const hL = (raw.building_length_m ?? 6) / 2;
      const hW = (raw.building_width_m ?? 4) / 2;
      raw.footprint = [[-hW, -hL], [hW, -hL], [hW, hL], [-hW, hL]];
      raw.face_eave_heights = Array(4).fill(raw.eave_height_m ?? 2.7);
    }

    return Response.json(raw);
  } catch (err) {
    console.error('Analyze error:', err);
    return Response.json({ error: 'Analysis failed. Please try again or enter dimensions manually.' }, { status: 500 });
  }
}
