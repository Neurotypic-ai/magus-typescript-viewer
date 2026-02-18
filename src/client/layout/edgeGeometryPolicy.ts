export interface EdgeGeometryPoint {
  x: number;
  y: number;
}

export type EdgeHandleSide = 'top' | 'right' | 'bottom' | 'left';

export interface EdgePolylineOptions {
  sourceHandle?: string | null;
  targetHandle?: string | null;
  sourceNodeType?: string;
  targetNodeType?: string;
}

export interface EdgeLineSegment {
  start: EdgeGeometryPoint;
  end: EdgeGeometryPoint;
}

export interface RoundedPolylineSegment {
  kind: 'line' | 'quadratic';
  to: EdgeGeometryPoint;
  control?: EdgeGeometryPoint;
}

export interface RoundedPolylinePath {
  start: EdgeGeometryPoint;
  segments: RoundedPolylineSegment[];
}

// Single source of truth for arrow-driven geometry.
export const EDGE_ARROW_SIZE_PX: number = 12;
export const EDGE_MARKER_WIDTH_PX: number = EDGE_ARROW_SIZE_PX;
export const EDGE_MARKER_HEIGHT_PX: number = EDGE_ARROW_SIZE_PX;
export const DEFAULT_CANVAS_EDGE_CORNER_RADIUS_PX: number = 10;

export const GROUP_EXCLUSION_ZONE_PX: number = EDGE_ARROW_SIZE_PX * 4;
export const GROUP_ENTRY_STUB_PX: number = EDGE_ARROW_SIZE_PX;
export const NODE_PRE_APPROACH_STUB_PX: number = EDGE_ARROW_SIZE_PX;
export const NODE_FINAL_APPROACH_PX: number = EDGE_ARROW_SIZE_PX * 2;

const FOLDER_HANDLE_SIDE_PATTERN = /^folder-(top|right|bottom|left)-(?:in|out)(?:-inner)?$/;
const RELATIONAL_SIDE_HANDLE_PATTERN = /^relational-(?:in|out)-(top|right|bottom|left)$/;

const SIDE_NORMALS: Record<EdgeHandleSide, EdgeGeometryPoint> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const EPSILON = 0.001;

/** Returns `true` when the side corresponds to a horizontal (left/right) exit or entry. */
export const isHorizontalSide = (side: EdgeHandleSide): boolean => side === 'left' || side === 'right';

const isGroupNode = (nodeType: string | undefined): boolean => nodeType === 'group';

const offsetPoint = (point: EdgeGeometryPoint, normal: EdgeGeometryPoint, distance: number): EdgeGeometryPoint => ({
  x: point.x + normal.x * distance,
  y: point.y + normal.y * distance,
});

export const pointsEqual = (a: EdgeGeometryPoint, b: EdgeGeometryPoint): boolean =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;

/**
 * Infer the best handle side (exit/entry direction) from the relative
 * positions of two points.  When `getHandleSide` cannot determine a
 * direction from the handle id, this provides a reasonable geometric
 * fallback: the dominant axis of the vector from `from` to `to` decides
 * the side.  Ties go to the horizontal axis.
 */
export function inferHandleSide(from: EdgeGeometryPoint, to: EdgeGeometryPoint): EdgeHandleSide {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

export function getHandleSide(handleId: string | null | undefined): EdgeHandleSide | undefined {
  if (!handleId) return undefined;

  /* eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- .exec blocked by project hook */
  const folderMatch = handleId.match(FOLDER_HANDLE_SIDE_PATTERN);
  if (folderMatch) return folderMatch[1] as EdgeHandleSide;

  /* eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- .exec blocked by project hook */
  const relationalMatch = handleId.match(RELATIONAL_SIDE_HANDLE_PATTERN);
  if (relationalMatch) return relationalMatch[1] as EdgeHandleSide;

  return undefined;
}

export function buildEdgePolyline(
  sourcePoint: EdgeGeometryPoint,
  targetPoint: EdgeGeometryPoint,
  options: EdgePolylineOptions = {}
): EdgeGeometryPoint[] {
  const sourceSide =
    getHandleSide(options.sourceHandle) ?? inferHandleSide(sourcePoint, targetPoint);
  const targetSide =
    getHandleSide(options.targetHandle) ?? inferHandleSide(targetPoint, sourcePoint);

  const points: EdgeGeometryPoint[] = [{ x: sourcePoint.x, y: sourcePoint.y }];

  // -- Source-side stub --
  const sourceNormal = SIDE_NORMALS[sourceSide];
  if (isGroupNode(options.sourceNodeType)) {
    points.push(offsetPoint(sourcePoint, sourceNormal, GROUP_ENTRY_STUB_PX));
  } else {
    points.push(
      offsetPoint(sourcePoint, sourceNormal, NODE_PRE_APPROACH_STUB_PX + NODE_FINAL_APPROACH_PX)
    );
  }

  // -- Target-side stubs --
  const targetNormal = SIDE_NORMALS[targetSide];
  if (isGroupNode(options.targetNodeType)) {
    points.push(offsetPoint(targetPoint, targetNormal, GROUP_ENTRY_STUB_PX));
  } else {
    points.push(
      offsetPoint(targetPoint, targetNormal, NODE_PRE_APPROACH_STUB_PX + NODE_FINAL_APPROACH_PX),
      offsetPoint(targetPoint, targetNormal, NODE_FINAL_APPROACH_PX)
    );
  }

  points.push({ x: targetPoint.x, y: targetPoint.y });

  // -- Insert orthogonal waypoints between source and target stubs --
  insertOrthogonalMidpoints(points, sourceSide, targetSide);

  // -- Deduplicate --
  const deduped: EdgeGeometryPoint[] = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || !pointsEqual(previous, point)) {
      deduped.push(point);
    }
  }
  return deduped;
}

/**
 * Inserts orthogonal waypoints into the polyline so that `buildRoundedPolylinePath`
 * always has intermediate corners to round. The function modifies `points` in-place.
 *
 * After source and target stubs have been added to the polyline the "free" segment
 * between the last source-side point and the first target-side point may still be a
 * straight diagonal. This function detects that case and inserts either:
 *
 * - **L-shape** (1 midpoint): when source exits on one axis and target enters on the
 *   perpendicular axis.
 * - **S-shape** (2 midpoints): when source and target share the same axis, creating a
 *   dogleg through the midline.
 *
 * If the free segment is already axis-aligned no points are inserted.
 */
export function insertOrthogonalMidpoints(
  points: EdgeGeometryPoint[],
  sourceExit: EdgeHandleSide,
  targetEntry: EdgeHandleSide
): void {
  if (points.length < 2) return;

  // Walk forward from the start to find the end of source-direction stubs.
  const sourceHorizontal = isHorizontalSide(sourceExit);
  let freeStartIdx = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (prev === undefined || curr === undefined) break;
    const onAxis = sourceHorizontal ? Math.abs(curr.y - prev.y) <= EPSILON : Math.abs(curr.x - prev.x) <= EPSILON;
    if (onAxis) {
      freeStartIdx = i;
    } else {
      break;
    }
  }

  // Walk backward from the end to find the start of target-direction stubs.
  const targetHorizontal = isHorizontalSide(targetEntry);
  let freeEndIdx = points.length - 1;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const curr = points[i];
    const next = points[i + 1];
    if (curr === undefined || next === undefined) break;
    const onAxis = targetHorizontal ? Math.abs(curr.y - next.y) <= EPSILON : Math.abs(curr.x - next.x) <= EPSILON;
    if (onAxis) {
      freeEndIdx = i;
    } else {
      break;
    }
  }

  // If the walks overlap or meet there is no free segment to route.
  if (freeStartIdx >= freeEndIdx) return;

  const freeStart = points[freeStartIdx];
  const freeEnd = points[freeEndIdx];
  if (freeStart === undefined || freeEnd === undefined) return;

  // Already axis-aligned — nothing to do.
  const dx = Math.abs(freeEnd.x - freeStart.x);
  const dy = Math.abs(freeEnd.y - freeStart.y);
  if (dx <= EPSILON || dy <= EPSILON) return;

  const midpoints: EdgeGeometryPoint[] = [];

  if (sourceHorizontal !== targetHorizontal) {
    // L-shape: one corner midpoint where the two axes intersect.
    if (sourceHorizontal) {
      midpoints.push({ x: freeEnd.x, y: freeStart.y });
    } else {
      midpoints.push({ x: freeStart.x, y: freeEnd.y });
    }
  } else {
    // S-shape: two midpoints creating a dogleg through the midline.
    if (sourceHorizontal) {
      const midX = (freeStart.x + freeEnd.x) / 2;
      midpoints.push({ x: midX, y: freeStart.y }, { x: midX, y: freeEnd.y });
    } else {
      const midY = (freeStart.y + freeEnd.y) / 2;
      midpoints.push({ x: freeStart.x, y: midY }, { x: freeEnd.x, y: midY });
    }
  }

  // Replace any existing intermediate points with the new orthogonal waypoints.
  points.splice(freeStartIdx + 1, freeEndIdx - freeStartIdx - 1, ...midpoints);
}

export function toLineSegments(polyline: EdgeGeometryPoint[]): EdgeLineSegment[] {
  const segments: EdgeLineSegment[] = [];
  for (let i = 0; i < polyline.length - 1; i += 1) {
    const start = polyline[i];
    const end = polyline[i + 1];
    if (start !== undefined && end !== undefined && !pointsEqual(start, end)) {
      segments.push({ start, end });
    }
  }
  return segments;
}

const normalizePoint = (point: EdgeGeometryPoint): EdgeGeometryPoint => ({ x: point.x, y: point.y });

export function buildRoundedPolylinePath(
  polyline: EdgeGeometryPoint[],
  cornerRadius: number
): RoundedPolylinePath | null {
  if (polyline.length === 0) {
    return null;
  }

  const first = polyline[0];
  if (first === undefined) return null;
  const start = normalizePoint(first);
  const segments: RoundedPolylineSegment[] = [];
  const normalizedRadius = Number.isFinite(cornerRadius) ? Math.max(0, cornerRadius) : 0;

  const getTailPoint = (): EdgeGeometryPoint => {
    const tail = segments[segments.length - 1];
    return tail ? tail.to : start;
  };

  const pushLine = (target: EdgeGeometryPoint): void => {
    const tail = getTailPoint();
    if (!pointsEqual(tail, target)) {
      segments.push({ kind: 'line', to: normalizePoint(target) });
    }
  };

  if (polyline.length === 1 || normalizedRadius <= EPSILON) {
    for (let i = 1; i < polyline.length; i += 1) {
      const point = polyline[i];
      if (point) {
        pushLine(point);
      }
    }
    return { start, segments };
  }

  for (let i = 1; i < polyline.length - 1; i += 1) {
    const previous = polyline[i - 1];
    const corner = polyline[i];
    const next = polyline[i + 1];
    if (!previous || !corner || !next) {
      continue;
    }

    const incomingX = corner.x - previous.x;
    const incomingY = corner.y - previous.y;
    const outgoingX = next.x - corner.x;
    const outgoingY = next.y - corner.y;
    const incomingLength = Math.hypot(incomingX, incomingY);
    const outgoingLength = Math.hypot(outgoingX, outgoingY);
    if (incomingLength <= EPSILON || outgoingLength <= EPSILON) {
      pushLine(corner);
      continue;
    }

    const incomingUnitX = incomingX / incomingLength;
    const incomingUnitY = incomingY / incomingLength;
    const outgoingUnitX = outgoingX / outgoingLength;
    const outgoingUnitY = outgoingY / outgoingLength;

    const cross = incomingUnitX * outgoingUnitY - incomingUnitY * outgoingUnitX;
    if (Math.abs(cross) <= EPSILON) {
      pushLine(corner);
      continue;
    }

    const effectiveRadius = Math.min(normalizedRadius, incomingLength / 2, outgoingLength / 2);
    if (effectiveRadius <= EPSILON) {
      pushLine(corner);
      continue;
    }

    const cornerEntry = {
      x: corner.x - incomingUnitX * effectiveRadius,
      y: corner.y - incomingUnitY * effectiveRadius,
    };
    const cornerExit = {
      x: corner.x + outgoingUnitX * effectiveRadius,
      y: corner.y + outgoingUnitY * effectiveRadius,
    };

    pushLine(cornerEntry);
    segments.push({
      kind: 'quadratic',
      control: normalizePoint(corner),
      to: normalizePoint(cornerExit),
    });
  }

  const finalPoint = polyline[polyline.length - 1];
  if (finalPoint) {
    pushLine(finalPoint);
  }

  return { start, segments };
}
