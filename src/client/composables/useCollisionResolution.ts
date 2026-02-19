import { ref, watch } from 'vue';

import { filterNodeChangesForFolderMode } from '../graph/buildGraphView';
import { applyNodeChanges } from '../utils/applyNodeChanges';
import {
  resolveCollisions,
  buildPositionMap,
  DEFAULT_COLLISION_CONFIG,
  createCollisionConfig,
  getActiveCollisionConfig,
} from '../layout/collisionResolver';
import type { CollisionConfig, CollisionResult } from '../layout/collisionResolver';

import type { Ref } from 'vue';
import type { NodeChange } from '@vue-flow/core';

import type { BoundsNode } from '../layout/geometryBounds';
import type { ManualOffset } from '../types/ManualOffset';
import type { DependencyNode } from '../types/DependencyNode';

/** Performance threshold: above this node count, skip live-drag settling entirely. */
const DRAG_END_ONLY_THRESHOLD = 700;
const DRAG_POSITION_EPSILON = 0.01;

/** Delay before applying folder contraction (ms). Expansion is always instant. */
const FOLDER_CONTRACTION_DELAY_MS = 400;

/** Map of strategyId -> { optionKey -> value }. Matches StrategyOptionsById from collisionResolver. */
export type CollisionStrategyOptionsById = Record<string, Record<string, unknown>>;

/** Strategy-driven collision config inputs. Pre-resolved minimumDistancePx overrides strategy lookup. */
export interface CollisionConfigInputs {
  /** Pre-resolved minimum distance (px). Takes precedence over strategy options when set. */
  minimumDistancePx?: number | Ref<number>;
  /** Active rendering strategy ID for option lookup. */
  renderingStrategyId?: Ref<string> | string;
  /** Strategy options by ID. Used with renderingStrategyId when minimumDistancePx not provided. */
  strategyOptionsById?: Ref<CollisionStrategyOptionsById> | CollisionStrategyOptionsById;
}

export interface UseCollisionResolutionOptions {
  nodes: Ref<DependencyNode[]>;
  isLayoutPending: Ref<boolean>;
  isLayoutMeasuring: Ref<boolean>;
  clusterByFolder: Ref<boolean>;
  getVueFlowNodes: () => DependencyNode[];
  setNodes: (nodes: DependencyNode[]) => void;
  updateNodesById: (updates: Map<string, DependencyNode>) => void;
  mergeManualOffsets: (offsets: Map<string, ManualOffset>) => void;
  reconcileSelectedNodeAfterStructuralChange: (nodes: DependencyNode[]) => void;
  /** Strategy inputs for collision config. When omitted, uses DEFAULT_COLLISION_CONFIG. */
  collisionConfigInputs?: CollisionConfigInputs;
}

export interface CollisionResolution {
  isApplyingCollisionResolution: Readonly<Ref<boolean>>;
  activeDraggedNodeIds: Readonly<Ref<Set<string>>>;
  userPinnedNodeIds: Readonly<Ref<Set<string>>>;
  /** Last resolve result for debug UI (cyclesUsed, converged, updatedPositions/sizes). */
  lastCollisionResult: Readonly<Ref<CollisionResult | null>>;
  handleNodesChange: (changes: NodeChange[]) => void;
  dispose: () => void;
}

function resolveActiveConfig(inputs: CollisionConfigInputs | undefined): CollisionConfig {
  if (!inputs) return DEFAULT_COLLISION_CONFIG;

  const rawMinPx =
    inputs.minimumDistancePx != null
      ? typeof inputs.minimumDistancePx === 'object' && 'value' in inputs.minimumDistancePx
        ? inputs.minimumDistancePx.value
        : inputs.minimumDistancePx
      : undefined;

  if (typeof rawMinPx === 'number' && Number.isFinite(rawMinPx) && rawMinPx >= 0) {
    return createCollisionConfig(rawMinPx);
  }

  const strategyId =
    inputs.renderingStrategyId != null && typeof inputs.renderingStrategyId === 'object' && 'value' in inputs.renderingStrategyId
      ? inputs.renderingStrategyId.value
      : inputs.renderingStrategyId;

  const optionsById =
    typeof inputs.strategyOptionsById === 'object' &&
    /* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- typeof null==='object' in JS; null check required */
    inputs.strategyOptionsById != null &&
    'value' in inputs.strategyOptionsById
      ? (inputs.strategyOptionsById as Ref<CollisionStrategyOptionsById>).value
      : inputs.strategyOptionsById;

  if (strategyId != null && optionsById != null) {
    return getActiveCollisionConfig(strategyId, optionsById);
  }

  return DEFAULT_COLLISION_CONFIG;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a VueFlow-enriched node shape from the live VueFlow instance. */
interface EnrichedNode {
  id: string;
  position: { x: number; y: number };
  parentNode?: string;
  style?: unknown;
  dimensions?: { width: number; height: number };
  measured?: { width?: number; height?: number };
  type?: string;
  data?: unknown;
}

function enrichedToBoundsNode(n: EnrichedNode): BoundsNode {
  const measured = n.dimensions
    ? { width: n.dimensions.width, height: n.dimensions.height }
    : n.measured;
  return {
    id: n.id,
    position: n.position,
    ...(n.parentNode ? { parentNode: n.parentNode } : {}),
    ...(n.style !== undefined ? { style: n.style } : {}),
    ...(n.type ? { type: n.type } : {}),
    ...(n.data !== undefined ? { data: n.data } : {}),
    ...(measured ? { measured } : {}),
  } as BoundsNode;
}

function parseStyleSize(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main composable
// ---------------------------------------------------------------------------

export function useCollisionResolution(options: UseCollisionResolutionOptions): CollisionResolution {
  const {
    nodes,
    isLayoutPending,
    isLayoutMeasuring,
    clusterByFolder,
    getVueFlowNodes,
    setNodes,
    updateNodesById,
    mergeManualOffsets,
    reconcileSelectedNodeAfterStructuralChange,
    collisionConfigInputs,
  } = options;

  const isApplyingCollisionResolution = ref(false);
  const activeDraggedNodeIds = ref<Set<string>>(new Set());
  const userPinnedNodeIds = ref<Set<string>>(new Set());
  const lastCollisionResult = ref<CollisionResult | null>(null);
  let collisionDimensionTimer: ReturnType<typeof setTimeout> | null = null;

  // Pending folder contraction timers — instant expand, delayed contract
  const contractionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // ---- Core resolve logic ----

  /**
   * Run the collision resolver and apply results immediately.
   * All position and size changes are applied without animation for snappy interaction.
   */
  const runCollisionSettle = (anchoredNodeIds: Set<string> | null) => {
    if (isApplyingCollisionResolution.value || isLayoutPending.value || isLayoutMeasuring.value) {
      return;
    }

    const currentNodes = nodes.value;
    if (currentNodes.length === 0) return;

    isApplyingCollisionResolution.value = true;
    try {
      const nodeById = new Map(currentNodes.map((n) => [n.id, n]));

      // Prune stale anchors
      const activeAnchors = new Set<string>();
      for (const id of activeDraggedNodeIds.value) {
        if (nodeById.has(id)) activeAnchors.add(id);
      }
      if (activeAnchors.size !== activeDraggedNodeIds.value.size) {
        activeDraggedNodeIds.value = activeAnchors;
      }

      const persistentAnchors = new Set<string>();
      for (const id of userPinnedNodeIds.value) {
        if (nodeById.has(id)) persistentAnchors.add(id);
      }
      if (persistentAnchors.size !== userPinnedNodeIds.value.size) {
        userPinnedNodeIds.value = persistentAnchors;
      }

      // Build combined anchor set
      const resolverAnchors = new Set<string>(persistentAnchors);
      for (const id of activeAnchors) resolverAnchors.add(id);
      if (anchoredNodeIds) {
        for (const id of anchoredNodeIds) {
          if (nodeById.has(id)) resolverAnchors.add(id);
        }
      }

      // Build BoundsNode array from VueFlow state
      const vfNodes = getVueFlowNodes();
      const enrichedNodes = (Array.isArray(vfNodes) ? vfNodes : []) as EnrichedNode[];
      const boundsNodes = enrichedNodes.map(enrichedToBoundsNode);

      const posMap = buildPositionMap(boundsNodes, {
        defaultNodeWidth: 260,
        defaultNodeHeight: 100,
      });

      const config = resolveActiveConfig(collisionConfigInputs);
      const result = resolveCollisions(
        boundsNodes,
        posMap,
        resolverAnchors.size > 0 ? resolverAnchors : null,
        config,
        activeAnchors
      );

      lastCollisionResult.value = result;

      if (result.updatedPositions.size === 0 && result.updatedSizes.size === 0) {
        return;
      }

      // Apply group sizes with contraction delay, then positions immediately
      if (result.updatedSizes.size > 0) {
        applyGroupSizesWithContractionDelay(result.updatedSizes, nodeById);
      }
      applyResultsImmediately(result, nodeById, enrichedNodes);
    } finally {
      isApplyingCollisionResolution.value = false;
    }
  };

  /**
   * Apply group sizes: expansions are instant, contractions are delayed.
   * If a folder is expanding, any pending contraction timer is cancelled.
   */
  function applyGroupSizesWithContractionDelay(
    sizes: Map<string, { width: number; height: number }>,
    nodeById: Map<string, DependencyNode>
  ): void {
    const immediateUpdates = new Map<string, DependencyNode>();

    for (const [id, targetSize] of sizes) {
      const node = nodeById.get(id);
      if (!node) continue;

      const style = typeof node.style === 'object'
        ? (node.style as Record<string, unknown>) : {};
      const currentWidth = parseStyleSize(style['width']);
      const currentHeight = parseStyleSize(style['height']);
      const targetWidth = Math.ceil(targetSize.width);
      const targetHeight = Math.ceil(targetSize.height);

      // Determine if this is an expansion or contraction
      const isExpanding =
        (currentWidth !== null && targetWidth > currentWidth) ||
        (currentHeight !== null && targetHeight > currentHeight);

      if (isExpanding || currentWidth === null || currentHeight === null) {
        // Expansion: apply immediately, cancel any pending contraction
        const existingTimer = contractionTimers.get(id);
        if (existingTimer !== undefined) {
          clearTimeout(existingTimer);
          contractionTimers.delete(id);
        }
        immediateUpdates.set(id, {
          ...node,
          style: {
            ...style,
            width: `${String(targetWidth)}px`,
            height: `${String(targetHeight)}px`,
          },
        } as DependencyNode);
      } else {
        // Contraction: schedule delayed application
        const existingTimer = contractionTimers.get(id);
        if (existingTimer !== undefined) {
          clearTimeout(existingTimer);
        }
        contractionTimers.set(id, setTimeout(() => {
          contractionTimers.delete(id);
          const currentNode = nodes.value.find((n) => n.id === id);
          if (!currentNode) return;
          const currentStyle = typeof currentNode.style === 'object'
            ? (currentNode.style as Record<string, unknown>) : {};
          updateNodesById(new Map([[id, {
            ...currentNode,
            style: {
              ...currentStyle,
              width: `${String(targetWidth)}px`,
              height: `${String(targetHeight)}px`,
            },
          } as DependencyNode]]));
          // Re-settle to catch any new collisions from the size change
          scheduleDimensionSettle();
        }, FOLDER_CONTRACTION_DELAY_MS));
      }
    }

    if (immediateUpdates.size > 0) updateNodesById(immediateUpdates);
  }

  /** Apply collision results immediately to the graph store (no animation). */
  function applyResultsImmediately(
    result: CollisionResult,
    nodeById: Map<string, DependencyNode>,
    enrichedNodes: EnrichedNode[]
  ): void {
    const nodeUpdates = new Map<string, DependencyNode>();
    const offsetUpdates = new Map<string, ManualOffset>();

    for (const [id, newPos] of result.updatedPositions) {
      const node = nodeById.get(id);
      if (!node) continue;
      const dx = newPos.x - node.position.x;
      const dy = newPos.y - node.position.y;
      nodeUpdates.set(id, {
        ...node,
        position: { x: newPos.x, y: newPos.y },
      } as DependencyNode);
      offsetUpdates.set(id, { dx, dy });
    }

    // Refresh actively-dragged nodes' positions from VueFlow to prevent snap-back
    if (nodeUpdates.size > 0 && activeDraggedNodeIds.value.size > 0) {
      const vfNodeById = new Map(enrichedNodes.map((n) => [n.id, n]));
      for (const dragId of activeDraggedNodeIds.value) {
        if (nodeUpdates.has(dragId)) continue;
        const storeNode = nodeById.get(dragId);
        const vfNode = vfNodeById.get(dragId);
        if (!storeNode || !vfNode?.position) continue;
        if (
          Math.abs(storeNode.position.x - vfNode.position.x) < 0.01 &&
          Math.abs(storeNode.position.y - vfNode.position.y) < 0.01
        ) {
          continue;
        }
        nodeUpdates.set(dragId, {
          ...storeNode,
          position: { x: vfNode.position.x, y: vfNode.position.y },
        } as DependencyNode);
      }
    }

    if (nodeUpdates.size > 0) {
      updateNodesById(nodeUpdates);
    }
    if (offsetUpdates.size > 0) {
      mergeManualOffsets(offsetUpdates);
    }
  }

  // ---- Dimension change debounce (non-drag path) ----

  const scheduleDimensionSettle = () => {
    if (collisionDimensionTimer !== null) {
      clearTimeout(collisionDimensionTimer);
    }
    collisionDimensionTimer = setTimeout(() => {
      collisionDimensionTimer = null;
      const activeAnchors = activeDraggedNodeIds.value;
      runCollisionSettle(activeAnchors.size > 0 ? new Set(activeAnchors) : null);
    }, 60);
  };

  // ---- Post-layout collision settle ----
  // During two-pass layout, isLayoutPending is true and all dimension-change
  // events are suppressed. When the layout completes and clears the flag,
  // we need to run a collision settle so the initial render respects
  // minimumDistance. Without this, nodes sit at ELK's raw positions.
  let layoutWasActive = isLayoutPending.value;
  const stopLayoutWatch = watch(isLayoutPending, (pending) => {
    if (layoutWasActive && !pending) {
      // Layout just finished — schedule a settle after dimensions stabilize
      scheduleDimensionSettle();
    }
    layoutWasActive = pending;
  });

  // ---- Event classification ----

  const handleNodesChange = (changes: NodeChange[]) => {
    if (!changes.length) return;

    if (isApplyingCollisionResolution.value) return;

    const filteredChanges = filterNodeChangesForFolderMode(changes, nodes.value, clusterByFolder.value);
    if (!filteredChanges.length) return;

    const structuralChanges = filteredChanges.filter((change) => change.type !== 'select');
    if (!structuralChanges.length) return;

    const previousNodes = nodes.value;
    const previousNodeById = new Map(previousNodes.map((node) => [node.id, node]));

    const dragPositionIds = new Set<string>();
    const dragLifecycleIds = new Set<string>();
    const dragEndedIds = new Set<string>();
    const dragStateById = new Map<string, boolean>();
    let hasLiveDrag = false;
    let hasDragEnd = false;
    let hasDimensionChange = false;

    for (const change of structuralChanges) {
      if (change.type === 'position') {
        const posChange = change as { id: string; dragging?: boolean };
        dragPositionIds.add(posChange.id);
        if (posChange.dragging === true) {
          dragLifecycleIds.add(posChange.id);
          dragStateById.set(posChange.id, true);
          hasLiveDrag = true;
        } else if (posChange.dragging === false) {
          dragLifecycleIds.add(posChange.id);
          dragEndedIds.add(posChange.id);
          dragStateById.set(posChange.id, false);
          hasDragEnd = true;
        }
      } else if (change.type === 'dimensions') {
        hasDimensionChange = true;
      }
    }

    const updatedNodes = applyNodeChanges(structuralChanges, previousNodes);
    setNodes(updatedNodes);
    reconcileSelectedNodeAfterStructuralChange(updatedNodes);

    if (dragLifecycleIds.size > 0) {
      const updatedNodeById = new Map(updatedNodes.map((node) => [node.id, node]));
      const dragOffsetUpdates = new Map<string, ManualOffset>();
      for (const nodeId of dragLifecycleIds) {
        const prev = previousNodeById.get(nodeId);
        const next = updatedNodeById.get(nodeId);
        if (!prev?.position || !next?.position) continue;
        const dx = next.position.x - prev.position.x;
        const dy = next.position.y - prev.position.y;
        if (Math.abs(dx) <= DRAG_POSITION_EPSILON && Math.abs(dy) <= DRAG_POSITION_EPSILON) continue;
        dragOffsetUpdates.set(nodeId, { dx, dy });
      }
      if (dragOffsetUpdates.size > 0) {
        mergeManualOffsets(dragOffsetUpdates);
      }
    }

    if (dragEndedIds.size > 0) {
      const nextPinned = new Set(userPinnedNodeIds.value);
      dragEndedIds.forEach((id) => nextPinned.add(id));
      userPinnedNodeIds.value = nextPinned;
    }

    if (dragStateById.size > 0) {
      const nextActiveDragged = new Set(activeDraggedNodeIds.value);
      for (const [nodeId, dragging] of dragStateById) {
        if (dragging) {
          nextActiveDragged.add(nodeId);
        } else {
          nextActiveDragged.delete(nodeId);
        }
      }
      activeDraggedNodeIds.value = nextActiveDragged;
    }

    if (dragPositionIds.size > 0) {
      const nodeCount = nodes.value.length;

      // For very large graphs, only resolve on drag-end
      if (nodeCount > DRAG_END_ONLY_THRESHOLD && hasLiveDrag && !hasDragEnd) {
        return;
      }

      const settleAnchors = dragLifecycleIds.size > 0 ? dragLifecycleIds : dragPositionIds;
      runCollisionSettle(settleAnchors);
    } else if (hasDimensionChange && !isLayoutPending.value && !isLayoutMeasuring.value) {
      scheduleDimensionSettle();
    }
  };

  const dispose = (): void => {
    stopLayoutWatch();
    for (const timer of contractionTimers.values()) {
      clearTimeout(timer);
    }
    contractionTimers.clear();
    if (collisionDimensionTimer !== null) {
      clearTimeout(collisionDimensionTimer);
      collisionDimensionTimer = null;
    }
  };

  return {
    isApplyingCollisionResolution,
    activeDraggedNodeIds,
    userPinnedNodeIds,
    lastCollisionResult,
    handleNodesChange,
    dispose,
  };
}
