import { BuildingData, footprintBounds } from './buildingTypes';

export type SiteBuildingKind = 'house' | 'garage' | 'granny_flat' | 'shed';
export type SurfaceKind = 'driveway' | 'path' | 'pool';

export interface SiteBuilding {
  id: string;
  kind: SiteBuildingKind;
  label: string;
  scaffold_enabled: boolean;
  // Footprint lives in SITE coordinates (shared frame, boundary centred at
  // origin). Heights/roof/access/protection are the usual BuildingData fields.
  data: BuildingData;
}

export interface SiteSurface {
  id: string;
  kind: SurfaceKind;
  polygon: [number, number][]; // site coords, CCW
}

export interface SiteData {
  boundary: [number, number][]; // lot boundary, site coords, CCW, centred at origin
  site_width_m: number;         // boundary bbox — drives the editor's world scale
  site_depth_m: number;
  buildings: SiteBuilding[];
  surfaces: SiteSurface[];
  trees?: [number, number][];   // optional point extras
}

export function siteUid(): string {
  return Math.random().toString(36).slice(2, 9);
}

export const BUILDING_KIND_LABELS: Record<SiteBuildingKind, string> = {
  house: 'House',
  garage: 'Garage',
  granny_flat: 'Granny flat',
  shed: 'Shed',
};

export const SURFACE_KIND_LABELS: Record<SurfaceKind, string> = {
  driveway: 'Driveway',
  path: 'Path',
  pool: 'Pool',
};

// Site plans don't show heights — per-kind defaults, all editable in review.
const KIND_DEFAULTS: Record<SiteBuildingKind, { wall: number; size: [number, number] }> = {
  house:       { wall: 2.7, size: [12, 9] },
  garage:      { wall: 2.4, size: [6, 6] },
  granny_flat: { wall: 2.7, size: [8, 7] },
  shed:        { wall: 2.4, size: [4, 4] },
};

export function newSiteBuilding(kind: SiteBuildingKind, at: [number, number] = [0, 0]): SiteBuilding {
  const { wall, size } = KIND_DEFAULTS[kind];
  const [w, d] = size;
  const [cx, cz] = at;
  const footprint: [number, number][] = [
    [cx - w / 2, cz - d / 2],
    [cx + w / 2, cz - d / 2],
    [cx + w / 2, cz + d / 2],
    [cx - w / 2, cz + d / 2],
  ];
  return {
    id: siteUid(),
    kind,
    label: BUILDING_KIND_LABELS[kind],
    scaffold_enabled: kind === 'house',
    data: {
      shape: 'rectangle',
      overall_width_m: w,
      overall_depth_m: d,
      notch_corner: 'none',
      notch_width_m: 0,
      notch_depth_m: 0,
      wall_height_m: wall,
      num_stories: 1,
      roof_type: 'gable',
      roof_pitch_degrees: 22,
      eave_height_m: wall,
      face_eave_heights: [wall, wall, wall, wall],
      gable_faces: [false, false, false, false],
      access_type: 'stair',
      protection_type: 'roof_catch',
      footprint,
    },
  };
}

export const DEFAULT_SITE: SiteData = {
  boundary: [[-10, -16], [10, -16], [10, 16], [-10, 16]],
  site_width_m: 20,
  site_depth_m: 32,
  buildings: [
    { ...newSiteBuilding('house', [-2, -4]) },
    { ...newSiteBuilding('garage', [5.5, 9]) },
  ],
  surfaces: [
    { id: siteUid(), kind: 'driveway', polygon: [[4, -16], [7, -16], [7, 6], [4, 6]] },
  ],
  trees: [[-7, 13], [8, -12], [-8, -13]],
};

/**
 * Local frame for rendering one site building with the (axis-aligned)
 * HouseModel/ScaffoldModel: rotate the footprint so its longest edge lies
 * along X, centred at the world-bbox centre. Render inside
 * `<group position={[center[0], 0, center[1]]} rotation={[0, angleRad, 0]}>`.
 * Point order is preserved, so face_eave_heights / gable_faces indices stay valid.
 */
export function buildingLocalFrame(footprint: [number, number][]): {
  center: [number, number];
  angleRad: number;
  localFootprint: [number, number][];
} {
  const b = footprintBounds(footprint);
  const center: [number, number] = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2];

  // Orientation of the longest edge, snapped to the nearest quarter-turn so a
  // near-axis-aligned building keeps zero rotation (width stays width).
  let bestLen = 0;
  let alpha = 0;
  for (let i = 0; i < footprint.length; i++) {
    const [x1, z1] = footprint[i];
    const [x2, z2] = footprint[(i + 1) % footprint.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len > bestLen) {
      bestLen = len;
      alpha = Math.atan2(z2 - z1, x2 - x1);
    }
  }
  const quarter = Math.PI / 2;
  const snapped = alpha - Math.round(alpha / quarter) * quarter;
  // group.rotation.y = angleRad maps local +X back onto the edge's world direction
  const angleRad = Math.abs(snapped) < 0.005 ? 0 : -snapped;

  if (angleRad === 0) {
    return {
      center,
      angleRad,
      localFootprint: footprint.map(([x, z]) => [x - center[0], z - center[1]] as [number, number]),
    };
  }

  // local = R_y(-angleRad) · (world - center)
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const localFootprint = footprint.map(([x, z]) => {
    const dx = x - center[0];
    const dz = z - center[1];
    return [c * dx - s * dz, s * dx + c * dz] as [number, number];
  });
  return { center, angleRad, localFootprint };
}

/** Translate the whole site so the boundary bbox centre sits at the origin. */
export function centerSite(site: SiteData): SiteData {
  const b = footprintBounds(site.boundary);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  if (Math.abs(cx) < 0.001 && Math.abs(cz) < 0.001) return site;
  const shift = (pts: [number, number][]) =>
    pts.map(([x, z]) => [x - cx, z - cz] as [number, number]);
  return {
    ...site,
    boundary: shift(site.boundary),
    buildings: site.buildings.map(bd => ({
      ...bd,
      data: { ...bd.data, footprint: shift(bd.data.footprint) },
    })),
    surfaces: site.surfaces.map(sf => ({ ...sf, polygon: shift(sf.polygon) })),
    trees: site.trees ? shift(site.trees) : undefined,
  };
}

/** Rescale every polygon about the origin when the user corrects the lot dimensions. */
export function scaleSite(site: SiteData, newW: number, newD: number): SiteData {
  const b = footprintBounds(site.boundary);
  const curW = b.maxX - b.minX;
  const curD = b.maxZ - b.minZ;
  if (curW < 0.01 || curD < 0.01) return site;
  const fx = newW / curW;
  const fz = newD / curD;
  const scale = (pts: [number, number][]) =>
    pts.map(([x, z]) => [x * fx, z * fz] as [number, number]);
  return {
    ...site,
    site_width_m: newW,
    site_depth_m: newD,
    boundary: scale(site.boundary),
    buildings: site.buildings.map(bd => ({
      ...bd,
      data: { ...bd.data, footprint: scale(bd.data.footprint) },
    })),
    surfaces: site.surfaces.map(sf => ({ ...sf, polygon: scale(sf.polygon) })),
    trees: site.trees ? scale(site.trees) : undefined,
  };
}

/**
 * Apply a new footprint to a building, padding/trimming face_eave_heights and
 * gable_faces to match the new corner count (same rule the review page uses).
 */
export function syncFaceArrays(bd: BuildingData, fp: [number, number][]): BuildingData {
  const n = fp.length;
  const existing = bd.face_eave_heights ?? [];
  const synced = n > existing.length
    ? [...existing, ...Array(n - existing.length).fill(bd.eave_height_m)]
    : existing.slice(0, n);
  const existingG = bd.gable_faces ?? [];
  const syncedG = n > existingG.length
    ? [...existingG, ...Array(n - existingG.length).fill(false)]
    : existingG.slice(0, n);
  // scaffold_faces stays absent (= full wrap) until the user first toggles a side.
  const existingS = bd.scaffold_faces;
  const syncedS = existingS
    ? (n > existingS.length
        ? [...existingS, ...Array(n - existingS.length).fill(true)]
        : existingS.slice(0, n))
    : undefined;
  return {
    ...bd, footprint: fp, face_eave_heights: synced, gable_faces: syncedG,
    ...(syncedS ? { scaffold_faces: syncedS } : {}),
  };
}
