'use client';

import { GearList } from '@/lib/gearList';

export default function GearListModal({ gearList, subtitle, onClose }: {
  gearList: GearList;
  subtitle: string;
  onClose: () => void;
}) {
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
            <p className="text-xs text-gray-400">{subtitle}</p>
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
