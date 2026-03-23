import { ref } from 'vue';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useGraphLayout } from '../useGraphLayout';

import type { PackageGraph } from '../../../shared/types/Package';
import type { DependencyNode } from '../../types/DependencyNode';
import type { GraphEdge } from '../../types/GraphEdge';

const { buildOverviewGraphMock } = vi.hoisted(() => ({
  buildOverviewGraphMock: vi.fn(),
}));

vi.mock('../../graph/buildGraphView', () => ({
  buildOverviewGraph: buildOverviewGraphMock,
}));

interface MutableStoreState {
  nodes: DependencyNode[];
  edges: GraphEdge[];
  overviewSnapshot: { nodes: DependencyNode[]; edges: GraphEdge[] } | null;
}

const makeNode = (overrides: Partial<DependencyNode> & { id: string }): DependencyNode => {
  const { id, ...rest } = overrides;
  return {
    id,
    type: rest.type ?? 'module',
    position: { x: 0, y: 0 },
    data: { label: id },
    ...rest,
  } as DependencyNode;
};

function createGraphStore(initialNodes: DependencyNode[] = [], initialEdges: GraphEdge[] = []) {
  const state: MutableStoreState = {
    nodes: initialNodes,
    edges: initialEdges,
    overviewSnapshot: null,
  };

  return {
    state,
    api: {
      get nodes() {
        return state.nodes;
      },
      get edges() {
        return state.edges;
      },
      get manualOffsets() {
        return new Map();
      },
      setNodes: vi.fn((nodes: DependencyNode[]) => {
        state.nodes = nodes;
      }),
      setEdges: vi.fn((edges: GraphEdge[]) => {
        state.edges = edges;
      }),
      setOverviewSnapshot: vi.fn((snapshot: { nodes: DependencyNode[]; edges: GraphEdge[] }) => {
        state.overviewSnapshot = snapshot;
      }),
      setSemanticSnapshot: vi.fn(),
      setViewMode: vi.fn(),
      suspendCacheWrites: vi.fn(),
      resumeCacheWrites: vi.fn(),
      applyManualOffsets: vi.fn((nodes: DependencyNode[]) => nodes),
    },
  };
}

const makePackageGraph = (): PackageGraph => ({ packages: [] });

describe('useGraphLayout', () => {
  beforeEach(() => {
    buildOverviewGraphMock.mockReset();
  });

  it('merges tracker dimensions into node state during measurement', () => {
    const { api: graphStore } = createGraphStore();
    const nodeDimensionTracker = {
      refresh: vi.fn(),
      get: vi.fn((nodeId: string) =>
        nodeId === 'measured-node'
          ? {
              width: 180,
              height: 96,
              headerHeight: 20,
              bodyHeight: 60,
              subnodesHeight: 16,
            }
          : undefined
      ),
      pause: vi.fn(),
      resume: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    };
    const nodePremeasure = {
      hasBatch: ref(false),
      batchNodes: ref([]),
      measureBatch: vi.fn(() => Promise.resolve(new Map())),
      clearBatch: vi.fn(),
    };

    const layout = useGraphLayout({
      propsData: ref(makePackageGraph()),
      graphStore,
      graphSettings: {
        activeRelationshipTypes: [],
        collapsedFolderIds: new Set(),
        hideTestFiles: false,
        highlightOrphanGlobal: false,
      },
      interaction: {
        resetInteraction: vi.fn(),
      },
      fitView: vi.fn(() => Promise.resolve(true)),
      updateNodeInternals: vi.fn(),
      syncViewportState: vi.fn(),
      nodeDimensionTracker,
      nodePremeasure,
      resetSearchHighlightState: vi.fn(),
      isFirefox: ref(false),
      graphRootRef: ref(null),
    });

    const measuredNode = makeNode({ id: 'measured-node', style: { borderColor: 'red' } });
    const result = layout.measureAllNodeDimensions([measuredNode]);

    expect(result.hasChanges).toBe(true);
    expect(result.nodes[0]?.style).toMatchObject({
      borderColor: 'red',
      width: '180px',
      height: '96px',
    });
    expect((result.nodes[0] as { measured?: { width?: number; height?: number } }).measured).toEqual({
      width: 180,
      height: 96,
    });
  });

  it('uses the premeasure service before overview layout', async () => {
    const initialLeaf = makeNode({
      id: 'leaf',
      type: 'package',
      style: { backgroundColor: 'rgba(0, 0, 0, 0.1)' },
    });
    buildOverviewGraphMock.mockReturnValue({
      nodes: [initialLeaf],
      edges: [],
      semanticSnapshot: null,
    });

    const { api: graphStore, state } = createGraphStore();
    const nodePremeasure = {
      hasBatch: ref(false),
      batchNodes: ref([]),
      measureBatch: vi.fn(() =>
        Promise.resolve(
          new Map([
            [
              'leaf',
              {
                width: 140,
                height: 90,
                headerHeight: 24,
                bodyHeight: 50,
                subnodesHeight: 16,
              },
            ],
          ])
        )
      ),
      clearBatch: vi.fn(),
    };

    const layout = useGraphLayout({
      propsData: ref(makePackageGraph()),
      graphStore,
      graphSettings: {
        activeRelationshipTypes: [],
        collapsedFolderIds: new Set(),
        hideTestFiles: false,
        highlightOrphanGlobal: false,
      },
      interaction: {
        resetInteraction: vi.fn(),
      },
      fitView: vi.fn(() => Promise.resolve(true)),
      updateNodeInternals: vi.fn(),
      syncViewportState: vi.fn(),
      nodeDimensionTracker: {
        refresh: vi.fn(),
        get: vi.fn(() => undefined),
        pause: vi.fn(),
        resume: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
      },
      nodePremeasure,
      resetSearchHighlightState: vi.fn(),
      isFirefox: ref(false),
      graphRootRef: ref(null),
    });

    await layout.initializeGraph();

    expect(nodePremeasure.measureBatch).toHaveBeenCalledWith([initialLeaf]);
    expect(state.nodes[0]?.style).toMatchObject({
      backgroundColor: 'rgba(0, 0, 0, 0.1)',
      width: '140px',
      height: '90px',
    });
  });
});
