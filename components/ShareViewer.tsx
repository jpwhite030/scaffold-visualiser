'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { BuildingData } from '@/lib/buildingTypes';

const ViewerClient = dynamic(() => import('./ViewerClient'), { ssr: false });

interface SharePayload {
  name: string;
  address: string;
  building: BuildingData;
}

// Client half of the public share link: fetches the job by its token and shows
// the viewer in read-only mode. Deliberately no links back into the app.
export default function ShareViewer({ token }: { token: string }) {
  const [share, setShare] = useState<SharePayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/share/${encodeURIComponent(token)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(d => { if (!cancelled && d?.ok && d.share?.building) setShare(d.share); else if (!cancelled) setFailed(true); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [token]);

  if (failed) {
    return (
      <div className="w-screen h-screen bg-gray-900 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <p className="text-white font-semibold text-lg">This link isn&apos;t available</p>
          <p className="text-gray-400 text-sm mt-2">
            The scaffold model may have been removed. Contact Skelscaff for an updated link.
          </p>
        </div>
      </div>
    );
  }

  if (!share) {
    return (
      <div className="w-screen h-screen bg-gray-900 flex items-center justify-center">
        <p className="text-gray-400 text-sm animate-pulse">Loading scaffold model…</p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-gray-900">
      <ViewerClient
        data={share.building}
        readOnly
        header={{ title: share.name, subtitle: share.address || undefined }}
      />
    </div>
  );
}
