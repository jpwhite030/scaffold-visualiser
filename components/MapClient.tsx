'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import L from 'leaflet';
import { Project, ProjectStatus, STATUS_META, fullAddress, formatPrice } from '@/lib/projects';
import SaveProjectModal from './SaveProjectModal';

// Live job map — every project pinned at its address, coloured by status, with
// the project list down the right-hand side (mirrors the layout scaffolding
// sales teams expect: map centre, filter pills top, cards right).

type Filter = 'all' | ProjectStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All Projects' },
  { key: 'order', label: 'Order' },
  { key: 'booked', label: 'Booked In' },
  { key: 'live', label: 'Live' },
  { key: 'off-hired', label: 'Off-Hired' },
];

export default function MapClient() {
  const router = useRouter();
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fittedRef = useRef(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const visible = useMemo(
    () => (filter === 'all' ? projects : projects.filter(p => p.status === filter)),
    [projects, filter],
  );

  // Initialise the map once.
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current, { zoomControl: true }).setView([-34.43, 150.88], 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  // Load the jobs.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/projects')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { if (!cancelled && d?.ok && Array.isArray(d.projects)) setProjects(d.projects); })
      .catch(() => { if (!cancelled) setLoadError('Could not load projects — refresh to retry.'); });
    return () => { cancelled = true; };
  }, []);

  // Zoom to fit every job once they arrive.
  useEffect(() => {
    if (fittedRef.current || !mapRef.current || projects.length === 0) return;
    const bounds = L.latLngBounds(projects.map(p => [p.lat, p.lng] as [number, number]));
    mapRef.current.fitBounds(bounds.pad(0.25));
    fittedRef.current = true;
  }, [projects]);

  // Redraw pins whenever the visible set or selection changes.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const p of visible) {
      const selected = p.id === selectedId;
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: selected ? 11 : 8,
        color: '#ffffff',
        weight: 2,
        fillColor: STATUS_META[p.status].colour,
        fillOpacity: 1,
      }).addTo(layer);
      marker.bindTooltip(`${p.name} · ${formatPrice(p.price)}`);
      marker.on('click', () => setSelectedId(p.id));
    }
  }, [visible, selectedId]);

  // Selecting a job (pin or card) centres the map and scrolls its card into view.
  useEffect(() => {
    if (!selectedId) return;
    const p = projects.find(x => x.id === selectedId);
    if (p && mapRef.current) {
      mapRef.current.flyTo([p.lat, p.lng], Math.max(mapRef.current.getZoom(), 13), { duration: 0.6 });
    }
    cardRefs.current[selectedId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedId, projects]);

  const openProject = (p: Project) => {
    if (!p.building) return;
    sessionStorage.setItem('buildingData', JSON.stringify(p.building));
    router.push('/viewer');
  };

  return (
    <div className="w-screen h-screen flex bg-gray-100 overflow-hidden">
      {/* ── Map ── */}
      <div className="relative flex-1 min-w-0">
        <div ref={mapDivRef} className="absolute inset-0" />

        {/* Status filter pills */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-1 bg-white rounded-full shadow-md px-1.5 py-1.5 max-w-[92%] overflow-x-auto">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => { setFilter(f.key); setSelectedId(null); }}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                filter === f.key ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {f.key !== 'all' && (
                <span className="w-2 h-2 rounded-full" style={{ background: STATUS_META[f.key as ProjectStatus].colour }} />
              )}
              {f.label}
            </button>
          ))}
        </div>

        {/* Count */}
        <div className="absolute top-4 right-4 z-[1000] bg-white rounded-full shadow-md px-4 py-2 text-xs font-medium text-gray-600">
          {visible.length} project{visible.length === 1 ? '' : 's'} found
        </div>

        {/* Back to visualiser */}
        <div className="absolute bottom-4 left-4 z-[1000]">
          <button
            onClick={() => router.push('/')}
            className="bg-white shadow-md rounded-full px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← Visualiser
          </button>
        </div>
      </div>

      {/* ── Project list ── */}
      <aside className="w-[340px] shrink-0 h-full overflow-y-auto bg-white border-l border-gray-200">
        <div className="px-4 py-4 border-b border-gray-200 sticky top-0 bg-white z-10 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-bold text-gray-800">Projects</h1>
            <p className="text-xs text-gray-400 mt-0.5">Live map of every job on the books</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-3 py-2 rounded-lg shrink-0"
          >
            ＋ Add job
          </button>
        </div>

        {loadError && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{loadError}</div>
        )}
        {!loadError && projects.length === 0 && (
          <div className="m-4 text-sm text-gray-400">Loading projects…</div>
        )}
        {!loadError && projects.length > 0 && visible.length === 0 && (
          <div className="m-4 text-sm text-gray-400">No projects with this status.</div>
        )}

        {visible.map(p => {
          const meta = STATUS_META[p.status];
          const selected = p.id === selectedId;
          return (
            <div
              key={p.id}
              ref={el => { cardRefs.current[p.id] = el; }}
              onClick={() => setSelectedId(p.id)}
              className={`px-4 py-3 border-b border-gray-100 cursor-pointer transition-colors ${
                selected ? 'bg-orange-50' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-gray-400">{p.id}</span>
                <span
                  className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded"
                  style={{ background: `${meta.colour}22`, color: meta.colour }}
                >
                  {meta.label}
                </span>
              </div>
              <p className="font-semibold text-gray-800 text-sm mt-1 leading-snug">{p.name}</p>
              {p.client && <p className="text-xs text-gray-500 mt-0.5">{p.client}</p>}
              <p className="text-xs text-gray-500 mt-0.5">📍 {fullAddress(p)}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm font-bold text-gray-800">{formatPrice(p.price)}</span>
                {p.building ? (
                  <button
                    onClick={e => { e.stopPropagation(); openProject(p); }}
                    className="text-xs text-orange-600 font-semibold hover:underline"
                  >
                    Open Project →
                  </button>
                ) : (
                  <span className="text-[11px] text-gray-300">No 3D model</span>
                )}
              </div>
            </div>
          );
        })}
      </aside>

      <SaveProjectModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={p => {
          setShowAdd(false);
          setProjects(prev => {
            const i = prev.findIndex(x => x.id === p.id);
            return i >= 0 ? prev.map(x => (x.id === p.id ? p : x)) : [...prev, p];
          });
          setFilter('all');
          setSelectedId(p.id);
        }}
      />
    </div>
  );
}
