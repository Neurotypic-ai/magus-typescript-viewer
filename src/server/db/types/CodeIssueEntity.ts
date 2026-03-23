/**
 * Persisted code issue shape (server/repository layer). Includes fields not exposed on the public `CodeIssueRef` API type.
 */
export interface CodeIssueEntity {
  id: string;
  rule_code: string;
  severity: string;
  message: string;
  suggestion?: string;
  package_id: string;
  module_id: string;
  file_path: string;
  entity_id?: string;
  entity_type?: string;
  entity_name?: string;
  parent_entity_id?: string;
  parent_entity_type?: string;
  parent_entity_name?: string;
  property_name?: string;
  line?: number;
  column?: number;
  refactor_action?: string;
  refactor_context?: Record<string, unknown>;
}
