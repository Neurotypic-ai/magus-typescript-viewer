export type InsightCategory = 'dependency-health' | 'structural-complexity' | 'api-surface' | 'connectivity' | 'maintenance';
export type InsightSeverity = 'info' | 'warning' | 'critical';

export type InsightKind =
  | 'circular-imports'
  | 'import-fan-in'
  | 'import-fan-out'
  | 'heavy-external-dependency'
  | 'god-class'
  | 'long-parameter-lists'
  | 'module-size'
  | 'deep-inheritance'
  | 'leaky-encapsulation'
  | 'barrel-file-depth'
  | 'unexported-entities'
  | 'type-only-dependencies'
  | 'orphaned-modules'
  | 'hub-modules'
  | 'bridge-modules'
  | 'cluster-detection'
  | 'unused-exports'
  | 'interface-segregation-violations'
  | 'missing-return-types'
  | 'async-boundary-mismatches';

export interface InsightEntity {
  id: string;
  kind: 'module' | 'class' | 'interface' | 'function' | 'method' | 'import';
  name: string;
  moduleId?: string | undefined;
  detail?: string | undefined;
}

export interface InsightResult {
  type: InsightKind;
  category: InsightCategory;
  severity: InsightSeverity;
  title: string;
  description: string;
  entities: InsightEntity[];
  value?: number | undefined;
  threshold?: number | undefined;
}

export interface InsightReport {
  packageId?: string | undefined;
  computedAt: string;
  healthScore: number;
  summary: { critical: number; warning: number; info: number };
  insights: InsightResult[];
}
