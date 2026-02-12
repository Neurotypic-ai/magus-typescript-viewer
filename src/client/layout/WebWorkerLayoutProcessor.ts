/**
 * WebWorkerLayoutProcessor - A wrapper for the graph layout web worker
 * Handles communication with the web worker for offloading CPU-intensive layout calculations
 */

import { defaultLayoutConfig } from '../components/DependencyGraph/layout/config';
import { isProxy, toRaw } from 'vue';

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
  private config!: LayoutConfig;
  private workerSupported: boolean;
  private currentRequestId = 0;
  private static readonly LAYOUT_TIMEOUT_MS = 15_000;

  /**
   * Deep-clone a value while stripping Vue reactive proxies at every level.
   * Produces a plain-object tree that is safe for both `postMessage`
   * (structured-clone algorithm) and `structuredClone()`.
   */
  private static toCloneSafe<T>(value: T): T {
    const seen = new WeakMap<object, unknown>();

    const clone = (input: unknown): unknown => {
      if (input === null || typeof input !== 'object') return input;

      const raw = isProxy(input as object) ? (toRaw(input as object) as object) : (input as object);
      const cached = seen.get(raw);
      if (cached !== undefined) return cached;

      if (Array.isArray(raw)) {
        const out: unknown[] = [];
        seen.set(raw, out);
        for (const item of raw) out.push(clone(item));
        return out;
      }

      if (raw instanceof Date) return new Date(raw.getTime());

      if (raw instanceof Map) {
        const out = new Map<unknown, unknown>();
        seen.set(raw, out);
        raw.forEach((v, k) => out.set(clone(k), clone(v)));
        return out;
      }

      if (raw instanceof Set) {
        const out = new Set<unknown>();
        seen.set(raw, out);
        raw.forEach((v) => out.add(clone(v)));
        return out;
      }

      // Plain object — copy enumerable own properties
      const out: Record<string, unknown> = {};
      seen.set(raw, out);
      for (const [key, nested] of Object.entries(raw as Record<string, unknown>)) {
        out[key] = clone(nested);
      }
      return out;
    };

    return clone(value) as T;
  }

  private static preparePayload(graphData: { nodes: DependencyNode[]; edges: Edge[] }): {
    nodes: DependencyNode[];
    edges: Edge[];
  } {
    return {
      nodes: WebWorkerLayoutProcessor.toCloneSafe(graphData.nodes),
      edges: WebWorkerLayoutProcessor.toCloneSafe(graphData.edges),
    };
  }

  private static mapDirection(direction: string): 'DOWN' | 'UP' | 'RIGHT' | 'LEFT' {
    switch (direction) {
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
  }

  private applyConfig(config?: WebWorkerLayoutConfig): void {
    const mergedConfig = {
      ...defaultLayoutConfig,
      ...config,
    };

    this.config = {
      algorithm: mergedConfig.algorithm ?? 'layered',
      direction: WebWorkerLayoutProcessor.mapDirection(mergedConfig.direction ?? 'LR'),
      nodesep: mergedConfig.nodeSpacing ?? 100,
      ranksep: mergedConfig.rankSpacing ?? 150,
      edgesep: mergedConfig.edgeSpacing ?? 50,
      theme: mergedConfig.theme ?? defaultLayoutConfig.theme,
      animationDuration: mergedConfig.animationDuration,
    } as LayoutConfig;
  }

  constructor(config?: WebWorkerLayoutConfig) {
    this.applyConfig(config);

    // Check if web workers are supported
    this.workerSupported = typeof Worker !== 'undefined';

    // Initialize worker if supported
    if (this.workerSupported) {
      this.initWorker();
    }
  }

  /**
   * Updates processor config without recreating the worker.
   * Also increments request id to invalidate stale in-flight responses.
   */
  public updateConfig(config: WebWorkerLayoutConfig): void {
    this.applyConfig(config);
    this.currentRequestId += 1;
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
    // Normalize to plain objects so postMessage can structured-clone them.
    const { nodes, edges } = WebWorkerLayoutProcessor.preparePayload(graphData);

    if (!this.workerSupported || !this.worker) {
      const fallbackPayload = WebWorkerLayoutProcessor.preparePayload(graphData);
      return this.fallbackProcessLayout(fallbackPayload.nodes, fallbackPayload.edges);
    }

    // Increment request ID to allow cancellation of stale requests
    const requestId = ++this.currentRequestId;

    // Use the web worker
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      // Set up a timeout to reject if the worker takes too long
      const timeoutId = setTimeout(() => {
        this.worker?.removeEventListener('message', onMessage);
        this.worker?.removeEventListener('error', onError);
        reject(new Error('Layout timed out'));
      }, WebWorkerLayoutProcessor.LAYOUT_TIMEOUT_MS);

      // Set up the message handler for worker responses
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        clearTimeout(timeoutId);
        this.worker?.removeEventListener('message', onMessage); // Clean up listener
        this.worker?.removeEventListener('error', onError); // Clean up listener

        // Reject stale responses that were superseded by a newer request
        if (requestId !== this.currentRequestId) {
          reject(new Error('Layout request superseded'));
          return;
        }

        if (event.data.type === 'layout-complete') {
          resolve(event.data.payload as LayoutResult);
        } else {
          const errorPayload = event.data.payload as { error: string };
          reject(new Error(`Layout worker error: ${errorPayload.error}`));
        }
      };

      // Set up error handler
      const onError = (error: ErrorEvent) => {
        clearTimeout(timeoutId);
        this.worker?.removeEventListener('message', onMessage);
        this.worker?.removeEventListener('error', onError);
        console.error('Layout worker error:', error);
        // Fall back to synchronous processing
        const fallbackPayload = WebWorkerLayoutProcessor.preparePayload(graphData);
        this.fallbackProcessLayout(fallbackPayload.nodes, fallbackPayload.edges)
          .then(resolve)
          .catch(reject);
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
          config: WebWorkerLayoutProcessor.toCloneSafe(this.config),
        },
      };

      try {
        this.worker.postMessage(message);
      } catch (error) {
        clearTimeout(timeoutId);
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onError);
        const fallbackPayload = WebWorkerLayoutProcessor.preparePayload(graphData);
        this.fallbackProcessLayout(fallbackPayload.nodes, fallbackPayload.edges)
          .then(resolve)
          .catch(reject);
      }
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
