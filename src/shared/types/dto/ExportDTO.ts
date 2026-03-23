/**
 * Data transfer object for creating a new export.
 */
export interface IExportCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  is_default: boolean;
}

export interface IExportUpdateDTO {
  name?: string;
  is_default?: boolean;
}
