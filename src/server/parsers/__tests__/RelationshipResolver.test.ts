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
