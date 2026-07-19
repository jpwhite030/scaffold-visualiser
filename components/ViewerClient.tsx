'use client';

import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useRouter } from 'next/navigation';
import { BuildingData, footprintBounds } from '@/lib/buildingTypes';
import { computeGearList } from '@/lib/gearList';
import HouseModel from './HouseModel';
import ScaffoldModel, { KIT_COLOURS } from './ScaffoldModel';
import SceneChrome, { ToggleBtn } from './SceneChrome';
import GearListModal from './GearListModal';

export default function ViewerClient({ data }: { data: BuildingData }) {
  const router = useRouter();
  const [showHouse, setShowHouse] = useState(true);
  const [showScaffold, setShowScaffold] = useState(true);
  const [showGearList, setShowGearList] = useState(false);
  const [kitView, setKitView] = useState(false);
  const gearList = (showGearList || kitView) ? computeGearList(data) : null;

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
          <ToggleBtn label="Kit view" active={kitView} onClick={() => setKitView(v => !v)} />
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

      {kitView && gearList && (() => {
        const led = gearList.ledgers, brd = gearList.deckBoards;
        const stdTotal = Object.values(gearList.standards).reduce((s, n) => s + n, 0);
        const part = (n: number | undefined, word: string) => (n ? `${n} ${word}` : null);
        const row = (colour: string, label: string, bits: (string | null)[]) => {
          const detail = bits.filter(Boolean).join(' · ');
          return detail ? (
            <div key={label} className="flex items-center gap-2.5">
              <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: colour }} />
              <span className="text-gray-200 w-16 shrink-0">{label}</span>
              <span className="text-gray-400">{detail}</span>
            </div>
          ) : null;
        };
        return (
          <div className="absolute bottom-6 left-4 z-10 bg-black/60 backdrop-blur rounded-lg px-4 py-3 text-xs space-y-1.5">
            <p className="text-white font-semibold text-sm">Kit — by stock length</p>
            {row(KIT_COLOURS.len24, '2.4 m', [part(led['2.4m'], 'ledgers'), part(brd['2.4m'], 'boards')])}
            {row(KIT_COLOURS.len18, '1.8 m', [part(led['1.8m'], 'ledgers'), part(brd['1.8m'], 'boards')])}
            {row(KIT_COLOURS.len12, '1.2 m', [part(led['1.2m'], 'ledgers'), part(brd['1.2m'], 'boards'), part(gearList.transoms, 'transoms')])}
            {row(KIT_COLOURS.len07, '0.76 m', [part(led['0.76m'], 'ledgers'), part(brd['0.76m'], 'boards')])}
            {row(KIT_COLOURS.brace, 'Braces', [part(gearList.braces, 'pcs')])}
            {row(KIT_COLOURS.rail, 'Rails', [part(gearList.guardrails, 'pcs')])}
            {row(KIT_COLOURS.std, 'Standards', [part(stdTotal, 'pcs')])}
          </div>
        );
      })()}

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
          {showScaffold && <ScaffoldModel data={data} kitView={kitView} />}
        </group>
        <OrbitControls makeDefault target={[0, targetHeight, 0]} minDistance={3} maxDistance={150} maxPolarAngle={Math.PI / 2 - 0.02} />
      </Canvas>
    </div>
  );
}
