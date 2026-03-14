/**
 * Node property format for display
 */
export interface NodeProperty {
  id?: string | undefined;
  name: string;
  type: string;
  visibility: string;
  isStatic?: boolean | undefined;
  isReadonly?: boolean | undefined;
  defaultValue?: string | undefined;
}
