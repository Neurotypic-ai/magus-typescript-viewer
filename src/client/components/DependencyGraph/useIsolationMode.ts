import { nextTick, ref } from 'vue';

import { buildParentMap } from '../../graph/cluster/folderMembership';
import { clusterByFolder } from '../../graph/cluster/folders';
import { applyEdgeHighways } from '../../graph/transforms/edgeHighways';
import { traverseGraph } from '../../graph/traversal';
import { getEdgeStyle } from '../../theme/graphTheme';
import { applyEdgeVisibility, buildSymbolDrilldownGraph, toDependencyEdgeKind } from './buildGraphView';
import { getNodeDims, mergeNodeInteractionStyle, stripNodeClass, waitForNextPaint } from './graphUtils';

import type { Ref } from 'vue';

import type {
  FitView,
  FitViewOptions,
  GraphSnapshot,
  LayoutConfig,
  MeasureAllNodeDimensions,
  ProcessGraphLayout,
  ShouldRunTwoPassMeasure,
} from './useGraphLayout';
import type { DependencyNode, DependencyPackageGraph, GraphEdge } from './types';

// ── Isolate graph store (subset of full graph store) ──

/** Restores the overview snapshot; returns true if restored. */
export type RestoreOverviewSnapshot = () => boolean;

/** Graph store API used by isolation mode (setNodes, setEdges, snapshots, restore). */
export interface IsolateGraphStore {
  setNodes: (nodes: DependencyNode[]) => void;
  setEdges: (edges: GraphEdge[]) => void;
  setViewMode: (mode: string) => void;
  overviewSnapshot: GraphSnapshot | null;
  semanticSnapshot: GraphSnapshot | null;
  restoreOverviewSnapshot: RestoreOverviewSnapshot;
}

/** Graph settings used by isolation mode. */
export interface IsolateGraphSettings {
  clusterByFolder: boolean;
  activeRelationshipTypes: string[];
}

/** Interaction API for scope mode (isolate, symbolDrilldown, overview). */
export interface IsolateInteraction {
  setScopeMode: (mode: string) => void;
  scopeMode: Readonly<Ref<string>>;
}

/** Requests edge virtualization to recalc viewport (optionally force). */
export type RequestEdgeVirtualizationViewportRecalc = (force?: boolean) => void;

/** Sets the currently selected node (or null). */
export type SetSelectedNode = (node: DependencyNode | null) => void;

/** Requests full graph initialization (overview layout). */
export type RequestGraphInitialization = () => Promise<void>;

/** Map of node id → position (x, y). */
export type NodePositionMap = Map<string, { x: number; y: number }>;

/** Layout direction for isolate layout (LR, RL, TB, BT). */
export type LayoutDirection = LayoutConfig['direction'];

export interface UseIsolationModeOptions {
  propsData: Ref<DependencyPackageGraph>;
  nodes: Ref<DependencyNode[]>;
  edges: Ref<GraphEdge[]>;
  graphStore: IsolateGraphStore;
  graphSettings: IsolateGraphSettings;
  interaction: IsolateInteraction;
  layoutConfig: LayoutConfig;
  isLayoutMeasuring: Ref<boolean>;
  fitView: FitView;
  updateNodeInternals: (ids: string[]) => void;
  syncViewportState: () => void;
  requestEdgeVirtualizationViewportRecalc: RequestEdgeVirtualizationViewportRecalc;
  setSelectedNode: SetSelectedNode;
  processGraphLayout: ProcessGraphLayout;
  measureAllNodeDimensions: MeasureAllNodeDimensions;
  shouldRunTwoPassMeasure: ShouldRunTwoPassMeasure;
  requestGraphInitialization: RequestGraphInitialization;
}

/** Isolates the neighborhood of a node (inbound/outbound). */
export type IsolateNeighborhood = (nodeId: string) => Promise<void>;

/** Opens the symbol drilldown graph for a node. */
export type HandleOpenSymbolUsageGraph = (nodeId: string) => Promise<void>;

/** Returns to overview (restore snapshot or re-init). */
export type HandleReturnToOverview = () => Promise<void>;

export interface IsolationMode {
  isIsolateAnimating: Readonly<Ref<boolean>>;
  isolateExpandAll: Ref<boolean>;
  isolateNeighborhood: IsolateNeighborhood;
  handleOpenSymbolUsageGraph: HandleOpenSymbolUsageGraph;
  handleReturnToOverview: HandleReturnToOverview;
  startIsolateAnimation: () => void;
  dispose: () => void;
}

export function useIsolationMode(options: UseIsolationModeOptions): IsolationMode {
  const {
    propsData,
    nodes,
    edges,
    graphStore,
    graphSettings,
    interaction,
    layoutConfig,
    isLayoutMeasuring,
    fitView,
    updateNodeInternals,
    syncViewportState,
    requestEdgeVirtualizationViewportRecalc,
    setSelectedNode,
    processGraphLayout,
    measureAllNodeDimensions,
    shouldRunTwoPassMeasure,
    requestGraphInitialization,
  } = options;

  const isIsolateAnimating = ref(false);
  const isolateExpandAll = ref(false);
  let isolateAnimatingTimer: ReturnType<typeof setTimeout> | null = null;

  const startIsolateAnimation = (): void => {
    if (isolateAnimatingTimer) clearTimeout(isolateAnimatingTimer);
    isIsolateAnimating.value = true;
    isolateAnimatingTimer = setTimeout(() => {
      isIsolateAnimating.value = false;
      isolateAnimatingTimer = null;
    }, 400);
  };

  const computeIsolateLayout = (
    centerNode: DependencyNode,
    inbound: DependencyNode[],
    outbound: DependencyNode[],
    direction: LayoutDirection
  ): NodePositionMap => {
    const allNodes = [centerNode, ...inbound, ...outbound];
    const cx = allNodes.reduce((sum, n) => sum + n.position.x, 0) / allNodes.length;
    const cy = allNodes.reduce((sum, n) => sum + n.position.y, 0) / allNodes.length;

    const centerDims = getNodeDims(centerNode);
    const GAP = 150;
    const STACK_GAP = 40;
    const isHorizontal = direction === 'LR' || direction === 'RL';
    const isReversed = direction === 'RL' || direction === 'BT';

    const beforeNodes = isReversed ? outbound : inbound;
    const afterNodes = isReversed ? inbound : outbound;

    const positions: NodePositionMap = new Map();
    positions.set(centerNode.id, { x: cx, y: cy });

    if (isHorizontal) {
      const stackColumnY = (column: DependencyNode[], alignX: number, alignRight: boolean): void => {
        const totalH = column.reduce((sum, n) => sum + getNodeDims(n).h + STACK_GAP, -STACK_GAP);
        let y = cy + centerDims.h / 2 - totalH / 2;
        for (const node of column) {
          const dims = getNodeDims(node);
          const x = alignRight ? alignX - dims.w : alignX;
          positions.set(node.id, { x, y });
          y += dims.h + STACK_GAP;
        }
      };

      if (beforeNodes.length > 0) {
        const alignX = cx - GAP;
        stackColumnY(beforeNodes, alignX, true);
      }
      if (afterNodes.length > 0) {
        const alignX = cx + centerDims.w + GAP;
        stackColumnY(afterNodes, alignX, false);
      }
    } else {
      const stackRowX = (column: DependencyNode[], alignY: number, alignBottom: boolean): void => {
        const totalW = column.reduce((sum, n) => sum + getNodeDims(n).w + STACK_GAP, -STACK_GAP);
        let x = cx + centerDims.w / 2 - totalW / 2;
        for (const node of column) {
          const dims = getNodeDims(node);
          const y = alignBottom ? alignY - dims.h : alignY;
          positions.set(node.id, { x, y });
          x += dims.w + STACK_GAP;
        }
      };

      if (beforeNodes.length > 0) {
        const alignY = cy - GAP;
        stackRowX(beforeNodes, alignY, true);
      }
      if (afterNodes.length > 0) {
        const alignY = cy + centerDims.h + GAP;
        stackRowX(afterNodes, alignY, false);
      }
    }

    return positions;
  };

  const isolateNeighborhood = async (nodeId: string): Promise<void> => {
    const snapshot = graphStore.overviewSnapshot;
    let sourceNodes = snapshot?.nodes ?? nodes.value;
    let sourceEdges = snapshot?.edges ?? edges.value;
    const semanticSnapshot = graphStore.semanticSnapshot;
    let semanticTraversalNodeIds: Set<string> | null = null;
    let semanticInboundIds: Set<string> | null = null;
    let semanticOutboundIds: Set<string> | null = null;

    if (semanticSnapshot) {
      const semanticResult = traverseGraph(nodeId, {
        maxDepth: 1,
        semanticEdges: semanticSnapshot.edges,
        semanticNodes: semanticSnapshot.nodes,
        parentMap: buildParentMap(semanticSnapshot.nodes),
      });
      semanticTraversalNodeIds = semanticResult.nodeIds;
      semanticInboundIds = semanticResult.inbound;
      semanticOutboundIds = semanticResult.outbound;

      const isolatedSemanticNodes = semanticSnapshot.nodes.filter((node) => semanticResult.nodeIds.has(node.id));
      const isolatedSemanticEdges = semanticResult.edges.filter(
        (edge) => semanticResult.nodeIds.has(edge.source) && semanticResult.nodeIds.has(edge.target)
      );

      if (graphSettings.clusterByFolder) {
        const clustered = clusterByFolder(isolatedSemanticNodes, isolatedSemanticEdges);
        const highwayProjected = applyEdgeHighways(clustered.nodes, clustered.edges, {
          direction: layoutConfig.direction,
        });
        sourceNodes = highwayProjected.nodes;
        sourceEdges = highwayProjected.edges;
      } else {
        sourceNodes = isolatedSemanticNodes;
        sourceEdges = isolatedSemanticEdges;
      }
    }

    const targetNode = sourceNodes.find((node) => node.id === nodeId);
    if (!targetNode) {
      return;
    }

    const nodeById = new Map(sourceNodes.map((n) => [n.id, n]));

    const connectedNodeIds = new Set<string>([nodeId]);
    const inboundIds = new Set<string>();
    const outboundIds = new Set<string>();
    if (semanticTraversalNodeIds) {
      semanticTraversalNodeIds.forEach((id) => {
        if (nodeById.has(id)) {
          connectedNodeIds.add(id);
        }
      });
      semanticInboundIds?.forEach((id) => inboundIds.add(id));
      semanticOutboundIds?.forEach((id) => outboundIds.add(id));
    } else {
      sourceEdges.forEach((edge) => {
        if (edge.source === nodeId) {
          connectedNodeIds.add(edge.target);
          outboundIds.add(edge.target);
        } else if (edge.target === nodeId) {
          connectedNodeIds.add(edge.source);
          inboundIds.add(edge.source);
        }
      });
    }

    // Ensure all ancestor containers are present
    connectedNodeIds.forEach((id) => {
      let parent = nodeById.get(id)?.parentNode;
      while (parent) {
        connectedNodeIds.add(parent);
        parent = nodeById.get(parent)?.parentNode;
      }
    });

    const inbound = [...inboundIds]
      .filter((id) => !outboundIds.has(id))
      .flatMap((id) => {
        const node = nodeById.get(id);
        return node ? [node] : [];
      });
    const outbound = [...outboundIds]
      .filter((id) => !inboundIds.has(id))
      .flatMap((id) => {
        const node = nodeById.get(id);
        return node ? [node] : [];
      });
    const bidirectional = [...inboundIds]
      .filter((id) => outboundIds.has(id))
      .flatMap((id) => {
        const node = nodeById.get(id);
        return node ? [node] : [];
      });

    for (const node of bidirectional) {
      if (inbound.length <= outbound.length) {
        inbound.push(node);
      } else {
        outbound.push(node);
      }
    }

    const isolatedSourceNodes = sourceNodes.filter((node) => connectedNodeIds.has(node.id));
    const styleIsolatedNode = (
      node: DependencyNode,
      layoutPositions?: NodePositionMap
    ) => {
      const baseNode = stripNodeClass(node);
      const layoutPos = layoutPositions?.get(node.id);
      return {
        ...baseNode,
        position: layoutPos ?? baseNode.position,
        selected: node.id === nodeId,
        style: mergeNodeInteractionStyle(baseNode, {
          opacity: node.id === nodeId ? 1 : 0.9,
          borderColor: node.id === nodeId ? '#22d3ee' : undefined,
          borderWidth: node.id === nodeId ? '2px' : undefined,
        }),
      };
    };

    const provisionalNodes = isolatedSourceNodes.map((node) => styleIsolatedNode(node));

    const isolatedEdges = applyEdgeVisibility(
      sourceEdges
        .filter((edge) => connectedNodeIds.has(edge.source) && connectedNodeIds.has(edge.target))
        .map((edge) => ({
          ...edge,
          style: {
            ...getEdgeStyle(toDependencyEdgeKind(edge.data?.type)),
            opacity: 0.9,
            strokeWidth: edge.source === nodeId || edge.target === nodeId ? 3 : 2,
          },
          zIndex: edge.source === nodeId || edge.target === nodeId ? 5 : 1,
        })),
      graphSettings.activeRelationshipTypes
    );

    startIsolateAnimation();
    const previousLayoutMeasuring = isLayoutMeasuring.value;
    isLayoutMeasuring.value = true;
    try {
      graphStore.setNodes(provisionalNodes);
      graphStore.setEdges(isolatedEdges);
      graphStore.setViewMode('isolate');
      interaction.setScopeMode('isolate');
      isolateExpandAll.value = true;

      await nextTick();
      await waitForNextPaint();
      await nextTick();
      await waitForNextPaint();

      const measuredIsolation = measureAllNodeDimensions(provisionalNodes);
      const measuredNodes = measuredIsolation.nodes;
      const measuredNodeById = new Map(measuredNodes.map((node) => [node.id, node]));
      const measuredTargetNode = measuredNodeById.get(nodeId) ?? targetNode;
      const measuredInbound = inbound.map((node) => measuredNodeById.get(node.id) ?? node);
      const measuredOutbound = outbound.map((node) => measuredNodeById.get(node.id) ?? node);
      const layoutPositions = computeIsolateLayout(
        measuredTargetNode,
        measuredInbound,
        measuredOutbound,
        layoutConfig.direction
      );

      const finalizedNodes = measuredNodes.map((node) => styleIsolatedNode(node, layoutPositions));
      graphStore.setNodes(finalizedNodes);
      await nextTick();

      const changedNodeIds = finalizedNodes
        .filter((node) => {
          const prev = provisionalNodes.find((p) => p.id === node.id);
          if (!prev) return true;
          return (
            prev.position.x !== node.position.x ||
            prev.position.y !== node.position.y
          );
        })
        .map((node) => node.id);
      if (changedNodeIds.length > 0) {
        updateNodeInternals(changedNodeIds);
      }

      const finalizedTargetNode = finalizedNodes.find((node) => node.id === nodeId) ?? measuredTargetNode;
      setSelectedNode(finalizedTargetNode);
    } finally {
      isLayoutMeasuring.value = previousLayoutMeasuring;
    }

    const fitOpts: FitViewOptions = {
      duration: 350,
      padding: 0.35,
      nodes: Array.from(connectedNodeIds),
    };
    await fitView(fitOpts);
    syncViewportState();
    requestEdgeVirtualizationViewportRecalc(true);
  };

  const handleOpenSymbolUsageGraph = async (nodeId: string): Promise<void> => {
    const targetNode = nodes.value.find((node) => node.id === nodeId) ?? null;
    if (!targetNode) {
      return;
    }

    setSelectedNode(targetNode);
    graphStore.setViewMode('symbolDrilldown');
    interaction.setScopeMode('symbolDrilldown');

    const symbolGraph = buildSymbolDrilldownGraph({
      data: propsData.value,
      selectedNode: targetNode,
      direction: layoutConfig.direction,
      enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
    });

    await processGraphLayout(symbolGraph, {
      fitViewToResult: true,
      fitPadding: 0.2,
      twoPassMeasure: shouldRunTwoPassMeasure(symbolGraph.nodes.length),
    });
  };

  const handleReturnToOverview = async (): Promise<void> => {
    interaction.setScopeMode('overview');
    graphStore.setViewMode('overview');
    isolateExpandAll.value = false;
    setSelectedNode(null);

    if (graphStore.restoreOverviewSnapshot()) {
      startIsolateAnimation();
      await fitView({ duration: 350, padding: 0.1 });
      syncViewportState();
      requestEdgeVirtualizationViewportRecalc(true);
      return;
    }

    await requestGraphInitialization();
  };

  const dispose = (): void => {
    if (isolateAnimatingTimer) {
      clearTimeout(isolateAnimatingTimer);
      isolateAnimatingTimer = null;
    }
  };

  return {
    isIsolateAnimating,
    isolateExpandAll,
    isolateNeighborhood,
    handleOpenSymbolUsageGraph,
    handleReturnToOverview,
    startIsolateAnimation,
    dispose,
  };
}
