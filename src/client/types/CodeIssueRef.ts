/**
 * Code issue reference for the frontend (no file_path or refactor_context for security)
 */
export interface CodeIssueRef {
  id: string;
  rule_code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  suggestion?: string;
  module_id: string;
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
}
