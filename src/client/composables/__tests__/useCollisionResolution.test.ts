import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import type { NodeChange } from '@vue-flow/core';

import {
  DEFAULT_COLLISION_CONFIG,
  buildPositionMap,
  createCollisionConfig,
  getActiveCollisionConfig,
  resolveCollisions,
} from '../../layout/collisionResolver';
import { filterNodeChangesForFolderMode } from '../../graph/buildGraphView';
import type { DependencyNode } from '../../types/DependencyNode';
import { useCollisionResolution } from '../useCollisionResolution';

vi.mock('../../graph/buildGraphView', () => ({
  filterNodeChangesForFolderMode: vi.fn((changes: NodeChange[]) => changes),
}));

vi.mock('../../layout/collisionResolver', () => {
  const DEFAULT_COLLISION_CONFIG = {
    overlapGap: 40,
    maxCycles: 20,
    maxDisplacementPerCycle: 0,
    modulePadding: { horizontal: 20, top: 42, bottom: 20 },
    groupPadding: { horizontal: 40, top: 40, bottom: 40 },
  };

  return {
    DEFAULT_COLLISION_CONFIG,
    createCollisionConfig: vi.fn((minimumDistancePx: number) => {
      const distance = Math.max(0, minimumDistancePx);
      return {
        ...DEFAULT_COLLISION_CONFIG,
        overlapGap: distance * 2,
        groupPadding: {
          horizontal: distance,
          top: distance,
          bottom: distance,
        },
      };
    }),
    getActiveCollisionConfig: vi.fn(() => DEFAULT_COLLISION_CONFIG),
    buildPositionMap: vi.fn(() => new Map()),
    resolveCollisions: vi.fn(() => ({
      updatedPositions: new Map(),
      updatedSizes: new Map(),
      cyclesUsed: 1,
      converged: true,
    })),
  };
});

interface MockCollisionResult {
  updatedPositions: Map<string, { x: number; y: number }>;
  updatedSizes: Map<string, { width: number; height: number }>;
  cyclesUsed: number;
  converged: boolean;
}

function makeCollisionResult(
  positions: Array<[string, { x: number; y: number }]> = [],
  sizes: Array<[string, { width: number; height: number }]> = []
): MockCollisionResult {
  return {
    updatedPositions: new Map(positions),
    updatedSizes: new Map(sizes),
    cyclesUsed: 1,
    converged: true,
  };
}

function makeNode(id: string, x: number, y: number, type = 'module'): DependencyNode {
  return {
    id,
    type,
    data: {} as never,
    position: { x, y },
    style: { width: '120px', height: '80px' },
  } as DependencyNode;
}

function makeGroupNode(id: string, x: number, y: number, width: number, height: number): DependencyNode {
  return {
    id,
    type: 'group',
    data: {} as never,
    position: { x, y },
    style: { width: `${width}px`, height: `${height}px` },
  } as DependencyNode;
}

function makePositionChange(id: string, x: number, y: number, dragging: boolean): NodeChange {
  return {
    id,
    type: 'position',
    position: { x, y },
    dragging,
  } as unknown as NodeChange;
}

function makeDimensionsChange(id: string, width: number, height: number): NodeChange {
  return {
    id,
    type: 'dimensions',
    dimensions: { width, height },
    measured: { width, height },
  } as unknown as NodeChange;
}

function createHarness(initialNodes: DependencyNode[] = [makeNode('a', 0, 0)]) {
  const nodes = ref<DependencyNode[]>([...initialNodes]);
  const isLayoutPending = ref(false);
  const isLayoutMeasuring = ref(false);
  const clusterByFolder = ref(false);

  const setNodes = vi.fn((next: DependencyNode[]) => {
    nodes.value = [...next];
  });
  const updateNodesById = vi.fn((updates: Map<string, DependencyNode>) => {
    const byId = new Map(nodes.value.map((node) => [node.id, node]));
    updates.forEach((node, id) => byId.set(id, node));
    nodes.value = Array.from(byId.values());
  });
  const mergeManualOffsets = vi.fn();
  const reconcileSelectedNodeAfterStructuralChange = vi.fn();
  const getVueFlowNodes = vi.fn(() => nodes.value);

  const collision = useCollisionResolution({
    nodes,
    isLayoutPending,
    isLayoutMeasuring,
    clusterByFolder,
    getVueFlowNodes,
    setNodes,
    updateNodesById,
    mergeManualOffsets,
    reconcileSelectedNodeAfterStructuralChange,
  });

  return {
    collision,
    nodes,
    setNodes,
    updateNodesById,
    mergeManualOffsets,
    getVueFlowNodes,
    isLayoutPending,
  };
}

describe('useCollisionResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();

    vi.mocked(filterNodeChangesForFolderMode).mockImplementation((changes) => changes);

    vi.mocked(buildPositionMap).mockImplementation((boundsNodes) => {
      const map = new Map<string, { x: number; y: number; width: number; height: number }>();
      for (const node of boundsNodes as Array<{ id: string; position?: { x: number; y: number } }>) {
        if (!node.position) continue;
        map.set(node.id, { x: node.position.x, y: node.position.y, width: 120, height: 80 });
      }
      return map as unknown as ReturnType<typeof buildPositionMap>;
    });

    vi.mocked(getActiveCollisionConfig).mockReturnValue(DEFAULT_COLLISION_CONFIG);
    vi.mocked(resolveCollisions).mockReturnValue(makeCollisionResult());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('applies collision results immediately during live drag', () => {
    const { collision, updateNodesById } = createHarness([
      makeNode('a', 0, 0),
      makeNode('b', 220, 0),
    ]);

    const result = makeCollisionResult([
      ['b', { x: 300, y: 0 }],
    ]);
    vi.mocked(resolveCollisions).mockReturnValue(result);

    collision.handleNodesChange([makePositionChange('a', 40, 0, true)]);

    expect(updateNodesById).toHaveBeenCalled();
  });

  it('applies collision results immediately on drag end', () => {
    const { collision, updateNodesById } = createHarness([
      makeNode('a', 0, 0),
      makeNode('b', 220, 0),
    ]);

    vi.mocked(resolveCollisions).mockReturnValue(
      makeCollisionResult([['b', { x: 280, y: 0 }]])
    );

    collision.handleNodesChange([makePositionChange('a', 20, 0, false)]);

    expect(updateNodesById).toHaveBeenCalledTimes(1);
  });

  it('pins a node after drag end', () => {
    const { collision } = createHarness([makeNode('a', 0, 0)]);

    collision.handleNodesChange([makePositionChange('a', 10, 0, false)]);

    expect(collision.userPinnedNodeIds.value.has('a')).toBe(true);
  });

  it('skips live drag collision settling for very large graphs', () => {
    const manyNodes = Array.from({ length: 701 }, (_, index) =>
      makeNode(`n${String(index)}`, index * 2, 0)
    );
    const { collision } = createHarness(manyNodes);

    collision.handleNodesChange([makePositionChange('n0', 5, 0, true)]);

    expect(resolveCollisions).not.toHaveBeenCalled();
  });

  it('debounces dimension-driven settling by sixty milliseconds', () => {
    vi.useFakeTimers();
    const { collision } = createHarness([makeNode('a', 0, 0)]);

    collision.handleNodesChange([makeDimensionsChange('a', 180, 120)]);
    collision.handleNodesChange([makeDimensionsChange('a', 200, 140)]);

    expect(resolveCollisions).not.toHaveBeenCalled();

    vi.advanceTimersByTime(59);
    expect(resolveCollisions).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(resolveCollisions).toHaveBeenCalledTimes(1);
  });

  it('uses default collision config when no config inputs are provided', () => {
    const { collision } = createHarness([makeNode('a', 0, 0)]);

    collision.handleNodesChange([makePositionChange('a', 5, 0, false)]);

    const configArg = vi.mocked(resolveCollisions).mock.calls[0]?.[3];
    expect(configArg).toEqual(DEFAULT_COLLISION_CONFIG);
    expect(getActiveCollisionConfig).not.toHaveBeenCalled();
    expect(createCollisionConfig).not.toHaveBeenCalled();
  });

  it('disposes and cancels pending dimension timers', () => {
    vi.useFakeTimers();
    const { collision } = createHarness([makeNode('a', 0, 0)]);

    collision.handleNodesChange([makeDimensionsChange('a', 150, 100)]);
    expect(resolveCollisions).not.toHaveBeenCalled();

    collision.dispose();

    vi.advanceTimersByTime(200);
    expect(resolveCollisions).not.toHaveBeenCalled();
  });

  it('triggers settle when layout completes', async () => {
    vi.useFakeTimers();
    const { isLayoutPending } = createHarness([makeNode('a', 0, 0)]);

    // Must await between state changes so Vue's watch callback fires for each
    isLayoutPending.value = true;
    await vi.advanceTimersByTimeAsync(0);
    isLayoutPending.value = false;
    await vi.advanceTimersByTimeAsync(0);

    // Should schedule a dimension settle (60ms debounce)
    await vi.advanceTimersByTimeAsync(60);
    expect(resolveCollisions).toHaveBeenCalled();
  });

  describe('folder contraction delay', () => {
    it('applies folder expansion immediately', () => {
      const { collision, updateNodesById } = createHarness([
        makeGroupNode('folder', 0, 0, 300, 200),
        makeNode('a', 50, 50),
      ]);

      // Resolver says folder should grow
      vi.mocked(resolveCollisions).mockReturnValue(
        makeCollisionResult(
          [],
          [['folder', { width: 400, height: 300 }]]
        )
      );

      collision.handleNodesChange([makePositionChange('a', 60, 60, false)]);

      // Expansion should be applied immediately (updateNodesById called for sizes)
      expect(updateNodesById).toHaveBeenCalled();
      const calls = updateNodesById.mock.calls;
      const lastCall = calls[calls.length - 1]?.[0] as Map<string, DependencyNode> | undefined;
      const folderUpdate = lastCall?.get('folder');
      const style = folderUpdate?.style as Record<string, string> | undefined;
      expect(style?.width).toBe('400px');
      expect(style?.height).toBe('300px');
    });

    it('delays folder contraction by FOLDER_CONTRACTION_DELAY_MS', () => {
      vi.useFakeTimers();
      const { collision, updateNodesById } = createHarness([
        makeGroupNode('folder', 0, 0, 400, 300),
        makeNode('a', 50, 50),
      ]);

      // Resolver says folder should shrink
      vi.mocked(resolveCollisions).mockReturnValue(
        makeCollisionResult(
          [],
          [['folder', { width: 200, height: 150 }]]
        )
      );

      collision.handleNodesChange([makePositionChange('a', 40, 40, false)]);

      // Size update should NOT have been applied yet (contraction delayed)
      const immediateCalls = updateNodesById.mock.calls;
      const anyFolderSizeUpdate = immediateCalls.some((call) => {
        const updates = call[0] as Map<string, DependencyNode>;
        const folder = updates.get('folder');
        const style = folder?.style as Record<string, string> | undefined;
        return style?.width === '200px';
      });
      expect(anyFolderSizeUpdate).toBe(false);

      // After delay, contraction should be applied
      vi.advanceTimersByTime(400);
      const delayedCalls = updateNodesById.mock.calls;
      const folderContracted = delayedCalls.some((call) => {
        const updates = call[0] as Map<string, DependencyNode>;
        const folder = updates.get('folder');
        const style = folder?.style as Record<string, string> | undefined;
        return style?.width === '200px';
      });
      expect(folderContracted).toBe(true);
    });

    it('cancels pending contraction when expansion occurs', () => {
      vi.useFakeTimers();
      const { collision, updateNodesById, nodes } = createHarness([
        makeGroupNode('folder', 0, 0, 400, 300),
        makeNode('a', 50, 50),
      ]);

      // First: trigger contraction
      vi.mocked(resolveCollisions).mockReturnValue(
        makeCollisionResult([], [['folder', { width: 200, height: 150 }]])
      );
      collision.handleNodesChange([makePositionChange('a', 40, 40, false)]);

      // Advance partway through the delay
      vi.advanceTimersByTime(200);

      // Now trigger expansion — should cancel the pending contraction
      vi.mocked(resolveCollisions).mockReturnValue(
        makeCollisionResult([], [['folder', { width: 500, height: 400 }]])
      );

      // Re-read nodes to get current state for expansion check
      nodes.value = [makeGroupNode('folder', 0, 0, 400, 300), makeNode('a', 50, 50)];
      collision.handleNodesChange([makePositionChange('a', 60, 60, false)]);

      // The expansion should be applied immediately
      const expansionApplied = updateNodesById.mock.calls.some((call) => {
        const updates = call[0] as Map<string, DependencyNode>;
        const folder = updates.get('folder');
        const style = folder?.style as Record<string, string> | undefined;
        return style?.width === '500px';
      });
      expect(expansionApplied).toBe(true);

      // After the original delay expires, contraction should NOT fire
      vi.advanceTimersByTime(200);
      const contractionFired = updateNodesById.mock.calls.some((call) => {
        const updates = call[0] as Map<string, DependencyNode>;
        const folder = updates.get('folder');
        const style = folder?.style as Record<string, string> | undefined;
        return style?.width === '200px';
      });
      expect(contractionFired).toBe(false);
    });

    it('cleans up contraction timers on dispose', () => {
      vi.useFakeTimers();
      const { collision, updateNodesById } = createHarness([
        makeGroupNode('folder', 0, 0, 400, 300),
        makeNode('a', 50, 50),
      ]);

      // Trigger contraction
      vi.mocked(resolveCollisions).mockReturnValue(
        makeCollisionResult([], [['folder', { width: 200, height: 150 }]])
      );
      collision.handleNodesChange([makePositionChange('a', 40, 40, false)]);

      // Dispose before contraction fires
      collision.dispose();

      // Advance past delay — contraction should NOT fire
      vi.advanceTimersByTime(500);
      const contractionFired = updateNodesById.mock.calls.some((call) => {
        const updates = call[0] as Map<string, DependencyNode>;
        const folder = updates.get('folder');
        const style = folder?.style as Record<string, string> | undefined;
        return style?.width === '200px';
      });
      expect(contractionFired).toBe(false);
    });
  });
});
