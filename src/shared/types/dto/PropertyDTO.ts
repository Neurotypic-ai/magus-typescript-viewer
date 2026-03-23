import type { VisibilityType } from '../VisibilityType';

/**
 * Data transfer object for creating a new property.
 */
export interface IPropertyCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  parent_id: string;
  parent_type: 'class' | 'interface';
  name: string;
  type: string;
  is_static: boolean;
  is_readonly: boolean;
  visibility: string;
}

export interface IPropertyUpdateDTO {
  name?: string;
  type?: string;
  is_static?: boolean;
  is_readonly?: boolean;
  visibility?: VisibilityType;
}
