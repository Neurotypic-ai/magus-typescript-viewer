import { reactive } from 'vue';

import { getEdgeStyle } from '../../theme/graphTheme';
import { measurePerformance } from '../../utils/performanceMonitoring';
import { applyEdgeVisibility, toDependencyEdgeKind } from './buildGraphView';
import { addSetDiff, mergeNodeInteractionStyle, stripEdgeClass, stripNodeClass, toDimensionValue } from './graphUtils';

import type { Ref } from 'vue';

import type { graphTheme as GraphThemeType } from '../../theme/graphTheme';
import type { DependencyNode, GraphEdge, SearchResult } from './types';

export interface SearchHighlightState {
  hasResults: boolean;
  hasPath: boolean;
  matchingNodeIds: Set<string>;
  pathNodeIds: Set<string>;
  matchingEdgeIds: Set<string>;
}

export interface UseSearchHighlightingOptions {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  graphTheme: typeof GraphThemeType;
  updateNodesById: (updates: Map<string, DependencyNode>) => void;
  setEdges: (edges: GraphEdge[]) => void;
  activeRelationshipTypes: Ref<string[]>;
  perfMarksEnabled: boolean;
}

export interface SearchHighlighting {
  searchHighlightState: SearchHighlightState;
  handleSearchResult: (result: SearchResult) => void;
  resetSearchHighlightState: () => void;
}

export function useSearchHighlighting(options: UseSearchHighlightingOptions): SearchHighlighting {
  const {
    nodes,
    edges,
    graphTheme: theme,
    updateNodesById,
    setEdges,
    activeRelationshipTypes,
    perfMarksEnabled,
  } = options;

  const searchHighlightState = reactive<SearchHighlightState>({
    hasResults: false,
    hasPath: false,
    matchingNodeIds: new Set<string>(),
    pathNodeIds: new Set<string>(),
    matchingEdgeIds: new Set<string>(),
  });

  const resetSearchHighlightState = (): void => {
    searchHighlightState.hasResults = false;
    searchHighlightState.hasPath = false;
    searchHighlightState.matchingNodeIds = new Set<string>();
    searchHighlightState.pathNodeIds = new Set<string>();
    searchHighlightState.matchingEdgeIds = new Set<string>();
  };

  const handleSearchResult = (result: SearchResult): void => {
    if (perfMarksEnabled) {
      performance.mark('search-highlight-start');
    }

    const matchingNodeIds = new Set(result.nodes.map((n) => n.id));
    const pathNodeIds = new Set(result.path?.map((n) => n.id) ?? []);
    const matchingEdgeIds = new Set(result.edges.map((e) => e.id));
    const hasResults = matchingNodeIds.size > 0;
    const hasPath = pathNodeIds.size > 0;

    const shouldRefreshAllNodes =
      hasResults !== searchHighlightState.hasResults ||
      (hasResults && searchHighlightState.hasResults && hasPath !== searchHighlightState.hasPath);
    const shouldRefreshAllEdges = hasResults !== searchHighlightState.hasResults;

    const nodeIdsToUpdate = new Set<string>();
    if (shouldRefreshAllNodes) {
      nodes.value.forEach((node) => nodeIdsToUpdate.add(node.id));
    } else {
      addSetDiff(nodeIdsToUpdate, searchHighlightState.matchingNodeIds, matchingNodeIds);
      addSetDiff(nodeIdsToUpdate, searchHighlightState.pathNodeIds, pathNodeIds);
    }

    const edgeIdsToUpdate = new Set<string>();
    if (shouldRefreshAllEdges) {
      edges.value.forEach((edge) => edgeIdsToUpdate.add(edge.id));
    } else {
      addSetDiff(edgeIdsToUpdate, searchHighlightState.matchingEdgeIds, matchingEdgeIds);
    }

    const nodeUpdates = new Map<string, DependencyNode>();
    const nodeById = new Map(nodes.value.map((node) => [node.id, node]));

    nodeIdsToUpdate.forEach((nodeId) => {
      const node = nodeById.get(nodeId);
      if (!node) {
        return;
      }

      const isMatch = matchingNodeIds.has(node.id);
      const isOnPath = hasPath && pathNodeIds.has(node.id);
      const opacity = !hasResults ? 1 : hasPath ? (isOnPath ? 1 : 0.2) : isMatch ? 1 : 0.2;
      const borderWidth =
        hasPath && isOnPath
          ? theme.edges.sizes.width.selected
          : hasPath
            ? theme.edges.sizes.width.default
            : undefined;
      const currentStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};
      const currentOpacity = toDimensionValue(currentStyle['opacity']) ?? 1;
      const currentBorderWidth = currentStyle['borderWidth'];

      const opacityChanged = Math.abs(currentOpacity - opacity) > 0.001;
      const borderWidthChanged = String(currentBorderWidth ?? '') !== String(borderWidth ?? '');
      const classChanged = node.class !== undefined;

      if (!opacityChanged && !borderWidthChanged && !classChanged) {
        return;
      }

      const baseNode = stripNodeClass(node);
      const updatedNode = {
        ...baseNode,
        style: mergeNodeInteractionStyle(baseNode, {
          opacity,
          borderWidth,
        }),
      } as DependencyNode;
      nodeUpdates.set(node.id, updatedNode);
    });

    if (nodeUpdates.size > 0) {
      updateNodesById(nodeUpdates);
    }

    const edgeUpdates = new Map<string, GraphEdge>();
    const edgeById = new Map(edges.value.map((edge) => [edge.id, edge]));

    edgeIdsToUpdate.forEach((edgeId) => {
      const edge = edgeById.get(edgeId);
      if (!edge) {
        return;
      }

      const isMatch = matchingEdgeIds.has(edge.id);
      const opacity = !hasResults ? 1 : isMatch ? 1 : 0.2;
      const currentStyle = typeof edge.style === 'object' ? (edge.style as Record<string, unknown>) : {};
      const currentOpacity = toDimensionValue(currentStyle['opacity']) ?? 1;
      const opacityChanged = Math.abs(currentOpacity - opacity) > 0.001;
      const classChanged = edge.class !== undefined;

      if (!opacityChanged && !classChanged) {
        return;
      }

      const baseEdge = stripEdgeClass(edge);
      edgeUpdates.set(edge.id, {
        ...baseEdge,
        style: {
          ...getEdgeStyle(toDependencyEdgeKind(baseEdge.data?.type)),
          opacity,
        },
      } as GraphEdge);
    });

    if (edgeUpdates.size > 0) {
      const mergedEdges = edges.value.map((edge) => edgeUpdates.get(edge.id) ?? edge);
      setEdges(applyEdgeVisibility(mergedEdges, activeRelationshipTypes.value));
    }

    searchHighlightState.hasResults = hasResults;
    searchHighlightState.hasPath = hasPath;
    searchHighlightState.matchingNodeIds = new Set(matchingNodeIds);
    searchHighlightState.pathNodeIds = new Set(pathNodeIds);
    searchHighlightState.matchingEdgeIds = new Set(matchingEdgeIds);

    if (perfMarksEnabled) {
      performance.mark('search-highlight-end');
      measurePerformance('search-highlight-apply', 'search-highlight-start', 'search-highlight-end');
    }
  };

  return {
    searchHighlightState,
    handleSearchResult,
    resetSearchHighlightState,
  };
}
