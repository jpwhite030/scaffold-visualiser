'use client';

import { useState, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, SoftShadows } from '@react-three/drei';
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

      <Canvas shadows camera={{ position: [cameraDistance, cameraHeight, cameraDistance], fov: 45 }}
        gl={{ antialias: true, toneMappingExposure: 1.05 }}>
        {/* Smooth vertical gradient backdrop instead of a flat fill */}
        <GradientBackground top="#0d1322" bottom="#2b3a57" />

        {/* Soft, penumbra shadows for a realistic rendered look */}
        <SoftShadows size={26} samples={16} focus={0.9} />

        <ambientLight intensity={0.45} />
        {/* Warm key light */}
        <directionalLight position={[20, 28, 16]} intensity={2.6} color="#fff3e2" castShadow
          shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.02}
          shadow-camera-far={140}
          shadow-camera-left={-40} shadow-camera-right={40}
          shadow-camera-top={40} shadow-camera-bottom={-40} />
        {/* Cool fill from the opposite side to lift the shadows */}
        <directionalLight position={[-18, 12, -14]} intensity={0.55} color="#cdddff" />
        <hemisphereLight args={['#dcebff', '#5c6347', 0.55]} />

        {/* Ground plane that catches only the soft shadow — grid shows through */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[400, 400]} />
          <shadowMaterial transparent opacity={0.32} />
        </mesh>

        <Grid args={[80, 80]} position={[0, -0.02, 0]} cellColor="#33394a" sectionColor="#4a5570"
          fadeDistance={65} fadeStrength={1.5} infiniteGrid />
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

// Paints a smooth vertical gradient as the scene background using a canvas
// texture — deterministic top→bottom colours, no orientation guesswork.
function GradientBackground({ top, bottom }: { top: string; bottom: string }) {
  const { scene } = useThree();
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 2, 512);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const prev = scene.background;
    scene.background = tex;
    return () => {
      scene.background = prev;
      tex.dispose();
    };
  }, [scene, top, bottom]);
  return null;
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
