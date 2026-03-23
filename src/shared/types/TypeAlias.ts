/**
 * Represents a type alias in TypeScript.
 */
export interface ITypeAlias {
  readonly id: string;
  readonly package_id: string;
  readonly module_id: string;
  readonly name: string;
  readonly type_parameters: string[];
  readonly type: string;
  readonly created_at: string;
}

export class TypeAlias implements ITypeAlias {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly name: string,
    public readonly type: string,
    public readonly type_parameters: string[] = [],
    public readonly created_at: string = new Date().toISOString()
  ) {}
}
