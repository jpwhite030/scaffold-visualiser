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
const SEG     = 10;

const RAIL_LO = 0.5;
const RAIL_HI = 1.0;

// Kickboards (toe boards) on the outer edge of every deck.
const KB_H = 0.15;   // 150 mm standard toe-board height
const KB_T = 0.025;  // board thickness


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

// A vertical toe board standing on the edge of a deck.
interface KickBoard {
  cx: number; cy: number; cz: number;
  length: number;
  rotY: number;
}

// Kwikstage rosette star — position only; rendered as a component
interface RosettePos { x: number; y: number; z: number }

// ── Renderers ────────────────────────────────────────────────────────────────

function TubeMesh({ t }: { t: Tube }) {
  return (
    <mesh position={[t.x, t.y, t.z]} rotation={t.rot} castShadow>
      <cylinderGeometry args={[t.r ?? TUBE_R, t.r ?? TUBE_R, t.length, SEG]} />
      <meshStandardMaterial color={KS_TUBE} metalness={0.65} roughness={0.34} envMapIntensity={1.15} />
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
        <meshStandardMaterial color={KS_ROSETTE} metalness={0.65} roughness={0.2} envMapIntensity={1.2} />
      </mesh>
      {/* 8 blade slots radiating outward — Kwikstage star */}
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.052, 0, Math.sin(a) * 0.052]} rotation={[0, a, 0]}>
            <boxGeometry args={[0.018, 0.011, 0.014]} />
            <meshStandardMaterial color={KS_ROSETTE} metalness={0.65} roughness={0.2} envMapIntensity={1.2} />
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
  const kickboards: KickBoard[] = [];
  const rosettes: RosettePos[]  = [];
  const basePts: [number, number][] = [];

  // Top-deck protection mode:
  //  • roof_catch     — top deck 1 m below the roof, with 4 handrails (a tall
  //                     catch barrier reaching above the roof line). Default.
  //  • edge_protection — top deck 2 m below the roof, with 2 handrails.
  const protectionType = data.protection_type ?? 'roof_catch';
  const topOffset = protectionType === 'edge_protection' ? 2.0 : 1.0;
  const topRailYs = protectionType === 'roof_catch'
    ? [0.5, 1.0, 1.5, 2.0]      // 4 rails
    : [RAIL_LO, RAIL_HI];       // 2 rails
  const postExt = protectionType === 'roof_catch' ? 2.0 : RAIL_HI;  // guardrail post height above top deck

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

    // Per-face height — top deck sits topOffset below the eave (1 m roof catch
    // / 2 m edge protection).
    const eave      = faceH(data, ei);
    const topDeckY  = Math.max(LIFT, eave - topOffset);
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
    const tH0 = Math.max(LIFT, Math.max(eave, prevEave) - topOffset);
    const tH1 = Math.max(LIFT, Math.max(eave, nextEave) - topOffset);

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
      return Math.max(topDeckY, Math.floor((localH - topOffset) / 0.5) * 0.5);
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
      // Guardrail post above the deck — taller for roof catch (carries 4 rails).
      tubes.push({ x: ox, y: stdH + postExt / 2, z: oz, length: postExt, rot: [0, 0, 0] });
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
        // Kickboard (toe board) on the OUTER edge of every deck — the open/fall
        // side. The inner edge sits against the building, so no toe board there.
        kickboards.push({ cx: ocx, cy: y + 0.04 + KB_H / 2, cz: ocz, length: bLen, rotY: angle });
        // Guardrails — the top deck gets the protection-mode rail set (4 for roof
        // catch, 2 for edge protection); lower decks get the standard 2 rails.
        const isTopDeck = y >= bayTopY - 0.01;
        const railSet = isTopDeck ? topRailYs : [RAIL_LO, RAIL_HI];
        for (const ry of railSet) {
          tubes.push({ x: ocx, y: y + ry, z: ocz, length: bLen, rot, r: RAIL_R });
        }
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

  // ── Access tower — a separate 2.4 m × 1.2 m bay built OFF the run ───────────
  // The main scaffold run stays clean and continuous; the tower attaches to its
  // OUTER face and projects straight out (perpendicular to the wall), with the
  // zig-zag stair (or a ladder) inside it.
  const accessType = data.access_type ?? 'stair';
  const maxEave = Math.max(...Array.from({ length: nEdges }, (_, i) => faceH(data, i)));
  const stairH  = Math.max(LIFT, maxEave - topOffset);   // reach the top deck
  // Each stair flight rises 1.5 m over a 2.4 m going (standard Kwikstage stair
  // unit); flights zig-zag until they reach the top deck height.
  const TW_GOING = 2.4, TW_DEPTH = 1.2, TW_RISE = 1.5;
  const flights = Math.max(1, Math.ceil(stairH / TW_RISE));
  const stairRYs = Array.from({ length: Math.ceil(stairH / 0.5) }, (_, i) => (i + 1) * 0.5)
                    .filter(y => y <= stairH + 0.01);

  // Put the tower on the straightest run — the longest outer edge.
  let ai = 0, bestLen = -1;
  for (let i = 0; i < nEdges; i++) {
    const j = (i + 1) % nEdges;
    const L = Math.hypot(oPoly[j][0] - oPoly[i][0], oPoly[j][1] - oPoly[i][1]);
    if (L > bestLen) { bestLen = L; ai = i; }
  }
  const ai1 = (ai + 1) % nEdges;

  // Frame along that edge: u along the wall, n the outward normal (away from building).
  const auX = oPoly[ai1][0] - oPoly[ai][0], auZ = oPoly[ai1][1] - oPoly[ai][1];
  const auL = Math.hypot(auX, auZ) || 1;
  const ux = auX / auL, uz = auZ / auL;
  const nx = uz, nz = -ux;                 // outward normal of the chosen edge
  const uRot = hRot(ux, uz), nRot = hRot(nx, nz);
  const nAngle = hAngle(nx, nz);

  // Centre the tower along the run (clearly mid-wall, clear of both corners).
  const startOff = Math.max(0.3, (auL - TW_GOING) / 2);
  const Sx = oPoly[ai][0] + ux * startOff, Sz = oPoly[ai][1] + uz * startOff;
  // Tower point at going-fraction fa (along wall) and depth-fraction fb (outward).
  const tp = (fa: number, fb: number): [number, number] =>
    [Sx + ux * TW_GOING * fa + nx * TW_DEPTH * fb, Sz + uz * TW_GOING * fa + nz * TW_DEPTH * fb];

  // Four tower standards + rosettes + base plates.
  for (const fb of [0, 1]) for (const fa of [0, 1]) {
    const [bx, bz] = tp(fa, fb);
    tubes.push({ x: bx, y: stairH / 2, z: bz, length: stairH, rot: [0, 0, 0] });
    for (const y of stairRYs) rosettes.push({ x: bx, y, z: bz });
    if (!basePts.some(s => Math.hypot(s[0] - bx, s[1] - bz) < 0.05)) basePts.push([bx, bz]);
  }
  // Perimeter ledgers framing the tower at each stair landing level.
  for (let lvl = 1; lvl <= flights; lvl++) {
    const y = Math.min(lvl * TW_RISE, stairH);
    for (const fb of [0, 1]) {
      const [a0x, a0z] = tp(0, fb), [a1x, a1z] = tp(1, fb);
      tubes.push({ x: (a0x + a1x) / 2, y, z: (a0z + a1z) / 2, length: TW_GOING, rot: uRot });
    }
    for (const fa of [0, 1]) {
      const [b0x, b0z] = tp(fa, 0), [b1x, b1z] = tp(fa, 1);
      tubes.push({ x: (b0x + b1x) / 2, y, z: (b0z + b1z) / 2, length: TW_DEPTH, rot: nRot });
    }
  }

  // Roof-edge protection: guardrails on all four sides of the tower top. Each
  // standard extends a rail's height above the top deck (the posts), with a top
  // and mid rail running right around the perimeter.
  for (const fb of [0, 1]) for (const fa of [0, 1]) {
    const [bx, bz] = tp(fa, fb);
    tubes.push({ x: bx, y: stairH + RAIL_HI / 2, z: bz, length: RAIL_HI, rot: [0, 0, 0] });
  }
  for (const ry of [RAIL_LO, RAIL_HI]) {
    for (const fb of [0, 1]) {
      const [a0x, a0z] = tp(0, fb), [a1x, a1z] = tp(1, fb);
      tubes.push({ x: (a0x + a1x) / 2, y: stairH + ry, z: (a0z + a1z) / 2, length: TW_GOING, rot: uRot, r: RAIL_R });
    }
    for (const fa of [0, 1]) {
      const [b0x, b0z] = tp(fa, 0), [b1x, b1z] = tp(fa, 1);
      tubes.push({ x: (b0x + b1x) / 2, y: stairH + ry, z: (b0z + b1z) / 2, length: TW_DEPTH, rot: nRot, r: RAIL_R });
    }
  }

  if (accessType === 'ladder') {
    // Vertical ladder on the tower's outer face.
    const [cx0, cz0] = tp(0.5, 1);
    const offx = nx * 0.06, offz = nz * 0.06;
    const LAD_HALF = 0.225;
    for (const s of [-LAD_HALF, LAD_HALF]) {
      tubes.push({ x: cx0 + ux * s + offx, y: stairH / 2, z: cz0 + uz * s + offz, length: stairH, rot: [0, 0, 0], r: RAIL_R });
    }
    for (let ry = 0.3; ry <= stairH - 0.1; ry += 0.3) {
      tubes.push({ x: cx0 + offx, y: ry, z: cz0 + offz, length: LAD_HALF * 2, rot: uRot, r: 0.012 });
    }
    tubes.push({ x: cx0, y: stairH + RAIL_HI, z: cz0, length: TW_GOING, rot: uRot, r: RAIL_R });
  } else {
    // Zig-zag stair inside the tower: each flight spans the 2.4 m going and rises
    // one lift, alternating direction with a landing at each level.
    const nTreads = 7;
    for (let li = 0; li < flights; li++) {
      const yBot = li * TW_RISE, yTop = Math.min((li + 1) * TW_RISE, stairH);
      const segH = yTop - yBot;
      const aS = li % 2 === 0 ? 0 : 1, aE = li % 2 === 0 ? 1 : 0;  // alternate direction
      for (const fb of [0, 1]) {   // stringers on both sides
        const [p0x, p0z] = tp(aS, fb), [p1x, p1z] = tp(aE, fb);
        tubes.push({ x: (p0x + p1x) / 2, y: (yBot + yTop) / 2, z: (p0z + p1z) / 2,
          length: Math.hypot(TW_GOING, segH), rot: dirRot(p1x - p0x, segH, p1z - p0z), r: BRACE_R });
      }
      for (let t = 0; t < nTreads; t++) {   // treads span the tower depth
        const f = (t + 0.5) / nTreads;
        const a = aS + (aE - aS) * f;
        const [tx, tz] = tp(a, 0.5);
        boards.push({ cx: tx, cy: yBot + segH * f + 0.022, cz: tz,
          length: TW_DEPTH * 0.92, depth: (TW_GOING / nTreads) * 0.9, rotY: nAngle });
      }
      const [lx, lz] = tp(aE, 0.5);   // landing at top of flight
      boards.push({ cx: lx, cy: yTop + 0.022, cz: lz, length: TW_DEPTH * 0.92, depth: 0.45, rotY: nAngle });
      const [h0x, h0z] = tp(aS, 1), [h1x, h1z] = tp(aE, 1);   // outer handrail
      tubes.push({ x: (h0x + h1x) / 2, y: (yBot + yTop) / 2 + RAIL_HI, z: (h0z + h1z) / 2,
        length: Math.hypot(TW_GOING, segH), rot: dirRot(h1x - h0x, segH, h1z - h0z), r: RAIL_R });
    }
  }

  return { tubes, boards, kickboards, rosettes, basePts };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ScaffoldModel({ data }: { data: BuildingData }) {
  const { tubes, boards, kickboards, rosettes, basePts } = useMemo(() => buildScaffold(data), [data]);

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
          <meshStandardMaterial color={KS_BOARD} metalness={0.5} roughness={0.55} envMapIntensity={0.9} />
        </mesh>
      ))}

      {/* Kickboards / toe boards — vertical boards on deck edges above 2 m */}
      {kickboards.map((k, i) => (
        <mesh key={`k${i}`} position={[k.cx, k.cy, k.cz]} rotation={[0, k.rotY, 0]} castShadow>
          <boxGeometry args={[k.length, KB_H, KB_T]} />
          <meshStandardMaterial color="#caa24a" metalness={0.2} roughness={0.7} />
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
