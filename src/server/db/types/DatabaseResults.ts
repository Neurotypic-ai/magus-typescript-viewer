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
