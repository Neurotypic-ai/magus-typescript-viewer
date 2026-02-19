import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

// Mock @vue-flow/core before importing the composable
vi.mock('@vue-flow/core', () => ({
  useVueFlow: vi.fn(),
}));

import { useVueFlow } from '@vue-flow/core';
import { useIntraFolderObstacleIndex } from '../useIntraFolderObstacleIndex';

interface MockNode {
  id: string;
  parentNode?: string;
  computedPosition: { x: number; y: number };
  dimensions: { width: number; height: number };
}

function makeNode(
  id: string,
  parentNode: string | undefined,
  position?: { x: number; y: number },
  dimensions?: { width: number; height: number }
): MockNode {
  return {
    id,
    parentNode,
    computedPosition: position ?? { x: 0, y: 0 },
    dimensions: dimensions ?? { width: 0, height: 0 },
  };
}

function setupMock(initialNodes: MockNode[]) {
  const mockNodes = ref(initialNodes);
  (useVueFlow as ReturnType<typeof vi.fn>).mockReturnValue({
    getNodes: mockNodes,
  });
  return mockNodes;
}

describe('useIntraFolderObstacleIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('missing dimensions/computedPosition does not throw', () => {
    // Nodes with missing/undefined geometry
    setupMock([
      makeNode('node-1', 'folder-a', undefined, undefined),
      makeNode('node-2', 'folder-a', { x: 10, y: 20 }, undefined),
      makeNode('node-3', 'folder-a', undefined, { width: 100, height: 50 }),
    ]);

    const index = useIntraFolderObstacleIndex();
    const snapshot = index.getSnapshot('folder-a');

    expect(snapshot).not.toBeNull();
    expect(snapshot!.ready).toBe(false);
    expect(snapshot!.obstacles).toHaveLength(3);
  });

  it('same-folder version stability for unchanged geometry', () => {
    const mockNodes = setupMock([
      makeNode('node-1', 'folder-a', { x: 0, y: 0 }, { width: 100, height: 50 }),
      makeNode('node-2', 'folder-a', { x: 200, y: 0 }, { width: 120, height: 60 }),
    ]);

    const index = useIntraFolderObstacleIndex();

    const snapshot1 = index.getSnapshot('folder-a');
    expect(snapshot1).not.toBeNull();
    const version1 = snapshot1!.version;

    // Trigger reactivity without changing values (reassign same array)
    mockNodes.value = [...mockNodes.value];

    const snapshot2 = index.getSnapshot('folder-a');
    expect(snapshot2).not.toBeNull();
    expect(snapshot2!.version).toBe(version1);
  });

  it('unrelated-folder updates do not invalidate folder version', () => {
    const mockNodes = setupMock([
      makeNode('node-a1', 'folder-a', { x: 0, y: 0 }, { width: 100, height: 50 }),
      makeNode('node-b1', 'folder-b', { x: 0, y: 0 }, { width: 80, height: 40 }),
    ]);

    const index = useIntraFolderObstacleIndex();

    const snapshotA1 = index.getSnapshot('folder-a');
    expect(snapshotA1).not.toBeNull();
    const versionA1 = snapshotA1!.version;

    // Add a new node to folder-b — folder-a should not be affected
    mockNodes.value = [
      ...mockNodes.value,
      makeNode('node-b2', 'folder-b', { x: 200, y: 0 }, { width: 90, height: 45 }),
    ];

    const snapshotA2 = index.getSnapshot('folder-a');
    expect(snapshotA2).not.toBeNull();
    expect(snapshotA2!.version).toBe(versionA1);
  });

  it('readiness transitions (ready=false -> ready=true) after measurement', () => {
    const mockNodes = setupMock([
      makeNode('node-1', 'folder-a', { x: 0, y: 0 }, { width: 0, height: 0 }),
      makeNode('node-2', 'folder-a', { x: 100, y: 0 }, { width: 0, height: 0 }),
    ]);

    const index = useIntraFolderObstacleIndex();

    // Before measurement — dimensions are zero
    const snapshotBefore = index.getSnapshot('folder-a');
    expect(snapshotBefore).not.toBeNull();
    expect(snapshotBefore!.ready).toBe(false);

    // Simulate measurement by updating dimensions
    mockNodes.value = [
      makeNode('node-1', 'folder-a', { x: 0, y: 0 }, { width: 120, height: 60 }),
      makeNode('node-2', 'folder-a', { x: 100, y: 0 }, { width: 150, height: 80 }),
    ];

    const snapshotAfter = index.getSnapshot('folder-a');
    expect(snapshotAfter).not.toBeNull();
    expect(snapshotAfter!.ready).toBe(true);
  });

  it('returns null for unknown folder', () => {
    setupMock([
      makeNode('node-1', 'folder-a', { x: 0, y: 0 }, { width: 100, height: 50 }),
    ]);

    const index = useIntraFolderObstacleIndex();
    const snapshot = index.getSnapshot('nonexistent-folder');

    expect(snapshot).toBeNull();
  });

  it('obstacles array contains correct geometry', () => {
    setupMock([
      makeNode('node-1', 'folder-a', { x: 10, y: 20 }, { width: 100, height: 50 }),
      makeNode('node-2', 'folder-a', { x: 300, y: 150 }, { width: 200, height: 80 }),
    ]);

    const index = useIntraFolderObstacleIndex();
    const snapshot = index.getSnapshot('folder-a');

    expect(snapshot).not.toBeNull();
    expect(snapshot!.obstacles).toHaveLength(2);

    const obstacle1 = snapshot!.obstacles.find((o) => o.nodeId === 'node-1');
    expect(obstacle1).toEqual({
      nodeId: 'node-1',
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });

    const obstacle2 = snapshot!.obstacles.find((o) => o.nodeId === 'node-2');
    expect(obstacle2).toEqual({
      nodeId: 'node-2',
      x: 300,
      y: 150,
      width: 200,
      height: 80,
    });
  });

  it('nodeId is included in obstacles', () => {
    setupMock([
      makeNode('alpha', 'folder-x', { x: 0, y: 0 }, { width: 50, height: 30 }),
      makeNode('beta', 'folder-x', { x: 100, y: 100 }, { width: 60, height: 40 }),
      makeNode('gamma', 'folder-x', { x: 200, y: 200 }, { width: 70, height: 50 }),
    ]);

    const index = useIntraFolderObstacleIndex();
    const snapshot = index.getSnapshot('folder-x');

    expect(snapshot).not.toBeNull();
    expect(snapshot!.obstacles).toHaveLength(3);

    const nodeIds = snapshot!.obstacles.map((o) => o.nodeId);
    expect(nodeIds).toContain('alpha');
    expect(nodeIds).toContain('beta');
    expect(nodeIds).toContain('gamma');
  });
});
