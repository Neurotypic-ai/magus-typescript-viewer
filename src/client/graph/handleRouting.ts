import { Position } from '@vue-flow/core';

import type { DependencyEdgeKind } from '../../shared/types/graph/DependencyEdgeKind';

export const FOLDER_HANDLE_IDS = {
  rightOut: 'folder-right-out',
  leftIn: 'folder-left-in',
  rightStub: 'folder-right-stub',
  leftStub: 'folder-left-stub',
} as const;

/** Edge kinds that receive a dedicated routing lane on folder boundaries. */
export const FOLDER_ROUTING_KINDS: readonly DependencyEdgeKind[] = [
  'peerDependency',
  'devDependency',
  'dependency',
  'import',
  'extends',
  'implements',
] as const;

/** Per-kind Y offset (px) from the folder vertical midpoint. */
export const FOLDER_KIND_Y_OFFSET: Partial<Record<DependencyEdgeKind, number>> = {
  peerDependency: -24,
  devDependency:  -16,
  dependency:      -8,
  import:           0,
  extends:          8,
  implements:      16,
};

/** Builds a per-kind handle ID: `folder-{side}-{role}-{kind}` */
export function getFolderHandleId(
  side: 'left' | 'right',
  role: 'in' | 'out' | 'stub',
  kind: DependencyEdgeKind
): string {
  return `folder-${side}-${role}-${kind}`;
}

/**
 * Canonical node handles are always right-out and left-in.
 * The direction argument is kept for compatibility with existing callers.
 */
export const getHandlePositions = (
  _direction: 'LR' | 'RL' | 'TB' | 'BT'
): { sourcePosition: Position; targetPosition: Position } => {
  return { sourcePosition: Position.Right, targetPosition: Position.Left };
};

