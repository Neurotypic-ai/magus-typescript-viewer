import type { Position } from '@vue-flow/core';
import type { InjectionKey, Ref } from 'vue';

import type { DependencyData, DependencyKind } from '../types';

/**
 * Injection key for node actions provided by the graph root.
 * Consumed by BaseNode via inject().
 */
export interface NodeActions {
  focusNode: (nodeId: string) => void;
  isolateNeighborhood: (nodeId: string) => void;
}

export const NODE_ACTIONS_KEY: InjectionKey<NodeActions> = Symbol('node-actions');

/**
 * Injection key for the isolate-expand-all signal.
 * When true, all collapsible sections in nodes should expand.
 */
export const ISOLATE_EXPAND_ALL_KEY: InjectionKey<Ref<boolean>> = Symbol('isolate-expand-all');

/**
 * Input type compatible with Vue's DefineProps, which adds `| undefined` to optional properties.
 * Required because `exactOptionalPropertyTypes` makes `T?` incompatible with `T | undefined`.
 */
interface DependencyPropsInput {
  readonly id: string;
  readonly type: DependencyKind;
  readonly data: DependencyData;
  readonly selected?: boolean | undefined;
  readonly dragging?: boolean | undefined;
  readonly connectable?: boolean | number | string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly sourcePosition?: Position | undefined;
  readonly targetPosition?: Position | undefined;
  readonly parentNodeId?: string | undefined;
}

/**
 * Build the base node props object from DependencyProps.
 * Replaces the duplicated `baseNodeProps` computed in ModuleNode, PackageNode, and SymbolNode.
 */
export function buildBaseNodeProps(
  props: DependencyPropsInput,
  overrides?: {
    isContainer?: boolean;
    showSubnodes?: boolean;
    subnodesCount?: number;
    zIndex?: number;
  }
) {
  return {
    id: props.id,
    type: props.type,
    data: props.data,
    ...(props.selected !== undefined ? { selected: props.selected } : {}),
    ...(props.dragging !== undefined ? { dragging: props.dragging } : {}),
    ...(props.width !== undefined ? { width: props.width } : {}),
    ...(props.height !== undefined ? { height: props.height } : {}),
    ...(props.sourcePosition !== undefined ? { sourcePosition: props.sourcePosition } : {}),
    ...(props.targetPosition !== undefined ? { targetPosition: props.targetPosition } : {}),
    ...(props.connectable !== undefined ? { connectable: props.connectable } : {}),
    ...(props.parentNodeId !== undefined ? { parentNodeId: props.parentNodeId } : {}),
    ...overrides,
  };
}
