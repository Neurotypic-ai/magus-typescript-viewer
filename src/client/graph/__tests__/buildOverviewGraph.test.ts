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

    it('keeps direct module-to-module edges across folder boundaries', () => {
      const result = buildOverviewGraph(
        defaultOptions({
          data: multifolderGraph(),
          enabledRelationshipTypes: ['import'],
        })
      );

      expect(result.edges.some((edge) => 'highwaySegment' in (edge.data ?? {}))).toBe(false);
      expect(
        result.edges.some((edge) => edge.source === 'mod-a' && edge.target === 'mod-b' && edge.data?.type === 'import')
      ).toBe(true);
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
    it('assigns positive layoutWeight to heavily-imported foundation modules and negative to consumer modules', () => {
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
      // mod-a has 1 outgoing import, 0 incoming → weight = 0 - 1 = -1 (consumer)
      expect(nodeA?.data?.layoutWeight).toBe(-1);
      // mod-b has 0 outgoing, 1 incoming → weight = 1 - 0 = +1 (foundation)
      expect(nodeB?.data?.layoutWeight).toBe(1);
    });

    it('assigns aggregated layoutWeight to folder group nodes', () => {
      // Same two-module graph: mod-a imports mod-b, both in the same folder (src/)
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
      // sum of children weights: +1 + (-1) = 0
      expect(groupNode?.data?.layoutWeight).toBe(0);
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
});
