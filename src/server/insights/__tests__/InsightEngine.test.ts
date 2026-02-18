import { vi } from 'vitest';

import { InsightEngine } from '../InsightEngine';

import type { IDatabaseAdapter, QueryParams, QueryResult, DatabaseRow } from '../../db/adapter/IDatabaseAdapter';
import type { ImportGraph } from '../import-graph';

// ── Mock buildImportGraph ────────────────────────────────────────────────────

vi.mock('../import-graph', () => ({
  buildImportGraph: vi.fn(),
}));

// We need to import the mocked function so we can control its return value
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const { buildImportGraph } = await import('../import-graph') as { buildImportGraph: ReturnType<typeof vi.fn> };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Create a minimal empty import graph */
function emptyGraph(): ImportGraph {
  return {
    adjacency: new Map(),
    reverseAdjacency: new Map(),
    modules: new Map(),
    nodeIds: new Set(),
  };
}

/** Create a mock IDatabaseAdapter that returns configurable rows per query */
function createMockAdapter(queryResponses?: Map<string, DatabaseRow[]>): IDatabaseAdapter {
  return {
    init: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getDbPath: vi.fn<() => string>().mockReturnValue(':memory:'),
    transaction: vi.fn<(cb: () => Promise<unknown>) => Promise<unknown>>().mockImplementation(
      async (cb: () => Promise<unknown>) => cb(),
    ),
    query: vi.fn<(sql: string, params?: QueryParams) => Promise<QueryResult>>().mockImplementation(
      async (sql: string) => {
        if (queryResponses) {
          for (const [pattern, rows] of queryResponses) {
            if (sql.includes(pattern)) return rows;
          }
        }
        return [];
      },
    ),
  };
}

/** Build an import graph with a simple cycle: A -> B -> A */
function graphWithCycle(): ImportGraph {
  const adjacency = new Map<string, Set<string>>();
  adjacency.set('mod-a', new Set(['mod-b']));
  adjacency.set('mod-b', new Set(['mod-a']));

  const reverseAdjacency = new Map<string, Set<string>>();
  reverseAdjacency.set('mod-a', new Set(['mod-b']));
  reverseAdjacency.set('mod-b', new Set(['mod-a']));

  return {
    adjacency,
    reverseAdjacency,
    modules: new Map([
      ['mod-a', { name: 'moduleA.ts', directory: '/src', relativePath: 'src/moduleA.ts', isBarrel: false, lineCount: 50, packageId: 'pkg-1' }],
      ['mod-b', { name: 'moduleB.ts', directory: '/src', relativePath: 'src/moduleB.ts', isBarrel: false, lineCount: 30, packageId: 'pkg-1' }],
    ]),
    nodeIds: new Set(['mod-a', 'mod-b']),
  };
}

/** Build a graph with high fan-in: many modules importing one module */
function graphWithHighFanIn(importerCount: number): ImportGraph {
  const targetId = 'mod-target';
  const adjacency = new Map<string, Set<string>>();
  const reverseAdjacency = new Map<string, Set<string>>();
  const modules = new Map<string, ImportGraph['modules'] extends Map<string, infer V> ? V : never>();
  const nodeIds = new Set<string>();

  // Target module
  adjacency.set(targetId, new Set());
  reverseAdjacency.set(targetId, new Set());
  modules.set(targetId, { name: 'target.ts', directory: '/src', relativePath: 'src/target.ts', isBarrel: false, lineCount: 100, packageId: 'pkg-1' });
  nodeIds.add(targetId);

  for (let i = 0; i < importerCount; i++) {
    const id = `mod-importer-${i}`;
    adjacency.set(id, new Set([targetId]));
    reverseAdjacency.get(targetId)!.add(id);
    reverseAdjacency.set(id, new Set());
    modules.set(id, { name: `importer${i}.ts`, directory: '/src', relativePath: `src/importer${i}.ts`, isBarrel: false, lineCount: 20, packageId: 'pkg-1' });
    nodeIds.add(id);
  }

  return { adjacency, reverseAdjacency, modules, nodeIds };
}

/** Build a graph with high fan-out: one module importing many modules */
function graphWithHighFanOut(depCount: number): ImportGraph {
  const sourceId = 'mod-source';
  const adjacency = new Map<string, Set<string>>();
  const reverseAdjacency = new Map<string, Set<string>>();
  const modules = new Map<string, ImportGraph['modules'] extends Map<string, infer V> ? V : never>();
  const nodeIds = new Set<string>();

  adjacency.set(sourceId, new Set());
  reverseAdjacency.set(sourceId, new Set());
  modules.set(sourceId, { name: 'source.ts', directory: '/src', relativePath: 'src/source.ts', isBarrel: false, lineCount: 200, packageId: 'pkg-1' });
  nodeIds.add(sourceId);

  for (let i = 0; i < depCount; i++) {
    const id = `mod-dep-${i}`;
    adjacency.get(sourceId)!.add(id);
    adjacency.set(id, new Set());
    reverseAdjacency.set(id, new Set([sourceId]));
    modules.set(id, { name: `dep${i}.ts`, directory: '/src', relativePath: `src/dep${i}.ts`, isBarrel: false, lineCount: 30, packageId: 'pkg-1' });
    nodeIds.add(id);
  }

  return { adjacency, reverseAdjacency, modules, nodeIds };
}

/** Build a graph with an orphaned module (no connections) */
function graphWithOrphanedModule(): ImportGraph {
  const adjacency = new Map<string, Set<string>>();
  adjacency.set('mod-connected-a', new Set(['mod-connected-b']));
  adjacency.set('mod-connected-b', new Set());
  adjacency.set('mod-orphan', new Set());

  const reverseAdjacency = new Map<string, Set<string>>();
  reverseAdjacency.set('mod-connected-a', new Set());
  reverseAdjacency.set('mod-connected-b', new Set(['mod-connected-a']));
  reverseAdjacency.set('mod-orphan', new Set());

  return {
    adjacency,
    reverseAdjacency,
    modules: new Map([
      ['mod-connected-a', { name: 'a.ts', directory: '/src', relativePath: 'src/a.ts', isBarrel: false, lineCount: 50, packageId: 'pkg-1' }],
      ['mod-connected-b', { name: 'b.ts', directory: '/src', relativePath: 'src/b.ts', isBarrel: false, lineCount: 50, packageId: 'pkg-1' }],
      ['mod-orphan', { name: 'orphan.ts', directory: '/src', relativePath: 'src/orphan.ts', isBarrel: false, lineCount: 50, packageId: 'pkg-1' }],
    ]),
    nodeIds: new Set(['mod-connected-a', 'mod-connected-b', 'mod-orphan']),
  };
}

/** Build a graph with barrel files that re-export through other barrels */
function graphWithNestedBarrels(): ImportGraph {
  const adjacency = new Map<string, Set<string>>();
  adjacency.set('mod-barrel-outer', new Set(['mod-barrel-inner']));
  adjacency.set('mod-barrel-inner', new Set(['mod-leaf']));
  adjacency.set('mod-leaf', new Set());

  const reverseAdjacency = new Map<string, Set<string>>();
  reverseAdjacency.set('mod-barrel-outer', new Set());
  reverseAdjacency.set('mod-barrel-inner', new Set(['mod-barrel-outer']));
  reverseAdjacency.set('mod-leaf', new Set(['mod-barrel-inner']));

  return {
    adjacency,
    reverseAdjacency,
    modules: new Map([
      ['mod-barrel-outer', { name: 'index.ts', directory: '/src', relativePath: 'src/index.ts', isBarrel: true, lineCount: 5, packageId: 'pkg-1' }],
      ['mod-barrel-inner', { name: 'index.ts', directory: '/src/utils', relativePath: 'src/utils/index.ts', isBarrel: true, lineCount: 5, packageId: 'pkg-1' }],
      ['mod-leaf', { name: 'helper.ts', directory: '/src/utils', relativePath: 'src/utils/helper.ts', isBarrel: false, lineCount: 100, packageId: 'pkg-1' }],
    ]),
    nodeIds: new Set(['mod-barrel-outer', 'mod-barrel-inner', 'mod-leaf']),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('InsightEngine', () => {
  let adapter: IDatabaseAdapter;
  let engine: InsightEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = createMockAdapter();
    engine = new InsightEngine(adapter);
    buildImportGraph.mockResolvedValue(emptyGraph());
  });

  // ── compute() orchestration ──────────────────────────────────────────────

  describe('compute()', () => {
    it('returns a valid InsightReport with empty data', async () => {
      const report = await engine.compute();

      expect(report).toHaveProperty('computedAt');
      expect(report).toHaveProperty('healthScore');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('insights');
      expect(report.summary).toEqual({ critical: 0, warning: 0, info: 0 });
      expect(report.healthScore).toBe(100);
      expect(report.insights).toEqual([]);
    });

    it('includes packageId in the report when provided', async () => {
      const report = await engine.compute('pkg-123');

      expect(report.packageId).toBe('pkg-123');
    });

    it('produces a valid ISO date string in computedAt', async () => {
      const report = await engine.compute();

      const parsed = new Date(report.computedAt);
      expect(parsed.getTime()).not.toBeNaN();
    });

    it('calculates health score: 100 with no issues', async () => {
      const report = await engine.compute();

      expect(report.healthScore).toBe(100);
    });

    it('calculates health score: deducts 5 per critical', async () => {
      // Set up a cycle to produce a critical insight
      buildImportGraph.mockResolvedValue(graphWithCycle());

      const report = await engine.compute();
      const criticalCount = report.summary.critical;

      expect(criticalCount).toBeGreaterThan(0);
      // Health score should be reduced by critical * 5 + warning * 2
      expect(report.healthScore).toBe(
        Math.max(0, 100 - criticalCount * 5 - report.summary.warning * 2),
      );
    });

    it('clamps health score to minimum 0', async () => {
      // Create a graph with many cycles to drive health score very low
      const adjacency = new Map<string, Set<string>>();
      const reverseAdjacency = new Map<string, Set<string>>();
      const modules = new Map<string, ImportGraph['modules'] extends Map<string, infer V> ? V : never>();
      const nodeIds = new Set<string>();

      // Create 30 pairs of mutually importing modules -> 30 critical cycles
      for (let i = 0; i < 30; i++) {
        const a = `mod-a-${i}`;
        const b = `mod-b-${i}`;
        adjacency.set(a, new Set([b]));
        adjacency.set(b, new Set([a]));
        reverseAdjacency.set(a, new Set([b]));
        reverseAdjacency.set(b, new Set([a]));
        modules.set(a, { name: `a${i}.ts`, directory: '/src', relativePath: `src/a${i}.ts`, isBarrel: false, lineCount: 10, packageId: 'pkg-1' });
        modules.set(b, { name: `b${i}.ts`, directory: '/src', relativePath: `src/b${i}.ts`, isBarrel: false, lineCount: 10, packageId: 'pkg-1' });
        nodeIds.add(a);
        nodeIds.add(b);
      }

      buildImportGraph.mockResolvedValue({ adjacency, reverseAdjacency, modules, nodeIds });

      const report = await engine.compute();
      expect(report.healthScore).toBe(0);
    });

    it('continues computing other insights when one fails', async () => {
      // Make the adapter throw on certain queries but succeed on others
      const failAdapter: IDatabaseAdapter = {
        ...createMockAdapter(),
        query: vi.fn<(sql: string, params?: QueryParams) => Promise<QueryResult>>().mockImplementation(
          async (sql: string) => {
            if (sql.includes('classes')) throw new Error('DB error for classes');
            return [];
          },
        ),
      };

      const failEngine = new InsightEngine(failAdapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      // Should not throw - failed insights are logged, not propagated
      const report = await failEngine.compute();
      expect(report).toHaveProperty('insights');
    });
  });

  // ── Circular Imports (graph-based) ───────────────────────────────────────

  describe('circular imports', () => {
    it('returns no insights when graph has no cycles', async () => {
      const report = await engine.compute();

      const circular = report.insights.filter((i) => i.type === 'circular-imports');
      expect(circular).toHaveLength(0);
    });

    it('detects a 2-module cycle', async () => {
      buildImportGraph.mockResolvedValue(graphWithCycle());

      const report = await engine.compute();
      const circular = report.insights.filter((i) => i.type === 'circular-imports');

      expect(circular).toHaveLength(1);
      expect(circular[0]!.severity).toBe('critical');
      expect(circular[0]!.category).toBe('dependency-health');
      expect(circular[0]!.entities).toHaveLength(2);
      expect(circular[0]!.value).toBe(2);
    });
  });

  // ── Import Fan-in (graph-based) ──────────────────────────────────────────

  describe('import fan-in', () => {
    it('returns no insight when fan-in is below threshold', async () => {
      buildImportGraph.mockResolvedValue(graphWithHighFanIn(5));

      const report = await engine.compute();
      const fanIn = report.insights.filter((i) => i.type === 'import-fan-in');
      expect(fanIn).toHaveLength(0);
    });

    it('detects modules with fan-in >= 10', async () => {
      buildImportGraph.mockResolvedValue(graphWithHighFanIn(12));

      const report = await engine.compute();
      const fanIn = report.insights.filter((i) => i.type === 'import-fan-in');

      expect(fanIn).toHaveLength(1);
      expect(fanIn[0]!.severity).toBe('warning');
      expect(fanIn[0]!.entities).toHaveLength(1);
      expect(fanIn[0]!.entities[0]!.name).toBe('target.ts');
      expect(fanIn[0]!.value).toBe(12);
      expect(fanIn[0]!.threshold).toBe(10);
    });
  });

  // ── Import Fan-out (graph-based) ─────────────────────────────────────────

  describe('import fan-out', () => {
    it('returns no insight when fan-out is below threshold', async () => {
      buildImportGraph.mockResolvedValue(graphWithHighFanOut(5));

      const report = await engine.compute();
      const fanOut = report.insights.filter((i) => i.type === 'import-fan-out');
      expect(fanOut).toHaveLength(0);
    });

    it('detects modules with fan-out >= 10', async () => {
      buildImportGraph.mockResolvedValue(graphWithHighFanOut(11));

      const report = await engine.compute();
      const fanOut = report.insights.filter((i) => i.type === 'import-fan-out');

      expect(fanOut).toHaveLength(1);
      expect(fanOut[0]!.severity).toBe('warning');
      expect(fanOut[0]!.entities).toHaveLength(1);
      expect(fanOut[0]!.entities[0]!.name).toBe('source.ts');
      expect(fanOut[0]!.value).toBe(11);
      expect(fanOut[0]!.threshold).toBe(10);
    });
  });

  // ── Orphaned Modules (graph-based) ───────────────────────────────────────

  describe('orphaned modules', () => {
    it('returns no insight when all modules are connected', async () => {
      buildImportGraph.mockResolvedValue(graphWithCycle());

      const report = await engine.compute();
      const orphans = report.insights.filter((i) => i.type === 'orphaned-modules');
      expect(orphans).toHaveLength(0);
    });

    it('detects orphaned modules with zero connections', async () => {
      buildImportGraph.mockResolvedValue(graphWithOrphanedModule());

      const report = await engine.compute();
      const orphans = report.insights.filter((i) => i.type === 'orphaned-modules');

      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.severity).toBe('warning');
      expect(orphans[0]!.entities).toHaveLength(1);
      expect(orphans[0]!.entities[0]!.name).toBe('orphan.ts');
    });
  });

  // ── Hub Modules (graph-based) ────────────────────────────────────────────

  describe('hub modules', () => {
    it('returns no insight when no module exceeds hub threshold', async () => {
      buildImportGraph.mockResolvedValue(graphWithHighFanIn(5));

      const report = await engine.compute();
      const hubs = report.insights.filter((i) => i.type === 'hub-modules');
      expect(hubs).toHaveLength(0);
    });

    it('detects hub modules with combined degree >= 15', async () => {
      // Fan-in of 15 means inDeg=15, outDeg=0, total=15 >= HUB_DEGREE(15)
      buildImportGraph.mockResolvedValue(graphWithHighFanIn(15));

      const report = await engine.compute();
      const hubs = report.insights.filter((i) => i.type === 'hub-modules');

      expect(hubs).toHaveLength(1);
      expect(hubs[0]!.severity).toBe('info');
      expect(hubs[0]!.entities.some((e) => e.name === 'target.ts')).toBe(true);
    });
  });

  // ── Bridge Modules (graph-based) ─────────────────────────────────────────

  describe('bridge modules', () => {
    it('returns no insight when there are no articulation points', async () => {
      buildImportGraph.mockResolvedValue(graphWithCycle());

      const report = await engine.compute();
      const bridges = report.insights.filter((i) => i.type === 'bridge-modules');
      expect(bridges).toHaveLength(0);
    });

    it('detects articulation points in a linear chain', async () => {
      // Linear chain: A -> B -> C, B is an articulation point
      const adjacency = new Map<string, Set<string>>();
      adjacency.set('mod-a', new Set(['mod-b']));
      adjacency.set('mod-b', new Set(['mod-c']));
      adjacency.set('mod-c', new Set());

      const reverseAdjacency = new Map<string, Set<string>>();
      reverseAdjacency.set('mod-a', new Set());
      reverseAdjacency.set('mod-b', new Set(['mod-a']));
      reverseAdjacency.set('mod-c', new Set(['mod-b']));

      const graph: ImportGraph = {
        adjacency,
        reverseAdjacency,
        modules: new Map([
          ['mod-a', { name: 'a.ts', directory: '/src', relativePath: 'src/a.ts', isBarrel: false, lineCount: 50, packageId: 'pkg-1' }],
          ['mod-b', { name: 'b.ts', directory: '/src', relativePath: 'src/b.ts', isBarrel: false, lineCount: 50, packageId: 'pkg-1' }],
          ['mod-c', { name: 'c.ts', directory: '/src', relativePath: 'src/c.ts', isBarrel: false, lineCount: 50, packageId: 'pkg-1' }],
        ]),
        nodeIds: new Set(['mod-a', 'mod-b', 'mod-c']),
      };

      buildImportGraph.mockResolvedValue(graph);

      const report = await engine.compute();
      const bridges = report.insights.filter((i) => i.type === 'bridge-modules');

      expect(bridges).toHaveLength(1);
      expect(bridges[0]!.severity).toBe('warning');
      expect(bridges[0]!.entities.some((e) => e.name === 'b.ts')).toBe(true);
    });
  });

  // ── Barrel File Depth (graph-based) ──────────────────────────────────────

  describe('barrel file depth', () => {
    it('returns no insight when there are no nested barrels', async () => {
      const report = await engine.compute();

      const barrels = report.insights.filter((i) => i.type === 'barrel-file-depth');
      expect(barrels).toHaveLength(0);
    });

    it('detects barrel files re-exporting through other barrel files', async () => {
      buildImportGraph.mockResolvedValue(graphWithNestedBarrels());

      const report = await engine.compute();
      const barrels = report.insights.filter((i) => i.type === 'barrel-file-depth');

      expect(barrels).toHaveLength(1);
      expect(barrels[0]!.severity).toBe('info');
      expect(barrels[0]!.entities).toHaveLength(1);
      // Only the outer barrel should be flagged (it imports the inner barrel)
      expect(barrels[0]!.entities[0]!.id).toBe('mod-barrel-outer');
    });
  });

  // ── Cluster Detection (graph-based) ──────────────────────────────────────

  describe('cluster detection', () => {
    it('returns no insight when graph has fewer than 3 nodes', async () => {
      buildImportGraph.mockResolvedValue(graphWithCycle());

      const report = await engine.compute();
      const clusters = report.insights.filter((i) => i.type === 'cluster-detection');
      expect(clusters).toHaveLength(0);
    });

    it('detects clusters in a graph with connected groups', async () => {
      // Create two disconnected groups: (A<->B<->C) and (D<->E<->F)
      const adjacency = new Map<string, Set<string>>();
      adjacency.set('a', new Set(['b']));
      adjacency.set('b', new Set(['a', 'c']));
      adjacency.set('c', new Set(['b']));
      adjacency.set('d', new Set(['e']));
      adjacency.set('e', new Set(['d', 'f']));
      adjacency.set('f', new Set(['e']));

      const reverseAdjacency = new Map<string, Set<string>>();
      reverseAdjacency.set('a', new Set(['b']));
      reverseAdjacency.set('b', new Set(['a', 'c']));
      reverseAdjacency.set('c', new Set(['b']));
      reverseAdjacency.set('d', new Set(['e']));
      reverseAdjacency.set('e', new Set(['d', 'f']));
      reverseAdjacency.set('f', new Set(['e']));

      const modules = new Map<string, ImportGraph['modules'] extends Map<string, infer V> ? V : never>();
      for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
        modules.set(id, { name: `${id}.ts`, directory: '/src', relativePath: `src/${id}.ts`, isBarrel: false, lineCount: 30, packageId: 'pkg-1' });
      }

      const graph: ImportGraph = {
        adjacency,
        reverseAdjacency,
        modules,
        nodeIds: new Set(['a', 'b', 'c', 'd', 'e', 'f']),
      };

      buildImportGraph.mockResolvedValue(graph);

      const report = await engine.compute();
      const clusters = report.insights.filter((i) => i.type === 'cluster-detection');

      // Should detect at least 2 clusters (the two disconnected groups)
      expect(clusters.length).toBeGreaterThanOrEqual(2);
      for (const cluster of clusters) {
        expect(cluster.severity).toBe('info');
        expect(cluster.category).toBe('connectivity');
        expect(cluster.entities.length).toBeGreaterThan(1);
      }
    });
  });

  // ── God Classes (DB-based) ───────────────────────────────────────────────

  describe('god classes', () => {
    it('returns no insight when no classes exceed threshold', async () => {
      const report = await engine.compute();

      const gods = report.insights.filter((i) => i.type === 'god-class');
      expect(gods).toHaveLength(0);
    });

    it('detects god class at warning level (15+ members)', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM classes', [
        { id: 'class-1', name: 'BigClass', module_id: 'mod-1', method_count: 10, property_count: 6 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const gods = report.insights.filter((i) => i.type === 'god-class');

      expect(gods).toHaveLength(1);
      expect(gods[0]!.severity).toBe('warning');
      expect(gods[0]!.entities[0]!.name).toBe('BigClass');
      expect(gods[0]!.value).toBe(16);
      expect(gods[0]!.threshold).toBe(15);
    });

    it('detects god class at critical level (20+ members)', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM classes', [
        { id: 'class-1', name: 'HugeClass', module_id: 'mod-1', method_count: 15, property_count: 8 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const gods = report.insights.filter((i) => i.type === 'god-class');

      expect(gods).toHaveLength(1);
      expect(gods[0]!.severity).toBe('critical');
      expect(gods[0]!.value).toBe(23);
    });

    it('handles string-typed numeric fields from database', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM classes', [
        { id: 'class-1', name: 'StringCountClass', module_id: 'mod-1', method_count: '12', property_count: '5' },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const gods = report.insights.filter((i) => i.type === 'god-class');

      expect(gods).toHaveLength(1);
      expect(gods[0]!.value).toBe(17);
    });
  });

  // ── Long Parameter Lists (DB-based) ──────────────────────────────────────

  describe('long parameter lists', () => {
    it('returns no insight when no methods have too many params', async () => {
      const report = await engine.compute();

      const longParams = report.insights.filter((i) => i.type === 'long-parameter-lists');
      expect(longParams).toHaveLength(0);
    });

    it('detects methods at warning level (4+ params)', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM methods', [
        { id: 'method-1', name: 'doSomething', module_id: 'mod-1', cnt: 5 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const longParams = report.insights.filter((i) => i.type === 'long-parameter-lists');

      expect(longParams).toHaveLength(1);
      expect(longParams[0]!.severity).toBe('warning');
      expect(longParams[0]!.entities[0]!.detail).toBe('5 parameters');
    });

    it('escalates to critical at 6+ params', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM methods', [
        { id: 'method-1', name: 'tooManyArgs', module_id: 'mod-1', cnt: 7 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const longParams = report.insights.filter((i) => i.type === 'long-parameter-lists');

      expect(longParams).toHaveLength(1);
      expect(longParams[0]!.severity).toBe('critical');
    });
  });

  // ── Module Size (DB-based) ───────────────────────────────────────────────

  describe('module size', () => {
    it('returns no insight when modules are small', async () => {
      const report = await engine.compute();

      const moduleSize = report.insights.filter((i) => i.type === 'module-size');
      expect(moduleSize).toHaveLength(0);
    });

    it('detects large modules at warning level (300+ lines)', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM modules', [
        { id: 'mod-1', name: 'bigModule.ts', module_id: '', cnt: 350 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const moduleSize = report.insights.filter((i) => i.type === 'module-size');

      expect(moduleSize).toHaveLength(1);
      expect(moduleSize[0]!.severity).toBe('warning');
      expect(moduleSize[0]!.entities[0]!.detail).toBe('350 lines');
    });

    it('escalates to critical at 500+ lines', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM modules', [
        { id: 'mod-1', name: 'hugeModule.ts', module_id: '', cnt: 600 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const moduleSize = report.insights.filter((i) => i.type === 'module-size');

      expect(moduleSize).toHaveLength(1);
      expect(moduleSize[0]!.severity).toBe('critical');
    });
  });

  // ── Deep Inheritance (DB-based) ──────────────────────────────────────────

  describe('deep inheritance', () => {
    it('returns no insight with shallow inheritance', async () => {
      const report = await engine.compute();

      const deep = report.insights.filter((i) => i.type === 'deep-inheritance');
      expect(deep).toHaveLength(0);
    });

    it('detects deep inheritance at warning level (depth 3+)', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM chain', [
        { id: 'class-deep', name: 'DeepChild', module_id: 'mod-1', max_depth: 4 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const deep = report.insights.filter((i) => i.type === 'deep-inheritance');

      expect(deep).toHaveLength(1);
      expect(deep[0]!.severity).toBe('warning');
      expect(deep[0]!.entities[0]!.detail).toBe('inheritance depth 4');
    });

    it('escalates to critical at depth 5+', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM chain', [
        { id: 'class-deep', name: 'VeryDeepChild', module_id: 'mod-1', max_depth: 6 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const deep = report.insights.filter((i) => i.type === 'deep-inheritance');

      expect(deep).toHaveLength(1);
      expect(deep[0]!.severity).toBe('critical');
    });
  });

  // ── Leaky Encapsulation (DB-based) ───────────────────────────────────────

  describe('leaky encapsulation', () => {
    it('returns no insight when classes have good encapsulation', async () => {
      const report = await engine.compute();

      const leaky = report.insights.filter((i) => i.type === 'leaky-encapsulation');
      expect(leaky).toHaveLength(0);
    });

    it('detects classes with > 80% public members', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM classes c', [
        { id: 'class-1', name: 'LeakyClass', module_id: 'mod-1', public_count: 9, total_count: 10 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const leaky = report.insights.filter((i) => i.type === 'leaky-encapsulation');

      expect(leaky).toHaveLength(1);
      expect(leaky[0]!.severity).toBe('warning');
      expect(leaky[0]!.entities[0]!.detail).toBe('90% public (9/10 members)');
    });
  });

  // ── Unexported Entities (DB-based) ───────────────────────────────────────

  describe('unexported entities', () => {
    it('returns no insight when everything is exported', async () => {
      const report = await engine.compute();

      const unexported = report.insights.filter((i) => i.type === 'unexported-entities');
      expect(unexported).toHaveLength(0);
    });

    it('detects unexported classes/functions', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      // The unexported entities query uses "FROM classes" and "FROM functions"
      // but the UNION ALL result comes from a single query
      responses.set('NOT EXISTS', [
        { id: 'class-1', name: 'InternalHelper', module_id: 'mod-1' },
        { id: 'func-1', name: 'privateUtil', module_id: 'mod-2' },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const unexported = report.insights.filter((i) => i.type === 'unexported-entities');

      expect(unexported).toHaveLength(1);
      expect(unexported[0]!.severity).toBe('info');
      expect(unexported[0]!.entities).toHaveLength(2);
    });
  });

  // ── Type-Only Dependencies (DB-based) ────────────────────────────────────

  describe('type-only dependencies', () => {
    it('returns no insight when there are no type-only imports', async () => {
      const report = await engine.compute();

      const typeOnly = report.insights.filter((i) => i.type === 'type-only-dependencies');
      expect(typeOnly).toHaveLength(0);
    });

    it('detects modules with type-only imports', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('is_type_only', [
        { id: 'mod-1', name: 'types.ts', type_only_count: 3, total_count: 5 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const typeOnly = report.insights.filter((i) => i.type === 'type-only-dependencies');

      expect(typeOnly).toHaveLength(1);
      expect(typeOnly[0]!.severity).toBe('info');
      expect(typeOnly[0]!.entities[0]!.detail).toBe('3/5 imports are type-only');
    });
  });

  // ── Heavy External Dependencies (DB-based) ──────────────────────────────

  describe('heavy external dependencies', () => {
    it('returns no insight when modules use few external packages', async () => {
      const report = await engine.compute();

      const heavy = report.insights.filter((i) => i.type === 'heavy-external-dependency');
      expect(heavy).toHaveLength(0);
    });

    it('detects modules depending on 8+ external packages', async () => {
      const externalRows: DatabaseRow[] = [];
      for (let i = 0; i < 9; i++) {
        externalRows.push({
          id: `import-${i}`,
          module_id: 'mod-1',
          module_name: 'heavy.ts',
          source: `ext-package-${i}`,
        });
      }

      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM imports', externalRows);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const heavy = report.insights.filter((i) => i.type === 'heavy-external-dependency');

      expect(heavy).toHaveLength(1);
      expect(heavy[0]!.severity).toBe('warning');
      expect(heavy[0]!.entities[0]!.name).toBe('heavy.ts');
    });

    it('correctly groups scoped packages like @scope/name', async () => {
      const externalRows: DatabaseRow[] = [];
      // 8 distinct scoped packages for one module
      for (let i = 0; i < 8; i++) {
        externalRows.push({
          id: `import-${i}`,
          module_id: 'mod-1',
          module_name: 'heavy.ts',
          source: `@scope/package-${i}`,
        });
      }

      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM imports', externalRows);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const heavy = report.insights.filter((i) => i.type === 'heavy-external-dependency');

      expect(heavy).toHaveLength(1);
      expect(heavy[0]!.entities[0]!.detail).toBe('8 external packages');
    });

    it('ignores relative/internal imports', async () => {
      const externalRows: DatabaseRow[] = [
        { id: 'imp-1', module_id: 'mod-1', module_name: 'test.ts', source: './local' },
        { id: 'imp-2', module_id: 'mod-1', module_name: 'test.ts', source: '../parent' },
        { id: 'imp-3', module_id: 'mod-1', module_name: 'test.ts', source: '@/alias' },
        { id: 'imp-4', module_id: 'mod-1', module_name: 'test.ts', source: 'src/internal' },
      ];

      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM imports', externalRows);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const heavy = report.insights.filter((i) => i.type === 'heavy-external-dependency');

      // These are all internal imports so inferExternalPackageName returns undefined
      expect(heavy).toHaveLength(0);
    });
  });

  // ── Unused Exports (DB-based) ────────────────────────────────────────────

  describe('unused exports', () => {
    it('returns no insight when all exports are imported', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM exports', [
        { id: 'exp-1', name: 'usedSymbol', module_id: 'mod-1' },
      ]);
      responses.set('FROM imports', [
        { id: 'imp-1', module_id: 'mod-2', source: './mod1', specifiers_json: '[{"imported": "usedSymbol"}]' },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const unused = report.insights.filter((i) => i.type === 'unused-exports');

      expect(unused).toHaveLength(0);
    });

    it('detects exports not referenced by any import', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM exports', [
        { id: 'exp-1', name: 'usedSymbol', module_id: 'mod-1' },
        { id: 'exp-2', name: 'unusedSymbol', module_id: 'mod-1' },
      ]);
      responses.set('FROM imports', [
        { id: 'imp-1', module_id: 'mod-2', source: './mod1', specifiers_json: '[{"imported": "usedSymbol"}]' },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const unused = report.insights.filter((i) => i.type === 'unused-exports');

      expect(unused).toHaveLength(1);
      expect(unused[0]!.severity).toBe('warning');
      expect(unused[0]!.entities).toHaveLength(1);
      expect(unused[0]!.entities[0]!.name).toBe('unusedSymbol');
    });

    it('handles malformed specifiers_json gracefully', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM exports', [
        { id: 'exp-1', name: 'someSymbol', module_id: 'mod-1' },
      ]);
      responses.set('FROM imports', [
        { id: 'imp-1', module_id: 'mod-2', source: './mod1', specifiers_json: 'not valid json' },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      // Should not throw
      const report = await engine.compute();
      const unused = report.insights.filter((i) => i.type === 'unused-exports');

      // someSymbol is reported as unused since the import json couldn't be parsed
      expect(unused).toHaveLength(1);
    });
  });

  // ── Interface Segregation Violations (DB-based) ──────────────────────────

  describe('interface segregation violations', () => {
    it('returns no insight when interfaces are small', async () => {
      const report = await engine.compute();

      const isp = report.insights.filter((i) => i.type === 'interface-segregation-violations');
      expect(isp).toHaveLength(0);
    });

    it('detects large interfaces with 7+ members and implementors', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('member_count', [
        { id: 'iface-1', name: 'IKitchenSink', module_id: 'mod-1', member_count: 10, implementor_count: 3 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const isp = report.insights.filter((i) => i.type === 'interface-segregation-violations');

      expect(isp).toHaveLength(1);
      expect(isp[0]!.severity).toBe('warning');
      expect(isp[0]!.entities[0]!.detail).toBe('10 members, implemented by 3 classes');
    });
  });

  // ── Missing Return Types (DB-based) ──────────────────────────────────────

  describe('missing return types', () => {
    it('returns no insight when all functions have return types', async () => {
      const report = await engine.compute();

      const missing = report.insights.filter((i) => i.type === 'missing-return-types');
      expect(missing).toHaveLength(0);
    });

    it('detects functions/methods without explicit return types', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('has_explicit_return_type', [
        { id: 'func-1', name: 'doStuff', module_id: 'mod-1', entity_type: 'function' },
        { id: 'method-1', name: 'process', module_id: 'mod-2', entity_type: 'method' },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const missing = report.insights.filter((i) => i.type === 'missing-return-types');

      expect(missing).toHaveLength(1);
      expect(missing[0]!.severity).toBe('info');
      expect(missing[0]!.entities).toHaveLength(2);
    });
  });

  // ── Async Boundary Mismatches (DB-based) ─────────────────────────────────

  describe('async boundary mismatches', () => {
    it('returns no insight when there are no async boundary issues', async () => {
      const report = await engine.compute();

      const asyncMismatch = report.insights.filter((i) => i.type === 'async-boundary-mismatches');
      expect(asyncMismatch).toHaveLength(0);
    });

    it('detects sync methods calling async methods', async () => {
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('symbol_references', [
        { id: 'ref-1', source_symbol_name: 'syncHandler', target_symbol_name: 'fetchData', module_id: 'mod-1' },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(emptyGraph());

      const report = await engine.compute();
      const asyncMismatch = report.insights.filter((i) => i.type === 'async-boundary-mismatches');

      expect(asyncMismatch).toHaveLength(1);
      expect(asyncMismatch[0]!.severity).toBe('info');
      expect(asyncMismatch[0]!.entities[0]!.detail).toBe('sync method calls async fetchData');
    });
  });

  // ── Summary counting ─────────────────────────────────────────────────────

  describe('summary counting', () => {
    it('correctly counts insights by severity', async () => {
      // Set up a god class (warning) and a cycle (critical)
      const responses = new Map<string, DatabaseRow[]>();
      responses.set('FROM classes', [
        { id: 'class-1', name: 'BigClass', module_id: 'mod-1', method_count: 10, property_count: 6 },
      ]);

      adapter = createMockAdapter(responses);
      engine = new InsightEngine(adapter);
      buildImportGraph.mockResolvedValue(graphWithCycle());

      const report = await engine.compute();

      expect(report.summary.critical).toBeGreaterThanOrEqual(1); // from circular imports
      expect(report.summary.warning).toBeGreaterThanOrEqual(1); // from god class
    });
  });
});
