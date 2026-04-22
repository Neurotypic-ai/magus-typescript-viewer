import type { DependencyEdgeKind } from '../../shared/types/graph/DependencyEdgeKind';
import type { DependencyKind } from '../../shared/types/graph/DependencyKind';
import type { HandleCategory } from '../../shared/types/graph/HandleCategory';

interface EdgeTypeDefinition {
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
    validTargets: ['module', 'externalPackage'],
    directed: true,
    handleCategory: 'relational',
  },
  // Package-scoped dependency edges can originate at either a package node
  // (package.json → package.json) OR a module node (module → externalPackage),
  // when external imports are reclassified by package.json category.
  // dependency/devDependency/peerDependency definitions below.
  extends: {
    kind: 'extends',
    label: 'Extends',
    // Covers both class→class and interface→interface. The legacy
    // 'inheritance' kind has been merged in. 'module' is accepted so
    // module-level lifted edges (liftClassEdgesToModuleLevel) validate.
    validSources: ['class', 'interface', 'module'],
    validTargets: ['class', 'interface', 'module'],
    directed: true,
    handleCategory: 'relational',
  },
  implements: {
    kind: 'implements',
    label: 'Implements',
    validSources: ['class', 'module'],
    validTargets: ['interface', 'module'],
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
    validSources: ['package', 'module'],
    validTargets: ['package', 'externalPackage'],
    directed: true,
    handleCategory: 'relational',
  },
  devDependency: {
    kind: 'devDependency',
    label: 'Dev Dependency',
    validSources: ['package', 'module'],
    validTargets: ['package', 'externalPackage'],
    directed: true,
    handleCategory: 'relational',
  },
  peerDependency: {
    kind: 'peerDependency',
    label: 'Peer Dependency',
    validSources: ['package', 'module'],
    validTargets: ['package', 'externalPackage'],
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
  // Fan-in trunk bundling (Phase 3). A `fanInTrunk` edge runs from a synthetic
  // junction point toward the shared target; `fanInStub` edges run from each
  // source to the junction. Valid source/target kinds mirror every module-level
  // node kind that can appear as an edge endpoint at the overview level. (SCC
  // supernodes ship in Phase 5 and will be added to this list then.)
  fanInTrunk: {
    kind: 'fanInTrunk',
    label: 'Fan-in Trunk',
    validSources: ['module', 'class', 'interface', 'externalPackage', 'group'],
    validTargets: ['module', 'class', 'interface', 'externalPackage', 'group'],
    directed: true,
    handleCategory: 'relational',
  },
  fanInStub: {
    kind: 'fanInStub',
    label: 'Fan-in Stub',
    validSources: ['module', 'class', 'interface', 'externalPackage', 'group'],
    validTargets: ['module', 'class', 'interface', 'externalPackage', 'group'],
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
