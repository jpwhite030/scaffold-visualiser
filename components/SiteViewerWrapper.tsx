'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { SiteData, DEFAULT_SITE } from '@/lib/siteTypes';

const SiteViewerClient = dynamic(() => import('./SiteViewerClient'), { ssr: false });

export default function SiteViewerWrapper() {
  const [site, setSite] = useState<SiteData | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem('siteData');
    setSite(raw ? JSON.parse(raw) : DEFAULT_SITE);
  }, []);

  if (!site) return <div className="w-screen h-screen bg-gray-900" />;

  return (
    <div className="w-screen h-screen bg-gray-900">
      <SiteViewerClient site={site} />
    </div>
  );
}
