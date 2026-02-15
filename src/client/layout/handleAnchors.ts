import { GROUP_ENTRY_STUB_PX } from './edgeGeometryPolicy';

export interface HandleAnchorNodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FOLDER_HANDLE_PATTERN = /^folder-(top|right|bottom|left)-(in|out)(-inner)?$/;
const RELATIONAL_SIDE_HANDLE_PATTERN = /^relational-(in|out)-(top|right|bottom|left)$/;
const INNER_FOLDER_HANDLE_INSET_PX = GROUP_ENTRY_STUB_PX;

export function getHandleAnchor(
  nodeBounds: HandleAnchorNodeBounds,
  handleId: string
): { x: number; y: number } | undefined {
  /* eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- .exec blocked by project hook */
  const folderMatch = handleId.match(FOLDER_HANDLE_PATTERN);
  if (folderMatch) {
    const side = folderMatch[1] as 'top' | 'right' | 'bottom' | 'left';
    const role = folderMatch[2] as 'in' | 'out';
    const isInner = folderMatch[3] === '-inner';
    const offset = role === 'in' ? 0.33 : 0.66;

    if (side === 'top') {
      return {
        x: nodeBounds.x + nodeBounds.width * offset,
        y: nodeBounds.y + (isInner ? INNER_FOLDER_HANDLE_INSET_PX : 0),
      };
    }
    if (side === 'bottom') {
      return {
        x: nodeBounds.x + nodeBounds.width * offset,
        y: nodeBounds.y + nodeBounds.height - (isInner ? INNER_FOLDER_HANDLE_INSET_PX : 0),
      };
    }
    if (side === 'left') {
      return {
        x: nodeBounds.x + (isInner ? INNER_FOLDER_HANDLE_INSET_PX : 0),
        y: nodeBounds.y + nodeBounds.height * offset,
      };
    }
    return {
      x: nodeBounds.x + nodeBounds.width - (isInner ? INNER_FOLDER_HANDLE_INSET_PX : 0),
      y: nodeBounds.y + nodeBounds.height * offset,
    };
  }

  /* eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- .exec blocked by project hook */
  const relationalSideMatch = handleId.match(RELATIONAL_SIDE_HANDLE_PATTERN);
  if (relationalSideMatch) {
    const side = relationalSideMatch[2] as 'top' | 'right' | 'bottom' | 'left';
    if (side === 'top') {
      return {
        x: nodeBounds.x + nodeBounds.width * 0.5,
        y: nodeBounds.y,
      };
    }
    if (side === 'right') {
      return {
        x: nodeBounds.x + nodeBounds.width,
        y: nodeBounds.y + nodeBounds.height * 0.5,
      };
    }
    if (side === 'bottom') {
      return {
        x: nodeBounds.x + nodeBounds.width * 0.5,
        y: nodeBounds.y + nodeBounds.height,
      };
    }
    return {
      x: nodeBounds.x,
      y: nodeBounds.y + nodeBounds.height * 0.5,
    };
  }

  if (handleId === 'relational-in') {
    return {
      x: nodeBounds.x + nodeBounds.width * 0.5,
      y: nodeBounds.y,
    };
  }
  if (handleId === 'relational-out') {
    return {
      x: nodeBounds.x + nodeBounds.width * 0.5,
      y: nodeBounds.y + nodeBounds.height,
    };
  }

  return undefined;
}
