'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useRouter } from 'next/navigation';
import { BuildingData, footprintBounds, scaleBuilding } from '@/lib/buildingTypes';
import { computeGearList } from '@/lib/gearList';
import { captureQuoteRenders } from '@/lib/captureRenders';
import HouseModel from './HouseModel';
import ScaffoldModel, { KIT_COLOURS } from './ScaffoldModel';
import SceneChrome, { ToggleBtn } from './SceneChrome';
import GearListModal from './GearListModal';

export default function ViewerClient({ data: baseData, readOnly = false, header }: {
  data: BuildingData;
  /** Share-link mode: keeps the view toggles + gear list, drops every route into the app. */
  readOnly?: boolean;
  header?: { title: string; subtitle?: string };
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [showHouse, setShowHouse] = useState(true);
  const [showScaffold, setShowScaffold] = useState(true);
  const [showGearList, setShowGearList] = useState(false);
  const [kitView, setKitView] = useState(false);

  // Scale calibration — a traced plan can be a few percent off, and builders
  // clock a wrong-sized model instantly. Everything below (scaffold, gear
  // list, quote, save) derives from the scaled data, so calibrating here
  // recounts the whole job.
  const [showScale, setShowScale] = useState(false);
  const [scalePct, setScalePct] = useState(100);
  const [scaleHeights, setScaleHeights] = useState(false);
  const data = useMemo(
    () => scaleBuilding(baseData, scalePct / 100, scaleHeights),
    [baseData, scalePct, scaleHeights],
  );

  // Persist the calibrated size so Create Quote, Edit dimensions and
  // Save to job map all pick it up (and Reset restores the original).
  // On reload the calibrated size becomes the new 100%.
  useEffect(() => {
    if (readOnly) return;
    try { sessionStorage.setItem('buildingData', JSON.stringify(data)); } catch { /* ignore */ }
  }, [data, readOnly]);

  const gearList = (showGearList || kitView) ? computeGearList(data) : null;

  const bounds = footprintBounds(data.footprint);
  const diagH = Math.sqrt((bounds.maxX - bounds.minX) ** 2 + (bounds.maxZ - bounds.minZ) ** 2);
  // Contact-shadow plane sized to the footprint plus the scaffold's standoff/margin.
  const groundSpread = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) + 8;
  const cameraDistance = diagH * 1.35;
  const cameraHeight = cameraDistance * 0.5;
  const targetHeight = data.eave_height_m / 2;

  const DimPill = ({ label, value }: { label: string; value: string }) => (
    <div className="flex flex-col">
      <span className="text-gray-400 text-xs">{label}</span>
      <span className="text-white font-medium text-sm">{value}</span>
    </div>
  );

  const w = (bounds.maxX - bounds.minX).toFixed(1);
  const l = (bounds.maxZ - bounds.minZ).toFixed(1);

  // Unscaled dimensions — the calibration fields turn "the wall is really X m"
  // into a percentage against these.
  const baseBounds = footprintBounds(baseData.footprint);
  const baseW = baseBounds.maxX - baseBounds.minX;
  const baseL = baseBounds.maxZ - baseBounds.minZ;

  return (
    <div className="relative w-full h-full">
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-3">
        {readOnly ? (
          header && (
            <div className="bg-black/60 backdrop-blur rounded-lg px-4 py-3 max-w-xs">
              <p className="text-white font-semibold text-sm leading-snug">{header.title}</p>
              {header.subtitle && <p className="text-gray-400 text-xs mt-0.5">{header.subtitle}</p>}
              <p className="text-orange-400 text-[11px] font-semibold mt-2 uppercase tracking-wide">Prepared by Skelscaff</p>
            </div>
          )
        ) : (
          <button onClick={() => router.push('/review')}
            className="flex items-center gap-2 bg-black/60 hover:bg-black/80 text-white text-sm px-3 py-2 rounded-lg backdrop-blur transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Edit dimensions
          </button>
        )}
        <div className="bg-black/60 backdrop-blur rounded-lg px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-2">
          <DimPill label="Width" value={`${w}m`} />
          <DimPill label="Length" value={`${l}m`} />
          <DimPill label="Wall height" value={`${Math.round(data.wall_height_m * 100) / 100}m`} />
          <DimPill label="Eave height" value={`${Math.round(data.eave_height_m * 100) / 100}m`} />
          <DimPill label="Roof" value={`${data.roof_type}${data.roof_type !== 'flat' ? ' ' + data.roof_pitch_degrees + '°' : ''}`} />
          <DimPill label="Storeys" value={String(data.num_stories)} />
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
        <div className="flex gap-2">
          <ToggleBtn label="House" active={showHouse} onClick={() => setShowHouse(v => !v)} />
          <ToggleBtn label="Scaffold" active={showScaffold} onClick={() => setShowScaffold(v => !v)} />
          <ToggleBtn label="Kit view" active={kitView} onClick={() => setKitView(v => !v)} />
          {!readOnly && <ToggleBtn label="Scale" active={showScale} onClick={() => setShowScale(v => !v)} />}
          <button
            onClick={() => setShowGearList(true)}
            className="text-sm px-4 py-2 rounded-lg font-medium transition-colors bg-black/50 text-white hover:bg-black/70 shadow"
          >
            Gear List
          </button>
          {!readOnly && (
            <>
              <button
                onClick={() => router.push('/map')}
                className="text-sm px-4 py-2 rounded-lg font-medium transition-colors bg-black/50 text-white hover:bg-black/70 shadow"
              >
                Map
              </button>
              <button
                disabled={capturing}
                onClick={async () => {
                  setCapturing(true);
                  sessionStorage.setItem('quoteMode', 'building');
                  await captureQuoteRenders(canvasRef.current, setKitView, kitView);
                  router.push('/quote');
                }}
                className="text-sm px-4 py-2 rounded-lg font-medium transition-colors bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white shadow"
              >
                {capturing ? 'Preparing…' : 'Create Quote'}
              </button>
            </>
          )}
        </div>

        {showScale && !readOnly && (
          <div className="bg-black/60 backdrop-blur rounded-lg px-4 py-3 w-72 text-xs space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-white font-semibold text-sm">Scale model</p>
              <button
                onClick={() => { setScalePct(100); setScaleHeights(false); }}
                className="text-gray-400 hover:text-white transition-colors"
              >
                Reset
              </button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range" min={50} max={150} step={1}
                value={Math.min(150, Math.max(50, scalePct))}
                onChange={e => setScalePct(Number(e.target.value))}
                className="flex-1 accent-orange-500"
              />
              <input
                type="number" min={25} max={400} step={1}
                value={Math.round(scalePct * 10) / 10}
                onChange={e => { const n = Number(e.target.value); if (n > 0) setScalePct(n); }}
                className="w-14 bg-black/40 text-white rounded px-1.5 py-1 text-right outline-none focus:ring-1 focus:ring-orange-400"
              />
              <span className="text-gray-400">%</span>
            </div>
            <div>
              <p className="text-gray-400 mb-1.5">Match a known measurement — everything scales to suit</p>
              <div className="grid grid-cols-2 gap-2">
                <CalibrateField label="Width" value={Number(w)} onCommit={m => baseW > 0 && setScalePct(Math.round((m / baseW) * 1000) / 10)} />
                <CalibrateField label="Length" value={Number(l)} onCommit={m => baseL > 0 && setScalePct(Math.round((m / baseL) * 1000) / 10)} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-gray-300 cursor-pointer select-none">
              <input
                type="checkbox" checked={scaleHeights}
                onChange={e => setScaleHeights(e.target.checked)}
                className="accent-orange-500 w-3.5 h-3.5"
              />
              Also scale heights
            </label>
            <p className="text-gray-500">Scaffold, gear list &amp; quote update automatically.</p>
          </div>
        )}
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
        gl={{ antialias: true, toneMappingExposure: 1.05, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}>
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

// Numeric field that shows the current (scaled) dimension and commits the
// builder's real-world measurement on blur/Enter.
function CalibrateField({ label, value, onCommit }: {
  label: string;
  value: number;
  onCommit: (metres: number) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const commit = () => {
    if (raw !== null) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) onCommit(n);
      setRaw(null);
    }
  };
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-gray-500">{label}</span>
      <span className="flex items-center gap-1">
        <input
          type="number" min={1} step={0.1}
          value={raw ?? value.toFixed(1)}
          onChange={e => setRaw(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="w-full bg-black/40 text-white rounded px-1.5 py-1 outline-none focus:ring-1 focus:ring-orange-400"
        />
        <span className="text-gray-500">m</span>
      </span>
    </label>
  );
}
