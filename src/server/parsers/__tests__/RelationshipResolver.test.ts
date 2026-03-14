// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { RelationshipResolver } from '../RelationshipResolver';

import type { IMethodCreateDTO } from '../../db/repositories/MethodRepository';
import type { IPropertyCreateDTO } from '../../db/repositories/PropertyRepository';
import type { SymbolUsageRef } from '../ParseResult';

function createMethod(overrides: Partial<IMethodCreateDTO> & Pick<IMethodCreateDTO, 'id' | 'name' | 'parent_id'>): IMethodCreateDTO {
  return {
    ...overrides,
    id: overrides.id,
    package_id: 'pkg-1',
    module_id: 'mod-1',
    parent_id: overrides.parent_id,
    parent_type: 'class',
    name: overrides.name,
    return_type: 'void',
    is_static: false,
    is_async: false,
    visibility: 'public',
  };
}

function createProperty(
  overrides: Partial<IPropertyCreateDTO> & Pick<IPropertyCreateDTO, 'id' | 'name' | 'parent_id'>
): IPropertyCreateDTO {
  return {
    ...overrides,
    id: overrides.id,
    package_id: 'pkg-1',
    module_id: 'mod-1',
    parent_id: overrides.parent_id,
    parent_type: 'class',
    name: overrides.name,
    type: 'unknown',
    is_static: false,
    is_readonly: false,
    visibility: 'public',
  };
}

describe('RelationshipResolver.addNameMapping', () => {
  it('creates a new Set for a new name', () => {
    const resolver = new RelationshipResolver();
    const map = new Map<string, Set<string>>();
    resolver.addNameMapping(map, 'Widget', 'class-widget-1');
    expect(map.get('Widget')).toEqual(new Set(['class-widget-1']));
  });

  it('appends to the existing Set without replacing it', () => {
    const resolver = new RelationshipResolver();
    const map = new Map<string, Set<string>>();
    resolver.addNameMapping(map, 'Widget', 'class-widget-1');
    resolver.addNameMapping(map, 'Widget', 'class-widget-2');
    expect(map.get('Widget')).toEqual(new Set(['class-widget-1', 'class-widget-2']));
  });

  it('deduplicates: adding the same id twice keeps Set size 1', () => {
    const resolver = new RelationshipResolver();
    const map = new Map<string, Set<string>>();
    resolver.addNameMapping(map, 'Widget', 'class-widget-1');
    resolver.addNameMapping(map, 'Widget', 'class-widget-1');
    expect(map.get('Widget')?.size).toBe(1);
  });
});

describe('RelationshipResolver.resolveUniqueName', () => {
  it('returns the id when exactly one id maps to the name', () => {
    const resolver = new RelationshipResolver();
    const map = new Map<string, Set<string>>([['Foo', new Set(['id-foo'])]]);
    expect(resolver.resolveUniqueName(map, 'Foo')).toBe('id-foo');
  });

  it('returns undefined when name is ambiguous (2+ ids)', () => {
    const resolver = new RelationshipResolver();
    const map = new Map<string, Set<string>>([['Foo', new Set(['id-a', 'id-b'])]]);
    expect(resolver.resolveUniqueName(map, 'Foo')).toBeUndefined();
  });

  it('returns undefined when name is not in the map', () => {
    const resolver = new RelationshipResolver();
    const map = new Map<string, Set<string>>();
    expect(resolver.resolveUniqueName(map, 'Unknown')).toBeUndefined();
  });

  it('returns undefined when Set is empty', () => {
    const resolver = new RelationshipResolver();
    const map = new Map<string, Set<string>>([['Foo', new Set<string>()]]);
    expect(resolver.resolveUniqueName(map, 'Foo')).toBeUndefined();
  });
});

describe('RelationshipResolver.resolveRelationships', () => {
  it('resolves classExtends.parentName to parentId when exactly one match exists', () => {
    const resolver = new RelationshipResolver();
    const classNameToIds = new Map<string, Set<string>>([['Base', new Set(['class-base'])]]);
    const interfaceNameToIds = new Map<string, Set<string>>();

    const result = resolver.resolveRelationships(
      [{ classId: 'class-child', parentName: 'Base' }],
      [],
      [],
      classNameToIds,
      interfaceNameToIds
    );

    expect(result.classExtends[0]?.parentId).toBe('class-base');
  });

  it('leaves parentId undefined when parentName is ambiguous (2+ class ids)', () => {
    const resolver = new RelationshipResolver();
    const classNameToIds = new Map<string, Set<string>>([['Base', new Set(['id-1', 'id-2'])]]);
    const interfaceNameToIds = new Map<string, Set<string>>();

    const result = resolver.resolveRelationships(
      [{ classId: 'class-child', parentName: 'Base' }],
      [],
      [],
      classNameToIds,
      interfaceNameToIds
    );

    expect(result.classExtends[0]?.parentId).toBeUndefined();
  });

  it('resolves classImplements interfaceName to interfaceId', () => {
    const resolver = new RelationshipResolver();
    const classNameToIds = new Map<string, Set<string>>();
    const interfaceNameToIds = new Map<string, Set<string>>([
      ['Serializable', new Set(['iface-serializable'])],
    ]);

    const result = resolver.resolveRelationships(
      [],
      [{ classId: 'class-widget', interfaceName: 'Serializable' }],
      [],
      classNameToIds,
      interfaceNameToIds
    );

    expect(result.classImplements[0]?.interfaceId).toBe('iface-serializable');
  });

  it('resolves interfaceExtends parentName to parentId', () => {
    const resolver = new RelationshipResolver();
    const classNameToIds = new Map<string, Set<string>>();
    const interfaceNameToIds = new Map<string, Set<string>>([
      ['Base', new Set(['iface-base'])],
    ]);

    const result = resolver.resolveRelationships(
      [],
      [],
      [{ interfaceId: 'iface-child', parentName: 'Base' }],
      classNameToIds,
      interfaceNameToIds
    );

    expect(result.interfaceExtends[0]?.parentId).toBe('iface-base');
  });

  it('handles empty input arrays gracefully', () => {
    const resolver = new RelationshipResolver();
    const result = resolver.resolveRelationships([], [], [], new Map(), new Map());
    expect(result.classExtends).toEqual([]);
    expect(result.classImplements).toEqual([]);
    expect(result.interfaceExtends).toEqual([]);
  });
});

describe('RelationshipResolver.resolveSymbolReferences', () => {
  it('resolves this-qualified and explicit qualifier usages', () => {
    const resolver = new RelationshipResolver();

    const classNameToIds = new Map<string, Set<string>>([
      ['Worker', new Set(['class-worker'])],
      ['Service', new Set(['class-service'])],
    ]);
    const interfaceNameToIds = new Map<string, Set<string>>();

    const methods: IMethodCreateDTO[] = [
      createMethod({ id: 'method-run', name: 'run', parent_id: 'class-worker' }),
      createMethod({ id: 'method-build', name: 'build', parent_id: 'class-service' }),
    ];
    const properties: IPropertyCreateDTO[] = [
      createProperty({ id: 'property-state', name: 'state', parent_id: 'class-worker' }),
    ];

    const symbolUsages: SymbolUsageRef[] = [
      {
        moduleId: 'mod-1',
        sourceSymbolId: 'method-run',
        sourceSymbolType: 'method',
        sourceSymbolName: 'run',
        sourceParentName: 'Worker',
        sourceParentType: 'class',
        targetName: 'state',
        targetKind: 'property',
        qualifierName: 'this',
      },
      {
        moduleId: 'mod-1',
        sourceSymbolId: 'method-run',
        sourceSymbolType: 'method',
        sourceSymbolName: 'run',
        sourceParentName: 'Worker',
        sourceParentType: 'class',
        targetName: 'build',
        targetKind: 'method',
        qualifierName: 'Service',
      },
    ];

    const { resolved, unresolvedCount } = resolver.resolveSymbolReferences(
      'pkg-1',
      symbolUsages,
      classNameToIds,
      interfaceNameToIds,
      methods,
      properties
    );

    expect(unresolvedCount).toBe(0);
    expect(resolved).toHaveLength(2);
    expect(resolved.some((ref) => ref.target_symbol_id === 'property-state')).toBe(true);
    expect(resolved.some((ref) => ref.target_symbol_id === 'method-build')).toBe(true);
  });

  it('keeps ambiguous symbol usages unresolved', () => {
    const resolver = new RelationshipResolver();

    const classNameToIds = new Map<string, Set<string>>();
    const interfaceNameToIds = new Map<string, Set<string>>();

    const methods: IMethodCreateDTO[] = [
      createMethod({ id: 'method-dup-a', name: 'duplicate', parent_id: 'class-a' }),
      createMethod({ id: 'method-dup-b', name: 'duplicate', parent_id: 'class-b' }),
    ];
    const properties: IPropertyCreateDTO[] = [];
    const symbolUsages: SymbolUsageRef[] = [
      {
        moduleId: 'mod-1',
        sourceSymbolId: 'method-source',
        sourceSymbolType: 'method',
        sourceSymbolName: 'source',
        targetName: 'duplicate',
        targetKind: 'method',
      },
    ];

    const { resolved, unresolvedCount } = resolver.resolveSymbolReferences(
      'pkg-1',
      symbolUsages,
      classNameToIds,
      interfaceNameToIds,
      methods,
      properties
    );

    expect(unresolvedCount).toBe(1);
    expect(resolved).toHaveLength(0);
  });
});
