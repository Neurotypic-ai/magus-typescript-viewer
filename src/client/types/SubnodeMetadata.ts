import type { DependencyKind } from './DependencyKind';

export interface SubnodeMetadata {
  count: number;
  totalCount?: number;
  visibleCount?: number;
  hiddenCount?: number;
  ids?: string[];
  byType?: Partial<Record<DependencyKind, number>>;
  byTypeTotal?: Partial<Record<DependencyKind, number>>;
  byTypeVisible?: Partial<Record<DependencyKind, number>>;
  isContainer?: boolean;
}
