'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { BuildingData, footprintBounds } from '@/lib/buildingTypes';

// Procedural running-bond brickwork, 1 m × 1 m per canvas tile: ~86 mm courses,
// ~240 mm bricks with mortar joints and per-brick colour jitter. Walls are
// UV-mapped in metres, so RepeatWrapping keeps bricks true to scale on every
// wall length. Client-only (canvas), same pattern as the galvanised spangle map.
function makeBrickTexture(): THREE.CanvasTexture {
  const W = 256, Hpx = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Hpx;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#cfc8bb';                 // mortar
  ctx.fillRect(0, 0, W, Hpx);
  const courseH = Hpx / 11.5;                // ≈86 mm brick courses
  const brickW = W / 4.2;                    // ≈240 mm brick + joint
  const joint = 2.4;
  let row = 0;
  for (let y = 0; y < Hpx; y += courseH, row++) {
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let x = -brickW; x < W + brickW; x += brickW) {
      const r = 152 + Math.floor(Math.random() * 42);
      const g = 86 + Math.floor(Math.random() * 24);
      const b = 64 + Math.floor(Math.random() * 18);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x + offset + joint / 2, y + joint / 2, brickW - joint, courseH - joint);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const EAVE_OUT = 0;        // no overhang — keeps roof inside scaffold clearance
const FASCIA_H = 0.14;
const FASCIA_D = 0.022;
const GUTTER_R = 0.055;
const WIN_W    = 1.1;
const WIN_H    = 0.95;
const WIN_SILL = 0.95;
const DOOR_W   = 0.95;
const DOOR_H   = 2.1;

function triGeo(verts: number[], idx: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// rotation.y to make a box's +Z face the outward normal of edge (ux, uz)
function wallRotY(ux: number, uz: number) { return Math.atan2(uz, -ux); }

interface WallItem {
  kind: 'fascia' | 'gutter' | 'window' | 'door';
  id: string;
  x: number; y: number; z: number;
  rotY: number;
  edgeLen: number;
}

export default function HouseModel({ data }: { data: BuildingData }) {
  if (!data.footprint?.length) return null;

  const { footprint, wall_height_m, roof_type, roof_pitch_degrees } = data;
  // H = total height to eave/gutter — this is where the roof starts and scaffold reaches
  const H = data.eave_height_m ?? wall_height_m;
  // Infer storeys from heights if not provided correctly
  const storeys = (data.num_stories && data.num_stories > 1) || H > wall_height_m * 1.5 ? 2 : 1;
  const floorH = storeys > 1 ? wall_height_m : H; // height of each storey
  const pitchRad = (roof_pitch_degrees * Math.PI) / 180;
  const n = footprint.length;

  const wallGeo = useMemo(() => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let vi = 0;
    for (let i = 0; i < n; i++) {
      const [x1, z1] = footprint[i];
      const [x2, z2] = footprint[(i + 1) % n];
      const len = Math.hypot(x2 - x1, z2 - z1);
      pos.push(x1, 0, z1, x2, 0, z2, x2, H, z2, x1, H, z1);
      // UVs in metres so the 1 m brick tile repeats at true scale
      uv.push(0, 0, len, 0, len, H, 0, H);
      idx.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
      vi += 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }, [footprint, H, n]);

  const brickTex = useMemo(() => makeBrickTexture(), []);
  useEffect(() => () => brickTex.dispose(), [brickTex]);

  const bounds = useMemo(() => footprintBounds(footprint), [footprint]);
  const { minX, maxX, minZ, maxZ } = bounds;
  const bW = maxX - minX, bL = maxZ - minZ;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

  const rMinX = minX - EAVE_OUT, rMaxX = maxX + EAVE_OUT;
  const rMinZ = minZ - EAVE_OUT, rMaxZ = maxZ + EAVE_OUT;

  const ridgeAlongZ = bL >= bW;
  const halfSlope = (ridgeAlongZ ? bW : bL) / 2;
  const ridgeH = halfSlope * Math.tan(pitchRad);

  const roofPanels = useMemo(() => {
    if (roof_type === 'flat') return null;

    const gf = data.gable_faces ?? [];

    // Non-rectangular footprint: tent/pyramid roof
    if (n > 4) {
      const peakY = H + ridgeH;
      return footprint.map((_, i) => {
        const [x1, z1] = footprint[i];
        const [x2, z2] = footprint[(i + 1) % n];
        return triGeo([x1, H, z1, x2, H, z2, cx, peakY, cz], [0, 1, 2]);
      });
    }

    // Rectangular footprint.
    // If gable_faces is set, derive ridge direction from which face is marked;
    // otherwise fall back to building proportions.
    let useRidgeAlongZ = ridgeAlongZ;
    const hasPerFaceGable = gf.some(g => g);
    if (hasPerFaceGable) {
      const gi = gf.findIndex(g => g);
      const [ax, az] = footprint[gi];
      const [bx, bz] = footprint[(gi + 1) % n];
      // Face runs along X (|dx|>|dz|) → ridge along Z; runs along Z → ridge along X
      useRidgeAlongZ = Math.abs(bx - ax) > Math.abs(bz - az);
    }

    // Helper: is face i a gable end?
    // When gable_faces drives the choice, use it directly; otherwise use roof_type.
    const isGableEnd = (i: number) =>
      hasPerFaceGable ? (gf[i] ?? false) : roof_type === 'gable';

    if (useRidgeAlongZ) {
      // Ridge runs along Z — slope panels on left (face 3) and right (face 1)
      const L = triGeo([rMinX,H,rMinZ, rMinX,H,rMaxZ, cx,H+ridgeH,rMaxZ, cx,H+ridgeH,rMinZ], [0,1,2,0,2,3]);
      const R = triGeo([rMaxX,H,rMinZ, rMaxX,H,rMaxZ, cx,H+ridgeH,rMaxZ, cx,H+ridgeH,rMinZ], [0,3,2,0,2,1]);
      const panels: THREE.BufferGeometry[] = [L, R];
      // Front end (face 0, z=rMinZ)
      if (isGableEnd(0)) {
        panels.push(triGeo([rMaxX,H,rMinZ, rMinX,H,rMinZ, cx,H+ridgeH,rMinZ], [0,1,2]));
      } else {
        const hipRun = Math.max((rMaxZ - rMinZ) / 2 - halfSlope / Math.tan(pitchRad), 0);
        panels.push(triGeo([rMaxX,H,rMinZ, rMinX,H,rMinZ, cx,H+ridgeH,cz-hipRun], [0,1,2]));
      }
      // Back end (face 2, z=rMaxZ)
      if (isGableEnd(2)) {
        panels.push(triGeo([rMinX,H,rMaxZ, rMaxX,H,rMaxZ, cx,H+ridgeH,rMaxZ], [0,1,2]));
      } else {
        const hipRun = Math.max((rMaxZ - rMinZ) / 2 - halfSlope / Math.tan(pitchRad), 0);
        panels.push(triGeo([rMinX,H,rMaxZ, rMaxX,H,rMaxZ, cx,H+ridgeH,cz+hipRun], [0,1,2]));
      }
      return panels;
    }

    // Ridge runs along X — slope panels on front (face 0) and back (face 2)
    const F = triGeo([rMinX,H,rMinZ, rMaxX,H,rMinZ, rMaxX,H+ridgeH,cz, rMinX,H+ridgeH,cz], [0,3,2,0,2,1]);
    const B = triGeo([rMinX,H,rMaxZ, rMaxX,H,rMaxZ, rMaxX,H+ridgeH,cz, rMinX,H+ridgeH,cz], [0,1,2,0,2,3]);
    const panels: THREE.BufferGeometry[] = [F, B];
    // Left end (face 3, x=rMinX)
    if (isGableEnd(3)) {
      panels.push(triGeo([rMinX,H,rMinZ, rMinX,H,rMaxZ, rMinX,H+ridgeH,cz], [0,1,2]));
    }
    // Right end (face 1, x=rMaxX)
    if (isGableEnd(1)) {
      panels.push(triGeo([rMaxX,H,rMaxZ, rMaxX,H,rMinZ, rMaxX,H+ridgeH,cz], [0,1,2]));
    }
    return panels;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roof_type, H, ridgeH, ridgeAlongZ, rMinX, rMaxX, rMinZ, rMaxZ, n, footprint, cx, cz, data.gable_faces]);

  const items = useMemo<WallItem[]>(() => {
    // Front wall = most-negative-Z-facing wall with the largest mid-Z from bottom
    let frontI = 0, bestFrontScore = Infinity;
    for (let i = 0; i < n; i++) {
      const [x1, z1] = footprint[i];
      const [x2, z2] = footprint[(i + 1) % n];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.5) continue;
      const ux = (x2 - x1) / len;
      const ozZ = -ux; // outward normal Z component
      if (ozZ < -0.5) {
        const midZ = (z1 + z2) / 2;
        if (midZ < bestFrontScore) { bestFrontScore = midZ; frontI = i; }
      }
    }

    const result: WallItem[] = [];

    for (let i = 0; i < n; i++) {
      const [x1, z1] = footprint[i];
      const [x2, z2] = footprint[(i + 1) % n];
      const edgeLen = Math.hypot(x2 - x1, z2 - z1);
      if (edgeLen < 0.3) continue;
      const ux = (x2 - x1) / edgeLen, uz = (z2 - z1) / edgeLen;
      const ozX = uz, ozZ = -ux;
      const rotY = wallRotY(ux, uz);
      const isFront = i === frontI;

      // Fascia centre (slightly proud of wall face)
      result.push({
        kind: 'fascia', id: `fas-${i}`,
        x: (x1 + x2) / 2 + ozX * FASCIA_D * 0.5,
        y: H - FASCIA_H / 2,
        z: (z1 + z2) / 2 + ozZ * FASCIA_D * 0.5,
        rotY, edgeLen,
      });

      // Gutter below fascia
      result.push({
        kind: 'gutter', id: `gut-${i}`,
        x: (x1 + x2) / 2 + ozX * (FASCIA_D + GUTTER_R * 0.6),
        y: H - FASCIA_H - GUTTER_R * 0.5,
        z: (z1 + z2) / 2 + ozZ * (FASCIA_D + GUTTER_R * 0.6),
        rotY, edgeLen,
      });

      if (edgeLen < 1.5) continue;

      // Door on front wall
      if (isFront) {
        const dt = edgeLen > 4 ? 0.33 : 0.5;
        result.push({
          kind: 'door', id: `door-${i}`,
          x: x1 + dt * (x2 - x1) + ozX * 0.02,
          y: DOOR_H / 2,
          z: z1 + dt * (z2 - z1) + ozZ * 0.02,
          rotY, edgeLen,
        });
      }

      // Windows — ground floor
      const winTs: number[] = [];
      if (isFront) {
        if (edgeLen > 5.5) winTs.push(0.72, 0.88);
        else if (edgeLen > 3.5) winTs.push(0.78);
      } else {
        if (edgeLen > 4.5) winTs.push(0.27, 0.73);
        else if (edgeLen > 1.8) winTs.push(0.5);
      }
      for (const t of winTs) {
        result.push({
          kind: 'window', id: `win-${i}-${t}`,
          x: x1 + t * (x2 - x1) + ozX * 0.02,
          y: WIN_SILL + WIN_H / 2,
          z: z1 + t * (z2 - z1) + ozZ * 0.02,
          rotY, edgeLen,
        });
      }

      // Upper floor windows (if 2-storey)
      if (storeys > 1) {
        const upperTs: number[] = edgeLen > 4.5 ? [0.25, 0.75] : edgeLen > 2 ? [0.5] : [];
        for (const t of upperTs) {
          result.push({
            kind: 'window', id: `win2-${i}-${t}`,
            x: x1 + t * (x2 - x1) + ozX * 0.02,
            y: floorH + WIN_SILL + WIN_H / 2,
            z: z1 + t * (z2 - z1) + ozZ * 0.02,
            rotY, edgeLen,
          });
        }
      }
    }

    return result;
  }, [footprint, H, n, storeys, floorH]);

  return (
    <group>
      {/* Walls — running-bond brickwork like the sales renders */}
      <mesh geometry={wallGeo} castShadow receiveShadow>
        <meshStandardMaterial map={brickTex} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>

      {/* Flat roof cap */}
      {roof_type === 'flat' && (
        <mesh position={[cx, H + 0.05, cz]} castShadow>
          <boxGeometry args={[bW + 0.1, 0.1, bL + 0.1]} />
          <meshStandardMaterial color="#999" roughness={0.95} />
        </mesh>
      )}

      {/* Pitched roof */}
      {roofPanels?.map((geo, i) => (
        <mesh key={i} geometry={geo} castShadow>
          <meshStandardMaterial color="#7a4f28" roughness={0.88} side={THREE.DoubleSide} />
        </mesh>
      ))}

      {/* Ridge cap — rectangular buildings only; L-shapes use a tent peak instead */}
      {n === 4 && roof_type !== 'flat' && (
        <mesh position={[cx, H + ridgeH, cz]} castShadow>
          <boxGeometry args={ridgeAlongZ
            ? [0.08, 0.08, bL + EAVE_OUT * 2]
            : [bW + EAVE_OUT * 2, 0.08, 0.08]}
          />
          <meshStandardMaterial color="#5a3818" roughness={0.8} />
        </mesh>
      )}

      {/* Wall details */}
      {items.map(d => {
        const rot: [number, number, number] = [0, d.rotY, 0];

        if (d.kind === 'fascia') return (
          <mesh key={d.id} position={[d.x, d.y, d.z]} rotation={rot} castShadow>
            <boxGeometry args={[d.edgeLen + 0.06, FASCIA_H, FASCIA_D]} />
            <meshStandardMaterial color="#f5f5f0" roughness={0.45} />
          </mesh>
        );

        if (d.kind === 'gutter') return (
          <mesh key={d.id} position={[d.x, d.y, d.z]} rotation={[0, d.rotY, Math.PI / 2]} castShadow>
            <cylinderGeometry args={[GUTTER_R, GUTTER_R, d.edgeLen + 0.06, 10, 1, false, 0, Math.PI]} />
            <meshStandardMaterial color="#555" metalness={0.35} roughness={0.55} />
          </mesh>
        );

        if (d.kind === 'door') return (
          <group key={d.id} position={[d.x, d.y, d.z]} rotation={rot}>
            {/* surround */}
            <mesh>
              <boxGeometry args={[DOOR_W + 0.12, DOOR_H + 0.1, 0.045]} />
              <meshStandardMaterial color="#e8e2d4" roughness={0.5} />
            </mesh>
            {/* panel */}
            <mesh position={[0, 0, 0.018]}>
              <boxGeometry args={[DOOR_W, DOOR_H, 0.06]} />
              <meshStandardMaterial color="#5c3d1e" roughness={0.9} />
            </mesh>
            {/* handle */}
            <mesh position={[DOOR_W * 0.35, -0.12, 0.055]}>
              <sphereGeometry args={[0.032, 8, 8]} />
              <meshStandardMaterial color="#c8a020" metalness={0.85} roughness={0.15} />
            </mesh>
          </group>
        );

        if (d.kind === 'window') return (
          <group key={d.id} position={[d.x, d.y, d.z]} rotation={rot}>
            {/* outer frame */}
            <mesh>
              <boxGeometry args={[WIN_W + 0.12, WIN_H + 0.14, 0.045]} />
              <meshStandardMaterial color="#e8e2d4" roughness={0.5} />
            </mesh>
            {/* glass */}
            <mesh position={[0, 0, 0.018]}>
              <boxGeometry args={[WIN_W, WIN_H, 0.022]} />
              <meshStandardMaterial color="#9bc8e2" transparent opacity={0.6} roughness={0.05} metalness={0.05} />
            </mesh>
            {/* horizontal divider */}
            <mesh position={[0, 0, 0.03]}>
              <boxGeometry args={[WIN_W, 0.04, 0.016]} />
              <meshStandardMaterial color="#e8e2d4" roughness={0.5} />
            </mesh>
            {/* vertical divider */}
            <mesh position={[0, 0, 0.03]}>
              <boxGeometry args={[0.04, WIN_H, 0.016]} />
              <meshStandardMaterial color="#e8e2d4" roughness={0.5} />
            </mesh>
          </group>
        );

        return null;
      })}
    </group>
  );
}
