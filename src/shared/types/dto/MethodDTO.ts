import type { ParentType } from '../ParentType';

/**
 * Data transfer object for creating a new method.
 */
export interface IMethodCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  parent_id: string;
  parent_type: ParentType;
  name: string;
  return_type: string;
  is_static: boolean;
  is_async: boolean;
  visibility: string;
  has_explicit_return_type?: boolean;
}

export interface IMethodUpdateDTO {
  name?: string;
  return_type?: string;
  parent_type?: ParentType;
  is_static?: boolean;
  is_async?: boolean;
  visibility?: string;
}
