/**
 * Edge types for dependency relationships
 */
export type DependencyEdgeKind =
  | 'dependency'
  | 'devDependency'
  | 'peerDependency'
  | 'import'
  | 'export'
  | 'inheritance'
  | 'implements'
  | 'extends'
  | 'contains'
  | 'uses';
