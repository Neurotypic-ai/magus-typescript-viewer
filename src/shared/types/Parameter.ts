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
   * The UUID of the parent method.
   */
  readonly method_id: string;

  /**
   * The name of the parameter.
   */
  readonly name: string;

  /**
   * The creation date of the parameter.
   */
  readonly created_at: string;

  /**
   * The type of the parameter.
   */
  readonly type: string;

  /**
   * Whether the parameter is optional.
   */
  readonly is_optional: boolean;

  /**
   * Whether the parameter is a rest parameter.
   */
  readonly is_rest: boolean;

  /**
   * The default value of the parameter, if any.
   */
  readonly default_value?: string | undefined;
}

export class Parameter implements IParameter {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly method_id: string,
    public readonly name: string,
    public readonly created_at: string = new Date().toISOString(),
    public readonly type = 'any',
    public readonly is_optional = false,
    public readonly is_rest = false,
    public readonly default_value?: string | undefined
  ) {}
}
