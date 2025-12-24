/**
 * Represents a type alias in TypeScript.
 */
export interface ITypeAlias {
  /**
   * The unique identifier for the type alias.
   */
  uuid: string;

  /**
   * The name of the type alias.
   */
  name: string;

  /**
   * An array of type parameter names, if any.
   */
  typeParameters: string[];

  /**
   * The resolved type name or description.
   */
  type: string;
}

export class TypeAlias implements ITypeAlias {
  constructor(
    public readonly uuid: string,
    public readonly name: string,
    public readonly typeParameters: string[] = [],
    public readonly type: string
  ) {}
}
