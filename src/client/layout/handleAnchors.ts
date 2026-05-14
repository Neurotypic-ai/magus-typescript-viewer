import { FOLDER_KIND_Y_OFFSET } from '../graph/handleRouting';

import type { DependencyEdgeKind } from '../../shared/types/graph/DependencyEdgeKind';

interface HandleAnchorNodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Matches: folder-{right|left}-{in|out|stub}[-{kind}]
const FOLDER_HANDLE_PATTERN = /^folder-(right|left)-(in|out|stub)(?:-(\w+))?$/;

export function getHandleAnchor(
  nodeBounds: HandleAnchorNodeBounds,
  handleId: string
): { x: number; y: number } | undefined {
  /* eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- .exec blocked by project hook */
  const folderMatch = handleId.match(FOLDER_HANDLE_PATTERN);
  if (folderMatch) {
    const side = folderMatch[1] as 'right' | 'left';
    const kind = folderMatch[3] as DependencyEdgeKind | undefined;
    const yOffset = kind !== undefined ? (FOLDER_KIND_Y_OFFSET[kind] ?? 0) : 0;
    const y = nodeBounds.y + nodeBounds.height * 0.5 + yOffset;
    if (side === 'left') {
      return { x: nodeBounds.x, y };
    }
    return { x: nodeBounds.x + nodeBounds.width, y };
  }

  if (handleId === 'relational-in') {
    return {
      x: nodeBounds.x,
      y: nodeBounds.y + nodeBounds.height * 0.5,
    };
  }
  if (handleId === 'relational-out') {
    return {
      x: nodeBounds.x + nodeBounds.width,
      y: nodeBounds.y + nodeBounds.height * 0.5,
    };
  }

  return undefined;
}
