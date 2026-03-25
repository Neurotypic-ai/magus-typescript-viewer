import { GROUP_ENTRY_STUB_PX } from './edgeGeometryPolicy';

interface HandleAnchorNodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FOLDER_HANDLE_PATTERN = /^folder-(right|left)-(in|out)(-inner)?$/;
const INNER_FOLDER_HANDLE_INSET_PX = GROUP_ENTRY_STUB_PX;

export function getHandleAnchor(
  nodeBounds: HandleAnchorNodeBounds,
  handleId: string
): { x: number; y: number } | undefined {
  /* eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- .exec blocked by project hook */
  const folderMatch = handleId.match(FOLDER_HANDLE_PATTERN);
  if (folderMatch) {
    const side = folderMatch[1] as 'right' | 'left';
    const isInner = folderMatch[3] === '-inner';
    if (side === 'left') {
      return {
        x: nodeBounds.x + (isInner ? INNER_FOLDER_HANDLE_INSET_PX : 0),
        y: nodeBounds.y + nodeBounds.height * 0.5,
      };
    }
    return {
      x: nodeBounds.x + nodeBounds.width - (isInner ? INNER_FOLDER_HANDLE_INSET_PX : 0),
      y: nodeBounds.y + nodeBounds.height * 0.5,
    };
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
