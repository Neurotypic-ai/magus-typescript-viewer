/**
 * Data transfer object for creating a type alias row.
 */
export interface ITypeAliasCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  type: string;
  type_parameters_json?: string | undefined;
}

export interface ITypeAliasUpdateDTO {
  name?: string;
  type?: string;
  type_parameters_json?: string;
}
