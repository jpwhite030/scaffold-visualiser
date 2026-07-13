'use client';

import { useMemo, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import { useRouter } from 'next/navigation';
import { footprintBounds } from '@/lib/buildingTypes';
import { SiteData, buildingLocalFrame } from '@/lib/siteTypes';
import { computeGearList, sumGearLists } from '@/lib/gearList';
import HouseModel from './HouseModel';
import ScaffoldModel from './ScaffoldModel';
import SceneChrome, { ToggleBtn } from './SceneChrome';
import GearListModal from './GearListModal';

// Flat polygon lying on the ground (lot surface, driveways, paths, pool).
// THREE.Shape lives in XY; rotating -90° about X maps shape (x, y) → world
// (x, 0, -y), so feed it (x, -z) to land on the site's XZ coordinates.
function FlatPolygon({ points, y, color, roughness = 0.95 }: {
  points: [number, number][];
  y: number;
  color: string;
  roughness?: number;
}) {
  const geo = useMemo(() => {
    const shape = new THREE.Shape();
    points.forEach(([x, z], i) => {
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [points]);
  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} position={[0, y, 0]} receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} metalness={0} side={THREE.DoubleSide} />
    </mesh>
  );
}

const SURFACE_COLORS: Record<string, { color: string; roughness: number }> = {
  driveway: { color: '#8d939c', roughness: 0.9 },
  path:     { color: '#a3a8af', roughness: 0.9 },
  pool:     { color: '#2f7fd4', roughness: 0.15 },
};

function Tree({ at }: { at: [number, number] }) {
  return (
    <group position={[at[0], 0, at[1]]}>
      <mesh position={[0, 0.8, 0]} castShadow>
        <cylinderGeometry args={[0.1, 0.14, 1.6, 8]} />
        <meshStandardMaterial color="#6b4f2e" roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.6, 0]} castShadow>
        <coneGeometry args={[1.2, 2.6, 10]} />
        <meshStandardMaterial color="#3e6b35" roughness={0.85} />
      </mesh>
    </group>
  );
}

export default function SiteViewerClient({ site: initialSite }: { site: SiteData }) {
  const router = useRouter();
  const [site, setSite] = useState<SiteData>(initialSite);
  const [showHouses, setShowHouses] = useState(true);
  const [showScaffold, setShowScaffold] = useState(true);
  const [showGearList, setShowGearList] = useState(false);

  const bounds = footprintBounds(site.boundary);
  const lotW = bounds.maxX - bounds.minX;
  const lotD = bounds.maxZ - bounds.minZ;
  const diag = Math.hypot(lotW, lotD);
  const groundSpread = Math.max(lotW, lotD) + 8;
  const cameraDistance = Math.max(14, diag * 0.9);
  const cameraHeight = cameraDistance * 0.6;
  const maxEave = site.buildings.reduce((m, b) => Math.max(m, b.data.eave_height_m), 0);

  // Each building renders in a local axis-aligned frame (HouseModel's roof and
  // ScaffoldModel's gable detection assume axis alignment), positioned/rotated
  // back into the site by the wrapping group.
  const frames = useMemo(
    () => site.buildings.map(b => {
      const { center, angleRad, localFootprint } = buildingLocalFrame(b.data.footprint);
      return { building: b, center, angleRad, localData: { ...b.data, footprint: localFootprint } };
    }),
    [site.buildings]
  );

  const scaffolded = site.buildings.filter(b => b.scaffold_enabled);
  const gearList = showGearList && scaffolded.length > 0
    ? sumGearLists(scaffolded.map(b => computeGearList(b.data)))
    : null;

  const toggleScaffold = (id: string) => {
    setSite(prev => {
      const next = {
        ...prev,
        buildings: prev.buildings.map(b =>
          b.id === id ? { ...b, scaffold_enabled: !b.scaffold_enabled } : b
        ),
      };
      // Keep the stored site in sync so the quote page sees the same toggles.
      try { sessionStorage.setItem('siteData', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const boundaryLine = useMemo(() => {
    const pts = site.boundary.map(([x, z]) => [x, 0.05, z] as [number, number, number]);
    pts.push(pts[0]);
    return pts;
  }, [site.boundary]);

  const DimPill = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-col">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className="text-white font-medium text-sm">{value}</span>
    </div>
  );

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
        <button onClick={() => router.push('/site-review')}
          className="flex items-center gap-2 bg-black/60 hover:bg-black/80 text-white text-sm px-3 py-2 rounded-lg backdrop-blur transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Edit site
        </button>
        <div className="bg-black/60 backdrop-blur rounded-lg px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2">
          <DimPill label="Lot" value={`${lotW.toFixed(1)}m × ${lotD.toFixed(1)}m`} />
          <DimPill label="Buildings" value={String(site.buildings.length)} />
          <DimPill label="Scaffolded" value={String(scaffolded.length)} />
          <DimPill label="Max eave" value={`${maxEave.toFixed(1)}m`} />
        </div>

        {/* Per-building scaffold toggles */}
        {site.buildings.length > 0 && (
          <div className="bg-black/60 backdrop-blur rounded-lg px-4 py-3">
            <p className="text-gray-400 text-xs mb-2">Scaffold per building</p>
            <div className="flex flex-col gap-1.5">
              {site.buildings.map(b => (
                <label key={b.id} className="flex items-center gap-2 text-sm text-white cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={b.scaffold_enabled}
                    onChange={() => toggleScaffold(b.id)}
                    className="accent-orange-500 w-4 h-4"
                  />
                  {b.label}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
        <div className="flex gap-2">
          <ToggleBtn label="Houses" active={showHouses} onClick={() => setShowHouses(v => !v)} />
          <ToggleBtn label="Scaffold" active={showScaffold} onClick={() => setShowScaffold(v => !v)} />
          <button
            onClick={() => setShowGearList(true)}
            className="text-sm px-4 py-2 rounded-lg font-medium transition-colors bg-black/50 text-white hover:bg-black/70 shadow"
          >
            Gear List
          </button>
          <button
            onClick={() => { sessionStorage.setItem('quoteMode', 'site'); router.push('/quote'); }}
            className="text-sm px-4 py-2 rounded-lg font-medium transition-colors bg-orange-500 hover:bg-orange-600 text-white shadow"
          >
            Create Quote
          </button>
        </div>
      </div>

      {showGearList && (gearList ? (
        <GearListModal
          gearList={gearList}
          subtitle={`${scaffolded.length} of ${site.buildings.length} building${site.buildings.length === 1 ? '' : 's'} scaffolded · lot ${lotW.toFixed(1)}m × ${lotD.toFixed(1)}m`}
          onClose={() => setShowGearList(false)}
        />
      ) : (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowGearList(false)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm mx-4 px-6 py-5" onClick={e => e.stopPropagation()}>
            <p className="text-gray-700 text-sm">No buildings have scaffold enabled — tick a building in the “Scaffold per building” panel first.</p>
          </div>
        </div>
      ))}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
        <p className="bg-black/50 backdrop-blur text-gray-300 text-xs px-4 py-2 rounded-full">
          Drag to rotate · Scroll to zoom · Right-click to pan
        </p>
      </div>

      <Canvas shadows camera={{ position: [cameraDistance, cameraHeight, cameraDistance], fov: 45 }}
        gl={{ antialias: true, toneMappingExposure: 1.05 }}>
        <SceneChrome groundSpread={groundSpread} shadowFar={Math.max(maxEave, 3) + 6} />

        {/* Lot surface — sits just above the dark ground so the block reads as grass */}
        <FlatPolygon points={site.boundary} y={0.015} color="#4a6b3f" roughness={0.98} />

        {/* Boundary line + corner posts */}
        <Line points={boundaryLine} color="#f5f7fa" lineWidth={2} transparent opacity={0.85} />
        {site.boundary.map(([x, z], i) => (
          <mesh key={i} position={[x, 0.45, z]} castShadow>
            <boxGeometry args={[0.09, 0.9, 0.09]} />
            <meshStandardMaterial color="#d7dbe0" roughness={0.6} metalness={0.3} />
          </mesh>
        ))}

        {/* Driveways / paths / pool */}
        {site.surfaces.map(s => {
          const style = SURFACE_COLORS[s.kind] ?? SURFACE_COLORS.driveway;
          return <FlatPolygon key={s.id} points={s.polygon} y={0.035} color={style.color} roughness={style.roughness} />;
        })}

        {/* Buildings — HouseModel/ScaffoldModel untouched, wrapped in a local frame */}
        {frames.map(({ building, center, angleRad, localData }) => (
          <group key={building.id} position={[center[0], 0, center[1]]} rotation={[0, angleRad, 0]}>
            {showHouses && <HouseModel data={localData} />}
            {showScaffold && building.scaffold_enabled && <ScaffoldModel data={localData} />}
          </group>
        ))}

        {site.trees?.map((t, i) => <Tree key={i} at={t} />)}

        <OrbitControls makeDefault target={[0, 2, 0]} minDistance={5} maxDistance={300} maxPolarAngle={Math.PI / 2 - 0.02} />
      </Canvas>
    </div>
  );
}
