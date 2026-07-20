// Snapshots of the WebGL canvas taken when the user clicks "Create Quote", so
// the quote page (and its PDF) can embed the exact model that was quoted.
// Stored in sessionStorage as JPEG data URLs — downscaled so a hero + kit pair
// stays well inside the ~5 MB storage budget. Requires the Canvas to be created
// with preserveDrawingBuffer: true.

export interface QuoteRenders {
  hero?: string; // erected view
  kit?: string;  // colour-coded kit view
}

export const QUOTE_RENDERS_KEY = 'quoteRenders';

export function loadQuoteRenders(): QuoteRenders | null {
  try {
    const raw = sessionStorage.getItem(QUOTE_RENDERS_KEY);
    return raw ? (JSON.parse(raw) as QuoteRenders) : null;
  } catch {
    return null;
  }
}

function waitFrames(n: number): Promise<void> {
  return new Promise(resolve => {
    const step = (left: number) =>
      left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(n);
  });
}

function snapshot(canvas: HTMLCanvasElement, maxWidth = 1400, quality = 0.85): string {
  const scale = Math.min(1, maxWidth / canvas.width);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  if (!ctx) return canvas.toDataURL('image/jpeg', quality);
  ctx.fillStyle = '#ffffff'; // JPEG has no alpha — avoid black showing through
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(canvas, 0, 0, w, h);
  return out.toDataURL('image/jpeg', quality);
}

/**
 * Capture the erected view and the kit view by driving the viewer's kit-view
 * state, waiting a few frames for the frameloop to redraw between shots, then
 * restoring whatever was on screen. Never throws — the quote works without
 * renders, it's just plainer.
 */
export async function captureQuoteRenders(
  canvas: HTMLCanvasElement | null,
  setKitView: (on: boolean) => void,
  kitViewOn: boolean,
): Promise<void> {
  try {
    sessionStorage.removeItem(QUOTE_RENDERS_KEY); // stale renders are worse than none
    if (!canvas) return;

    setKitView(false);
    await waitFrames(4);
    const hero = snapshot(canvas);

    setKitView(true);
    await waitFrames(4);
    const kit = snapshot(canvas);

    setKitView(kitViewOn);

    try {
      sessionStorage.setItem(QUOTE_RENDERS_KEY, JSON.stringify({ hero, kit } satisfies QuoteRenders));
    } catch {
      // Storage full — the hero shot alone is the one that matters.
      try { sessionStorage.setItem(QUOTE_RENDERS_KEY, JSON.stringify({ hero } satisfies QuoteRenders)); } catch { /* plain quote */ }
    }
  } catch {
    /* plain quote */
  }
}
