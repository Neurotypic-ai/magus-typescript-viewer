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

// Single source of truth for arrow-driven geometry.
export const EDGE_ARROW_SIZE_PX = 12;
export const EDGE_MARKER_WIDTH_PX = EDGE_ARROW_SIZE_PX;
export const EDGE_MARKER_HEIGHT_PX = EDGE_ARROW_SIZE_PX;

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

  const folderMatch = handleId.match(FOLDER_HANDLE_SIDE_PATTERN);
  if (folderMatch) return folderMatch[1] as EdgeHandleSide;

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
    const start = polyline[i]!;
    const end = polyline[i + 1]!;
    if (!pointsEqual(start, end)) {
      segments.push({ start, end });
    }
  }
  return segments;
}
