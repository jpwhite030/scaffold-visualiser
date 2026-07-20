'use client';

import { useEffect, useRef, useState, RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { BuildingData, footprintBounds } from '@/lib/buildingTypes';
import { SiteData } from '@/lib/siteTypes';
import { QuoteRenders, loadQuoteRenders } from '@/lib/captureRenders';
import SaveProjectModal from '@/components/SaveProjectModal';

// ── Scaffold metrics ──────────────────────────────────────────────────────────

interface Metrics {
  perimeter: number;
  numLifts: number;
  maxEave: number;
}

function scaffoldMetrics(data: BuildingData): Metrics {
  const poly = data.footprint;
  let perimeter = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    perimeter += Math.hypot(x2 - x1, z2 - z1);
  }
  const maxEave   = data.eave_height_m;
  const numLifts  = maxEave > 4.0 ? 2 : 1;
  return { perimeter: Math.round(perimeter * 10) / 10, numLifts, maxEave };
}

function siteMetrics(site: SiteData, scaffolded: SiteData['buildings']): Metrics {
  const per = scaffolded.map(b => scaffoldMetrics(b.data));
  return {
    perimeter: Math.round(per.reduce((s, m) => s + m.perimeter, 0) * 10) / 10,
    numLifts:  per.reduce((m, x) => Math.max(m, x.numLifts), 1),
    maxEave:   per.reduce((m, x) => Math.max(m, x.maxEave), 0),
  };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuoteLine {
  id: string;
  description: string;
  qty: number;
  unit: string;
  rate: number;
}

interface QuoteState {
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  companyABN: string;
  clientName: string;
  clientAddress: string;
  clientPhone: string;
  quoteNumber: string;
  quoteDate: string;
  validDays: number;
  scopeDescription: string;
  notes: string;
  lines: QuoteLine[];
}

// ── Persistence ───────────────────────────────────────────────────────────────

const COMPANY_KEY = 'skelscaff_company';

function loadCompany(): Partial<QuoteState> {
  try {
    const raw = localStorage.getItem(COMPANY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCompany(q: QuoteState) {
  try {
    localStorage.setItem(COMPANY_KEY, JSON.stringify({
      companyName: q.companyName,
      companyPhone: q.companyPhone,
      companyEmail: q.companyEmail,
      companyABN: q.companyABN,
    }));
  } catch { /* ignore */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }

function fmt(n: number) {
  return n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function todayAU() {
  return new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function buildDefaultQuote(data: BuildingData): QuoteState {
  const saved   = loadCompany();
  const metrics = scaffoldMetrics(data);
  const bounds  = footprintBounds(data.footprint);
  const w       = (bounds.maxX - bounds.minX).toFixed(1);
  const d       = (bounds.maxZ - bounds.minZ).toFixed(1);
  const stories = data.num_stories >= 2 ? 'two' : 'single';

  // Rough pricing guide — user adjusts from here
  const edRate   = data.num_stories >= 2 ? 120 : 80;
  const edEst    = Math.round((metrics.perimeter * edRate) / 100) * 100;
  const hireRate = data.num_stories >= 2 ? 22 : 15;
  const hireEst  = Math.round((metrics.perimeter * hireRate) / 10) * 10;

  return {
    companyName:  saved.companyName  ?? 'Skelscaff',
    companyPhone: saved.companyPhone ?? '',
    companyEmail: saved.companyEmail ?? 'jack@skelscaff.com.au',
    companyABN:   saved.companyABN   ?? '',
    clientName:    '',
    clientAddress: '',
    clientPhone:   '',
    quoteNumber:  `Q-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
    quoteDate:    todayAU(),
    validDays:    30,
    scopeDescription:
      `Supply, erect, hire and dismantle Kwikstage scaffold to ${w}m × ${d}m ${stories}-storey residential dwelling. ` +
      `${metrics.numLifts} lift${metrics.numLifts > 1 ? 's' : ''} to ${metrics.maxEave}m eave height, full perimeter ${metrics.perimeter}m.`,
    notes:
      'All prices include GST.\nPayment terms: 50% deposit on commencement, balance on completion.\nHire period commences on erection date.\nAdditional weeks charged at the weekly rate above.',
    lines: [
      {
        id:          uid(),
        description: 'Kwikstage scaffold — erect & dismantle\nFull perimeter, ' + metrics.numLifts + ' lift' + (metrics.numLifts > 1 ? 's' : '') + ', all labour and materials',
        qty:         1,
        unit:        'job',
        rate:        edEst,
      },
      {
        id:          uid(),
        description: 'Scaffold hire',
        qty:         4,
        unit:        'week',
        rate:        hireEst,
      },
    ],
  };
}

// ── Site quote — combined scope + one erect/dismantle line per building ──────

function buildDefaultSiteQuote(site: SiteData): QuoteState {
  const saved = loadCompany();
  // Quote the buildings the user flagged for scaffold; if none are flagged,
  // fall back to all of them so the quote is never empty.
  const scaffolded = site.buildings.filter(b => b.scaffold_enabled);
  const targets = scaffolded.length > 0 ? scaffolded : site.buildings;
  const combined = siteMetrics(site, targets);

  const summary = targets.map(b => {
    const bb = footprintBounds(b.data.footprint);
    return `${b.label} ${(bb.maxX - bb.minX).toFixed(1)}m × ${(bb.maxZ - bb.minZ).toFixed(1)}m`;
  }).join(', ');

  let hireTotal = 0;
  const lines: QuoteLine[] = targets.map(b => {
    const m = scaffoldMetrics(b.data);
    const edRate = b.data.num_stories >= 2 ? 120 : 80;
    hireTotal += (m.perimeter * (b.data.num_stories >= 2 ? 22 : 15));
    return {
      id: uid(),
      description: `${b.label} — Kwikstage scaffold erect & dismantle\nFull perimeter ${m.perimeter}m, ${m.numLifts} lift${m.numLifts > 1 ? 's' : ''}, all labour and materials`,
      qty: 1,
      unit: 'job',
      rate: Math.round((m.perimeter * edRate) / 100) * 100,
    };
  });
  lines.push({
    id: uid(),
    description: 'Scaffold hire — all buildings',
    qty: 4,
    unit: 'week',
    rate: Math.round(hireTotal / 10) * 10,
  });

  return {
    companyName:  saved.companyName  ?? 'Skelscaff',
    companyPhone: saved.companyPhone ?? '',
    companyEmail: saved.companyEmail ?? 'jack@skelscaff.com.au',
    companyABN:   saved.companyABN   ?? '',
    clientName:    '',
    clientAddress: '',
    clientPhone:   '',
    quoteNumber:  `Q-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
    quoteDate:    todayAU(),
    validDays:    30,
    scopeDescription:
      `Supply, erect, hire and dismantle Kwikstage scaffold to ${targets.length} building${targets.length > 1 ? 's' : ''} — ${summary}. ` +
      `Lot ${site.site_width_m}m × ${site.site_depth_m}m, combined perimeter ${combined.perimeter}m, max eave ${combined.maxEave}m.`,
    notes:
      'All prices include GST.\nPayment terms: 50% deposit on commencement, balance on completion.\nHire period commences on erection date.\nAdditional weeks charged at the weekly rate above.',
    lines,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

export default function QuotePage() {
  const router = useRouter();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [backTarget, setBackTarget] = useState('/viewer');
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [buildingSnapshot, setBuildingSnapshot] = useState<BuildingData | null>(null);
  const [renders, setRenders] = useState<QuoteRenders | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRenders(loadQuoteRenders());
    const mode = sessionStorage.getItem('quoteMode');
    if (mode === 'site') {
      const rawSite = sessionStorage.getItem('siteData');
      if (rawSite) {
        try {
          const site: SiteData = JSON.parse(rawSite);
          if (site.buildings?.length > 0) {
            const scaffolded = site.buildings.filter(b => b.scaffold_enabled);
            setMetrics(siteMetrics(site, scaffolded.length > 0 ? scaffolded : site.buildings));
            setBackTarget('/site-viewer');
            setQuote(buildDefaultSiteQuote(site));
            return;
          }
        } catch { /* fall through to building quote */ }
      }
    }
    const raw = sessionStorage.getItem('buildingData');
    if (!raw) { router.push('/'); return; }
    const bd: BuildingData = JSON.parse(raw);
    setBuildingSnapshot(bd);
    setMetrics(scaffoldMetrics(bd));
    setQuote(buildDefaultQuote(bd));
  }, [router]);

  if (!metrics || !quote) return <div className="min-h-screen bg-gray-50" />;

  const subtotal = quote.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const gst      = subtotal * 0.1;
  const total    = subtotal + gst;

  const set = (patch: Partial<QuoteState>) =>
    setQuote(prev => prev ? { ...prev, ...patch } : prev);

  const setLine = (id: string, patch: Partial<QuoteLine>) =>
    set({ lines: quote.lines.map(l => l.id === id ? { ...l, ...patch } : l) });

  const addLine = () =>
    set({ lines: [...quote.lines, { id: uid(), description: '', qty: 1, unit: 'item', rate: 0 }] });

  const removeLine = (id: string) =>
    set({ lines: quote.lines.filter(l => l.id !== id) });

  const handlePrint = () => {
    saveCompany(quote);
    window.print();
  };

  // jsPDF only loads when the button is clicked — keeps it out of the page bundle.
  const handleDownloadPdf = async () => {
    saveCompany(quote);
    setPdfBusy(true);
    try {
      const { generateQuotePdf } = await import('@/lib/quotePdf');
      await generateQuotePdf(quote, { subtotal, gst, total }, renders);
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-shadow { box-shadow: none !important; }
          input, textarea { border: none !important; outline: none !important; background: transparent !important; resize: none !important; }
          body { background: white !important; }
          .delete-btn { display: none !important; }
          .add-line-btn { display: none !important; }
        }
        @media screen {
          .print-only { display: none !important; }
        }
        input, textarea {
          font-family: inherit;
          color: inherit;
        }
      `}</style>

      {/* Toolbar — screen only */}
      <div className="no-print sticky top-0 z-20 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between gap-4 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push(backTarget)}
            className="text-gray-400 hover:text-gray-700 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900">Quote Creator</h1>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <MetricBadge label="Perimeter" value={`${metrics.perimeter}m`} />
          <MetricBadge label="Lifts"     value={String(metrics.numLifts)} />
          <MetricBadge label="Max eave"  value={`${metrics.maxEave}m`} />
          <button onClick={() => setShowSave(true)}
            className="ml-2 border border-orange-500 text-orange-600 hover:bg-orange-50 font-semibold px-5 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Save to job map
          </button>
          <button onClick={handlePrint}
            className="border border-gray-300 text-gray-600 hover:bg-gray-50 font-semibold px-5 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print
          </button>
          <button onClick={handleDownloadPdf} disabled={pdfBusy}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold px-5 py-2 rounded-lg transition-colors flex items-center gap-2 text-sm">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
            </svg>
            {pdfBusy ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </div>

      <SaveProjectModal
        open={showSave}
        onClose={() => setShowSave(false)}
        prefill={{
          name: quote.clientAddress ? `Scaffold — ${quote.clientAddress}` : `Scaffold — ${quote.clientName || quote.quoteNumber}`,
          client: quote.clientName,
          address: quote.clientAddress,
          price: Math.round(total),
          status: 'enquiry',
          ...(buildingSnapshot ? { building: buildingSnapshot } : {}),
        }}
        onSaved={() => router.push('/map')}
      />

      {/* Quote document */}
      <div className="no-print min-h-screen bg-gray-100 py-8 px-4">
        <QuoteDocument
          quote={quote}
          renders={renders}
          subtotal={subtotal}
          gst={gst}
          total={total}
          set={set}
          setLine={setLine}
          removeLine={removeLine}
          addLine={addLine}
          contentRef={contentRef}
        />
      </div>

      {/* Print-only version (always rendered, hidden on screen) */}
      <div className="print-only">
        <QuoteDocument
          quote={quote}
          renders={renders}
          subtotal={subtotal}
          gst={gst}
          total={total}
          set={set}
          setLine={setLine}
          removeLine={removeLine}
          addLine={addLine}
          contentRef={undefined}
        />
      </div>
    </>
  );
}

// ── Quote document ────────────────────────────────────────────────────────────

function QuoteDocument({
  quote, renders, subtotal, gst, total,
  set, setLine, removeLine, addLine,
  contentRef,
}: {
  quote: QuoteState;
  renders: QuoteRenders | null;
  subtotal: number; gst: number; total: number;
  set: (p: Partial<QuoteState>) => void;
  setLine: (id: string, p: Partial<QuoteLine>) => void;
  removeLine: (id: string) => void;
  addLine: () => void;
  contentRef: RefObject<HTMLDivElement | null> | undefined;
}) {
  return (
    <div
      ref={contentRef}
      className="print-shadow bg-white rounded-2xl shadow-lg max-w-3xl mx-auto px-10 py-10"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
    >
      {/* Header */}
      <div className="flex justify-between items-start gap-6 mb-8 pb-6 border-b-2 border-orange-500">
        <div className="flex-1">
          <TxtInput
            value={quote.companyName}
            onChange={v => set({ companyName: v })}
            className="text-2xl font-extrabold text-gray-900 w-full"
            placeholder="Company Name"
          />
          <div className="mt-1 space-y-0.5 text-sm text-gray-500">
            <TxtInput value={quote.companyPhone} onChange={v => set({ companyPhone: v })} placeholder="Phone" className="w-full" />
            <TxtInput value={quote.companyEmail} onChange={v => set({ companyEmail: v })} placeholder="Email" className="w-full" />
            <TxtInput value={quote.companyABN}   onChange={v => set({ companyABN: v })}   placeholder="ABN" className="w-full" />
          </div>
        </div>
        <div className="text-right min-w-[180px]">
          <p className="text-3xl font-black text-orange-500 uppercase tracking-tight mb-3">Quote</p>
          <div className="text-sm text-gray-600 space-y-1">
            <div className="flex justify-end gap-2">
              <span className="text-gray-400">No.</span>
              <TxtInput value={quote.quoteNumber} onChange={v => set({ quoteNumber: v })} className="text-right font-mono font-semibold text-gray-900 w-32" />
            </div>
            <div className="flex justify-end gap-2">
              <span className="text-gray-400">Date</span>
              <TxtInput value={quote.quoteDate} onChange={v => set({ quoteDate: v })} className="text-right w-28" />
            </div>
            <div className="flex justify-end gap-2 items-center">
              <span className="text-gray-400">Valid for</span>
              <NumInput
                value={quote.validDays}
                onChange={v => set({ validDays: v })}
                className="text-right w-12"
                min={1} max={365}
              />
              <span className="text-gray-400">days</span>
            </div>
          </div>
        </div>
      </div>

      {/* Client */}
      <div className="mb-6 grid grid-cols-2 gap-6">
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Quote prepared for</p>
          <TxtInput value={quote.clientName}    onChange={v => set({ clientName: v })}    placeholder="Client name"    className="font-semibold text-gray-900 w-full" />
          <TxtInput value={quote.clientAddress} onChange={v => set({ clientAddress: v })} placeholder="Site address"   className="text-gray-600 w-full" />
          <TxtInput value={quote.clientPhone}   onChange={v => set({ clientPhone: v })}   placeholder="Client phone"   className="text-gray-500 text-sm w-full" />
        </div>
      </div>

      {/* Scope */}
      <div className="mb-6 bg-orange-50 rounded-xl px-5 py-4">
        <p className="text-xs font-bold text-orange-500 uppercase tracking-widest mb-2">Scope of work</p>
        <textarea
          value={quote.scopeDescription}
          onChange={e => set({ scopeDescription: e.target.value })}
          rows={3}
          className="w-full bg-transparent text-sm text-gray-700 leading-relaxed resize-none outline-none"
        />
      </div>

      {/* 3D renders captured when the quote was created */}
      {renders?.hero && (
        <div className={`mb-6 grid gap-4 ${renders.kit ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element -- session-local data URL, next/image adds nothing */}
            <img src={renders.hero} alt="3D scaffold model — erected view" className="w-full rounded-xl border border-gray-100" />
            <figcaption className="text-[10px] text-gray-400 text-center mt-1.5">3D scaffold model — erected view</figcaption>
          </figure>
          {renders.kit && (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={renders.kit} alt="Kit view — coloured by stock length" className="w-full rounded-xl border border-gray-100" />
              <figcaption className="text-[10px] text-gray-400 text-center mt-1.5">Kit view — coloured by stock length</figcaption>
            </figure>
          )}
        </div>
      )}

      {/* Line items */}
      <table className="w-full text-sm mb-2">
        <thead>
          <tr className="border-b-2 border-gray-200 text-xs text-gray-400 uppercase tracking-widest">
            <th className="text-left py-2 pr-4 font-semibold w-full">Description</th>
            <th className="text-right py-2 px-2 font-semibold whitespace-nowrap">Qty</th>
            <th className="text-left py-2 px-2 font-semibold">Unit</th>
            <th className="text-right py-2 px-2 font-semibold whitespace-nowrap">Rate (incl. GST)</th>
            <th className="text-right py-2 pl-2 font-semibold whitespace-nowrap">Total</th>
            <th className="delete-btn w-6" />
          </tr>
        </thead>
        <tbody>
          {quote.lines.map(line => (
            <tr key={line.id} className="border-b border-gray-100 group">
              <td className="py-3 pr-4 align-top">
                <textarea
                  value={line.description}
                  onChange={e => setLine(line.id, { description: e.target.value })}
                  rows={line.description.includes('\n') ? 2 : 1}
                  placeholder="Description"
                  className="w-full bg-transparent text-gray-800 leading-snug resize-none outline-none hover:bg-gray-50 focus:bg-gray-50 rounded px-1 -mx-1 transition-colors"
                />
              </td>
              <td className="py-3 px-2 align-top text-right">
                <NumInput
                  value={line.qty}
                  onChange={v => setLine(line.id, { qty: v })}
                  className="w-14 text-right"
                  min={0} max={9999}
                />
              </td>
              <td className="py-3 px-2 align-top">
                <TxtInput
                  value={line.unit}
                  onChange={v => setLine(line.id, { unit: v })}
                  placeholder="unit"
                  className="w-16 text-gray-600"
                />
              </td>
              <td className="py-3 px-2 align-top text-right">
                <DollarInput
                  value={line.rate}
                  onChange={v => setLine(line.id, { rate: v })}
                  className="w-24 text-right"
                />
              </td>
              <td className="py-3 pl-2 align-top text-right font-semibold text-gray-900 whitespace-nowrap">
                {fmt(line.qty * line.rate)}
              </td>
              <td className="py-3 align-top delete-btn">
                <button
                  onClick={() => removeLine(line.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-300 hover:text-red-400 p-1 ml-1"
                  title="Remove line"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Add line */}
      <button
        onClick={addLine}
        className="add-line-btn text-sm text-orange-500 hover:text-orange-600 font-medium flex items-center gap-1 mb-6 mt-1"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add line item
      </button>

      {/* Totals */}
      <div className="flex justify-end mb-8">
        <div className="w-64">
          <TotalRow label="Subtotal (ex GST)" value={fmt(subtotal)} />
          <TotalRow label="GST (10%)"         value={fmt(gst)} />
          <div className="border-t-2 border-gray-900 mt-2 pt-2">
            <TotalRow label="TOTAL (inc GST)" value={fmt(total)} bold />
          </div>
        </div>
      </div>

      {/* Notes */}
      <div className="border-t border-gray-100 pt-6">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Notes &amp; Terms</p>
        <textarea
          value={quote.notes}
          onChange={e => set({ notes: e.target.value })}
          rows={4}
          className="w-full bg-transparent text-xs text-gray-500 leading-relaxed resize-none outline-none hover:bg-gray-50 focus:bg-gray-50 rounded px-1 -mx-1 transition-colors"
        />
      </div>

      {/* Footer */}
      <div className="mt-8 pt-4 border-t border-gray-100 text-center text-xs text-gray-300">
        {quote.companyName} · {quote.companyEmail}
        {quote.companyABN ? ` · ABN ${quote.companyABN}` : ''}
      </div>
    </div>
  );
}

// ── Field components ──────────────────────────────────────────────────────────

function TxtInput({ value, onChange, className = '', placeholder = '' }: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`bg-transparent outline-none hover:bg-gray-50 focus:bg-gray-50 rounded px-1 -mx-1 transition-colors placeholder-gray-300 ${className}`}
    />
  );
}

function NumInput({ value, onChange, className = '', min = 0, max = 9999 }: {
  value: number; onChange: (v: number) => void; className?: string; min?: number; max?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={e => onChange(Number(e.target.value))}
      className={`bg-transparent outline-none hover:bg-gray-50 focus:bg-gray-50 rounded px-1 -mx-1 transition-colors ${className}`}
    />
  );
}

function DollarInput({ value, onChange, className = '' }: {
  value: number; onChange: (v: number) => void; className?: string;
}) {
  const [raw, setRaw] = useState('');
  const [editing, setEditing] = useState(false);

  return editing ? (
    <input
      type="number"
      autoFocus
      value={raw}
      min={0}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => { onChange(Math.max(0, Number(raw) || 0)); setEditing(false); }}
      onKeyDown={e => { if (e.key === 'Enter') { onChange(Math.max(0, Number(raw) || 0)); setEditing(false); } }}
      className={`bg-gray-50 outline-none rounded px-1 -mx-1 transition-colors ${className}`}
    />
  ) : (
    <button
      onClick={() => { setRaw(String(value)); setEditing(true); }}
      className={`bg-transparent hover:bg-gray-50 rounded px-1 -mx-1 transition-colors text-gray-800 font-medium ${className}`}
    >
      {fmt(value)}
    </button>
  );
}

function TotalRow({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${bold ? 'font-bold text-gray-900 text-base' : 'text-gray-600'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function MetricBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center bg-gray-100 rounded-lg px-3 py-1">
      <p className="text-gray-400 text-xs leading-none mb-0.5">{label}</p>
      <p className="text-gray-800 font-semibold text-sm leading-none">{value}</p>
    </div>
  );
}
