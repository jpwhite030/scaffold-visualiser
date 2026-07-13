'use client';

import { useEffect, useRef, useState } from 'react';

// SVG viewBox dimensions (virtual pixels — scale-independent)
const VW = 1000;
const PAD = 0.06; // 6% padding each side so dots aren't clipped at edges

// Inert polygons drawn under the active one (other buildings, boundary,
// driveways on the site editor). They only respond to click-to-select.
export interface BackgroundPolygon {
  id: string;
  points: [number, number][];
  stroke: string;
  fill: string;
  dashed?: boolean;
  label?: string;
  onSelect?: (id: string) => void;
}

export function FootprintEditor({ footprint, imageDataUrl, worldWidth, worldDepth, onChange, backgroundPolygons, minPoints = 4 }: {
  footprint: [number, number][];
  imageDataUrl: string | null;
  worldWidth: number;
  worldDepth: number;
  onChange: (fp: [number, number][]) => void;
  backgroundPolygons?: BackgroundPolygon[];
  minPoints?: number;
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
    <div>
      <div className="flex items-center justify-end mb-2">
        <button
          type="button"
          onClick={() => setDeleteMode(d => !d)}
          className={`text-xs font-semibold px-3 py-1.5 rounded-md border shadow-sm transition-colors ${
            deleteMode ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-700 border-gray-300 hover:border-red-400'
          }`}
        >
          {deleteMode ? 'Done deleting' : 'Delete points'}
        </button>
      </div>
      <div
        className="relative w-full overflow-hidden rounded border border-gray-300"
        style={{ paddingTop: `${aspect * 100}%` }}
      >
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
        {/* Inert context polygons — click to select, no editing handles */}
        {backgroundPolygons?.map(bp => {
          const bpts = bp.points.map(([x, z]) => toSvg(x, z).join(',')).join(' ');
          const cxw = bp.points.reduce((s, p) => s + p[0], 0) / bp.points.length;
          const czw = bp.points.reduce((s, p) => s + p[1], 0) / bp.points.length;
          const [lx, ly] = toSvg(cxw, czw);
          return (
            <g
              key={bp.id}
              style={{ cursor: bp.onSelect ? 'pointer' : 'default' }}
              onClick={() => bp.onSelect?.(bp.id)}
            >
              <polygon
                points={bpts}
                fill={bp.fill}
                stroke={bp.stroke}
                strokeWidth="4"
                strokeLinejoin="round"
                strokeDasharray={bp.dashed ? '14 10' : undefined}
              />
              {bp.label && (
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
                  fontSize="26" fontWeight="600" fill={bp.stroke}
                  style={{ userSelect: 'none', pointerEvents: 'none' }}>
                  {bp.label}
                </text>
              )}
            </g>
          );
        })}

        {/* pointer-events none so taps fall through to the selectable background
            polygons underneath (the editing handles above have their own events) */}
        <polygon
          points={pts}
          fill="rgba(253,232,204,0.35)"
          stroke="#f97316"
          strokeWidth="6"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none' }}
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
          const canDelete = footprint.length > minPoints;
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
                  // Keep at least minPoints corners (a valid polygon minimum).
                  if (footprintRef.current.length > minPoints) {
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
    </div>
  );
}

export function faceLabel(i: number, total: number): string {
  if (total === 4) return ['Front face', 'Right face', 'Rear face', 'Left face'][i];
  if (total === 6) return ['Front-left', 'Front-right', 'Right', 'Rear', 'Left-top', 'Left-bottom'][i] ?? `Face ${i + 1}`;
  return `Face ${i + 1}`;
}

export function Field({ label, unit, value, onChange, min, max, step }: {
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
