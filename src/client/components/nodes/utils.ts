import type { Position } from '@vue-flow/core';
import type { InjectionKey, Ref } from 'vue';

import type { DependencyData } from '../../types/DependencyData';
import type { DependencyKind } from '../../types/DependencyKind';
import type { EmbeddedModuleEntity } from '../../types/EmbeddedModuleEntity';
import type { NodeMethod } from '../../types/NodeMethod';
import type { NodeProperty } from '../../types/NodeProperty';

/**
 * Injection key for node actions provided by the graph root.
 * Consumed by BaseNode via inject().
 */
export interface NodeActions {
  focusNode: (nodeId: string) => void;
  isolateNeighborhood: (nodeId: string) => void;
  showContextMenu: (nodeId: string, label: string, event: MouseEvent) => void;
}

export const NODE_ACTIONS_KEY: InjectionKey<NodeActions> = Symbol('node-actions');

/**
 * Injection key for the isolate-expand-all signal.
 * When true, all collapsible sections in nodes should expand.
 */
export const ISOLATE_EXPAND_ALL_KEY: InjectionKey<Ref<boolean>> = Symbol('isolate-expand-all');

/**
 * Injection key for the global orphan-highlighting toggle.
 * Provided once by graph root to avoid each node subscribing to the entire store.
 */
export const HIGHLIGHT_ORPHAN_GLOBAL_KEY: InjectionKey<Ref<boolean>> = Symbol('highlight-orphan-global');

/**
 * Injection key for folder collapse actions provided by the graph root.
 * Consumed by GroupNode via inject().
 */
export interface FolderCollapseActions {
  toggleFolderCollapsed: (folderId: string) => void;
}

export const FOLDER_COLLAPSE_ACTIONS_KEY: InjectionKey<FolderCollapseActions> =
  Symbol('folder-collapse-actions');

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

export interface BuildBaseNodePropsOverrides {
  isContainer?: boolean;
  showSubnodes?: boolean;
  subnodesCount?: number;
  zIndex?: number;
}

export interface BaseNodeProps extends BuildBaseNodePropsOverrides {
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

/**
 * Build the base node props object from DependencyProps.
 * Replaces the duplicated `baseNodeProps` computed in ModuleNode, PackageNode, and SymbolNode.
 */
export function buildBaseNodeProps(
  props: DependencyPropsInput,
  overrides?: BuildBaseNodePropsOverrides
): BaseNodeProps {
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

// ── Shared member formatting ──────────────────────────────────────

export interface FormattedMember {
  key: string;
  name: string;
  typeAnnotation: string;
  indicator: string;
}

function normalizeTypeAnnotation(annotation: string | undefined, fallback: string): string {
  const normalized = annotation?.replace(/^:\s*/, '').trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

export function visibilityIndicator(visibility: string): string {
  switch (visibility) {
    case 'public':
      return 'p';
    case 'protected':
      return '#';
    case 'private':
      return '-';
    default:
      return 'p';
  }
}

export function formatProperty(prop: NodeProperty): FormattedMember {
  return {
    key: `${prop.name}:${prop.type || 'unknown'}:${prop.visibility || 'default'}`,
    indicator: visibilityIndicator(prop.visibility),
    name: prop.name,
    typeAnnotation: normalizeTypeAnnotation(prop.type, 'unknown'),
  };
}

export function formatMethod(method: NodeMethod): FormattedMember {
  return {
    key: `${method.name}:${method.returnType || 'void'}:${method.visibility || 'default'}`,
    indicator: visibilityIndicator(method.visibility),
    name: method.name,
    typeAnnotation: normalizeTypeAnnotation(method.returnType, 'void'),
  };
}

// ── Entity type display config ────────────────────────────────────

export interface EntityTypeConfig {
  type: EmbeddedModuleEntity['type'];
  title: string;
  badgeText: string;
  badgeClass: string;
}

export const ENTITY_TYPE_CONFIGS: EntityTypeConfig[] = [
  { type: 'function', title: 'Functions', badgeText: 'FN', badgeClass: 'entity-function' },
  { type: 'type', title: 'Types', badgeText: 'TYPE', badgeClass: 'entity-type' },
  { type: 'enum', title: 'Enums', badgeText: 'ENUM', badgeClass: 'entity-enum' },
  { type: 'const', title: 'Constants', badgeText: 'CONST', badgeClass: 'entity-const' },
  { type: 'var', title: 'Variables', badgeText: 'VAR', badgeClass: 'entity-var' },
];

// ── Subnodes count resolution ─────────────────────────────────────

export interface SubnodesCount {
  count: number;
  totalCount: number;
  hiddenCount: number;
}

/**
 * Resolve subnodes count/totalCount/hiddenCount from node data.
 * Normalizes the loosely-typed `subnodes` bag into concrete numbers.
 */
export function resolveSubnodesCount(
  subnodes: { count?: number; totalCount?: number; hiddenCount?: number } | undefined,
): SubnodesCount {
  const count = typeof subnodes?.count === 'number' ? subnodes.count : 0;
  const totalCount = typeof subnodes?.totalCount === 'number' ? subnodes.totalCount : count;
  const hiddenCount = typeof subnodes?.hiddenCount === 'number'
    ? Math.max(0, subnodes.hiddenCount)
    : Math.max(0, totalCount - count);
  return { count, totalCount, hiddenCount };
}
