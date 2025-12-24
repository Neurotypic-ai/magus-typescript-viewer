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
   * The name of the interface.
   */
  name: string;

  /**
   * The creation date of the interface.
   */
  created_at: Date;

  /**
   * The methods defined in the interface.
   */
  methods: TypeCollection<Method>;

  /**
   * The properties defined in the interface.
   */
  properties: TypeCollection<Property>;

  /**
   * The interfaces that this interface extends.
   */
  extended_interfaces: TypeCollection<Interface>;
}

export class Interface implements IInterface {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly name: string,
    public readonly created_at: Date = new Date(),
    public readonly methods: TypeCollection<Method> = new Map(),
    public readonly properties: TypeCollection<Property> = new Map(),
    public readonly extended_interfaces: TypeCollection<Interface> = new Map()
  ) {}
}
