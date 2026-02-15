/**
 * Shared message and payload types for the edge visibility worker.
 * Types-only module: safe for the worker to import (no Vue, no DOM).
 */

import type {
  EdgeVirtualizationConfig,
  EdgeVirtualizationContainerSize,
  EdgeVirtualizationDeviceProfile,
  EdgeVirtualizationEdge,
  EdgeVirtualizationNode,
  EdgeVirtualizationViewport,
} from '../types/EdgeVirtualization';

// ── Request payloads ──

/** Payload for syncing graph nodes/edges to the worker. */
export interface SyncGraphPayload {
  nodes: EdgeVirtualizationNode[];
  edges: EdgeVirtualizationEdge[];
}

/** Payload for requesting a visibility recalc from the worker. */
export interface RecalculatePayload {
  recalcVersion: number;
  graphVersion: number;
  viewport: EdgeVirtualizationViewport;
  containerSize?: EdgeVirtualizationContainerSize | null;
  userHiddenEdgeIds: string[];
  config?: Partial<EdgeVirtualizationConfig>;
  deviceProfile?: EdgeVirtualizationDeviceProfile;
}

// ── Response payloads ──

/** Payload returned by the worker after visibility recalc. */
export interface RecalculateResultPayload {
  recalcVersion: number;
  graphVersion: number;
  hiddenEdgeIds: string[];
  viewportVisibleCount: number;
  finalVisibleCount: number;
  lowZoomApplied: boolean;
  lowZoomBudget?: number;
}

/** Payload for worker error messages. */
export interface EdgeVisibilityErrorPayload {
  error: string;
}

// ── Message type literals ──

export type SyncGraphMessageType = 'sync-graph';
export type RecalculateMessageType = 'recalculate';
export type EdgeVisibilityResultMessageType = 'edge-visibility-result';
export type EdgeVisibilityErrorMessageType = 'edge-visibility-error';

// ── Request messages ──

export interface SyncGraphMessage {
  type: SyncGraphMessageType;
  payload: SyncGraphPayload;
}

export interface RecalculateMessage {
  type: RecalculateMessageType;
  requestId: number;
  payload: RecalculatePayload;
}

export type WorkerRequestMessage = SyncGraphMessage | RecalculateMessage;

// ── Response messages ──

export interface RecalculateResultMessage {
  type: EdgeVisibilityResultMessageType;
  requestId: number;
  payload: RecalculateResultPayload;
}

export interface EdgeVisibilityErrorMessage {
  type: EdgeVisibilityErrorMessageType;
  requestId?: number;
  payload: EdgeVisibilityErrorPayload;
}

export type WorkerResponseMessage = RecalculateResultMessage | EdgeVisibilityErrorMessage;
