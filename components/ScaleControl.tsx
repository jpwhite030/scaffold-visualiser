'use client';

import { useEffect, useState } from 'react';

const PRESETS = [50, 100, 200, 500];

// Plan-scale selector for the review pages. The trace loads as if the drawing
// were 1:100; if it's actually printed at another scale, picking it rescales
// every plan dimension by the ratio change (1:100 → 1:200 doubles everything,
// and picking 1:100 again halves it back). The assumed scale is remembered in
// sessionStorage so leaving and returning to the page can't double-apply;
// a fresh upload clears it back to 1:100.
export default function ScaleControl({ heading, blurb, storageKey, onApply }: {
  heading: string;
  blurb: string;
  /** sessionStorage key remembering the assumed scale for this trace. */
  storageKey: string;
  /** Called with the factor to multiply every plan dimension by. */
  onApply: (factor: number) => void;
}) {
  const [current, setCurrent] = useState(100);
  const [customN, setCustomN] = useState('');

  useEffect(() => {
    try {
      const saved = Number(sessionStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved >= 1 && saved <= 2000) setCurrent(saved);
    } catch { /* ignore */ }
  }, [storageKey]);

  const pick = (n: number) => {
    if (!Number.isFinite(n) || n < 1 || n > 2000 || n === current) return;
    onApply(n / current);
    setCurrent(n);
    try { sessionStorage.setItem(storageKey, String(n)); } catch { /* ignore */ }
  };

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <label className="block text-sm font-medium text-gray-700 mb-1">{heading}</label>
      <p className="text-xs text-gray-400 mb-2">{blurb}</p>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map(n => (
          <button
            key={n}
            type="button"
            onClick={() => pick(n)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${
              current === n
                ? 'bg-orange-500 border-orange-500 text-white'
                : 'border-gray-300 text-gray-600 bg-white hover:border-orange-400 hover:text-orange-600'
            }`}
          >
            1:{n}
          </button>
        ))}
        {!PRESETS.includes(current) && (
          <span className="text-xs font-semibold px-3 py-1.5 rounded-md bg-orange-500 border border-orange-500 text-white">
            1:{current}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-sm text-gray-500">1 :</span>
          <input
            type="number" min={1} max={2000} step={1}
            value={customN}
            placeholder={String(current)}
            onChange={e => setCustomN(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { pick(Number(customN)); setCustomN(''); } }}
            className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none"
          />
          <button
            type="button"
            onClick={() => { pick(Number(customN)); setCustomN(''); }}
            disabled={!customN || Number(customN) < 1 || Number(customN) === current}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
          >
            Set
          </button>
        </div>
      </div>
    </div>
  );
}
