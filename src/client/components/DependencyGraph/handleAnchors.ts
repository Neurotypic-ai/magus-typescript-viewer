export interface HandleAnchorNodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FOLDER_HANDLE_PATTERN = /^folder-(top|right|bottom|left)-(in|out)$/;

export function getHandleAnchor(
  nodeBounds: HandleAnchorNodeBounds,
  handleId: string
): { x: number; y: number } | undefined {
  const folderMatch = handleId.match(FOLDER_HANDLE_PATTERN);
  if (folderMatch) {
    const side = folderMatch[1] as 'top' | 'right' | 'bottom' | 'left';
    const role = folderMatch[2] as 'in' | 'out';
    const offset = role === 'in' ? 0.33 : 0.66;

    if (side === 'top') {
      return {
        x: nodeBounds.x + nodeBounds.width * offset,
        y: nodeBounds.y,
      };
    }
    if (side === 'bottom') {
      return {
        x: nodeBounds.x + nodeBounds.width * offset,
        y: nodeBounds.y + nodeBounds.height,
      };
    }
    if (side === 'left') {
      return {
        x: nodeBounds.x,
        y: nodeBounds.y + nodeBounds.height * offset,
      };
    }
    return {
      x: nodeBounds.x + nodeBounds.width,
      y: nodeBounds.y + nodeBounds.height * offset,
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

