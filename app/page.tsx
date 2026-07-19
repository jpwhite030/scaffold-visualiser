'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BuildingData } from '@/lib/buildingTypes';
import { SiteData } from '@/lib/siteTypes';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

type Mode = 'building' | 'site';

export default function UploadPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('building');
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFile = useCallback(
    async (file: File) => {
      setError(null);

      if (file.size > MAX_FILE_BYTES) {
        setError('File is too large (max 10 MB). Please compress or crop the image.');
        return;
      }

      const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (!allowed.includes(file.type)) {
        setError('Unsupported file type. Please upload a JPG, PNG, WebP, or PDF.');
        return;
      }

      setLoading(true);

      try {
        // Get data URL for thumbnail in parallel with the API call
        const dataUrlPromise = new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const formData = new FormData();
        formData.append('file', file);

        const [res, dataUrl] = await Promise.all([
          fetch(mode === 'site' ? '/api/analyze-site' : '/api/analyze', { method: 'POST', body: formData }),
          dataUrlPromise,
        ]);

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          const msg = errData?.error ?? `Server error (${res.status}) — enter dimensions manually.`;
          setError(msg);
          setLoading(false);
          try { sessionStorage.setItem('imageDataUrl', dataUrl); } catch { /* ignore */ }
          return;
        }

        if (mode === 'site') {
          const data = (await res.json()) as SiteData;
          sessionStorage.setItem('siteData', JSON.stringify(data));
          try { sessionStorage.setItem('imageDataUrl', dataUrl); } catch { /* file too large for sessionStorage — thumbnail won't show */ }
          router.push('/site-review');
        } else {
          const data = (await res.json()) as BuildingData;
          sessionStorage.setItem('buildingData', JSON.stringify(data));
          try { sessionStorage.setItem('imageDataUrl', dataUrl); } catch { /* file too large for sessionStorage — thumbnail won't show */ }
          router.push('/review');
        }
      } catch {
        setError('Network error. Please check your connection and try again.');
        setLoading(false);
      }
    },
    [router, mode]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <main className="relative min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4">
      <div className="absolute top-4 right-4">
        <button
          onClick={() => router.push('/map')}
          className="flex items-center gap-2 bg-white border border-gray-200 shadow-sm rounded-full px-4 py-2 text-sm font-semibold text-gray-700 hover:border-orange-400 hover:text-orange-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          Live job map
        </button>
      </div>
      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Scaffold Visualiser" className="mx-auto w-full max-w-md" />
        </div>

        {/* Mode selector — one building vs the whole site */}
        <div className="flex justify-center mb-6">
          <div className="inline-flex rounded-full border border-gray-300 bg-white p-1">
            <ModeBtn label="Building plan" active={mode === 'building'} onClick={() => { setMode('building'); setError(null); }} disabled={loading} />
            <ModeBtn label="Site plan" active={mode === 'site'} onClick={() => { setMode('site'); setError(null); }} disabled={loading} />
          </div>
        </div>

        <label
          className={`flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-2xl cursor-pointer transition-colors
            ${dragging ? 'border-orange-400 bg-orange-50' : 'border-gray-300 bg-white hover:border-orange-400 hover:bg-orange-50'}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {loading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-600 font-medium">Analysing {mode === 'site' ? 'site plan' : 'plans'} with AI…</p>
              <p className="text-gray-400 text-sm">
                {mode === 'site'
                  ? 'Reading the lot boundary, buildings and driveway — up to 60 seconds'
                  : 'Reading dimensions and tracing footprint — up to 30 seconds'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-center px-4">
              <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414A1 1 0 0119 9.414V19a2 2 0 01-2 2z" />
              </svg>
              <div>
                <p className="text-gray-700 font-semibold">
                  {mode === 'site' ? 'Drop your site plan here' : 'Drop your building plans here'}
                </p>
                <p className="text-gray-400 text-sm mt-1">or click to browse</p>
              </div>
              <p className="text-gray-400 text-xs">PDF, JPG, PNG, WebP — max 10 MB</p>
              <p className="text-gray-400 text-xs mt-1 max-w-xs">
                {mode === 'site' ? (
                  <>Best results: a site plan showing the whole block — lot boundary with dimensions, all buildings, and the driveway. Heights default to single storey (editable next).</>
                ) : (
                  <>Best results: upload the full PDF plan set including floor plan <span className="font-semibold">and</span> elevation drawings — AI reads heights from the elevations. Floor plan only = default heights (2.7 m).</>
                )}
              </p>
            </div>
          )}
          <input
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={onFileChange}
            disabled={loading}
          />
        </label>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        <p className="text-center mt-6 text-sm text-gray-400">
          {mode === 'site' ? (
            <>
              No site plan?{' '}
              <button
                className="text-orange-500 hover:underline font-medium"
                onClick={() => {
                  sessionStorage.removeItem('siteData');
                  sessionStorage.removeItem('imageDataUrl');
                  router.push('/site-review');
                }}
              >
                Start with a blank site
              </button>
            </>
          ) : (
            <>
              No plans yet?{' '}
              <button
                className="text-orange-500 hover:underline font-medium"
                onClick={() => {
                  sessionStorage.removeItem('analyzedBuilding');
                  router.push('/review');
                }}
              >
                Enter dimensions manually
              </button>
            </>
          )}
        </p>
      </div>
    </main>
  );
}

function ModeBtn({ label, active, onClick, disabled }: {
  label: string; active: boolean; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-sm font-semibold px-5 py-2 rounded-full transition-colors ${
        active ? 'bg-orange-500 text-white shadow' : 'text-gray-500 hover:text-gray-800'
      } disabled:opacity-60`}
    >
      {label}
    </button>
  );
}
