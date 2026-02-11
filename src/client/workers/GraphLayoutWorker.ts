/**
 * Web Worker for handling complex graph layout calculations
 * This offloads CPU-intensive operations from the main thread
 */

import type { Edge } from '@vue-flow/core';

import type { DependencyNode } from '../components/DependencyGraph/types';
import type { GraphTheme } from '../theme/graphTheme';

// Worker message types
interface WorkerMessage {
  type: 'process-layout';
  payload: {
    nodes: DependencyNode[];
    edges: Edge[];
    config: LayoutConfig;
  };
}

interface LayoutConfig {
  algorithm: 'layered' | 'radial' | 'force' | 'stress';
  direction: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT';
  nodesep: number;
  edgesep: number;
  ranksep: number;
  theme: GraphTheme;
  animationDuration?: number;
}

// Handle messages from the main thread using ELK layered layout
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { nodes, edges, config } = event.data.payload;

  try {
    // Import ELK API (will spawn its own worker)
    const { default: ELK } = await import('elkjs/lib/elk-api.js');

    // Create ELK instance with worker URL (allows ELK to spawn subworker)
    // Use new URL() for proper Vite bundling
    const workerUrl = new URL('elkjs/lib/elk-worker.min.js', import.meta.url).href;
    const elk = new ELK({
      workerUrl,
    });

    const defaultWidth = 200;
    const defaultHeight = 120;

    // Define ELK node type
    interface ElkNode {
      id: string;
      width: number;
      height: number;
      x?: number;
      y?: number;
      children?: ElkNode[];
      layoutOptions?: Record<string, string>;
    }

    // Map VueFlow directions to ELK's expected values
    const directionMap: Record<string, string> = {
      RIGHT: 'RIGHT',
      LEFT: 'LEFT',
      DOWN: 'DOWN',
      UP: 'UP',
    };
    const elkDirection = directionMap[config.direction] ?? 'RIGHT';

    // Build hierarchical structure for ELK
    const nodeMap = new Map<string, ElkNode>();
    const rootNodes: ElkNode[] = [];

    // First pass: create all nodes
    nodes.forEach((node) => {
      const nodeWidth = (node as unknown as { measured?: { width?: number } }).measured?.width ?? defaultWidth;
      const nodeHeight = (node as unknown as { measured?: { height?: number } }).measured?.height ?? defaultHeight;

      const elkNode: ElkNode = {
        id: node.id,
        width: nodeWidth,
        height: nodeHeight,
        children: [],
      };
      nodeMap.set(node.id, elkNode);
    });

    // Add layout options to nodes that will have children
    nodeMap.forEach((elkNode) => {
      // Check if this node will have children
      const hasChildren = nodes.some((n) => (n as unknown as { parentNode?: string }).parentNode === elkNode.id);
      if (hasChildren) {
        // Base layout options
        const baseOptions: Record<string, string> = {
          'elk.algorithm': config.algorithm,
          'elk.padding': '[top=30,left=30,bottom=30,right=30]',
          'elk.spacing.nodeNode': '20',
        };

        // Algorithm-specific options
        if (config.algorithm === 'layered') {
          baseOptions['elk.direction'] = elkDirection;
          baseOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = '30';
        } else if (config.algorithm === 'radial') {
          baseOptions['elk.radial.radius'] = '200';
          baseOptions['elk.radial.compactionStepSize'] = '0.1';
          baseOptions['elk.radial.compaction'] = 'true';
          baseOptions['elk.radial.sorter'] = 'QUADRANTS';
        }

        elkNode.layoutOptions = baseOptions;
      }
    });

    // Second pass: build hierarchy based on parentNode
    nodes.forEach((node) => {
      const elkNode = nodeMap.get(node.id);
      if (!elkNode) return;

      const parentNodeId = (node as unknown as { parentNode?: string }).parentNode;
      if (parentNodeId) {
        const parent = nodeMap.get(parentNodeId);
        if (parent) {
          parent.children = parent.children ?? [];
          parent.children.push(elkNode);
        }
      } else {
        rootNodes.push(elkNode);
      }
    });

    // Filter edges to only include valid connections and exclude containment edges
    // Containment is now handled by hierarchy structure, not as edges for layout
    const validEdges = edges.filter((edge) => {
      const edgeType = (edge.data as { type?: string } | undefined)?.type;
      const isValid = nodes.some((n) => n.id === edge.source) && nodes.some((n) => n.id === edge.target);
      const isNotContainment = edgeType !== 'contains';
      return isValid && isNotContainment;
    });

    // Define ELK edge type - ELK uses sources/targets arrays
    interface ElkEdge {
      id: string;
      sources: string[];
      targets: string[];
    }

    // Create ELK edges with correct format (only non-containment edges for layout)
    const elkEdges: ElkEdge[] = validEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    }));

    // Define ELK graph type
    interface ElkGraph {
      id: string;
      layoutOptions: Record<string, string>;
      children: ElkNode[];
      edges: ElkEdge[];
    }

    // Build layout options based on algorithm
    const layoutOptions: Record<string, string> = {
      'elk.algorithm': config.algorithm,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.spacing.nodeNode': String(config.nodesep),
      'elk.spacing.edgeNode': String(config.edgesep),
      'elk.padding': '[top=50,left=50,bottom=50,right=50]',
      'elk.spacing.componentComponent': '30',
      'elk.spacing.portPort': '10',
      // Global preferences for clearer, orthogonal routing and consistent ports
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.portAlignment.default': 'CENTER',
    };

    // Add algorithm-specific options
    if (config.algorithm === 'layered') {
      layoutOptions['elk.direction'] = elkDirection;
      layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'] = String(config.ranksep);
      layoutOptions['elk.layered.spacing.edgeNodeBetweenLayers'] = String(config.edgesep);
      layoutOptions['elk.layered.nodePlacement.strategy'] = 'BRANDES_KOEPF';
      layoutOptions['elk.layered.nodePlacement.bk.fixedAlignment'] = 'BALANCED';
      layoutOptions['elk.layered.layering.strategy'] = 'NETWORK_SIMPLEX';
      layoutOptions['elk.layered.cycleBreaking.strategy'] = 'GREEDY';
      layoutOptions['elk.layered.crossingMinimization.strategy'] = 'LAYER_SWEEP';
      layoutOptions['elk.layered.compaction.postCompaction.strategy'] = 'EDGE_LENGTH';
      layoutOptions['elk.layered.mergeEdges'] = 'true';
    } else if (config.algorithm === 'radial') {
      layoutOptions['elk.radial.radius'] = String(config.ranksep);
      layoutOptions['elk.radial.compactionStepSize'] = '0.1';
      layoutOptions['elk.radial.compaction'] = 'true';
      layoutOptions['elk.radial.sorter'] = 'QUADRANTS';
      layoutOptions['elk.radial.wedgeCriteria'] = 'CONNECTIONS';
      layoutOptions['elk.radial.optimizeDistance'] = 'true';
      layoutOptions['elk.edgeRouting'] = 'SPLINES';
    } else if (config.algorithm === 'force') {
      layoutOptions['elk.force.repulsion'] = '5.0';
      layoutOptions['elk.force.temperature'] = '0.001';
      layoutOptions['elk.edgeRouting'] = 'SPLINES';
    } else {
      // stress algorithm
      layoutOptions['elk.stress.desiredEdgeLength'] = String(config.ranksep);
      layoutOptions['elk.stress.epsilon'] = '0.0001';
      layoutOptions['elk.edgeRouting'] = 'SPLINES';
    }

    // Create the ELK graph with hierarchical structure
    const elkGraph: ElkGraph = {
      id: 'root',
      layoutOptions,
      children: rootNodes,
      edges: elkEdges,
    };

    const layoutedGraph = await elk.layout(elkGraph);

    // Extract positions from the hierarchical layout recursively
    // For VueFlow, nested nodes need RELATIVE positions to their parent, not absolute
    const positionMap = new Map<string, { x: number; y: number; width: number; height: number }>();

    function extractPositions(nodes: ElkNode[]): void {
      nodes.forEach((node) => {
        // For root nodes, use absolute positions
        // For nested nodes, use relative positions (as calculated by ELK within the parent)
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const width = node.width ?? defaultWidth;
        const height = node.height ?? defaultHeight;
        positionMap.set(node.id, { x, y, width, height });

        // Recursively process children with their relative positions
        if (node.children && node.children.length > 0) {
          extractPositions(node.children);
        }
      });
    }

    if (layoutedGraph.children) {
      extractPositions(layoutedGraph.children);
    }

    // Apply positions to nodes
    const newNodes = nodes.map((node) => {
      const position = positionMap.get(node.id);
      if (position) {
        const hasChildren = nodes.some((candidate) => (candidate as { parentNode?: string }).parentNode === node.id);
        const baseNode = {
          ...node,
          position: { x: position.x, y: position.y },
        };

        if (!hasChildren) {
          return baseNode;
        }

        const style = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};
        return {
          ...baseNode,
          style: {
            ...style,
            width: Math.max(position.width, defaultWidth),
            height: Math.max(position.height, defaultHeight),
            overflow: 'visible',
          },
        };
      }
      return node;
    });

    // Return all edges (including containment edges), not just the ones used for layout
    self.postMessage({
      type: 'layout-complete',
      payload: { nodes: newNodes, edges },
    });
  } catch (error) {
    console.error('ELK layout error:', error);
    // Fallback: return nodes unchanged
    self.postMessage({
      type: 'layout-complete',
      payload: { nodes, edges },
    });
  }
};

// Export empty object to satisfy TypeScript
export {};
