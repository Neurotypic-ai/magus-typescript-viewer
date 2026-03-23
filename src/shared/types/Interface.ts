import type { Method } from './Method';
import type { Property } from './Property';
import type { TypeCollection } from './TypeCollection';

/**
 * Type guard to check if a parent is an Interface
 */
export function isInterface(parent: unknown): parent is Interface {
  return parent instanceof Interface;
}

/**
 * Represents an interface with its methods and properties.
 */
export interface IInterface {
  /**
   * The unique identifier for the interface.
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
   * The name of the interface.
   */
  readonly name: string;

  /**
   * The creation date of the interface.
   */
  readonly created_at: string;

  /**
   * The methods defined in the interface.
   */
  readonly methods: TypeCollection<Method>;

  /**
   * The properties defined in the interface.
   */
  readonly properties: TypeCollection<Property>;

  /**
   * The interfaces that this interface extends.
   */
  readonly extended_interfaces: TypeCollection<Interface>;
}

export class Interface implements IInterface {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly name: string,
    public readonly created_at: string = new Date().toISOString(),
    public readonly methods: TypeCollection<Method> = new Map(),
    public readonly properties: TypeCollection<Property> = new Map(),
    public readonly extended_interfaces: TypeCollection<Interface> = new Map()
  ) {}
}
