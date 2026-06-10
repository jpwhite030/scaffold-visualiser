'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BuildingData, DEFAULT_BUILDING, footprintBounds } from '@/lib/buildingTypes';

export default function ReviewPage() {
  const router = useRouter();
  const [data, setData] = useState<BuildingData>(DEFAULT_BUILDING);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [worldW, setWorldW] = useState(16);
  const [worldD, setWorldD] = useState(11);
  // The AI's original outline, captured on load so we can log (original ->
  // corrected) as training data when the user generates.
  const originalFootprintRef = useRef<[number, number][] | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('buildingData');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.footprint || !Array.isArray(parsed.footprint) || parsed.footprint.length < 4) {
        const hw = (parsed.overall_width_m ?? 16) / 2;
        const hd = (parsed.overall_depth_m ?? 11) / 2;
        parsed.footprint = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
      }
      originalFootprintRef.current = parsed.footprint.map((p: [number, number]) => [...p] as [number, number]);
      setData(parsed);
      const b = footprintBounds(parsed.footprint);
      setWorldW(Math.max(1, Math.round((b.maxX - b.minX) * 10) / 10));
      setWorldD(Math.max(1, Math.round((b.maxZ - b.minZ) * 10) / 10));
    }
    const img = sessionStorage.getItem('imageDataUrl');
    if (img) setImageDataUrl(img);
    setLoaded(true);
  }, []);

  const set = (field: keyof BuildingData, value: string) => {
    setData(prev => {
      const isStringField = field === 'roof_type' || field === 'access_type' || field === 'protection_type';
      const updated: BuildingData = {
        ...prev,
        [field]: isStringField ? value : Number(value),
      };
      // When changing num_stories, scale eave_height_m so the 3D model and scaffold update immediately
      if (field === 'num_stories') {
        const stories = Number(value);
        const newEave = prev.wall_height_m * stories;
        updated.eave_height_m = newEave;
        if (updated.face_eave_heights) {
          updated.face_eave_heights = updated.face_eave_heights.map(() => newEave);
        }
      }
      // When changing wall_height_m, keep eave proportional (same storey ratio)
      if (field === 'wall_height_m') {
        const newWall = Number(value);
        const stories = prev.num_stories ?? 1;
        const newEave = newWall * stories;
        updated.eave_height_m = newEave;
        if (updated.face_eave_heights) {
          updated.face_eave_heights = updated.face_eave_heights.map(() => newEave);
        }
      }
      return updated;
    });
  };

  const setFaceHeight = (i: number, value: string) => {
    setData(prev => {
      const heights = [...(prev.face_eave_heights ?? Array(prev.footprint.length).fill(prev.eave_height_m))];
      heights[i] = Number(value);
      return { ...prev, face_eave_heights: heights };
    });
  };

  const toggleGableFace = (i: number) => {
    setData(prev => {
      const gables = [...(prev.gable_faces ?? Array(prev.footprint.length).fill(false))];
      gables[i] = !gables[i];
      return { ...prev, gable_faces: gables };
    });
  };

  // Rescale all footprint coordinates when the user corrects the overall building dimensions
  const rescaleFootprint = (newW: number, newD: number) => {
    setData(prev => {
      const b = footprintBounds(prev.footprint);
      const curW = b.maxX - b.minX;
      const curD = b.maxZ - b.minZ;
      if (curW < 0.01 || curD < 0.01) return prev;
      const cx = (b.minX + b.maxX) / 2;
      const cz = (b.minZ + b.maxZ) / 2;
      return {
        ...prev,
        footprint: prev.footprint.map(([x, z]) => [
          cx + (x - cx) * (newW / curW),
          cz + (z - cz) * (newD / curD),
        ] as [number, number]),
      };
    });
  };

  const handleGenerate = () => {
    // Fire-and-forget: log the AI's original outline vs the user's corrected one
    // as training data. Never block or fail the generate flow on this.
    try {
      const original = originalFootprintRef.current;
      const corrected = data.footprint;
      const wasEdited = !original || JSON.stringify(original) !== JSON.stringify(corrected);
      fetch('/api/log-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl, original, corrected, worldW, worldD, wasEdited }),
      }).catch(() => {});
    } catch { /* ignore */ }

    sessionStorage.setItem('buildingData', JSON.stringify(data));
    router.push('/viewer');
  };

  if (!loaded) return null;

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => router.push('/')} className="text-gray-400 hover:text-gray-700 transition-colors" aria-label="Back">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Review Dimensions</h1>
            <p className="text-gray-500 text-sm">Correct the footprint, then adjust heights before generating</p>
          </div>
        </div>

        {/* Footprint editor — plan image + draggable overlay */}
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Footprint Editor</p>
          <p className="text-xs text-gray-400 mb-3">
            1. Enter the actual building width &amp; depth from the plan below. 2. Drag orange dots to corners. 3. Click <span className="font-semibold text-orange-400">+</span> on any edge to add a corner. 4. Tap <span className="font-semibold text-red-500">Delete points</span> then tap any dot to remove it.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field
              label="Building Width" unit="m" value={worldW}
              onChange={v => { const n = Math.max(1, Number(v)); setWorldW(n); rescaleFootprint(n, worldD); }}
              min={5} max={80} step={0.5}
            />
            <Field
              label="Building Depth" unit="m" value={worldD}
              onChange={v => { const n = Math.max(1, Number(v)); setWorldD(n); rescaleFootprint(worldW, n); }}
              min={5} max={60} step={0.5}
            />
          </div>
          <FootprintEditor
            footprint={data.footprint}
            imageDataUrl={imageDataUrl}
            worldWidth={worldW}
            worldDepth={worldD}
            onChange={fp => setData(prev => {
              const n = fp.length;
              const existing = prev.face_eave_heights ?? [];
              const synced = n > existing.length
                ? [...existing, ...Array(n - existing.length).fill(prev.eave_height_m)]
                : existing.slice(0, n);
              const existingG = prev.gable_faces ?? [];
              const syncedG = n > existingG.length
                ? [...existingG, ...Array(n - existingG.length).fill(false)]
                : existingG.slice(0, n);
              return { ...prev, footprint: fp, face_eave_heights: synced, gable_faces: syncedG };
            })}
          />
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Heights</h2>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Wall Height" unit="m" value={data.wall_height_m}
                onChange={v => set('wall_height_m', v)} min={2} max={6} step={0.05} />
              <Field label="Max Eave Height" unit="m" value={data.eave_height_m}
                onChange={v => set('eave_height_m', v)} min={2} max={15} step={0.05} />
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Number of Storeys</label>
                <select value={data.num_stories} onChange={e => set('num_stories', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none">
                  <option value={1}>1 storey</option>
                  <option value={2}>2 storeys</option>
                </select>
              </div>
            </div>
          </section>

          {data.face_eave_heights && data.face_eave_heights.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Scaffold Height Per Face
              </h2>
              <p className="text-xs text-gray-400 mb-3">
                Read from elevation drawings — ground to gutter on each side. Mark gable ends so the scaffold steps up toward the ridge.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {data.face_eave_heights.map((h, i) => {
                  const isGable = (data.gable_faces ?? [])[i] ?? false;
                  return (
                    <div key={i} className="flex flex-col gap-1">
                      <Field
                        label={faceLabel(i, data.face_eave_heights!.length)}
                        unit="m"
                        value={h}
                        onChange={v => setFaceHeight(i, v)}
                        min={1.5}
                        max={15}
                        step={0.1}
                      />
                      <button
                        type="button"
                        onClick={() => toggleGableFace(i)}
                        className={`text-xs px-3 py-1 rounded-full font-medium transition-colors border ${
                          isGable
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-white text-gray-500 border-gray-300 hover:border-orange-400'
                        }`}
                      >
                        {isGable ? 'Gable end ✓' : 'Eave side'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Roof</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Roof Type</label>
                <select value={data.roof_type} onChange={e => set('roof_type', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none">
                  <option value="gable">Gable</option>
                  <option value="hip">Hip</option>
                  <option value="flat">Flat</option>
                </select>
              </div>
              {data.roof_type !== 'flat' && (
                <Field label="Roof Pitch" unit="°" value={data.roof_pitch_degrees}
                  onChange={v => set('roof_pitch_degrees', v)} min={5} max={60} step={1} />
              )}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Access</h2>
            <label className="block text-sm font-medium text-gray-700 mb-1">Access Type</label>
            <select value={data.access_type ?? 'stair'} onChange={e => set('access_type', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none">
              <option value="stair">Stair access</option>
              <option value="ladder">Ladder access</option>
            </select>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">Top Protection</h2>
            <p className="text-xs text-gray-400 mb-3">
              Roof catch: top deck 1&nbsp;m below roof, 4 handrails. Edge protection: 2&nbsp;m below roof, 2 handrails.
            </p>
            <select value={data.protection_type ?? 'roof_catch'} onChange={e => set('protection_type', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none">
              <option value="roof_catch">Roof catch (1 m down, 4 rails)</option>
              <option value="edge_protection">Edge protection (2 m down, 2 rails)</option>
            </select>
          </section>
        </div>

        <button onClick={handleGenerate}
          className="mt-6 w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-4 rounded-2xl transition-colors text-lg">
          Generate 3D Model →
        </button>
      </div>
    </main>
  );
}

function faceLabel(i: number, total: number): string {
  if (total === 4) return ['Front face', 'Right face', 'Rear face', 'Left face'][i];
  if (total === 6) return ['Front-left', 'Front-right', 'Right', 'Rear', 'Left-top', 'Left-bottom'][i] ?? `Face ${i + 1}`;
  return `Face ${i + 1}`;
}

// SVG viewBox dimensions (virtual pixels — scale-independent)
const VW = 1000;
const PAD = 0.06; // 6% padding each side so dots aren't clipped at edges

function FootprintEditor({ footprint, imageDataUrl, worldWidth, worldDepth, onChange }: {
  footprint: [number, number][];
  imageDataUrl: string | null;
  worldWidth: number;
  worldDepth: number;
  onChange: (fp: [number, number][]) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [deleteMode, setDeleteMode] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  // Refs stay fresh across renders — essential because pointer events can fire
  // between React renders (before the new closure is in place).
  const footprintRef = useRef(footprint);
  const onChangeRef  = useRef(onChange);
  const safeWRef     = useRef(1);
  const safeDRef     = useRef(1);
  const VHRef        = useRef(1);
  // dragIdxRef is updated synchronously in onPointerDown/Up so that onPointerMove
  // sees the correct value immediately, before React re-renders from setDragIdx.
  const dragIdxRef   = useRef<number | null>(null);
  footprintRef.current = footprint;
  onChangeRef.current  = onChange;

  const safeW  = worldWidth > 0 ? worldWidth : 16;
  const safeD  = worldDepth > 0 ? worldDepth : 11;
  const aspect = Math.min(Math.max(safeD / safeW, 0.35), 1.8);
  const VH     = Math.round(VW * aspect);
  safeWRef.current = safeW;
  safeDRef.current = safeD;
  VHRef.current    = VH;

  const toSvg = (x: number, z: number): [number, number] => [
    ((x / safeW + 0.5) * (1 - 2 * PAD) + PAD) * VW,
    ((z / safeD + 0.5) * (1 - 2 * PAD) + PAD) * VH,
  ];

  // Drag is tracked with window-level pointer listeners (attached once) rather
  // than per-dot pointer capture, which is fragile across React re-renders and
  // varies by device/trackpad/touchscreen. The handlers read refs only, so they
  // never go stale. This is what stops the "rubberband / snap back" behaviour.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const idx = dragIdxRef.current;
      if (idx === null) return;
      const svg = svgRef.current;
      if (!svg) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const VHc = VHRef.current;
      // Clamp the dot to stay fully on-screen (R = dragging dot radius) so it
      // can't be dragged past an edge, clipped by the container, and lost.
      const R = 24;
      const sx = Math.max(R, Math.min(VW  - R, ((e.clientX - rect.left) / rect.width)  * VW));
      const sy = Math.max(R, Math.min(VHc - R, ((e.clientY - rect.top)  / rect.height) * VHc));
      const wx = ((sx / VW   - PAD) / (1 - 2 * PAD) - 0.5) * safeWRef.current;
      const wz = ((sy / VHc  - PAD) / (1 - 2 * PAD) - 0.5) * safeDRef.current;
      // Always follow the cursor — no overlap guard. The old proximity check
      // silently dropped moves near other points, which made dots stick / snap
      // back ("rubberband"). Overlaps are harmless and easy to drag apart.
      onChangeRef.current(
        footprintRef.current.map((pt, i) => (i === idx ? [wx, wz] : pt) as [number, number])
      );
    };
    const onUp = () => {
      if (dragIdxRef.current !== null) {
        dragIdxRef.current = null;
        setDragIdx(null);
      }
    };
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const pts      = footprint.map(([x, z]) => toSvg(x, z).join(',')).join(' ');
  const showImage = imageDataUrl && !imageDataUrl.startsWith('data:application/pdf');

  return (
    <div
      className="relative w-full overflow-hidden rounded border border-gray-300"
      style={{ paddingTop: `${aspect * 100}%` }}
    >
      <button
        type="button"
        onClick={() => setDeleteMode(d => !d)}
        className={`absolute top-2 right-2 z-10 text-xs font-semibold px-2.5 py-1 rounded-md border shadow-sm transition-colors ${
          deleteMode ? 'bg-red-600 text-white border-red-600' : 'bg-white/90 text-gray-700 border-gray-300 hover:border-red-400'
        }`}
      >
        {deleteMode ? 'Done deleting' : 'Delete points'}
      </button>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageDataUrl}
          alt="plan"
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ objectFit: 'fill' }}
        />
      ) : (
        <div className="absolute inset-0 bg-gray-50 flex items-center justify-center">
          <p className="text-gray-300 text-sm select-none">
            {imageDataUrl ? 'PDF — no preview (drag dots to trace)' : 'No plan image'}
          </p>
        </div>
      )}

      <svg
        ref={svgRef}
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="none"
        style={{ cursor: dragIdx !== null ? 'grabbing' : 'crosshair', touchAction: 'none' }}
      >
        <polygon
          points={pts}
          fill="rgba(253,232,204,0.35)"
          stroke="#f97316"
          strokeWidth="6"
          strokeLinejoin="round"
        />

        {/* + buttons at edge midpoints — click to insert a new corner (hidden while deleting) */}
        {!deleteMode && footprint.map(([x, z], i) => {
          const [x2, z2] = footprint[(i + 1) % footprint.length];
          const mx = (x + x2) / 2, mz = (z + z2) / 2;
          const [sx, sy] = toSvg(mx, mz);
          return (
            <g
              key={`add-${i}`}
              style={{ cursor: 'copy' }}
              onClick={() => {
                const newFp = [...footprint];
                newFp.splice(i + 1, 0, [mx, mz]);
                onChange(newFp);
              }}
            >
              <circle cx={sx} cy={sy} r={13} fill="rgba(251,146,60,0.75)" stroke="white" strokeWidth="3" />
              <text x={sx} y={sy} textAnchor="middle" dominantBaseline="central"
                fontSize="20" fontWeight="bold" fill="white" style={{ pointerEvents: 'none', userSelect: 'none' }}>
                +
              </text>
            </g>
          );
        })}

        {/* Corner dots — drag to move, or tap to delete in delete mode */}
        {footprint.map(([x, z], i) => {
          const [sx, sy] = toSvg(x, z);
          const canDelete = footprint.length > 4;
          return (
            <circle
              key={i}
              cx={sx} cy={sy}
              r={dragIdx === i ? 24 : 18}
              fill={deleteMode ? (canDelete ? '#dc2626' : '#fca5a5') : dragIdx === i ? '#ea580c' : '#f97316'}
              stroke="white"
              strokeWidth="5"
              style={{ cursor: deleteMode ? 'pointer' : (dragIdx !== null ? 'grabbing' : 'grab'), touchAction: 'none' }}
              onPointerDown={e => {
                e.preventDefault();
                e.stopPropagation();
                if (deleteMode) {
                  // Keep at least 4 points (a valid rectangle minimum).
                  if (footprintRef.current.length > 4) {
                    onChangeRef.current(footprintRef.current.filter((_, fi) => fi !== i));
                  }
                  return;
                }
                dragIdxRef.current = i;
                setDragIdx(i);
              }}
            />
          );
        })}
      </svg>
    </div>
  );
}

function Field({ label, unit, value, onChange, min, max, step }: {
  label: string; unit: string; value: number;
  onChange: (v: string) => void; min: number; max: number; step: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label} <span className="text-gray-400 font-normal">({unit})</span>
      </label>
      <input type="number" value={value} onChange={e => onChange(e.target.value)}
        min={min} max={max} step={step}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none" />
    </div>
  );
}
