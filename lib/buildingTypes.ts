export type ShapeType   = 'rectangle' | 'l-shape';
export type NotchCorner = 'front-left' | 'front-right' | 'back-left' | 'back-right';
export type RoofType    = 'gable' | 'hip' | 'flat';

export interface BuildingData {
  // Shape — human-readable, directly editable on review page
  shape: ShapeType;
  overall_width_m: number;    // total exterior width  (X axis, horizontal in plan)
  overall_depth_m: number;    // total exterior depth  (Z axis, vertical in plan)
  notch_corner: NotchCorner | 'none';
  notch_width_m: number;      // 0 for rectangle
  notch_depth_m: number;      // 0 for rectangle

  // Heights & roof
  wall_height_m: number;
  num_stories: number;
  roof_type: RoofType;
  roof_pitch_degrees: number;
  eave_height_m: number;

  // Exterior footprint polygon in XZ world coords (CCW)
  footprint: [number, number][];

  // Eave height per footprint face (edge i → i+1), same length as footprint.
  // If absent, eave_height_m is used for all faces.
  face_eave_heights?: number[];

  // Which faces are gable ends — scaffold steps up 500 mm toward the ridge.
  // Same indexing as face_eave_heights. False/absent = eave side (uniform height).
  gable_faces?: boolean[];

  // Access method for the scaffold tower at corner 0. Default 'stair'.
  access_type?: 'stair' | 'ladder';

  // Top-deck protection. 'roof_catch' = 1 m below roof + 4 rails (default);
  // 'edge_protection' = 2 m below roof + 2 rails.
  protection_type?: 'roof_catch' | 'edge_protection';
}

export const DEFAULT_BUILDING: BuildingData = {
  shape: 'rectangle',
  overall_width_m: 16,
  overall_depth_m: 11,
  notch_corner: 'none',
  notch_width_m: 0,
  notch_depth_m: 0,
  wall_height_m: 2.7,
  num_stories: 1,
  roof_type: 'gable',
  roof_pitch_degrees: 22,
  eave_height_m: 2.7,
  access_type: 'stair',
  protection_type: 'roof_catch',
  footprint: [[-8, -5.5], [8, -5.5], [8, 5.5], [-8, 5.5]],
};

/**
 * Build a CCW footprint polygon in XZ world coordinates from the shape description.
 * All six L-shape variants are verified CCW (positive shoelace area).
 */
export function computeFootprint(d: BuildingData): [number, number][] {
  const hw = d.overall_width_m / 2;
  const hd = d.overall_depth_m / 2;
  const nw = Math.min(d.notch_width_m,  d.overall_width_m * 0.9);
  const nd = Math.min(d.notch_depth_m,  d.overall_depth_m * 0.9);

  if (d.shape === 'rectangle' || d.notch_corner === 'none' || nw <= 0 || nd <= 0) {
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
  }

  // Each variant starts at a different corner to ensure CCW winding
  switch (d.notch_corner) {
    case 'back-left':   // bottom-left corner missing
      return [[-hw+nw,-hd],[hw,-hd],[hw,hd],[-hw,hd],[-hw,-hd+nd],[-hw+nw,-hd+nd]];
    case 'back-right':  // bottom-right corner missing
      return [[-hw,-hd],[hw-nw,-hd],[hw-nw,-hd+nd],[hw,-hd+nd],[hw,hd],[-hw,hd]];
    case 'front-left':  // top-left corner missing
      return [[-hw,-hd],[hw,-hd],[hw,hd],[-hw+nw,hd],[-hw+nw,hd-nd],[-hw,hd-nd]];
    case 'front-right': // top-right corner missing
      return [[-hw,-hd],[hw,-hd],[hw,hd-nd],[hw-nw,hd-nd],[hw-nw,hd],[-hw,hd]];
    default:
      return [[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]];
  }
}

/**
 * Uniformly scale a building — the calibration control in the viewer. Keeps
 * proportions (unlike the review page's independent width/depth stretch) so a
 * traced plan that's 10% off comes right without distorting the shape. Heights
 * are usually known from elevations, so they only scale when asked.
 */
export function scaleBuilding(d: BuildingData, factor: number, includeHeights = false): BuildingData {
  const f = Math.min(4, Math.max(0.25, factor));
  if (f === 1) return d;
  const scaled: BuildingData = {
    ...d,
    overall_width_m: d.overall_width_m * f,
    overall_depth_m: d.overall_depth_m * f,
    notch_width_m: d.notch_width_m * f,
    notch_depth_m: d.notch_depth_m * f,
    footprint: d.footprint.map(([x, z]) => [x * f, z * f] as [number, number]),
  };
  if (includeHeights) {
    scaled.wall_height_m = d.wall_height_m * f;
    scaled.eave_height_m = d.eave_height_m * f;
    if (d.face_eave_heights) scaled.face_eave_heights = d.face_eave_heights.map(h => h * f);
  }
  return scaled;
}

export function footprintBounds(pts: [number, number][]) {
  const xs = pts.map(p => p[0]);
  const zs = pts.map(p => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

// Legacy shims so old import paths don't break
export function ensureCCW(pts: [number, number][]): [number, number][] {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return area < 0 ? [...pts].reverse() : pts;
}
export const ensureCW = ensureCCW;

export function centerFootprint(pts: [number, number][]): [number, number][] {
  if (!pts.length) return pts;
  const xs = pts.map(p => p[0]);
  const zs = pts.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  return pts.map(([x, z]) => [x - cx, z - cz]);
}
