'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// Scenery for the site viewer: procedural ground textures, a timber paling
// fence around the boundary, and a street along the front edge. Everything is
// canvas-textured / instanced client-side (the viewer mounts with ssr:false),
// following the same patterns as ScaffoldModel's galvanised-spangle map.

// Deterministic PRNG so paling tints / tree jitter don't reshuffle on re-render.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Procedural ground textures ───────────────────────────────────────────────

function noisyCanvas(base: string, speckles: { color: () => string; count: number; rMin: number; rMax: number }[], size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const rnd = mulberry32(size * 7919);
  for (const s of speckles) {
    for (let i = 0; i < s.count; i++) {
      ctx.fillStyle = s.color();
      ctx.beginPath();
      ctx.arc(rnd() * size, rnd() * size, s.rMin + rnd() * (s.rMax - s.rMin), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return { canvas: c, ctx, rnd, size };
}

function toTexture(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(repeatX, repeatY);
  return tex;
}

// Mown-lawn green: large soft tonal patches + fine blade speckle. One tile ≈ 4 m.
export function makeGrassTexture(): HTMLCanvasElement {
  const g = (lo: number, hi: number) => {
    const rnd = Math.random;
    return () => {
      const green = lo + Math.floor(rnd() * (hi - lo));
      const red = Math.floor(green * (0.62 + rnd() * 0.14));
      const blue = Math.floor(green * 0.42);
      return `rgba(${red},${green},${blue},${(0.10 + rnd() * 0.2).toFixed(3)})`;
    };
  };
  const { canvas } = noisyCanvas('#5b7d43', [
    { color: g(95, 135), count: 60, rMin: 14, rMax: 42 },   // broad patches
    { color: g(80, 150), count: 900, rMin: 0.6, rMax: 2.2 }, // blade speckle
  ]);
  return canvas;
}

// Broomed concrete with expansion joints on the tile edges → joints every tile.
export function makeConcreteTexture(): HTMLCanvasElement {
  const gray = (lo: number, hi: number) => () => {
    const v = lo + Math.floor(Math.random() * (hi - lo));
    return `rgba(${v},${v},${v - 4},${(0.10 + Math.random() * 0.22).toFixed(3)})`;
  };
  const { canvas, ctx, size } = noisyCanvas('#b9b7b0', [
    { color: gray(150, 200), count: 700, rMin: 0.5, rMax: 1.8 }, // aggregate
    { color: gray(120, 150), count: 60, rMin: 3, rMax: 9 },      // stains
  ]);
  ctx.strokeStyle = 'rgba(70,70,70,0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, size - 3, size - 3); // expansion joint at tile edges
  return canvas;
}

// Coarse asphalt: near-black with grey aggregate sparkle.
export function makeAsphaltTexture(): HTMLCanvasElement {
  const { canvas } = noisyCanvas('#33363b', [
    { color: () => { const v = 60 + Math.floor(Math.random() * 60); return `rgba(${v},${v},${v},${(0.10 + Math.random() * 0.25).toFixed(3)})`; }, count: 1600, rMin: 0.4, rMax: 1.4 },
    { color: () => `rgba(20,21,24,${(0.15 + Math.random() * 0.2).toFixed(3)})`, count: 90, rMin: 3, rMax: 10 },
  ]);
  return canvas;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

export function pointInPolygon([px, pz]: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Which boundary edge faces the street? The one the driveway touches — else
// the front by plan convention (bottom of plan = most-negative-Z midpoint).
export function findStreetEdge(boundary: [number, number][], surfaces: { kind: string; polygon: [number, number][] }[]): number {
  const n = boundary.length;
  const driveways = surfaces.filter(s => s.kind === 'driveway');
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = boundary[i];
    const [x2, z2] = boundary[(i + 1) % n];
    for (const d of driveways) {
      for (const [px, pz] of d.polygon) {
        // point → segment distance
        const dx = x2 - x1, dz = z2 - z1;
        const len2 = dx * dx + dz * dz;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / len2)) : 0;
        const dist = Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
    }
  }
  if (best >= 0 && bestDist < 3) return best;
  // Fallback: edge whose midpoint sits furthest toward the bottom of the plan
  let front = 0;
  let minZ = Infinity;
  for (let i = 0; i < n; i++) {
    const mz = (boundary[i][1] + boundary[(i + 1) % n][1]) / 2;
    if (mz < minZ) { minZ = mz; front = i; }
  }
  return front;
}

// Flat ground polygon with a world-scale tiled texture. ShapeGeometry UVs equal
// the shape's XY coords (metres here), so texture.repeat = 1/tile gives an
// N-metre tile. Shape (x, -z) + rotation -90° about X lands on world XZ.
export function GroundPoly({ points, y, material }: {
  points: [number, number][];
  y: number;
  material: THREE.Material;
}) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    points.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, -z) : shape.lineTo(x, -z)));
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [points]);
  return (
    <mesh geometry={geo} material={material} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow />
  );
}

// ── Paling fence ─────────────────────────────────────────────────────────────

const FENCE_H = 1.8;
const PALING_W = 0.145;
const PALING_GAP = 0.012;
const PALING_T = 0.016;
const POST_SPACING = 2.7;

interface FenceItem { x: number; z: number; rotY: number; scaleX: number; tint: number }

function InstancedFenceBoxes({ items, size, color, roughness = 0.85 }: {
  items: FenceItem[];
  size: [number, number, number];
  color: string;
  roughness?: number;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const base = new THREE.Color(color);
    const c = new THREE.Color();
    items.forEach((it, i) => {
      p.set(it.x, size[1] / 2, it.z);
      q.setFromEuler(e.set(0, it.rotY, 0));
      s.set(it.scaleX, 1, 1);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      c.copy(base).multiplyScalar(it.tint);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, size, color]);

  if (items.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#ffffff" roughness={roughness} metalness={0} />
    </instancedMesh>
  );
}

/**
 * Weathered timber paling fence along every boundary edge except the street
 * edge, with automatic gaps where a driveway/path crosses the line.
 */
export function PalingFence({ boundary, streetEdge, openings }: {
  boundary: [number, number][];
  streetEdge: number;
  openings: [number, number][][];
}) {
  const { palings, posts, rails } = useMemo(() => {
    const rnd = mulberry32(1234567);
    const palings: FenceItem[] = [];
    const posts: FenceItem[] = [];
    const rails: FenceItem[] = [];
    const n = boundary.length;

    const blocked = (x: number, z: number) =>
      openings.some(poly => pointInPolygon([x, z], poly));

    for (let ei = 0; ei < n; ei++) {
      if (ei === streetEdge) continue;
      const [x1, z1] = boundary[ei];
      const [x2, z2] = boundary[(ei + 1) % n];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.5) continue;
      const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
      // rotation.y that maps local +X onto the edge direction (verified convention)
      const rotY = -Math.atan2(uz, ux);

      // Palings
      const step = PALING_W + PALING_GAP;
      const count = Math.floor(len / step);
      for (let k = 0; k < count; k++) {
        const d = (k + 0.5) * step;
        const x = x1 + ux * d, z = z1 + uz * d;
        if (blocked(x, z)) continue;
        palings.push({ x, z, rotY, scaleX: 1, tint: 0.82 + rnd() * 0.36 });
      }

      // Posts + two rails per bay (skip bays fully inside an opening)
      const bays = Math.max(1, Math.round(len / POST_SPACING));
      const bayLen = len / bays;
      for (let k = 0; k <= bays; k++) {
        const d = Math.min(k * bayLen, len);
        const x = x1 + ux * d, z = z1 + uz * d;
        if (!blocked(x, z)) posts.push({ x, z, rotY, scaleX: 1, tint: 0.9 + rnd() * 0.2 });
        if (k < bays) {
          const mid = (k + 0.5) * bayLen;
          const mx = x1 + ux * mid, mz = z1 + uz * mid;
          if (!blocked(mx, mz)) rails.push({ x: mx, z: mz, rotY, scaleX: bayLen, tint: 0.85 + rnd() * 0.25 });
        }
      }
    }
    return { palings, posts, rails };
  }, [boundary, streetEdge, openings]);

  return (
    <group>
      <InstancedFenceBoxes items={palings} size={[PALING_W, FENCE_H, PALING_T]} color="#9a8465" />
      <InstancedFenceBoxes items={posts} size={[0.1, FENCE_H + 0.06, 0.1]} color="#84704f" />
      {/* Rails sit behind the palings (inside face) at 1/4 and 3/4 height */}
      <InstancedFenceBoxes items={rails.map(r => ({ ...r, x: r.x, z: r.z }))} size={[1, 0.07, 0.038]} color="#84704f" />
    </group>
  );
}

// ── Street (verge + footpath + kerb + road with centreline) ─────────────────

const VERGE_W = 3.4;      // grass nature strip between boundary and kerb
const FOOTPATH_W = 1.4;   // concrete path through the verge
const KERB_W = 0.16;
const ROAD_W = 7.2;

/**
 * A suburban street laid along one boundary edge, on the outward side.
 * Local frame: group at edge midpoint, +X along the edge, outward = -Z
 * (CCW boundary ⇒ outward normal is (uz, -ux), which is local -Z).
 */
export function StreetScene({ boundary, edgeIndex, grassMat, concreteMat, asphaltMat }: {
  boundary: [number, number][];
  edgeIndex: number;
  grassMat: THREE.Material;
  concreteMat: THREE.Material;
  asphaltMat: THREE.Material;
}) {
  const n = boundary.length;
  const [x1, z1] = boundary[edgeIndex];
  const [x2, z2] = boundary[(edgeIndex + 1) % n];
  const len = Math.hypot(x2 - x1, z2 - z1);
  const ux = (x2 - x1) / len, uz = (z2 - z1) / len;
  const rotY = -Math.atan2(uz, ux);
  const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
  const runLen = len + 24; // continue past the lot in both directions

  // Broken white centreline: 3 m marks / 9 m gaps
  const dashes = useMemo(() => {
    const out: number[] = [];
    for (let d = -runLen / 2 + 2; d < runLen / 2 - 2; d += 12) out.push(d + 1.5);
    return out;
  }, [runLen]);

  // Strip helper: plane of size (runLen × w) centred at outward offset `off`
  const Strip = ({ off, w, mat, y }: { off: number; w: number; mat: THREE.Material; y: number }) => (
    <mesh material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, -(off + w / 2)]} receiveShadow>
      <planeGeometry args={[runLen, w]} />
    </mesh>
  );

  return (
    <group position={[mx, 0, mz]} rotation={[0, rotY, 0]}>
      {/* Grass verge from the boundary out to the kerb */}
      <Strip off={0} w={VERGE_W} mat={grassMat} y={0.012} />
      {/* Concrete footpath through the verge */}
      <Strip off={(VERGE_W - FOOTPATH_W) / 2} w={FOOTPATH_W} mat={concreteMat} y={0.02} />
      {/* Kerb — low concrete upstand along the road edge */}
      <mesh rotation={[0, 0, 0]} position={[0, 0.06, -(VERGE_W + KERB_W / 2)]} castShadow receiveShadow>
        <boxGeometry args={[runLen, 0.13, KERB_W]} />
        <meshStandardMaterial color="#a8a69e" roughness={0.9} />
      </mesh>
      {/* Road */}
      <Strip off={VERGE_W + KERB_W} w={ROAD_W} mat={asphaltMat} y={0.008} />
      {/* Broken centreline */}
      {dashes.map((d, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[d, 0.012, -(VERGE_W + KERB_W + ROAD_W / 2)]}>
          <planeGeometry args={[3, 0.12]} />
          <meshStandardMaterial color="#cfd2d6" roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

// ── Trees ────────────────────────────────────────────────────────────────────

/** Layered-canopy tree with deterministic per-position jitter. */
export function Tree({ at, seed }: { at: [number, number]; seed: number }) {
  const { scale, lean, hue } = useMemo(() => {
    const rnd = mulberry32(seed * 2654435761);
    return {
      scale: 0.8 + rnd() * 0.7,
      lean: (rnd() - 0.5) * 0.12,
      hue: rnd(),
    };
  }, [seed]);
  const canopy = hue < 0.5 ? '#4a7340' : '#5c7d3b';
  return (
    <group position={[at[0], 0, at[1]]} scale={[scale, scale, scale]} rotation={[0, 0, lean]}>
      <mesh position={[0, 1.1, 0]} castShadow>
        <cylinderGeometry args={[0.11, 0.17, 2.2, 7]} />
        <meshStandardMaterial color="#6d5138" roughness={0.95} />
      </mesh>
      <mesh position={[0, 2.6, 0]} castShadow>
        <coneGeometry args={[1.45, 2.2, 9]} />
        <meshStandardMaterial color={canopy} roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.7, 0]} castShadow>
        <coneGeometry args={[1.05, 1.8, 9]} />
        <meshStandardMaterial color={canopy} roughness={0.9} />
      </mesh>
      <mesh position={[0, 4.6, 0]} castShadow>
        <coneGeometry args={[0.6, 1.2, 9]} />
        <meshStandardMaterial color={canopy} roughness={0.9} />
      </mesh>
    </group>
  );
}

// ── Shared ground materials (create once per viewer, dispose on unmount) ────

export function useSiteMaterials() {
  const mats = useMemo(() => {
    const grassTile = makeGrassTexture();
    const concreteTile = makeConcreteTexture();
    const asphaltTile = makeAsphaltTexture();

    // World-scale UVs (ShapeGeometry) — repeat = 1/tile-size in metres
    const grassLot = new THREE.MeshStandardMaterial({
      map: toTexture(grassTile, 1 / 4, 1 / 4), roughness: 0.97, metalness: 0, side: THREE.DoubleSide,
    });
    const concreteLot = new THREE.MeshStandardMaterial({
      map: toTexture(concreteTile, 1 / 3, 1 / 3), roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    });
    const pool = new THREE.MeshPhysicalMaterial({
      color: '#2f8fd6', roughness: 0.08, metalness: 0, clearcoat: 0.6, envMapIntensity: 1.4, side: THREE.DoubleSide,
    });

    // 0..1 UVs (street planes) — repeated per strip proportions
    const grassStrip = new THREE.MeshStandardMaterial({
      map: toTexture(grassTile, 16, 1), roughness: 0.97, metalness: 0,
    });
    const concreteStrip = new THREE.MeshStandardMaterial({
      map: toTexture(concreteTile, 24, 1), roughness: 0.9, metalness: 0,
    });
    const asphalt = new THREE.MeshStandardMaterial({
      map: toTexture(asphaltTile, 14, 2), roughness: 0.96, metalness: 0,
    });
    return { grassLot, concreteLot, pool, grassStrip, concreteStrip, asphalt };
  }, []);

  useEffect(() => () => {
    Object.values(mats).forEach(m => {
      (m as THREE.MeshStandardMaterial).map?.dispose();
      m.dispose();
    });
  }, [mats]);

  return mats;
}
