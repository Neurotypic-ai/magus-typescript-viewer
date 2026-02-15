import { describe, expect, it } from 'vitest';

import { createGraphNodes } from '../createGraphNodes';

import type { DependencyPackageGraph } from '../../types/DependencyPackageGraph';

function createFixtureGraph(): DependencyPackageGraph {
  return {
    packages: [
      {
        id: 'pkg-1',
        name: 'app',
        version: '1.0.0',
        path: '/tmp/app',
        created_at: '2026-01-01T00:00:00.000Z',
        modules: {
          'module-a': {
            id: 'module-a',
            name: 'AppModule',
            package_id: 'pkg-1',
            source: { relativePath: 'src/app/module-a.ts' },
            imports: {
              'imp-vue': {
                uuid: 'imp-vue',
                name: 'vue',
                path: 'vue',
                isExternal: true,
                packageName: 'vue',
                specifiers: [
                  { imported: 'ref', kind: 'value' },
                  { imported: 'computed', kind: 'value' },
                ],
              },
              'imp-local': {
                uuid: 'imp-local',
                name: './utils',
                path: './utils',
              },
            },
            classes: {
              AppService: {
                id: 'class-1',
                name: 'AppService',
                properties: [{ id: 'prop-1', name: 'state', type: 'string', visibility: 'private' }],
                methods: [{ id: 'method-1', name: 'load', returnType: 'void', visibility: 'public', signature: 'load(): void' }],
              },
            },
            interfaces: {
              AppContract: {
                id: 'iface-1',
                name: 'AppContract',
                properties: [{ id: 'iface-prop-1', name: 'id', type: 'string', visibility: 'public' }],
                methods: [{ id: 'iface-method-1', name: 'execute', returnType: 'void', visibility: 'public', signature: 'execute(): void' }],
              },
            },
          },
        },
      },
    ],
  };
}

describe('createGraphNodes', () => {
  it('embeds symbols in module node and adds external dependency summaries in compact mode', () => {
    const nodes = createGraphNodes(createFixtureGraph(), {
      includeModules: true,
      includeClasses: true,
      includeClassNodes: true,
      includeInterfaceNodes: true,
      nestSymbolsInModules: true,
    });

    // In compact mode (default), only module nodes exist — no class/interface VueFlow nodes.
    const moduleNode = nodes.find((node) => node.id === 'module-a');
    expect(moduleNode).toBeDefined();
    if (!moduleNode?.data) {
      throw new Error('Expected module node data');
    }

    // No VueFlow children in compact mode.
    expect(moduleNode.data.subnodes?.count).toBe(0);
    expect(moduleNode.data.isContainer).toBeFalsy();

    // Symbols are embedded as data on the module node.
    const symbols = moduleNode.data.symbols;
    expect(Array.isArray(symbols)).toBe(true);
    expect(symbols).toHaveLength(2);
    expect(symbols?.[0]?.name).toBe('AppService');
    expect(symbols?.[0]?.type).toBe('class');
    expect(symbols?.[0]?.properties).toHaveLength(1);
    expect(symbols?.[0]?.methods).toHaveLength(1);
    expect(symbols?.[1]?.name).toBe('AppContract');
    expect(symbols?.[1]?.type).toBe('interface');

    // No class/interface VueFlow nodes should exist.
    expect(nodes.find((node) => node.id === 'class-1')).toBeUndefined();
    expect(nodes.find((node) => node.id === 'iface-1')).toBeUndefined();

    // External dependencies should still be computed.
    const externalDependencies = moduleNode.data.externalDependencies;
    expect(Array.isArray(externalDependencies)).toBe(true);
    expect(externalDependencies?.[0]?.packageName).toBe('vue');
    expect(externalDependencies?.[0]?.symbols).toEqual(['computed', 'ref']);
    expect(moduleNode.data.diagnostics?.externalDependencyPackageCount).toBe(1);
    expect(moduleNode.data.diagnostics?.externalDependencySymbolCount).toBe(2);
  });

  it('creates class/interface VueFlow nodes with members metadata in graph mode', () => {
    const nodes = createGraphNodes(createFixtureGraph(), {
      includeModules: true,
      includeClasses: true,
      includeClassNodes: true,
      includeInterfaceNodes: true,
      nestSymbolsInModules: true,
      memberNodeMode: 'graph',
    });

    // Module node should be a container with VueFlow children.
    const moduleNode = nodes.find((node) => node.id === 'module-a');
    expect(moduleNode).toBeDefined();
    expect(moduleNode?.data?.isContainer).toBe(true);
    expect(moduleNode?.data?.subnodes?.count).toBe(2);

    // No embedded symbols in graph mode.
    expect(moduleNode?.data?.symbols).toBeUndefined();

    // Class node should exist as a child of the module.
    const classNode = nodes.find((node) => node.id === 'class-1');
    expect(classNode).toBeDefined();
    expect(classNode?.parentNode).toBe('module-a');
    expect(classNode?.draggable).toBe(true);
    if (!classNode?.data) {
      throw new Error('Expected class node data');
    }
    expect(classNode.data.collapsible).toBe(false);
    expect(classNode.data.members?.totalCount).toBe(2);
    expect(classNode.data.properties).toHaveLength(1);
    expect(classNode.data.methods).toHaveLength(1);

    // Interface node should exist as a child of the module.
    const interfaceNode = nodes.find((node) => node.id === 'iface-1');
    expect(interfaceNode).toBeDefined();
    expect(interfaceNode?.parentNode).toBe('module-a');
    expect(interfaceNode?.draggable).toBe(true);
    if (!interfaceNode?.data) {
      throw new Error('Expected interface node data');
    }
    expect(interfaceNode.data.collapsible).toBe(false);
    expect(interfaceNode.data.members?.totalCount).toBe(2);

    // No property/method VueFlow nodes in graph mode — members are shown
    // as collapsible sections inside class/interface nodes.
    const propertyNode = nodes.find((node) => node.type === 'property');
    const methodNode = nodes.find((node) => node.type === 'method');
    expect(propertyNode).toBeUndefined();
    expect(methodNode).toBeUndefined();
  });

  it('does not create class/interface VueFlow nodes in compact mode', () => {
    const nodes = createGraphNodes(createFixtureGraph(), {
      includeModules: true,
      includeClasses: true,
      includeClassNodes: true,
      includeInterfaceNodes: true,
      nestSymbolsInModules: true,
      memberNodeMode: 'compact',
    });

    // Only module nodes — no class, interface, property, or method VueFlow nodes.
    const nodeTypes = new Set(nodes.map((node) => node.type));
    expect(nodeTypes.has('module')).toBe(true);
    expect(nodeTypes.has('class')).toBe(false);
    expect(nodeTypes.has('interface')).toBe(false);
    expect(nodeTypes.has('property')).toBe(false);
    expect(nodeTypes.has('method')).toBe(false);
  });
});
