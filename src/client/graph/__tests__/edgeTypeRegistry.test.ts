import { describe, expect, it } from 'vitest';

import {
  getEdgeTypeDefinition,
  getHandleCategory,
  getValidEdgeKindsForSource,
  getValidEdgeKindsForTarget,
  isValidEdgeConnection,
} from '../edgeTypeRegistry';

import type { DependencyEdgeKind } from '../../components/DependencyGraph/types';

const ALL_EDGE_KINDS: DependencyEdgeKind[] = [
  'import',
  'extends',
  'implements',
  'inheritance',
  'contains',
  'dependency',
  'devDependency',
  'peerDependency',
  'export',
  'uses',
];

describe('edgeTypeRegistry', () => {
  it('returns a definition for all edge kinds', () => {
    ALL_EDGE_KINDS.forEach((kind) => {
      const definition = getEdgeTypeDefinition(kind);
      expect(definition.kind).toBe(kind);
      expect(definition.validSources.length).toBeGreaterThan(0);
      expect(definition.validTargets.length).toBeGreaterThan(0);
    });
  });

  it('validates documented and invalid edge connections', () => {
    expect(isValidEdgeConnection('import', 'module', 'module')).toBe(true);
    expect(isValidEdgeConnection('implements', 'class', 'interface')).toBe(true);
    expect(isValidEdgeConnection('uses', 'class', 'property')).toBe(true);

    expect(isValidEdgeConnection('import', 'class', 'module')).toBe(false);
    expect(isValidEdgeConnection('implements', 'interface', 'class')).toBe(false);
    expect(isValidEdgeConnection('dependency', 'module', 'module')).toBe(false);
  });

  it('returns expected handle categories', () => {
    expect(getHandleCategory('contains')).toBe('structural');
    expect(getHandleCategory('import')).toBe('relational');
    expect(getHandleCategory('uses')).toBe('relational');
  });

  it('returns expected source/target kind subsets', () => {
    expect(getValidEdgeKindsForSource('package')).toEqual(
      expect.arrayContaining(['dependency', 'devDependency', 'peerDependency'])
    );
    expect(getValidEdgeKindsForTarget('interface')).toEqual(
      expect.arrayContaining(['implements', 'extends', 'inheritance', 'contains'])
    );
    expect(getValidEdgeKindsForSource('function')).toEqual(expect.arrayContaining(['uses']));
    expect(getValidEdgeKindsForTarget('module')).toEqual(expect.arrayContaining(['import', 'export']));
  });
});

