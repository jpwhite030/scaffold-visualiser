'use client';

import { useEffect, useState } from 'react';

interface Item { url: string; pathname: string; size: number; uploadedAt: string }

export default function CorrectionsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    fetch('/api/corrections')
      .then(r => r.json())
      .then(d => {
        if (!d.ok) setError(d.reason === 'storage_not_configured' ? 'Blob storage not configured.' : (d.error ?? 'Failed to load.'));
        else setItems(d.items);
      })
      .catch(() => setError('Failed to load.'))
      .finally(() => setLoading(false));
  }, []);

  // Pull every correction's JSON and download them bundled into one file.
  const downloadAll = async () => {
    setDownloading(true);
    try {
      const records = await Promise.all(
        items.map(async it => {
          try { return await (await fetch(it.url)).json(); } catch { return { pathname: it.pathname, error: 'fetch failed' }; }
        })
      );
      const blob = new Blob([JSON.stringify(records, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `corrections-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      setDownloading(false);
    }
  };

  const totalMB = (items.reduce((s, i) => s + i.size, 0) / 1_048_576).toFixed(1);

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Collected Corrections</h1>
        <p className="text-gray-500 text-sm mb-6">
          Every footprint you fix is saved here as training data (plan image + AI&apos;s outline + your corrected outline).
        </p>

        {loading && <p className="text-gray-400">Loading…</p>}
        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>}

        {!loading && !error && (
          <>
            <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4 mb-4">
              <div>
                <div className="text-3xl font-bold text-gray-900">{items.length}</div>
                <div className="text-sm text-gray-500">corrections collected · {totalMB} MB</div>
              </div>
              {items.length > 0 && (
                <button
                  onClick={downloadAll}
                  disabled={downloading}
                  className="bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold px-4 py-2 rounded-lg text-sm"
                >
                  {downloading ? 'Bundling…' : 'Download all (JSON)'}
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <p className="text-gray-400 text-sm">
                None yet. Upload a plan, edit the footprint, and hit Generate — it&apos;ll appear here.
              </p>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
                {items.map(it => (
                  <div key={it.pathname} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-gray-600 truncate mr-3">{it.uploadedAt.slice(0, 19).replace('T', ' ')}</span>
                    <a href={it.url} target="_blank" rel="noreferrer" className="text-orange-500 hover:underline shrink-0">
                      view
                    </a>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
