import type { Metadata } from 'next';
import ShareViewer from '@/components/ShareViewer';

// Public read-only 3D link — no nav into the app, no pricing, just the model.
export const metadata: Metadata = {
  title: 'Scaffold model — Skelscaff',
  description: 'Interactive 3D scaffold model prepared by Skelscaff.',
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }: PageProps<'/share/[token]'>) {
  const { token } = await params;
  return <ShareViewer token={token} />;
}
