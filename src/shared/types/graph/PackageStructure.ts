import type { DependencyRef } from './DependencyRef';
import type { ModuleStructure } from './ModuleStructure';

/**
 * Package structure for graph visualization
 */
export interface PackageStructure {
  id: string;
  name: string;
  version: string;
  path: string;
  created_at: string;
  dependencies?: Record<string, DependencyRef>;
  devDependencies?: Record<string, DependencyRef>;
  peerDependencies?: Record<string, DependencyRef>;
  modules?: Record<string, ModuleStructure>;
  [key: string]: unknown;
}
