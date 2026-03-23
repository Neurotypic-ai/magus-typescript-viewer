/**
 * Shared helpers for module and symbol drilldown: property/method normalization,
 * module lookup, symbol edges and detailed symbol nodes.
 */

import { getEdgeStyle, getNodeStyle, graphTheme } from '../../theme/graphTheme';
import { mapTypeCollection } from '../../utils/collections';
import { createEdgeMarker } from '../../utils/edgeMarkers';
import { getHandlePositions } from '../handleRouting';

import type { Method } from '../../../shared/types/Method';
import type { IModule } from '../../../shared/types/Module';
import type { PackageGraph } from '../../../shared/types/Package';
import type { ParentType } from '../../../shared/types/ParentType';
import type { Property } from '../../../shared/types/Property';
import type { DependencyEdgeKind } from '../../../shared/types/graph/DependencyEdgeKind';
import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

type PropertyLike = Property | Partial<Record<keyof Property, unknown>>;

type MethodLike = (Method | Partial<Record<keyof Method, unknown>>) & {
  returnType?: unknown;
  parameters?: unknown;
  signature?: unknown;
};

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function normalizeProperty(property: PropertyLike): Property {
  const source = property;
  return {
    id: readString(source.id, ''),
    package_id: readString(source.package_id, ''),
    module_id: readString(source.module_id, ''),
    parent_id: readString(source.parent_id, ''),
    name: readString(source.name, 'unknown'),
    created_at: readString(source.created_at, ''),
    type: readString(source.type, 'unknown'),
    is_static: Boolean(source.is_static),
    is_readonly: Boolean(source.is_readonly),
    visibility: readString(source.visibility, 'public'),
    default_value: readOptionalString(source.default_value),
  };
}

function isMethodParameters(value: unknown): value is Method['parameters'] {
  return value instanceof Map || Array.isArray(value) || (value !== null && typeof value === 'object');
}

export function normalizeMethod(method: MethodLike): Method {
  const source = method;
  const name = readString(source.name, 'unknown');
  const legacyReturnType = 'returnType' in source ? source.returnType : undefined;
  const returnType =
    typeof source.return_type === 'string'
      ? source.return_type
      : typeof legacyReturnType === 'string'
        ? legacyReturnType
        : 'void';
  const signature =
    typeof source.signature === 'string' && source.signature.length > 0 ? source.signature : `${name}(): ${returnType}`;
  return {
    id: readString(source.id, ''),
    package_id: readString(source.package_id, ''),
    module_id: readString(source.module_id, ''),
    parent_id: readString(source.parent_id, ''),
    name,
    created_at: readString(source.created_at, ''),
    parameters: isMethodParameters(source.parameters) ? source.parameters : [],
    return_type: returnType,
    is_static: Boolean(source.is_static),
    is_async: Boolean(source.is_async),
    visibility: readString(source.visibility, 'public'),
    signature,
  };
}

export function findModuleById(data: PackageGraph, moduleId: string): IModule | undefined {
  for (const pkg of data.packages) {
    const module = mapTypeCollection(pkg.modules, (entry) => entry).find((entry) => entry.id === moduleId);
    if (module) return module;
  }
  return undefined;
}

export function createSymbolEdge(source: string, target: string, type: DependencyEdgeKind): GraphEdge {
  return {
    id: `${source}-${target}-${type}`,
    source,
    target,
    hidden: false,
    data: { type },
    style: { ...getEdgeStyle(type), strokeWidth: graphTheme.edges.sizes.width.highlighted },
    markerEnd: createEdgeMarker(),
  } as GraphEdge;
}

export function createDetailedSymbolNode(
  id: string,
  type: ParentType,
  label: string,
  properties: Property[],
  methods: Method[],
  direction: 'LR' | 'RL' | 'TB' | 'BT'
): DependencyNode {
  const { sourcePosition, targetPosition } = getHandlePositions(direction);
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    sourcePosition,
    targetPosition,
    data: { label, properties, methods },
    style: { ...getNodeStyle(type) },
  } as DependencyNode;
}
