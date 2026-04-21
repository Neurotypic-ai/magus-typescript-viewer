export type ArchitecturalViolationSeverity = 'info' | 'warning' | 'error';

/**
 * A violation of an architectural rule — typically an illegal cross-layer import.
 */
export interface IArchitecturalViolationCreateDTO {
  id: string;
  snapshot_id: string;
  package_id: string;
  rule_name: string;
  source_module_id?: string;
  target_module_id?: string;
  source_layer?: string;
  target_layer?: string;
  severity: ArchitecturalViolationSeverity;
  message: string;
}

export interface IArchitecturalViolationRow {
  id: string;
  snapshot_id: string;
  package_id: string;
  rule_name: string;
  source_module_id: string | null;
  target_module_id: string | null;
  source_layer: string | null;
  target_layer: string | null;
  severity: ArchitecturalViolationSeverity;
  message: string;
  created_at: string;
}
