/**
 * Type guard to check if a parent is a Parameter
 */
export function isParameter(parent: unknown): parent is Parameter {
  return parent instanceof Parameter;
}

/**
 * Represents a parameter in a method.
 */
export interface IParameter {
  /**
   * The unique identifier for the parameter.
   */
  id: string;

  /**
   * The UUID of the parent package.
   */
  package_id: string;

  /**
   * The UUID of the parent module.
   */
  module_id: string;

  /**
   * The UUID of the parent method.
   */
  method_id: string;

  /**
   * The name of the parameter.
   */
  name: string;

  /**
   * The creation date of the parameter.
   */
  created_at: Date;

  /**
   * The type of the parameter.
   */
  type: string;

  /**
   * Whether the parameter is optional.
   */
  is_optional: boolean;

  /**
   * Whether the parameter is a rest parameter.
   */
  is_rest: boolean;

  /**
   * The default value of the parameter, if any.
   */
  default_value: string | undefined;
}

export class Parameter implements IParameter {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly method_id: string,
    public readonly name: string,
    public readonly created_at: Date = new Date(),
    public readonly type = 'any',
    public readonly is_optional = false,
    public readonly is_rest = false,
    public readonly default_value: string | undefined = undefined
  ) {}
}
