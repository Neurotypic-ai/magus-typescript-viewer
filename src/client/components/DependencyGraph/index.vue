<script setup lang="ts">
import { Background } from '@vue-flow/background';
import { Controls } from '@vue-flow/controls';
import { MarkerType, Panel, Position, VueFlow, applyNodeChanges, useVueFlow } from '@vue-flow/core';
import { MiniMap } from '@vue-flow/minimap';
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue';

import { createLogger } from '../../../shared/utils/logger';
import { WebWorkerLayoutProcessor } from '../../layout/WebWorkerLayoutProcessor';
import { useGraphSettings } from '../../stores/graphSettings';
import { useGraphStore } from '../../stores/graphStore';
import { getEdgeStyle, getNodeStyle, graphTheme } from '../../theme/graphTheme';
import { measurePerformance } from '../../utils/performanceMonitoring';
import {
  applyEdgeVisibility,
  buildOverviewGraph,
  buildSymbolDrilldownGraph,
  filterNodeChangesForFolderMode,
  toDependencyEdgeKind,
} from './buildGraphView';
import GraphControls from './components/GraphControls.vue';
import GraphMiniMap from './components/GraphMiniMap.vue';
import GraphSearch from './components/GraphSearch.vue';
import NodeDetails from './components/NodeDetails.vue';
import { nodeTypes } from './nodes/nodes';
import { NODE_ACTIONS_KEY } from './nodes/utils';
import { useGraphInteractionController } from './useGraphInteractionController';
import { classifyWheelIntent, isMacPlatform } from './utils/wheelIntent';

import type { NodeChange } from '@vue-flow/core';

import type { DependencyKind, DependencyNode, DependencyPackageGraph, GraphEdge, SearchResult } from './types';

import '@vue-flow/controls/dist/style.css';
import '@vue-flow/core/dist/style.css';
import '@vue-flow/minimap/dist/style.css';

const graphLogger = createLogger('DependencyGraph');

export interface DependencyGraphProps {
  data: DependencyPackageGraph;
}

interface LayoutProcessOptions {
  fitViewToResult?: boolean;
  fitPadding?: number;
  fitNodes?: string[];
  twoPassMeasure?: boolean;
}

const props = defineProps<DependencyGraphProps>();

const graphStore = useGraphStore();
const graphSettings = useGraphSettings();
const interaction = useGraphInteractionController();

const nodes = computed(() => graphStore['nodes']);
const edges = computed(() => graphStore['edges']);
const selectedNode = computed(() => graphStore['selectedNode']);
const scopeMode = computed(() => interaction.scopeMode.value);
const isLayoutPending = ref(false);

const { fitView, updateNodeInternals, panBy, zoomTo, getViewport, setViewport } = useVueFlow();

const isMac = computed(() => isMacPlatform());
const graphRootRef = ref<HTMLElement | null>(null);

let layoutProcessor: WebWorkerLayoutProcessor | null = null;
let layoutRequestVersion = 0;

const DEFAULT_NODE_TYPE_SET = new Set(['module']);
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.5 };

const useBuiltinMinimap = import.meta.env['VITE_USE_BUILTIN_MINIMAP'] === 'true';

const minimapNodeColor = (node: { type?: string }): string => {
  if (node.type === 'package') return 'rgba(20, 184, 166, 0.55)';
  if (node.type === 'module') return 'rgba(59, 130, 246, 0.5)';
  if (node.type === 'class' || node.type === 'interface') return 'rgba(217, 119, 6, 0.45)';
  return 'rgba(148, 163, 184, 0.4)';
};

const minimapNodeStrokeColor = (node: { id?: string }): string => {
  return node.id === selectedNode.value?.id ? '#22d3ee' : 'rgba(226, 232, 240, 0.5)';
};

const handleMinimapNodeClick = (params: { node: { id: string } }): void => {
  void handleFocusNode(params.node.id);
};

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
  const currentStyle =
    typeof node.style === 'object' ? (node.style as Record<string, string | number | undefined>) : {};
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

const applySelectionHighlight = (selected: DependencyNode | null): void => {
  // Isolation mode manages its own styles
  if (interaction.scopeMode.value === 'isolate') return;

  const connectedNodeIds = new Set<string>();
  const connectedEdgeIds = new Set<string>();

  if (selected) {
    connectedNodeIds.add(selected.id);
    for (const edge of edges.value) {
      if (!edge.hidden && (edge.source === selected.id || edge.target === selected.id)) {
        connectedEdgeIds.add(edge.id);
        connectedNodeIds.add(edge.source);
        connectedNodeIds.add(edge.target);
      }
    }
  }

  const hasSelection = selected !== null;

  const updatedNodes = nodes.value.map((node) => {
    let nodeClass: string | undefined;

    if (hasSelection) {
      if (node.id === selected.id) nodeClass = 'selection-target';
      else if (connectedNodeIds.has(node.id)) nodeClass = 'selection-connected';
      else nodeClass = 'selection-dimmed';
    }

    if (node.class === nodeClass) return node;
    return { ...node, class: nodeClass };
  });

  const updatedEdges = edges.value.map((edge) => {
    let edgeClass: string | undefined;
    if (hasSelection) {
      edgeClass = connectedEdgeIds.has(edge.id) ? 'edge-selection-highlighted' : 'edge-selection-dimmed';
    }
    if (edge.class === edgeClass) return edge;
    return { ...edge, class: edgeClass };
  });

  graphStore['setNodes'](updatedNodes);
  graphStore['setEdges'](updatedEdges);
};

const setSelectedNode = (node: DependencyNode | null) => {
  graphStore['setSelectedNode'](node);
  interaction.setSelectionNodeId(node?.id ?? null);
  if (!node) {
    interaction.setCameraMode('free');
  }
  applySelectionHighlight(node);
};

const measureLayoutInsets = (layoutedNodes: DependencyNode[]): { nodes: DependencyNode[]; hasChanges: boolean } => {
  const domNodes = Array.from(document.querySelectorAll<HTMLElement>('.vue-flow__node'));
  const elementById = new Map<string, HTMLElement>();
  domNodes.forEach((element) => {
    const id = element.getAttribute('data-id');
    if (id) {
      elementById.set(id, element);
    }
  });

  let hasChanges = false;
  const measuredNodes = layoutedNodes.map((node) => {
    const shouldMeasure =
      node.type === 'module' ||
      node.type === 'package' ||
      node.type === 'group' ||
      node.type === 'class' ||
      node.type === 'interface';
    if (!shouldMeasure) {
      return node;
    }

    const element = elementById.get(node.id);
    if (!element) {
      return node;
    }

    // offset* metrics are unscaled by viewport zoom, unlike getBoundingClientRect.
    const measuredWidth = element.offsetWidth;
    const measuredHeight = element.offsetHeight;
    const headerHeight = element.querySelector<HTMLElement>('.base-node-header')?.offsetHeight ?? 0;
    const bodyHeight = element.querySelector<HTMLElement>('.base-node-body')?.offsetHeight ?? 0;
    const subnodeSectionHeight = element.querySelector<HTMLElement>('.base-node-subnodes')?.offsetHeight ?? 0;

    // Reserve full visible top content so nested children never overlap card sections.
    const measuredTopInset = Math.max(96, Math.round(headerHeight + bodyHeight + subnodeSectionHeight + 12));

    const currentTopInset = (node.data?.layoutInsets as { top?: number } | undefined)?.top ?? 0;
    const currentMeasured = (node as unknown as { measured?: { width?: number; height?: number } }).measured;
    const widthDelta = Math.abs((currentMeasured?.width ?? 0) - measuredWidth);
    const heightDelta = Math.abs((currentMeasured?.height ?? 0) - measuredHeight);
    const insetDelta = Math.abs(currentTopInset - measuredTopInset);
    const changed = widthDelta > 1 || heightDelta > 1 || insetDelta > 1;

    if (!changed) {
      return node;
    }

    hasChanges = true;
    return {
      ...node,
      data: {
        ...node.data,
        layoutInsets: {
          top: measuredTopInset,
        },
      },
      measured: {
        width: measuredWidth,
        height: measuredHeight,
      },
    } as DependencyNode;
  });

  return {
    nodes: measuredNodes,
    hasChanges,
  };
};

const normalizeLayoutResult = (
  resultNodes: DependencyNode[],
  resultEdges: GraphEdge[]
): { nodes: DependencyNode[]; edges: GraphEdge[] } => {
  const { sourcePosition, targetPosition } = getHandlePositions(layoutConfig.direction);

  const nodesWithHandles = resultNodes.map((node) => ({
    ...node,
    sourcePosition,
    targetPosition,
  }));

  return {
    nodes: nodesWithHandles,
    edges: resultEdges,
  };
};

const processGraphLayout = async (
  graphData: { nodes: DependencyNode[]; edges: GraphEdge[] },
  options: LayoutProcessOptions = {}
) => {
  if (!layoutProcessor) {
    return null;
  }

  const requestVersion = ++layoutRequestVersion;
  const fitViewToResult = options.fitViewToResult ?? true;
  const fitPadding = options.fitPadding ?? 0.1;
  const twoPassMeasure = options.twoPassMeasure ?? true;

  isLayoutPending.value = true;

  try {
    performance.mark('layout-start');

    const firstPassResult = await layoutProcessor.processLayout(graphData);
    if (requestVersion !== layoutRequestVersion) {
      return null;
    }

    let normalized = normalizeLayoutResult(
      firstPassResult.nodes as unknown as DependencyNode[],
      firstPassResult.edges as unknown as GraphEdge[]
    );

    graphStore['setNodes'](normalized.nodes);
    graphStore['setEdges'](normalized.edges);

    await nextTick();
    updateNodeInternals(normalized.nodes.map((node) => node.id));

    if (twoPassMeasure) {
      const measured = measureLayoutInsets(normalized.nodes);
      if (measured.hasChanges) {
        const secondPassResult = await layoutProcessor.processLayout({
          nodes: measured.nodes,
          edges: normalized.edges,
        });
        if (requestVersion !== layoutRequestVersion) {
          return null;
        }

        normalized = normalizeLayoutResult(
          secondPassResult.nodes as unknown as DependencyNode[],
          secondPassResult.edges as unknown as GraphEdge[]
        );

        graphStore['setNodes'](normalized.nodes);
        graphStore['setEdges'](normalized.edges);
        await nextTick();
        updateNodeInternals(normalized.nodes.map((node) => node.id));
      }
    }

    if (fitViewToResult) {
      if (options.fitNodes && options.fitNodes.length > 0) {
        await fitView({
          duration: 180,
          padding: fitPadding,
          nodes: options.fitNodes,
        });
      } else {
        await fitView({
          duration: 180,
          padding: fitPadding,
        });
      }
    }

    performance.mark('layout-end');
    measurePerformance('graph-layout', 'layout-start', 'layout-end');

    return normalized;
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error during layout processing');
    graphLogger.error('Layout processing failed:', error);
    return null;
  } finally {
    if (requestVersion === layoutRequestVersion) {
      isLayoutPending.value = false;
    }
  }
};

const initializeGraph = async () => {
  performance.mark('graph-init-start');
  interaction.resetInteraction();
  graphStore.setViewMode('overview');
  initializeLayoutProcessor();

  const overviewGraph = buildOverviewGraph({
    data: props.data,
    enabledNodeTypes: getEnabledNodeTypes(),
    enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
    direction: layoutConfig.direction,
    clusterByFolder: graphSettings.clusterByFolder,
    collapseScc: graphSettings.collapseScc,
    hideTestFiles: graphSettings.hideTestFiles,
    memberNodeMode: graphSettings.memberNodeMode,
    highlightOrphanGlobal: graphSettings.highlightOrphanGlobal,
  });

  const layoutResult = await processGraphLayout(overviewGraph, {
    fitViewToResult: true,
    fitPadding: 0.1,
    twoPassMeasure: true,
  });
  if (layoutResult) {
    graphStore.setOverviewSnapshot(layoutResult);
  }

  performance.mark('graph-init-end');
  measurePerformance('graph-initialization', 'graph-init-start', 'graph-init-end');
};

watch(() => props.data, initializeGraph, { immediate: true });

const onNodeClick = ({ node }: { node: unknown }): void => {
  const clickedNode = node as DependencyNode;
  setSelectedNode(clickedNode);
};

const handleFocusNode = async (nodeId: string): Promise<void> => {
  const targetNode = nodes.value.find((node) => node.id === nodeId);
  if (!targetNode) {
    return;
  }

  setSelectedNode(targetNode);
  interaction.setCameraMode('fitSelection');

  await fitView({
    nodes: [nodeId],
    duration: 180,
    padding: 0.4,
  });
};

const isolateNeighborhood = async (nodeId: string): Promise<void> => {
  const snapshot = graphStore.overviewSnapshot;
  const sourceNodes = snapshot?.nodes ?? nodes.value;
  const sourceEdges = snapshot?.edges ?? edges.value;
  const targetNode = sourceNodes.find((node) => node.id === nodeId);
  if (!targetNode) {
    return;
  }

  const connectedNodeIds = new Set<string>([nodeId]);
  sourceEdges.forEach((edge) => {
    if (edge.source === nodeId) {
      connectedNodeIds.add(edge.target);
    } else if (edge.target === nodeId) {
      connectedNodeIds.add(edge.source);
    }
  });

  const isolatedNodes = sourceNodes
    .filter((node) => connectedNodeIds.has(node.id))
    .map((node) => ({
      ...node,
      class: undefined,
      style: mergeNodeInteractionStyle(node, {
        opacity: node.id === nodeId ? 1 : 0.9,
        borderColor: node.id === nodeId ? '#22d3ee' : undefined,
        borderWidth: node.id === nodeId ? '2px' : undefined,
      }),
    }));

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

  graphStore['setNodes'](isolatedNodes);
  graphStore['setEdges'](isolatedEdges);
  graphStore.setViewMode('isolate');
  interaction.setScopeMode('isolate');
  setSelectedNode(targetNode);

  await fitView({
    duration: 200,
    padding: 0.35,
    nodes: Array.from(connectedNodeIds),
  });
};

// Provide node actions to child nodes via injection (replaces global CustomEvent)
provide(NODE_ACTIONS_KEY, {
  focusNode: (nodeId: string) => void handleFocusNode(nodeId),
  isolateNeighborhood: (nodeId: string) => void isolateNeighborhood(nodeId),
});

const handleOpenSymbolUsageGraph = async (nodeId: string): Promise<void> => {
  const targetNode = nodes.value.find((node) => node.id === nodeId) ?? selectedNode.value;
  if (!targetNode) {
    return;
  }

  setSelectedNode(targetNode);
  graphStore.setViewMode('symbolDrilldown');
  interaction.setScopeMode('symbolDrilldown');

  const symbolGraph = buildSymbolDrilldownGraph({
    data: props.data,
    selectedNode: targetNode,
    direction: layoutConfig.direction,
    enabledRelationshipTypes: graphSettings.activeRelationshipTypes,
  });

  await processGraphLayout(symbolGraph, {
    fitViewToResult: true,
    fitPadding: 0.2,
    twoPassMeasure: true,
  });
};

const onPaneClick = (): void => {
  setSelectedNode(null);
};

const handleWheel = (event: WheelEvent): void => {
  if (!isMac.value) return;

  const intent = classifyWheelIntent(event);
  const target = event.target as HTMLElement;

  // Pinch-to-zoom: prevent browser page zoom everywhere, handle graph zoom ourselves
  if (intent === 'pinch') {
    event.preventDefault();
    const vp = getViewport();
    const factor = event.deltaY > 0 ? 0.95 : 1.05;
    const newZoom = Math.max(0.1, Math.min(2, vp.zoom * factor));
    const container = graphRootRef.value?.querySelector('.vue-flow') as HTMLElement | null;
    if (container) {
      const rect = container.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const scale = newZoom / vp.zoom;
      void setViewport(
        { x: cursorX - (cursorX - vp.x) * scale, y: cursorY - (cursorY - vp.y) * scale, zoom: newZoom },
        { duration: 0 }
      );
    } else {
      void zoomTo(newZoom, { duration: 50 });
    }
    return;
  }

  // Allow normal scrolling inside scrollable overlay panels (e.g. NodeDetails)
  if (target.closest('[data-graph-overlay-scrollable]')) return;

  event.preventDefault();

  if (intent === 'trackpadScroll') {
    panBy({ x: -event.deltaX, y: -event.deltaY });
  } else {
    const currentZoom = getViewport().zoom;
    const factor = event.deltaY > 0 ? 0.92 : 1.08;
    void zoomTo(Math.max(0.1, Math.min(2, currentZoom * factor)), { duration: 50 });
  }
};

const handleReturnToOverview = async (): Promise<void> => {
  interaction.setScopeMode('overview');
  graphStore.setViewMode('overview');
  setSelectedNode(null);

  if (graphStore.restoreOverviewSnapshot()) {
    await fitView({ duration: 180, padding: 0.1 });
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

  await initializeGraph();
};

const handleResetView = async (): Promise<void> => {
  interaction.setCameraMode('free');
  setSelectedNode(null);
};

const handleRelationshipFilterChange = async (types: string[]) => {
  graphSettings.setEnabledRelationshipTypes(types);
  await initializeGraph();
};

const handleNodeTypeFilterChange = async (types: string[]) => {
  graphSettings.setEnabledNodeTypes(types);
  setSelectedNode(null);
  await initializeGraph();
};

const handleCollapseSccToggle = async (value: boolean) => {
  if (graphSettings.clusterByFolder && value) {
    graphSettings.setCollapseScc(false);
    return;
  }
  graphSettings.setCollapseScc(value);
  await initializeGraph();
};

const handleClusterByFolderToggle = async (value: boolean) => {
  if (value && graphSettings.collapseScc) {
    graphSettings.setCollapseScc(false);
  }
  graphSettings.setClusterByFolder(value);
  await initializeGraph();
};

const handleHideTestFilesToggle = async (value: boolean) => {
  graphSettings.setHideTestFiles(value);
  await initializeGraph();
};

const handleMemberNodeModeChange = async (value: 'compact' | 'graph') => {
  graphSettings.setMemberNodeMode(value);
  await initializeGraph();
};

const handleOrphanGlobalToggle = async (value: boolean) => {
  graphSettings.setHighlightOrphanGlobal(value);
  await initializeGraph();
};

const handleNodesChange = (changes: NodeChange[]) => {
  if (!changes.length) return;

  const filteredChanges = filterNodeChangesForFolderMode(changes, nodes.value, graphSettings.clusterByFolder);
  if (!filteredChanges.length) return;

  const updatedNodes = applyNodeChanges(
    filteredChanges,
    nodes.value as unknown as never[]
  ) as unknown as DependencyNode[];
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

  await initializeGraph();
};

const handleSearchResult = (result: SearchResult) => {
  let searchedNodes = nodes.value.map((node: DependencyNode) => ({
    ...node,
    class: undefined,
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
    class: undefined,
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
          setSelectedNode(nextNode);
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

// --- Hover z-index elevation (direct DOM for performance) ---
let hoveredNodeId: string | null = null;
const HOVER_Z = '9999';

const elevateNodeAndChildren = (nodeId: string): void => {
  const root = graphRootRef.value;
  if (!root) return;

  const el = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (el) {
    el.dataset['prevZ'] = el.style.zIndex;
    el.style.zIndex = HOVER_Z;
  }
  for (const n of nodes.value) {
    if (n.parentNode === nodeId) {
      const child = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(n.id)}"]`);
      if (child) {
        child.dataset['prevZ'] = child.style.zIndex;
        child.style.zIndex = HOVER_Z;
      }
    }
  }
};

const restoreHoverZIndex = (nodeId: string): void => {
  const root = graphRootRef.value;
  if (!root) return;

  const el = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(nodeId)}"]`);
  if (el?.dataset['prevZ'] !== undefined) {
    el.style.zIndex = el.dataset['prevZ'];
    delete el.dataset['prevZ'];
  }
  for (const n of nodes.value) {
    if (n.parentNode === nodeId) {
      const child = root.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(n.id)}"]`);
      if (child?.dataset['prevZ'] !== undefined) {
        child.style.zIndex = child.dataset['prevZ'];
        delete child.dataset['prevZ'];
      }
    }
  }
};

const onNodeMouseEnter = ({ node }: { node: unknown }): void => {
  const entered = node as DependencyNode;
  if (hoveredNodeId && hoveredNodeId !== entered.id) {
    restoreHoverZIndex(hoveredNodeId);
  }
  hoveredNodeId = entered.id;
  elevateNodeAndChildren(entered.id);
};

const onNodeMouseLeave = ({ node }: { node: unknown }): void => {
  const left = node as DependencyNode;
  if (hoveredNodeId === left.id) {
    restoreHoverZIndex(left.id);
    hoveredNodeId = null;
  }
};

onMounted(() => {
  graphRootRef.value?.addEventListener('wheel', handleWheel, { passive: false });
});

onUnmounted(() => {
  graphRootRef.value?.removeEventListener('wheel', handleWheel);
  if (hoveredNodeId) {
    restoreHoverZIndex(hoveredNodeId);
    hoveredNodeId = null;
  }
  if (layoutProcessor) {
    layoutProcessor.dispose();
    layoutProcessor = null;
  }
});
</script>

<template>
  <div
    ref="graphRootRef"
    class="dependency-graph-root relative h-full w-full"
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
      :default-viewport="DEFAULT_VIEWPORT"
      :snap-to-grid="true"
      :snap-grid="[15, 15]"
      :pan-on-scroll="false"
      :zoom-on-scroll="!isMac"
      :zoom-on-pinch="!isMac"
      :prevent-scrolling="true"
      :zoom-on-double-click="false"
      :elevate-edges-on-select="true"
      :default-edge-options="{
        markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
        zIndex: 2,
        type: 'smoothstep',
      }"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
      @nodes-change="handleNodesChange"
      @node-mouse-enter="onNodeMouseEnter"
      @node-mouse-leave="onNodeMouseLeave"
    >
      <Background />
      <GraphControls
        :relationship-availability="graphSettings.relationshipAvailability"
        @relationship-filter-change="handleRelationshipFilterChange"
        @node-type-filter-change="handleNodeTypeFilterChange"
        @layout-change="handleLayoutChange"
        @reset-layout="handleResetLayout"
        @reset-view="handleResetView"
        @toggle-collapse-scc="handleCollapseSccToggle"
        @toggle-cluster-folder="handleClusterByFolderToggle"
        @toggle-hide-test-files="handleHideTestFilesToggle"
        @member-node-mode-change="handleMemberNodeModeChange"
        @toggle-orphan-global="handleOrphanGlobalToggle"
      />
      <GraphSearch @search-result="handleSearchResult" :nodes="nodes" :edges="edges" />
      <MiniMap
        v-if="useBuiltinMinimap"
        position="bottom-right"
        :pannable="true"
        :zoomable="true"
        :node-color="minimapNodeColor"
        :node-stroke-color="minimapNodeStrokeColor"
        :node-stroke-width="1.5"
        :mask-color="'rgba(7, 10, 18, 0.85)'"
        :mask-stroke-color="'rgba(34, 211, 238, 0.6)'"
        :mask-stroke-width="1.5"
        aria-label="Graph minimap"
        @node-click="handleMinimapNodeClick"
      />
      <GraphMiniMap v-else :nodes="nodes" :edges="edges" :selected-node-id="selectedNode?.id ?? null" />
      <Controls position="bottom-right" :show-interactive="false" />

      <Panel v-if="isLayoutPending" position="top-center">
        <div class="layout-loading-indicator">Updating graph layout...</div>
      </Panel>

      <Panel v-if="scopeMode !== 'overview'" position="bottom-left">
        <button
          @click="handleReturnToOverview"
          class="px-4 py-2 bg-primary-main text-white rounded-md hover:bg-primary-dark transition-colors shadow-lg border border-primary-light"
          aria-label="Return to full graph view"
        >
          ← Back to Full Graph
        </button>
      </Panel>
    </VueFlow>
    <NodeDetails
      v-if="selectedNode"
      :node="selectedNode"
      :data="props.data"
      :nodes="nodes"
      :edges="edges"
      @open-symbol-usage="handleOpenSymbolUsageGraph"
    />
  </div>
</template>

<style scoped>
.dependency-graph-root :deep(.vue-flow__node) {
  transition:
    transform 180ms ease-out,
    opacity 180ms ease-out;
}

.dependency-graph-root :deep(.vue-flow__edge-path) {
  transition:
    opacity 140ms ease-out,
    stroke-width 140ms ease-out;
}

/* ── Selection highlighting ── */

/* Selected (clicked) node */
.dependency-graph-root :deep(.vue-flow__node.selection-target) {
  z-index: 11 !important;
}

.dependency-graph-root :deep(.vue-flow__node.selection-target .base-node-container) {
  border-color: #22d3ee !important;
  box-shadow:
    0 0 0 2px rgba(34, 211, 238, 0.3),
    0 0 20px rgba(34, 211, 238, 0.25),
    0 4px 12px rgba(0, 0, 0, 0.2) !important;
}

/* Nodes connected to the selection */
.dependency-graph-root :deep(.vue-flow__node.selection-connected) {
  z-index: 10 !important;
}

.dependency-graph-root :deep(.vue-flow__node.selection-connected .base-node-container) {
  border-color: rgba(34, 211, 238, 0.5) !important;
  box-shadow:
    0 0 12px rgba(34, 211, 238, 0.15),
    0 4px 12px rgba(0, 0, 0, 0.15) !important;
}

/* Dimmed non-connected nodes */
.dependency-graph-root :deep(.vue-flow__node.selection-dimmed) {
  opacity: 0.25 !important;
  transition: opacity 180ms ease-out !important;
}

/* Connected edges — pulse glow via filter: drop-shadow using currentColor
   so each edge type (import=cyan, extends=green, implements=orange) gets
   a matching glow automatically. */
.dependency-graph-root :deep(.vue-flow__edge.edge-selection-highlighted .vue-flow__edge-path) {
  stroke-width: 2.5px !important;
  filter: drop-shadow(0 0 4px currentColor);
  animation: edge-pulse 2s ease-in-out infinite !important;
}

/* Dimmed non-connected edges */
.dependency-graph-root :deep(.vue-flow__edge.edge-selection-dimmed .vue-flow__edge-path) {
  opacity: 0.1 !important;
}

@keyframes edge-pulse {
  0%,
  100% {
    filter: drop-shadow(0 0 3px currentColor);
  }
  50% {
    filter: drop-shadow(0 0 8px currentColor);
  }
}

@media (prefers-reduced-motion: reduce) {
  .dependency-graph-root :deep(.vue-flow__edge.edge-selection-highlighted .vue-flow__edge-path) {
    animation: none !important;
    filter: drop-shadow(0 0 4px currentColor);
  }
}

/* ── Layout loading ── */

.layout-loading-indicator {
  padding: 0.45rem 0.75rem;
  border: 1px solid rgba(148, 163, 184, 0.5);
  background: rgba(15, 23, 42, 0.92);
  border-radius: 0.5rem;
  color: rgba(226, 232, 240, 0.95);
  font-size: 0.72rem;
  letter-spacing: 0.02em;
  box-shadow: 0 8px 24px rgba(2, 6, 23, 0.35);
}
</style>
