/**
 * Data transfer object for creating an enum row.
 */
export interface IEnumCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  members_json?: string | undefined;
}

export interface IEnumUpdateDTO {
  name?: string;
  members_json?: string;
}
