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
   * The UUID of the parent class or interface.
   */
  parent_id: string;

  /**
   * The name of the method.
   */
  name: string;

  /**
   * The creation date of the method.
   */
  created_at: Date;

  /**
   * The parameters of the method.
   */
  parameters: TypeCollection<Parameter>;

  /**
   * The return type of the method.
   */
  return_type: string;

  /**
   * Whether the method is static.
   */
  is_static: boolean;

  /**
   * Whether the method is async.
   */
  is_async: boolean;

  /**
   * The visibility of the method (public, private, protected).
   */
  visibility: string;
}

export class Method implements IMethod {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly parent_id: string,
    public readonly name: string,
    public readonly created_at: Date = new Date(),
    public readonly parameters: TypeCollection<Parameter> = new Map(),
    public readonly return_type = 'void',
    public readonly is_static = false,
    public readonly is_async = false,
    public readonly visibility = 'public'
  ) {}
}
