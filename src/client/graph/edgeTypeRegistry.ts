import type { DependencyEdgeKind, DependencyKind, HandleCategory } from '../components/DependencyGraph/types';

export interface EdgeTypeDefinition {
  kind: DependencyEdgeKind;
  label: string;
  validSources: readonly DependencyKind[];
  validTargets: readonly DependencyKind[];
  directed: boolean;
  handleCategory: HandleCategory;
}

const EDGE_TYPE_REGISTRY: Record<DependencyEdgeKind, EdgeTypeDefinition> = {
  import: {
    kind: 'import',
    label: 'Imports',
    validSources: ['module'],
    validTargets: ['module'],
    directed: true,
    handleCategory: 'relational',
  },
  extends: {
    kind: 'extends',
    label: 'Extends',
    validSources: ['class', 'interface'],
    validTargets: ['class', 'interface'],
    directed: true,
    handleCategory: 'relational',
  },
  implements: {
    kind: 'implements',
    label: 'Implements',
    validSources: ['class'],
    validTargets: ['interface'],
    directed: true,
    handleCategory: 'relational',
  },
  inheritance: {
    kind: 'inheritance',
    label: 'Inheritance',
    validSources: ['class', 'interface'],
    validTargets: ['class', 'interface'],
    directed: true,
    handleCategory: 'relational',
  },
  contains: {
    kind: 'contains',
    label: 'Contains',
    validSources: ['module', 'class', 'interface'],
    validTargets: ['class', 'interface', 'function', 'property', 'method', 'enum', 'type'],
    directed: true,
    handleCategory: 'structural',
  },
  dependency: {
    kind: 'dependency',
    label: 'Dependency',
    validSources: ['package'],
    validTargets: ['package'],
    directed: true,
    handleCategory: 'relational',
  },
  devDependency: {
    kind: 'devDependency',
    label: 'Dev Dependency',
    validSources: ['package'],
    validTargets: ['package'],
    directed: true,
    handleCategory: 'relational',
  },
  peerDependency: {
    kind: 'peerDependency',
    label: 'Peer Dependency',
    validSources: ['package'],
    validTargets: ['package'],
    directed: true,
    handleCategory: 'relational',
  },
  export: {
    kind: 'export',
    label: 'Exports',
    validSources: ['module'],
    validTargets: ['module'],
    directed: true,
    handleCategory: 'relational',
  },
  uses: {
    kind: 'uses',
    label: 'Uses',
    validSources: ['class', 'interface', 'function', 'method'],
    validTargets: ['property', 'method'],
    directed: true,
    handleCategory: 'relational',
  },
};

export function isValidEdgeConnection(
  kind: DependencyEdgeKind,
  sourceType: DependencyKind,
  targetType: DependencyKind
): boolean {
  const definition = EDGE_TYPE_REGISTRY[kind];
  return definition.validSources.includes(sourceType) && definition.validTargets.includes(targetType);
}

export function getHandleCategory(kind: DependencyEdgeKind): HandleCategory {
  return EDGE_TYPE_REGISTRY[kind].handleCategory;
}

