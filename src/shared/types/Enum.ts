/**
 * Represents an enumeration in TypeScript.
 */
export interface IEnum {
  /**
   * The unique identifier for the enum
   */
  readonly id: string;

  /**
   * The UUID of the parent package
   */
  readonly package_id: string;

  /**
   * The UUID of the parent module
   */
  readonly module_id: string;

  /**
   * The name of the enum
   */
  readonly name: string;

  /**
   * An array of enum member names
   */
  readonly members: string[];

  /**
   * The creation date of the enum
   */
  readonly created_at: string;
}

export class Enum implements IEnum {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly name: string,
    public readonly members: string[] = [],
    public readonly created_at: string = new Date().toISOString()
  ) {}
}
