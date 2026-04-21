export type CycleSeverity = 'info' | 'warning' | 'error';

/**
 * A detected circular import cycle at the module level.
 * `participants_json` stores an ordered array of module_id strings.
 */
export interface IDependencyCycleCreateDTO {
  id: string;
  package_id: string;
  length: number;
  participants_json: string;
  severity: CycleSeverity;
}

export interface IDependencyCycleRow {
  id: string;
  package_id: string;
  length: number;
  participants_json: string;
  severity: CycleSeverity;
  created_at: string;
}
