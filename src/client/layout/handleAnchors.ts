interface HandleAnchorNodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FOLDER_HANDLE_PATTERN = /^folder-(right|left)-(in|out)$/;
const MODULE_HANDLE_PATTERN = /^relational-(top|right|bottom|left)-(in|out)$/;

type CardinalSide = 'top' | 'right' | 'bottom' | 'left';

function anchorForSide(nodeBounds: HandleAnchorNodeBounds, side: CardinalSide): { x: number; y: number } {
  switch (side) {
    case 'top':
      return {
        x: nodeBounds.x + nodeBounds.width * 0.5,
        y: nodeBounds.y,
      };
    case 'right':
      return {
        x: nodeBounds.x + nodeBounds.width,
        y: nodeBounds.y + nodeBounds.height * 0.5,
      };
    case 'bottom':
      return {
        x: nodeBounds.x + nodeBounds.width * 0.5,
        y: nodeBounds.y + nodeBounds.height,
      };
    case 'left':
    default:
      return {
        x: nodeBounds.x,
        y: nodeBounds.y + nodeBounds.height * 0.5,
      };
  }
}

export function getHandleAnchor(
  nodeBounds: HandleAnchorNodeBounds,
  handleId: string
): { x: number; y: number } | undefined {
  /* eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- .exec blocked by project hook */
  const folderMatch = handleId.match(FOLDER_HANDLE_PATTERN);
  if (folderMatch) {
    const side = folderMatch[1] as 'right' | 'left';
    return anchorForSide(nodeBounds, side);
  }

  /* eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- .exec blocked by project hook */
  const moduleMatch = handleId.match(MODULE_HANDLE_PATTERN);
  if (moduleMatch) {
    const side = moduleMatch[1] as CardinalSide;
    return anchorForSide(nodeBounds, side);
  }

  if (handleId === 'relational-in') {
    return anchorForSide(nodeBounds, 'left');
  }
  if (handleId === 'relational-out') {
    return anchorForSide(nodeBounds, 'right');
  }

  return undefined;
}
