import type { Parameter } from './Parameter';
import type { TypeCollection } from './TypeCollection';

/**
 * Type guard to check if a value is a Function
 */
export function isFunction(value: unknown): value is ModuleFunction {
  return value instanceof ModuleFunction;
}

/**
 * Represents a module-level function with its parameters and return type.
 */
export interface IModuleFunction {
  /**
   * The unique identifier for the function.
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
   * The name of the function.
   */
  name: string;

  /**
   * The creation date of the function.
   */
  created_at: Date;

  /**
   * The parameters of the function.
   */
  parameters: TypeCollection<Parameter>;

  /**
   * The return type of the function.
   */
  return_type: string;

  /**
   * Whether the function is async.
   */
  is_async: boolean;

  /**
   * Whether the function is exported.
   */
  is_exported: boolean;
}

export class ModuleFunction implements IModuleFunction {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly name: string,
    public readonly created_at: Date = new Date(),
    public readonly parameters: TypeCollection<Parameter> = new Map(),
    public readonly return_type = 'void',
    public readonly is_async = false,
    public readonly is_exported = false
  ) {}
}
