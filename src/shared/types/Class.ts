import type { Interface } from './Interface';
import type { Method } from './Method';
import type { Property } from './Property';
import type { TypeCollection } from './TypeCollection';

/**
 * Type guard to check if a parent is a Class
 */
export function isClass(parent: unknown): parent is Class {
  return parent instanceof Class;
}

/**
 * Represents a class with its methods, properties, and relationships.
 */
export interface IClass {
  /**
   * The unique identifier for the class.
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
   * The name of the class.
   */
  name: string;

  /**
   * The creation date of the class.
   */
  created_at: Date;

  /**
   * The methods defined in the class.
   */
  methods: TypeCollection<Method>;

  /**
   * The properties defined in the class.
   */
  properties: TypeCollection<Property>;

  /**
   * The interfaces implemented by the class.
   */
  implemented_interfaces: TypeCollection<Interface>;

  /**
   * The ID of the parent class (if this class extends another).
   */
  extends_id?: string | undefined;
}

export class Class implements IClass {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly name: string,
    public readonly created_at: Date = new Date(),
    public readonly methods: TypeCollection<Method> = new Map(),
    public readonly properties: TypeCollection<Property> = new Map(),
    public readonly implemented_interfaces: TypeCollection<Interface> = new Map(),
    public readonly extends_id?: string
  ) {}
}
