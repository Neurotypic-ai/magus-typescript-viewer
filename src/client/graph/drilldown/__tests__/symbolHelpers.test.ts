import { Position } from '@vue-flow/core';

import {
  toNodeProperty,
  toNodeMethod,
  findModuleById,
  createSymbolEdge,
  createDetailedSymbolNode,
} from '../symbolHelpers';

import type { DependencyPackageGraph } from '../../../types/DependencyPackageGraph';
import type { ModuleStructure } from '../../../types/ModuleStructure';
import type { NodeMethod } from '../../../types/NodeMethod';
import type { NodeProperty } from '../../../types/NodeProperty';
import type { PackageStructure } from '../../../types/PackageStructure';

// ---------------------------------------------------------------------------
// toNodeProperty
// ---------------------------------------------------------------------------

describe('toNodeProperty', () => {
  it('passes through a well-formed NodeProperty', () => {
    const input: NodeProperty = {
      id: 'prop-1',
      name: 'count',
      type: 'number',
      visibility: 'private',
    };
    const result = toNodeProperty(input);
    expect(result).toEqual({
      id: 'prop-1',
      name: 'count',
      type: 'number',
      visibility: 'private',
    });
  });

  it('defaults name to "unknown" when not a string', () => {
    const result = toNodeProperty({ name: 42, type: 'string', visibility: 'public' } as unknown as Record<
      string,
      unknown
    >);
    expect(result.name).toBe('unknown');
  });

  it('defaults type to "unknown" when not a string', () => {
    const result = toNodeProperty({ name: 'foo', type: null, visibility: 'public' } as unknown as Record<
      string,
      unknown
    >);
    expect(result.type).toBe('unknown');
  });

  it('defaults visibility to "public" when not a string', () => {
    const result = toNodeProperty({ name: 'foo', type: 'string' } as unknown as Record<string, unknown>);
    expect(result.visibility).toBe('public');
  });

  it('sets id to undefined when not a string', () => {
    const result = toNodeProperty({ id: 123, name: 'x', type: 'y', visibility: 'protected' } as unknown as Record<
      string,
      unknown
    >);
    expect(result.id).toBeUndefined();
  });

  it('handles a completely empty object', () => {
    const result = toNodeProperty({} as Record<string, unknown>);
    expect(result).toEqual({
      id: undefined,
      name: 'unknown',
      type: 'unknown',
      visibility: 'public',
    });
  });

  it('preserves id when it is a valid string', () => {
    const result = toNodeProperty({ id: 'abc', name: 'n', type: 't', visibility: 'v' });
    expect(result.id).toBe('abc');
  });
});

// ---------------------------------------------------------------------------
// toNodeMethod
// ---------------------------------------------------------------------------

describe('toNodeMethod', () => {
  it('passes through a well-formed NodeMethod', () => {
    const input: NodeMethod = {
      id: 'meth-1',
      name: 'getData',
      returnType: 'Promise<void>',
      visibility: 'public',
      signature: 'getData(): Promise<void>',
    };
    const result = toNodeMethod(input);
    expect(result).toEqual({
      id: 'meth-1',
      name: 'getData',
      returnType: 'Promise<void>',
      visibility: 'public',
      signature: 'getData(): Promise<void>',
    });
  });

  it('defaults name to "unknown" when not a string', () => {
    const result = toNodeMethod({ name: 123, returnType: 'void', visibility: 'public' } as unknown as Record<
      string,
      unknown
    >);
    expect(result.name).toBe('unknown');
  });

  it('defaults returnType to "void" when not a string', () => {
    const result = toNodeMethod({ name: 'foo', returnType: undefined, visibility: 'public' } as unknown as Record<
      string,
      unknown
    >);
    expect(result.returnType).toBe('void');
  });

  it('defaults visibility to "public" when not a string', () => {
    const result = toNodeMethod({ name: 'foo', returnType: 'void' } as unknown as Record<string, unknown>);
    expect(result.visibility).toBe('public');
  });

  it('sets id to undefined when not a string', () => {
    const result = toNodeMethod({ id: 99, name: 'x', returnType: 'y', visibility: 'z' } as unknown as Record<
      string,
      unknown
    >);
    expect(result.id).toBeUndefined();
  });

  it('generates a default signature when signature is missing', () => {
    const result = toNodeMethod({
      name: 'run',
      returnType: 'boolean',
      visibility: 'public',
    } as unknown as Record<string, unknown>);
    expect(result.signature).toBe('run(): boolean');
  });

  it('generates a default signature when signature is an empty string', () => {
    const result = toNodeMethod({
      name: 'run',
      returnType: 'boolean',
      visibility: 'public',
      signature: '',
    } as unknown as Record<string, unknown>);
    expect(result.signature).toBe('run(): boolean');
  });

  it('uses the provided signature when non-empty', () => {
    const result = toNodeMethod({
      name: 'run',
      returnType: 'boolean',
      visibility: 'public',
      signature: 'run(flag: boolean): boolean',
    } as unknown as Record<string, unknown>);
    expect(result.signature).toBe('run(flag: boolean): boolean');
  });

  it('generates signature using fallback name/returnType when both are missing', () => {
    const result = toNodeMethod({} as Record<string, unknown>);
    expect(result.signature).toBe('unknown(): void');
    expect(result.name).toBe('unknown');
    expect(result.returnType).toBe('void');
  });

  it('handles a completely empty object', () => {
    const result = toNodeMethod({} as Record<string, unknown>);
    expect(result).toEqual({
      id: undefined,
      name: 'unknown',
      returnType: 'void',
      visibility: 'public',
      signature: 'unknown(): void',
    });
  });
});

// ---------------------------------------------------------------------------
// findModuleById
// ---------------------------------------------------------------------------

function makeModule(id: string, name: string): ModuleStructure {
  return {
    id,
    name,
    package_id: 'pkg-1',
    source: { relativePath: `src/${name}.ts` },
  };
}

function makePackage(id: string, modules: Record<string, ModuleStructure>): PackageStructure {
  return {
    id,
    name: `package-${id}`,
    version: '1.0.0',
    path: `/packages/${id}`,
    created_at: '2025-01-01',
    modules,
  };
}

describe('findModuleById', () => {
  const moduleA = makeModule('mod-a', 'moduleA');
  const moduleB = makeModule('mod-b', 'moduleB');
  const moduleC = makeModule('mod-c', 'moduleC');

  const graph: DependencyPackageGraph = {
    packages: [
      makePackage('pkg-1', { 'mod-a': moduleA, 'mod-b': moduleB }),
      makePackage('pkg-2', { 'mod-c': moduleC }),
    ],
  };

  it('finds a module in the first package', () => {
    expect(findModuleById(graph, 'mod-a')).toBe(moduleA);
  });

  it('finds a module in the second package', () => {
    expect(findModuleById(graph, 'mod-c')).toBe(moduleC);
  });

  it('returns undefined when the module ID does not exist', () => {
    expect(findModuleById(graph, 'mod-unknown')).toBeUndefined();
  });

  it('returns undefined when the graph has no packages', () => {
    expect(findModuleById({ packages: [] }, 'mod-a')).toBeUndefined();
  });

  it('skips packages with no modules field', () => {
    const graphWithNoModules: DependencyPackageGraph = {
      packages: [
        {
          id: 'pkg-empty',
          name: 'empty',
          version: '0.0.0',
          path: '/',
          created_at: '2025-01-01',
        } as PackageStructure,
        makePackage('pkg-2', { 'mod-c': moduleC }),
      ],
    };
    expect(findModuleById(graphWithNoModules, 'mod-c')).toBe(moduleC);
  });

  it('returns the first match when duplicate IDs exist across packages', () => {
    const duplicateModule = makeModule('mod-a', 'duplicateA');
    const graphWithDuplicates: DependencyPackageGraph = {
      packages: [
        makePackage('pkg-1', { 'mod-a': moduleA }),
        makePackage('pkg-3', { 'mod-a': duplicateModule }),
      ],
    };
    // Should return the first found (from pkg-1)
    expect(findModuleById(graphWithDuplicates, 'mod-a')).toBe(moduleA);
  });
});

// ---------------------------------------------------------------------------
// createSymbolEdge
// ---------------------------------------------------------------------------

describe('createSymbolEdge', () => {
  it('creates an edge with the correct id', () => {
    const edge = createSymbolEdge('src-1', 'tgt-1', 'import');
    expect(edge.id).toBe('src-1-tgt-1-import');
  });

  it('sets source and target correctly', () => {
    const edge = createSymbolEdge('a', 'b', 'extends');
    expect(edge.source).toBe('a');
    expect(edge.target).toBe('b');
  });

  it('sets hidden to false', () => {
    const edge = createSymbolEdge('a', 'b', 'contains');
    expect(edge.hidden).toBe(false);
  });

  it('stores the edge type in data', () => {
    const edge = createSymbolEdge('a', 'b', 'inheritance');
    expect(edge.data?.type).toBe('inheritance');
  });

  it('has a strokeWidth of 3 in the style', () => {
    const edge = createSymbolEdge('a', 'b', 'dependency');
    expect(edge.style?.strokeWidth).toBe(3);
  });

  it('includes a marker end', () => {
    const edge = createSymbolEdge('a', 'b', 'implements');
    expect(edge.markerEnd).toBeDefined();
  });

  it('applies edge style from theme for the given type', () => {
    const edge = createSymbolEdge('a', 'b', 'import');
    // The style should contain the stroke color from the theme for 'import' type
    expect(edge.style).toBeDefined();
    expect(edge.style?.stroke).toBeDefined();
  });

  it('works with all supported edge kinds', () => {
    const kinds = [
      'dependency',
      'devDependency',
      'peerDependency',
      'import',
      'export',
      'inheritance',
      'implements',
      'extends',
      'contains',
      'uses',
    ] as const;

    for (const kind of kinds) {
      const edge = createSymbolEdge('s', 't', kind);
      expect(edge.id).toBe(`s-t-${kind}`);
      expect(edge.data?.type).toBe(kind);
    }
  });
});

// ---------------------------------------------------------------------------
// createDetailedSymbolNode
// ---------------------------------------------------------------------------

describe('createDetailedSymbolNode', () => {
  const sampleProperties: NodeProperty[] = [
    { id: 'p1', name: 'name', type: 'string', visibility: 'public' },
    { id: 'p2', name: 'age', type: 'number', visibility: 'private' },
  ];

  const sampleMethods: NodeMethod[] = [
    { id: 'm1', name: 'greet', returnType: 'void', visibility: 'public', signature: 'greet(): void' },
  ];

  it('creates a node with the correct id', () => {
    const node = createDetailedSymbolNode('node-1', 'class', 'MyClass', [], [], 'LR');
    expect(node.id).toBe('node-1');
  });

  it('sets the node type', () => {
    const node = createDetailedSymbolNode('node-1', 'interface', 'MyInterface', [], [], 'LR');
    expect(node.type).toBe('interface');
  });

  it('sets position to origin', () => {
    const node = createDetailedSymbolNode('node-1', 'class', 'Foo', [], [], 'TB');
    expect(node.position).toEqual({ x: 0, y: 0 });
  });

  it('includes label, properties and methods in data', () => {
    const node = createDetailedSymbolNode('node-1', 'class', 'MyClass', sampleProperties, sampleMethods, 'LR');
    expect(node.data.label).toBe('MyClass');
    expect(node.data.properties).toEqual(sampleProperties);
    expect(node.data.methods).toEqual(sampleMethods);
  });

  it('handles empty properties and methods arrays', () => {
    const node = createDetailedSymbolNode('node-1', 'class', 'Empty', [], [], 'LR');
    expect(node.data.properties).toEqual([]);
    expect(node.data.methods).toEqual([]);
  });

  it('has a style object from the theme', () => {
    const node = createDetailedSymbolNode('node-1', 'class', 'Styled', [], [], 'LR');
    expect(node.style).toBeDefined();
  });

  describe('handle positions for LR direction', () => {
    it('sets sourcePosition to Right and targetPosition to Left', () => {
      const node = createDetailedSymbolNode('n', 'class', 'C', [], [], 'LR');
      expect(node.sourcePosition).toBe(Position.Right);
      expect(node.targetPosition).toBe(Position.Left);
    });
  });

  describe('handle positions for RL direction', () => {
    it('sets sourcePosition to Left and targetPosition to Right', () => {
      const node = createDetailedSymbolNode('n', 'class', 'C', [], [], 'RL');
      expect(node.sourcePosition).toBe(Position.Left);
      expect(node.targetPosition).toBe(Position.Right);
    });
  });

  describe('handle positions for TB direction', () => {
    it('sets sourcePosition to Bottom and targetPosition to Top', () => {
      const node = createDetailedSymbolNode('n', 'class', 'C', [], [], 'TB');
      expect(node.sourcePosition).toBe(Position.Bottom);
      expect(node.targetPosition).toBe(Position.Top);
    });
  });

  describe('handle positions for BT direction', () => {
    it('sets sourcePosition to Top and targetPosition to Bottom', () => {
      const node = createDetailedSymbolNode('n', 'class', 'C', [], [], 'BT');
      expect(node.sourcePosition).toBe(Position.Top);
      expect(node.targetPosition).toBe(Position.Bottom);
    });
  });

  it('creates class and interface nodes with distinct styles', () => {
    const classNode = createDetailedSymbolNode('c', 'class', 'C', [], [], 'LR');
    const ifaceNode = createDetailedSymbolNode('i', 'interface', 'I', [], [], 'LR');
    // Both should have styles but they differ for class vs interface
    expect(classNode.style).toBeDefined();
    expect(ifaceNode.style).toBeDefined();
    // The styles should be different objects (different background/border colors)
    expect(classNode.style).not.toEqual(ifaceNode.style);
  });
});
