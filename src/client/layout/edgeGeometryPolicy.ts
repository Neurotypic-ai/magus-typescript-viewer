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
export const EDGE_ARROW_SIZE_PX = 12;
export const EDGE_MARKER_WIDTH_PX = EDGE_ARROW_SIZE_PX;
export const EDGE_MARKER_HEIGHT_PX = EDGE_ARROW_SIZE_PX;
export const DEFAULT_CANVAS_EDGE_CORNER_RADIUS_PX = 10;

export const GROUP_EXCLUSION_ZONE_PX = EDGE_ARROW_SIZE_PX * 4;
export const GROUP_ENTRY_STUB_PX = EDGE_ARROW_SIZE_PX;
export const NODE_PRE_APPROACH_STUB_PX = EDGE_ARROW_SIZE_PX;
export const NODE_FINAL_APPROACH_PX = EDGE_ARROW_SIZE_PX * 2;

const FOLDER_HANDLE_SIDE_PATTERN = /^folder-(top|right|bottom|left)-(?:in|out)(?:-inner)?$/;
const RELATIONAL_SIDE_HANDLE_PATTERN = /^relational-(?:in|out)-(top|right|bottom|left)$/;

const SIDE_NORMALS: Record<EdgeHandleSide, EdgeGeometryPoint> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const EPSILON = 0.001;

const isGroupNode = (nodeType: string | undefined): boolean => nodeType === 'group';

const offsetPoint = (
  point: EdgeGeometryPoint,
  normal: EdgeGeometryPoint,
  distance: number
): EdgeGeometryPoint => ({
  x: point.x + normal.x * distance,
  y: point.y + normal.y * distance,
});

export const pointsEqual = (a: EdgeGeometryPoint, b: EdgeGeometryPoint): boolean =>
  Math.abs(a.x - b.x) <= EPSILON && Math.abs(a.y - b.y) <= EPSILON;

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
  const points: EdgeGeometryPoint[] = [{ x: sourcePoint.x, y: sourcePoint.y }];

  const sourceSide = getHandleSide(options.sourceHandle);
  if (sourceSide && isGroupNode(options.sourceNodeType)) {
    points.push(offsetPoint(sourcePoint, SIDE_NORMALS[sourceSide], GROUP_ENTRY_STUB_PX));
  }

  const targetSide = getHandleSide(options.targetHandle);
  if (targetSide) {
    const normal = SIDE_NORMALS[targetSide];
    if (isGroupNode(options.targetNodeType)) {
      points.push(offsetPoint(targetPoint, normal, GROUP_ENTRY_STUB_PX));
    } else {
      points.push(
        offsetPoint(targetPoint, normal, NODE_PRE_APPROACH_STUB_PX + NODE_FINAL_APPROACH_PX),
        offsetPoint(targetPoint, normal, NODE_FINAL_APPROACH_PX)
      );
    }
  }

  points.push({ x: targetPoint.x, y: targetPoint.y });

  const deduped: EdgeGeometryPoint[] = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || !pointsEqual(previous, point)) {
      deduped.push(point);
    }
  }
  return deduped;
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

  const start = normalizePoint(polyline[0]!);
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
