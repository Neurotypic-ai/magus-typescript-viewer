import { computed, ref } from 'vue';

import { applyEdgeHoverStrokeVariable, getEdgeBaseStroke, toEdgeStyleRecord } from '../theme/edgeStyles';
import {
  EDGE_HOVER_BASE_STROKE_VAR,
  EDGE_HOVER_CLASS,
  EDGE_HOVER_Z_INDEX,
  EDGE_SELECTION_CLASS_TOKENS,
  NODE_SELECTION_CLASS_TOKENS,
  edgeClassTokensToString,
  getClassTokens,
  getEdgeClassTokens,
  normalizeClassValue,
  normalizeEdgeClass,
  stripEdgeClass,
  stripNodeClass,
} from '../theme/graphClasses';
import { measurePerformance } from '../utils/performanceMonitoring';

import type { Ref } from 'vue';

import type { DependencyNode } from '../types/DependencyNode';
import type { GraphEdge } from '../types/GraphEdge';
import type { CameraMode, ScopeMode } from './useGraphInteractionController';
import type { SearchHighlightState } from './useSearchHighlighting';

const EMPTY_EDGE_SET = new Set<string>();

function pushToMultiMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

interface SelectionAdjacency {
  connectedNodeIds: Set<string>;
  connectedEdgeIds: Set<string>;
}

interface UseSelectionHighlightingOptions {
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  selectedNode: Ref<DependencyNode | null>;
  scopeMode: Readonly<Ref<ScopeMode>>;
  searchHighlightState: SearchHighlightState;
  useCssSelectionHover: boolean;
  perfMarksEnabled: boolean;
  graphStore: {
    setSelectedNode: (node: DependencyNode | null) => void;
    updateNodesById: (updates: Map<string, DependencyNode>) => void;
    updateEdgesById: (updates: Map<string, GraphEdge>) => void;
  };
  interaction: {
    setSelectionNodeId: (id: string | null) => void;
    setCameraMode: (mode: CameraMode) => void;
  };
  removeSelectedElements: () => void;
  restoreHoverZIndex: (nodeId: string) => void;
}

interface SelectionHighlighting {
  hoveredNodeId: Ref<string | null>;
  visualNodes: Ref<DependencyNode[]>;
  visualEdges: Ref<GraphEdge[]>;
  selectionAdjacencyByNodeId: Ref<Map<string, SelectionAdjacency>>;
  selectedConnectedNodeIds: Ref<Set<string>>;
  selectedConnectedEdgeIds: Ref<Set<string>>;
  highlightedEdgeIds: Ref<Set<string>>;
  highlightedEdgeIdList: Ref<string[]>;
  setSelectedNode: (node: DependencyNode | null) => void;
  reconcileSelectedNodeAfterStructuralChange: (updatedNodes: DependencyNode[]) => void;
  clearHoverState: () => void;
  applyHoverEdgeHighlight: (nodeId: string | null) => void;
  dispose: () => void;
}

export function useSelectionHighlighting(options: UseSelectionHighlightingOptions): SelectionHighlighting {
  const {
    nodes,
    edges,
    selectedNode,
    scopeMode,
    searchHighlightState,
    useCssSelectionHover,
    perfMarksEnabled,
    graphStore,
    interaction,
    removeSelectedElements,
    restoreHoverZIndex,
  } = options;

  const hoveredNodeId = ref<string | null>(null);
  let prevStyledNodeIds = new Set<string>();
  let prevStyledEdgeIds = new Set<string>();
  let hoveredEdgeIds = new Set<string>();
  const hoveredEdgePrevZIndexById = new Map<string, number | undefined>();
  let selectionHighlightRafId: number | null = null;

  // ── Selection adjacency computation ──

  const selectionAdjacencyByNodeId = computed(() => {
    const adjacency = new Map<string, SelectionAdjacency>();

    const ensureEntry = (nodeId: string): SelectionAdjacency => {
      let entry = adjacency.get(nodeId);
      if (!entry) {
        entry = {
          connectedNodeIds: new Set<string>(),
          connectedEdgeIds: new Set<string>(),
        };
        adjacency.set(nodeId, entry);
      }
      return entry;
    };

    for (const edge of edges.value) {
      if (edge.hidden) {
        continue;
      }

      const sourceEntry = ensureEntry(edge.source);
      sourceEntry.connectedNodeIds.add(edge.target);
      sourceEntry.connectedEdgeIds.add(edge.id);

      const targetEntry = ensureEntry(edge.target);
      targetEntry.connectedNodeIds.add(edge.source);
      targetEntry.connectedEdgeIds.add(edge.id);
    }

    // Resolve group (folder) nodes
    const childrenByParent = new Map<string, string[]>();
    for (const node of nodes.value) {
      if (node.parentNode) {
        const children = childrenByParent.get(node.parentNode);
        if (children) {
          children.push(node.id);
        } else {
          childrenByParent.set(node.parentNode, [node.id]);
        }
      }
    }

    for (const [groupId, childIds] of childrenByParent) {
      const groupEntry = ensureEntry(groupId);
      const childSet = new Set(childIds);

      for (const childId of childIds) {
        groupEntry.connectedNodeIds.add(childId);

        const childEntry = adjacency.get(childId);
        if (childEntry) {
          childEntry.connectedEdgeIds.forEach((edgeId) => groupEntry.connectedEdgeIds.add(edgeId));
          for (const neighborId of childEntry.connectedNodeIds) {
            if (!childSet.has(neighborId) && neighborId !== groupId) {
              groupEntry.connectedNodeIds.add(neighborId);
            }
          }
        }
      }
    }

    return adjacency;
  });

  // ── Derived selection computeds ──

  const selectedAdjacency = computed(() => {
    if (!selectedNode.value || scopeMode.value === 'isolate') {
      return undefined;
    }
    return selectionAdjacencyByNodeId.value.get(selectedNode.value.id);
  });

  const selectedConnectedNodeIds = computed<Set<string>>(() => {
    return selectedAdjacency.value?.connectedNodeIds ?? EMPTY_EDGE_SET;
  });

  const selectedConnectedEdgeIds = computed<Set<string>>(() => {
    return selectedAdjacency.value?.connectedEdgeIds ?? EMPTY_EDGE_SET;
  });

  const hoveredConnectedEdgeIds = computed<Set<string>>(() => {
    if (hoveredNodeId.value === null || selectedNode.value !== null || scopeMode.value === 'isolate') {
      return EMPTY_EDGE_SET;
    }

    const adjacency = selectionAdjacencyByNodeId.value;
    const directEntry = adjacency.get(hoveredNodeId.value);
    if (!directEntry) return EMPTY_EDGE_SET;

    const result = new Set<string>(directEntry.connectedEdgeIds);

    // Cross-folder edges are split into three VueFlow edge segments:
    //   source stub (module → sourceFolder)  →  trunk (sourceFolder → targetFolder)
    //                                        →  target stub (targetFolder → module)
    //
    // The adjacency only includes the one stub directly touching the hovered module.
    // Here we traverse the chain by edge type to expose the full visual path,
    // avoiding the adjacency map (which is inflated by parent-propagation and
    // would incorrectly pull in every edge in the folder).

    const groupNodeIds = new Set<string>();
    for (const node of nodes.value) {
      if (node.type === 'group') groupNodeIds.add(node.id);
    }

    // One pass: build directional lookups and collect directly connected stubs.
    const directStubs: GraphEdge[] = [];
    const crossFolderBySource = new Map<string, GraphEdge[]>();
    const crossFolderByTarget = new Map<string, GraphEdge[]>();
    const sourceStubsByFolder = new Map<string, GraphEdge[]>(); // keyed by folder (stub.target)
    const targetStubsByFolder = new Map<string, GraphEdge[]>(); // keyed by folder (stub.source)

    for (const edge of edges.value) {
      if (edge.type === 'crossFolder') {
        pushToMultiMap(crossFolderBySource, edge.source, edge);
        pushToMultiMap(crossFolderByTarget, edge.target, edge);
      } else if (edge.type === 'folderStub') {
        if (groupNodeIds.has(edge.target)) pushToMultiMap(sourceStubsByFolder, edge.target, edge);
        if (groupNodeIds.has(edge.source)) pushToMultiMap(targetStubsByFolder, edge.source, edge);
        if (directEntry.connectedEdgeIds.has(edge.id)) directStubs.push(edge);
      }
    }

    for (const stub of directStubs) {
      if (groupNodeIds.has(stub.target)) {
        // Source stub (module → folder): follow outgoing trunks to target folder stubs.
        for (const trunk of crossFolderBySource.get(stub.target) ?? []) {
          result.add(trunk.id);
          for (const tgtStub of targetStubsByFolder.get(trunk.target) ?? []) {
            result.add(tgtStub.id);
          }
        }
      } else if (groupNodeIds.has(stub.source)) {
        // Target stub (folder → module): follow incoming trunks to source folder stubs.
        for (const trunk of crossFolderByTarget.get(stub.source) ?? []) {
          result.add(trunk.id);
          for (const srcStub of sourceStubsByFolder.get(trunk.source) ?? []) {
            result.add(srcStub.id);
          }
        }
      }
    }

    return result;
  });

  const highlightedEdgeIds = computed<Set<string>>(() => {
    const ids = new Set<string>();
    selectedConnectedEdgeIds.value.forEach((edgeId) => ids.add(edgeId));
    hoveredConnectedEdgeIds.value.forEach((edgeId) => ids.add(edgeId));
    if (searchHighlightState.hasResults) {
      searchHighlightState.matchingEdgeIds.forEach((edgeId) => ids.add(edgeId));
    }
    return ids;
  });

  const highlightedEdgeIdList = computed(() => [...highlightedEdgeIds.value]);

  // ── Node selection class resolution ──

  const resolveNodeSelectionClass = (node: DependencyNode): string | null => {
    if (!selectedNode.value || scopeMode.value === 'isolate') {
      return null;
    }

    if (node.id === selectedNode.value.id) {
      return 'selection-target';
    }
    if (selectedConnectedNodeIds.value.has(node.id)) {
      return 'selection-connected';
    }
    return 'selection-dimmed';
  };

  // ── Visual nodes/edges with CSS classes ──

  const visualNodes = computed<DependencyNode[]>(() => {
    if (!useCssSelectionHover) {
      prevStyledNodeIds = new Set();
      return nodes.value;
    }

    const nextStyledIds = new Set<string>();
    let nextNodes: DependencyNode[] | null = null;

    nodes.value.forEach((node, index) => {
      const classTokens = getClassTokens(node.class);
      NODE_SELECTION_CLASS_TOKENS.forEach((token) => classTokens.delete(token));

      const selectionClass = resolveNodeSelectionClass(node);
      if (selectionClass) {
        classTokens.add(selectionClass);
        nextStyledIds.add(node.id);
      }

      const nextClass = edgeClassTokensToString(classTokens);

      // Skip only if this node wasn't styled last time AND the class already matches.
      // Previously-styled nodes MUST get a fresh object so VueFlow drops the old class.
      if (!prevStyledNodeIds.has(node.id) && normalizeClassValue(node.class) === nextClass) {
        return;
      }

      nextNodes ??= [...nodes.value];
      nextNodes[index] = { ...node, class: nextClass || '' } as DependencyNode;
    });

    prevStyledNodeIds = nextStyledIds;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- nextNodes is mutated inside forEach
    return nextNodes ?? nodes.value;
  });

  const visualEdges = computed<GraphEdge[]>(() => {
    if (!useCssSelectionHover) {
      prevStyledEdgeIds = new Set();
      return edges.value;
    }

    const hasSelection = selectedNode.value !== null && scopeMode.value !== 'isolate';
    const selectionEdgeIds = selectedConnectedEdgeIds.value;
    const hoveredEdgeIdSet = hoveredConnectedEdgeIds.value;

    const nextStyledIds = new Set<string>();
    let nextEdges: GraphEdge[] | null = null;

    edges.value.forEach((edge, index) => {
      const classTokens = getEdgeClassTokens(edge.class);
      EDGE_SELECTION_CLASS_TOKENS.forEach((token) => classTokens.delete(token));

      let isStyled = false;

      if (hasSelection) {
        classTokens.add(selectionEdgeIds.has(edge.id) ? 'edge-selection-highlighted' : 'edge-selection-dimmed');
        isStyled = true;
      }

      const shouldHover = hoveredEdgeIdSet.has(edge.id);
      if (shouldHover) {
        classTokens.add(EDGE_HOVER_CLASS);
        isStyled = true;
      }

      if (isStyled) {
        nextStyledIds.add(edge.id);
      }

      const nextClass = edgeClassTokensToString(classTokens);
      const nextStyle = applyEdgeHoverStrokeVariable(edge, shouldHover);
      const nextZIndex = shouldHover ? Math.max(edge.zIndex ?? 0, EDGE_HOVER_Z_INDEX) : edge.zIndex;

      const wasPreviouslyStyled = prevStyledEdgeIds.has(edge.id);
      if (
        !wasPreviouslyStyled &&
        normalizeEdgeClass(edge.class) === nextClass &&
        nextStyle === edge.style &&
        nextZIndex === edge.zIndex
      ) {
        return;
      }

      nextEdges ??= [...edges.value];
      nextEdges[index] = {
        ...edge,
        class: nextClass,
        style: nextStyle,
        zIndex: nextZIndex,
      } as GraphEdge;
    });

    prevStyledEdgeIds = nextStyledIds;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- nextEdges is mutated inside forEach
    return nextEdges ?? edges.value;
  });

  // ── Store-mode highlighting (non-CSS path) ──

  const applySelectionHighlight = (selected: DependencyNode | null): void => {
    if (useCssSelectionHover) {
      return;
    }

    if (scopeMode.value === 'isolate') return;

    if (perfMarksEnabled) {
      performance.mark('selection-highlight-start');
    }

    const hasSelection = selected !== null;
    const adjEntry = selected ? selectionAdjacencyByNodeId.value.get(selected.id) : undefined;
    const connectedNodeIds = adjEntry?.connectedNodeIds ?? new Set<string>();
    const connectedEdgeIds = adjEntry?.connectedEdgeIds ?? new Set<string>();
    const nodeUpdates = new Map<string, DependencyNode>();
    const edgeUpdates = new Map<string, GraphEdge>();

    nodes.value.forEach((node) => {
      let nodeClass: string | undefined;

      if (hasSelection) {
        if (node.id === selected.id) nodeClass = 'selection-target';
        else if (connectedNodeIds.has(node.id)) nodeClass = 'selection-connected';
        else nodeClass = 'selection-dimmed';
      }

      if (node.class === nodeClass) return;
      if (!nodeClass) {
        const stripped = stripNodeClass(node);
        if (stripped !== node) {
          nodeUpdates.set(node.id, stripped);
        }
        return;
      }
      nodeUpdates.set(node.id, { ...node, class: nodeClass } as DependencyNode);
    });

    edges.value.forEach((edge) => {
      let edgeClass: string | undefined;
      if (hasSelection) {
        edgeClass = connectedEdgeIds.has(edge.id) ? 'edge-selection-highlighted' : 'edge-selection-dimmed';
      }
      if (edge.class === edgeClass) return;
      if (!edgeClass) {
        const stripped = stripEdgeClass(edge);
        if (stripped !== edge) {
          edgeUpdates.set(edge.id, stripped);
        }
        return;
      }
      edgeUpdates.set(edge.id, { ...edge, class: edgeClass } as GraphEdge);
    });

    graphStore.updateNodesById(nodeUpdates);
    graphStore.updateEdgesById(edgeUpdates);

    if (perfMarksEnabled) {
      performance.mark('selection-highlight-end');
      measurePerformance('selection-highlight', 'selection-highlight-start', 'selection-highlight-end');
    }
  };

  // ── Hover edge highlighting (non-CSS path) ──

  const applyHoverEdgeHighlight = (nodeId: string | null): void => {
    if (useCssSelectionHover) {
      return;
    }

    const shouldHighlightEdges = nodeId !== null && selectedNode.value === null && scopeMode.value !== 'isolate';
    const nextHoveredEdgeIds = shouldHighlightEdges
      ? (selectionAdjacencyByNodeId.value.get(nodeId)?.connectedEdgeIds ?? new Set<string>())
      : new Set<string>();

    const impactedEdgeIds = new Set<string>([...hoveredEdgeIds, ...nextHoveredEdgeIds]);
    if (impactedEdgeIds.size === 0) {
      hoveredEdgeIds = nextHoveredEdgeIds;
      if (nextHoveredEdgeIds.size === 0) {
        hoveredEdgePrevZIndexById.clear();
      }
      return;
    }

    const edgeById = new Map(edges.value.map((edge) => [edge.id, edge]));
    const edgeUpdates = new Map<string, GraphEdge>();

    impactedEdgeIds.forEach((edgeId) => {
      const edge = edgeById.get(edgeId);
      if (!edge) {
        hoveredEdgePrevZIndexById.delete(edgeId);
        return;
      }

      const shouldHover = nextHoveredEdgeIds.has(edgeId);
      if (shouldHover && !hoveredEdgePrevZIndexById.has(edgeId)) {
        hoveredEdgePrevZIndexById.set(edgeId, edge.zIndex);
      }

      const classTokens = getEdgeClassTokens(edge.class);
      if (shouldHover) {
        classTokens.add(EDGE_HOVER_CLASS);
      } else {
        classTokens.delete(EDGE_HOVER_CLASS);
      }

      const nextClass = edgeClassTokensToString(classTokens);
      const previousZIndex = hoveredEdgePrevZIndexById.get(edgeId);
      const nextZIndex = shouldHover ? EDGE_HOVER_Z_INDEX : previousZIndex;
      if (!shouldHover) {
        hoveredEdgePrevZIndexById.delete(edgeId);
      }

      const classChanged = normalizeEdgeClass(edge.class) !== nextClass;
      const zIndexChanged = edge.zIndex !== nextZIndex;
      const currentStyle = toEdgeStyleRecord(edge.style);
      let nextStyle = edge.style;
      let styleChanged = false;

      if (shouldHover) {
        const baseStroke = getEdgeBaseStroke(edge);
        const currentHoverBaseStroke = currentStyle?.[EDGE_HOVER_BASE_STROKE_VAR];
        if (currentHoverBaseStroke !== baseStroke) {
          nextStyle = {
            ...(currentStyle ?? {}),
            [EDGE_HOVER_BASE_STROKE_VAR]: baseStroke,
          };
          styleChanged = true;
        }
      } else if (currentStyle && EDGE_HOVER_BASE_STROKE_VAR in currentStyle) {
        const entries = Object.entries(currentStyle).filter(([key]) => key !== EDGE_HOVER_BASE_STROKE_VAR);
        nextStyle = entries.length > 0 ? Object.fromEntries(entries) : undefined;
        styleChanged = true;
      }

      if (!classChanged && !zIndexChanged && !styleChanged) {
        return;
      }

      edgeUpdates.set(edge.id, {
        ...edge,
        class: nextClass,
        zIndex: nextZIndex,
        style: nextStyle,
      } as GraphEdge);
    });

    hoveredEdgeIds = new Set(nextHoveredEdgeIds);
    if (edgeUpdates.size > 0) {
      graphStore.updateEdgesById(edgeUpdates);
    }
  };

  // ── Selection management ──

  const clearHoverState = (): void => {
    if (hoveredNodeId.value) {
      restoreHoverZIndex(hoveredNodeId.value);
      hoveredNodeId.value = null;
    }
    applyHoverEdgeHighlight(null);
  };

  const setSelectedNode = (node: DependencyNode | null): void => {
    if (node !== null || selectedNode.value !== null) {
      clearHoverState();
    }

    graphStore.setSelectedNode(node);
    interaction.setSelectionNodeId(node?.id ?? null);
    if (!node) {
      interaction.setCameraMode('free');
      removeSelectedElements();
    }
    if (useCssSelectionHover) {
      return;
    }
    if (selectionHighlightRafId !== null) {
      cancelAnimationFrame(selectionHighlightRafId);
    }
    selectionHighlightRafId = requestAnimationFrame(() => {
      selectionHighlightRafId = null;
      applySelectionHighlight(node);
      applyHoverEdgeHighlight(node ? null : hoveredNodeId.value);
    });
  };

  const reconcileSelectedNodeAfterStructuralChange = (updatedNodes: DependencyNode[]): void => {
    const currentSelection = selectedNode.value;
    if (!currentSelection) {
      return;
    }

    const refreshedSelection = updatedNodes.find((node) => node.id === currentSelection.id) ?? null;
    setSelectedNode(refreshedSelection);
  };

  const dispose = (): void => {
    if (selectionHighlightRafId !== null) {
      cancelAnimationFrame(selectionHighlightRafId);
      selectionHighlightRafId = null;
    }
  };

  return {
    hoveredNodeId,
    visualNodes,
    visualEdges,
    selectionAdjacencyByNodeId,
    selectedConnectedNodeIds,
    selectedConnectedEdgeIds,
    highlightedEdgeIds,
    highlightedEdgeIdList,
    setSelectedNode,
    reconcileSelectedNodeAfterStructuralChange,
    clearHoverState,
    applyHoverEdgeHighlight,
    dispose,
  };
}
