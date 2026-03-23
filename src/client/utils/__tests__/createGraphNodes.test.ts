import { describe, expect, it } from 'vitest';

import { Class } from '../../../shared/types/Class';
import { Interface } from '../../../shared/types/Interface';
import { Import, ImportSpecifier } from '../../../shared/types/Import';
import { Method } from '../../../shared/types/Method';
import { Module } from '../../../shared/types/Module';
import { Package } from '../../../shared/types/Package';
import { Property } from '../../../shared/types/Property';
import { createGraphNodes } from '../createGraphNodes';

import type { PackageGraph } from '../../../shared/types/Package';

const DATE = '2026-01-01T00:00:00.000Z';

function createFixtureGraph(): PackageGraph {
  const prop = new Property('prop-1', 'pkg-1', 'module-a', 'class-1', 'state', DATE, 'string', false, false, 'private');
  const method = new Method('method-1', 'pkg-1', 'module-a', 'class-1', 'load', DATE, new Map(), 'void', false, false, 'public');
  const appService = new Class('class-1', 'pkg-1', 'module-a', 'AppService', DATE, [method], [prop]);

  const ifaceProp = new Property('iface-prop-1', 'pkg-1', 'module-a', 'iface-1', 'id', DATE, 'string', false, false, 'public');
  const ifaceMethod = new Method('iface-method-1', 'pkg-1', 'module-a', 'iface-1', 'execute', DATE, new Map(), 'void', false, false, 'public');
  const appContract = new Interface('iface-1', 'pkg-1', 'module-a', 'AppContract', DATE, [ifaceMethod], [ifaceProp]);

  const vueSpecifiers = new Map([
    ['ref', new ImportSpecifier('ref', 'ref', 'value')],
    ['computed', new ImportSpecifier('computed', 'computed', 'value')],
  ]);
  // relativePath 'vue' is not relative ('.'-prefixed), so it is inferred as external
  const vueImport = new Import('imp-vue', 'vue', 'vue', 'vue', vueSpecifiers);
  const localImport = new Import('imp-local', './utils', './utils', './utils');

  const source = {
    directory: '/tmp/app/src/app',
    name: 'module-a',
    filename: '/tmp/app/src/app/module-a.ts',
    relativePath: 'src/app/module-a.ts',
  };
  const module = new Module(
    'module-a', 'pkg-1', 'AppModule', source, DATE,
    new Map([['class-1', appService]]),
    new Map([['iface-1', appContract]]),
    new Map([['imp-vue', vueImport], ['imp-local', localImport]]),
  );

  const pkg = new Package(
    'pkg-1', 'app', '1.0.0', '/tmp/app', DATE,
    new Map(), new Map(), new Map(),
    new Map([['module-a', module]]),
  );

  return { packages: [pkg] };
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
