import type { DependencyPackageGraph } from '../../types/DependencyPackageGraph';

import { GraphDataCache } from '../graphDataCache';

function createMockGraph(
  overrides: Partial<DependencyPackageGraph> = {},
): DependencyPackageGraph {
  return {
    packages: [
      {
        id: 'pkg-1',
        name: 'test-package',
        version: '1.0.0',
        path: '/test',
        created_at: '2024-01-01',
      },
    ],
    ...overrides,
  };
}

describe('GraphDataCache', () => {
  let cache: GraphDataCache;

  beforeEach(() => {
    cache = GraphDataCache.getInstance();
    cache.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Singleton behavior ---

  describe('getInstance', () => {
    it('returns the same instance on repeated calls', () => {
      const a = GraphDataCache.getInstance();
      const b = GraphDataCache.getInstance();
      expect(a).toBe(b);
    });
  });

  // --- Cache miss ---

  describe('get - cache miss', () => {
    it('returns null for a key that was never set', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    it('returns null for an empty string key that was never set', () => {
      expect(cache.get('')).toBeNull();
    });
  });

  // --- Cache hit ---

  describe('get - cache hit', () => {
    it('returns data that was previously set', () => {
      const graph = createMockGraph();
      cache.set('key-1', graph);
      expect(cache.get('key-1')).toBe(graph);
    });

    it('returns the correct data for each key when multiple entries exist', () => {
      const graph1 = createMockGraph({ packages: [] });
      const graph2 = createMockGraph();

      cache.set('alpha', graph1);
      cache.set('beta', graph2);

      expect(cache.get('alpha')).toBe(graph1);
      expect(cache.get('beta')).toBe(graph2);
    });

    it('returns the most recently set data when the same key is overwritten', () => {
      const oldGraph = createMockGraph({ packages: [] });
      const newGraph = createMockGraph();

      cache.set('key', oldGraph);
      cache.set('key', newGraph);

      expect(cache.get('key')).toBe(newGraph);
    });
  });

  // --- Expiration ---

  describe('get - expiration', () => {
    it('returns data that is just under 5 minutes old', () => {
      vi.useFakeTimers();
      const graph = createMockGraph();

      cache.set('fresh', graph);

      // Advance to 4 minutes 59 seconds (just under the 5-minute limit)
      vi.advanceTimersByTime(4 * 60 * 1000 + 59 * 1000);

      expect(cache.get('fresh')).toBe(graph);
    });

    it('returns null for data that is exactly 5 minutes old', () => {
      vi.useFakeTimers();
      const graph = createMockGraph();

      cache.set('stale', graph);

      // Advance to exactly 5 minutes + 1ms (past the limit)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      expect(cache.get('stale')).toBeNull();
    });

    it('returns null for data that is well past 5 minutes old', () => {
      vi.useFakeTimers();
      const graph = createMockGraph();

      cache.set('ancient', graph);

      vi.advanceTimersByTime(10 * 60 * 1000);

      expect(cache.get('ancient')).toBeNull();
    });

    it('removes the expired entry from the cache so subsequent gets also return null', () => {
      vi.useFakeTimers();
      const graph = createMockGraph();

      cache.set('will-expire', graph);
      vi.advanceTimersByTime(6 * 60 * 1000);

      // First get triggers deletion
      expect(cache.get('will-expire')).toBeNull();
      // Second get confirms it is still gone
      expect(cache.get('will-expire')).toBeNull();
    });

    it('does not expire other keys when one key expires', () => {
      vi.useFakeTimers();
      const graph1 = createMockGraph({ packages: [] });
      const graph2 = createMockGraph();

      cache.set('old-key', graph1);

      // Advance 3 minutes, then set a second key
      vi.advanceTimersByTime(3 * 60 * 1000);
      cache.set('new-key', graph2);

      // Advance another 2 minutes + 1ms: old-key is now > 5 min, new-key is ~2 min
      vi.advanceTimersByTime(2 * 60 * 1000 + 1);

      expect(cache.get('old-key')).toBeNull();
      expect(cache.get('new-key')).toBe(graph2);
    });

    it('refreshes the timestamp when a key is overwritten', () => {
      vi.useFakeTimers();
      const graph1 = createMockGraph({ packages: [] });
      const graph2 = createMockGraph();

      cache.set('key', graph1);

      // Advance 4 minutes
      vi.advanceTimersByTime(4 * 60 * 1000);

      // Overwrite resets the timestamp
      cache.set('key', graph2);

      // Advance another 4 minutes (8 total since first set, 4 since overwrite)
      vi.advanceTimersByTime(4 * 60 * 1000);

      // Should still be available because the overwrite reset the clock
      expect(cache.get('key')).toBe(graph2);
    });
  });

  // --- clear ---

  describe('clear', () => {
    it('removes all entries from the cache', () => {
      const graph = createMockGraph();

      cache.set('a', graph);
      cache.set('b', graph);
      cache.set('c', graph);

      cache.clear();

      expect(cache.get('a')).toBeNull();
      expect(cache.get('b')).toBeNull();
      expect(cache.get('c')).toBeNull();
    });

    it('is safe to call on an already empty cache', () => {
      expect(() => {
        cache.clear();
      }).not.toThrow();
    });

    it('allows new entries to be added after clearing', () => {
      const graph = createMockGraph();

      cache.set('before', graph);
      cache.clear();

      const newGraph = createMockGraph({ packages: [] });
      cache.set('after', newGraph);

      expect(cache.get('before')).toBeNull();
      expect(cache.get('after')).toBe(newGraph);
    });
  });

  // --- Various data shapes ---

  describe('various data types', () => {
    it('caches a graph with an empty packages array', () => {
      const graph = createMockGraph({ packages: [] });
      cache.set('empty', graph);
      expect(cache.get('empty')).toBe(graph);
      expect(cache.get('empty')!.packages).toHaveLength(0);
    });

    it('caches a graph with multiple packages', () => {
      const graph: DependencyPackageGraph = {
        packages: [
          {
            id: 'pkg-1',
            name: 'first',
            version: '1.0.0',
            path: '/first',
            created_at: '2024-01-01',
          },
          {
            id: 'pkg-2',
            name: 'second',
            version: '2.0.0',
            path: '/second',
            created_at: '2024-06-15',
          },
          {
            id: 'pkg-3',
            name: 'third',
            version: '0.1.0',
            path: '/third',
            created_at: '2025-01-01',
          },
        ],
      };

      cache.set('multi', graph);
      const result = cache.get('multi');
      expect(result).toBe(graph);
      expect(result!.packages).toHaveLength(3);
    });

    it('caches a graph with packages containing dependencies and modules', () => {
      const graph: DependencyPackageGraph = {
        packages: [
          {
            id: 'pkg-rich',
            name: 'rich-package',
            version: '3.0.0',
            path: '/rich',
            created_at: '2024-03-01',
            dependencies: {
              lodash: { id: 'dep-lodash', name: 'lodash', version: '4.17.21' },
            },
            devDependencies: {
              vitest: { id: 'dep-vitest', name: 'vitest', version: '1.0.0' },
            },
            modules: {
              'mod-1': {
                id: 'mod-1',
                name: 'index.ts',
                package_id: 'pkg-rich',
                source: { relativePath: 'src/index.ts' },
              },
            },
          },
        ],
      };

      cache.set('rich', graph);
      const result = cache.get('rich');
      expect(result).toBe(graph);
      expect(result!.packages[0]!.dependencies).toBeDefined();
      expect(result!.packages[0]!.devDependencies).toBeDefined();
      expect(result!.packages[0]!.modules).toBeDefined();
    });

    it('handles keys with special characters', () => {
      const graph = createMockGraph();

      cache.set('key/with/slashes', graph);
      cache.set('key with spaces', graph);
      cache.set('key:colon:separated', graph);
      cache.set('@scoped/package', graph);

      expect(cache.get('key/with/slashes')).toBe(graph);
      expect(cache.get('key with spaces')).toBe(graph);
      expect(cache.get('key:colon:separated')).toBe(graph);
      expect(cache.get('@scoped/package')).toBe(graph);
    });
  });

  // --- set ---

  describe('set', () => {
    it('stores a reference to the original object (no deep clone)', () => {
      const graph = createMockGraph();
      cache.set('ref-check', graph);

      const retrieved = cache.get('ref-check');
      expect(retrieved).toBe(graph);

      // Mutating the original should be visible through the cache
      graph.packages.push({
        id: 'pkg-2',
        name: 'added',
        version: '0.0.1',
        path: '/added',
        created_at: '2025-01-01',
      });

      expect(cache.get('ref-check')!.packages).toHaveLength(2);
    });
  });
});
