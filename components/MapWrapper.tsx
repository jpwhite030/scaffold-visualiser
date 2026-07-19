'use client';

import dynamic from 'next/dynamic';

// Leaflet touches `window` on import — client-only, same pattern as ViewerWrapper.
const MapClient = dynamic(() => import('./MapClient'), { ssr: false });

export default function MapWrapper() {
  return (
    <div className="w-screen h-screen bg-gray-100">
      <MapClient />
    </div>
  );
}
