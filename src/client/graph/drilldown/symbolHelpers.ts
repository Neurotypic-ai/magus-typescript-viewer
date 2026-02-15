/**
 * Shared helpers for module and symbol drilldown: property/method normalization,
 * module lookup, symbol edges and detailed symbol nodes.
 */

import { createEdgeMarker } from '../../utils/edgeMarkers';
import { getEdgeStyle, getNodeStyle } from '../../theme/graphTheme';
import { getHandlePositions } from '../handleRouting';
import { mapTypeCollection } from '../../utils/collections';

import type { DependencyEdgeKind } from '../../types/DependencyEdgeKind';
import type { DependencyNode } from '../../types/DependencyNode';
import type { DependencyPackageGraph } from '../../types/DependencyPackageGraph';
import type { GraphEdge } from '../../types/GraphEdge';
import type { ModuleStructure } from '../../types/ModuleStructure';
import type { NodeMethod } from '../../types/NodeMethod';
import type { NodeProperty } from '../../types/NodeProperty';

export function toNodeProperty(property: NodeProperty | Record<string, unknown>): NodeProperty {
  const name = property.name;
  const type = property.type;
  const visibility = property.visibility;
  return {
    id: typeof property.id === 'string' ? property.id : undefined,
    name: typeof name === 'string' ? name : 'unknown',
    type: typeof type === 'string' ? type : 'unknown',
    visibility: typeof visibility === 'string' ? visibility : 'public',
  };
}

export function toNodeMethod(method: NodeMethod | Record<string, unknown>): NodeMethod {
  const name = method.name;
  const returnTypeVal = method.returnType;
  const visibility = method.visibility;
  const methodName = typeof name === 'string' ? name : 'unknown';
  const returnType = typeof returnTypeVal === 'string' ? returnTypeVal : 'void';
  return {
    id: typeof method.id === 'string' ? method.id : undefined,
    name: methodName,
    returnType,
    visibility: typeof visibility === 'string' ? visibility : 'public',
    signature:
      typeof method.signature === 'string' && method.signature.length > 0
        ? method.signature
        : `${methodName}(): ${returnType}`,
  };
}

export function findModuleById(
  data: DependencyPackageGraph,
  moduleId: string
): ModuleStructure | undefined {
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
  properties: NodeProperty[],
  methods: NodeMethod[],
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

