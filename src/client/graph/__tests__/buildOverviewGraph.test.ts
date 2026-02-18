import { buildOverviewGraph } from '../buildOverviewGraph';

import type { BuildOverviewGraphOptions } from '../buildOverviewGraph';
import type { DependencyPackageGraph } from '../../types/DependencyPackageGraph';
import type { ModuleStructure } from '../../types/ModuleStructure';
import type { PackageStructure } from '../../types/PackageStructure';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultOptions(overrides: Partial<BuildOverviewGraphOptions> = {}): BuildOverviewGraphOptions {
  return {
    data: { packages: [] },
    enabledNodeTypes: ['module'],
    enabledRelationshipTypes: ['import'],
    direction: 'LR',
    clusterByFolder: false,
    collapseScc: false,
    collapsedFolderIds: new Set(),
    hideTestFiles: false,
    memberNodeMode: 'compact',
    highlightOrphanGlobal: false,
    ...overrides,
  };
}

function makeModule(id: string, name: string, packageId: string, relativePath: string, extra: Partial<ModuleStructure> = {}): ModuleStructure {
  return {
    id,
    name,
    package_id: packageId,
    source: { relativePath },
    ...extra,
  };
}

function makePackage(id: string, name: string, modules: Record<string, ModuleStructure> = {}): PackageStructure {
  return {
    id,
    name,
    version: '1.0.0',
    path: `/${name}`,
    created_at: '2024-01-01T00:00:00.000Z',
    modules,
  };
}

function makeGraph(packages: PackageStructure[]): DependencyPackageGraph {
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
      const pkg = makePackage('pkg-1', 'empty-pkg');
      delete pkg.modules;

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
    it('creates a single module node with orphan diagnostics', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const pkg = makePackage('pkg-1', 'my-app', { 'mod-1': mod });

      const result = buildOverviewGraph(defaultOptions({ data: makeGraph([pkg]) }));

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]?.id).toBe('mod-1');
      expect(result.nodes[0]?.type).toBe('module');
      expect(result.nodes[0]?.data?.label).toBe('index.ts');
      expect(result.edges).toHaveLength(0);
    });

    it('annotates a single node as an orphan (no edges at all)', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const pkg = makePackage('pkg-1', 'my-app', { 'mod-1': mod });

      const result = buildOverviewGraph(defaultOptions({ data: makeGraph([pkg]) }));

      const node = result.nodes[0];
      expect(node?.data?.diagnostics?.orphanCurrent).toBe(true);
      expect(node?.data?.diagnostics?.orphanGlobal).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple modules with imports
  // -----------------------------------------------------------------------

  describe('multiple modules with import edges', () => {
    function twoModuleGraph(): DependencyPackageGraph {
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: {
          i1: { uuid: 'i1', name: 'b', path: './b' },
        },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts');
      return makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);
    }

    it('creates nodes for both modules', () => {
      const result = buildOverviewGraph(defaultOptions({ data: twoModuleGraph() }));

      expect(result.nodes).toHaveLength(2);
      const nodeIds = result.nodes.map((n) => n.id).sort();
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
    function graphWithImportEdge(): DependencyPackageGraph {
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts', {
        imports: { i1: { uuid: 'i1', name: 'b', path: './b' } },
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
    function graphWithTestModule(): DependencyPackageGraph {
      const modMain = makeModule('mod-main', 'main.ts', 'pkg-1', 'src/main.ts');
      const modTest = makeModule('mod-test', 'main.test.ts', 'pkg-1', 'src/main.test.ts');
      return makeGraph([makePackage('pkg-1', 'app', { main: modMain, test: modTest })]);
    }

    it('includes test modules when hideTestFiles is false', () => {
      const result = buildOverviewGraph(
        defaultOptions({ data: graphWithTestModule(), hideTestFiles: false })
      );

      const ids = result.nodes.map((n) => n.id);
      expect(ids).toContain('mod-main');
      expect(ids).toContain('mod-test');
    });

    it('excludes test modules when hideTestFiles is true', () => {
      const result = buildOverviewGraph(
        defaultOptions({ data: graphWithTestModule(), hideTestFiles: true })
      );

      const ids = result.nodes.map((n) => n.id);
      expect(ids).toContain('mod-main');
      expect(ids).not.toContain('mod-test');
    });
  });

  // -----------------------------------------------------------------------
  // Package nodes
  // -----------------------------------------------------------------------

  describe('package nodes', () => {
    it('creates package nodes when "package" is in enabledNodeTypes', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const pkg = makePackage('pkg-1', 'my-app', { 'mod-1': mod });

      const result = buildOverviewGraph(
        defaultOptions({ data: makeGraph([pkg]), enabledNodeTypes: ['package', 'module'] })
      );

      const packageNode = result.nodes.find((n) => n.type === 'package');
      expect(packageNode).toBeDefined();
      expect(packageNode?.id).toBe('pkg-1');
      expect(packageNode?.data?.label).toBe('my-app');
    });

    it('does not create package nodes when "package" is not in enabledNodeTypes', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const pkg = makePackage('pkg-1', 'my-app', { 'mod-1': mod });

      const result = buildOverviewGraph(
        defaultOptions({ data: makeGraph([pkg]), enabledNodeTypes: ['module'] })
      );

      const packageNode = result.nodes.find((n) => n.type === 'package');
      expect(packageNode).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Class / interface nodes (graph mode)
  // -----------------------------------------------------------------------

  describe('class and interface nodes', () => {
    function graphWithClasses(): DependencyPackageGraph {
      const mod = makeModule('mod-1', 'service.ts', 'pkg-1', 'src/service.ts', {
        classes: {
          MyClass: {
            id: 'cls-1',
            name: 'MyClass',
            properties: [{ id: 'prop-1', name: 'value', type: 'string', visibility: 'public' }],
            methods: [{ id: 'meth-1', name: 'run', returnType: 'void', visibility: 'public', signature: 'run(): void' }],
          },
        },
        interfaces: {
          MyInterface: {
            id: 'iface-1',
            name: 'MyInterface',
            properties: [{ id: 'iprop-1', name: 'id', type: 'number', visibility: 'public' }],
            methods: [],
          },
        },
      });
      return makeGraph([makePackage('pkg-1', 'app', { mod: mod })]);
    }

    it('does not create class/interface VueFlow nodes in compact mode', () => {
      const result = buildOverviewGraph(
        defaultOptions({
          data: graphWithClasses(),
          enabledNodeTypes: ['module', 'class', 'interface'],
          memberNodeMode: 'compact',
        })
      );

      const classNode = result.nodes.find((n) => n.type === 'class');
      const ifaceNode = result.nodes.find((n) => n.type === 'interface');
      expect(classNode).toBeUndefined();
      expect(ifaceNode).toBeUndefined();
    });

    it('creates class/interface VueFlow nodes in graph mode when modules are excluded', () => {
      // When modules are not in enabledNodeTypes but class/interface are,
      // memberNodeMode is forced to 'graph' regardless of the option value
      const result = buildOverviewGraph(
        defaultOptions({
          data: graphWithClasses(),
          enabledNodeTypes: ['class', 'interface'],
          memberNodeMode: 'compact',
        })
      );

      const classNode = result.nodes.find((n) => n.type === 'class');
      const ifaceNode = result.nodes.find((n) => n.type === 'interface');
      expect(classNode).toBeDefined();
      expect(classNode?.id).toBe('cls-1');
      expect(classNode?.data?.label).toBe('MyClass');
      expect(ifaceNode).toBeDefined();
      expect(ifaceNode?.id).toBe('iface-1');
      expect(ifaceNode?.data?.label).toBe('MyInterface');
    });

    it('creates class/interface VueFlow nodes in graph mode with module containers', () => {
      const result = buildOverviewGraph(
        defaultOptions({
          data: graphWithClasses(),
          enabledNodeTypes: ['module', 'class', 'interface'],
          memberNodeMode: 'graph',
        })
      );

      const classNode = result.nodes.find((n) => n.type === 'class');
      const ifaceNode = result.nodes.find((n) => n.type === 'interface');
      const moduleNode = result.nodes.find((n) => n.type === 'module');

      expect(moduleNode).toBeDefined();
      expect(classNode).toBeDefined();
      expect(ifaceNode).toBeDefined();
      expect(classNode?.parentNode).toBe('mod-1');
      expect(ifaceNode?.parentNode).toBe('mod-1');
    });
  });

  // -----------------------------------------------------------------------
  // Folder clustering
  // -----------------------------------------------------------------------

  describe('folder clustering', () => {
    function multifolderGraph(): DependencyPackageGraph {
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a/a.ts', {
        imports: { i1: { uuid: 'i1', name: 'b', path: '../b/b' } },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b/b.ts');
      return makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);
    }

    it('creates group nodes when clusterByFolder is enabled', () => {
      const result = buildOverviewGraph(
        defaultOptions({ data: multifolderGraph(), clusterByFolder: true })
      );

      const groupNodes = result.nodes.filter((n) => n.type === 'group');
      expect(groupNodes.length).toBeGreaterThanOrEqual(1);
    });

    it('produces edge highways across folder boundaries', () => {
      const result = buildOverviewGraph(
        defaultOptions({
          data: multifolderGraph(),
          clusterByFolder: true,
          enabledRelationshipTypes: ['import'],
        })
      );

      const highwayEdges = result.edges.filter((e) => e.data?.highwaySegment === 'highway');
      expect(highwayEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('does not create group nodes when clusterByFolder is false', () => {
      const result = buildOverviewGraph(
        defaultOptions({ data: multifolderGraph(), clusterByFolder: false })
      );

      const groupNodes = result.nodes.filter((n) => n.type === 'group');
      expect(groupNodes).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Multiple packages
  // -----------------------------------------------------------------------

  describe('multiple packages', () => {
    it('creates nodes from all packages', () => {
      const modA = makeModule('mod-a', 'a.ts', 'pkg-1', 'src/a.ts');
      const modB = makeModule('mod-b', 'b.ts', 'pkg-2', 'src/b.ts');
      const pkg1 = makePackage('pkg-1', 'lib-a', { a: modA });
      const pkg2 = makePackage('pkg-2', 'lib-b', { b: modB });

      const result = buildOverviewGraph(
        defaultOptions({ data: makeGraph([pkg1, pkg2]) })
      );

      expect(result.nodes).toHaveLength(2);
      const nodeIds = result.nodes.map((n) => n.id).sort();
      expect(nodeIds).toEqual(['mod-a', 'mod-b']);
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
        expect(result.nodes).toHaveLength(1);
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
        imports: { i1: { uuid: 'i1', name: 'b', path: './b' } },
      });
      const modB = makeModule('mod-b', 'b.ts', 'pkg-1', 'src/b.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { a: modA, b: modB })]);

      const result = buildOverviewGraph(
        defaultOptions({ data, enabledRelationshipTypes: [] })
      );

      // All edges are hidden, so current = orphan; but globally there is an edge
      for (const node of result.nodes) {
        expect(node.data?.diagnostics?.orphanCurrent).toBe(true);
        expect(node.data?.diagnostics?.orphanGlobal).toBe(false);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Node type filtering
  // -----------------------------------------------------------------------

  describe('node type filtering', () => {
    it('returns no nodes when enabledNodeTypes is empty', () => {
      const mod = makeModule('mod-1', 'index.ts', 'pkg-1', 'src/index.ts');
      const data = makeGraph([makePackage('pkg-1', 'app', { m: mod })]);

      const result = buildOverviewGraph(defaultOptions({ data, enabledNodeTypes: [] }));

      expect(result.nodes).toHaveLength(0);
      expect(result.edges).toHaveLength(0);
    });
  });
});
