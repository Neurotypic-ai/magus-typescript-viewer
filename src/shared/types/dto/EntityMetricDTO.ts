export type EntityMetricCategory =
  | 'complexity'
  | 'coupling'
  | 'typeSafety'
  | 'size'
  | 'documentation'
  | 'deadCode'
  | 'duplication'
  | 'testing'
  | 'composite';

export type MetricEntityType =
  | 'package'
  | 'module'
  | 'class'
  | 'interface'
  | 'method'
  | 'function'
  | 'property'
  | 'typeAlias'
  | 'variable'
  | 'enum';

/**
 * Wide-format metric row: a single numeric value associated with a specific entity.
 * Unique on (snapshot_id, entity_id, entity_type, metric_key).
 */
export interface IEntityMetricCreateDTO {
  id: string;
  snapshot_id: string;
  package_id: string;
  module_id?: string;
  entity_id: string;
  entity_type: MetricEntityType;
  metric_key: string;
  metric_value: number;
  metric_category: EntityMetricCategory;
}

export interface IEntityMetricRow {
  id: string;
  snapshot_id: string;
  package_id: string;
  module_id: string | null;
  entity_id: string;
  entity_type: MetricEntityType;
  metric_key: string;
  metric_value: number;
  metric_category: EntityMetricCategory;
  created_at: string;
}
