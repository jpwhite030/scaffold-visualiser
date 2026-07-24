'use client';

import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { BuildingData, ensureCCW } from '@/lib/buildingTypes';

// ── Kwikstage dimensions (from gear lists / drawings) ────────────────────────
const INNER  = 0.20;           // inner standard: metres from wall face
const PLAT_W = 1.20;           // platform width — TR12 transoms (1.2 m)
const OUTER  = INNER + PLAT_W; // outer standard: 1.40 m from wall face
const BAY    = 2.4;
const LIFT   = 2.0;

const TUBE_R  = 0.024;
const RAIL_R  = 0.017;
const BRACE_R = 0.019;
const SEG     = 14;

const RAIL_LO = 0.5;
const RAIL_HI = 1.0;

// Kickboards (toe boards) on the outer edge of every deck.
const KB_H = 0.15;   // 150 mm standard toe-board height
const KB_T = 0.025;  // board thickness


// ── Colours — realistic galvanised Kwikstage palette ─────────────────────────
const KS_TUBE    = '#c6cbd2';   // light galvanised silver — hot-dip zinc finish
const KS_PRESS   = '#a9afb8';   // V-pressings/wedge heads — slightly darker forged steel
const KS_BOARD   = '#d3c199';   // timber/LVL scaffold boards — pale sanded pine

// ── Kit view — every member coloured by its Kwikstage stock length ───────────
// Matches the gear-list categories exactly, so the on-screen kit IS the load list.
export const KIT_COLOURS = {
  len24:  '#f2d94e',   // 2.4 m ledgers / boards — yellow
  len18:  '#e88bb6',   // 1.8 m — pink
  len12:  '#7ab3e8',   // 1.2 m (incl. TR12 transoms) — blue
  len07:  '#7fd49a',   // 0.7 / 0.76 m — green
  brace:  '#5ecfc0',   // diagonal bracing — teal
  rail:   '#b39ddb',   // guardrails — violet
  std:    '#c9ced6',   // standards / posts / small parts — light grey
} as const;

type KitLenKey = 'len24' | 'len18' | 'len12' | 'len07';

function snapStockKey(len: number): KitLenKey {
  const stocks: [number, KitLenKey][] = [[2.4, 'len24'], [1.8, 'len18'], [1.2, 'len12'], [0.76, 'len07']];
  let best = stocks[0];
  for (const s of stocks) if (Math.abs(s[0] - len) < Math.abs(best[0] - len)) best = s;
  return best[1];
}

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

// A positioned, Y-rotated box instance — reused for forged connector heads,
// deck-batten end hooks, and any other small repeated part rendered instanced.
interface BoxXform { x: number; y: number; z: number; rotY: number }

// ── Renderers ────────────────────────────────────────────────────────────────

function TubeMesh({ t, mat }: { t: Tube; mat: THREE.Material }) {
  return (
    <mesh position={[t.x, t.y, t.z]} rotation={t.rot} castShadow material={mat}>
      <cylinderGeometry args={[t.r ?? TUBE_R, t.r ?? TUBE_R, t.length, SEG]} />
    </mesh>
  );
}

// Kwikstage V-pressing — a compact forged collar with four V wedge cups at 90°
// spacings, pressed onto the standard every 500 mm. Far subtler than a ringlock
// rosette: from a distance it reads as a small nub on the tube, which is what
// the real thing looks like.
function VPressingNode({ x, y, z, mat }: RosettePos & { mat: THREE.Material }) {
  return (
    <group position={[x, y, z]}>
      {/* Pressed collar wrapping the standard */}
      <mesh material={mat}>
        <cylinderGeometry args={[0.029, 0.029, 0.03, 10]} />
      </mesh>
      {/* 4 V-cups facing outward, tipped slightly down like the pressing */}
      {Array.from({ length: 4 }, (_, i) => {
        const a = (i * Math.PI) / 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.036, -0.003, Math.sin(a) * 0.036]}
            rotation={[0.25, -a, 0]} material={mat}>
            <boxGeometry args={[0.019, 0.032, 0.013]} />
          </mesh>
        );
      })}
    </group>
  );
}

// Draw many identical Y-rotated boxes as ONE instanced mesh — a single draw
// call for what would otherwise be hundreds of tiny meshes (connector heads,
// deck-batten hooks, …). `size` is the shared box geometry for every instance.
function InstancedBoxes({ items, size, mat }: { items: BoxXform[]; size: [number, number, number]; mat: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    items.forEach((c, i) => {
      p.set(c.x, c.y, c.z);
      q.setFromEuler(e.set(0, c.rotY, 0));
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);

  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow material={mat}>
      <boxGeometry args={size} />
    </instancedMesh>
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

  // Partial scaffold — faces unticked in review get no run at all. Absent
  // array = full wrap (older data). Same index caveat as face_eave_heights
  // when bridgeNarrowNotches has collapsed a notch.
  const sf = data.scaffold_faces ?? [];
  const faceOn = (ei: number): boolean => sf[ei] !== false;
  const enabledEdges = Array.from({ length: nEdges }, (_, i) => i).filter(faceOn);

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
  const connectors: BoxXform[]  = [];
  const boardHooks: BoxXform[]  = [];
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

  // Auto-detect the gable-end faces of a rectangular gable roof so the scaffold
  // steps up the rake automatically — matching HouseModel's ridge orientation.
  // The ridge runs along the longer side; the two faces perpendicular to it are
  // the gable ends. Explicit gable_faces toggles override this when present.
  const gf = data.gable_faces ?? [];
  const hasGableToggle = gf.some(g => g);
  const xs = poly.map(p => p[0]), zs = poly.map(p => p[1]);
  const ridgeAlongZ = (Math.max(...zs) - Math.min(...zs)) >= (Math.max(...xs) - Math.min(...xs));
  const isGableEnd = (ei: number): boolean => {
    if (data.roof_type !== 'gable' || nEdges !== 4) return false;
    const [x1, z1] = poly[ei], [x2, z2] = poly[(ei + 1) % nEdges];
    const runsAlongX = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    return ridgeAlongZ ? runsAlongX : !runsAlongX;   // perpendicular to the ridge
  };

  if (enabledEdges.length === 0) {
    return { tubes, boards, kickboards, rosettes, connectors, boardHooks, basePts };
  }

  for (let ei = 0; ei < nEdges; ei++) {
    if (!faceOn(ei)) continue;
    const ei1 = (ei + 1) % nEdges;
    const prevIdx = (ei - 1 + nEdges) % nEdges;

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
    // share a standard too). A scaffold-less neighbour doesn't pull the corner up.
    const prevEave = faceOn(prevIdx) ? faceH(data, prevIdx) : 0;
    const nextEave = faceOn(ei1) ? faceH(data, ei1) : 0;
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
    // Step up if this face is toggled as a gable end, or — when no toggles are
    // set — if it's auto-detected as a gable end of a gable roof.
    const isGable  = data.roof_type !== 'flat' &&
      (hasGableToggle ? (gf[ei] ?? false) : isGableEnd(ei));
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

      // Transom heads point along the transom (perpendicular to the face).
      const tAngle = hAngle(outX, outZ);
      for (const y of ySet) {
        tubes.push({ x: tcx, y, z: tcz, length: tLen, rot: tRot });
        connectors.push({ x: ox, y, z: oz, rotY: tAngle });
        connectors.push({ x: ix, y, z: iz, rotY: tAngle });
      }
    }

    // ── Wall ties — short tubes anchoring the inner standards back to the
    // building, at roughly every second standard and every ~4 m of height (a
    // typical tie pattern). They bridge the 0.2 m gap to the wall so the
    // scaffold reads as tied to the structure rather than standing free.
    const tieRot = hRot(outX, outZ);
    for (let k = 0; k <= numBays; k += 2) {
      const [ix, iz] = iPts[k];
      const tcx = ix - outX * (INNER / 2), tcz = iz - outZ * (INNER / 2);
      for (let ty = 2.0; ty <= totalH - 0.4; ty += 4.0) {
        tubes.push({ x: tcx, y: ty, z: tcz, length: INNER, rot: tieRot });
      }
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
        // Forged heads where each ledger end clamps onto its standard's rosette.
        connectors.push({ x: ox1, y, z: oz1, rotY: angle });
        connectors.push({ x: ox2, y, z: oz2, rotY: angle });
        connectors.push({ x: ix1, y, z: iz1, rotY: angle });
        connectors.push({ x: ix2, y, z: iz2, rotY: angle });
      }

      for (const y of bayLiftYs) {
        const midX = (ocx + icx) / 2, midZ = (ocz + icz) / 2;
        for (let b = 0; b < PLANK_COUNT; b++) {
          const offset = (b - (PLANK_COUNT - 1) / 2) * plankW;
          const pcx = midX + outX * offset, pcz = midZ + outZ * offset;
          boards.push({
            cx: pcx,
            cy: y + 0.022,
            cz: pcz,
            length: bLen,
            depth: plankW - plankGap,
            rotY: angle,
          });
          // Down-turned hooks at each batten end, draped over the transom below.
          for (const sgn of [-1, 1]) {
            boardHooks.push({ x: pcx + ux * sgn * (bLen / 2), y: y + 0.005, z: pcz + uz * sgn * (bLen / 2), rotY: angle });
          }
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
        const m3 = j % 3;
        if (m3 === 0 || m3 === 1) {
          const fwd = m3 === 0;   // which way the diagonal leans this bay
          tubes.push({ x: ocx, y: midY, z: ocz, length: diagLen,
            rot: dirRot(fwd ? ox2 - ox1 : ox1 - ox2, segH, fwd ? oz2 - oz1 : oz1 - oz2), r: BRACE_R });
          // Swivel couplers clamping each brace end to its outer standard. Same
          // hardware as the ledger heads, so they ride the connector instance mesh.
          connectors.push({ x: fwd ? ox1 : ox2, y: yBot, z: fwd ? oz1 : oz2, rotY: angle });
          connectors.push({ x: fwd ? ox2 : ox1, y: yTop, z: fwd ? oz2 : oz1, rotY: angle });
        }
      }
    }

    // ── End rails — a partial run stops mid-building where the neighbouring
    // face has no scaffold. Rail that open end across the platform width at
    // every deck level (same rail set as the long side, plus a toe board on
    // the top deck) so nobody can walk off the end.
    const endRot = hRot(outX, outZ);
    const endAngle = hAngle(outX, outZ);
    for (const [k, neighbourOn] of [[0, faceOn(prevIdx)], [numBays, faceOn(ei1)]] as [number, boolean][]) {
      if (neighbourOn) continue;
      const [ox, oz] = oPts[k], [ix, iz] = iPts[k];
      const tLen = Math.hypot(ox - ix, oz - iz);
      const cx = (ox + ix) / 2, cz = (oz + iz) / 2;
      const endTopY = k === 0 ? bayTopYs[0] : bayTopYs[numBays - 1];
      const deckYs = isGable
        ? [...(hasBottomDeck ? [bottomDeckY] : []), endTopY]
        : liftYs;
      for (const y of deckYs) {
        const railSet = y >= endTopY - 0.01 ? topRailYs : [RAIL_LO, RAIL_HI];
        for (const ry of railSet) {
          tubes.push({ x: cx, y: y + ry, z: cz, length: tLen, rot: endRot, r: RAIL_R });
        }
        kickboards.push({ cx, cy: y + 0.04 + KB_H / 2, cz, length: tLen, rotY: endAngle });
      }
    }
  }

  // ── Access tower — a separate 2.4 m × 1.2 m bay built OFF the run ───────────
  // The main scaffold run stays clean and continuous; the tower attaches to its
  // OUTER face and projects straight out (perpendicular to the wall), with the
  // zig-zag stair (or a ladder) inside it.
  const accessType = data.access_type ?? 'stair';
  const maxEave = Math.max(...enabledEdges.map(i => faceH(data, i)));
  const stairH  = Math.max(LIFT, maxEave - topOffset);   // reach the top deck
  // Each stair flight rises 1.5 m over a 2.4 m going (standard Kwikstage stair
  // unit); flights zig-zag until they reach the top deck height.
  const TW_GOING = 2.4, TW_DEPTH = 1.2, TW_RISE = 1.5;
  const flights = Math.max(1, Math.ceil(stairH / TW_RISE));
  const stairRYs = Array.from({ length: Math.ceil(stairH / 0.5) }, (_, i) => (i + 1) * 0.5)
                    .filter(y => y <= stairH + 0.01);

  // Put the tower on the straightest run — the longest outer edge that
  // actually has scaffold on it.
  let ai = enabledEdges[0], bestLen = -1;
  for (const i of enabledEdges) {
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

  // Roof-edge protection: guardrails on all four sides of the tower top, using
  // the SAME protection mode as the main scaffold (4 rails on roof catch, 2 on
  // edge protection) so the access tower is just as safe to fall against. The
  // posts extend tall enough (postExt) to carry the full rail set.
  for (const fb of [0, 1]) for (const fa of [0, 1]) {
    const [bx, bz] = tp(fa, fb);
    tubes.push({ x: bx, y: stairH + postExt / 2, z: bz, length: postExt, rot: [0, 0, 0] });
  }
  for (const ry of topRailYs) {
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
      // Raking handrails — both sides of the flight, top + mid rail, following
      // the stair slope (a person climbing has a rail on either hand).
      for (const fb of [0, 1]) {
        const [r0x, r0z] = tp(aS, fb), [r1x, r1z] = tp(aE, fb);
        for (const ry of [RAIL_LO, RAIL_HI]) {
          tubes.push({ x: (r0x + r1x) / 2, y: (yBot + yTop) / 2 + ry, z: (r0z + r1z) / 2,
            length: Math.hypot(TW_GOING, segH), rot: dirRot(r1x - r0x, segH, r1z - r0z), r: RAIL_R });
        }
      }
    }
  }

  return { tubes, boards, kickboards, rosettes, connectors, boardHooks, basePts };
}

// Procedural galvanised "spangle": a soft mottled greyscale used as a roughness
// map so the steel surfaces catch light unevenly (shinier flecks) rather than
// reading as flat colour. Canvas-based, so it only runs client-side — fine here
// because the viewer mounts ScaffoldModel with ssr:false.
function makeGalvTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  // Average near-white preserves each material's base roughness; the flecks
  // dip the roughness locally to give the galvanised sparkle.
  ctx.fillStyle = '#dcdcdc';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 1100; i++) {
    const g = 200 + Math.floor(Math.random() * 55);
    ctx.fillStyle = `rgba(${g},${g},${g},${(0.12 + Math.random() * 0.18).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(Math.random() * size, Math.random() * size, 1.5 + Math.random() * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 2);
  return tex;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ScaffoldModel({ data, kitView = false }: { data: BuildingData; kitView?: boolean }) {
  const { tubes, boards, kickboards, rosettes, connectors, boardHooks, basePts } = useMemo(() => buildScaffold(data), [data]);

  // One shared material per part type — galvanised-steel PBR with a faint
  // clearcoat so the city Environment reads as a real metallic sheen rather
  // than flat colour. Shared instances also mean a single shader program for
  // hundreds of tubes instead of one material allocation per mesh.
  const mats = useMemo(() => {
    // One shared galvanised-spangle roughness map across all the steel parts.
    const galv = makeGalvTexture();
    const steel = (color: string, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
      new THREE.MeshPhysicalMaterial({
        color, metalness: 0.9, roughness: 0.36, clearcoat: 0.35, clearcoatRoughness: 0.45,
        envMapIntensity: 1.2, roughnessMap: galv, ...o,
      });
    const kitFlat = (color: string) =>
      new THREE.MeshStandardMaterial({ color, metalness: 0.15, roughness: 0.55 });
    return {
      // Standards / ledgers / transoms / rails / bracing.
      tube: steel(KS_TUBE),
      // V-pressings + forged wedge heads — darker, matter forged steel.
      press: steel(KS_PRESS, { roughness: 0.42, clearcoat: 0.2, clearcoatRoughness: 0.5, envMapIntensity: 1.0 }),
      // Timber/LVL scaffold boards — matte sanded pine, zero metalness.
      board: new THREE.MeshStandardMaterial({ color: KS_BOARD, metalness: 0, roughness: 0.72 }),
      // Painted safety-yellow toe boards — matte, hardly reflective.
      toe: new THREE.MeshStandardMaterial({ color: '#e7c62f', metalness: 0.1, roughness: 0.6 }),
      basePlate: new THREE.MeshStandardMaterial({ color: '#777', metalness: 0.55, roughness: 0.45 }),
      // Threaded jack / nut — galvanised steel like the tubes.
      jack: steel('#8a8a8a', { metalness: 0.85, roughness: 0.3, clearcoat: 0.3, envMapIntensity: 1.1 }),
      // Timber sole board under each leg — matte, no metalness.
      sole: new THREE.MeshStandardMaterial({ color: '#7a5a39', metalness: 0, roughness: 0.9 }),
      // Kit-view flats — matte so the stock-length colours read clearly.
      kitLen24:  kitFlat(KIT_COLOURS.len24),
      kitLen18:  kitFlat(KIT_COLOURS.len18),
      kitLen12:  kitFlat(KIT_COLOURS.len12),
      kitLen07:  kitFlat(KIT_COLOURS.len07),
      kitBrace:  kitFlat(KIT_COLOURS.brace),
      kitRail:   kitFlat(KIT_COLOURS.rail),
      kitStd:    kitFlat(KIT_COLOURS.std),
      // Kept so the disposal effect frees the shared texture too.
      galv,
    };
  }, []);

  // Free the GPU material resources when the model unmounts / data changes.
  useEffect(() => () => { Object.values(mats).forEach(m => m.dispose()); }, [mats]);

  // Kit-view material for a tube, inferred from its geometry: vertical members
  // are standards/posts; brace- and rail-radius tubes are bracing/guardrails;
  // stubs under 0.5 m are ties and ladder rungs; everything else is a ledger or
  // transom coloured by nearest stock length.
  const kitTubeMat = (t: Tube): THREE.Material => {
    const vertical = t.rot[0] === 0 && t.rot[1] === 0 && t.rot[2] === 0;
    if (vertical) return mats.kitStd;
    if (t.r === BRACE_R) return mats.kitBrace;
    if (t.r === RAIL_R) return mats.kitRail;
    if (t.length < 0.5) return mats.kitStd;
    return kitLenMat(t.length);
  };
  const kitLenMat = (len: number): THREE.Material => {
    switch (snapStockKey(len)) {
      case 'len24': return mats.kitLen24;
      case 'len18': return mats.kitLen18;
      case 'len12': return mats.kitLen12;
      default:      return mats.kitLen07;
    }
  };

  return (
    <group>
      {/* All steel tubes — standards, ledgers, transoms, rails, bracing */}
      {tubes.map((t, i) => <TubeMesh key={i} t={t} mat={kitView ? kitTubeMat(t) : mats.tube} />)}

      {/* Kwikstage V-pressings at every 500 mm on each standard */}
      {rosettes.map((r, i) => <VPressingNode key={`r${i}`} {...r} mat={kitView ? mats.kitStd : mats.press} />)}

      {/* Forged wedge heads where ledgers/transoms clamp the pressings (instanced) */}
      <InstancedBoxes items={connectors} size={[0.042, 0.072, 0.038]} mat={kitView ? mats.kitStd : mats.press} />

      {/* Galvanised end bands on the board ends, draped over the transoms (instanced) */}
      <InstancedBoxes items={boardHooks} size={[0.016, 0.055, 0.226]} mat={kitView ? mats.kitStd : mats.tube} />

      {/* Flat perforated steel boards — kit view colours each by stock length */}
      {boards.map((b, i) => (
        <mesh key={`b${i}`} position={[b.cx, b.cy, b.cz]} rotation={[0, b.rotY, 0]} castShadow
          material={kitView ? kitLenMat(b.length) : mats.board}>
          <boxGeometry args={[b.length, 0.038, b.depth]} />
        </mesh>
      ))}

      {/* Kickboards / toe boards — vertical boards on deck edges above 2 m */}
      {kickboards.map((k, i) => (
        <mesh key={`k${i}`} position={[k.cx, k.cy, k.cz]} rotation={[0, k.rotY, 0]} castShadow material={mats.toe}>
          <boxGeometry args={[k.length, KB_H, KB_T]} />
        </mesh>
      ))}

      {/* Adjustable base jacks: timber sole board → steel plate → adjustment
          nut → threaded rod (the standard seats on top of the rod). */}
      {basePts.map(([x, z], i) => (
        <group key={`bp${i}`}>
          {/* Timber sole board spreading the load on the ground */}
          <mesh position={[x, 0.008, z]} material={mats.sole} receiveShadow castShadow>
            <boxGeometry args={[0.34, 0.016, 0.34]} />
          </mesh>
          {/* Steel base plate seated on the sole board */}
          <mesh position={[x, 0.03, z]} material={mats.basePlate} castShadow>
            <boxGeometry args={[0.18, 0.028, 0.18]} />
          </mesh>
          {/* Hex adjustment nut on the threaded jack */}
          <mesh position={[x, 0.075, z]} material={mats.jack} castShadow>
            <cylinderGeometry args={[0.034, 0.034, 0.03, 6]} />
          </mesh>
          {/* Threaded jack rod */}
          <mesh position={[x, 0.16, z]} material={mats.jack} castShadow>
            <cylinderGeometry args={[0.016, 0.016, 0.22, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
