'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { BuildingData, ensureCCW } from '@/lib/buildingTypes';

// ── Kwikstage dimensions (from gear lists / drawings) ────────────────────────
const INNER  = 0.20;           // inner standard: metres from wall face
const PLAT_W = 1.20;           // platform width — TR12 transoms (1.2 m)
const OUTER  = INNER + PLAT_W; // outer standard: 1.40 m from wall face
const BAY    = 2.4;
const LIFT   = 2.0;

const TUBE_R  = 0.024;
const RAIL_R  = 0.018;
const BRACE_R = 0.019;
const TOE_R   = 0.025;
const SEG     = 10;

const RAIL_LO = 0.5;
const RAIL_HI = 1.0;
const STAIR_W = 0.9;

// ── Colours — muted Kwikstage palette ────────────────────────────────────────
const KS_TUBE    = '#607898';   // muted steel-blue — the Kwikstage body colour
const KS_ROSETTE = '#8aaac8';   // slightly lighter — star rosette plates stand out
const KS_BOARD   = '#8c8c8c';   // perforated steel boards

// ── Helpers ──────────────────────────────────────────────────────────────────

function offsetPolygon(pts: [number, number][], dist: number): [number, number][] {
  const n = pts.length;
  return pts.map((curr, i) => {
    const prev = pts[(i - 1 + n) % n];
    const next = pts[(i + 1) % n];
    const e1x = curr[0] - prev[0], e1z = curr[1] - prev[1];
    const l1 = Math.hypot(e1x, e1z);
    const n1x = e1z / l1, n1z = -e1x / l1;
    const e2x = next[0] - curr[0], e2z = next[1] - curr[1];
    const l2 = Math.hypot(e2x, e2z);
    const n2x = e2z / l2, n2z = -e2x / l2;
    const mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 0.001) return [curr[0] + n1x * dist, curr[1] + n1z * dist] as [number, number];
    const dot = (n1x * mx + n1z * mz) / ml;
    return [
      curr[0] + (mx / ml) * (dist / Math.max(dot, 0.25)),
      curr[1] + (mz / ml) * (dist / Math.max(dot, 0.25)),
    ] as [number, number];
  });
}

// Find the combination of standard Kwikstage bay sizes {0.7, 1.2, 1.8, 2.4} m
// whose sum is closest to `len`. Search is bounded by obvious limits on each
// count; tiebreaker is fewer bays. This is the "if it's a 1200 gap put a 1200
// bay" rule — actual standard ledger sizes, not arbitrary divisions.
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

// Place scaffold standards at standard Kwikstage bay positions along a face.
// Bays are picked from {0.7, 1.2, 1.8, 2.4} m to fit the face length; the
// smallest bay sits at the corner end, where it absorbs any sub-millimetre
// residual so the final standard lands exactly on the building corner.
function standardBayPoints(p1: [number, number], p2: [number, number]): [number, number][] {
  const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.1) return [p1, p2];
  const ux = dx / len, uz = dz / len;
  const bays = decomposeBays(len);
  bays.sort((a, b) => b - a);                                   // largest first
  const total = bays.reduce((s, b) => s + b, 0);
  if (bays.length > 0) bays[bays.length - 1] += (len - total);  // smallest bay absorbs Δ
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

function hAngle(dx: number, dz: number) { return Math.atan2(dz, -dx); }
function hRot(ux: number, uz: number): [number, number, number] { return [0, hAngle(ux, uz), Math.PI / 2]; }

function dirRot(dx: number, dy: number, dz: number): [number, number, number] {
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return [0, 0, 0];
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx / len, dy / len, dz / len),
  );
  const e = new THREE.Euler().setFromQuaternion(q);
  return [e.x, e.y, e.z];
}

// ── Geometry types ───────────────────────────────────────────────────────────

interface Tube {
  x: number; y: number; z: number;
  length: number;
  rot: [number, number, number];
  r?: number;
}

interface Board {
  cx: number; cy: number; cz: number;
  length: number; depth: number;
  rotY: number;
}

// Kwikstage rosette star — position only; rendered as a component
interface RosettePos { x: number; y: number; z: number }

// ── Renderers ────────────────────────────────────────────────────────────────

function TubeMesh({ t }: { t: Tube }) {
  return (
    <mesh position={[t.x, t.y, t.z]} rotation={t.rot} castShadow>
      <cylinderGeometry args={[t.r ?? TUBE_R, t.r ?? TUBE_R, t.length, SEG]} />
      <meshStandardMaterial color={KS_TUBE} metalness={0.6} roughness={0.3} />
    </mesh>
  );
}

// Kwikstage star rosette — octagonal plate + 4 blade tabs at 45° intervals
function RosetteNode({ x, y, z }: RosettePos) {
  return (
    <group position={[x, y, z]}>
      {/* Octagonal base plate */}
      <mesh>
        <cylinderGeometry args={[0.046, 0.046, 0.011, 8]} />
        <meshStandardMaterial color={KS_ROSETTE} metalness={0.65} roughness={0.2} />
      </mesh>
      {/* 8 blade slots radiating outward — Kwikstage star */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.052, 0, Math.sin(a) * 0.052]} rotation={[0, a, 0]}>
            <boxGeometry args={[0.018, 0.011, 0.014]} />
            <meshStandardMaterial color={KS_ROSETTE} metalness={0.65} roughness={0.2} />
          </mesh>
        );
      })}
    </group>
  );
}

// ── Main build function ───────────────────────────────────────────────────────

function faceH(data: BuildingData, ei: number): number {
  return (data.face_eave_heights && data.face_eave_heights[ei] != null)
    ? data.face_eave_heights[ei]
    : data.eave_height_m;
}

// Reflex (concave) corner test for a CCW polygon — the inside corner of a notch.
function isReflex(poly: [number, number][], i: number): boolean {
  const n = poly.length;
  const a = poly[(i - 1 + n) % n], b = poly[i], c = poly[(i + 1) % n];
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < 0;
}

// Scaffold can't physically fit inside a notch narrower than ~2× the standoff,
// or shallower than one standoff — the two runs would overlap (the tangled bay
// you see at tight internal corners). Real scaffolders BRIDGE straight across
// such a notch. This collapses any small concave pocket (1–2 interior vertices
// between two nearby reflex corners) back to a straight edge across its mouth,
// so the scaffold runs across it. The house model keeps the real notch.
function bridgeNarrowNotches(input: [number, number][]): [number, number][] {
  const MIN_WIDTH = 2 * OUTER + 0.2;   // ~3.0 m mouth needed to fit a run down each side
  const MIN_DEPTH = OUTER + 0.2;       // ~1.6 m needed to fit a run across the back
  let poly = input.map(p => [...p] as [number, number]);
  for (let guard = 0; guard < 20; guard++) {
    const n = poly.length;
    if (n <= 4) break;
    let collapsed = false;
    for (let i = 0; i < n && !collapsed; i++) {
      for (let gap = 2; gap <= 3 && !collapsed; gap++) {   // gap 2 → 1 interior vtx, 3 → 2
        if (n - (gap - 1) < 4) continue;
        const j = (i + gap) % n;
        if (!isReflex(poly, i) || !isReflex(poly, j)) continue;
        const [ix, iz] = poly[i], [jx, jz] = poly[j];
        const width = Math.hypot(ix - jx, iz - jz);
        const ex = jx - ix, ez = jz - iz, el = Math.hypot(ex, ez) || 1;
        let depth = 0;
        for (let s = 1; s < gap; s++) {
          const [px, pz] = poly[(i + s) % n];
          depth = Math.max(depth, Math.abs((px - ix) * ez - (pz - iz) * ex) / el);
        }
        if (width < MIN_WIDTH || depth < MIN_DEPTH) {
          const remove = new Set<number>();
          for (let s = 1; s < gap; s++) remove.add((i + s) % n);
          poly = poly.filter((_, idx) => !remove.has(idx));
          collapsed = true;
        }
      }
    }
    if (!collapsed) break;
  }
  return poly;
}

function buildScaffold(data: BuildingData) {
  // Bridge across notches too small for scaffold to wrap (prevents overlapping
  // runs at tight internal corners); wide notches still flow around normally.
  const poly = bridgeNarrowNotches(ensureCCW(data.footprint));
  const nEdges = poly.length;

  // Mitred offset lines for the inner (0.2 m) and outer (1.4 m) standards.
  // The miter is computed for every corner — convex AND internal/re-entrant —
  // so adjacent faces share each corner point and the scaffold flows
  // continuously around it (see the corner handling in the edge loop below).
  const iPoly = offsetPolygon(poly, INNER);
  const oPoly = offsetPolygon(poly, OUTER);

  const BASE_Y = 0.5;
  const tubes: Tube[]           = [];
  const boards: Board[]         = [];
  const rosettes: RosettePos[]  = [];
  const basePts: [number, number][] = [];

  for (let ei = 0; ei < nEdges; ei++) {
    const ei1 = (ei + 1) % nEdges;

    // Every corner uses the shared mitred offset point — convex and internal
    // (re-entrant) corners alike. Because the two faces meeting at a corner read
    // the same oPoly/iPoly vertex, their standards, ledgers and platforms join up
    // seamlessly around internal corners instead of ending in disconnected stubs.
    const op1 = oPoly[ei];
    const ip1 = iPoly[ei];
    const op2 = oPoly[ei1];
    const ip2 = iPoly[ei1];

    const dx = op2[0] - op1[0], dz = op2[1] - op1[1];
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    const outX = uz, outZ = -ux;
    const rot   = hRot(ux, uz);
    const angle = hAngle(ux, uz);

    // Per-face height — top deck always 1 m below eave (Set for Roof rule).
    const eave      = faceH(data, ei);
    const topDeckY  = Math.max(LIFT, eave - 1.0);
    const totalH    = topDeckY;
    // Dummy ring: 1 m below top deck when eave > 3.5 m.
    const dummyLiftY = eave > 3.5 ? topDeckY - 1.0 : null;
    // Bottom deck: 2 m below dummy ring (WITH DUMMY) or 2 m below top (NO DUMMY).
    // Per Scaffold Studio rules: "BOTTOM DECK – 2m Below Dummy Ring".
    const bottomDeckY = dummyLiftY !== null ? dummyLiftY - 2.0 : topDeckY - 2.0;
    const hasBottomDeck = eave > 4.0 && bottomDeckY >= BASE_Y;
    const liftYs = hasBottomDeck ? [bottomDeckY, topDeckY] : [topDeckY];
    const allLedgerYs = [...new Set([
      BASE_Y,
      ...(dummyLiftY !== null ? [dummyLiftY] : []),
      ...liftYs,
    ])].sort((a, b) => a - b);
    const rosetteYs = Array.from({ length: Math.ceil(totalH / 0.5) }, (_, i) => (i + 1) * 0.5)
                       .filter(y => y <= totalH + 0.01);

    // Corner-standard heights: a shared corner standard must reach the taller of
    // its two adjacent faces (applies to every corner now that internal corners
    // share a standard too).
    const prevEave = faceH(data, (ei - 1 + nEdges) % nEdges);
    const nextEave = faceH(data, ei1);
    const tH0 = Math.max(LIFT, Math.max(eave, prevEave) - 1.0);
    const tH1 = Math.max(LIFT, Math.max(eave, nextEave) - 1.0);

    const oPts = standardBayPoints(op1, op2);
    const numBays = oPts.length - 1;
    // Map iPts to the actual fractional position of each oPt along the outer face
    // (bay sizes are no longer uniform — k/numBays would put transoms at wrong spots).
    const oLen = Math.hypot(op2[0] - op1[0], op2[1] - op1[1]);
    const iPts: [number, number][] = oPts.map((oPt) => {
      const dist = Math.hypot(oPt[0] - op1[0], oPt[1] - op1[1]);
      const frac = oLen > 0.001 ? dist / oLen : 0;
      return [
        ip1[0] + frac * (ip2[0] - ip1[0]),
        ip1[1] + frac * (ip2[1] - ip1[1]),
      ] as [number, number];
    });

    // ── Gable stepping ───────────────────────────────────────────────────────
    // Rule: MAX 500 mm (one star) step between adjacent bays on a gable face.
    // Steps are counted from each corner inward: bay 0 = topDeckY, bay 1 = +500 mm,
    // bay 2 = +1000 mm … capped by the actual gable geometry so we never exceed
    // what the roof allows. Lower scaffold levels stay identical to eave faces.
    const isGable  = data.roof_type !== 'flat' && ((data.gable_faces ?? [])[ei] ?? false);
    const halfLen  = len / 2;
    const pitchTan = isGable ? Math.tan((data.roof_pitch_degrees ?? 22) * Math.PI / 180) : 0;

    // Geometry cap — absolute maximum top deck at a given distance from face centre
    const gableGeoCap = (dist: number): number => {
      const localH = eave + Math.max(0, halfLen - dist) * pitchTan;
      return Math.max(topDeckY, Math.floor((localH - 1.0) / 0.5) * 0.5);
    };

    // Per-bay top deck heights: exactly 500 mm per step from the corner, capped by geometry
    const bayTopYs: number[] = Array.from({ length: numBays }, (_, j) => {
      if (!isGable) return topDeckY;
      const stepsFromCorner = Math.min(j, numBays - 1 - j);
      const stepped = topDeckY + stepsFromCorner * 0.5;
      const dist    = Math.abs((j + 0.5) / numBays - 0.5) * len;
      return Math.min(stepped, gableGeoCap(dist));
    });

    // Levels that are UNIFORM across every bay (base ring + lower decks)
    const uniformLedgerYs = [
      BASE_Y,
      ...(dummyLiftY !== null ? [dummyLiftY] : []),
      ...(hasBottomDeck       ? [bottomDeckY] : []),
    ];

    // ── Standards ────────────────────────────────────────────────────────────
    // Each standard supports its two adjacent bays — must reach the taller one.
    for (let k = 0; k <= numBays; k++) {
      const [ox, oz] = oPts[k];
      const [ix, iz] = iPts[k];

      const leftBayTopY  = k > 0       ? bayTopYs[k - 1] : tH0;
      const rightBayTopY = k < numBays ? bayTopYs[k]     : tH1;

      const stdH = k === 0       ? tH0
                 : k === numBays ? tH1
                 : isGable       ? Math.max(leftBayTopY, rightBayTopY)
                 : totalH;

      const rYs  = Array.from({ length: Math.ceil(stdH / 0.5) }, (_, i) => (i + 1) * 0.5)
                    .filter(y => y <= stdH + 0.01);

      tubes.push({ x: ox, y: stdH / 2, z: oz, length: stdH, rot: [0, 0, 0] });
      tubes.push({ x: ox, y: stdH + RAIL_HI / 2, z: oz, length: RAIL_HI, rot: [0, 0, 0] });
      for (const y of rYs) rosettes.push({ x: ox, y, z: oz });
      if (!basePts.some(s => Math.hypot(s[0] - ox, s[1] - oz) < 0.05)) basePts.push([ox, oz]);

      tubes.push({ x: ix, y: stdH / 2, z: iz, length: stdH, rot: [0, 0, 0] });
      for (const y of rYs) rosettes.push({ x: ix, y, z: iz });
      if (!basePts.some(s => Math.hypot(s[0] - ix, s[1] - iz) < 0.05)) basePts.push([ix, iz]);
    }

    // ── Transoms (inner ↔ outer at each bay-point) ────────────────────────────
    // Step boundaries get transoms at both adjacent bay deck heights.
    for (let k = 0; k <= numBays; k++) {
      const [ox, oz] = oPts[k], [ix, iz] = iPts[k];
      const tLen = Math.hypot(ox - ix, oz - iz);
      const tcx  = (ox + ix) / 2, tcz = (oz + iz) / 2;
      const tRot = hRot(outX, outZ);

      const leftBayTopY  = k > 0       ? bayTopYs[k - 1] : tH0;
      const rightBayTopY = k < numBays ? bayTopYs[k]     : tH1;

      const ySet = isGable
        ? [...new Set([...uniformLedgerYs, leftBayTopY, rightBayTopY])].sort((a, b) => a - b)
        : allLedgerYs;

      for (const y of ySet)
        tubes.push({ x: tcx, y, z: tcz, length: tLen, rot: tRot });
    }

    // ── Per bay: ledgers, platforms, bracing ──────────────────────────────────
    const PLANK_COUNT = 5;
    const plankW  = PLAT_W / PLANK_COUNT;
    const plankGap = 0.006;

    for (let j = 0; j < numBays; j++) {
      const [ox1, oz1] = oPts[j], [ox2, oz2] = oPts[j + 1];
      const [ix1, iz1] = iPts[j], [ix2, iz2] = iPts[j + 1];
      const ocx  = (ox1 + ox2) / 2, ocz = (oz1 + oz2) / 2;
      const icx  = (ix1 + ix2) / 2, icz = (iz1 + iz2) / 2;
      const bLen = Math.hypot(ox2 - ox1, oz2 - oz1);

      // Per-bay top deck — 500 mm steps from corner, or flat topDeckY on eave faces
      const bayTopY = bayTopYs[j];

      // liftYs: lower deck(s) first (uniform), then per-bay top deck
      const bayLiftYs      = isGable
        ? [...(hasBottomDeck ? [bottomDeckY] : []), bayTopY]
        : liftYs;
      const bayAllLedgerYs = isGable
        ? [...new Set([...uniformLedgerYs, bayTopY])].sort((a, b) => a - b)
        : allLedgerYs;

      for (const y of bayAllLedgerYs) {
        tubes.push({ x: ocx, y, z: ocz, length: bLen, rot });
        tubes.push({ x: icx, y, z: icz, length: bLen, rot });
      }

      for (const y of bayLiftYs) {
        const midX = (ocx + icx) / 2, midZ = (ocz + icz) / 2;
        for (let b = 0; b < PLANK_COUNT; b++) {
          const offset = (b - (PLANK_COUNT - 1) / 2) * plankW;
          boards.push({
            cx: midX + outX * offset,
            cy: y + 0.022,
            cz: midZ + outZ * offset,
            length: bLen,
            depth: plankW - plankGap,
            rotY: angle,
          });
        }
        tubes.push({ x: ocx, y: y + 0.075, z: ocz, length: bLen, rot, r: TOE_R });
        tubes.push({ x: ocx, y: y + RAIL_LO, z: ocz, length: bLen, rot, r: RAIL_R });
        tubes.push({ x: ocx, y: y + RAIL_HI, z: ocz, length: bLen, rot, r: RAIL_R });
      }

      const numBraceLevels = Math.max(1, Math.ceil(bayTopY / LIFT));
      for (let li = 0; li < numBraceLevels; li++) {
        const yBot = li * LIFT;
        const yTop = Math.min((li + 1) * LIFT, bayTopY);
        const segH = yTop - yBot;
        const midY = (yBot + yTop) / 2;
        const diagLen = Math.hypot(bLen, segH);
        if (j % 3 === 0) {
          tubes.push({ x: ocx, y: midY, z: ocz, length: diagLen, rot: dirRot(ox2 - ox1, segH, oz2 - oz1), r: BRACE_R });
        } else if (j % 3 === 1) {
          tubes.push({ x: ocx, y: midY, z: ocz, length: diagLen, rot: dirRot(ox1 - ox2, segH, oz1 - oz2), r: BRACE_R });
        }
      }
    }
  }

  // ── Stair tower — placed at corner 0, height = max eave across all faces ────
  const maxEave      = Math.max(...Array.from({ length: nEdges }, (_, i) => faceH(data, i)));
  const stairH       = Math.max(LIFT, maxEave - 1.0);
  const stairBraceLevels = Math.max(1, Math.ceil(stairH / LIFT));
  const stairRYs     = Array.from({ length: Math.ceil(stairH / 0.5) }, (_, i) => (i + 1) * 0.5)
                        .filter(y => y <= stairH + 0.01);

  const e0dx = oPoly[0][0] - oPoly[nEdges - 1][0], e0dz = oPoly[0][1] - oPoly[nEdges - 1][1];
  const e0l  = Math.hypot(e0dx, e0dz);
  const e1dx = oPoly[1][0] - oPoly[0][0], e1dz = oPoly[1][1] - oPoly[0][1];
  const e1l  = Math.hypot(e1dx, e1dz);
  const e1ux = e1dx / e1l, e1uz = e1dz / e1l;
  const avgOutX = (e0dz / e0l - e1uz) / 2, avgOutZ = (-e0dx / e0l + e1ux) / 2;
  const aNorm = Math.hypot(avgOutX, avgOutZ) || 1;
  const [sc0x, sc0z] = oPoly[0];
  const stX   = sc0x + (avgOutX / aNorm) * STAIR_W * 0.5;
  const stZ   = sc0z + (avgOutZ / aNorm) * STAIR_W * 0.5;
  const stRot = hRot(e1ux, e1uz);

  tubes.push({ x: stX, y: stairH / 2, z: stZ, length: stairH, rot: [0, 0, 0] });
  tubes.push({ x: stX + e1ux * STAIR_W, y: stairH / 2, z: stZ + e1uz * STAIR_W, length: stairH, rot: [0, 0, 0] });
  for (const y of stairRYs) {
    rosettes.push({ x: stX, y, z: stZ });
    rosettes.push({ x: stX + e1ux * STAIR_W, y, z: stZ + e1uz * STAIR_W });
  }

  for (let li = 0; li < stairBraceLevels; li++) {
    const yBot = li * LIFT, yTop = Math.min((li + 1) * LIFT, stairH);
    const segH = yTop - yBot;
    tubes.push({ x: stX, y: (yBot + yTop) / 2, z: stZ, length: Math.hypot(STAIR_W, segH), rot: dirRot(e1ux * STAIR_W, segH, e1uz * STAIR_W) });
    boards.push({ cx: stX + e1ux * STAIR_W / 2, cy: yTop + 0.022, cz: stZ + e1uz * STAIR_W / 2, length: STAIR_W, depth: 0.5, rotY: hAngle(e1ux, e1uz) });
    tubes.push({ x: stX + e1ux * STAIR_W / 2, y: yTop + RAIL_HI, z: stZ + e1uz * STAIR_W / 2, length: STAIR_W, rot: stRot, r: RAIL_R });
  }

  return { tubes, boards, rosettes, basePts };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ScaffoldModel({ data }: { data: BuildingData }) {
  const { tubes, boards, rosettes, basePts } = useMemo(() => buildScaffold(data), [data]);

  return (
    <group>
      {/* All steel tubes — standards, ledgers, transoms, rails, bracing */}
      {tubes.map((t, i) => <TubeMesh key={i} t={t} />)}

      {/* Kwikstage star rosettes at every 500 mm on each standard */}
      {rosettes.map((r, i) => <RosetteNode key={`r${i}`} {...r} />)}

      {/* Flat perforated steel boards */}
      {boards.map((b, i) => (
        <mesh key={`b${i}`} position={[b.cx, b.cy, b.cz]} rotation={[0, b.rotY, 0]} castShadow>
          <boxGeometry args={[b.length, 0.038, b.depth]} />
          <meshStandardMaterial color={KS_BOARD} metalness={0.45} roughness={0.5} />
        </mesh>
      ))}

      {/* Base plates + screw jacks */}
      {basePts.map(([x, z], i) => (
        <group key={`bp${i}`}>
          <mesh position={[x, 0.02, z]}>
            <boxGeometry args={[0.18, 0.04, 0.18]} />
            <meshStandardMaterial color="#777" metalness={0.55} roughness={0.45} />
          </mesh>
          <mesh position={[x, 0.14, z]}>
            <cylinderGeometry args={[0.016, 0.016, 0.22, 8]} />
            <meshStandardMaterial color="#888" metalness={0.6} roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
