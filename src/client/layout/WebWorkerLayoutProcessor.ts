/**
 * WebWorkerLayoutProcessor - A wrapper for the graph layout web worker
 * Handles communication with the web worker for offloading CPU-intensive layout calculations
 */

import { defaultLayoutConfig } from '../components/DependencyGraph/layout/config';

import type { Edge } from '@vue-flow/core';

import type { DependencyNode } from '../components/DependencyGraph/types';
import type { GraphTheme } from '../theme/graphTheme';

// Internal layout configuration type used by the worker
export interface LayoutConfig {
  algorithm: 'layered' | 'radial' | 'force' | 'stress';
  direction: 'DOWN' | 'UP' | 'RIGHT' | 'LEFT';
  nodesep: number;
  edgesep: number;
  ranksep: number;
  theme: GraphTheme;
  animationDuration?: number;
}

// Layout processing result type
export interface LayoutResult {
  nodes: DependencyNode[];
  edges: Edge[];
}

/**
 * Worker message types
 */
interface WorkerRequest {
  type: 'process-layout';
  payload: {
    nodes: DependencyNode[];
    edges: Edge[];
    config: LayoutConfig;
  };
}

interface WorkerResponse {
  type: 'layout-complete' | 'layout-error';
  payload: LayoutResult | { error: string };
}

/**
 * Configuration for initializing the WebWorkerLayoutProcessor
 */
export interface WebWorkerLayoutConfig {
  algorithm?: 'layered' | 'radial' | 'force' | 'stress';
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  nodeSpacing?: number;
  rankSpacing?: number;
  edgeSpacing?: number;
  theme?: GraphTheme;
  animationDuration?: number;
}

/**
 * A class that manages the web worker for processing graph layouts
 */
export class WebWorkerLayoutProcessor {
  private worker: Worker | null = null;
  private config: LayoutConfig;
  private workerSupported: boolean;

  constructor(config?: WebWorkerLayoutConfig) {
    // Map the default config to the worker's expected format
    const mergedConfig = {
      ...defaultLayoutConfig,
      ...config,
    };

    // Map TB/BT/LR/RL to ELK's DOWN/UP/RIGHT/LEFT
    const mapDirection = (dir: string): 'DOWN' | 'UP' | 'RIGHT' | 'LEFT' => {
      switch (dir) {
        case 'TB':
          return 'DOWN';
        case 'BT':
          return 'UP';
        case 'RL':
          return 'LEFT';
        case 'LR':
        default:
          return 'RIGHT';
      }
    };

    this.config = {
      algorithm: mergedConfig.algorithm ?? 'layered',
      direction: mapDirection(mergedConfig.direction ?? 'LR'),
      nodesep: mergedConfig.nodeSpacing ?? 100,
      ranksep: mergedConfig.rankSpacing ?? 150,
      edgesep: mergedConfig.edgeSpacing ?? 50,
      theme: mergedConfig.theme ?? defaultLayoutConfig.theme,
      animationDuration: mergedConfig.animationDuration,
    } as LayoutConfig;

    // Check if web workers are supported
    this.workerSupported = typeof Worker !== 'undefined';

    // Initialize worker if supported
    if (this.workerSupported) {
      this.initWorker();
    }
  }

  /**
   * Initialize the web worker
   */
  private initWorker(): void {
    try {
      this.worker = new Worker(new URL('../workers/GraphLayoutWorker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      console.error('Failed to initialize layout worker:', error);
      this.workerSupported = false;
    }
  }

  /**
   * Process the graph layout using the web worker
   * @param graphData The graph data to process
   * @returns A promise that resolves with the processed layout
   */
  public processLayout(graphData: { nodes: DependencyNode[]; edges: Edge[] }): Promise<LayoutResult> {
    // Create a deep copy of nodes and edges to avoid mutation
    const nodes = JSON.parse(JSON.stringify(graphData.nodes)) as DependencyNode[];
    const edges = JSON.parse(JSON.stringify(graphData.edges)) as Edge[];

    // If worker is not supported or failed to initialize, use fallback
    if (!this.workerSupported || !this.worker) {
      return this.fallbackProcessLayout(nodes, edges);
    }

    // Use the web worker
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      // Set up the message handler for worker responses
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        this.worker?.removeEventListener('message', onMessage); // Clean up listener
        this.worker?.removeEventListener('error', onError); // Clean up listener
        if (event.data.type === 'layout-complete') {
          resolve(event.data.payload as LayoutResult);
        } else {
          const errorPayload = event.data.payload as { error: string };
          reject(new Error(`Layout worker error: ${errorPayload.error}`));
        }
      };

      // Set up error handler
      const onError = (error: ErrorEvent) => {
        this.worker?.removeEventListener('error', onError);
        console.error('Layout worker error:', error);
        // Fall back to synchronous processing
        this.fallbackProcessLayout(nodes, edges).then(resolve).catch(reject);
      };

      // Add event listeners
      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);

      // Send the data to the worker
      const message: WorkerRequest = {
        type: 'process-layout',
        payload: {
          nodes,
          edges,
          config: this.config,
        },
      };

      this.worker.postMessage(message);
    });
  }

  /**
   * Fallback synchronous layout processing when web worker is not available
   * @param nodes The nodes to process
   * @param edges The edges to process
   * @returns A promise that resolves with the processed layout
   */
  private fallbackProcessLayout(nodes: DependencyNode[], edges: Edge[]): Promise<LayoutResult> {
    // Simple fallback layout algorithm - hierarchical grid layout
    const packages = nodes.filter((n) => n.type === 'package');
    const modules = nodes.filter((n) => n.type === 'module');
    const others = nodes.filter((n) => n.type !== 'package' && n.type !== 'module');

    let currentY = 50;
    let currentX = 50;
    const horizontalSpacing = 250;
    const verticalSpacing = 200;
    const maxPerRow = 4;

    // Layout packages
    packages.forEach((node, index) => {
      if (index > 0 && index % maxPerRow === 0) {
        currentY += verticalSpacing;
        currentX = 50;
      }
      node.position = { x: currentX, y: currentY };
      currentX += horizontalSpacing;
    });

    // Layout modules
    if (modules.length > 0) {
      currentY += verticalSpacing;
      currentX = 50;
      modules.forEach((node, index) => {
        if (index > 0 && index % maxPerRow === 0) {
          currentY += verticalSpacing;
          currentX = 50;
        }
        node.position = { x: currentX, y: currentY };
        currentX += horizontalSpacing;
      });
    }

    // Layout other nodes
    if (others.length > 0) {
      currentY += verticalSpacing;
      currentX = 50;
      others.forEach((node, index) => {
        if (index > 0 && index % maxPerRow === 0) {
          currentY += verticalSpacing;
          currentX = 50;
        }
        node.position = { x: currentX, y: currentY };
        currentX += horizontalSpacing;
      });
    }

    return Promise.resolve({ nodes, edges });
  }

  /**
   * Terminate the web worker
   */
  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
