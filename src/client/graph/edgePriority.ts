import type { DependencyEdgeKind } from '../types';

/** Priority ordering for edge kinds. Higher = more important.
 * Used for highway primary-type selection and parallel-edge bundling. */
export const EDGE_KIND_PRIORITY: Record<DependencyEdgeKind, number> = {
  contains: 5,
  uses: 5,
  inheritance: 4,
  implements: 3,
  extends: 3,
  dependency: 2,
  import: 1,
  devDependency: 0,
  peerDependency: 0,
  export: 0,
};
