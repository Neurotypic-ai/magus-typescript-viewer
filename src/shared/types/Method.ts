import type { Parameter } from './Parameter';
import type { TypeCollection } from './TypeCollection';

/**
 * Type guard to check if a parent is a Method
 */
export function isMethod(parent: unknown): parent is Method {
  return parent instanceof Method;
}

/**
 * Represents a method with its parameters and return type.
 */
export interface IMethod {
  /**
   * The unique identifier for the method.
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
   * The name of the method.
   */
  readonly name: string;

  /**
   * The creation date of the method.
   */
  readonly created_at: string;

  /**
   * The parameters of the method.
   */
  readonly parameters: TypeCollection<Parameter>;

  /**
   * The return type of the method.
   */
  readonly return_type: string;

  /**
   * Whether the method is static.
   */
  readonly is_static: boolean;

  /**
   * Whether the method is async.
   */
  readonly is_async: boolean;

  /**
   * The visibility of the method (public, private, protected).
   */
  readonly visibility: string;

  /**
   * Display signature for UI rendering.
   */
  readonly signature: string;
}

export class Method implements IMethod {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly parent_id: string,
    public readonly name: string,
    public readonly created_at: string = new Date().toISOString(),
    public readonly parameters: TypeCollection<Parameter> = new Map(),
    public readonly return_type = 'void',
    public readonly is_static = false,
    public readonly is_async = false,
    public readonly visibility = 'public'
  ) {}

  get signature(): string {
    const parameters =
      this.parameters instanceof Map
        ? [...this.parameters.values()]
        : Array.isArray(this.parameters)
          ? this.parameters
          : Object.values(this.parameters);
    const params = parameters.map((parameter) => `${parameter.name}: ${parameter.type}`).join(', ');
    return `${this.name}(${params}): ${this.return_type}`;
  }
}
