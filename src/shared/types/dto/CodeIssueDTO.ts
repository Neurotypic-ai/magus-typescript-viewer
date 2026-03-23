/**
 * Data transfer object for creating a code issue row.
 */
export interface ICodeIssueCreateDTO {
  id: string;
  rule_code: string;
  severity: string;
  message: string;
  suggestion?: string | undefined;
  package_id: string;
  module_id: string;
  file_path: string;
  entity_id?: string | undefined;
  entity_type?: string | undefined;
  entity_name?: string | undefined;
  parent_entity_id?: string | undefined;
  parent_entity_type?: string | undefined;
  parent_entity_name?: string | undefined;
  property_name?: string | undefined;
  line?: number | undefined;
  column?: number | undefined;
  refactor_action?: string | undefined;
  refactor_context_json?: string | undefined;
}

/**
 * Code issues do not support updates in the repository.
 */
export type ICodeIssueUpdateDTO = Record<string, never>;
