interface HandleAnchorNodeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const FOLDER_HANDLE_PATTERN = /^folder-(right|left)-(in|out)$/;

export function getHandleAnchor(
  nodeBounds: HandleAnchorNodeBounds,
  handleId: string
): { x: number; y: number } | undefined {
  /* eslint-disable-next-line @typescript-eslint/prefer-regexp-exec -- .exec blocked by project hook */
  const folderMatch = handleId.match(FOLDER_HANDLE_PATTERN);
  if (folderMatch) {
    const side = folderMatch[1] as 'right' | 'left';
    if (side === 'left') {
      return {
        x: nodeBounds.x,
        y: nodeBounds.y + nodeBounds.height * 0.5,
      };
    }
    return {
      x: nodeBounds.x + nodeBounds.width,
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
