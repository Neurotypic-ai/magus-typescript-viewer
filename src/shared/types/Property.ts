export type ParentType = 'class' | 'interface';

/**
 * Type guard to check if a parent type is valid
 */
export function isValidParentType(type: string): type is ParentType {
  return type === 'class' || type === 'interface';
}

/**
 * Type guard to check if a parent is a Property
 */
export function isProperty(parent: unknown): parent is Property {
  return parent instanceof Property;
}

/**
 * Represents a property in a class or interface.
 */
export interface IProperty {
  /**
   * The unique identifier for the property.
   */
  readonly id: string;

  /**
   * The UUID of the parent package.
   */
  readonly package_id: string;

  /**
   * The UUID of the parent module.
   */
  readonly module_id: string;

  /**
   * The UUID of the parent class or interface.
   */
  readonly parent_id: string;

  /**
   * The name of the property.
   */
  readonly name: string;

  /**
   * The creation date of the property.
   */
  readonly created_at: string;

  /**
   * The type of the property.
   */
  readonly type: string;

  /**
   * Whether the property is static.
   */
  readonly is_static: boolean;

  /**
   * Whether the property is readonly.
   */
  readonly is_readonly: boolean;

  /**
   * The visibility of the property (public, private, protected).
   */
  readonly visibility: string;

  /**
   * The default value of the property, if any.
   */
  readonly default_value: string | undefined;
}

export class Property implements IProperty {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly parent_id: string,
    public readonly name: string,
    public readonly created_at: string = new Date().toISOString(),
    public readonly type = 'any',
    public readonly is_static = false,
    public readonly is_readonly = false,
    public readonly visibility = 'public',
    public readonly default_value: string | undefined = undefined
  ) {}
}
