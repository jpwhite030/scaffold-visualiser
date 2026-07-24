'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BuildingData, footprintBounds } from '@/lib/buildingTypes';
import {
  SiteData, SiteBuilding, SiteBuildingKind, SurfaceKind,
  DEFAULT_SITE, BUILDING_KIND_LABELS, SURFACE_KIND_LABELS,
  newSiteBuilding, scaleSite, syncFaceArrays, siteUid,
} from '@/lib/siteTypes';
import { BackgroundPolygon, Field, FootprintEditor, faceLabel } from '@/components/FootprintEditor';
import ScaleControl from '@/components/ScaleControl';

type Selection =
  | { type: 'boundary' }
  | { type: 'building'; id: string }
  | { type: 'surface'; id: string };

const BOUNDARY_STROKE = '#16a34a';
const BUILDING_STROKE = '#3b82f6';
const SURFACE_STROKE  = '#6b7280';

export default function SiteReviewPage() {
  const router = useRouter();
  const [site, setSite] = useState<SiteData>(DEFAULT_SITE);
  const [selected, setSelected] = useState<Selection>({ type: 'boundary' });
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // The AI's original site, captured on load so we can log (original ->
  // corrected) as training data when the user generates.
  const originalSiteRef = useRef<SiteData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('siteData');
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as SiteData;
        if (Array.isArray(parsed.boundary) && parsed.boundary.length >= 3) {
          originalSiteRef.current = JSON.parse(raw);
          setSite(parsed);
        }
      } catch { /* fall through to DEFAULT_SITE */ }
    }
    const img = sessionStorage.getItem('imageDataUrl');
    if (img) setImageDataUrl(img);
    setLoaded(true);
  }, []);

  const selectedBuilding = selected.type === 'building'
    ? site.buildings.find(b => b.id === selected.id) ?? null
    : null;

  // ── polygon plumbing ────────────────────────────────────────────────────────

  const activeFootprint: [number, number][] =
    selected.type === 'boundary' ? site.boundary
    : selected.type === 'building' ? (selectedBuilding?.data.footprint ?? site.boundary)
    : site.surfaces.find(s => s.id === selected.id)?.polygon ?? site.boundary;

  const onActiveChange = (fp: [number, number][]) => {
    setSite(prev => {
      if (selected.type === 'boundary') {
        const b = footprintBounds(fp);
        return {
          ...prev,
          boundary: fp,
          site_width_m: Math.max(1, Math.round((b.maxX - b.minX) * 10) / 10),
          site_depth_m: Math.max(1, Math.round((b.maxZ - b.minZ) * 10) / 10),
        };
      }
      if (selected.type === 'building') {
        return {
          ...prev,
          buildings: prev.buildings.map(b =>
            b.id === selected.id ? { ...b, data: syncFaceArrays(b.data, fp) } : b
          ),
        };
      }
      return {
        ...prev,
        surfaces: prev.surfaces.map(s =>
          s.id === selected.id ? { ...s, polygon: fp } : s
        ),
      };
    });
  };

  const backgroundPolygons: BackgroundPolygon[] = [];
  if (selected.type !== 'boundary') {
    backgroundPolygons.push({
      id: 'boundary',
      points: site.boundary,
      stroke: BOUNDARY_STROKE,
      fill: 'rgba(22,163,74,0.05)',
      dashed: true,
      onSelect: () => setSelected({ type: 'boundary' }),
    });
  }
  for (const s of site.surfaces) {
    if (selected.type === 'surface' && selected.id === s.id) continue;
    backgroundPolygons.push({
      id: s.id,
      points: s.polygon,
      stroke: SURFACE_STROKE,
      fill: 'rgba(107,114,128,0.25)',
      label: SURFACE_KIND_LABELS[s.kind],
      onSelect: id => setSelected({ type: 'surface', id }),
    });
  }
  for (const b of site.buildings) {
    if (selected.type === 'building' && selected.id === b.id) continue;
    backgroundPolygons.push({
      id: b.id,
      points: b.data.footprint,
      stroke: BUILDING_STROKE,
      fill: 'rgba(59,130,246,0.18)',
      label: b.label,
      onSelect: id => setSelected({ type: 'building', id }),
    });
  }

  // ── mutations ───────────────────────────────────────────────────────────────

  const updateBuilding = (id: string, patch: (b: SiteBuilding) => SiteBuilding) =>
    setSite(prev => ({
      ...prev,
      buildings: prev.buildings.map(b => (b.id === id ? patch(b) : b)),
    }));

  const setBuildingField = (id: string, field: keyof BuildingData, value: string) =>
    updateBuilding(id, b => {
      const isStringField = field === 'roof_type' || field === 'access_type' || field === 'protection_type';
      const updated: BuildingData = {
        ...b.data,
        [field]: isStringField ? value : Number(value),
      };
      // Storeys / wall height drive the eave height, same as the building review page
      if (field === 'num_stories') {
        const newEave = b.data.wall_height_m * Number(value);
        updated.eave_height_m = newEave;
        if (updated.face_eave_heights) {
          updated.face_eave_heights = updated.face_eave_heights.map(() => newEave);
        }
      }
      if (field === 'wall_height_m') {
        const newEave = Number(value) * (b.data.num_stories ?? 1);
        updated.eave_height_m = newEave;
        if (updated.face_eave_heights) {
          updated.face_eave_heights = updated.face_eave_heights.map(() => newEave);
        }
      }
      return { ...b, data: updated };
    });

  const setBuildingFaceHeight = (id: string, i: number, value: string) =>
    updateBuilding(id, b => {
      const heights = [...(b.data.face_eave_heights ?? Array(b.data.footprint.length).fill(b.data.eave_height_m))];
      heights[i] = Number(value);
      return { ...b, data: { ...b.data, face_eave_heights: heights } };
    });

  const toggleBuildingGable = (id: string, i: number) =>
    updateBuilding(id, b => {
      const gables = [...(b.data.gable_faces ?? Array(b.data.footprint.length).fill(false))];
      gables[i] = !gables[i];
      return { ...b, data: { ...b.data, gable_faces: gables } };
    });

  const toggleBuildingScaffoldFace = (id: string, i: number) =>
    updateBuilding(id, b => {
      const faces = [...(b.data.scaffold_faces ?? Array(b.data.footprint.length).fill(true))];
      faces[i] = !faces[i];
      return { ...b, data: { ...b.data, scaffold_faces: faces } };
    });

  // Rescale one building's footprint about its own centre
  const rescaleBuilding = (id: string, newW: number, newD: number) =>
    updateBuilding(id, b => {
      const bb = footprintBounds(b.data.footprint);
      const curW = bb.maxX - bb.minX;
      const curD = bb.maxZ - bb.minZ;
      if (curW < 0.01 || curD < 0.01) return b;
      const cx = (bb.minX + bb.maxX) / 2;
      const cz = (bb.minZ + bb.maxZ) / 2;
      return {
        ...b,
        data: {
          ...b.data,
          footprint: b.data.footprint.map(([x, z]) => [
            cx + (x - cx) * (newW / curW),
            cz + (z - cz) * (newD / curD),
          ] as [number, number]),
        },
      };
    });

  const addBuilding = (kind: SiteBuildingKind) => {
    const nb = newSiteBuilding(kind);
    setSite(prev => ({ ...prev, buildings: [...prev.buildings, nb] }));
    setSelected({ type: 'building', id: nb.id });
  };

  const addSurface = (kind: SurfaceKind) => {
    const ns = {
      id: siteUid(),
      kind,
      polygon: [[-1.5, -5], [1.5, -5], [1.5, 5], [-1.5, 5]] as [number, number][],
    };
    setSite(prev => ({ ...prev, surfaces: [...prev.surfaces, ns] }));
    setSelected({ type: 'surface', id: ns.id });
  };

  const deleteSelected = () => {
    if (selected.type === 'boundary') return;
    setSite(prev =>
      selected.type === 'building'
        ? { ...prev, buildings: prev.buildings.filter(b => b.id !== selected.id) }
        : { ...prev, surfaces: prev.surfaces.filter(s => s.id !== selected.id) }
    );
    setSelected({ type: 'boundary' });
  };

  const handleGenerate = () => {
    // Fire-and-forget: log the AI's original site vs the user's corrected one
    // as training data. Never block or fail the generate flow on this.
    try {
      const original = originalSiteRef.current;
      const wasEdited = !original || JSON.stringify(original) !== JSON.stringify(site);
      fetch('/api/log-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'site', imageDataUrl, originalSite: original, correctedSite: site, wasEdited }),
      }).catch(() => {});
    } catch { /* ignore */ }

    sessionStorage.setItem('siteData', JSON.stringify(site));
    router.push('/site-viewer');
  };

  if (!loaded) return null;

  const selLabel =
    selected.type === 'boundary' ? 'Boundary'
    : selected.type === 'building' ? (selectedBuilding?.label ?? 'Building')
    : SURFACE_KIND_LABELS[site.surfaces.find(s => s.id === selected.id)?.kind ?? 'driveway'];

  const selBounds = selectedBuilding ? footprintBounds(selectedBuilding.data.footprint) : null;

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
            <h1 className="text-2xl font-bold text-gray-900">Review Site</h1>
            <p className="text-gray-500 text-sm">Correct the boundary, buildings and driveways, then generate the 3D site</p>
          </div>
        </div>

        {/* Site editor — plan image + selectable polygons */}
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Site Editor</p>
          <p className="text-xs text-gray-400 mb-3">
            Tap a polygon (or a pill below) to select it, then drag the orange dots. Click <span className="font-semibold text-orange-400">+</span> on an edge to add a corner.
            <span className="text-green-600 font-medium"> Dashed green</span> = boundary, <span className="text-blue-500 font-medium">blue</span> = buildings, <span className="text-gray-500 font-medium">gray</span> = driveways/paths.
          </p>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <Field
              label="Site Width" unit="m" value={site.site_width_m}
              onChange={v => { const n = Math.max(1, Number(v)); setSite(prev => scaleSite(prev, n, prev.site_depth_m)); }}
              min={5} max={150} step={0.5}
            />
            <Field
              label="Site Depth" unit="m" value={site.site_depth_m}
              onChange={v => { const n = Math.max(1, Number(v)); setSite(prev => scaleSite(prev, prev.site_width_m, n)); }}
              min={5} max={150} step={0.5}
            />
          </div>

          <ScaleControl
            heading="Plan scale"
            blurb="The trace loads as if the site plan is 1:100. Printed at a different scale? Pick it and the boundary, buildings, driveways and trees all resize together."
            storageKey="planScaleSite"
            onApply={f => {
              setSite(prev => {
                const b = footprintBounds(prev.boundary);
                return scaleSite(
                  prev,
                  Math.max(1, Math.round((b.maxX - b.minX) * f * 10) / 10),
                  Math.max(1, Math.round((b.maxZ - b.minZ) * f * 10) / 10),
                );
              });
            }}
          />

          {/* Selection pills */}
          <div className="flex flex-wrap gap-2 mb-3">
            <SelPill
              label="Boundary"
              color={BOUNDARY_STROKE}
              active={selected.type === 'boundary'}
              onClick={() => setSelected({ type: 'boundary' })}
            />
            {site.buildings.map(b => (
              <SelPill
                key={b.id}
                label={b.label}
                color={BUILDING_STROKE}
                active={selected.type === 'building' && selected.id === b.id}
                onClick={() => setSelected({ type: 'building', id: b.id })}
              />
            ))}
            {site.surfaces.map(s => (
              <SelPill
                key={s.id}
                label={SURFACE_KIND_LABELS[s.kind]}
                color={SURFACE_STROKE}
                active={selected.type === 'surface' && selected.id === s.id}
                onClick={() => setSelected({ type: 'surface', id: s.id })}
              />
            ))}
          </div>

          <FootprintEditor
            footprint={activeFootprint}
            imageDataUrl={imageDataUrl}
            worldWidth={site.site_width_m}
            worldDepth={site.site_depth_m}
            onChange={onActiveChange}
            backgroundPolygons={backgroundPolygons}
            minPoints={selected.type === 'boundary' ? 3 : 4}
          />

          {/* Add / delete */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {(Object.keys(BUILDING_KIND_LABELS) as SiteBuildingKind[]).map(kind => (
              <button key={kind} type="button" onClick={() => addBuilding(kind)}
                className="text-xs font-semibold px-3 py-1.5 rounded-md border border-blue-300 text-blue-600 bg-white hover:bg-blue-50 transition-colors">
                + {BUILDING_KIND_LABELS[kind]}
              </button>
            ))}
            <button type="button" onClick={() => addSurface('driveway')}
              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 bg-white hover:bg-gray-100 transition-colors">
              + Driveway
            </button>
            <button type="button" onClick={() => addSurface('path')}
              className="text-xs font-semibold px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 bg-white hover:bg-gray-100 transition-colors">
              + Path
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={selected.type === 'boundary'}
              className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-md border border-red-200 text-red-500 bg-white hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Delete {selLabel}
            </button>
          </div>
        </div>

        {/* Per-building settings */}
        {selectedBuilding && selBounds ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
            <section>
              <div className="flex items-center justify-between mb-4 gap-3">
                <input
                  type="text"
                  value={selectedBuilding.label}
                  onChange={e => updateBuilding(selectedBuilding.id, b => ({ ...b, label: e.target.value }))}
                  className="text-lg font-bold text-gray-900 bg-transparent outline-none hover:bg-gray-50 focus:bg-gray-50 rounded px-1 -mx-1 transition-colors flex-1 min-w-0"
                />
                <button
                  type="button"
                  onClick={() => updateBuilding(selectedBuilding.id, b => ({ ...b, scaffold_enabled: !b.scaffold_enabled }))}
                  className={`text-xs px-3 py-1.5 rounded-full font-semibold transition-colors border whitespace-nowrap ${
                    selectedBuilding.scaffold_enabled
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white text-gray-500 border-gray-300 hover:border-orange-400'
                  }`}
                >
                  {selectedBuilding.scaffold_enabled ? 'Scaffold ✓' : 'No scaffold'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Width" unit="m" value={Math.round((selBounds.maxX - selBounds.minX) * 10) / 10}
                  onChange={v => rescaleBuilding(selectedBuilding.id, Math.max(1, Number(v)), selBounds.maxZ - selBounds.minZ)}
                  min={2} max={80} step={0.5} />
                <Field label="Depth" unit="m" value={Math.round((selBounds.maxZ - selBounds.minZ) * 10) / 10}
                  onChange={v => rescaleBuilding(selectedBuilding.id, selBounds.maxX - selBounds.minX, Math.max(1, Number(v)))}
                  min={2} max={60} step={0.5} />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Heights</h2>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Wall Height" unit="m" value={selectedBuilding.data.wall_height_m}
                  onChange={v => setBuildingField(selectedBuilding.id, 'wall_height_m', v)} min={2} max={6} step={0.05} />
                <Field label="Max Eave Height" unit="m" value={selectedBuilding.data.eave_height_m}
                  onChange={v => setBuildingField(selectedBuilding.id, 'eave_height_m', v)} min={2} max={15} step={0.05} />
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Number of Storeys</label>
                  <select value={selectedBuilding.data.num_stories}
                    onChange={e => setBuildingField(selectedBuilding.id, 'num_stories', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none">
                    <option value={1}>1 storey</option>
                    <option value={2}>2 storeys</option>
                  </select>
                </div>
              </div>
            </section>

            {selectedBuilding.scaffold_enabled && (
              <section>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Scaffold Coverage
                </h2>
                <p className="text-xs text-gray-400 mb-3">
                  Partial job? Untick the sides that don&apos;t need scaffold.
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedBuilding.data.footprint.map((_, i) => {
                    const on = (selectedBuilding.data.scaffold_faces ?? [])[i] ?? true;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleBuildingScaffoldFace(selectedBuilding.id, i)}
                        className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
                          on
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-white text-gray-400 border-gray-300 hover:border-orange-400 line-through'
                        }`}
                      >
                        {faceLabel(i, selectedBuilding.data.footprint.length)} {on ? '✓' : ''}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {selectedBuilding.scaffold_enabled && selectedBuilding.data.face_eave_heights && selectedBuilding.data.face_eave_heights.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Scaffold Height Per Face
                </h2>
                <p className="text-xs text-gray-400 mb-3">
                  Ground to gutter on each side. Mark gable ends so the scaffold steps up toward the ridge.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {selectedBuilding.data.face_eave_heights.map((h, i) => {
                    const isGable = (selectedBuilding.data.gable_faces ?? [])[i] ?? false;
                    return (
                      <div key={i} className="flex flex-col gap-1">
                        <Field
                          label={faceLabel(i, selectedBuilding.data.face_eave_heights!.length)}
                          unit="m"
                          value={h}
                          onChange={v => setBuildingFaceHeight(selectedBuilding.id, i, v)}
                          min={1.5}
                          max={15}
                          step={0.1}
                        />
                        <button
                          type="button"
                          onClick={() => toggleBuildingGable(selectedBuilding.id, i)}
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
                  <select value={selectedBuilding.data.roof_type}
                    onChange={e => setBuildingField(selectedBuilding.id, 'roof_type', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none">
                    <option value="gable">Gable</option>
                    <option value="hip">Hip</option>
                    <option value="flat">Flat</option>
                  </select>
                </div>
                {selectedBuilding.data.roof_type !== 'flat' && (
                  <Field label="Roof Pitch" unit="°" value={selectedBuilding.data.roof_pitch_degrees}
                    onChange={v => setBuildingField(selectedBuilding.id, 'roof_pitch_degrees', v)} min={5} max={60} step={1} />
                )}
              </div>
            </section>

            {selectedBuilding.scaffold_enabled && (
              <>
                <section>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Access</h2>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Access Type</label>
                  <select value={selectedBuilding.data.access_type ?? 'stair'}
                    onChange={e => setBuildingField(selectedBuilding.id, 'access_type', e.target.value)}
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
                  <select value={selectedBuilding.data.protection_type ?? 'roof_catch'}
                    onChange={e => setBuildingField(selectedBuilding.id, 'protection_type', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none">
                    <option value="roof_catch">Roof catch (1 m down, 4 rails)</option>
                    <option value="edge_protection">Edge protection (2 m down, 2 rails)</option>
                  </select>
                </section>
              </>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <p className="text-sm text-gray-400">
              {selected.type === 'boundary'
                ? 'Editing the lot boundary. Select a building to edit its heights, roof and scaffold settings.'
                : 'Editing a surface outline. Select a building to edit its heights, roof and scaffold settings.'}
            </p>
          </div>
        )}

        <button onClick={handleGenerate}
          className="mt-6 w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-4 rounded-2xl transition-colors text-lg">
          Generate 3D Site →
        </button>
      </div>
    </main>
  );
}

function SelPill({ label, color, active, onClick }: {
  label: string; color: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
        active ? 'text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
      }`}
      style={active ? { backgroundColor: '#f97316', borderColor: '#f97316' } : { borderColor: color, color }}
    >
      {label}
    </button>
  );
}
