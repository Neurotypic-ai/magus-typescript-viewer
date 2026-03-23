/**
 * Data transfer object for creating a new import.
 */
export interface IImportCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  source: string;
  specifiers_json?: string | undefined;
  is_type_only?: boolean;
}

export interface IImportUpdateDTO {
  source?: string;
  specifiers_json?: string | null;
}
