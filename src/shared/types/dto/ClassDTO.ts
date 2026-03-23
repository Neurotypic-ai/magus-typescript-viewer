/**
 * Data transfer object for creating a new class.
 */
export interface IClassCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  extends_id?: string | undefined;
}

export interface IClassUpdateDTO {
  name?: string;
  extends_id?: string;
}
