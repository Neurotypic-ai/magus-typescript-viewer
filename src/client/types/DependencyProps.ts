import type { Position } from '@vue-flow/core';
import type { DependencyKind } from './DependencyKind';
import type { DependencyData } from './DependencyData';

/**
 * Props for dependency node components - adapted to work with XYFlow's requirements.
 * Widened to include additional NodeWrapper-passed props for forward compatibility.
 */
export interface DependencyProps {
  id: string;
  type: DependencyKind;
  data: DependencyData;
  selected?: boolean;
  dragging?: boolean;
  connectable?: boolean | number | string;
  width?: number;
  height?: number;
  sourcePosition?: Position;
  targetPosition?: Position;
  parentNodeId?: string;
}
