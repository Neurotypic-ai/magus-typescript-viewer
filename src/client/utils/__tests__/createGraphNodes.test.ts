import { describe, expect, it } from 'vitest';

import { createGraphNodes } from '../createGraphNodes';

import type { DependencyPackageGraph } from '../../components/DependencyGraph/types';

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
  it('adds module subnode metadata and external dependency summaries', () => {
    const nodes = createGraphNodes(createFixtureGraph(), {
      includeModules: true,
      includeClasses: true,
      includeClassNodes: true,
      includeInterfaceNodes: true,
      nestSymbolsInModules: true,
    });

    const moduleNode = nodes.find((node) => node.id === 'module-a');
    expect(moduleNode).toBeDefined();
    if (!moduleNode?.data) {
      throw new Error('Expected module node data');
    }
    expect(moduleNode.data.subnodes?.count).toBe(2);
    expect(moduleNode.data.subnodes?.totalCount).toBe(2);
    expect(moduleNode.data.subnodes?.hiddenCount).toBe(0);

    const externalDependencies = moduleNode.data.externalDependencies;
    expect(Array.isArray(externalDependencies)).toBe(true);
    expect(externalDependencies?.[0]?.packageName).toBe('vue');
    expect(externalDependencies?.[0]?.symbols).toEqual(['computed', 'ref']);
    expect(moduleNode.data.diagnostics?.externalDependencyPackageCount).toBe(1);
    expect(moduleNode.data.diagnostics?.externalDependencySymbolCount).toBe(2);
  });

  it('stores class/interface members as metadata in compact mode', () => {
    const nodes = createGraphNodes(createFixtureGraph(), {
      includeModules: true,
      includeClasses: true,
      includeClassNodes: true,
      includeInterfaceNodes: true,
      nestSymbolsInModules: true,
      memberNodeMode: 'compact',
    });

    const classNode = nodes.find((node) => node.id === 'class-1');
    const interfaceNode = nodes.find((node) => node.id === 'iface-1');

    expect(classNode).toBeDefined();
    expect(classNode?.parentNode).toBe('module-a');
    if (!classNode?.data) {
      throw new Error('Expected class node data');
    }
    expect(classNode.data.members?.totalCount).toBe(2);
    expect(classNode.data.subnodes).toBeUndefined();

    expect(interfaceNode).toBeDefined();
    expect(interfaceNode?.parentNode).toBe('module-a');
    if (!interfaceNode?.data) {
      throw new Error('Expected interface node data');
    }
    expect(interfaceNode.data.members?.totalCount).toBe(2);
    expect(interfaceNode.data.subnodes).toBeUndefined();
  });

  it('creates member nodes in graph member mode', () => {
    const nodes = createGraphNodes(createFixtureGraph(), {
      includeModules: true,
      includeClasses: true,
      includeClassNodes: true,
      includeInterfaceNodes: true,
      nestSymbolsInModules: true,
      memberNodeMode: 'graph',
    });

    const propertyNode = nodes.find((node) => node.type === 'property' && node.parentNode === 'class-1');
    const methodNode = nodes.find((node) => node.type === 'method' && node.parentNode === 'class-1');
    const classNode = nodes.find((node) => node.id === 'class-1');

    expect(classNode?.data?.subnodes?.count).toBe(2);
    expect(propertyNode).toBeDefined();
    expect(methodNode).toBeDefined();
  });
});
