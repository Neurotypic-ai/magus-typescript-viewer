import { getHandleCategory } from './edgeTypeRegistry';

import type { DependencyEdgeKind, DependencyNode, GraphEdge } from '../types';

export interface TraversalOptions {
  maxDepth: number;
  edgeFilter?: Set<DependencyEdgeKind>;
  semanticEdges: GraphEdge[];
  semanticNodes: DependencyNode[];
  parentMap: Map<string, string>;
}

export interface TraversalResult {
  nodeIds: Set<string>;
  edges: GraphEdge[];
  inbound: Set<string>;
  outbound: Set<string>;
  containingFolders: Set<string>;
  depthMap: Map<string, number>;
}

interface Adjacent {
  edge: GraphEdge;
  neighborId: string;
  direction: 'outbound' | 'inbound';
}

const edgeAllowedByDefault = (edge: GraphEdge): boolean => {
  const kind = edge.data?.type;
  if (!kind) {
    return true;
  }
  if (kind === 'contains' || kind === 'uses') {
    return false;
  }
  return getHandleCategory(kind) === 'relational';
};

const edgeAllowed = (edge: GraphEdge, filter?: Set<DependencyEdgeKind>): boolean => {
  if (filter && filter.size > 0) {
    const kind = edge.data?.type;
    return !!kind && filter.has(kind);
  }
  return edgeAllowedByDefault(edge);
};

const collectContainingFolders = (
  nodeId: string,
  nodeById: Map<string, DependencyNode>,
  parentMap: Map<string, string>,
  containingFolders: Set<string>
): void => {
  let current = nodeId;
  let parent = parentMap.get(current);
  while (parent) {
    if (nodeById.get(parent)?.type === 'group') {
      containingFolders.add(parent);
    }
    current = parent;
    parent = parentMap.get(current);
  }
};

export function traverseGraph(startNodeId: string, options: TraversalOptions): TraversalResult {
  const nodeById = new Map(options.semanticNodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, Adjacent[]>();
  const addAdjacent = (nodeId: string, adjacent: Adjacent): void => {
    const list = adjacency.get(nodeId);
    if (list) {
      list.push(adjacent);
    } else {
      adjacency.set(nodeId, [adjacent]);
    }
  };

  options.semanticEdges.forEach((edge) => {
    addAdjacent(edge.source, { edge, neighborId: edge.target, direction: 'outbound' });
    addAdjacent(edge.target, { edge, neighborId: edge.source, direction: 'inbound' });
  });

  const nodeIds = new Set<string>();
  const depthMap = new Map<string, number>();
  const inbound = new Set<string>();
  const outbound = new Set<string>();
  const containingFolders = new Set<string>();

  if (!nodeById.has(startNodeId)) {
    return {
      nodeIds,
      edges: [],
      inbound,
      outbound,
      containingFolders,
      depthMap,
    };
  }

  nodeIds.add(startNodeId);
  depthMap.set(startNodeId, 0);
  collectContainingFolders(startNodeId, nodeById, options.parentMap, containingFolders);

  const queue: string[] = [startNodeId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentDepth = depthMap.get(currentId) ?? 0;
    if (currentDepth >= options.maxDepth) {
      continue;
    }

    const neighbors = adjacency.get(currentId) ?? [];
    for (const adjacent of neighbors) {
      if (!edgeAllowed(adjacent.edge, options.edgeFilter)) {
        continue;
      }

      const neighborId = adjacent.neighborId;
      if (!depthMap.has(neighborId)) {
        const nextDepth = currentDepth + 1;
        depthMap.set(neighborId, nextDepth);
        nodeIds.add(neighborId);
        queue.push(neighborId);
        collectContainingFolders(neighborId, nodeById, options.parentMap, containingFolders);
      }

      if (currentId === startNodeId) {
        if (adjacent.direction === 'outbound') {
          outbound.add(neighborId);
        } else {
          inbound.add(neighborId);
        }
      }
    }
  }

  const edges = options.semanticEdges.filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return false;
    }
    return edgeAllowed(edge, options.edgeFilter);
  });

  return {
    nodeIds,
    edges,
    inbound,
    outbound,
    containingFolders,
    depthMap,
  };
}

