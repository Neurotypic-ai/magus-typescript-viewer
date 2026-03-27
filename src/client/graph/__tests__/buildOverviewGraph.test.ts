import { describe, expect, it } from 'vitest';

import { buildOverviewGraph } from '../buildOverviewGraph';

import type { IClass } from '../../../shared/types/Class';
import type { IInterface } from '../../../shared/types/Interface';
import type { IModule, Module } from '../../../shared/types/Module';
import type { Package, PackageGraph } from '../../../shared/types/Package';
import type { BuildOverviewGraphOptions } from '../buildOverviewGraph';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultOptions(overrides: Partial<BuildOverviewGraphOptions> = {}): BuildOverviewGraphOptions {
  return {
    data: { packages: [] },
    enabledRelationshipTypes: ['import'],
    direction: 'LR',
    collapsedFolderIds: new Set(),
    hideTestFiles: false,
    highlightOrphanGlobal: false,
    ...overrides,
  };
}

function makeModule(
  id: string,
  name: string,
  packageId: string,
  relativePath: string,
  extra: Partial<IModule> = {}
): Module {
  return {
    id,
    name,
    package_id: packageId,
    source: { relativePath, directory: '', name, filename: relativePath },
    created_at: '2024-01-01T00:00:00.000Z',
    classes: new Map(),
    interfaces: new Map(),
    imports: new Map(),
    exports: new Map(),
    packages: new Map(),
    typeAliases: new Map(),
    enums: new Map(),
    functions: new Map(),
    variables: new Map(),
    referencePaths: [],
    symbol_references: new Map(),
    ...extra,
  } as Module;
}

function makePackage(id: string, name: string, modules: Record<string, Module> = {}): Package {
  return {
    id,
    name,
    version: '1.0.0',
    path: `/${name}`,
    created_at: '2024-01-01T00:00:00.000Z',
    dependencies: new Map(),
    devDependencies: new Map(),
    peerDependencies: new Map(),
    modules,
  } as Package;
}

function makeGraph(packages: Package[]): PackageGraph {
  return { packages };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildOverviewGraph', () => {
  // -----------------------------------------------------------------------
  // Empty / trivial inputs
  // -----------------------------------------------------------------------

  describe('empty input', () => {
    it('returns empty nodes and edges for an empty package list', () => {
      const result = buildOverviewGraph(defaultOptions());

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.semanticSnapshot).toBeDefined();
      expect(result.semanticSnapshot?.nodes).toEqual([]);
      expect(result.semanticSnapshot?.edges).toEqual([]);
    });

    it('returns empty nodes and edges when the package has no modules', () => {
      const pkg = {
        id: 'pkg-1',
        name: 'empty-pkg',
        version: '1.0.0',
        path: '/empty-pkg',
        created_at: '2024-01-01T00:00:00.000Z',
        dependencies: new Map(),
        devDependencies: new Map(),
        peerDependencies: new Map(),
        modules: undefined,
      } as unknown as Package;

      const result = buildOverviewGraph(defaultOptions({ data: makeGraph([pkg]) }));

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });

    it('returns empty nodes and edges when modules object is empty', () => {
      const pkg = makePackage('pkg-1', 'empty-pkg', {});

      const result = buildOverviewGraph(defaultOptions({ data: makeGraph([pkg]) }));

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Single module
  // -----------------------------------------------------------------------

  describe('single module', () => {
    it('creates a module node with folder group node and no edges', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const pkg = makePackage('pkg-1', 'my-app', { 'mod-1': mod });

      const result = buildOverviewGraph(defaultOptions({ data: makeGraph([pkg]) }));

      const moduleNode = result.nodes.find((n) => n.type === 'module');
      expect(moduleNode).toBeDefined();
      expect(moduleNode?.id).toBe('mod-1');
      expect(moduleNode?.data?.label).toBe('index.ts');
      expect(result.edges).toHaveLength(0);
    });

    it('annotates a single node as an orphan (no edges at all)', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const pkg = makePackage('pkg-1', 'my-app', { 'mod-1': mod });

      const result = buildOverviewGraph(defaultOptions({ data: makeGraph([pkg]) }));

      const moduleNode = result.nodes.find((n) => n.type === 'module');
      expect(moduleNode?.data?.diagnostics?.orphanCurrent).toBe(true);
      expect(moduleNode?.data?.diagnostics?.orphanGlobal).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple modules with imports
  // -----------------------------------------------------------------------

  describe('multiple modules with import edges', () => {
    function twoModuleGraph(): PackageGraph {
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts');
      return makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);
    }

    it('creates nodes for both modules', () => {
      const result = buildOverviewGraph(defaultOptions({ data: twoModuleGraph() }));

      const moduleNodes = result.nodes.filter((n) => n.type === 'module');
      expect(moduleNodes).toHaveLength(2);
      const nodeIds = moduleNodes.map((n) => n.id).sort();
      expect(nodeIds).toEqual(['mod-a', 'mod-b']);
    });

    it('creates an import edge from importer to imported', () => {
      const result = buildOverviewGraph(defaultOptions({ data: twoModuleGraph() }));

      expect(result.edges.length).toBeGreaterThanOrEqual(1);
      const importEdge = result.edges.find((e) => e.data?.type === 'import');
      expect(importEdge).toBeDefined();
      expect(importEdge?.source).toBe('mod-a');
      expect(importEdge?.target).toBe('mod-b');
    });

    it('marks connected nodes as non-orphan for current and global', () => {
      const result = buildOverviewGraph(
        defaultOptions({ data: twoModuleGraph(), enabledRelationshipTypes: ['import'] })
      );

      const nodeA = result.nodes.find((n) => n.id === 'mod-a');
      const nodeB = result.nodes.find((n) => n.id === 'mod-b');
      expect(nodeA?.data?.diagnostics?.orphanCurrent).toBe(false);
      expect(nodeA?.data?.diagnostics?.orphanGlobal).toBe(false);
      expect(nodeB?.data?.diagnostics?.orphanCurrent).toBe(false);
      expect(nodeB?.data?.diagnostics?.orphanGlobal).toBe(false);
    });

    it('returns a semanticSnapshot that reflects pre-transform state', () => {
      const result = buildOverviewGraph(defaultOptions({ data: twoModuleGraph() }));

      expect(result.semanticSnapshot).toBeDefined();
      expect(result.semanticSnapshot?.nodes).toHaveLength(2);
      expect(result.semanticSnapshot?.edges.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Edge visibility / relationship filtering
  // -----------------------------------------------------------------------

  describe('edge visibility', () => {
    function graphWithImportEdge(): PackageGraph {
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts');
      return makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);
    }

    it('makes import edges visible when import is in enabledRelationshipTypes', () => {
      const result = buildOverviewGraph(
        defaultOptions({ data: graphWithImportEdge(), enabledRelationshipTypes: ['import'] })
      );

      const importEdge = result.edges.find((e) => e.data?.type === 'import');
      expect(importEdge?.hidden).toBe(false);
    });

    it('hides import edges when import is not in enabledRelationshipTypes', () => {
      const result = buildOverviewGraph(
        defaultOptions({ data: graphWithImportEdge(), enabledRelationshipTypes: ['inheritance'] })
      );

      const importEdge = result.edges.find((e) => e.data?.type === 'import');
      expect(importEdge?.hidden).toBe(true);
    });

    it('marks nodes as orphanCurrent when their edges are hidden', () => {
      const result = buildOverviewGraph(
        defaultOptions({ data: graphWithImportEdge(), enabledRelationshipTypes: ['inheritance'] })
      );

      // All edges are hidden, so nodes should be current-orphans but not global-orphans
      const nodeA = result.nodes.find((n) => n.id === 'mod-a');
      expect(nodeA?.data?.diagnostics?.orphanCurrent).toBe(true);
      expect(nodeA?.data?.diagnostics?.orphanGlobal).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Test file filtering
  // -----------------------------------------------------------------------

  describe('test file filtering', () => {
    function graphWithTestModule(): PackageGraph {
      const modMain = makeModule('mod-main', 'main.ts', 'pkg-1', 'src/main.ts');
      const modTest = makeModule('mod-test', 'main.test.ts', 'pkg-1', 'src/main.test.ts');
      return makeGraph([makePackage('pkg-1', 'app', { main: modMain, test: modTest })]);
    }

    it('includes test modules when hideTestFiles is false', () => {
      const result = buildOverviewGraph(defaultOptions({ data: graphWithTestModule(), hideTestFiles: false }));

      const ids = result.nodes.map((n) => n.id);
      expect(ids).toContain('mod-main');
      expect(ids).toContain('mod-test');
    });

    it('excludes test modules when hideTestFiles is true', () => {
      const result = buildOverviewGraph(defaultOptions({ data: graphWithTestModule(), hideTestFiles: true }));

      const ids = result.nodes.map((n) => n.id);
      expect(ids).toContain('mod-main');
      expect(ids).not.toContain('mod-test');
    });
  });

  // -----------------------------------------------------------------------
  // Package nodes
  // -----------------------------------------------------------------------

  describe('package nodes', () => {
    it('never creates package-type VueFlow nodes (packages are not visualized as nodes)', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const pkg = makePackage('pkg-1', 'my-app', { 'mod-1': mod });

      const result = buildOverviewGraph(defaultOptions({ data: makeGraph([pkg]) }));

      const packageNode = result.nodes.find((n) => n.type === 'package');
      expect(packageNode).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Class / interface nodes (graph mode)
  // -----------------------------------------------------------------------

  describe('class and interface nodes', () => {
    function graphWithClasses(): PackageGraph {
      const mod = makeModule('mod-1', 'service.ts', 'pkg-1', 'src/service.ts', {
        classes: {
          MyClass: {
            id: 'cls-1',
            name: 'MyClass',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            created_at: '2024-01-01T00:00:00.000Z',
            implemented_interfaces: {},
            properties: [{ id: 'prop-1', name: 'value', type: 'string', visibility: 'public' }],
            methods: [
              { id: 'meth-1', name: 'run', returnType: 'void', visibility: 'public', signature: 'run(): void' },
            ],
          } as unknown as IClass,
        },
        interfaces: {
          MyInterface: {
            id: 'iface-1',
            name: 'MyInterface',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            created_at: '2024-01-01T00:00:00.000Z',
            extended_interfaces: {},
            properties: [{ id: 'iprop-1', name: 'id', type: 'number', visibility: 'public' }],
            methods: [],
          } as unknown as IInterface,
        },
      });
      return makeGraph([makePackage('pkg-1', 'app', { mod: mod })]);
    }

    it('does not create class/interface VueFlow nodes in compact mode', () => {
      const result = buildOverviewGraph(
        defaultOptions({
          data: graphWithClasses(),
        })
      );

      const classNode = result.nodes.find((n) => n.type === 'class');
      const ifaceNode = result.nodes.find((n) => n.type === 'interface');
      expect(classNode).toBeUndefined();
      expect(ifaceNode).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Folder clustering
  // -----------------------------------------------------------------------

  describe('folder clustering', () => {
    function multifolderGraph(): PackageGraph {
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a/a.ts', {
        imports: { i1: { uuid: 'i1', name: 'b', fullPath: '../b/b', relativePath: '../b/b', specifiers: new Map(), depth: 0 } },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b/b.ts');
      return makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);
    }

    it('creates group nodes for folders', () => {
      const result = buildOverviewGraph(defaultOptions({ data: multifolderGraph() }));

      const groupNodes = result.nodes.filter((n) => n.type === 'group');
      expect(groupNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('lifts cross-folder module edges to a single folder→folder edge', () => {
      const result = buildOverviewGraph(
        defaultOptions({
          data: multifolderGraph(),
          enabledRelationshipTypes: ['import'],
        })
      );

      // No highway segment metadata on any edge
      expect(result.edges.some((edge) => 'highwaySegment' in (edge.data ?? {}))).toBe(false);
      // Module-level edge is gone — lifted to folder level
      expect(
        result.edges.some((edge) => edge.source === 'mod-a' && edge.target === 'mod-b')
      ).toBe(false);
      // Folder→folder edge exists with crossFolder type
      const folderEdge = result.edges.find(
        (edge) => edge.source === 'dir:app:src/a' && edge.target === 'dir:app:src/b'
      );
      expect(folderEdge).toBeDefined();
      expect(folderEdge?.type).toBe('crossFolder');
    });
  });

  // -----------------------------------------------------------------------
  // Multiple packages
  // -----------------------------------------------------------------------

  describe('multiple packages', () => {
    it('creates nodes from all packages (module + folder group per module)', () => {
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts');
      const modB = makeModule('mod-b', 'b.ts', 'pkg-2', 'src/b.ts');
      const pkg1 = makePackage('pkg-1', 'lib-a', { a: modA });
      const pkg2 = makePackage('pkg-2', 'lib-b', { b: modB });

      const result = buildOverviewGraph(defaultOptions({ data: makeGraph([pkg1, pkg2]) }));

      // Folder clustering always runs: each module gets a folder group node.
      const moduleNodes = result.nodes.filter((n) => n.type === 'module');
      expect(moduleNodes).toHaveLength(2);
      const moduleIds = moduleNodes.map((n) => n.id).sort();
      expect(moduleIds).toEqual(['mod-a', 'mod-b']);
    });
  });

  // -----------------------------------------------------------------------
  // Direction option
  // -----------------------------------------------------------------------

  describe('direction option', () => {
    it('respects different layout directions without errors', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { m: mod })]);

      for (const direction of ['LR', 'RL', 'TB', 'BT'] as const) {
        const result = buildOverviewGraph(defaultOptions({ data, direction }));
        // module node + folder group node
        expect(result.nodes).toHaveLength(2);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Diagnostics annotation
  // -----------------------------------------------------------------------

  describe('diagnostics annotation', () => {
    it('provides externalDependencyPackageCount and level fields', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { m: mod })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const node = result.nodes[0];
      expect(node?.data?.diagnostics).toBeDefined();
      expect(typeof node?.data?.diagnostics?.externalDependencyPackageCount).toBe('number');
      expect(typeof node?.data?.diagnostics?.externalDependencySymbolCount).toBe('number');
      expect(node?.data?.diagnostics?.externalDependencyLevel).toBe('normal');
    });

    it('correctly identifies orphanGlobal vs orphanCurrent when only edge visibility differs', () => {
      // Two modules with an import relationship. If the relationship type is disabled,
      // orphanCurrent should be true but orphanGlobal should be false.
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);

      const result = buildOverviewGraph(defaultOptions({ data, enabledRelationshipTypes: [] }));

      // Only check module nodes — folder group nodes are always orphanGlobal since
      // they don't exist in the unfiltered pre-cluster graph.
      const moduleNodes = result.nodes.filter((n) => n.type === 'module');
      expect(moduleNodes.length).toBeGreaterThanOrEqual(1);
      for (const node of moduleNodes) {
        expect(node.data?.diagnostics?.orphanCurrent).toBe(true);
        expect(node.data?.diagnostics?.orphanGlobal).toBe(false);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Node type filtering
  // -----------------------------------------------------------------------

  describe('node type filtering', () => {
    it('creates folder group nodes even with no enabled relationship types', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { m: mod })]);

      const result = buildOverviewGraph(defaultOptions({ data, enabledRelationshipTypes: [] }));

      // Folder clustering always runs: module node + its folder group node are always created.
      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Layout weights
  // -----------------------------------------------------------------------

  describe('layout weights', () => {
    it('assigns zero layoutWeight to foundation modules and negative to consumer modules based on transitive import depth', () => {
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const nodeA = result.nodes.find((n) => n.id === 'mod-a');
      const nodeB = result.nodes.find((n) => n.id === 'mod-b');
      // mod-a imports mod-b (depth 0) → depth 1, weight = -1 (consumer, right)
      expect(nodeA?.data?.layoutWeight).toBe(-1);
      // mod-b has no imports → depth 0, weight = 0 (foundation, left)
      expect(nodeB?.data?.layoutWeight).toBe(0);
    });

    it('assigns folder layoutWeight using min-rank (max weight) of children — flush-left with earliest child', () => {
      // Same two-module graph: mod-a imports mod-b, both in the same folder (src/)
      // mod-a weight=-1 (consumer), mod-b weight=0 (foundation)
      // Sugiyama: folderRank = min(rank(child)) → folderWeight = max(childWeight) = 0
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const groupNode = result.nodes.find((n) => n.type === 'group');
      expect(groupNode).toBeDefined();
      // min-rank aggregation: max(0, -1) = 0 (folder flush-left with its foundation child)
      expect(groupNode?.data?.layoutWeight).toBe(0);
    });

    it('folder with only consumer children gets most-left child weight', () => {
      // mod-a → mod-c (in different folder), mod-b → mod-c (in different folder)
      // Folder containing mod-a and mod-b: both have weight -1, so folder weight = max(-1, -1) = -1
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/consumers/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'c', fullPath: '../lib/c', relativePath: '../lib/c', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/consumers/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'c', fullPath: '../lib/c', relativePath: '../lib/c', specifiers: new Map(), depth: 0 },
        },
      });
      const modC = makeModule('mod-c', 'c.ts', 'pkg-1', 'src/lib/c.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, c: modC })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      // Find folder groups
      const consumerFolder = result.nodes.find(
        (n) => n.type === 'group' && result.nodes.some((child) => child.parentNode === n.id && child.id === 'mod-a')
      );
      const libFolder = result.nodes.find(
        (n) => n.type === 'group' && result.nodes.some((child) => child.parentNode === n.id && child.id === 'mod-c')
      );
      expect(consumerFolder).toBeDefined();
      expect(libFolder).toBeDefined();
      // Consumer folder: max(-2, -2) = -2 (fanIn=2 for mod-c → stepCost=2)
      expect(consumerFolder?.data?.layoutWeight).toBe(-2);
      // Lib folder: max(0) = 0 (foundation)
      expect(libFolder?.data?.layoutWeight).toBe(0);
    });

    it('propagates mean sortOrder from children to folder groups', () => {
      // Two folders with children that have different sortOrders
      // Folder sortOrder = mean(child sortOrders)
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/consumers/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'x', fullPath: '../lib/x', relativePath: '../lib/x', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/consumers/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'y', fullPath: '../lib/y', relativePath: '../lib/y', specifiers: new Map(), depth: 0 },
        },
      });
      const modX = makeModule('mod-x', 'x.ts', 'pkg-1', 'src/lib/x.ts');
      const modY = makeModule('mod-y', 'y.ts', 'pkg-1', 'src/lib/y.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, x: modX, y: modY })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      // Folder groups should have a numeric sortOrder (propagated from children)
      const consumerFolder = result.nodes.find(
        (n) => n.type === 'group' && result.nodes.some((child) => child.parentNode === n.id && child.id === 'mod-a')
      );
      const libFolder = result.nodes.find(
        (n) => n.type === 'group' && result.nodes.some((child) => child.parentNode === n.id && child.id === 'mod-x')
      );
      expect(consumerFolder?.data?.sortOrder).toBeDefined();
      expect(typeof consumerFolder?.data?.sortOrder).toBe('number');
      expect(libFolder?.data?.sortOrder).toBeDefined();
      expect(typeof libFolder?.data?.sortOrder).toBe('number');
    });

    it('amplifies weight gap when a foundation module has high fan-in', () => {
      // mod-c is imported by both mod-a and mod-b (fanIn=2)
      // stepCost(mod-c) = 1 + log2(2) = 2
      // mod-a and mod-b should both get weight = -2 (not -1)
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'c', fullPath: './c', relativePath: './c', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'c', fullPath: './c', relativePath: './c', specifiers: new Map(), depth: 0 },
        },
      });
      const modC = makeModule('mod-c', 'c.ts', 'pkg-1', 'src/c.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, c: modC })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const nodeA = result.nodes.find((n) => n.id === 'mod-a');
      const nodeB = result.nodes.find((n) => n.id === 'mod-b');
      const nodeC = result.nodes.find((n) => n.id === 'mod-c');
      // Foundation stays at 0
      expect(nodeC?.data?.layoutWeight).toBe(0);
      // Both consumers get equal weight, amplified by fan-in: -(1 + log2(2)) = -2
      expect(nodeA?.data?.layoutWeight).toBe(-2);
      expect(nodeB?.data?.layoutWeight).toBe(-2);
    });

    it('produces larger gap for higher fan-in foundations', () => {
      // mod-d imported by 4 modules (fanIn=4) → stepCost = 1 + log2(4) = 3
      // mod-e imported by 1 module  (fanIn=1) → stepCost = 1 + log2(1) = 1
      // Consumer of mod-d should be pushed further right than consumer of mod-e
      const consumers = ['c1', 'c2', 'c3', 'c4'].map((name) =>
        makeModule(`mod-${name}`, `${name}.ts`, 'pkg-1', `src/${name}.ts`, {
          imports: {
            [`i-${name}`]: {
              uuid: `i-${name}`,
              name: 'd',
              fullPath: './d',
              relativePath: './d',
              specifiers: new Map(),
              depth: 0,
            },
          },
        })
      );
      const modD = makeModule('mod-d', 'd.ts', 'pkg-1', 'src/d.ts');
      const modE = makeModule('mod-e', 'e.ts', 'pkg-1', 'src/e.ts');
      const modF = makeModule('mod-f', 'f.ts', 'pkg-1', 'src/f.ts', {
        imports: {
          iF: { uuid: 'iF', name: 'e', fullPath: './e', relativePath: './e', specifiers: new Map(), depth: 0 },
        },
      });
      const allModules = Object.fromEntries(
        [...consumers, modD, modE, modF].map((m) => [m.name, m])
      );
      const data = makeGraph([makePackage('pkg-1', 'app', allModules)]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const weightC1 = result.nodes.find((n) => n.id === 'mod-c1')?.data?.layoutWeight as number;
      const weightF = result.nodes.find((n) => n.id === 'mod-f')?.data?.layoutWeight as number;
      // Consumer of high-fan-in module gets pushed further right
      expect(weightC1).toBeLessThan(weightF);
      // stepCost(d) = 1 + log2(4) = 3, stepCost(e) = 1 + log2(1) = 1
      expect(weightC1).toBe(-3);
      expect(weightF).toBe(-1);
    });

    it('accumulates fan-in weighted costs through transitive chains', () => {
      // Chain: mod-a → mod-b (fanIn=1) → mod-c (fanIn=1)
      // weightedDepth(c) = 0, weightedDepth(b) = stepCost(c) + 0 = 1,
      // weightedDepth(a) = stepCost(b) + 1 = 2
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'c', fullPath: './c', relativePath: './c', specifiers: new Map(), depth: 0 },
        },
      });
      const modC = makeModule('mod-c', 'c.ts', 'pkg-1', 'src/c.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, c: modC })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      // All fanIn=1 → each step costs 1 → same as old depth-based algorithm
      expect(result.nodes.find((n) => n.id === 'mod-c')?.data?.layoutWeight).toBe(0);
      expect(result.nodes.find((n) => n.id === 'mod-b')?.data?.layoutWeight).toBe(-1);
      expect(result.nodes.find((n) => n.id === 'mod-a')?.data?.layoutWeight).toBe(-2);
    });

    it('ignores non-import relationships when computing layoutWeight', () => {
      const baseClass = {
        id: 'cls-base',
        name: 'Base',
        package_id: 'pkg-1',
        module_id: 'mod-base',
        created_at: '2024-01-01T00:00:00.000Z',
        implemented_interfaces: {},
        properties: [],
        methods: [],
      } as unknown as IClass;
      const derivedClass = {
        id: 'cls-derived',
        name: 'Derived',
        package_id: 'pkg-1',
        module_id: 'mod-derived',
        created_at: '2024-01-01T00:00:00.000Z',
        extends_id: 'cls-base',
        implemented_interfaces: {},
        properties: [],
        methods: [],
      } as unknown as IClass;
      const modBase = makeModule('mod-base', 'base.ts', 'pkg-1', 'src/base.ts', {
        classes: { Base: baseClass },
      });
      const modDerived = makeModule('mod-derived', 'derived.ts', 'pkg-1', 'src/derived.ts', {
        classes: { Derived: derivedClass },
      });
      const data = makeGraph([makePackage('pkg-1', 'app', { base: modBase, derived: modDerived })]);

      const result = buildOverviewGraph(defaultOptions({ data, enabledRelationshipTypes: ['inheritance'] }));

      expect(result.nodes.find((node) => node.id === 'mod-base')?.data?.layoutWeight).toBe(0);
      expect(result.nodes.find((node) => node.id === 'mod-derived')?.data?.layoutWeight).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Layer assignment (Sugiyama integer ranks)
  // -----------------------------------------------------------------------

  describe('layer assignment', () => {
    it('assigns integer layerIndex based on longest-path (uniform step cost)', () => {
      // Chain: mod-a → mod-b → mod-c
      // layerIndex(c) = 0 (foundation), layerIndex(b) = 1, layerIndex(a) = 2
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'c', fullPath: './c', relativePath: './c', specifiers: new Map(), depth: 0 },
        },
      });
      const modC = makeModule('mod-c', 'c.ts', 'pkg-1', 'src/c.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, c: modC })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      // layerIndex uses uniform step cost (unlike layoutWeight which uses fan-in weighting)
      expect(result.nodes.find((n) => n.id === 'mod-c')?.data?.layerIndex).toBe(0);
      expect(result.nodes.find((n) => n.id === 'mod-b')?.data?.layerIndex).toBe(1);
      expect(result.nodes.find((n) => n.id === 'mod-a')?.data?.layerIndex).toBe(2);
    });

    it('assigns layer 0 to orphan nodes with no import edges', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { m: mod })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      expect(result.nodes.find((n) => n.id === 'mod-1')?.data?.layerIndex).toBe(0);
    });

    it('gives same layer to siblings that import only foundations', () => {
      // mod-a → mod-c, mod-b → mod-c: both should be layer 1
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'c', fullPath: './c', relativePath: './c', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'c', fullPath: './c', relativePath: './c', specifiers: new Map(), depth: 0 },
        },
      });
      const modC = makeModule('mod-c', 'c.ts', 'pkg-1', 'src/c.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, c: modC })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      expect(result.nodes.find((n) => n.id === 'mod-a')?.data?.layerIndex).toBe(1);
      expect(result.nodes.find((n) => n.id === 'mod-b')?.data?.layerIndex).toBe(1);
      expect(result.nodes.find((n) => n.id === 'mod-c')?.data?.layerIndex).toBe(0);
    });

    it('correctly layers a diamond DAG pattern (A→B, A→C, B→D, C→D)', () => {
      // Diamond: mod-a → mod-b → mod-d, mod-a → mod-c → mod-d
      // Expected layers: mod-d=0, mod-b=mod-c=1, mod-a=2
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
          i2: { uuid: 'i2', name: 'c', fullPath: './c', relativePath: './c', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i3: { uuid: 'i3', name: 'd', fullPath: './d', relativePath: './d', specifiers: new Map(), depth: 0 },
        },
      });
      const modC = makeModule('mod-c', 'c.ts', 'pkg-1', 'src/c.ts', {
        imports: {
          i4: { uuid: 'i4', name: 'd', fullPath: './d', relativePath: './d', specifiers: new Map(), depth: 0 },
        },
      });
      const modD = makeModule('mod-d', 'd.ts', 'pkg-1', 'src/d.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, c: modC, d: modD })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      // Layer assignment follows longest path
      expect(result.nodes.find((n) => n.id === 'mod-d')?.data?.layerIndex).toBe(0);
      expect(result.nodes.find((n) => n.id === 'mod-b')?.data?.layerIndex).toBe(1);
      expect(result.nodes.find((n) => n.id === 'mod-c')?.data?.layerIndex).toBe(1);
      expect(result.nodes.find((n) => n.id === 'mod-a')?.data?.layerIndex).toBe(2);

      // layoutWeight: mod-d has fanIn=2, stepCost = 1+log₂(2) = 2
      // mod-b and mod-c: depth = stepCost(d) + 0 = 2, weight = -2
      // mod-a: imports mod-b (fanIn=1, cost=1) and mod-c (fanIn=1, cost=1)
      // depth(a) = max(1 + depth(b), 1 + depth(c)) = max(1+2, 1+2) = 3, weight = -3
      expect(result.nodes.find((n) => n.id === 'mod-d')?.data?.layoutWeight).toBe(0);
      expect(result.nodes.find((n) => n.id === 'mod-b')?.data?.layoutWeight).toBe(-2);
      expect(result.nodes.find((n) => n.id === 'mod-c')?.data?.layoutWeight).toBe(-2);
      expect(result.nodes.find((n) => n.id === 'mod-a')?.data?.layoutWeight).toBe(-3);
    });

    it('correctly layers fan-out pattern (one module imports many)', () => {
      // mod-hub imports mod-a, mod-b, mod-c (all foundations)
      // Expected: hub at layer 1, others at layer 0
      const modHub = makeModule('mod-hub', 'hub.ts', 'pkg-1', 'src/hub.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'a', fullPath: './a', relativePath: './a', specifiers: new Map(), depth: 0 },
          i2: { uuid: 'i2', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
          i3: { uuid: 'i3', name: 'c', fullPath: './c', relativePath: './c', specifiers: new Map(), depth: 0 },
        },
      });
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts');
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts');
      const modC = makeModule('mod-c', 'c.ts', 'pkg-1', 'src/c.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { hub: modHub, a: modA, b: modB, c: modC })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      expect(result.nodes.find((n) => n.id === 'mod-hub')?.data?.layerIndex).toBe(1);
      expect(result.nodes.find((n) => n.id === 'mod-a')?.data?.layerIndex).toBe(0);
      expect(result.nodes.find((n) => n.id === 'mod-b')?.data?.layerIndex).toBe(0);
      expect(result.nodes.find((n) => n.id === 'mod-c')?.data?.layerIndex).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Barycenter sort order (Sugiyama crossing minimization)
  // -----------------------------------------------------------------------

  describe('barycenter sort order', () => {
    it('assigns sortOrder that groups nodes connected to the same dependency', () => {
      // Layer 0: mod-x, mod-y (foundations)
      // Layer 1: mod-a → mod-x, mod-b → mod-y, mod-c → mod-x
      // Barycenter should place mod-a and mod-c adjacent (both connect to mod-x)
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'x', fullPath: './x', relativePath: './x', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'y', fullPath: './y', relativePath: './y', specifiers: new Map(), depth: 0 },
        },
      });
      const modC = makeModule('mod-c', 'c.ts', 'pkg-1', 'src/c.ts', {
        imports: {
          i3: { uuid: 'i3', name: 'x', fullPath: './x', relativePath: './x', specifiers: new Map(), depth: 0 },
        },
      });
      const modX = makeModule('mod-x', 'x.ts', 'pkg-1', 'src/x.ts');
      const modY = makeModule('mod-y', 'y.ts', 'pkg-1', 'src/y.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, c: modC, x: modX, y: modY })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const sortA = result.nodes.find((n) => n.id === 'mod-a')?.data?.sortOrder as number;
      const sortB = result.nodes.find((n) => n.id === 'mod-b')?.data?.sortOrder as number;
      const sortC = result.nodes.find((n) => n.id === 'mod-c')?.data?.sortOrder as number;

      expect(typeof sortA).toBe('number');
      expect(typeof sortB).toBe('number');
      expect(typeof sortC).toBe('number');

      // mod-a and mod-c both import mod-x, so they should have the same or very close sortOrder
      // mod-b imports mod-y, so it should have a different sortOrder
      // The key property: |sortA - sortC| < |sortA - sortB|
      expect(Math.abs(sortA - sortC)).toBeLessThan(Math.abs(sortA - sortB));
    });

    it('influences sortOrder through long-distance edges (multi-layer skip)', () => {
      // Layer 0: mod-x, mod-y (foundations)
      // Layer 1: mod-m → mod-x (mid-level)
      // Layer 2: mod-a → mod-m, mod-a → mod-x (skip layer 1-0)
      //          mod-b → mod-m, mod-b → mod-y (skip layer 1-0)
      // The long edge mod-a → mod-x should pull mod-a toward mod-x's position
      // The long edge mod-b → mod-y should pull mod-b toward mod-y's position
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'm', fullPath: './m', relativePath: './m', specifiers: new Map(), depth: 0 },
          i2: { uuid: 'i2', name: 'x', fullPath: './x', relativePath: './x', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i3: { uuid: 'i3', name: 'm', fullPath: './m', relativePath: './m', specifiers: new Map(), depth: 0 },
          i4: { uuid: 'i4', name: 'y', fullPath: './y', relativePath: './y', specifiers: new Map(), depth: 0 },
        },
      });
      const modM = makeModule('mod-m', 'm.ts', 'pkg-1', 'src/m.ts', {
        imports: {
          i5: { uuid: 'i5', name: 'x', fullPath: './x', relativePath: './x', specifiers: new Map(), depth: 0 },
        },
      });
      const modX = makeModule('mod-x', 'x.ts', 'pkg-1', 'src/x.ts');
      const modY = makeModule('mod-y', 'y.ts', 'pkg-1', 'src/y.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, m: modM, x: modX, y: modY })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const sortA = result.nodes.find((n) => n.id === 'mod-a')?.data?.sortOrder as number;
      const sortB = result.nodes.find((n) => n.id === 'mod-b')?.data?.sortOrder as number;
      const sortX = result.nodes.find((n) => n.id === 'mod-x')?.data?.sortOrder as number;
      const sortY = result.nodes.find((n) => n.id === 'mod-y')?.data?.sortOrder as number;

      // mod-a connects to mod-x (long edge), mod-b connects to mod-y (long edge)
      // After distance-weighted barycenter, if sortX < sortY then sortA < sortB
      if (sortX < sortY) {
        expect(sortA).toBeLessThanOrEqual(sortB);
      } else {
        expect(sortA).toBeGreaterThanOrEqual(sortB);
      }
    });

    it('assigns sortOrder to foundation nodes based on their consumers', () => {
      // Layer 0: mod-x, mod-y
      // Layer 1: mod-a → mod-x, mod-b → mod-y
      // After barycenter sweeps, foundations should align with their consumers
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'x', fullPath: './x', relativePath: './x', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'y', fullPath: './y', relativePath: './y', specifiers: new Map(), depth: 0 },
        },
      });
      const modX = makeModule('mod-x', 'x.ts', 'pkg-1', 'src/x.ts');
      const modY = makeModule('mod-y', 'y.ts', 'pkg-1', 'src/y.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, x: modX, y: modY })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const sortX = result.nodes.find((n) => n.id === 'mod-x')?.data?.sortOrder as number;
      const sortY = result.nodes.find((n) => n.id === 'mod-y')?.data?.sortOrder as number;
      const sortA = result.nodes.find((n) => n.id === 'mod-a')?.data?.sortOrder as number;
      const sortB = result.nodes.find((n) => n.id === 'mod-b')?.data?.sortOrder as number;

      // After right-to-left sweep: mod-x should align with mod-a, mod-y with mod-b
      // So if sortA < sortB, then sortX < sortY (and vice versa)
      if (sortA < sortB) {
        expect(sortX).toBeLessThanOrEqual(sortY);
      } else {
        expect(sortX).toBeGreaterThanOrEqual(sortY);
      }
    });

    it('disconnected nodes maintain stable position instead of being pushed to bottom', () => {
      // Layer 0: mod-x, mod-y, mod-orphan (orphan has no connections)
      // Layer 1: mod-a → mod-x, mod-b → mod-y
      // mod-orphan should NOT be pushed to the bottom of layer 0 — it should maintain
      // a stable position relative to its alphabetical initial position
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'x', fullPath: './x', relativePath: './x', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'y', fullPath: './y', relativePath: './y', specifiers: new Map(), depth: 0 },
        },
      });
      const modX = makeModule('mod-x', 'x.ts', 'pkg-1', 'src/x.ts');
      const modY = makeModule('mod-y', 'y.ts', 'pkg-1', 'src/y.ts');
      const modOrphan = makeModule('mod-orphan', 'orphan.ts', 'pkg-1', 'src/orphan.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, x: modX, y: modY, orphan: modOrphan })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const sortOrphan = result.nodes.find((n) => n.id === 'mod-orphan')?.data?.sortOrder as number;
      const sortX = result.nodes.find((n) => n.id === 'mod-x')?.data?.sortOrder as number;
      const sortY = result.nodes.find((n) => n.id === 'mod-y')?.data?.sortOrder as number;

      // Orphan should NOT be at the maximum sortOrder (pushed to bottom)
      // It should maintain a stable position
      const maxSort = Math.max(sortX, sortY, sortOrphan);
      expect(sortOrphan).not.toBe(maxSort);
    });
  });

  // -----------------------------------------------------------------------
  // Back-edge detection (cycle marking)
  // -----------------------------------------------------------------------

  describe('back-edge detection', () => {
    it('marks back-edges in a simple cycle with isBackEdge flag', () => {
      // mod-a → mod-b → mod-a (cycle)
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'a', fullPath: './a', relativePath: './a', specifiers: new Map(), depth: 0 },
        },
      });
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const importEdges = result.edges.filter((e) => e.data?.type === 'import');
      expect(importEdges).toHaveLength(2);

      // Exactly one of the two edges should be marked as a back-edge
      const backEdges = importEdges.filter((e) => e.data?.isBackEdge === true);
      expect(backEdges).toHaveLength(1);
    });

    it('does not mark any edges as back-edges in an acyclic graph', () => {
      // mod-a → mod-b → mod-c (no cycle)
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'c', fullPath: './c', relativePath: './c', specifiers: new Map(), depth: 0 },
        },
      });
      const modC = makeModule('mod-c', 'c.ts', 'pkg-1', 'src/c.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, c: modC })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const backEdges = result.edges.filter((e) => e.data?.isBackEdge === true);
      expect(backEdges).toHaveLength(0);
    });

    it('excludes back-edges from fan-in count so cycle members do not inflate weights', () => {
      // mod-a → mod-b → mod-c → mod-a (cycle on c→a which is the back-edge)
      // mod-d → mod-a (separate consumer)
      // Without back-edge exclusion: mod-a fanIn=2 (from mod-d AND back-edge from mod-c)
      // With back-edge exclusion: mod-a fanIn=1 (only from mod-d)
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'c', fullPath: './c', relativePath: './c', specifiers: new Map(), depth: 0 },
        },
      });
      const modC = makeModule('mod-c', 'c.ts', 'pkg-1', 'src/c.ts', {
        imports: {
          i3: { uuid: 'i3', name: 'a', fullPath: './a', relativePath: './a', specifiers: new Map(), depth: 0 },
        },
      });
      const modD = makeModule('mod-d', 'd.ts', 'pkg-1', 'src/d.ts', {
        imports: {
          i4: { uuid: 'i4', name: 'a', fullPath: './a', relativePath: './a', specifiers: new Map(), depth: 0 },
        },
      });
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB, c: modC, d: modD })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      // With back-edge (c→a) excluded: mod-a fanIn=1, stepCost(a)=1+log₂(1)=1
      // Chain: mod-a(depth 2) → mod-b(depth 1) → mod-c(depth 0)
      // mod-d depth = stepCost(a) + depth(a) = 1 + 2 = 3, weight = -3
      // Without exclusion: mod-a fanIn=2 (mod-d + back-edge from c), stepCost(a)=2
      // mod-d depth would be 2 + 2 = 4, weight = -4
      const weightD = result.nodes.find((n) => n.id === 'mod-d')?.data?.layoutWeight as number;
      expect(weightD).toBe(-3);
    });

    it('still assigns valid layer indices to nodes in a cycle', () => {
      // mod-a → mod-b → mod-a (cycle)
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'a', fullPath: './a', relativePath: './a', specifiers: new Map(), depth: 0 },
        },
      });
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      const layerA = result.nodes.find((n) => n.id === 'mod-a')?.data?.layerIndex;
      const layerB = result.nodes.find((n) => n.id === 'mod-b')?.data?.layerIndex;
      expect(typeof layerA).toBe('number');
      expect(typeof layerB).toBe('number');
      // Both should have valid non-negative layer indices
      expect(layerA).toBeGreaterThanOrEqual(0);
      expect(layerB).toBeGreaterThanOrEqual(0);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-folder edge annotation
  // -----------------------------------------------------------------------

  describe('cross-folder edge lifting', () => {
    it('lifts cross-folder module edges to folder→folder edges with type crossFolder', () => {
      // modA (src/a/) imports modB (src/b/) — different directories
      const modA = makeModule('mod-a', 'index.ts', 'pkg-1', 'src/a/index.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: '../b/index', relativePath: '../b/index', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'index.ts', 'pkg-1', 'src/b/index.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      // Cross-folder edge is lifted to folder level; no module→module edge exists
      const moduleLevelEdge = result.edges.find((e) => e.source === 'mod-a' && e.target === 'mod-b');
      expect(moduleLevelEdge).toBeUndefined();

      // Folder→folder edge is created
      const folderA = 'dir:app:src/a';
      const folderB = 'dir:app:src/b';
      const folderEdge = result.edges.find((e) => e.source === folderA && e.target === folderB);
      expect(folderEdge).toBeDefined();
      expect(folderEdge?.type).toBe('crossFolder');
    });

    it('does not lift edges between modules in the same directory', () => {
      // Both modules are in src/utils/ — same folder
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/utils/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', fullPath: './b', relativePath: './b', specifiers: new Map(), depth: 0 },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/utils/b.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      // Intra-folder: edge stays at module level, tagged as intraFolder
      const edge = result.edges.find((e) => e.source === 'mod-a' && e.target === 'mod-b');
      expect(edge).toBeDefined();
      expect(edge?.type).toBe('intraFolder');
    });

    it('deduplicates multiple module→module edges between the same folder pair', () => {
      // Two modules in src/a/ each import a module in src/b/
      const modA1 = makeModule('mod-a1', 'a1.ts', 'pkg-1', 'src/a/a1.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b1', fullPath: '../b/b1', relativePath: '../b/b1', specifiers: new Map(), depth: 0 },
        },
      });
      const modA2 = makeModule('mod-a2', 'a2.ts', 'pkg-1', 'src/a/a2.ts', {
        imports: {
          i2: { uuid: 'i2', name: 'b1', fullPath: '../b/b1', relativePath: '../b/b1', specifiers: new Map(), depth: 0 },
        },
      });
      const modB1 = makeModule('mod-b1', 'b1.ts', 'pkg-1', 'src/b/b1.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a1: modA1, a2: modA2, b1: modB1 })]);

      const result = buildOverviewGraph(defaultOptions({ data }));

      // Two module-level edges → one folder-level edge
      const folderA = 'dir:app:src/a';
      const folderB = 'dir:app:src/b';
      const folderEdges = result.edges.filter((e) => e.source === folderA && e.target === folderB);
      expect(folderEdges).toHaveLength(1);
      expect(folderEdges[0]?.data?.aggregatedCount).toBe(2);
    });
  });
});
