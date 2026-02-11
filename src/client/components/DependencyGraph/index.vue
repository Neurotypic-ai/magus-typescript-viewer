<script setup lang="ts">
import { Background } from '@vue-flow/background';
import { MarkerType, Panel, Position, VueFlow, useVueFlow } from '@vue-flow/core';
import { computed, onUnmounted, watch } from 'vue';

import { createLogger } from '../../../shared/utils/logger';
import { clusterByFolder } from '../../graph/cluster/folders';
import { collapseSccs } from '../../graph/cluster/scc';
import { WebWorkerLayoutProcessor } from '../../layout/WebWorkerLayoutProcessor';
import { useGraphSettings } from '../../stores/graphSettings';
import { useGraphStore } from '../../stores/graphStore';
import { getEdgeStyle, getNodeStyle, graphTheme } from '../../theme/graphTheme';
import { createGraphEdges } from '../../utils/createGraphEdges';
import { createGraphNodes } from '../../utils/createGraphNodes';
import { measurePerformance } from '../../utils/performanceMonitoring';
import GraphControls from './components/GraphControls.vue';
import GraphSearch from './components/GraphSearch.vue';
import NodeDetails from './components/NodeDetails.vue';
import { mapTypeCollection } from './mapTypeCollection';
import { nodeTypes } from './nodes/nodes';

import type {
  DependencyEdgeKind,
  DependencyKind,
  DependencyNode,
  DependencyPackageGraph,
  GraphEdge,
  SearchResult,
} from './types';

import '@vue-flow/core/dist/style.css';

const graphLogger = createLogger('DependencyGraph');

export interface DependencyGraphProps {
  data: DependencyPackageGraph;
}

const props = defineProps<DependencyGraphProps>();

// Get graph state from Pinia store
const graphStore = useGraphStore();
const graphSettings = useGraphSettings();
const nodes = computed(() => graphStore['nodes']);
const edges = computed(() => graphStore['edges']);
const selectedNode = computed(() => graphStore['selectedNode']);

const { fitView } = useVueFlow();

// Keep a reference to the layout processor for cleanup
let layoutProcessor: WebWorkerLayoutProcessor | null = null;
let layoutRequestVersion = 0;

const DEFAULT_NODE_TYPE_SET = new Set(['module']);

// Layout configuration state optimized for module import visualization
const defaultLayoutConfig = {
  algorithm: 'layered' as 'layered' | 'radial' | 'force' | 'stress',
  direction: 'LR' as 'LR' | 'RL' | 'TB' | 'BT', // Left-to-right flow
  nodeSpacing: 80, // Space between nodes in same rank
  rankSpacing: 200, // Space between ranks (layers) - increased for clarity
  edgeSpacing: 30, // Space between parallel edges
};
const layoutConfig = { ...defaultLayoutConfig };

// Helper to get handle positions based on layout direction
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

// Create WebWorkerLayoutProcessor
const initializeLayoutProcessor = () => {
  // Invalidate any in-flight layout request from an older processor/config.
  layoutRequestVersion += 1;

  // Clean up previous instance if it exists
  if (layoutProcessor) {
    layoutProcessor.dispose();
  }

  // Create a new instance
  // Note: WebWorkerLayoutProcessor internally converts TB/LR/etc to DOWN/RIGHT/etc
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

// Clean up the worker when component unmounts
onUnmounted(() => {
  if (layoutProcessor) {
    layoutProcessor.dispose();
    layoutProcessor = null;
  }
});

// Process graph layout using web worker
const processGraphLayout = async (graphData: { nodes: DependencyNode[]; edges: GraphEdge[] }) => {
  if (!layoutProcessor) return;
  const requestVersion = ++layoutRequestVersion;

  try {
    // Start performance measurement
    performance.mark('layout-start');

    // Process layout using the web worker
    const result = await layoutProcessor.processLayout(graphData);
    if (requestVersion !== layoutRequestVersion) {
      return;
    }

    // Force the correct types for nodes and edges
    const typedNodes = result.nodes as unknown as DependencyNode[];
    const typedEdges = result.edges as unknown as GraphEdge[];

    // Explicitly update handle positions based on current layout direction
    // This ensures handles are correctly positioned even after worker processing
    const { sourcePosition, targetPosition } = getHandlePositions(layoutConfig.direction);
    const nodesWithCorrectHandles = typedNodes.map((node) => ({
      ...node,
      sourcePosition,
      targetPosition,
    }));

    // Debug: Check edges after layout processing
    graphLogger.info(`After layout: ${typedEdges.length} edges`);
    if (typedEdges.length > 0) {
      graphLogger.info(
        'Edges still have hidden=false:',
        typedEdges.every((e) => e.hidden === false)
      );
      graphLogger.info('Sample edge after layout:', typedEdges[0]);
    }

    // Minimal post-layout metrics
    const idToBox = new Map<string, { x: number; y: number; w: number; h: number }>();
    nodesWithCorrectHandles.forEach((n) => {
      const measured = (n as unknown as { measured?: { width?: number; height?: number } }).measured;
      const w = measured?.width ?? (typeof n.width === 'number' ? n.width : 150);
      const h = measured?.height ?? (typeof n.height === 'number' ? n.height : 50);
      idToBox.set(n.id, { x: n.position.x, y: n.position.y, w, h });
    });
    let totalLen = 0;
    const outdeg = new Map<string, number>();
    const indeg = new Map<string, number>();
    typedEdges.forEach((e) => {
      outdeg.set(e.source, (outdeg.get(e.source) ?? 0) + 1);
      indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
      const s = idToBox.get(e.source);
      const t = idToBox.get(e.target);
      if (s && t) {
        const sx = s.x + s.w / 2;
        const sy = s.y + s.h / 2;
        const tx = t.x + t.w / 2;
        const ty = t.y + t.h / 2;
        totalLen += Math.abs(sx - tx) + Math.abs(sy - ty);
      }
    });
    const numNodes = nodesWithCorrectHandles.length;
    const numEdges = typedEdges.length;
    const avgOut = numNodes > 0 ? Array.from(outdeg.values()).reduce((a, b) => a + b, 0) / numNodes : 0;
    const avgIn = numNodes > 0 ? Array.from(indeg.values()).reduce((a, b) => a + b, 0) / numNodes : 0;
    graphLogger.info('Layout metrics', {
      nodes: numNodes,
      edges: numEdges,
      avgOutdeg: avgOut,
      avgIndeg: avgIn,
      approxTotalEdgeLength: Math.round(totalLen),
    });

    // Update nodes without transition for better dragging performance
    graphStore['setNodes'](nodesWithCorrectHandles);
    graphStore['setEdges'](typedEdges);

    // Debug: Verify store state
    graphLogger.info('Store edges count:', edges.value.length);

    // Fit view after layout with faster animation
    if (requestVersion !== layoutRequestVersion) {
      return;
    }
    await fitView({ duration: 150, padding: 0.1 });

    // End performance measurement
    performance.mark('layout-end');
    measurePerformance('graph-layout', 'layout-start', 'layout-end');
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Unknown error during layout processing');
    graphLogger.error('Layout processing failed:', error);
    // Potentially update UI to show error state to the user
  }
};

const filterEdgesByNodeSet = (graphNodes: DependencyNode[], graphEdges: GraphEdge[]): GraphEdge[] => {
  const nodeIds = new Set(graphNodes.map((node) => node.id));
  return graphEdges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
};

const getEnabledNodeTypes = (): Set<string> => {
  const configuredTypes = graphSettings.enabledNodeTypes.length
    ? graphSettings.enabledNodeTypes
    : Array.from(DEFAULT_NODE_TYPE_SET);
  const typeSet = new Set(configuredTypes);

  // Keep modules visible when no node types are selected to avoid an empty graph trap.
  if (typeSet.size === 0) {
    typeSet.add('module');
  }

  return typeSet;
};

const buildGraphStructure = (): { nodes: DependencyNode[]; edges: GraphEdge[] } => {
  const enabledNodeTypes = getEnabledNodeTypes();
  const includePackages = enabledNodeTypes.has('package');
  const includeModules = enabledNodeTypes.has('module');
  const includeClassNodes = enabledNodeTypes.has('class');
  const includeInterfaceNodes = enabledNodeTypes.has('interface');
  const includeClassEdges = includeClassNodes || includeInterfaceNodes;

  const graphNodes = createGraphNodes(props.data, {
    includePackages,
    includeModules,
    includeClasses: includeClassEdges,
    includeClassNodes,
    includeInterfaceNodes,
    // Nested symbol nodes inside grouped modules can cause unstable drag constraints.
    nestSymbolsInModules: !graphSettings.clusterByFolder,
    direction: layoutConfig.direction,
  });

  const graphEdges = createGraphEdges(props.data, {
    includePackageEdges: includePackages,
    includeClassEdges,
    liftClassEdgesToModuleLevel: !includeClassEdges,
    importDirection: 'importer-to-imported',
  }) as unknown as GraphEdge[];

  const filteredEdges = filterEdgesByNodeSet(graphNodes, graphEdges);
  if (filteredEdges.length !== graphEdges.length) {
    const invalidEdgeCount = graphEdges.length - filteredEdges.length;
    graphLogger.warn(`Filtered ${invalidEdgeCount} edges with invalid source/target IDs.`);
  }

  return {
    nodes: graphNodes,
    edges: filteredEdges,
  };
};

const applyGraphTransforms = (graphData: { nodes: DependencyNode[]; edges: GraphEdge[] }) => {
  let transformedNodes = graphData.nodes;
  let transformedEdges = graphData.edges;

  if (graphSettings.collapseScc) {
    const collapsed = collapseSccs(transformedNodes, transformedEdges);
    transformedNodes = collapsed.nodes as DependencyNode[];
    transformedEdges = collapsed.edges as GraphEdge[];
  }

  if (graphSettings.clusterByFolder) {
    const clustered = clusterByFolder(transformedNodes, transformedEdges);
    transformedNodes = clustered.nodes as DependencyNode[];
    transformedEdges = clustered.edges as GraphEdge[];
  }

  return { nodes: transformedNodes, edges: transformedEdges };
};

const applyVisibilityFilters = (graphData: { nodes: DependencyNode[]; edges: GraphEdge[] }) => {
  const enabledTypes = new Set(graphSettings.enabledRelationshipTypes);
  const filteredEdges = graphData.edges.map((edge) => ({
    ...edge,
    hidden: !enabledTypes.has(edge.data?.type ?? 'default'),
  }));

  return { nodes: graphData.nodes, edges: filteredEdges };
};

const initializeGraph = async () => {
  performance.mark('graph-init-start');
  initializeLayoutProcessor();

  const baseGraph = buildGraphStructure();
  const transformedGraph = applyGraphTransforms(baseGraph);
  const visibleGraph = applyVisibilityFilters(transformedGraph);
  await processGraphLayout(visibleGraph);

  performance.mark('graph-init-end');
  measurePerformance('graph-initialization', 'graph-init-start', 'graph-init-end');
};

// Watch for data changes
watch(() => props.data, initializeGraph, { immediate: true });

// Single click handler - highlight connected nodes
const onNodeClick = ({ node }: { node: unknown }): void => {
  const clickedNode = node as DependencyNode;
  graphStore['setSelectedNode'](clickedNode);

  // Find all connected nodes
  const connectedNodeIds = new Set<string>([clickedNode.id]);
  edges.value.forEach((edge: GraphEdge) => {
    if (edge.source === clickedNode.id) {
      connectedNodeIds.add(edge.target);
    } else if (edge.target === clickedNode.id) {
      connectedNodeIds.add(edge.source);
    }
  });

  // Update nodes with highlighting
  graphStore['setNodes'](
    nodes.value.map((n: DependencyNode) => {
      const isConnected = connectedNodeIds.has(n.id);
      const isClicked = n.id === clickedNode.id;

      return {
        ...n,
        style: {
          ...getNodeStyle(n.type as DependencyKind),
          opacity: isConnected ? 1 : 0.3,
          borderWidth: isClicked ? '3px' : isConnected ? '2px' : '1px',
          borderColor: isClicked ? '#00ffff' : isConnected ? '#61dafb' : undefined,
        },
      };
    })
  );

  // Update edges with highlighting
  graphStore['setEdges'](
    edges.value.map((edge: GraphEdge) => {
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
    })
  );
};

// Double click handler - show detailed view
const onNodeDoubleClick = async ({ node }: { node: unknown }): Promise<void> => {
  const selectedNode = node as DependencyNode;
  graphStore['setSelectedNode'](selectedNode);

  // If it's a module node, show its internal structure
  if (selectedNode.type === 'module') {
    graphLogger.info(`Expanding module view: ${selectedNode.data?.label ?? selectedNode.id}`);

    // Create detailed nodes for this module from the original data
    const moduleData = props.data.packages
      .flatMap((pkg) => Object.values(pkg.modules || {}))
      .find((m) => m.id === selectedNode.id);

    if (!moduleData) {
      graphLogger.warn('Could not find module data');
      return;
    }

    const detailedNodes: DependencyNode[] = [];
    const detailedEdges: GraphEdge[] = [];

    // Get handle positions based on current layout direction
    const { sourcePosition, targetPosition } = getHandlePositions(layoutConfig.direction);

    // Add the module node itself
    detailedNodes.push({
      ...selectedNode,
      sourcePosition,
      targetPosition,
      style: {
        ...selectedNode.style,
        borderWidth: '3px',
        borderColor: '#00ffff',
      },
    });

    // Add all classes in this module
    if (moduleData.classes) {
      mapTypeCollection(moduleData.classes, (cls) => {
        const properties = cls.properties
          ? Object.values(cls.properties).map((p) => ({
            name: p.name,
            type: p.type,
            visibility: p.visibility,
          }))
          : [];

        const methods = cls.methods
          ? Object.values(cls.methods).map((m) => ({
            name: m.name,
            returnType: m.returnType,
            visibility: m.visibility,
            signature: m.signature || `${m.name}(): ${m.returnType}`,
          }))
          : [];

        detailedNodes.push({
          id: cls.id,
          type: 'class' as DependencyKind,
          position: { x: 0, y: 0 },
          sourcePosition,
          targetPosition,
          data: {
            label: cls.name,
            properties,
            methods,
          },
          style: {
            ...getNodeStyle('class'),
            borderColor: '#4caf50',
          },
        });

        // Add inheritance edge if exists
        if (cls.extends_id) {
          detailedEdges.push({
            id: `${cls.id}-${cls.extends_id}-inheritance`,
            source: cls.id,
            target: cls.extends_id,
            hidden: false,
            data: { type: 'inheritance' as DependencyEdgeKind },
            style: { ...getEdgeStyle('inheritance'), strokeWidth: 3 },
            markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
          } as GraphEdge);
        }

        // Add implementation edges
        if (cls.implemented_interfaces) {
          Object.values(cls.implemented_interfaces).forEach((iface) => {
            if (iface.id) {
              detailedEdges.push({
                id: `${cls.id}-${iface.id}-implements`,
                source: cls.id,
                target: iface.id,
                hidden: false,
                data: { type: 'implements' as DependencyEdgeKind },
                style: { ...getEdgeStyle('implements'), strokeWidth: 3 },
                markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
              } as GraphEdge);
            }
          });
        }
      });
    }

    // Add all interfaces in this module
    if (moduleData.interfaces) {
      mapTypeCollection(moduleData.interfaces, (iface) => {
        const properties = iface.properties
          ? Object.values(iface.properties).map((p) => ({
            name: p.name,
            type: p.type,
            visibility: p.visibility,
          }))
          : [];

        const methods = iface.methods
          ? Object.values(iface.methods).map((m) => ({
            name: m.name,
            returnType: m.returnType,
            visibility: m.visibility,
            signature: m.signature || `${m.name}(): ${m.returnType}`,
          }))
          : [];

        detailedNodes.push({
          id: iface.id,
          type: 'interface' as DependencyKind,
          position: { x: 0, y: 0 },
          sourcePosition,
          targetPosition,
          data: {
            label: iface.name,
            properties,
            methods,
          },
          style: {
            ...getNodeStyle('interface'),
            borderColor: '#ff9800',
          },
        });

        // Add interface inheritance edges
        if (iface.extended_interfaces) {
          Object.values(iface.extended_interfaces).forEach((extended) => {
            if (extended.id) {
              detailedEdges.push({
                id: `${iface.id}-${extended.id}-inheritance`,
                source: iface.id,
                target: extended.id,
                hidden: false,
                data: { type: 'inheritance' as DependencyEdgeKind },
                style: { ...getEdgeStyle('inheritance'), strokeWidth: 3 },
                markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
              } as GraphEdge);
            }
          });
        }
      });
    }

    // Add connected modules (imports)
    const connectedModuleIds = new Set<string>();
    edges.value.forEach((edge: GraphEdge) => {
      if (edge.source === selectedNode.id) {
        connectedModuleIds.add(edge.target);
        detailedEdges.push({
          ...edge,
          style: { ...edge.style, stroke: '#61dafb', strokeWidth: 3 },
          animated: true,
        } as GraphEdge);
      } else if (edge.target === selectedNode.id) {
        connectedModuleIds.add(edge.source);
        detailedEdges.push({
          ...edge,
          style: { ...edge.style, stroke: '#ffd700', strokeWidth: 3 },
          animated: true,
        } as GraphEdge);
      }
    });

    // Add connected module nodes
    connectedModuleIds.forEach((moduleId) => {
      const connectedModule = nodes.value.find((n: DependencyNode) => n.id === moduleId);
      if (connectedModule) {
        detailedNodes.push({
          ...connectedModule,
          sourcePosition,
          targetPosition,
          style: {
            ...connectedModule.style,
            borderWidth: '2px',
            borderColor: '#61dafb',
          },
        });
      }
    });

    graphLogger.info(
      `Showing ${detailedNodes.length} nodes (${detailedNodes.filter((n) => n.type === 'class').length} classes, ${detailedNodes.filter((n) => n.type === 'interface').length} interfaces) and ${detailedEdges.length} edges`
    );

    const detailedNodeIds = new Set(detailedNodes.map((n) => n.id));
    const filteredDetailedEdges = detailedEdges.filter(
      (edge) => detailedNodeIds.has(edge.source) && detailedNodeIds.has(edge.target)
    );

    // Trigger re-layout with detailed subgraph
    await processGraphLayout({
      nodes: detailedNodes,
      edges: filteredDetailedEdges,
    });

    // Fit view to the detailed subgraph
    await fitView({
      duration: 300,
      padding: 0.2,
    });
  } else {
    // For non-module nodes, just show connections
    const connectedNodeIds = new Set<string>([selectedNode.id]);
    const connectedEdges: GraphEdge[] = [];

    edges.value.forEach((edge: GraphEdge) => {
      if (edge.source === selectedNode.id) {
        connectedNodeIds.add(edge.target);
        connectedEdges.push(edge);
      } else if (edge.target === selectedNode.id) {
        connectedNodeIds.add(edge.source);
        connectedEdges.push(edge);
      }
    });

    const focusedNodes = nodes.value
      .filter((n: DependencyNode) => connectedNodeIds.has(n.id))
      .map((n: DependencyNode) => ({
        ...n,
        style: {
          ...n.style,
          borderWidth: n.id === selectedNode.id ? '3px' : '2px',
          borderColor: n.id === selectedNode.id ? '#00ffff' : '#61dafb',
        },
      }));

    const focusedEdges = connectedEdges.map((edge: GraphEdge) => ({
      ...edge,
      style: {
        ...edge.style,
        stroke: '#00ffff',
        strokeWidth: 4,
        opacity: 1,
      },
      animated: true,
    }));

    await processGraphLayout({
      nodes: focusedNodes,
      edges: focusedEdges,
    });

    await fitView({
      duration: 300,
      padding: 0.3,
      nodes: Array.from(connectedNodeIds),
    });
  }
};

// Pane click handler to deselect and restore full graph
const onPaneClick = async (): Promise<void> => {
  graphStore['setSelectedNode'](null);

  graphLogger.info('Restoring full graph view');

  // Restore full graph by re-initializing
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

// Filter handler for relationship types
const handleRelationshipFilterChange = (types: string[]) => {
  graphSettings.setEnabledRelationshipTypes(types);
  graphStore['setEdges'](
    edges.value.map((edge: GraphEdge) => ({
      ...edge,
      hidden: !types.includes(edge.data?.type ?? 'default'),
    }))
  );
};

const handleNodeTypeFilterChange = async (types: string[]) => {
  graphSettings.setEnabledNodeTypes(types);
  await initializeGraph();
};

const handleCollapseSccToggle = async (value: boolean) => {
  graphSettings.setCollapseScc(value);
  await initializeGraph();
};

const handleClusterByFolderToggle = async (value: boolean) => {
  graphSettings.setClusterByFolder(value);
  await initializeGraph();
};

// Layout change handler
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

// Search result handler
const handleSearchResult = (result: SearchResult) => {
  // Update node styling based on search results
  graphStore['setNodes'](
    nodes.value.map((node: DependencyNode) => ({
      ...node,
      selected: result.nodes.some((searchNode) => searchNode.id === node.id),
      style: {
        ...getNodeStyle(node.type as DependencyKind),
        opacity: result.nodes.length === 0 ? 1 : result.nodes.some((searchNode) => searchNode.id === node.id) ? 1 : 0.2,
      },
    }))
  );

  // Update edge styling based on search results
  graphStore['setEdges'](
    edges.value.map((edge: GraphEdge) => ({
      ...edge,
      selected: result.edges.some((searchEdge) => searchEdge.id === edge.id),
      style: {
        ...getEdgeStyle(toDependencyEdgeKind(edge.data?.type)),
        opacity: result.edges.length === 0 ? 1 : result.edges.some((searchEdge) => searchEdge.id === edge.id) ? 1 : 0.2,
      },
    }))
  );

  // Highlight path if it exists
  if (result.path) {
    graphStore['setNodes'](
      nodes.value.map((node: DependencyNode) => ({
        ...node,
        style: {
          ...getNodeStyle(node.type as DependencyKind),
          opacity: result.path?.some((pathNode) => pathNode.id === node.id) ? 1 : 0.2,
          borderWidth: result.path?.some((pathNode) => pathNode.id === node.id)
            ? graphTheme.edges.sizes.width.selected
            : graphTheme.edges.sizes.width.default,
        },
      }))
    );
  }
};

// Keyboard navigation handlers
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

function toDependencyEdgeKind(type: string | undefined): DependencyEdgeKind {
  if (
    type === 'dependency' ||
    type === 'devDependency' ||
    type === 'peerDependency' ||
    type === 'import' ||
    type === 'export' ||
    type === 'inheritance' ||
    type === 'implements' ||
    type === 'extends' ||
    type === 'contains'
  ) {
    return type;
  }
  return 'dependency';
}
</script>

<template>
  <div
    class="h-full w-full"
    role="application"
    aria-label="TypeScript dependency graph visualization"
    tabindex="0"
    @keydown="handleKeyDown"
  >
    <!-- The actual graph -->
    <VueFlow :nodes="nodes" :edges="edges" :node-types="nodeTypes as any" :fit-view-on-init="true" :min-zoom="0.1"
      :max-zoom="2" :default-viewport="{ x: 0, y: 0, zoom: 0.5 }" :snap-to-grid="true" :snap-grid="[15, 15]"
      :pan-on-scroll="true" :zoom-on-scroll="true" :zoom-on-double-click="false" :elevate-edges-on-select="true"
      :default-edge-options="{
        style: { stroke: '#61dafb', strokeWidth: 3 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
        zIndex: 1000,
        type: 'step',
      }" @node-click="onNodeClick" @node-double-click="onNodeDoubleClick" @pane-click="onPaneClick">
      <Background />
      <GraphControls @relationship-filter-change="handleRelationshipFilterChange"
        @node-type-filter-change="handleNodeTypeFilterChange" @layout-change="handleLayoutChange"
        @reset-layout="handleResetLayout" @toggle-collapse-scc="handleCollapseSccToggle"
        @toggle-cluster-folder="handleClusterByFolderToggle" />
      <GraphSearch @search-result="handleSearchResult" :nodes="nodes" :edges="edges" />
      <NodeDetails v-if="selectedNode" :node="selectedNode" :data="props.data" :nodes="nodes" :edges="edges" />

      <!-- Back to Full Graph button -->
      <Panel v-if="selectedNode" position="bottom-left">
        <button @click="onPaneClick"
          class="px-4 py-2 bg-primary-main text-white rounded-md hover:bg-primary-dark transition-colors shadow-lg border border-primary-light"
          aria-label="Return to full graph view">
          ← Back to Full Graph
        </button>
      </Panel>
    </VueFlow>
  </div>
</template>
