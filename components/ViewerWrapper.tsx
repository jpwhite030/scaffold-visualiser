'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { BuildingData, DEFAULT_BUILDING } from '@/lib/buildingTypes';

const ViewerClient = dynamic(() => import('./ViewerClient'), { ssr: false });

export default function ViewerWrapper() {
  const [data, setData] = useState<BuildingData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('buildingData');
    setData(raw ? JSON.parse(raw) : DEFAULT_BUILDING);
  }, []);

  if (!data) return <div className="w-screen h-screen bg-gray-900" />;

  return (
    <div className="w-screen h-screen bg-gray-900">
      <ViewerClient data={data} />
    </div>
  );
}
