/**
 * Shared helpers for module and symbol drilldown: property/method normalization,
 * module lookup, symbol edges and detailed symbol nodes.
 */

import { createEdgeMarker } from '../../utils/edgeMarkers';
import { getEdgeStyle, getNodeStyle } from '../../theme/graphTheme';
import { getHandlePositions } from '../handleRouting';
import { mapTypeCollection } from '../../utils/collections';

import type { DependencyEdgeKind } from '../../../shared/types/graph/DependencyEdgeKind';
import type { DependencyNode } from '../../types/DependencyNode';
import type { PackageGraph } from '../../../shared/types/Package';
import type { GraphEdge } from '../../types/GraphEdge';
import type { Module } from '../../../shared/types/Module';
import type { Method } from '../../../shared/types/Method';
import type { Property } from '../../../shared/types/Property';

export function normalizeProperty(property: Property): Property {
  const source = property as any;
  return {
    id: typeof source.id === 'string' ? source.id : (undefined as unknown as string),
    package_id: typeof source.package_id === 'string' ? source.package_id : '',
    module_id: typeof source.module_id === 'string' ? source.module_id : '',
    parent_id: typeof source.parent_id === 'string' ? source.parent_id : '',
    name: typeof source.name === 'string' ? source.name : 'unknown',
    created_at: typeof source.created_at === 'string' ? source.created_at : '',
    type: typeof source.type === 'string' ? source.type : 'unknown',
    is_static: Boolean(source.is_static),
    is_readonly: Boolean(source.is_readonly),
    visibility: typeof source.visibility === 'string' ? source.visibility : 'public',
    default_value: typeof source.default_value === 'string' ? source.default_value : undefined,
  };
}

export function normalizeMethod(method: Method): Method {
  const source = method as any;
  const name = typeof source.name === 'string' ? source.name : 'unknown';
  const returnType =
    typeof source.return_type === 'string'
      ? source.return_type
      : typeof source.returnType === 'string'
        ? source.returnType
        : 'void';
  const signature =
    typeof source.signature === 'string' && source.signature.length > 0
      ? source.signature
      : `${name}(): ${returnType}`;
  return {
    id: typeof source.id === 'string' ? source.id : (undefined as unknown as string),
    package_id: typeof source.package_id === 'string' ? source.package_id : '',
    module_id: typeof source.module_id === 'string' ? source.module_id : '',
    parent_id: typeof source.parent_id === 'string' ? source.parent_id : '',
    name,
    created_at: typeof source.created_at === 'string' ? source.created_at : '',
    parameters: source.parameters && typeof source.parameters === 'object' ? (source.parameters as Method['parameters']) : [],
    return_type: returnType,
    is_static: Boolean(source.is_static),
    is_async: Boolean(source.is_async),
    visibility: typeof source.visibility === 'string' ? source.visibility : 'public',
    signature,
  };
}

export function findModuleById(
  data: PackageGraph,
  moduleId: string
): Module | undefined {
  for (const pkg of data.packages) {
    if (!pkg.modules) continue;
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
    style: { ...getEdgeStyle(type), strokeWidth: 3 },
    markerEnd: createEdgeMarker(),
  } as GraphEdge;
}

export function createDetailedSymbolNode(
  id: string,
  type: 'class' | 'interface',
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

