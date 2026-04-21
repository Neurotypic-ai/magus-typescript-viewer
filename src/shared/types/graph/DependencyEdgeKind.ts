/**
 * Edge types for dependency relationships
 */
export type DependencyEdgeKind =
  | 'dependency'
  | 'devDependency'
  | 'peerDependency'
  | 'import'
  | 'export'
  | 'implements'
  | 'extends'
  | 'contains'
  | 'uses';
