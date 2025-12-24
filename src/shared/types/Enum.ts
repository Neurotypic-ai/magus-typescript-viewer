/**
 * Represents an enumeration in TypeScript.
 */
export interface IEnum {
  /**
   * The unique identifier for the enum
   */
  id: string;

  /**
   * The UUID of the parent package
   */
  package_id: string;

  /**
   * The UUID of the parent module
   */
  module_id: string;

  /**
   * The name of the enum
   */
  name: string;

  /**
   * An array of enum member names
   */
  members: string[];

  /**
   * The creation date of the enum
   */
  created_at: Date;
}

export class Enum implements IEnum {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly name: string,
    public readonly members: string[] = [],
    public readonly created_at: Date = new Date()
  ) {}
}
