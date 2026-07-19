'use client';

import { useEffect, useState } from 'react';
import { BuildingData } from '@/lib/buildingTypes';
import { ALL_STATUSES, Project, ProjectStatus, STATUS_META } from '@/lib/projects';

// One modal for both entry points: "Add job" on the map and "Save to job map"
// on the quote page (which passes price + the building snapshot as prefill).
// Address is geocoded on save via /api/geocode; if that misses, the lat/lng
// fields open up for a manual pin.

export interface ProjectPrefill {
  name?: string;
  client?: string;
  address?: string;
  price?: number;
  status?: ProjectStatus;
  building?: BuildingData;
}

export default function SaveProjectModal({ open, onClose, prefill, onSaved }: {
  open: boolean;
  onClose: () => void;
  prefill?: ProjectPrefill;
  onSaved: (p: Project) => void;
}) {
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [address, setAddress] = useState('');
  const [suburb, setSuburb] = useState('');
  const [stateAU, setStateAU] = useState('NSW');
  const [postcode, setPostcode] = useState('');
  const [price, setPrice] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('enquiry');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [showLatLng, setShowLatLng] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setName(prefill?.name ?? '');
    setClient(prefill?.client ?? '');
    setAddress(prefill?.address ?? '');
    setSuburb('');
    setStateAU('NSW');
    setPostcode('');
    setPrice(prefill?.price != null ? String(prefill.price) : '');
    setStatus(prefill?.status ?? 'enquiry');
    setLat('');
    setLng('');
    setShowLatLng(false);
    setSaving(false);
    setError(null);
  }, [open, prefill]);

  if (!open) return null;

  const save = async () => {
    setError(null);
    if (!name.trim()) { setError('Give the job a name.'); return; }

    setSaving(true);
    try {
      let pinLat = Number(lat), pinLng = Number(lng);
      const manualPin = lat.trim() !== '' && lng.trim() !== '' &&
        Number.isFinite(pinLat) && Number.isFinite(pinLng);

      if (!manualPin) {
        const q = [address, suburb, stateAU, postcode].filter(s => s.trim()).join(', ');
        if (!q) {
          setShowLatLng(true);
          setError('Enter an address, or set lat/lng manually.');
          setSaving(false);
          return;
        }
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q + ', Australia')}`);
        const geo = await res.json().catch(() => null);
        if (!res.ok || !geo?.ok) {
          setShowLatLng(true);
          setError(geo?.error ?? 'Could not find that address — set lat/lng manually.');
          setSaving(false);
          return;
        }
        pinLat = geo.lat;
        pinLng = geo.lng;
      }

      const body = {
        project: {
          name: name.trim(),
          client: client.trim(),
          address: address.trim(),
          suburb: suburb.trim(),
          state: stateAU.trim() || 'NSW',
          postcode: postcode.trim(),
          lat: pinLat,
          lng: pinLng,
          price: Number(price) || 0,
          status,
          ...(prefill?.building ? { building: prefill.building } : {}),
        },
      };
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Save failed (${res.status}).`);
        setSaving(false);
        return;
      }
      onSaved(data.project as Project);
    } catch {
      setError('Network error — try again.');
      setSaving(false);
    }
  };

  const field = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:border-orange-400';

  return (
    <div className="fixed inset-0 z-[2000] bg-black/40 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-gray-900">Save job to map</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <div className="space-y-3">
          <input className={field} placeholder="Job name *" value={name} onChange={e => setName(e.target.value)} />
          <input className={field} placeholder="Client / builder" value={client} onChange={e => setClient(e.target.value)} />
          <input className={field} placeholder="Street address" value={address} onChange={e => setAddress(e.target.value)} />
          <div className="grid grid-cols-3 gap-2">
            <input className={field + ' col-span-1'} placeholder="Suburb" value={suburb} onChange={e => setSuburb(e.target.value)} />
            <input className={field + ' col-span-1'} placeholder="State" value={stateAU} onChange={e => setStateAU(e.target.value)} />
            <input className={field + ' col-span-1'} placeholder="Postcode" value={postcode} onChange={e => setPostcode(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input className={field} placeholder="Price (AUD)" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value.replace(/[^\d]/g, ''))} />
            <select className={field} value={status} onChange={e => setStatus(e.target.value as ProjectStatus)}>
              {ALL_STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
          </div>

          {showLatLng ? (
            <div className="grid grid-cols-2 gap-2">
              <input className={field} placeholder="Latitude" value={lat} onChange={e => setLat(e.target.value)} />
              <input className={field} placeholder="Longitude" value={lng} onChange={e => setLng(e.target.value)} />
            </div>
          ) : (
            <button onClick={() => setShowLatLng(true)} className="text-xs text-gray-400 hover:text-gray-600 underline">
              Set lat/lng manually instead of geocoding
            </button>
          )}

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} disabled={saving}
              className="flex-1 border border-gray-300 text-gray-600 font-semibold text-sm rounded-lg py-2.5 hover:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={save} disabled={saving}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm rounded-lg py-2.5 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save job'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
