import type { DependencyEdgeKind } from '../types';

const VALID_EDGE_KINDS: DependencyEdgeKind[] = [
  'dependency',
  'devDependency',
  'peerDependency',
  'import',
  'export',
  'inheritance',
  'implements',
  'extends',
  'contains',
  'uses',
];

const VALID_SET = new Set<string>(VALID_EDGE_KINDS);

export function toDependencyEdgeKind(type: string | undefined): DependencyEdgeKind {
  if (type !== undefined && VALID_SET.has(type)) {
    return type as DependencyEdgeKind;
  }
  return 'dependency';
}
