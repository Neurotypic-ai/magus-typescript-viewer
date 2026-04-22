import { Position } from '@vue-flow/core';

export const FOLDER_HANDLE_IDS = {
  rightOut: 'folder-right-out',
  leftIn: 'folder-left-in',
  rightStub: 'folder-right-stub',
  leftStub: 'folder-left-stub',
} as const;

/**
 * Canonical node handles are always right-out and left-in.
 *
 * @deprecated The `_direction` argument is ignored. Layout is hardcoded LR;
 * TB/BT/RL requests produce identical output. Scheduled for removal when
 * per-edge side assignment (Phase 2 of the hub-aware layout plan) lands.
 */
export const getHandlePositions = (
  _direction: 'LR' | 'RL' | 'TB' | 'BT'
): { sourcePosition: Position; targetPosition: Position } => {
  return { sourcePosition: Position.Right, targetPosition: Position.Left };
};

