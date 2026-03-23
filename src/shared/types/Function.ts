import type { Parameter } from './Parameter';
import type { TypeCollection } from './TypeCollection';

/**
 * Represents a module-level function with its parameters and return type.
 */
interface IModuleFunction {
  /**
   * The unique identifier for the function.
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
   * The name of the function.
   */
  readonly name: string;

  /**
   * The creation date of the function.
   */
  readonly created_at: string;

  /**
   * The parameters of the function.
   */
  readonly parameters: TypeCollection<Parameter>;

  /**
   * The return type of the function.
   */
  readonly return_type: string;

  /**
   * Whether the function is async.
   */
  readonly is_async: boolean;

  /**
   * Whether the function is exported.
   */
  readonly is_exported: boolean;
}

export class ModuleFunction implements IModuleFunction {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly name: string,
    public readonly created_at: string = new Date().toISOString(),
    public readonly parameters: TypeCollection<Parameter> = new Map(),
    public readonly return_type = 'void',
    public readonly is_async = false,
    public readonly is_exported = false
  ) {}
}
