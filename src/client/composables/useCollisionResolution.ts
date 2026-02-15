import { ref } from 'vue';

import { filterNodeChangesForFolderMode } from '../graph/buildGraphView';
import { applyNodeChanges } from '../utils/applyNodeChanges';
import { resolveCollisions, buildPositionMap, DEFAULT_COLLISION_CONFIG } from '../layout/collisionResolver';

import type { Ref } from 'vue';
import type { NodeChange } from '@vue-flow/core';

import type { BoundsNode } from '../layout/geometryBounds';
import type { ManualOffset } from '../types/ManualOffset';
import type { DependencyNode } from '../types/DependencyNode';

const LIVE_SETTLE_NODE_THRESHOLD = 350;
const LIVE_SETTLE_MIN_INTERVAL_MS = 32;
const DRAG_END_ONLY_THRESHOLD = 700;
const DRAG_POSITION_EPSILON = 0.01;

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
}

export interface CollisionResolution {
  isApplyingCollisionResolution: Readonly<Ref<boolean>>;
  activeDraggedNodeIds: Readonly<Ref<Set<string>>>;
  userPinnedNodeIds: Readonly<Ref<Set<string>>>;
  handleNodesChange: (changes: NodeChange[]) => void;
  dispose: () => void;
}

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
  } = options;

  const isApplyingCollisionResolution = ref(false);
  const activeDraggedNodeIds = ref<Set<string>>(new Set());
  const userPinnedNodeIds = ref<Set<string>>(new Set());
  let collisionSettleRafId: number | null = null;
  let collisionDimensionTimer: ReturnType<typeof setTimeout> | null = null;
  let lastCollisionSettleTime = 0;

  const runCollisionSettle = (anchoredNodeIds: Set<string> | null) => {
    if (isApplyingCollisionResolution.value || isLayoutPending.value || isLayoutMeasuring.value) {
      return;
    }

    const currentNodes = nodes.value;
    if (currentNodes.length === 0) return;

    isApplyingCollisionResolution.value = true;
    try {
      const nodeById = new Map(currentNodes.map((n) => [n.id, n]));
      const activeAnchors = new Set<string>();
      for (const id of activeDraggedNodeIds.value) {
        if (nodeById.has(id)) {
          activeAnchors.add(id);
        }
      }
      if (activeAnchors.size !== activeDraggedNodeIds.value.size) {
        activeDraggedNodeIds.value = activeAnchors;
      }

      const persistentAnchors = new Set<string>();
      for (const id of userPinnedNodeIds.value) {
        if (nodeById.has(id)) {
          persistentAnchors.add(id);
        }
      }
      if (persistentAnchors.size !== userPinnedNodeIds.value.size) {
        userPinnedNodeIds.value = persistentAnchors;
      }

      const resolverAnchors = new Set<string>(persistentAnchors);
      for (const id of activeAnchors) {
        resolverAnchors.add(id);
      }
      if (anchoredNodeIds) {
        for (const id of anchoredNodeIds) {
          if (nodeById.has(id)) {
            resolverAnchors.add(id);
          }
        }
      }

      const vfNodes = getVueFlowNodes();
      const enrichedNodes = (Array.isArray(vfNodes) ? vfNodes : []) as {
        id: string;
        position: { x: number; y: number };
        parentNode?: string;
        style?: unknown;
        dimensions?: { width: number; height: number };
        measured?: { width?: number; height?: number };
        type?: string;
        data?: unknown;
      }[];

      const boundsNodes: BoundsNode[] = enrichedNodes.map((n) => {
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
      });

      const posMap = buildPositionMap(boundsNodes, {
        defaultNodeWidth: 260,
        defaultNodeHeight: 100,
      });

      const result = resolveCollisions(
        boundsNodes,
        posMap,
        resolverAnchors.size > 0 ? resolverAnchors : null,
        DEFAULT_COLLISION_CONFIG
      );

      if (result.updatedPositions.size === 0 && result.updatedSizes.size === 0) {
        return;
      }

      const nodeUpdates = new Map<string, DependencyNode>();
      const offsetUpdates = new Map<string, ManualOffset>();

      for (const [id, newPos] of result.updatedPositions) {
        const node = nodeById.get(id);
        if (!node) continue;

        const dx = newPos.x - node.position.x;
        const dy = newPos.y - node.position.y;

        const updatedNode = {
          ...node,
          position: { x: newPos.x, y: newPos.y },
        } as DependencyNode;
        nodeUpdates.set(id, updatedNode);
        offsetUpdates.set(id, { dx, dy });
      }

      for (const [id, newSize] of result.updatedSizes) {
        const existing = nodeUpdates.get(id) ?? nodeById.get(id);
        if (!existing) continue;

        const currentStyle = typeof existing.style === 'object' ? (existing.style as Record<string, unknown>) : {};
        const parseSize = (value: unknown): number | null => {
          if (typeof value === 'number' && Number.isFinite(value)) return value;
          if (typeof value === 'string') {
            const parsed = Number.parseFloat(value);
            return Number.isFinite(parsed) ? parsed : null;
          }
          return null;
        };
        const targetWidth = Math.ceil(newSize.width);
        const targetHeight = Math.ceil(newSize.height);
        const currentWidth = parseSize(currentStyle['width']);
        const currentHeight = parseSize(currentStyle['height']);
        if (
          currentWidth !== null &&
          currentHeight !== null &&
          Math.abs(currentWidth - targetWidth) < 1 &&
          Math.abs(currentHeight - targetHeight) < 1
        ) {
          continue;
        }
        const updatedNode = {
          ...existing,
          style: {
            ...currentStyle,
            width: `${String(targetWidth)}px`,
            height: `${String(targetHeight)}px`,
          },
        } as DependencyNode;
        nodeUpdates.set(id, updatedNode);
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

      lastCollisionSettleTime = performance.now();
    } finally {
      isApplyingCollisionResolution.value = false;
    }
  };

  const scheduleCollisionSettle = (changedNodeIds: Set<string>, isDragging: boolean) => {
    const nodeCount = nodes.value.length;

    if (nodeCount > DRAG_END_ONLY_THRESHOLD && isDragging) {
      return;
    }

    if (nodeCount > LIVE_SETTLE_NODE_THRESHOLD && isDragging) {
      return;
    }

    if (isDragging) {
      const elapsed = performance.now() - lastCollisionSettleTime;
      if (elapsed < LIVE_SETTLE_MIN_INTERVAL_MS) {
        if (collisionSettleRafId !== null) return;
        collisionSettleRafId = requestAnimationFrame(() => {
          collisionSettleRafId = null;
          runCollisionSettle(changedNodeIds);
        });
        return;
      }
    }

    if (collisionSettleRafId !== null) {
      cancelAnimationFrame(collisionSettleRafId);
      collisionSettleRafId = null;
    }

    runCollisionSettle(changedNodeIds);
  };

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
      const isDragging = hasLiveDrag && !hasDragEnd;
      const settleAnchors = dragLifecycleIds.size > 0 ? dragLifecycleIds : dragPositionIds;
      scheduleCollisionSettle(settleAnchors, isDragging);
    } else if (hasDimensionChange && !isLayoutPending.value && !isLayoutMeasuring.value) {
      scheduleDimensionSettle();
    }
  };

  const dispose = (): void => {
    if (collisionSettleRafId !== null) {
      cancelAnimationFrame(collisionSettleRafId);
      collisionSettleRafId = null;
    }
    if (collisionDimensionTimer !== null) {
      clearTimeout(collisionDimensionTimer);
      collisionDimensionTimer = null;
    }
  };

  return {
    isApplyingCollisionResolution,
    activeDraggedNodeIds,
    userPinnedNodeIds,
    handleNodesChange,
    dispose,
  };
}
