import { graphlib, layout } from '@dagrejs/dagre';

import { createLogger } from '../../../../shared/utils/logger';
import { defaultLayoutConfig, mergeConfig } from './config';
import { LayoutError } from './errors';

import type { DependencyGraph, DependencyNode } from '../types';
import type { LayoutConfig } from './config';

/** Node label shape after dagre layout has assigned positions */
interface DagreNodeLabel {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Helper function to get node dimensions (replaces @xyflow/system's getNodeDimensions)
function getNodeDimensions(node: DependencyNode): { width: number; height: number } {
  // Check for measured dimensions first (may not exist in type but can be set at runtime)
  const measured = (node as { measured?: { width?: number; height?: number } }).measured;
  if (measured) {
    return {
      width: measured.width ?? (typeof node.width === 'number' ? node.width : 150),
      height: measured.height ?? (typeof node.height === 'number' ? node.height : 50),
    };
  }
  // Fall back to width/height properties
  return {
    width: typeof node.width === 'number' ? node.width : 150,
    height: typeof node.height === 'number' ? node.height : 50,
  };
}

const logger = createLogger('LayoutProcessor');

export class LayoutProcessor {
  private config: LayoutConfig;
  private cache = new Map<string, DependencyGraph>();

  constructor(config: Partial<LayoutConfig> = {}) {
    this.config = mergeConfig(config, defaultLayoutConfig);
  }

  private calculateContainerDimensions(
    containerNode: DependencyNode,
    childNodes: DependencyNode[]
  ): { width: number; height: number; x: number; y: number } {
    // Filter children by parentNode property (VueFlow hierarchy)
    const children = childNodes.filter((child) => child.parentNode === containerNode.id);

    if (!children.length) {
      return {
        width: this.config.theme?.nodes.minDimensions.width ?? 150 * 2,
        height: this.config.theme?.nodes.minDimensions.height ?? 50 * 2,
        x: 0,
        y: 0,
      };
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    children.forEach((child) => {
      const measured = (child as { measured?: { width?: number; height?: number } }).measured;
      const nodeWidth = measured?.width ?? this.config.theme?.nodes.minDimensions.width ?? 150;
      const nodeHeight = measured?.height ?? this.config.theme?.nodes.minDimensions.height ?? 50;

      minX = Math.min(minX, child.position.x);
      minY = Math.min(minY, child.position.y);
      maxX = Math.max(maxX, child.position.x + nodeWidth);
      maxY = Math.max(maxY, child.position.y + nodeHeight);
    });

    const padding = (this.config.theme?.nodes.padding.content ?? 16) * 2;

    return {
      width: maxX - minX + padding,
      height: maxY - minY + padding,
      x: minX - padding / 2,
      y: minY - padding / 2,
    };
  }

  processLayout(graph: DependencyGraph): Promise<DependencyGraph> {
    try {
      // Generate cache key based on graph structure
      const cacheKey = this.generateCacheKey(graph);

      // Check cache first
      const cachedResult = this.cache.get(cacheKey);
      if (cachedResult) {
        logger.debug('Using cached layout');
        return Promise.resolve(cachedResult);
      }

      // Create a new dagre graph
      const g = new graphlib.Graph({ compound: true });

      // Set graph options
      g.setGraph({
        rankdir: this.config.direction,
        nodesep: this.config.nodeSpacing,
        ranksep: this.config.rankSpacing,
        edgesep: this.config.edgeSpacing,
        marginx: this.config.margins?.left,
        marginy: this.config.margins?.top,
        acyclicer: 'greedy',
        ranker: 'network-simplex',
      });

      // Default to allow edges between same rank
      g.setDefaultEdgeLabel(() => ({}));

      // Add nodes to dagre
      graph.nodes.forEach((node) => {
        const dimensions = getNodeDimensions(node);
        g.setNode(node.id, {
          ...dimensions,
          ...(node.data?.parentId ? { parent: node.data.parentId } : {}),
        });
      });

      // Add edges to dagre
      graph.edges.forEach((edge) => {
        if (edge.source && edge.target) {
          g.setEdge(edge.source, edge.target);
        }
      });

      // Perform layout
      layout(g);

      // Extract positions with special handling for container nodes (package, module, group)
      const layoutedNodes = graph.nodes.map((node) => {
        const layoutNode = g.node(node.id) as unknown as DagreNodeLabel;

        // Handle container nodes (package, module, group) that contain other nodes
        if (node.type === 'package' || node.type === 'module' || node.type === 'group') {
          const dimensions = this.calculateContainerDimensions(node, graph.nodes);

          // Set z-index based on container type for proper layering
          let zIndex = 1;
          if (node.type === 'package') {
            zIndex = 0; // Packages at the back
          } else if (node.type === 'module') {
            zIndex = 1; // Modules in the middle
          } else {
            zIndex = 1; // Groups same as modules
          }

          return {
            ...node,
            position: {
              x: dimensions.x,
              y: dimensions.y,
            },
            style: {
              ...(typeof node.style === 'object' ? node.style : {}),
              width: dimensions.width,
              height: dimensions.height,
              zIndex,
            },
          };
        }

        // For leaf nodes (class, interface, etc.), adjust position from center to top-left
        return {
          ...node,
          position: {
            x: layoutNode.x - layoutNode.width / 2,
            y: layoutNode.y - layoutNode.height / 2,
          },
          style: {
            ...(typeof node.style === 'object' ? node.style : {}),
            zIndex: 2, // Leaf nodes on top
          },
        };
      });

      const result = {
        nodes: layoutedNodes,
        edges: graph.edges,
      };

      // Cache the result
      this.cache.set(cacheKey, result);

      return Promise.resolve(result);
    } catch (error) {
      logger.error('Layout processing failed:', error);
      throw new LayoutError('Failed to process layout', { cause: error });
    }
  }

  private generateCacheKey(graph: DependencyGraph): string {
    // Create a minimal representation for caching
    const minimalGraph = {
      nodes: graph.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        data: {
          parentId: node.data?.parentId,
        },
      })),
      edges: graph.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        type: edge.type,
      })),
    };

    return JSON.stringify(minimalGraph);
  }

  clearCache(): void {
    this.cache.clear();
  }
}
