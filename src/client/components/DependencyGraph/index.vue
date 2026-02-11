<script setup lang="ts">
import { Background } from '@vue-flow/background';
import { MarkerType, Panel, Position, VueFlow, applyNodeChanges, useVueFlow } from '@vue-flow/core';
import { computed, onUnmounted, watch } from 'vue';

import { createLogger } from '../../../shared/utils/logger';
import { WebWorkerLayoutProcessor } from '../../layout/WebWorkerLayoutProcessor';
import { useGraphSettings } from '../../stores/graphSettings';
import { useGraphStore } from '../../stores/graphStore';
import { getEdgeStyle, getNodeStyle, graphTheme } from '../../theme/graphTheme';
import { measurePerformance } from '../../utils/performanceMonitoring';
import {
  applyEdgeVisibility,
  buildModuleDrilldownGraph,
  buildOverviewGraph,
  buildSymbolDrilldownGraph,
  filterNodeChangesForFolderMode,
  toDependencyEdgeKind,
} from './buildGraphView';
import GraphControls from './components/GraphControls.vue';
import GraphSearch from './components/GraphSearch.vue';
import NodeDetails from './components/NodeDetails.vue';
import { nodeTypes } from './nodes/nodes';

import type { NodeChange } from '@vue-flow/core';
import type { DependencyKind, DependencyNode, DependencyPackageGraph, GraphEdge, SearchResult } from './types';

import '@vue-flow/core/dist/style.css';

const graphLogger = createLogger('DependencyGraph');

export interface DependencyGraphProps {
  data: DependencyPackageGraph;
}

const props = defineProps<DependencyGraphProps>();

const graphStore = useGraphStore();
const graphSettings = useGraphSettings();
const nodes = computed(() => graphStore['nodes']);
const edges = computed(() => graphStore['edges']);
const selectedNode = computed(() => graphStore['selectedNode']);

const { fitView } = useVueFlow();

let layoutProcessor: WebWorkerLayoutProcessor | null = null;
let layoutRequestVersion = 0;

const DEFAULT_NODE_TYPE_SET = new Set(['module']);

const defaultLayoutConfig = {
  algorithm: 'layered' as 'layered' | 'radial' | 'force' | 'stress',
  direction: 'LR' as 'LR' | 'RL' | 'TB' | 'BT',
  nodeSpacing: 80,
  rankSpacing: 200,
  edgeSpacing: 30,
};
const layoutConfig = { ...defaultLayoutConfig };

const getHandlePositions = (
  direction: 'LR' | 'RL' | 'TB' | 'BT'
): { sourcePosition: Position; targetPosition: Position } => {
  switch (direction) {
    case 'LR':
      return { sourcePosition: Position.Right, targetPosition: Position.Left };
    case 'RL':
      return { sourcePosition: Position.Left, targetPosition: Position.Right };
    case 'TB':
      return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
    case 'BT':
      return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
  }
};

const getEnabledNodeTypes = (): Set<string> => {
  const configuredTypes = graphSettings.enabledNodeTypes.length
    ? graphSettings.enabledNodeTypes
    : Array.from(DEFAULT_NODE_TYPE_SET);

  const typeSet = new Set(configuredTypes);
  if (typeSet.size === 0) {
    typeSet.add('module');
  }
  return typeSet;
};

const mergeNodeInteractionStyle = (
  node: DependencyNode,
  interactionStyle: Record<string, string | number | undefined>
): Record<string, string | number | undefined> => {
  const currentStyle = typeof node.style === 'object' ? (node.style as Record<string, string | number | undefined>) : {};
  const baseStyle = getNodeStyle(node.type as DependencyKind);

  const preservedSizing = {
    width: currentStyle['width'],
    height: currentStyle['height'],
    minWidth: currentStyle['minWidth'],
    minHeight: currentStyle['minHeight'],
    maxWidth: currentStyle['maxWidth'],
    maxHeight: currentStyle['maxHeight'],
    overflow: currentStyle['overflow'],
    zIndex: currentStyle['zIndex'],
  };

  return {
    ...baseStyle,
    ...preservedSizing,
    ...interactionStyle,
  };
};

const initializeLayoutProcessor = () => {
  layoutRequestVersion += 1;

  if (layoutProcessor) {
    layoutProcessor.dispose();
  }

  layoutProcessor = new WebWorkerLayoutProcessor({
    algorithm: layoutConfig.algorithm,
    direction: layoutConfig.direction,
    nodeSpacing: layoutConfig.nodeSpacing,
    rankSpacing: layoutConfig.rankSpacing,
    edgeSpacing: layoutConfig.edgeSpacing,
    theme: graphTheme,
    animationDuration: 150,
  });
};

onUnmounted(() => {
  if (layoutProcessor) {
    layoutProcessor.dispose();
    layoutProcessor = null;
  }
});

const processGraphLayout = async (graphData: { nodes: DependencyNode[]; edges: GraphEdge[] }) => {
  if (!layoutProcessor) return null;
  const requestVersion = ++layoutRequestVersion;

  try {
    performance.mark('layout-start');

    const result = await layoutProcessor.processLayout(graphData);
    if (requestVersion !== layoutRequestVersion) {
      return null;
    }

    const typedNodes = result.nodes as unknown as DependencyNode[];
    const typedEdges = result.edges as unknown as GraphEdge[];

    const { sourcePosition, targetPosition } = getHandlePositions(layoutConfig.direction);
    const nodesWithCorrectHandles = typedNodes.map((node) => ({
      ...node,
      sourcePosition,
      targetPosition,
    }));

    graphStore['setNodes'](nodesWithCorrectHandles);
    graphStore['setEdges'](typedEdges);

    if (requestVersion !== layoutRequestVersion) {
      return null;
    }

    await fitView({ duration: 150, padding: 0.1 });

    performance.mark('layout-end');
    measurePerformance('graph-layout', 'layout-start', 'layout-end');

    return {
      nodes: nodesWithCorrectHandles,
      edges: typedEdges,
    };
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error during layout processing');
    graphLogger.error('Layout processing failed:', error);
    return null;
  }
};

const initializeGraph = async () => {
  performance.mark('graph-init-start');
  graphStore.setViewMode('overview');
  initializeLayoutProcessor();

  const overviewGraph = buildOverviewGraph({
    data: props.data,
    enabledNodeTypes: getEnabledNodeTypes(),
    enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
    direction: layoutConfig.direction,
    clusterByFolder: graphSettings.clusterByFolder,
    collapseScc: graphSettings.collapseScc,
  });

  const layoutResult = await processGraphLayout(overviewGraph);
  if (layoutResult) {
    graphStore.setOverviewSnapshot(layoutResult);
  }

  performance.mark('graph-init-end');
  measurePerformance('graph-initialization', 'graph-init-start', 'graph-init-end');
};

watch(() => props.data, initializeGraph, { immediate: true });

const onNodeClick = ({ node }: { node: unknown }): void => {
  const clickedNode = node as DependencyNode;
  graphStore['setSelectedNode'](clickedNode);

  const connectedNodeIds = new Set<string>([clickedNode.id]);
  edges.value.forEach((edge: GraphEdge) => {
    if (edge.source === clickedNode.id) {
      connectedNodeIds.add(edge.target);
    } else if (edge.target === clickedNode.id) {
      connectedNodeIds.add(edge.source);
    }
  });

  graphStore['setNodes'](
    nodes.value.map((n: DependencyNode) => {
      const isConnected = connectedNodeIds.has(n.id);
      const isClicked = n.id === clickedNode.id;

      return {
        ...n,
        style: mergeNodeInteractionStyle(n, {
          opacity: isConnected ? 1 : 0.3,
          borderWidth: isClicked ? '3px' : isConnected ? '2px' : '1px',
          borderColor: isClicked ? '#00ffff' : isConnected ? '#61dafb' : undefined,
        }),
      };
    })
  );

  const highlightedEdges = edges.value.map((edge: GraphEdge) => {
    const isConnected = edge.source === clickedNode.id || edge.target === clickedNode.id;

    return {
      ...edge,
      style: {
        ...getEdgeStyle(toDependencyEdgeKind(edge.data?.type)),
        opacity: isConnected ? 1 : 0.2,
        strokeWidth: isConnected ? 3 : 1,
      },
      animated: isConnected,
    };
  });

  graphStore['setEdges'](applyEdgeVisibility(highlightedEdges, graphSettings.activeRelationshipTypes));
};

const onNodeDoubleClick = async ({ node }: { node: unknown }): Promise<void> => {
  const targetNode = node as DependencyNode;
  graphStore['setSelectedNode'](targetNode);

  if (targetNode.type === 'module') {
    graphStore.setViewMode('moduleDrilldown');
    const detailedGraph = buildModuleDrilldownGraph({
      data: props.data,
      selectedNode: targetNode,
      currentNodes: nodes.value,
      currentEdges: edges.value,
      direction: layoutConfig.direction,
      enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
    });

    await processGraphLayout(detailedGraph);
    await fitView({ duration: 300, padding: 0.2 });
    return;
  }

  const connectedNodeIds = new Set<string>([targetNode.id]);
  const connectedEdges: GraphEdge[] = [];

  edges.value.forEach((edge: GraphEdge) => {
    if (edge.source === targetNode.id) {
      connectedNodeIds.add(edge.target);
      connectedEdges.push(edge);
    } else if (edge.target === targetNode.id) {
      connectedNodeIds.add(edge.source);
      connectedEdges.push(edge);
    }
  });

  const focusedNodes = nodes.value
    .filter((graphNode: DependencyNode) => connectedNodeIds.has(graphNode.id))
    .map((graphNode: DependencyNode) => ({
      ...graphNode,
      style: {
        ...graphNode.style,
        borderWidth: graphNode.id === targetNode.id ? '3px' : '2px',
        borderColor: graphNode.id === targetNode.id ? '#00ffff' : '#61dafb',
      },
    }));

  const focusedEdges = applyEdgeVisibility(
    connectedEdges.map((edge: GraphEdge) => ({
      ...edge,
      style: {
        ...edge.style,
        stroke: '#00ffff',
        strokeWidth: 4,
        opacity: 1,
      },
      animated: true,
    })),
    graphSettings.activeRelationshipTypes
  );

  await processGraphLayout({
    nodes: focusedNodes,
    edges: focusedEdges,
  });

  await fitView({
    duration: 300,
    padding: 0.3,
    nodes: Array.from(connectedNodeIds),
  });
};

const handleOpenSymbolUsageGraph = async (nodeId: string): Promise<void> => {
  const targetNode = nodes.value.find((node) => node.id === nodeId) ?? selectedNode.value;
  if (!targetNode) {
    return;
  }

  graphStore['setSelectedNode'](targetNode);
  graphStore.setViewMode('symbolDrilldown');

  const symbolGraph = buildSymbolDrilldownGraph({
    data: props.data,
    selectedNode: targetNode,
    direction: layoutConfig.direction,
    enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
  });

  await processGraphLayout(symbolGraph);
  await fitView({ duration: 300, padding: 0.2 });
};

const onPaneClick = async (): Promise<void> => {
  graphStore['setSelectedNode'](null);
  graphStore.setViewMode('overview');

  if (graphStore.restoreOverviewSnapshot()) {
    await fitView({ duration: 150, padding: 0.1 });
    return;
  }

  await initializeGraph();
};

const handleResetLayout = async (): Promise<void> => {
  layoutConfig.algorithm = defaultLayoutConfig.algorithm;
  layoutConfig.direction = defaultLayoutConfig.direction;
  layoutConfig.nodeSpacing = defaultLayoutConfig.nodeSpacing;
  layoutConfig.rankSpacing = defaultLayoutConfig.rankSpacing;
  layoutConfig.edgeSpacing = defaultLayoutConfig.edgeSpacing;

  graphStore.setViewMode('overview');
  await initializeGraph();
};

const handleRelationshipFilterChange = (types: string[]) => {
  graphSettings.setEnabledRelationshipTypes(types);
  graphStore['setEdges'](applyEdgeVisibility(edges.value, graphSettings.activeRelationshipTypes));
};

const handleNodeTypeFilterChange = async (types: string[]) => {
  graphSettings.setEnabledNodeTypes(types);
  graphStore.setViewMode('overview');
  graphStore['setSelectedNode'](null);
  await initializeGraph();
};

const handleCollapseSccToggle = async (value: boolean) => {
  if (graphSettings.clusterByFolder && value) {
    graphSettings.setCollapseScc(false);
    return;
  }
  graphSettings.setCollapseScc(value);
  graphStore.setViewMode('overview');
  await initializeGraph();
};

const handleClusterByFolderToggle = async (value: boolean) => {
  if (value && graphSettings.collapseScc) {
    graphSettings.setCollapseScc(false);
  }
  graphSettings.setClusterByFolder(value);
  graphStore.setViewMode('overview');
  await initializeGraph();
};

const handleNodesChange = (changes: NodeChange[]) => {
  if (!changes.length) return;

  const filteredChanges = filterNodeChangesForFolderMode(changes, nodes.value, graphSettings.clusterByFolder);
  if (!filteredChanges.length) return;

  const updatedNodes = applyNodeChanges(filteredChanges, nodes.value as unknown as never[]) as unknown as DependencyNode[];
  graphStore['setNodes'](updatedNodes);
};

const handleLayoutChange = async (config: {
  algorithm?: string;
  direction?: string;
  nodeSpacing?: number;
  rankSpacing?: number;
}) => {
  if (config.algorithm) {
    layoutConfig.algorithm = config.algorithm as 'layered' | 'radial' | 'force' | 'stress';
  }
  if (config.direction) {
    layoutConfig.direction = config.direction as 'LR' | 'RL' | 'TB' | 'BT';
  }
  if (config.nodeSpacing !== undefined) {
    layoutConfig.nodeSpacing = config.nodeSpacing;
  }
  if (config.rankSpacing !== undefined) {
    layoutConfig.rankSpacing = config.rankSpacing;
  }

  graphStore.setViewMode('overview');
  await initializeGraph();
};

const handleSearchResult = (result: SearchResult) => {
  let searchedNodes = nodes.value.map((node: DependencyNode) => ({
    ...node,
    selected: result.nodes.some((searchNode) => searchNode.id === node.id),
    style: mergeNodeInteractionStyle(node, {
      opacity: result.nodes.length === 0 ? 1 : result.nodes.some((searchNode) => searchNode.id === node.id) ? 1 : 0.2,
    }),
  }));

  if (result.path) {
    searchedNodes = searchedNodes.map((node: DependencyNode) => ({
      ...node,
      selected: result.nodes.some((searchNode) => searchNode.id === node.id),
      style: mergeNodeInteractionStyle(node, {
        opacity: result.path?.some((pathNode) => pathNode.id === node.id) ? 1 : 0.2,
        borderWidth: result.path?.some((pathNode) => pathNode.id === node.id)
          ? graphTheme.edges.sizes.width.selected
          : graphTheme.edges.sizes.width.default,
      }),
    }));
  }

  graphStore['setNodes'](searchedNodes);

  const searchedEdges = edges.value.map((edge: GraphEdge) => ({
    ...edge,
    selected: result.edges.some((searchEdge) => searchEdge.id === edge.id),
    style: {
      ...getEdgeStyle(toDependencyEdgeKind(edge.data?.type)),
      opacity: result.edges.length === 0 ? 1 : result.edges.some((searchEdge) => searchEdge.id === edge.id) ? 1 : 0.2,
    },
  }));

  graphStore['setEdges'](applyEdgeVisibility(searchedEdges, graphSettings.activeRelationshipTypes));
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (
    selectedNode.value &&
    (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'ArrowDown')
  ) {
    event.preventDefault();
    const connectedEdges = edges.value.filter(
      (edge: GraphEdge) => edge.source === selectedNode.value?.id || edge.target === selectedNode.value?.id
    );
    if (connectedEdges.length > 0) {
      let nextNodeId: string | undefined;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        if (connectedEdges[0]) {
          nextNodeId =
            connectedEdges[0].source === selectedNode.value.id ? connectedEdges[0].target : connectedEdges[0].source;
        }
      } else {
        const lastEdge = connectedEdges[connectedEdges.length - 1];
        if (lastEdge) {
          nextNodeId = lastEdge.source === selectedNode.value.id ? lastEdge.target : lastEdge.source;
        }
      }
      if (nextNodeId) {
        const nextNode = nodes.value.find((node: DependencyNode) => node.id === nextNodeId);
        if (nextNode) {
          graphStore['setSelectedNode'](nextNode);
          void fitView({
            nodes: [nextNode.id],
            duration: 150,
            padding: 0.5,
          });
        }
      }
    }
  }
};
</script>

<template>
  <div
    class="h-full w-full"
    role="application"
    aria-label="TypeScript dependency graph visualization"
    tabindex="0"
    @keydown="handleKeyDown"
  >
    <VueFlow
      :nodes="nodes"
      :edges="edges"
      :node-types="nodeTypes as any"
      :fit-view-on-init="true"
      :min-zoom="0.1"
      :max-zoom="2"
      :default-viewport="{ x: 0, y: 0, zoom: 0.5 }"
      :snap-to-grid="true"
      :snap-grid="[15, 15]"
      :pan-on-scroll="true"
      :zoom-on-scroll="true"
      :zoom-on-double-click="false"
      :elevate-edges-on-select="true"
      :default-edge-options="{
        style: { stroke: '#61dafb', strokeWidth: 3 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
        zIndex: 1000,
        type: 'step',
      }"
      @node-click="onNodeClick"
      @node-double-click="onNodeDoubleClick"
      @pane-click="onPaneClick"
      @nodes-change="handleNodesChange"
    >
      <Background />
      <GraphControls
        :relationship-availability="graphSettings.relationshipAvailability"
        @relationship-filter-change="handleRelationshipFilterChange"
        @node-type-filter-change="handleNodeTypeFilterChange"
        @layout-change="handleLayoutChange"
        @reset-layout="handleResetLayout"
        @toggle-collapse-scc="handleCollapseSccToggle"
        @toggle-cluster-folder="handleClusterByFolderToggle"
      />
      <GraphSearch @search-result="handleSearchResult" :nodes="nodes" :edges="edges" />
      <NodeDetails
        v-if="selectedNode"
        :node="selectedNode"
        :data="props.data"
        :nodes="nodes"
        :edges="edges"
        @open-symbol-usage="handleOpenSymbolUsageGraph"
      />

      <Panel v-if="selectedNode" position="bottom-left">
        <button
          @click="onPaneClick"
          class="px-4 py-2 bg-primary-main text-white rounded-md hover:bg-primary-dark transition-colors shadow-lg border border-primary-light"
          aria-label="Return to full graph view"
        >
          ← Back to Full Graph
        </button>
      </Panel>
    </VueFlow>
  </div>
</template>
