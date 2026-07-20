import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { QuoteRenders } from './captureRenders';

// One-click branded quote PDF — mirrors the on-screen quote document (header,
// client, scope, 3D renders, line items, totals, notes) so what Jack previews
// is what the builder receives. Loaded via dynamic import so jsPDF stays out
// of the main bundle.

export interface PdfQuoteLine {
  description: string;
  qty: number;
  unit: string;
  rate: number;
}

export interface PdfQuote {
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
  lines: PdfQuoteLine[];
}

const ORANGE: [number, number, number] = [249, 115, 22];
const ORANGE_BG: [number, number, number] = [255, 247, 237];
const DARK: [number, number, number] = [17, 24, 39];
const GREY: [number, number, number] = [107, 114, 128];
const GREY_LIGHT: [number, number, number] = [156, 163, 175];
const RULE: [number, number, number] = [229, 231, 235];

const M = 15;            // page margin (mm)
const PAGE_W = 210;
const PAGE_H = 297;
const CONTENT_W = PAGE_W - 2 * M;

function money(n: number): string {
  return '$' + n.toLocaleString('en-AU', { maximumFractionDigits: 0 });
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function generateQuotePdf(
  quote: PdfQuote,
  totals: { subtotal: number; gst: number; total: number },
  renders: QuoteRenders | null,
): Promise<void> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 20;

  // ── Header ──
  doc.setFont('helvetica', 'bold').setFontSize(19).setTextColor(...DARK);
  doc.text(quote.companyName || 'Quote', M, y);
  doc.setFont('helvetica', 'bold').setFontSize(24).setTextColor(...ORANGE);
  doc.text('QUOTE', PAGE_W - M, y, { align: 'right' });

  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GREY);
  let leftY = y + 6;
  for (const line of [quote.companyPhone, quote.companyEmail, quote.companyABN ? `ABN ${quote.companyABN}` : ''].filter(Boolean)) {
    doc.text(line, M, leftY);
    leftY += 4.5;
  }
  let rightY = y + 8;
  for (const line of [`No. ${quote.quoteNumber}`, `Date ${quote.quoteDate}`, `Valid for ${quote.validDays} days`]) {
    doc.text(line, PAGE_W - M, rightY, { align: 'right' });
    rightY += 4.5;
  }
  y = Math.max(leftY, rightY) + 2;
  doc.setDrawColor(...ORANGE).setLineWidth(0.8);
  doc.line(M, y, PAGE_W - M, y);
  y += 9;

  // ── Client ──
  doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...GREY_LIGHT);
  doc.text('QUOTE PREPARED FOR', M, y);
  y += 5;
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...DARK);
  doc.text(quote.clientName || '—', M, y);
  y += 5;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GREY);
  for (const line of [quote.clientAddress, quote.clientPhone].filter(Boolean)) {
    doc.text(line, M, y);
    y += 4.5;
  }
  y += 4;

  // ── Scope box ──
  if (quote.scopeDescription.trim()) {
    const scopeLines = doc.setFontSize(9).splitTextToSize(quote.scopeDescription, CONTENT_W - 10) as string[];
    const boxH = 9 + scopeLines.length * 4.2 + 4;
    doc.setFillColor(...ORANGE_BG);
    doc.roundedRect(M, y, CONTENT_W, boxH, 2, 2, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...ORANGE);
    doc.text('SCOPE OF WORK', M + 5, y + 6);
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(60, 60, 60);
    doc.text(scopeLines, M + 5, y + 11.5);
    y += boxH + 7;
  }

  // ── 3D renders ──
  const images = (
    await Promise.all(
      ([
        { src: renders?.hero, caption: '3D scaffold model — erected view' },
        { src: renders?.kit, caption: 'Kit view — coloured by stock length' },
      ] as const).map(async ({ src, caption }) => {
        if (!src) return null;
        const img = await loadImage(src);
        return img ? { src, caption, w: img.naturalWidth, h: img.naturalHeight } : null;
      }),
    )
  ).filter((x): x is NonNullable<typeof x> => x !== null);

  if (images.length > 0) {
    const gap = 5;
    const slotW = images.length === 2 ? (CONTENT_W - gap) / 2 : CONTENT_W;
    const maxH = images.length === 2 ? 60 : 80;
    const drawn = images.map(img => {
      const scale = Math.min(slotW / img.w, maxH / img.h);
      return { ...img, drawW: img.w * scale, drawH: img.h * scale };
    });
    const rowH = Math.max(...drawn.map(d => d.drawH)) + 6;
    if (y + rowH > PAGE_H - 25) {
      doc.addPage();
      y = 20;
    }
    let x = M;
    for (const d of drawn) {
      doc.addImage(d.src, 'JPEG', x, y, d.drawW, d.drawH);
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...GREY_LIGHT);
      doc.text(d.caption, x + d.drawW / 2, y + d.drawH + 4, { align: 'center' });
      x += slotW + gap;
    }
    y += rowH + 5;
  }

  // ── Line items ──
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Description', 'Qty', 'Unit', 'Rate', 'Total']],
    body: quote.lines.map(l => [l.description, String(l.qty), l.unit, money(l.rate), money(l.qty * l.rate)]),
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.5, textColor: DARK, lineColor: RULE, lineWidth: 0.1 },
    headStyles: { fillColor: ORANGE, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 14, halign: 'right' },
      2: { cellWidth: 16 },
      3: { cellWidth: 24, halign: 'right' },
      4: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
    },
    theme: 'grid',
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  // ── Totals ──
  if (y > PAGE_H - 55) {
    doc.addPage();
    y = 20;
  }
  const totX = PAGE_W - M;
  const labX = totX - 62;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...GREY);
  doc.text('Subtotal (ex GST)', labX, y);
  doc.text(money(totals.subtotal), totX, y, { align: 'right' });
  y += 5;
  doc.text('GST (10%)', labX, y);
  doc.text(money(totals.gst), totX, y, { align: 'right' });
  y += 3;
  doc.setDrawColor(...DARK).setLineWidth(0.5);
  doc.line(labX, y, totX, y);
  y += 5.5;
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...DARK);
  doc.text('TOTAL (inc GST)', labX, y);
  doc.text(money(totals.total), totX, y, { align: 'right' });
  y += 12;

  // ── Notes ──
  if (quote.notes.trim()) {
    const noteLines = doc.setFontSize(8).splitTextToSize(quote.notes, CONTENT_W) as string[];
    if (y + noteLines.length * 3.8 + 10 > PAGE_H - 15) {
      doc.addPage();
      y = 20;
    }
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...GREY_LIGHT);
    doc.text('NOTES & TERMS', M, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GREY);
    doc.text(noteLines, M, y);
  }

  // ── Footer on every page ──
  const footer = [quote.companyName, quote.companyEmail, quote.companyABN ? `ABN ${quote.companyABN}` : '']
    .filter(Boolean)
    .join(' · ');
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...GREY_LIGHT);
    doc.text(footer, PAGE_W / 2, PAGE_H - 8, { align: 'center' });
  }

  doc.save(`${quote.quoteNumber || 'quote'}.pdf`);
}
