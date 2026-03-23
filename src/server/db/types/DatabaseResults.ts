import type { DuckDBValue } from '@duckdb/node-api';

export interface IDatabaseRow {
  id: string;
  created_at: string;
  [key: string]: DuckDBValue | undefined;
}

export interface IPackageOwnedRow extends IDatabaseRow {
  package_id: string;
}

export interface IModuleOwnedRow extends IPackageOwnedRow {
  module_id: string;
}

export interface IOwnedByClassOrInterfaceRow extends IModuleOwnedRow {
  parent_id: string;
  parent_type: 'class' | 'interface';
  name: string;
  visibility: 'public' | 'private' | 'protected';
  is_static: boolean;
}

export interface IClassOrInterfaceRow extends IModuleOwnedRow {
  name: string;
  extends_id?: string;
}

export interface IPackageRow extends IDatabaseRow {
  name: string;
  version: string;
  path: string;
}

export interface IDependencyRow extends IDatabaseRow {
  source_id: string;
  target_id: string;
  type: 'dependency' | 'devDependency' | 'peerDependency';
}

export interface IModuleRow extends IPackageOwnedRow {
  name: string;
  source: string;
}

export interface IMethodRow extends IOwnedByClassOrInterfaceRow {
  name: string;
  return_type: string;
  is_static: boolean;
  is_abstract: boolean;
  is_async: boolean;
}

export interface IPropertyRow extends IOwnedByClassOrInterfaceRow {
  type: string;
  is_readonly: boolean;
}

export interface IParameterRow extends IModuleOwnedRow {
  method_id: string;
  name: string;
  type: string;
  is_optional: number;
  is_rest: number;
  default_value: string | null;
}

/** Raw row from `code_issues` (DuckDB). */
export interface ICodeIssueRow {
  [key: string]: string | number | null;
  id: string;
  rule_code: string;
  severity: string;
  message: string;
  suggestion: string | null;
  package_id: string;
  module_id: string;
  file_path: string;
  entity_id: string | null;
  entity_type: string | null;
  entity_name: string | null;
  parent_entity_id: string | null;
  parent_entity_type: string | null;
  parent_entity_name: string | null;
  property_name: string | null;
  line: number | null;
  column: number | null;
  refactor_action: string | null;
  refactor_context_json: string | null;
  created_at: string;
}

/** Raw row from `functions`. */
export interface IFunctionRow {
  [key: string]: string | null;
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  return_type: string | null;
  is_async: string;
  is_exported: string;
  created_at: string;
}

/** Raw row from `type_aliases`. */
export interface ITypeAliasRow {
  [key: string]: string | null;
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  type: string;
  type_parameters_json: string | null;
  created_at: string;
}

/** Raw row from `variables`. */
export interface IVariableRow {
  [key: string]: string | null;
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  kind: string;
  type: string | null;
  initializer: string | null;
  created_at: string;
}

/** Raw row from `enums`. */
export interface IEnumRow {
  [key: string]: string | null;
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  members_json: string | null;
  created_at: string;
}
