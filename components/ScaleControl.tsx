'use client';

import { useState } from 'react';

// One-shot uniform scale for the review pages — for when the whole trace came
// out the wrong size. Type a percentage (or tap a preset), Apply multiplies
// every dimension once, and the field snaps back to 100% ready for another go.
export default function ScaleControl({ heading, blurb, onApply }: {
  heading: string;
  blurb: string;
  onApply: (factor: number, includeHeights: boolean) => void;
}) {
  const [pct, setPct] = useState('100');
  const [includeHeights, setIncludeHeights] = useState(false);

  const factor = Number(pct) / 100;
  const valid = Number.isFinite(factor) && factor >= 0.25 && factor <= 4;

  const apply = (f: number) => {
    if (!Number.isFinite(f) || f < 0.25 || f > 4 || f === 1) return;
    onApply(f, includeHeights);
    setPct('100');
  };

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-2">
        <label className="text-sm font-medium text-gray-700">{heading}</label>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={includeHeights}
            onChange={e => setIncludeHeights(e.target.checked)}
            className="accent-orange-500 w-3.5 h-3.5"
          />
          Also scale heights
        </label>
      </div>
      <p className="text-xs text-gray-400 mb-2">{blurb}</p>
      <div className="flex flex-wrap items-center gap-2">
        {[90, 95, 105, 110].map(p => (
          <button
            key={p}
            type="button"
            onClick={() => apply(p / 100)}
            className="text-xs font-semibold px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 bg-white hover:border-orange-400 hover:text-orange-600 transition-colors"
          >
            {p}%
          </button>
        ))}
        <div className="relative ml-auto">
          <input
            type="number" min={25} max={400} step={1}
            value={pct}
            onChange={e => setPct(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') apply(factor); }}
            className="w-24 border border-gray-300 rounded-lg pl-3 pr-7 py-1.5 text-sm text-gray-900 focus:ring-2 focus:ring-orange-400 focus:border-transparent outline-none"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">%</span>
        </div>
        <button
          type="button"
          onClick={() => apply(factor)}
          disabled={!valid || factor === 1}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-1.5 rounded-lg transition-colors"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
