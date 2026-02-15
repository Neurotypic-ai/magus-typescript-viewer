import type { PackageStructure } from './PackageStructure';

/**
 * Package graph structure
 */
export interface DependencyPackageGraph {
  packages: PackageStructure[];
}
