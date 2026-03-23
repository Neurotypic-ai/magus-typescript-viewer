export type ParentType = 'class' | 'interface';

/**
 * Type guard to check if a parent type is valid.
 */
export function isValidParentType(type: string): type is ParentType {
  return type === 'class' || type === 'interface';
}
