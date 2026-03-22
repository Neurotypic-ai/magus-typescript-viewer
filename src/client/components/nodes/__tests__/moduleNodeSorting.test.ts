import { describe, expect, it } from 'vitest';

import {
  sortEmbeddedSymbols,
  sortExternalDependencies,
  sortModuleEntities,
  sortNodeProperties,
  sortSectionsByTitle,
} from '../moduleNodeSorting';

import type { EmbeddedModuleEntity } from '../../../types/EmbeddedModuleEntity';
import type { EmbeddedSymbol } from '../../../types/EmbeddedSymbol';
import type { ExternalDependencyRef } from '../../../types/ExternalDependencyRef';
import type { NodeProperty } from '../../../types/NodeProperty';

describe('moduleNodeSorting', () => {
  it('sorts metadata properties alphabetically by name', () => {
    const properties: NodeProperty[] = [
      { name: 'zeta', type: 'string', visibility: 'public' },
      { name: 'Alpha', type: 'string', visibility: 'public' },
      { name: 'beta', type: 'string', visibility: 'public' },
    ];

    const sorted = sortNodeProperties(properties);

    expect(sorted.map((property) => property.name)).toEqual(['Alpha', 'beta', 'zeta']);
  });

  it('sorts external dependencies and their symbols alphabetically', () => {
    const dependencies: ExternalDependencyRef[] = [
      { packageName: 'zod', symbols: ['ZodError', 'z'] },
      { packageName: '@vueuse/core', symbols: ['watchDebounced', 'computedAsync'] },
      { packageName: 'axios', symbols: ['AxiosError', 'axios'] },
    ];

    const sorted = sortExternalDependencies(dependencies);

    expect(sorted.map((dependency) => dependency.packageName)).toEqual(['@vueuse/core', 'axios', 'zod']);
    expect(sorted[0]?.symbols).toEqual(['computedAsync', 'watchDebounced']);
    expect(sorted[1]?.symbols).toEqual(['axios', 'AxiosError']);
  });

  it('sorts embedded symbols and each symbol member list alphabetically', () => {
    const symbols: EmbeddedSymbol[] = [
      {
        id: '2',
        type: 'interface',
        name: 'Zoo',
        properties: [
          { name: 'name', type: 'string', visibility: 'public' },
          { name: 'age', type: 'number', visibility: 'public' },
        ],
        methods: [
          { name: 'walk', returnType: 'void', visibility: 'public', signature: 'walk(): void' },
          { name: 'eat', returnType: 'void', visibility: 'public', signature: 'eat(): void' },
        ],
      },
      {
        id: '1',
        type: 'class',
        name: 'Alpha',
        properties: [],
        methods: [],
      },
    ];

    const sorted = sortEmbeddedSymbols(symbols);

    expect(sorted.map((symbol) => symbol.name)).toEqual(['Alpha', 'Zoo']);
    expect(sorted[1]?.properties.map((property) => property.name)).toEqual(['age', 'name']);
    expect(sorted[1]?.methods.map((method) => method.name)).toEqual(['eat', 'walk']);
  });

  it('sorts module entities alphabetically by name', () => {
    const entities: EmbeddedModuleEntity[] = [
      { id: '1', type: 'function', name: 'zeta', detail: '() => void' },
      { id: '2', type: 'const', name: 'alpha', detail: 'string' },
      { id: '3', type: 'enum', name: 'Beta', detail: 'Beta' },
    ];

    const sorted = sortModuleEntities(entities);

    expect(sorted.map((entity) => entity.name)).toEqual(['alpha', 'Beta', 'zeta']);
  });

  it('sorts content sections alphabetically by title', () => {
    const sections = [
      { key: 'types', title: 'Types' },
      { key: 'classes', title: 'Classes' },
      { key: 'functions', title: 'Functions' },
    ];

    const sorted = sortSectionsByTitle(sections);

    expect(sorted.map((section) => section.title)).toEqual(['Classes', 'Functions', 'Types']);
  });
});
