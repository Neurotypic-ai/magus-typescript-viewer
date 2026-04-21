/**
 * Data transfer object for creating a new module-level function.
 */
export interface IFunctionCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  return_type?: string;
  is_async?: boolean;
  is_exported?: boolean;
  has_explicit_return_type?: boolean;
  start_line?: number;
  end_line?: number;
  logical_lines?: number;
  cyclomatic?: number;
  cognitive?: number;
  max_nesting?: number;
  parameter_count?: number;
  has_jsdoc?: boolean;
  return_type_is_any?: boolean;
}

export interface IFunctionUpdateDTO {
  name?: string;
  return_type?: string;
  is_async?: boolean;
  is_exported?: boolean;
}
