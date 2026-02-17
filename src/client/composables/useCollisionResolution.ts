import { ref } from 'vue';

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
import { useSpringAnimation } from './useSpringAnimation';

import type { Ref } from 'vue';
import type { NodeChange } from '@vue-flow/core';

import type { BoundsNode } from '../layout/geometryBounds';
import type { ManualOffset } from '../types/ManualOffset';
import type { DependencyNode } from '../types/DependencyNode';

/** Performance threshold: above this node count, skip live-drag settling entirely. */
const DRAG_END_ONLY_THRESHOLD = 700;
const DRAG_POSITION_EPSILON = 0.01;

/**
 * How often (in spring animation frames) to re-run the collision resolver
 * using current interpolated positions. This catches cascading collisions
 * from spring overshoot. ~4 frames at 60fps ≈ 66ms.
 */
const RERESOLUTION_FRAME_INTERVAL = 4;

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

  // Reduced motion detection
  const reducedMotion = ref(false);
  if (typeof window !== 'undefined') {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.value = mql.matches;
    mql.addEventListener('change', (e: MediaQueryListEvent) => {
      reducedMotion.value = e.matches;
    });
  }

  // Frame counter for throttled re-resolution during spring animation
  let springFrameCount = 0;
  // Track whether the current resolve context is a drag interaction
  let isDragInteraction = false;

  // ---- Spring animation system ----

  const springAnimation = useSpringAnimation({
    onFrame: (positions, sizes) => {
      isApplyingCollisionResolution.value = true;
      try {
        const currentNodes = nodes.value;
        const nodeById = new Map(currentNodes.map((n) => [n.id, n]));
        const nodeUpdates = new Map<string, DependencyNode>();

        for (const [id, pos] of positions) {
          const node = nodeById.get(id);
          if (!node) continue;
          // Skip dragged nodes — they should not be animated
          if (activeDraggedNodeIds.value.has(id)) continue;
          nodeUpdates.set(id, {
            ...node,
            position: { x: pos.x, y: pos.y },
          } as DependencyNode);
        }

        for (const [id, size] of sizes) {
          const existing = nodeUpdates.get(id) ?? nodeById.get(id);
          if (!existing) continue;
          const currentStyle = typeof existing.style === 'object' ? (existing.style as Record<string, unknown>) : {};
          const targetWidth = Math.ceil(size.width);
          const targetHeight = Math.ceil(size.height);
          nodeUpdates.set(id, {
            ...existing,
            style: {
              ...currentStyle,
              width: `${String(targetWidth)}px`,
              height: `${String(targetHeight)}px`,
            },
          } as DependencyNode);
        }

        if (nodeUpdates.size > 0) {
          updateNodesById(nodeUpdates);
        }

        // Throttled re-resolution: detect cascading collisions from spring overshoot
        springFrameCount++;
        if (springFrameCount % RERESOLUTION_FRAME_INTERVAL === 0) {
          reResolveFromInterpolatedPositions();
        }
      } finally {
        isApplyingCollisionResolution.value = false;
      }
    },
    onSettle: () => {
      // Final collision check after all springs settle to catch overshoot overlaps
      runCollisionSettle(null, false);
    },
    reducedMotion,
  });

  // ---- Core resolve logic ----

  /**
   * Run the collision resolver and either apply results immediately or
   * feed them to the spring animation system.
   *
   * @param anchoredNodeIds - Nodes to treat as anchored (immovable).
   * @param useSpring - Whether to animate results via springs (drag interactions)
   *   or apply immediately (dimension changes, reduced motion, final settle).
   */
  const runCollisionSettle = (anchoredNodeIds: Set<string> | null, useSpring = false) => {
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

      // ---- Apply path: spring animation or immediate ----

      if (useSpring && !reducedMotion.value) {
        // Build node type map for spring profile selection
        const nodeTypeMap = new Map<string, string>();
        for (const n of enrichedNodes) {
          if (n.type) nodeTypeMap.set(n.id, n.type);
        }

        // Initialize spring current positions from store if node is new to spring system
        initializeSpringPositions(result, nodeById);

        springAnimation.setTargets(
          result.updatedPositions,
          result.updatedSizes,
          nodeTypeMap
        );
        springFrameCount = 0;
      } else {
        // Immediate application (non-drag, reduced motion, or final settle)
        applyResultsImmediately(result, nodeById, enrichedNodes);
      }
    } finally {
      isApplyingCollisionResolution.value = false;
    }
  };

  /**
   * Initialize spring "current" positions from store state for nodes that
   * are newly entering the spring system. This ensures the first frame
   * starts from the node's actual position, not its target.
   */
  function initializeSpringPositions(
    result: CollisionResult,
    nodeById: Map<string, DependencyNode>
  ): void {
    const currentPositions = springAnimation.getCurrentPositions();
    for (const [id] of result.updatedPositions) {
      if (!currentPositions.has(id)) {
        // Node is new to springs — seed with its current store position
        const node = nodeById.get(id);
        if (node?.position) {
          const currentStyle = typeof node.style === 'object' ? (node.style as Record<string, unknown>) : {};
          const w = parseStyleSize(currentStyle['width']);
          const h = parseStyleSize(currentStyle['height']);
          // We set target = current so setTargets() will then update target
          const seedPos = new Map<string, { x: number; y: number }>([[id, node.position]]);
          const seedSize = w != null && h != null
            ? new Map<string, { width: number; height: number }>([[id, { width: w, height: h }]])
            : new Map<string, { width: number; height: number }>();
          const nodeTypeMap = new Map<string, string>();
          const nodeType = (node as { type?: string }).type;
          if (nodeType) {
            nodeTypeMap.set(id, nodeType);
          }
          springAnimation.setTargets(seedPos, seedSize, nodeTypeMap);
        }
      }
    }
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

    for (const [id, newSize] of result.updatedSizes) {
      const existing = nodeUpdates.get(id) ?? nodeById.get(id);
      if (!existing) continue;
      const currentStyle = typeof existing.style === 'object' ? (existing.style as Record<string, unknown>) : {};
      const targetWidth = Math.ceil(newSize.width);
      const targetHeight = Math.ceil(newSize.height);
      const currentWidth = parseStyleSize(currentStyle['width']);
      const currentHeight = parseStyleSize(currentStyle['height']);
      if (
        currentWidth !== null &&
        currentHeight !== null &&
        Math.abs(currentWidth - targetWidth) < 1 &&
        Math.abs(currentHeight - targetHeight) < 1
      ) {
        continue;
      }
      nodeUpdates.set(id, {
        ...existing,
        style: {
          ...currentStyle,
          width: `${String(targetWidth)}px`,
          height: `${String(targetHeight)}px`,
        },
      } as DependencyNode);
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

  /**
   * Re-run the collision resolver using the spring system's current
   * interpolated positions. This catches cascading collisions caused
   * by spring overshoot. Called from the spring onFrame callback at
   * a throttled interval.
   */
  function reResolveFromInterpolatedPositions(): void {
    const currentNodes = nodes.value;
    if (currentNodes.length === 0) return;

    const vfNodes = getVueFlowNodes();
    const enrichedNodes = (Array.isArray(vfNodes) ? vfNodes : []) as EnrichedNode[];
    const boundsNodes = enrichedNodes.map(enrichedToBoundsNode);

    const posMap = buildPositionMap(boundsNodes, {
      defaultNodeWidth: 260,
      defaultNodeHeight: 100,
    });

    // Overlay spring interpolated positions onto the position map
    const springPositions = springAnimation.getCurrentPositions();
    const springSizes = springAnimation.getCurrentSizes();
    for (const [id, pos] of springPositions) {
      const box = posMap.get(id);
      if (box) {
        box.x = pos.x;
        box.y = pos.y;
      }
    }
    for (const [id, size] of springSizes) {
      const box = posMap.get(id);
      if (box) {
        box.width = size.width;
        box.height = size.height;
      }
    }

    const nodeById = new Map(currentNodes.map((n) => [n.id, n]));
    const activeAnchors = new Set<string>();
    for (const id of activeDraggedNodeIds.value) {
      if (nodeById.has(id)) activeAnchors.add(id);
    }

    const resolverAnchors = new Set<string>(activeAnchors);
    for (const id of userPinnedNodeIds.value) {
      if (nodeById.has(id)) resolverAnchors.add(id);
    }

    const config = resolveActiveConfig(collisionConfigInputs);
    const result = resolveCollisions(
      boundsNodes,
      posMap,
      resolverAnchors.size > 0 ? resolverAnchors : null,
      config,
      activeAnchors
    );

    if (result.updatedPositions.size > 0 || result.updatedSizes.size > 0) {
      const nodeTypeMap = new Map<string, string>();
      for (const n of enrichedNodes) {
        if (n.type) nodeTypeMap.set(n.id, n.type);
      }
      // Feed new targets to springs — velocity is preserved for smooth retargeting
      springAnimation.setTargets(result.updatedPositions, result.updatedSizes, nodeTypeMap);
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
      runCollisionSettle(activeAnchors.size > 0 ? new Set(activeAnchors) : null, false);
    }, 60);
  };

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
          // Remove dragged node from spring system — it's hard-anchored
          springAnimation.removeNode(nodeId);
        } else {
          nextActiveDragged.delete(nodeId);
        }
      }
      activeDraggedNodeIds.value = nextActiveDragged;
    }

    if (dragPositionIds.size > 0) {
      const nodeCount = nodes.value.length;
      isDragInteraction = hasLiveDrag || hasDragEnd;

      // For very large graphs, only resolve on drag-end
      if (nodeCount > DRAG_END_ONLY_THRESHOLD && hasLiveDrag && !hasDragEnd) {
        return;
      }

      const settleAnchors = dragLifecycleIds.size > 0 ? dragLifecycleIds : dragPositionIds;
      // Use spring animation for drag interactions (smooth), immediate for drag-end settle
      runCollisionSettle(settleAnchors, isDragInteraction && hasLiveDrag);
    } else if (hasDimensionChange && !isLayoutPending.value && !isLayoutMeasuring.value) {
      scheduleDimensionSettle();
    }
  };

  const dispose = (): void => {
    springAnimation.dispose();
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
