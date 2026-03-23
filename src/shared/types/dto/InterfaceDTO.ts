/**
 * Data transfer object for creating a new interface.
 */
export interface IInterfaceCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
}

export interface IInterfaceUpdateDTO {
  name?: string;
}
