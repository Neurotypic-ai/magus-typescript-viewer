/**
 * Obstacle-aware orthogonal edge routing via Grid A* pathfinding.
 *
 * Pure function — no Vue, no reactive dependencies, no DOM access.
 * Uses a Uint8Array occupancy grid and binary min-heap priority queue
 * for memory-efficient A* search with direction-preference tie-breaking.
 */

import {
  buildRoundedPolylinePath,
  type EdgeGeometryPoint,
  type RoundedPolylinePath,
} from './edgeGeometryPolicy';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ObstacleRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PathfinderOptions {
  gridResolution?: number;
  obstaclePadding?: number;
  gridMargin?: number;
  cornerRadius?: number;
  maxGridCells?: number;
  maxVisitedCells?: number;
}

export type PathStatus =
  | 'ok'
  | 'invalid-input'
  | 'not-measured'
  | 'no-route'
  | 'grid-cap-exceeded';

export interface ObstacleAwarePathResult {
  path: string | null;
  labelPoint: { x: number; y: number } | null;
  status: PathStatus;
  visitedCells: number;
  gridCellCount: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_GRID_RESOLUTION = 10;
const DEFAULT_OBSTACLE_PADDING = 10;
const DEFAULT_GRID_MARGIN = 36;
const DEFAULT_CORNER_RADIUS = 6;
const DEFAULT_MAX_GRID_CELLS = 12_000;
const DEFAULT_MAX_VISITED_CELLS = 30_000;

// ---------------------------------------------------------------------------
// 4-directional movement (right, down, left, up)
// ---------------------------------------------------------------------------

const DIR_DX = [1, 0, -1, 0] as const;
const DIR_DY = [0, 1, 0, -1] as const;

// ---------------------------------------------------------------------------
// Binary min-heap priority queue
// ---------------------------------------------------------------------------

interface HeapNode {
  index: number; // flat grid index (row * cols + col)
  f: number;
  g: number;
  dir: number; // direction taken to reach this cell (0-3), or -1 for start
}

function heapPush(heap: HeapNode[], node: HeapNode): void {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const parentNode = heap[parent];
    if (parentNode !== undefined && parentNode.f <= node.f) break;
    if (parentNode !== undefined) {
      heap[i] = parentNode;
    }
    i = parent;
  }
  heap[i] = node;
}

function heapPop(heap: HeapNode[]): HeapNode | undefined {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length > 0 && last !== undefined) {
    heap[0] = last;
    let i = 0;
    const length = heap.length;
    for (;;) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      const smallestNode = heap[smallest];
      if (smallestNode === undefined) break;
      if (left < length) {
        const leftNode = heap[left];
        if (leftNode !== undefined && leftNode.f < smallestNode.f) {
          smallest = left;
        }
      }
      const currentSmallest = heap[smallest];
      if (currentSmallest === undefined) break;
      if (right < length) {
        const rightNode = heap[right];
        if (rightNode !== undefined && rightNode.f < currentSmallest.f) {
          smallest = right;
        }
      }
      if (smallest === i) break;
      const swap = heap[smallest];
      if (swap === undefined) break;
      heap[i] = swap;
      heap[smallest] = last;
      i = smallest;
    }
  }
  return top;
}

// ---------------------------------------------------------------------------
// SVG serialization for RoundedPolylinePath
// ---------------------------------------------------------------------------

function roundedPolylineToSvg(rp: RoundedPolylinePath): string {
  let d = 'M ' + String(rp.start.x) + ' ' + String(rp.start.y);
  for (const seg of rp.segments) {
    if (seg.kind === 'quadratic' && seg.control) {
      d += ' Q ' + String(seg.control.x) + ' ' + String(seg.control.y)
        + ' ' + String(seg.to.x) + ' ' + String(seg.to.y);
    } else {
      d += ' L ' + String(seg.to.x) + ' ' + String(seg.to.y);
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Geometry helpers for intersection testing
// ---------------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Test if a line segment from p0 to p1 intersects an axis-aligned rectangle. */
function lineSegmentIntersectsRect(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  rect: Rect
): boolean {
  // Liang-Barsky line clipping
  const xMin = rect.x;
  const xMax = rect.x + rect.w;
  const yMin = rect.y;
  const yMax = rect.y + rect.h;

  let t0 = 0;
  let t1 = 1;
  const dx = p1x - p0x;
  const dy = p1y - p0y;

  const clips = [
    { p: -dx, q: p0x - xMin },
    { p: dx, q: xMax - p0x },
    { p: -dy, q: p0y - yMin },
    { p: dy, q: yMax - p0y },
  ];

  for (const clip of clips) {
    if (Math.abs(clip.p) < 1e-10) {
      if (clip.q < 0) return false;
    } else {
      const r = clip.q / clip.p;
      if (clip.p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1;
}

/**
 * Sample a quadratic Bezier curve and check each segment against a rect.
 * Uses 8 sample segments for a good balance of accuracy and speed.
 */
function quadraticBezierIntersectsRect(
  p0: EdgeGeometryPoint,
  control: EdgeGeometryPoint,
  p1: EdgeGeometryPoint,
  rect: Rect
): boolean {
  const sampleCount = 8;
  let prevX = p0.x;
  let prevY = p0.y;
  for (let i = 1; i <= sampleCount; i++) {
    const t = i / sampleCount;
    const invT = 1 - t;
    const x = invT * invT * p0.x + 2 * invT * t * control.x + t * t * p1.x;
    const y = invT * invT * p0.y + 2 * invT * t * control.y + t * t * p1.y;
    if (lineSegmentIntersectsRect(prevX, prevY, x, y, rect)) {
      return true;
    }
    prevX = x;
    prevY = y;
  }
  return false;
}

/** Check if a RoundedPolylinePath intersects any of the given obstacle rects. */
function pathIntersectsObstacles(
  rp: RoundedPolylinePath,
  obstacles: ObstacleRect[]
): boolean {
  const rects: Rect[] = obstacles.map((o) => ({
    x: o.x,
    y: o.y,
    w: o.width,
    h: o.height,
  }));

  let prevPoint = rp.start;

  for (const seg of rp.segments) {
    for (const rect of rects) {
      if (seg.kind === 'quadratic' && seg.control) {
        if (quadraticBezierIntersectsRect(prevPoint, seg.control, seg.to, rect)) {
          return true;
        }
      } else {
        if (lineSegmentIntersectsRect(prevPoint.x, prevPoint.y, seg.to.x, seg.to.y, rect)) {
          return true;
        }
      }
    }
    prevPoint = seg.to;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main pathfinder
// ---------------------------------------------------------------------------

function makeFailResult(
  status: PathStatus,
  visitedCells = 0,
  gridCellCount = 0
): ObstacleAwarePathResult {
  return { path: null, labelPoint: null, status, visitedCells, gridCellCount };
}

export function findObstacleAwarePath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  obstacles: ObstacleRect[],
  options?: PathfinderOptions
): ObstacleAwarePathResult {
  // -- Resolve options --
  let gridResolution = options?.gridResolution ?? DEFAULT_GRID_RESOLUTION;
  const obstaclePadding = options?.obstaclePadding ?? DEFAULT_OBSTACLE_PADDING;
  const gridMargin = options?.gridMargin ?? DEFAULT_GRID_MARGIN;
  const cornerRadius = options?.cornerRadius ?? DEFAULT_CORNER_RADIUS;
  const maxGridCells = options?.maxGridCells ?? DEFAULT_MAX_GRID_CELLS;
  const maxVisitedCells = options?.maxVisitedCells ?? DEFAULT_MAX_VISITED_CELLS;

  // -- Step 1: Validate inputs --
  if (
    !Number.isFinite(source.x) ||
    !Number.isFinite(source.y) ||
    !Number.isFinite(target.x) ||
    !Number.isFinite(target.y)
  ) {
    return makeFailResult('invalid-input');
  }

  // Source === target is also invalid
  if (source.x === target.x && source.y === target.y) {
    return makeFailResult('invalid-input');
  }

  // -- Step 2: Compute AABB --
  let minX = Math.min(source.x, target.x);
  let minY = Math.min(source.y, target.y);
  let maxX = Math.max(source.x, target.x);
  let maxY = Math.max(source.y, target.y);

  for (const obs of obstacles) {
    minX = Math.min(minX, obs.x);
    minY = Math.min(minY, obs.y);
    maxX = Math.max(maxX, obs.x + obs.width);
    maxY = Math.max(maxY, obs.y + obs.height);
  }

  // Expand by gridMargin
  minX -= gridMargin;
  minY -= gridMargin;
  maxX += gridMargin;
  maxY += gridMargin;

  const aabbWidth = maxX - minX;
  const aabbHeight = maxY - minY;

  // -- Step 3: Estimate grid size --
  let cols = Math.ceil(aabbWidth / gridResolution);
  let rows = Math.ceil(aabbHeight / gridResolution);

  if (rows * cols > maxGridCells) {
    // One coarsening retry: double resolution
    gridResolution *= 2;
    cols = Math.ceil(aabbWidth / gridResolution);
    rows = Math.ceil(aabbHeight / gridResolution);

    if (rows * cols > maxGridCells) {
      return makeFailResult('grid-cap-exceeded', 0, rows * cols);
    }
  }

  const gridCellCount = rows * cols;

  // -- Step 4: Build occupancy grid --
  const grid = new Uint8Array(gridCellCount);

  for (const obs of obstacles) {
    // Inflate obstacle by obstaclePadding
    const oLeft = obs.x - obstaclePadding;
    const oTop = obs.y - obstaclePadding;
    const oRight = obs.x + obs.width + obstaclePadding;
    const oBottom = obs.y + obs.height + obstaclePadding;

    // Convert to grid coordinates
    const colStart = Math.max(0, Math.floor((oLeft - minX) / gridResolution));
    const colEnd = Math.min(cols - 1, Math.floor((oRight - minX) / gridResolution));
    const rowStart = Math.max(0, Math.floor((oTop - minY) / gridResolution));
    const rowEnd = Math.min(rows - 1, Math.floor((oBottom - minY) / gridResolution));

    for (let r = rowStart; r <= rowEnd; r++) {
      for (let c = colStart; c <= colEnd; c++) {
        grid[r * cols + c] = 1;
      }
    }
  }

  // -- Step 5: Force-clear source and target cells --
  const sourceCol = Math.min(cols - 1, Math.max(0, Math.floor((source.x - minX) / gridResolution)));
  const sourceRow = Math.min(rows - 1, Math.max(0, Math.floor((source.y - minY) / gridResolution)));
  const targetCol = Math.min(cols - 1, Math.max(0, Math.floor((target.x - minX) / gridResolution)));
  const targetRow = Math.min(rows - 1, Math.max(0, Math.floor((target.y - minY) / gridResolution)));

  const sourceIndex = sourceRow * cols + sourceCol;
  const targetIndex = targetRow * cols + targetCol;

  grid[sourceIndex] = 0;
  grid[targetIndex] = 0;

  // -- Step 6: A* search --
  const gCost = new Float32Array(gridCellCount);
  gCost.fill(Infinity);

  // cameFrom: stores flat index of parent cell (-1 = no parent)
  const cameFrom = new Int32Array(gridCellCount);
  cameFrom.fill(-1);

  // closed set
  const closed = new Uint8Array(gridCellCount);

  const heuristic = (index: number): number => {
    const r = Math.floor(index / cols);
    const c = index % cols;
    return Math.abs(r - targetRow) + Math.abs(c - targetCol);
  };

  gCost[sourceIndex] = 0;
  const startH = heuristic(sourceIndex);
  const openHeap: HeapNode[] = [];
  heapPush(openHeap, { index: sourceIndex, f: startH, g: 0, dir: -1 });

  let visitedCells = 0;
  let found = false;

  while (openHeap.length > 0) {
    const current = heapPop(openHeap);
    if (current === undefined) break;

    const ci = current.index;

    if (closed[ci] === 1) continue;
    closed[ci] = 1;
    visitedCells++;

    if (ci === targetIndex) {
      found = true;
      break;
    }

    if (visitedCells >= maxVisitedCells) {
      return makeFailResult('no-route', visitedCells, gridCellCount);
    }

    const cr = Math.floor(ci / cols);
    const cc = ci % cols;
    const currentG = gCost[ci] ?? Infinity;
    const currentDir = current.dir;

    for (let d = 0; d < 4; d++) {
      const dirDy = DIR_DY[d];
      const dirDx = DIR_DX[d];
      if (dirDy === undefined || dirDx === undefined) continue;

      const nr = cr + dirDy;
      const nc = cc + dirDx;

      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

      const ni = nr * cols + nc;
      if (closed[ni] === 1 || grid[ni] === 1) continue;

      const tentativeG = currentG + 1;
      const existingG = gCost[ni] ?? Infinity;
      if (tentativeG >= existingG) continue;

      gCost[ni] = tentativeG;
      cameFrom[ni] = ci;

      const h = heuristic(ni);
      let f = tentativeG + h;

      // Direction-preference tie-breaking: add a tiny penalty when changing direction.
      // This produces straighter paths with fewer bends.
      if (currentDir >= 0 && d !== currentDir) {
        f += 0.001;
      }

      heapPush(openHeap, { index: ni, f, g: tentativeG, dir: d });
    }
  }

  if (!found) {
    return makeFailResult('no-route', visitedCells, gridCellCount);
  }

  // -- Reconstruct raw path --
  const rawPath: number[] = [];
  let traceIndex = targetIndex;
  while (traceIndex !== -1) {
    rawPath.push(traceIndex);
    traceIndex = cameFrom[traceIndex] ?? -1;
  }
  rawPath.reverse();

  // -- Step 7: Path simplification (remove collinear intermediate points) --
  const simplified: number[] = [];
  for (let i = 0; i < rawPath.length; i++) {
    const rawCurrent = rawPath[i];
    if (rawCurrent === undefined) continue;

    if (i === 0 || i === rawPath.length - 1) {
      simplified.push(rawCurrent);
      continue;
    }

    const prev = rawPath[i - 1];
    const next = rawPath[i + 1];
    if (prev === undefined || next === undefined) {
      simplified.push(rawCurrent);
      continue;
    }

    const prevR = Math.floor(prev / cols);
    const prevC = prev % cols;
    const currR = Math.floor(rawCurrent / cols);
    const currC = rawCurrent % cols;
    const nextR = Math.floor(next / cols);
    const nextC = next % cols;

    // Keep this point only if direction changes
    const sameRow = prevR === currR && currR === nextR;
    const sameCol = prevC === currC && currC === nextC;
    if (!sameRow && !sameCol) {
      simplified.push(rawCurrent);
    }
  }

  // -- Step 8: Grid-to-world conversion --
  const worldPoints: EdgeGeometryPoint[] = simplified.map((idx, i) => {
    // Force exact endpoints
    if (i === 0) return { x: source.x, y: source.y };
    if (i === simplified.length - 1) return { x: target.x, y: target.y };

    const r = Math.floor(idx / cols);
    const c = idx % cols;
    return {
      x: minX + (c + 0.5) * gridResolution,
      y: minY + (r + 0.5) * gridResolution,
    };
  });

  // -- Step 9 & 10: Corner rounding + SVG serialization --
  const buildAndSerialize = (radius: number): string | null => {
    const rp = buildRoundedPolylinePath(worldPoints, radius);
    if (!rp) return null;

    // -- Step 11: Validate rounded path against non-inflated obstacles --
    if (radius > 0 && pathIntersectsObstacles(rp, obstacles)) {
      // Retry with no rounding
      return null;
    }

    return roundedPolylineToSvg(rp);
  };

  let svgPath = buildAndSerialize(cornerRadius);
  svgPath ??= buildAndSerialize(0);

  if (svgPath === null) {
    // Fallback: build a simple straight-line path string
    const firstPoint = worldPoints[0];
    if (firstPoint) {
      let d = 'M ' + String(firstPoint.x) + ' ' + String(firstPoint.y);
      for (let i = 1; i < worldPoints.length; i++) {
        const pt = worldPoints[i];
        if (pt) {
          d += ' L ' + String(pt.x) + ' ' + String(pt.y);
        }
      }
      svgPath = d;
    }
  }

  // -- Step 12: Compute label point --
  const labelPoint = computeLabelPoint(worldPoints);

  // -- Step 13: Return result --
  return {
    path: svgPath,
    labelPoint,
    status: 'ok',
    visitedCells,
    gridCellCount,
  };
}

// ---------------------------------------------------------------------------
// Label point computation
// ---------------------------------------------------------------------------

function computeLabelPoint(worldPoints: EdgeGeometryPoint[]): { x: number; y: number } {
  if (worldPoints.length === 0) {
    return { x: 0, y: 0 };
  }

  const first = worldPoints[0];
  if (worldPoints.length === 1 || !first) {
    return { x: first?.x ?? 0, y: first?.y ?? 0 };
  }

  // Use the middle waypoint for odd-length paths,
  // or the midpoint of the two center segments for even-length paths
  if (worldPoints.length % 2 === 1) {
    const midIdx = Math.floor(worldPoints.length / 2);
    const mid = worldPoints[midIdx];
    if (mid) return { x: mid.x, y: mid.y };
    return { x: 0, y: 0 };
  }

  const idxA = worldPoints.length / 2 - 1;
  const idxB = worldPoints.length / 2;
  const a = worldPoints[idxA];
  const b = worldPoints[idxB];
  if (a && b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return { x: 0, y: 0 };
}
