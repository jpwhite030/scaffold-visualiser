'use client';

import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useRouter } from 'next/navigation';
import { BuildingData, footprintBounds } from '@/lib/buildingTypes';
import { computeGearList } from '@/lib/gearList';
import HouseModel from './HouseModel';
import ScaffoldModel from './ScaffoldModel';
import SceneChrome, { ToggleBtn } from './SceneChrome';
import GearListModal from './GearListModal';

export default function ViewerClient({ data }: { data: BuildingData }) {
  const router = useRouter();
  const [showHouse, setShowHouse] = useState(true);
  const [showScaffold, setShowScaffold] = useState(true);
  const [showGearList, setShowGearList] = useState(false);
  const gearList = showGearList ? computeGearList(data) : null;

  const bounds = footprintBounds(data.footprint);
  const diagH = Math.sqrt((bounds.maxX - bounds.minX) ** 2 + (bounds.maxZ - bounds.minZ) ** 2);
  // Contact-shadow plane sized to the footprint plus the scaffold's standoff/margin.
  const groundSpread = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + 8;
  const cameraDistance = diagH * 1.8;
  const cameraHeight = cameraDistance * 0.55;
  const targetHeight = data.eave_height_m / 2;

  const DimPill = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-col">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className="text-white font-medium text-sm">{value}</span>
    </div>
  );

  const w = (bounds.maxX - bounds.minX).toFixed(1);
  const l = (bounds.maxZ - bounds.minZ).toFixed(1);

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
        <button onClick={() => router.push('/review')}
          className="flex items-center gap-2 bg-black/60 hover:bg-black/80 text-white text-sm px-3 py-2 rounded-lg backdrop-blur transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Edit dimensions
        </button>
        <div className="bg-black/60 backdrop-blur rounded-lg px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2">
          <DimPill label="Width" value={`${w}m`} />
          <DimPill label="Length" value={`${l}m`} />
          <DimPill label="Wall height" value={`${data.wall_height_m}m`} />
          <DimPill label="Eave height" value={`${data.eave_height_m}m`} />
          <DimPill label="Roof" value={`${data.roof_type}${data.roof_type !== 'flat' ? ' ' + data.roof_pitch_degrees + '°' : ''}`} />
          <DimPill label="Storeys" value={String(data.num_stories)} />
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
        <div className="flex gap-2">
          <ToggleBtn label="House" active={showHouse} onClick={() => setShowHouse(v => !v)} />
          <ToggleBtn label="Scaffold" active={showScaffold} onClick={() => setShowScaffold(v => !v)} />
          <button
            onClick={() => setShowGearList(true)}
            className="text-sm px-4 py-2 rounded-lg font-medium transition-colors bg-black/50 text-white hover:bg-black/70 shadow"
          >
            Gear List
          </button>
          <button
            onClick={() => { sessionStorage.setItem('quoteMode', 'building'); router.push('/quote'); }}
            className="text-sm px-4 py-2 rounded-lg font-medium transition-colors bg-orange-500 hover:bg-orange-600 text-white shadow"
          >
            Create Quote
          </button>
        </div>
      </div>

      {showGearList && gearList && (
        <GearListModal
          gearList={gearList}
          subtitle={`${w}m × ${l}m · Eave ${data.eave_height_m}m · ${data.num_stories} storey`}
          onClose={() => setShowGearList(false)}
        />
      )}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
        <p className="bg-black/50 backdrop-blur text-gray-300 text-xs px-4 py-2 rounded-full">
          Drag to rotate · Scroll to zoom · Right-click to pan
        </p>
      </div>

      <Canvas shadows camera={{ position: [cameraDistance, cameraHeight, cameraDistance], fov: 45 }}
        gl={{ antialias: true, toneMappingExposure: 1.05 }}>
        <SceneChrome groundSpread={groundSpread} shadowFar={data.eave_height_m + 6} />
        <group>
          {showHouse && <HouseModel data={data} />}
          {showScaffold && <ScaffoldModel data={data} />}
        </group>
        <OrbitControls makeDefault target={[0, targetHeight, 0]} minDistance={3} maxDistance={150} maxPolarAngle={Math.PI / 2 - 0.02} />
      </Canvas>
    </div>
  );
}
