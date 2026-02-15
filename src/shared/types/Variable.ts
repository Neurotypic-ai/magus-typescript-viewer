/**
 * Represents a module-level variable (const, let, or var) in TypeScript.
 */
export interface IVariable {
  readonly id: string;
  readonly package_id: string;
  readonly module_id: string;
  readonly name: string;
  readonly kind: 'const' | 'let' | 'var';
  readonly type: string;
  readonly initializer?: string;
  readonly created_at: Date;
}

export class Variable implements IVariable {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly name: string,
    public readonly kind: 'const' | 'let' | 'var',
    public readonly type: string = 'unknown',
    public readonly initializer: string = '',
    public readonly created_at: Date = new Date()
  ) {}
}
