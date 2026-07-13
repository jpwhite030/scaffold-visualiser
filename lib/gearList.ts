import { BuildingData, ensureCCW } from './buildingTypes';

const INNER       = 0.20;
const PLAT_W      = 1.20;
const OUTER       = INNER + PLAT_W;
const BAY         = 2.4;
const LIFT        = 2.0;
const BASE_Y      = 0.5;
const RAIL_HI     = 1.0;
const PLANK_COUNT = 5;

// ── Kwikstage standard lengths ────────────────────────────────────────────────
// Ledgers + boards: 760 mm, 1.2 m, 1.8 m, 2.4 m
const KS_LEDGER_SIZES = [0.76, 1.2, 1.8, 2.4];

// Vertical standards: 0.5 m, 1.0 m, 1.5 m, 2.0 m, 2.5 m, 3.0 m
const KS_STD_SIZES = [3.0, 2.5, 2.0, 1.5, 1.0, 0.5]; // descending for greedy

function snapLedger(m: number): number {
  return KS_LEDGER_SIZES.reduce((best, l) =>
    Math.abs(l - m) < Math.abs(best - m) ? l : best
  );
}

// Break a required column height into KS standard pieces (greedy, round up to 0.5 m)
function addStdPieces(h: number, rec: Record<string, number>) {
  let rem = Math.round(h * 1000) / 1000;
  for (const s of KS_STD_SIZES) {
    if (rem < 0.01) break;
    const n = Math.floor(rem / s + 0.001);
    if (n > 0) {
      addTo(rec, s.toFixed(1) + 'm', n);
      rem = Math.round((rem - n * s) * 1000) / 1000;
    }
  }
  if (rem > 0.01) addTo(rec, '0.5m'); // round up remainder
}

export interface GearList {
  standards:  Record<string, number>;  // KS height → count (e.g. "2.0m": 12)
  ledgers:    Record<string, number>;  // KS length → count
  transoms:   number;                  // 1.2 m cross-members
  braces:     number;                  // diagonal bracing
  deckBoards: Record<string, number>;  // KS length → count
  guardrails: number;                  // top + mid rails
  toeBoards:  number;
  basePlates: number;
  screwJacks: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function edgeOutwardNormal(p1: [number, number], p2: [number, number]): [number, number] {
  const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
  const len = Math.hypot(dx, dz);
  return [dz / len, -dx / len];
}

function isReflexCorner(poly: [number, number][], vi: number): boolean {
  const n = poly.length;
  const a = poly[(vi - 1 + n) % n], b = poly[vi], c = poly[(vi + 1) % n];
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < 0;
}

function offsetPolygon(pts: [number, number][], dist: number): [number, number][] {
  const n = pts.length;
  return pts.map((curr, i) => {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const e1x = curr[0] - prev[0], e1z = curr[1] - prev[1];
    const l1  = Math.hypot(e1x, e1z);
    const n1x = e1z / l1, n1z = -e1x / l1;
    const e2x = next[0] - curr[0], e2z = next[1] - curr[1];
    const l2  = Math.hypot(e2x, e2z);
    const n2x = e2z / l2, n2z = -e2x / l2;
    const mx  = n1x + n2x, mz = n1z + n2z;
    const ml  = Math.hypot(mx, mz);
    if (ml < 0.001) return [curr[0] + n1x * dist, curr[1] + n1z * dist] as [number, number];
    const dot = (n1x * mx + n1z * mz) / ml;
    return [
      curr[0] + (mx / ml) * (dist / Math.max(dot, 0.25)),
      curr[1] + (mz / ml) * (dist / Math.max(dot, 0.25)),
    ] as [number, number];
  });
}

function faceEave(data: BuildingData, ei: number): number {
  return (data.face_eave_heights && data.face_eave_heights[ei] != null)
    ? data.face_eave_heights[ei]
    : data.eave_height_m;
}

function decomposeBays(len: number): number[] {
  let best: number[] = [];
  let bestDiff = Infinity;
  let bestCount = Infinity;
  const maxN24 = Math.floor(len / 2.4) + 1;
  for (let n24 = 0; n24 <= maxN24; n24++) {
    const r1 = len - n24 * 2.4;
    const u18 = r1 > 0 ? Math.floor(r1 / 1.8) + 1 : 1;
    for (let n18 = 0; n18 <= u18; n18++) {
      const r2 = r1 - n18 * 1.8;
      const u12 = r2 > 0 ? Math.floor(r2 / 1.2) + 1 : 1;
      for (let n12 = 0; n12 <= u12; n12++) {
        const r3 = r2 - n12 * 1.2;
        for (let n07 = 0; n07 <= 2; n07++) {
          const total = n24 + n18 + n12 + n07;
          if (total === 0) continue;
          const diff = Math.abs(r3 - n07 * 0.7);
          if (diff < bestDiff - 0.001 ||
             (Math.abs(diff - bestDiff) < 0.001 && total < bestCount)) {
            bestDiff = diff;
            bestCount = total;
            best = [
              ...Array(n24).fill(2.4),
              ...Array(n18).fill(1.8),
              ...Array(n12).fill(1.2),
              ...Array(n07).fill(0.7),
            ];
          }
        }
      }
    }
  }
  return best.length > 0 ? best : [len];
}

function standardBayPoints(p1: [number, number], p2: [number, number]): [number, number][] {
  const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.1) return [p1, p2];
  const ux = dx / len, uz = dz / len;
  const bays = decomposeBays(len);
  bays.sort((a, b) => b - a);
  const total = bays.reduce((s, b) => s + b, 0);
  if (bays.length > 0) bays[bays.length - 1] += (len - total);
  const pts: [number, number][] = [[...p1] as [number, number]];
  let pos = 0;
  for (let i = 0; i < bays.length; i++) {
    pos += bays[i];
    pts.push(i === bays.length - 1
      ? ([...p2] as [number, number])
      : ([p1[0] + ux * pos, p1[1] + uz * pos] as [number, number]));
  }
  return pts;
}

function lenKey(m: number): string {
  return (Math.round(m * 100) / 100).toFixed(2).replace(/\.?0+$/, '') + 'm';
}

function addTo(rec: Record<string, number>, key: string, n = 1) {
  rec[key] = (rec[key] ?? 0) + n;
}

function nearPt(pts: [number, number][], x: number, z: number): boolean {
  return pts.some(s => Math.hypot(s[0] - x, s[1] - z) < 0.05);
}

/** Combine per-building gear lists into one site total. */
export function sumGearLists(lists: GearList[]): GearList {
  const total: GearList = {
    standards:  {},
    ledgers:    {},
    transoms:   0,
    braces:     0,
    deckBoards: {},
    guardrails: 0,
    toeBoards:  0,
    basePlates: 0,
    screwJacks: 0,
  };
  for (const gl of lists) {
    for (const [k, v] of Object.entries(gl.standards))  addTo(total.standards, k, v);
    for (const [k, v] of Object.entries(gl.ledgers))    addTo(total.ledgers, k, v);
    for (const [k, v] of Object.entries(gl.deckBoards)) addTo(total.deckBoards, k, v);
    total.transoms   += gl.transoms;
    total.braces     += gl.braces;
    total.guardrails += gl.guardrails;
    total.toeBoards  += gl.toeBoards;
    total.basePlates += gl.basePlates;
    total.screwJacks += gl.screwJacks;
  }
  return total;
}

// ── main ──────────────────────────────────────────────────────────────────────

export function computeGearList(data: BuildingData): GearList {
  const poly   = ensureCCW(data.footprint);
  const nEdges = poly.length;
  const iPoly  = offsetPolygon(poly, INNER);
  const oPoly  = offsetPolygon(poly, OUTER);
  const reflex = Array.from({ length: nEdges }, (_, i) => isReflexCorner(poly, i));

  const gl: GearList = {
    standards:  {},
    ledgers:    {},
    transoms:   0,
    braces:     0,
    deckBoards: {},
    guardrails: 0,
    toeBoards:  0,
    basePlates: 0,
    screwJacks: 0,
  };

  const seenPts: [number, number][] = [];  // deduplicate corner positions

  for (let ei = 0; ei < nEdges; ei++) {
    const ei1 = (ei + 1) % nEdges;
    const eNorm = edgeOutwardNormal(poly[ei], poly[ei1]);
    const op1 = reflex[ei]
      ? [poly[ei][0] + eNorm[0] * OUTER, poly[ei][1] + eNorm[1] * OUTER] as [number, number]
      : oPoly[ei];
    const ip1 = reflex[ei]
      ? [poly[ei][0] + eNorm[0] * INNER, poly[ei][1] + eNorm[1] * INNER] as [number, number]
      : iPoly[ei];
    const op2 = reflex[ei1]
      ? [poly[ei1][0] + eNorm[0] * OUTER, poly[ei1][1] + eNorm[1] * OUTER] as [number, number]
      : oPoly[ei1];
    const ip2 = reflex[ei1]
      ? [poly[ei1][0] + eNorm[0] * INNER, poly[ei1][1] + eNorm[1] * INNER] as [number, number]
      : iPoly[ei1];

    const dx  = op2[0] - op1[0], dz = op2[1] - op1[1];
    const len = Math.hypot(dx, dz);

    const eave       = faceEave(data, ei);
    const topDeckY   = Math.max(LIFT, eave - 1.0);
    const dummyY     = eave > 3.5 ? topDeckY - 1.0 : null;
    const bottomDeckY = dummyY !== null ? dummyY - 2.0 : topDeckY - 2.0;
    const hasBottomDeck = eave > 4.0 && bottomDeckY >= BASE_Y;
    const liftYs     = hasBottomDeck ? [bottomDeckY, topDeckY] : [topDeckY];
    const allLedgerYs = [...new Set([
      BASE_Y,
      ...(dummyY !== null ? [dummyY] : []),
      ...liftYs,
    ])].sort((a, b) => a - b);

    const prevEave = faceEave(data, (ei - 1 + nEdges) % nEdges);
    const nextEave = faceEave(data, ei1);
    const tH0 = reflex[ei]  ? topDeckY : Math.max(LIFT, Math.max(eave, prevEave) - 1.0);
    const tH1 = reflex[ei1] ? topDeckY : Math.max(LIFT, Math.max(eave, nextEave) - 1.0);

    const oPts = standardBayPoints(op1, op2);
    const numBays = oPts.length - 1;
    const oLen = Math.hypot(op2[0] - op1[0], op2[1] - op1[1]);
    const iPts: [number, number][] = oPts.map((oPt) => {
      const dist = Math.hypot(oPt[0] - op1[0], oPt[1] - op1[1]);
      const frac = oLen > 0.001 ? dist / oLen : 0;
      return [
        ip1[0] + frac * (ip2[0] - ip1[0]),
        ip1[1] + frac * (ip2[1] - ip1[1]),
      ] as [number, number];
    });
    // Per-bay lengths — each bay can be a different standard size now.
    const bayLens: number[] = [];
    for (let k = 0; k < numBays; k++)
      bayLens.push(Math.hypot(oPts[k + 1][0] - oPts[k][0], oPts[k + 1][1] - oPts[k][1]));

    // ── Standards ─────────────────────────────────────────────────────────────
    for (let k = 0; k <= numBays; k++) {
      const [ox, oz] = oPts[k];
      const [ix, iz] = iPts[k];
      const stdH = k === 0 ? tH0 : k === numBays ? tH1 : topDeckY;

      // Outer standard: main column + 1 m guardrail extension
      if (!nearPt(seenPts, ox, oz)) {
        seenPts.push([ox, oz]);
        addStdPieces(stdH, gl.standards);       // main column
        addTo(gl.standards, '1.0m');            // guardrail extension
      }
      // Inner standard: main column only
      if (!nearPt(seenPts, ix, iz)) {
        seenPts.push([ix, iz]);
        addStdPieces(stdH, gl.standards);
      }
    }

    // ── Transoms ──────────────────────────────────────────────────────────────
    gl.transoms += (numBays + 1) * allLedgerYs.length;

    // ── Ledgers ───────────────────────────────────────────────────────────────
    // Tally each bay separately so mixed bay sizes get the right ledger counts.
    for (const bLen of bayLens) {
      const snapLen = snapLedger(bLen);
      addTo(gl.ledgers, lenKey(snapLen), 2 * allLedgerYs.length);
    }

    // ── Deck boards ───────────────────────────────────────────────────────────
    for (const bLen of bayLens) {
      const snapLen = snapLedger(bLen);
      addTo(gl.deckBoards, lenKey(snapLen), liftYs.length * PLANK_COUNT);
    }

    // ── Rails, toe boards, bracing ────────────────────────────────────────────
    gl.guardrails += numBays * liftYs.length * 2;
    gl.toeBoards  += numBays * liftYs.length;
    // Bracing every 3 bays per Scaffold Studio rules (2 out of every 3 bays get a brace)
    const numBraceLevels = Math.max(1, Math.ceil(topDeckY / LIFT));
    gl.braces += Math.ceil(numBays * 2 / 3) * numBraceLevels;
  }

  gl.basePlates = seenPts.length;
  gl.screwJacks = seenPts.length;

  return gl;
}
