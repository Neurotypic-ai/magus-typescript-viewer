/**
 * Dependency kinds (node types)
 */
export type DependencyKind =
  | 'package'
  | 'module'
  | 'externalPackage'
  | 'class'
  | 'interface'
  | 'enum'
  | 'type'
  | 'function'
  | 'group'
  | 'scc'
  | 'property'
  | 'method';
