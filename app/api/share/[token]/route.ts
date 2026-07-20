import type { NextRequest } from 'next/server';
import { guard } from '@/lib/apiGuard';
import { readProjects } from '@/lib/projectStore';

// Public lookup for the read-only share link. No same-origin check — the link
// is opened from anywhere (texts, emails) and the 128-bit token IS the access
// control. Returns only what the share page needs: never price, status, client
// phone or the rest of the job book.
export const maxDuration = 15;

export async function GET(request: NextRequest, ctx: RouteContext<'/api/share/[token]'>) {
  const blocked = guard(request, { limit: 30, windowMs: 60_000, requireSameOrigin: false });
  if (blocked) return blocked;

  const { token } = await ctx.params;
  if (!token || !/^[a-f0-9]{32}$/.test(token)) {
    return Response.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  const projects = await readProjects();
  const project = projects.find(p => p.shareToken === token);
  if (!project || !project.building) {
    return Response.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  return Response.json({
    ok: true,
    share: {
      name: project.name,
      address: [project.address, project.suburb].filter(Boolean).join(', '),
      building: project.building,
    },
  });
}
