'use client';

import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import { useRouter } from 'next/navigation';
import { BuildingData, footprintBounds } from '@/lib/buildingTypes';
import { computeGearList, GearList } from '@/lib/gearList';
import HouseModel from './HouseModel';
import ScaffoldModel from './ScaffoldModel';

export default function ViewerClient({ data }: { data: BuildingData }) {
  const router = useRouter();
  const [showHouse, setShowHouse] = useState(true);
  const [showScaffold, setShowScaffold] = useState(true);
  const [showGearList, setShowGearList] = useState(false);
  const gearList = showGearList ? computeGearList(data) : null;

  const bounds = footprintBounds(data.footprint);
  const diagH = Math.sqrt((bounds.maxX - bounds.minX) ** 2 + (bounds.maxZ - bounds.minZ) ** 2);
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
            onClick={() => router.push('/quote')}
            className="text-sm px-4 py-2 rounded-lg font-medium transition-colors bg-orange-500 hover:bg-orange-600 text-white shadow"
          >
            Create Quote
          </button>
        </div>
      </div>

      {showGearList && gearList && (
        <GearListModal gearList={gearList} data={data} onClose={() => setShowGearList(false)} />
      )}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
        <p className="bg-black/50 backdrop-blur text-gray-300 text-xs px-4 py-2 rounded-full">
          Drag to rotate · Scroll to zoom · Right-click to pan
        </p>
      </div>

      <Canvas shadows camera={{ position: [cameraDistance, cameraHeight, cameraDistance], fov: 45 }} gl={{ antialias: true }}>
        <color attach="background" args={['#1a1e2b']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[15, 20, 10]} intensity={1.5} castShadow
          shadow-mapSize={[2048, 2048]} shadow-camera-far={100}
          shadow-camera-left={-30} shadow-camera-right={30}
          shadow-camera-top={30} shadow-camera-bottom={-30} />
        <hemisphereLight args={['#b0c4ff', '#556644', 0.3]} />
        <Grid args={[80, 80]} position={[0, -0.01, 0]} cellColor="#3a3f50" sectionColor="#505570" fadeDistance={60} infiniteGrid />
        <Environment preset="city" />
        <group>
          {showHouse && <HouseModel data={data} />}
          {showScaffold && <ScaffoldModel data={data} />}
        </group>
        <OrbitControls makeDefault target={[0, targetHeight, 0]} minDistance={3} maxDistance={150} maxPolarAngle={Math.PI / 2 - 0.02} />
      </Canvas>
    </div>
  );
}

function ToggleBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`text-sm px-4 py-2 rounded-lg font-medium transition-colors ${active ? 'bg-white text-gray-900 shadow' : 'bg-black/50 text-gray-400 hover:bg-black/70'}`}>
      {label}
    </button>
  );
}

function GearListModal({ gearList, data, onClose }: { gearList: GearList; data: BuildingData; onClose: () => void }) {
  const bounds = footprintBounds(data.footprint);
  const w = (bounds.maxX - bounds.minX).toFixed(1);
  const l = (bounds.maxZ - bounds.minZ).toFixed(1);

  const Row = ({ label, value, sub }: { label: string; value: string | number; sub?: string }) => (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-2 pr-4 text-gray-700 font-medium">{label}</td>
      <td className="py-2 text-right font-mono font-semibold text-gray-900">{value}</td>
      {sub && <td className="py-2 pl-3 text-gray-400 text-sm">{sub}</td>}
    </tr>
  );

  const Section = ({ title }: { title: string }) => (
    <tr>
      <td colSpan={3} className="pt-4 pb-1">
        <span className="text-xs font-bold text-orange-500 uppercase tracking-widest">{title}</span>
      </td>
    </tr>
  );

  const totalLedgers = Object.values(gearList.ledgers).reduce((a, b) => a + b, 0);
  const totalBoards  = Object.values(gearList.deckBoards).reduce((a, b) => a + b, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Kwikstage Gear List</h2>
            <p className="text-xs text-gray-400">{w}m × {l}m · Eave {data.eave_height_m}m · {data.num_stories} storey</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-2">
          <table className="w-full text-sm">
            <tbody>
              <Section title="Uprights" />
              {Object.entries(gearList.standards)
                .sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]))
                .map(([size, cnt]) => (
                  <Row key={size} label={`Standard ${size}`} value={cnt} />
                ))}
              <Row label="Base Plates" value={gearList.basePlates} sub="150 × 150 mm" />
              <Row label="Screw Jacks" value={gearList.screwJacks} sub="adjustable base jacks" />

              <Section title="Horizontals" />
              <Row label="Ledgers (total)" value={totalLedgers} />
              {Object.entries(gearList.ledgers).sort().map(([len, cnt]) => (
                <Row key={len} label={`  └ ${len}`} value={cnt} />
              ))}
              <Row label="Transoms (1.2m)" value={gearList.transoms} sub="inner ↔ outer" />

              <Section title="Bracing" />
              <Row label="Diagonal Braces" value={gearList.braces} />

              <Section title="Decking" />
              <Row label="Steel Boards (total)" value={totalBoards} />
              {Object.entries(gearList.deckBoards).sort().map(([len, cnt]) => (
                <Row key={len} label={`  └ ${len}`} value={cnt} />
              ))}
              <Row label="Toe Boards" value={gearList.toeBoards} />

              <Section title="Guardrails" />
              <Row label="Guard Rails" value={gearList.guardrails} sub="top + mid rail combined" />
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <p className="text-xs text-gray-400 text-center">
            Quantities are approximate — verify against site drawings before ordering.
          </p>
        </div>
      </div>
    </div>
  );
}
