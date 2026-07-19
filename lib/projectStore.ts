import { promises as fs } from 'fs';
import path from 'path';
import { put, list } from '@vercel/blob';
import { Project } from './projects';

// Server-only persistence for projects. Two backends:
//   • Local dev (no BLOB_READ_WRITE_TOKEN): read/write data/projects.json in the
//     repo — the committed file doubles as the seed dataset.
//   • Vercel (token present): a single JSON blob. The filesystem there is
//     read-only, so the committed file is only the first-run seed. Fixed key +
//     allowOverwrite so every save replaces the previous list. access must be
//     'public' — 'private' silently fails to write on this store (see
//     log-correction route) — acceptable here: the app sits behind the login
//     gate and this is demo-grade job data, not credentials.

const LOCAL_FILE = path.join(process.cwd(), 'data', 'projects.json');
const BLOB_KEY = 'projects/projects.json';

async function readSeedFile(): Promise<Project[]> {
  try {
    const raw = await fs.readFile(LOCAL_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Project[]) : [];
  } catch {
    return [];
  }
}

export async function readProjects(): Promise<Project[]> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { blobs } = await list({ prefix: BLOB_KEY, limit: 1 });
      if (blobs.length > 0) {
        const res = await fetch(blobs[0].url, { cache: 'no-store' });
        if (res.ok) {
          const parsed = await res.json();
          if (Array.isArray(parsed)) return parsed as Project[];
        }
      }
    } catch {
      // fall through to the committed seed
    }
  }
  return readSeedFile();
}

export async function writeProjects(projects: Project[]): Promise<void> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await put(BLOB_KEY, JSON.stringify(projects, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
  await fs.writeFile(LOCAL_FILE, JSON.stringify(projects, null, 2) + '\n', 'utf8');
}

export function nextProjectId(projects: Project[]): string {
  const max = projects.reduce((m, p) => {
    const n = Number((p.id ?? '').replace(/\D+/g, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 1000);
  return `PRJ-${max + 1}`;
}
