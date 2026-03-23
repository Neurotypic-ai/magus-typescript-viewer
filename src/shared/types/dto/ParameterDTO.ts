/**
 * Data transfer object for creating a new parameter.
 */
export interface IParameterCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  method_id: string;
  name: string;
  type: string;
  is_optional: boolean;
  is_rest: boolean;
  default_value?: string;
}
