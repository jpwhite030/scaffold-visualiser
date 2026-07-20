import { randomBytes } from 'crypto';
import type { NextRequest } from 'next/server';
import { guard } from '@/lib/apiGuard';
import { Project, isProjectStatus } from '@/lib/projects';
import { readProjects, writeProjects, nextProjectId } from '@/lib/projectStore';

// CRUD for the jobs shown on the live map. Same-origin + rate-limited like the
// other API routes; storage backend is handled by lib/projectStore.
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const blocked = guard(request, { limit: 60, windowMs: 60_000 });
  if (blocked) return blocked;

  const projects = await readProjects();
  return Response.json({ ok: true, projects });
}

interface SavePayload {
  project?: Partial<Project>;
}

export async function POST(request: NextRequest) {
  const blocked = guard(request, { limit: 20, windowMs: 60_000 });
  if (blocked) return blocked;

  let payload: SavePayload;
  try {
    payload = (await request.json()) as SavePayload;
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const p = payload.project;
  if (!p || typeof p !== 'object') {
    return Response.json({ ok: false, error: 'Missing project.' }, { status: 400 });
  }
  if (!p.name || typeof p.name !== 'string' || !p.name.trim()) {
    return Response.json({ ok: false, error: 'Project name is required.' }, { status: 400 });
  }
  if (typeof p.lat !== 'number' || typeof p.lng !== 'number' ||
      !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    return Response.json({ ok: false, error: 'Valid lat/lng are required.' }, { status: 400 });
  }
  if (!isProjectStatus(p.status)) {
    return Response.json({ ok: false, error: 'Invalid status.' }, { status: 400 });
  }

  const projects = await readProjects();
  const existingIdx = p.id ? projects.findIndex(x => x.id === p.id) : -1;

  // Share tokens are always server-minted (never taken from the payload) and
  // survive edits. Any project with a 3D snapshot gets one, so "Share" on the
  // map just copies the link.
  const building = p.building ?? (existingIdx >= 0 ? projects[existingIdx].building : undefined);
  const shareToken =
    (existingIdx >= 0 ? projects[existingIdx].shareToken : undefined) ??
    (building ? randomBytes(16).toString('hex') : undefined);

  const saved: Project = {
    id: existingIdx >= 0 ? p.id! : nextProjectId(projects),
    name: p.name.trim(),
    client: typeof p.client === 'string' ? p.client.trim() : '',
    address: typeof p.address === 'string' ? p.address.trim() : '',
    suburb: typeof p.suburb === 'string' ? p.suburb.trim() : '',
    state: typeof p.state === 'string' ? p.state.trim() : 'NSW',
    postcode: typeof p.postcode === 'string' ? p.postcode.trim() : '',
    lat: p.lat,
    lng: p.lng,
    price: typeof p.price === 'number' && Number.isFinite(p.price) && p.price >= 0 ? Math.round(p.price) : 0,
    status: p.status,
    createdAt: existingIdx >= 0 ? projects[existingIdx].createdAt : new Date().toISOString(),
    ...(building ? { building } : {}),
    ...(shareToken ? { shareToken } : {}),
  };

  if (existingIdx >= 0) projects[existingIdx] = saved;
  else projects.push(saved);

  await writeProjects(projects);
  return Response.json({ ok: true, project: saved });
}

export async function DELETE(request: NextRequest) {
  const blocked = guard(request, { limit: 20, windowMs: 60_000 });
  if (blocked) return blocked;

  const id = request.nextUrl.searchParams.get('id');
  if (!id) return Response.json({ ok: false, error: 'Missing id.' }, { status: 400 });

  const projects = await readProjects();
  const remaining = projects.filter(p => p.id !== id);
  if (remaining.length === projects.length) {
    return Response.json({ ok: false, error: 'Not found.' }, { status: 404 });
  }

  await writeProjects(remaining);
  return Response.json({ ok: true });
}
