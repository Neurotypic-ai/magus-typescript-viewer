import type { DependencyEdgeKind } from '../../shared/types/graph/DependencyEdgeKind';

/** Priority ordering for edge kinds. Higher = more important.
 * Used for highway primary-type selection and parallel-edge bundling. */
export const EDGE_KIND_PRIORITY: Record<DependencyEdgeKind, number> = {
  contains: 5,
  uses: 5,
  extends: 4,
  implements: 3,
  dependency: 2,
  import: 1,
  devDependency: 0,
  peerDependency: 0,
  export: 0,
  // Fan-in trunk synthetics are not semantic relationships; they should never
  // win a priority tiebreak against the underlying `import` edges they group.
  fanInTrunk: 0,
  fanInStub: 0,
};
