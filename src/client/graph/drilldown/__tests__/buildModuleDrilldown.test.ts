import { Position } from '@vue-flow/core';

import { buildModuleDrilldownGraph } from '../buildModuleDrilldown';

import type { BuildModuleDrilldownGraphOptions } from '../buildModuleDrilldown';
import type { DependencyNode } from '../../../types/DependencyNode';
import type { DependencyPackageGraph } from '../../../types/DependencyPackageGraph';
import type { GraphEdge } from '../../../types/GraphEdge';
import type { PackageStructure } from '../../../types/PackageStructure';
import type { ModuleStructure } from '../../../types/ModuleStructure';

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

function makeEdge(id: string, source: string, target: string, type?: string): GraphEdge {
  return {
    id,
    source,
    target,
    hidden: false,
    data: { type },
  } as GraphEdge;
}

function defaultOptions(overrides: Partial<BuildModuleDrilldownGraphOptions> = {}): BuildModuleDrilldownGraphOptions {
  return {
    data: makeGraph({}),
    selectedNode: makeNode('mod-1'),
    currentNodes: [],
    currentEdges: [],
    direction: 'LR',
    enabledRelationshipTypes: ['import', 'inheritance', 'implements', 'contains'],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('buildModuleDrilldownGraph', () => {
  describe('when module is not found in data', () => {
    it('returns only the selected node with empty edges', () => {
      const selected = makeNode('missing-module');
      const result = buildModuleDrilldownGraph(
        defaultOptions({ selectedNode: selected })
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.id).toBe('missing-module');
      expect(result.edges).toHaveLength(0);
    });
  });

  describe('with empty module (no classes or interfaces)', () => {
    it('returns the selected node styled as drilldown focus', () => {
      const mod = makeModule({ id: 'mod-1', name: 'index.ts' });
      const selected = makeNode('mod-1');
      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: selected,
        })
      );

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(0);

      const focusNode = result.nodes[0]!;
      expect(focusNode.id).toBe('mod-1');
      expect(focusNode.sourcePosition).toBe(Position.Right);
      expect(focusNode.targetPosition).toBe(Position.Left);
      // The focus node gets a cyan highlight border
      expect(focusNode.style).toEqual(
        expect.objectContaining({ borderWidth: '3px', borderColor: '#00ffff' })
      );
    });
  });

  describe('with classes', () => {
    it('creates detailed symbol nodes for each class', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'models.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'UserModel',
            properties: [{ name: 'name', type: 'string', visibility: 'public' }],
            methods: [{ name: 'save', returnType: 'void', visibility: 'public', signature: 'save(): void' }],
          },
        },
      });

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1'),
        })
      );

      // selected module + class node
      expect(result.nodes).toHaveLength(2);
      const classNode = result.nodes.find((n) => n.id === 'cls-1');
      expect(classNode).toBeDefined();
      expect(classNode!.type).toBe('class');
      expect(classNode!.data.label).toBe('UserModel');
      expect(classNode!.data.properties).toEqual([
        expect.objectContaining({ name: 'name', type: 'string' }),
      ]);
      expect(classNode!.data.methods).toEqual([
        expect.objectContaining({ name: 'save', returnType: 'void' }),
      ]);
    });

    it('adds inheritance edge when class has extends_id', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'models.ts',
        classes: {
          'cls-1': { id: 'cls-1', name: 'Child', extends_id: 'cls-parent' },
          'cls-parent': { id: 'cls-parent', name: 'Parent' },
        },
      });

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1'),
        })
      );

      const inheritanceEdges = result.edges.filter((e) => e.data?.type === 'inheritance');
      expect(inheritanceEdges).toHaveLength(1);
      expect(inheritanceEdges[0]!.source).toBe('cls-1');
      expect(inheritanceEdges[0]!.target).toBe('cls-parent');
    });

    it('adds implements edges for implemented interfaces', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'models.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'Service',
            implemented_interfaces: {
              'iface-1': { id: 'iface-1', name: 'IService' },
              'iface-2': { id: 'iface-2', name: 'IDisposable' },
            },
          },
        },
        interfaces: {
          'iface-1': { id: 'iface-1', name: 'IService' },
          'iface-2': { id: 'iface-2', name: 'IDisposable' },
        },
      });

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1'),
        })
      );

      const implementsEdges = result.edges.filter((e) => e.data?.type === 'implements');
      expect(implementsEdges).toHaveLength(2);
      const targets = implementsEdges.map((e) => e.target).sort();
      expect(targets).toEqual(['iface-1', 'iface-2']);
    });
  });

  describe('with interfaces', () => {
    it('creates detailed symbol nodes for each interface', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'types.ts',
        interfaces: {
          'iface-1': {
            id: 'iface-1',
            name: 'IUser',
            properties: [{ name: 'email', type: 'string', visibility: 'public' }],
          },
        },
      });

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1'),
        })
      );

      expect(result.nodes).toHaveLength(2);
      const ifaceNode = result.nodes.find((n) => n.id === 'iface-1');
      expect(ifaceNode).toBeDefined();
      expect(ifaceNode!.type).toBe('interface');
      expect(ifaceNode!.data.label).toBe('IUser');
    });

    it('adds inheritance edges for extended interfaces', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'types.ts',
        interfaces: {
          'iface-1': {
            id: 'iface-1',
            name: 'IExtended',
            extended_interfaces: {
              'iface-base': { id: 'iface-base', name: 'IBase' },
            },
          },
          'iface-base': { id: 'iface-base', name: 'IBase' },
        },
      });

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1'),
        })
      );

      const inheritanceEdges = result.edges.filter((e) => e.data?.type === 'inheritance');
      expect(inheritanceEdges).toHaveLength(1);
      expect(inheritanceEdges[0]!.source).toBe('iface-1');
      expect(inheritanceEdges[0]!.target).toBe('iface-base');
    });
  });

  describe('connected module discovery', () => {
    it('includes outgoing connected modules with blue highlight', () => {
      const mod = makeModule({ id: 'mod-1', name: 'a.ts' });
      const modB = makeModule({ id: 'mod-2', name: 'b.ts' });
      const selected = makeNode('mod-1');
      const nodeB = makeNode('mod-2');

      const outgoingEdge = makeEdge('e1', 'mod-1', 'mod-2', 'import');

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod, 'mod-2': modB }),
          selectedNode: selected,
          currentNodes: [selected, nodeB],
          currentEdges: [outgoingEdge],
        })
      );

      const connectedNode = result.nodes.find((n) => n.id === 'mod-2');
      expect(connectedNode).toBeDefined();
      expect(connectedNode!.style).toEqual(
        expect.objectContaining({ borderWidth: '2px', borderColor: '#61dafb' })
      );

      // The outgoing edge gets blue stroke and animated
      const outEdge = result.edges.find((e) => e.source === 'mod-1' && e.target === 'mod-2');
      expect(outEdge).toBeDefined();
      expect(outEdge!.style).toEqual(expect.objectContaining({ stroke: '#61dafb', strokeWidth: 3 }));
      expect(outEdge!.animated).toBe(true);
    });

    it('includes incoming connected modules with gold highlight', () => {
      const mod = makeModule({ id: 'mod-1', name: 'a.ts' });
      const modC = makeModule({ id: 'mod-3', name: 'c.ts' });
      const selected = makeNode('mod-1');
      const nodeC = makeNode('mod-3');

      const incomingEdge = makeEdge('e2', 'mod-3', 'mod-1', 'import');

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod, 'mod-3': modC }),
          selectedNode: selected,
          currentNodes: [selected, nodeC],
          currentEdges: [incomingEdge],
        })
      );

      const connectedNode = result.nodes.find((n) => n.id === 'mod-3');
      expect(connectedNode).toBeDefined();

      // The incoming edge gets gold stroke and animated
      const inEdge = result.edges.find((e) => e.source === 'mod-3' && e.target === 'mod-1');
      expect(inEdge).toBeDefined();
      expect(inEdge!.style).toEqual(expect.objectContaining({ stroke: '#ffd700', strokeWidth: 3 }));
      expect(inEdge!.animated).toBe(true);
    });

    it('skips connected modules not in currentNodes', () => {
      const mod = makeModule({ id: 'mod-1', name: 'a.ts' });
      const selected = makeNode('mod-1');

      // Edge references mod-99 which is not in currentNodes
      const danglingEdge = makeEdge('e1', 'mod-1', 'mod-99', 'import');

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: selected,
          currentNodes: [selected],
          currentEdges: [danglingEdge],
        })
      );

      // Only the selected module, no mod-99 node
      const nodeIds = result.nodes.map((n) => n.id);
      expect(nodeIds).not.toContain('mod-99');
    });
  });

  describe('edge visibility filtering', () => {
    it('hides edges whose type is not in enabledRelationshipTypes', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'models.ts',
        classes: {
          'cls-1': { id: 'cls-1', name: 'Child', extends_id: 'cls-parent' },
          'cls-parent': { id: 'cls-parent', name: 'Parent' },
        },
      });

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1'),
          enabledRelationshipTypes: [], // nothing enabled
        })
      );

      const inheritanceEdges = result.edges.filter((e) => e.data?.type === 'inheritance');
      expect(inheritanceEdges.length).toBeGreaterThan(0);
      // All inheritance edges should be hidden since not in enabled types
      expect(inheritanceEdges.every((e) => e.hidden)).toBe(true);
    });

    it('keeps edges visible when their type is enabled', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'models.ts',
        classes: {
          'cls-1': { id: 'cls-1', name: 'Child', extends_id: 'cls-parent' },
          'cls-parent': { id: 'cls-parent', name: 'Parent' },
        },
      });

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1'),
          enabledRelationshipTypes: ['inheritance'],
        })
      );

      const inheritanceEdges = result.edges.filter((e) => e.data?.type === 'inheritance');
      expect(inheritanceEdges.length).toBeGreaterThan(0);
      expect(inheritanceEdges.every((e) => !e.hidden)).toBe(true);
    });
  });

  describe('direction parameter', () => {
    it('applies TB direction positions to nodes', () => {
      const mod = makeModule({ id: 'mod-1', name: 'index.ts' });
      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod }),
          selectedNode: makeNode('mod-1'),
          direction: 'TB',
        })
      );

      const focusNode = result.nodes[0]!;
      expect(focusNode.sourcePosition).toBe(Position.Bottom);
      expect(focusNode.targetPosition).toBe(Position.Top);
    });
  });

  describe('complex scenario with multiple classes, interfaces, and connections', () => {
    it('builds a full drilldown graph with all entity types', () => {
      const mod = makeModule({
        id: 'mod-1',
        name: 'app.ts',
        classes: {
          'cls-1': {
            id: 'cls-1',
            name: 'AppService',
            extends_id: 'cls-2',
            implemented_interfaces: {
              'iface-1': { id: 'iface-1', name: 'IApp' },
            },
            properties: [
              { name: 'config', type: 'Config', visibility: 'private' },
            ],
            methods: [
              { name: 'start', returnType: 'Promise<void>', visibility: 'public', signature: 'start(): Promise<void>' },
            ],
          },
          'cls-2': {
            id: 'cls-2',
            name: 'BaseService',
          },
        },
        interfaces: {
          'iface-1': {
            id: 'iface-1',
            name: 'IApp',
            extended_interfaces: {
              'iface-2': { id: 'iface-2', name: 'IBase' },
            },
            properties: [
              { name: 'version', type: 'string', visibility: 'public' },
            ],
          },
          'iface-2': {
            id: 'iface-2',
            name: 'IBase',
          },
        },
      });

      const modB = makeModule({ id: 'mod-2', name: 'utils.ts' });
      const selected = makeNode('mod-1');
      const nodeB = makeNode('mod-2');

      const importEdge = makeEdge('e1', 'mod-1', 'mod-2', 'import');

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod, 'mod-2': modB }),
          selectedNode: selected,
          currentNodes: [selected, nodeB],
          currentEdges: [importEdge],
        })
      );

      // mod-1 (focus) + cls-1 + cls-2 + iface-1 + iface-2 + mod-2 (connected) = 6 nodes
      expect(result.nodes).toHaveLength(6);

      const nodeTypes = result.nodes.map((n) => n.type);
      expect(nodeTypes.filter((t) => t === 'class')).toHaveLength(2);
      expect(nodeTypes.filter((t) => t === 'interface')).toHaveLength(2);

      // Edges: cls-1->cls-2 (inheritance), cls-1->iface-1 (implements),
      //        iface-1->iface-2 (inheritance), mod-1->mod-2 (import)
      expect(result.edges.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('edge style resolution', () => {
    it('resolves function-based edge styles', () => {
      const mod = makeModule({ id: 'mod-1', name: 'a.ts' });
      const modB = makeModule({ id: 'mod-2', name: 'b.ts' });
      const selected = makeNode('mod-1');
      const nodeB = makeNode('mod-2');

      const edgeWithFnStyle = {
        id: 'e1',
        source: 'mod-1',
        target: 'mod-2',
        hidden: false,
        data: { type: 'import' },
        style: () => ({ stroke: '#aaa' }),
      } as unknown as GraphEdge;

      const result = buildModuleDrilldownGraph(
        defaultOptions({
          data: makeGraph({ 'mod-1': mod, 'mod-2': modB }),
          selectedNode: selected,
          currentNodes: [selected, nodeB],
          currentEdges: [edgeWithFnStyle],
        })
      );

      const outEdge = result.edges.find((e) => e.source === 'mod-1' && e.target === 'mod-2');
      expect(outEdge).toBeDefined();
      // Should have spread the resolved style plus the outgoing override
      expect(outEdge!.style).toEqual(
        expect.objectContaining({ stroke: '#61dafb', strokeWidth: 3 })
      );
    });
  });
});
