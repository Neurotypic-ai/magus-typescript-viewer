/**
 * Data transfer object for creating a new interface.
 */
export interface IInterfaceCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  start_line?: number;
  end_line?: number;
  has_jsdoc?: boolean;
}

export interface IInterfaceUpdateDTO {
  name?: string;
}
