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

// SCC supernodes aggregate module-level edges: when the layout pass condenses
// a strongly-connected component, every edge whose source/target was a member
// of that SCC is rewritten to point at the supernode. The supernode is an
// accepted source/target for every edge kind a module can participate in.
const EDGE_TYPE_REGISTRY: Record<DependencyEdgeKind, EdgeTypeDefinition> = {
  import: {
    kind: 'import',
    label: 'Imports',
    validSources: ['module', 'scc'],
    validTargets: ['module', 'externalPackage', 'scc'],
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
    validSources: ['class', 'interface', 'module', 'scc'],
    validTargets: ['class', 'interface', 'module', 'scc'],
    directed: true,
    handleCategory: 'relational',
  },
  implements: {
    kind: 'implements',
    label: 'Implements',
    validSources: ['class', 'module', 'scc'],
    validTargets: ['interface', 'module', 'scc'],
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
    validSources: ['package', 'module', 'scc'],
    validTargets: ['package', 'externalPackage', 'scc'],
    directed: true,
    handleCategory: 'relational',
  },
  devDependency: {
    kind: 'devDependency',
    label: 'Dev Dependency',
    validSources: ['package', 'module', 'scc'],
    validTargets: ['package', 'externalPackage', 'scc'],
    directed: true,
    handleCategory: 'relational',
  },
  peerDependency: {
    kind: 'peerDependency',
    label: 'Peer Dependency',
    validSources: ['package', 'module', 'scc'],
    validTargets: ['package', 'externalPackage', 'scc'],
    directed: true,
    handleCategory: 'relational',
  },
  export: {
    kind: 'export',
    label: 'Exports',
    validSources: ['module', 'scc'],
    validTargets: ['module', 'scc'],
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
