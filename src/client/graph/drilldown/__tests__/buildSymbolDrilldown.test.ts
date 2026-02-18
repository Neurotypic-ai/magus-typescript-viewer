import { Position } from '@vue-flow/core';

import { buildSymbolDrilldownGraph } from '../buildSymbolDrilldown';

import type { BuildSymbolDrilldownGraphOptions } from '../buildSymbolDrilldown';
import type { DependencyNode } from '../../../types/DependencyNode';
import type { DependencyPackageGraph } from '../../../types/DependencyPackageGraph';
import type { ModuleStructure } from '../../../types/ModuleStructure';
import type { PackageStructure } from '../../../types/PackageStructure';

/* ------------------------------------------------------------------ */
/*  Helpers to build minimal test data                                 */
/* ------------------------------------------------------------------ */

function makeModule(overrides: Partial<ModuleStructure> & { id: string; name: string }): ModuleStructure {
  return {
    package_id: 'pkg-1',
    source: { relativePath: 'src/index.ts' },
    ...overrides,
  };
}

function makePackage(modules: Record<string, ModuleStructure>): PackageStructure {
  return {
    id: 'pkg-1',
    name: 'test-pkg',
    version: '1.0.0',
    path: '/test',
    created_at: '2024-01-01',
    modules,
  };
}

function makeGraph(modules: Record<string, ModuleStructure>): DependencyPackageGraph {
  return { packages: [makePackage(modules)] };
}

function makeNode(id: string, type: string = 'module'): DependencyNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: { label: id },
  } as DependencyNode;
}

function defaultOptions(overrides: Partial<BuildSymbolDrilldownGraphOptions> = {}): BuildSymbolDrilldownGraphOptions {
  return {
    data: makeGraph({}),
    selectedNode: makeNode('mod-1'),
    direction: 'LR',
    enabledRelationshipTypes: ['import', 'inheritance', 'implements', 'contains', 'uses'],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('buildSymbolDrilldownGraph', () => {
  describe('when symbol context is not found', () => {
    it('returns only the selected node with empty edges', () => {
      const selected = makeNode('nonexistent', 'module');
      const result = buildSymbolDrilldownGraph(
        defaultOptions({ selectedNode: selected })
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.id).toBe('nonexistent');
      expect(result.edges).toHaveLength(0);
    });

    it('returns fallback for unknown class node type', () => {
      const mod = makeModule({ id: 'mod-1', name: 'a.ts' });
      const selected = makeNode('cls-missing', 'class');
      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: selected,
        })
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.id).toBe('cls-missing');
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('module-level drilldown', () => {
    it('creates a module node as the root', () => {
      const mod = makeModule({ id: 'mod-1', name: 'index.ts' });
      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
        })
      );

      expect(result.nodes.length).toBeGreaterThanOrEqual(1);
      const moduleNode = result.nodes.find((n) => n.id === 'mod-1');
      expect(moduleNode).toBeDefined();
      expect(moduleNode!.type).toBe('module');
      expect(moduleNode!.data.label).toBe('index.ts');
      expect(moduleNode!.style).toEqual(
        expect.objectContaining({ borderColor: '#00ffff', borderWidth: '3px' })
      );
    });

    it('includes all classes when focus is module', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'models.ts',
        classes: {
          'cls-1': { id: 'cls-1', name: 'Alpha' },
          'cls-2': { id: 'cls-2', name: 'Beta' },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
        })
      );

      const classNodes = result.nodes.filter((n) => n.type === 'class');
      expect(classNodes).toHaveLength(2);
      const names = classNodes.map((n) => n.data.label).sort();
      expect(names).toEqual(['Alpha', 'Beta']);
    });

    it('includes all interfaces when focus is module', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'types.ts',
        interfaces: {
          'iface-1': { id: 'iface-1', name: 'IFoo' },
          'iface-2': { id: 'iface-2', name: 'IBar' },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
        })
      );

      const ifaceNodes = result.nodes.filter((n) => n.type === 'interface');
      expect(ifaceNodes).toHaveLength(2);
    });

    it('creates "contains" edges from module to each symbol', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'app.ts',
        classes: {
          'cls-1': { id: 'cls-1', name: 'App' },
        },
        interfaces: {
          'iface-1': { id: 'iface-1', name: 'IApp' },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
        })
      );

      const containsEdges = result.edges.filter((e) => e.data?.type === 'contains');
      expect(containsEdges).toHaveLength(2);
      expect(containsEdges.every((e) => e.source === 'mod-1')).toBe(true);
      const targets = containsEdges.map((e) => e.target).sort();
      expect(targets).toEqual(['cls-1', 'iface-1']);
    });
  });

  describe('class-level drilldown', () => {
    it('only includes the focused class, not other classes in the module', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'models.ts',
        classes: {
          'cls-1': { id: 'cls-1', name: 'Focused' },
          'cls-2': { id: 'cls-2', name: 'Other' },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('cls-1', 'class'),
        })
      );

      const classNodes = result.nodes.filter((n) => n.type === 'class');
      expect(classNodes).toHaveLength(1);
      expect(classNodes[0]!.data.label).toBe('Focused');
    });

    it('expands class properties into member nodes', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'models.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'User',
            properties: [
              { name: 'id', type: 'number', visibility: 'public' },
              { name: 'name', type: 'string', visibility: 'private' },
            ],
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('cls-1', 'class'),
        })
      );

      const propertyNodes = result.nodes.filter((n) => n.type === 'property');
      expect(propertyNodes).toHaveLength(2);
      const labels = propertyNodes.map((n) => n.data.label).sort();
      expect(labels).toEqual(['id: number', 'name: string']);
    });

    it('expands class methods into member nodes', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'models.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'Service',
            methods: [
              { name: 'init', returnType: 'void', visibility: 'public', signature: 'init(): void' },
              { name: 'run', returnType: 'Promise<void>', visibility: 'protected', signature: 'run(): Promise<void>' },
            ],
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('cls-1', 'class'),
        })
      );

      const methodNodes = result.nodes.filter((n) => n.type === 'method');
      expect(methodNodes).toHaveLength(2);
      const labels = methodNodes.map((n) => n.data.label).sort();
      expect(labels).toEqual(['init(): void', 'run(): Promise<void>']);
    });

    it('creates "contains" edges from class to property and method members', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'models.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'Widget',
            properties: [{ name: 'color', type: 'string', visibility: 'public' }],
            methods: [{ name: 'render', returnType: 'void', visibility: 'public', signature: 'render(): void' }],
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('cls-1', 'class'),
        })
      );

      // module->class contains + class->property contains + class->method contains = 3
      const containsEdges = result.edges.filter((e) => e.data?.type === 'contains');
      expect(containsEdges).toHaveLength(3);

      // One from module to class
      const moduleToClass = containsEdges.filter((e) => e.source === 'mod-1');
      expect(moduleToClass).toHaveLength(1);

      // Two from class to members
      const classToMembers = containsEdges.filter((e) => e.source === 'cls-1');
      expect(classToMembers).toHaveLength(2);
    });
  });

  describe('interface-level drilldown', () => {
    it('only includes the focused interface', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'types.ts',
        interfaces: {
          'iface-1': { id: 'iface-1', name: 'IFocused' },
          'iface-2': { id: 'iface-2', name: 'IOther' },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('iface-1', 'interface'),
        })
      );

      const ifaceNodes = result.nodes.filter((n) => n.type === 'interface');
      expect(ifaceNodes).toHaveLength(1);
      expect(ifaceNodes[0]!.data.label).toBe('IFocused');
    });

    it('expands interface properties and methods into member nodes', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'types.ts',
        interfaces: {
          'iface-1': {
            id: 'iface-1',
            name: 'IConfig',
            properties: [{ name: 'port', type: 'number', visibility: 'public' }],
            methods: [{ name: 'validate', returnType: 'boolean', visibility: 'public', signature: 'validate(): boolean' }],
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('iface-1', 'interface'),
        })
      );

      const propertyNodes = result.nodes.filter((n) => n.type === 'property');
      expect(propertyNodes).toHaveLength(1);
      expect(propertyNodes[0]!.data.label).toBe('port: number');

      const methodNodes = result.nodes.filter((n) => n.type === 'method');
      expect(methodNodes).toHaveLength(1);
      expect(methodNodes[0]!.data.label).toBe('validate(): boolean');
    });
  });

  describe('symbol_references (usage edges)', () => {
    it('creates usage edges for symbol references within the module', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'app.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'App',
            methods: [
              { id: 'meth-1', name: 'run', returnType: 'void', visibility: 'public', signature: 'run(): void' },
            ],
          },
        },
        symbol_references: {
          'ref-1': {
            id: 'ref-1',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            source_symbol_id: 'cls-1',
            source_symbol_type: 'class',
            source_symbol_name: 'App',
            target_symbol_id: 'meth-1',
            target_symbol_type: 'method',
            target_symbol_name: 'run',
            access_kind: 'method' as const,
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
        })
      );

      const usageEdges = result.edges.filter((e) => e.data?.type === 'uses');
      expect(usageEdges).toHaveLength(1);
      expect(usageEdges[0]!.source).toBe('cls-1');
      expect(usageEdges[0]!.target).toBe('meth-1');
      expect(usageEdges[0]!.data?.usageKind).toBe('method');
    });

    it('skips references with targets not in the node set', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'app.ts',
        classes: {
          'cls-1': { id: 'cls-1', name: 'App' },
        },
        symbol_references: {
          'ref-1': {
            id: 'ref-1',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            source_symbol_id: 'cls-1',
            source_symbol_type: 'class',
            source_symbol_name: 'App',
            target_symbol_id: 'unknown-target',
            target_symbol_type: 'method',
            target_symbol_name: 'unknown',
            access_kind: 'method' as const,
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
        })
      );

      const usageEdges = result.edges.filter((e) => e.data?.type === 'uses');
      expect(usageEdges).toHaveLength(0);
    });

    it('uses module id as source when source_symbol_id is undefined', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'app.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'App',
            properties: [
              { id: 'prop-1', name: 'flag', type: 'boolean', visibility: 'public' },
            ],
          },
        },
        symbol_references: {
          'ref-1': {
            id: 'ref-1',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            source_symbol_id: undefined,
            source_symbol_type: 'module',
            source_symbol_name: undefined,
            target_symbol_id: 'prop-1',
            target_symbol_type: 'property',
            target_symbol_name: 'flag',
            access_kind: 'property' as const,
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
        })
      );

      const usageEdges = result.edges.filter((e) => e.data?.type === 'uses');
      expect(usageEdges).toHaveLength(1);
      expect(usageEdges[0]!.source).toBe('mod-1');
      expect(usageEdges[0]!.target).toBe('prop-1');
      expect(usageEdges[0]!.data?.usageKind).toBe('property');
    });

    it('skips references from sources not included in the focused view', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'app.ts',
        classes: {
          'cls-1': { id: 'cls-1', name: 'Focused' },
          'cls-2': {
            id: 'cls-2',
            name: 'Other',
            methods: [
              { id: 'meth-2', name: 'doThing', returnType: 'void', visibility: 'public', signature: 'doThing(): void' },
            ],
          },
        },
        symbol_references: {
          'ref-1': {
            id: 'ref-1',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            source_symbol_id: 'cls-2',
            source_symbol_type: 'class',
            source_symbol_name: 'Other',
            target_symbol_id: 'meth-2',
            target_symbol_type: 'method',
            target_symbol_name: 'doThing',
            access_kind: 'method' as const,
          },
        },
      });

      // Focus on cls-1, so cls-2 is NOT in scope
      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('cls-1', 'class'),
        })
      );

      const usageEdges = result.edges.filter((e) => e.data?.type === 'uses');
      expect(usageEdges).toHaveLength(0);
    });
  });

  describe('edge visibility filtering', () => {
    it('hides non-enabled edge types', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'app.ts',
        classes: {
          'cls-1': { id: 'cls-1', name: 'App' },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
          enabledRelationshipTypes: [], // nothing enabled
        })
      );

      // "contains" and "uses" edges are always visible regardless of enabled types
      const containsEdges = result.edges.filter((e) => e.data?.type === 'contains');
      expect(containsEdges.every((e) => !e.hidden)).toBe(true);
    });

    it('keeps "uses" and "contains" edges always visible', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'app.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'App',
            methods: [
              { id: 'meth-1', name: 'run', returnType: 'void', visibility: 'public', signature: 'run(): void' },
            ],
          },
        },
        symbol_references: {
          'ref-1': {
            id: 'ref-1',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            source_symbol_id: 'cls-1',
            source_symbol_type: 'class',
            source_symbol_name: 'App',
            target_symbol_id: 'meth-1',
            target_symbol_type: 'method',
            target_symbol_name: 'run',
            access_kind: 'method' as const,
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
          enabledRelationshipTypes: [], // nothing explicitly enabled
        })
      );

      const usesEdges = result.edges.filter((e) => e.data?.type === 'uses');
      expect(usesEdges.every((e) => !e.hidden)).toBe(true);

      const containsEdges = result.edges.filter((e) => e.data?.type === 'contains');
      expect(containsEdges.every((e) => !e.hidden)).toBe(true);
    });
  });

  describe('direction parameter', () => {
    it('applies TB direction positions to nodes', () => {
      const mod = makeModule({ id: 'mod-1', name: 'index.ts' });
      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
          direction: 'TB',
        })
      );

      const moduleNode = result.nodes.find((n) => n.id === 'mod-1');
      expect(moduleNode).toBeDefined();
      expect(moduleNode!.sourcePosition).toBe(Position.Bottom);
      expect(moduleNode!.targetPosition).toBe(Position.Top);
    });

    it('applies RL direction positions', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'index.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'Test',
            properties: [{ name: 'x', type: 'number', visibility: 'public' }],
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('cls-1', 'class'),
          direction: 'RL',
        })
      );

      const classNode = result.nodes.find((n) => n.type === 'class');
      expect(classNode).toBeDefined();
      expect(classNode!.sourcePosition).toBe(Position.Left);
      expect(classNode!.targetPosition).toBe(Position.Right);

      // Member nodes also get RL positions
      const propNode = result.nodes.find((n) => n.type === 'property');
      expect(propNode).toBeDefined();
      expect(propNode!.sourcePosition).toBe(Position.Left);
      expect(propNode!.targetPosition).toBe(Position.Right);
    });
  });

  describe('complex scenario', () => {
    it('builds full module drilldown with classes, interfaces, members, and references', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'service.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'UserService',
            properties: [
              { id: 'prop-1', name: 'db', type: 'Database', visibility: 'private' },
            ],
            methods: [
              { id: 'meth-1', name: 'getUser', returnType: 'User', visibility: 'public', signature: 'getUser(id: string): User' },
              { id: 'meth-2', name: 'saveUser', returnType: 'void', visibility: 'public', signature: 'saveUser(user: User): void' },
            ],
          },
        },
        interfaces: {
          'iface-1': {
            id: 'iface-1',
            name: 'IUserService',
            methods: [
              { id: 'imeth-1', name: 'getUser', returnType: 'User', visibility: 'public', signature: 'getUser(id: string): User' },
            ],
          },
        },
        symbol_references: {
          'ref-1': {
            id: 'ref-1',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            source_symbol_id: 'cls-1',
            source_symbol_type: 'class',
            source_symbol_name: 'UserService',
            target_symbol_id: 'prop-1',
            target_symbol_type: 'property',
            target_symbol_name: 'db',
            access_kind: 'property' as const,
          },
          'ref-2': {
            id: 'ref-2',
            package_id: 'pkg-1',
            module_id: 'mod-1',
            source_symbol_id: 'cls-1',
            source_symbol_type: 'class',
            source_symbol_name: 'UserService',
            target_symbol_id: 'meth-1',
            target_symbol_type: 'method',
            target_symbol_name: 'getUser',
            access_kind: 'method' as const,
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
        })
      );

      // module + class + interface + 3 class members (prop, meth, meth) + 1 interface member (meth) = 7
      expect(result.nodes).toHaveLength(7);

      const containsEdges = result.edges.filter((e) => e.data?.type === 'contains');
      // mod->cls, mod->iface, cls->prop, cls->meth1, cls->meth2, iface->imeth1 = 6
      expect(containsEdges).toHaveLength(6);

      const usesEdges = result.edges.filter((e) => e.data?.type === 'uses');
      // cls-1->prop-1, cls-1->meth-1 = 2
      expect(usesEdges).toHaveLength(2);
    });
  });

  describe('member node IDs', () => {
    it('uses property.id when available', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'a.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'A',
            properties: [
              { id: 'custom-prop-id', name: 'x', type: 'number', visibility: 'public' },
            ],
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('cls-1', 'class'),
        })
      );

      const propNode = result.nodes.find((n) => n.type === 'property');
      expect(propNode).toBeDefined();
      expect(propNode!.id).toBe('custom-prop-id');
    });

    it('generates fallback ID from symbol and member name when id is missing', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'a.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'A',
            properties: [
              { name: 'y', type: 'string', visibility: 'public' },
            ],
            methods: [
              { name: 'doStuff', returnType: 'void', visibility: 'public', signature: 'doStuff(): void' },
            ],
          },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('cls-1', 'class'),
        })
      );

      const propNode = result.nodes.find((n) => n.type === 'property');
      expect(propNode).toBeDefined();
      expect(propNode!.id).toBe('cls-1:property:y');

      const methNode = result.nodes.find((n) => n.type === 'method');
      expect(methNode).toBeDefined();
      expect(methNode!.id).toBe('cls-1:method:doStuff');
    });
  });

  describe('empty inputs', () => {
    it('handles module with empty classes and interfaces', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'empty.ts',
        classes: {},
        interfaces: {},
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1', 'module'),
        })
      );

      // Only the module node
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.id).toBe('mod-1');
      expect(result.edges).toHaveLength(0);
    });

    it('handles class with no properties or methods', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'bare.ts',
        classes: {
          'cls-1': { id: 'cls-1', name: 'Bare' },
        },
      });

      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('cls-1', 'class'),
        })
      );

      // module + class, no member nodes
      expect(result.nodes).toHaveLength(2);
      const classNode = result.nodes.find((n) => n.type === 'class');
      expect(classNode).toBeDefined();
      expect(classNode!.data.properties).toEqual([]);
      expect(classNode!.data.methods).toEqual([]);
    });

    it('handles graph with empty packages array', () => {
      const data: DependencyPackageGraph = { packages: [] };
      const result = buildSymbolDrilldownGraph(
        defaultOptions({
          data,
          selectedNode: makeNode('anything', 'module'),
        })
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);
    });
  });
});
