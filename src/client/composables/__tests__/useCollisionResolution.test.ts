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
import { useSpringAnimation } from '../useSpringAnimation';

vi.mock('../useSpringAnimation', () => ({
  useSpringAnimation: vi.fn(),
}));

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
        overlapGap: distance,
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

type SpringFrameCallback = (
  positions: Map<string, { x: number; y: number }>,
  sizes: Map<string, { width: number; height: number }>
) => void;

let capturedOnFrame: SpringFrameCallback | null = null;
let capturedOnSettle: (() => void) | null = null;

const springMock = {
  setTargets: vi.fn(),
  removeNode: vi.fn(),
  clear: vi.fn(),
  isAnimating: ref(false),
  settlingCount: ref(0),
  getCurrentPositions: vi.fn(() => new Map<string, { x: number; y: number }>()),
  getCurrentSizes: vi.fn(() => new Map<string, { width: number; height: number }>()),
  dispose: vi.fn(),
};

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

function invokeSpringFrame(
  positions = new Map<string, { x: number; y: number }>(),
  sizes = new Map<string, { width: number; height: number }>()
): void {
  if (!capturedOnFrame) {
    throw new Error('Expected spring onFrame callback to be captured.');
  }
  capturedOnFrame(positions, sizes);
}

function invokeSpringSettle(): void {
  if (!capturedOnSettle) {
    throw new Error('Expected spring onSettle callback to be captured.');
  }
  capturedOnSettle();
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
    for (const [id, node] of updates) byId.set(id, node);
    nodes.value = [...byId.values()];
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
  };
}

describe('useCollisionResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();

    capturedOnFrame = null;
    capturedOnSettle = null;
    springMock.getCurrentPositions.mockReturnValue(new Map());
    springMock.getCurrentSizes.mockReturnValue(new Map());

    vi.mocked(useSpringAnimation).mockImplementation((options) => {
      capturedOnFrame = options.onFrame;
      capturedOnSettle = options.onSettle;
      return springMock;
    });

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

  it('feeds resolver results to spring targets during live drag', () => {
    const { collision, updateNodesById } = createHarness([
      makeNode('a', 0, 0),
      makeNode('b', 220, 0),
    ]);

    const result = makeCollisionResult([
      ['b', { x: 300, y: 0 }],
    ]);
    vi.mocked(resolveCollisions).mockReturnValue(result);

    collision.handleNodesChange([makePositionChange('a', 40, 0, true)]);

    expect(springMock.setTargets).toHaveBeenCalled();
    const lastCall = springMock.setTargets.mock.calls.at(-1);
    expect(lastCall?.[0]).toStrictEqual(result.updatedPositions);
    expect(lastCall?.[1]).toStrictEqual(result.updatedSizes);
    expect(updateNodesById).not.toHaveBeenCalled();
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

    expect(springMock.setTargets).not.toHaveBeenCalled();
    expect(updateNodesById).toHaveBeenCalledTimes(1);
  });

  it('removes a node from spring animation when dragging starts', () => {
    const { collision } = createHarness([makeNode('a', 0, 0)]);

    collision.handleNodesChange([makePositionChange('a', 15, 0, true)]);

    expect(springMock.removeNode).toHaveBeenCalledWith('a');
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
    expect(springMock.setTargets).not.toHaveBeenCalled();
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

  it('bypasses spring animation when reduced motion is enabled', () => {
    vi.stubGlobal('window', {
      matchMedia: vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
      })),
    });

    const { collision, updateNodesById } = createHarness([
      makeNode('a', 0, 0),
      makeNode('b', 220, 0),
    ]);
    vi.mocked(resolveCollisions).mockReturnValue(
      makeCollisionResult([['b', { x: 300, y: 0 }]])
    );

    collision.handleNodesChange([makePositionChange('a', 30, 0, true)]);

    expect(springMock.setTargets).not.toHaveBeenCalled();
    expect(updateNodesById).toHaveBeenCalledTimes(1);
  });

  it('re-runs collision resolution every fourth spring frame', () => {
    createHarness([makeNode('a', 0, 0)]);
    vi.mocked(resolveCollisions).mockReturnValue(
      makeCollisionResult([['a', { x: 10, y: 10 }]])
    );

    for (let i = 0; i < 8; i++) {
      invokeSpringFrame(new Map([['a', { x: i, y: 0 }]]), new Map());
    }

    expect(resolveCollisions).toHaveBeenCalledTimes(2);
    expect(springMock.setTargets).toHaveBeenCalledTimes(2);
  });

  it('runs a final immediate settle after spring animation settles', () => {
    const { updateNodesById } = createHarness([makeNode('a', 0, 0)]);
    vi.mocked(resolveCollisions).mockReturnValue(
      makeCollisionResult([['a', { x: 40, y: 0 }]])
    );

    invokeSpringSettle();

    expect(resolveCollisions).toHaveBeenCalledTimes(1);
    expect(springMock.setTargets).not.toHaveBeenCalled();
    expect(updateNodesById).toHaveBeenCalledTimes(1);
  });

  it('uses default collision config when no config inputs are provided', () => {
    const { collision } = createHarness([makeNode('a', 0, 0)]);

    collision.handleNodesChange([makePositionChange('a', 5, 0, false)]);

    const configArg = vi.mocked(resolveCollisions).mock.calls[0]?.[3];
    expect(configArg).toEqual(DEFAULT_COLLISION_CONFIG);
    expect(getActiveCollisionConfig).not.toHaveBeenCalled();
    expect(createCollisionConfig).not.toHaveBeenCalled();
  });

  it('disposes spring animation and cancels pending dimension timers', () => {
    vi.useFakeTimers();
    const { collision } = createHarness([makeNode('a', 0, 0)]);

    collision.handleNodesChange([makeDimensionsChange('a', 150, 100)]);
    expect(resolveCollisions).not.toHaveBeenCalled();

    collision.dispose();
    expect(springMock.dispose).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    expect(resolveCollisions).not.toHaveBeenCalled();
  });
});
