/**
 * Data transfer object for creating a variable row.
 */
export interface IVariableCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  kind: 'const' | 'let' | 'var';
  type?: string | undefined;
  initializer?: string | undefined;
}

export interface IVariableUpdateDTO {
  name?: string;
  kind?: 'const' | 'let' | 'var';
  type?: string;
  initializer?: string;
}
