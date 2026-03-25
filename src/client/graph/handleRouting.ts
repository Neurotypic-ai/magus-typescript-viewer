import { Position } from '@vue-flow/core';

export const FOLDER_HANDLE_IDS = {
  rightOut: 'folder-right-out',
  leftIn: 'folder-left-in',
} as const;

/**
 * Canonical node handles are always right-out and left-in.
 * The direction argument is kept for compatibility with existing callers.
 */
export const getHandlePositions = (
  _direction: 'LR' | 'RL' | 'TB' | 'BT'
): { sourcePosition: Position; targetPosition: Position } => {
  return { sourcePosition: Position.Right, targetPosition: Position.Left };
};

