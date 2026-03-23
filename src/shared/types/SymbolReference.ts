import type { ParentType } from './ParentType';

export type SymbolSourceType = 'module' | ParentType | 'function' | 'method' | 'property';
export type SymbolTargetType = 'method' | 'property';

export interface ISymbolReference {
  readonly id: string;
  readonly package_id: string;
  readonly module_id: string;
  readonly source_symbol_id?: string | undefined;
  readonly source_symbol_type: SymbolSourceType;
  readonly source_symbol_name?: string | undefined;
  readonly target_symbol_id: string;
  readonly target_symbol_type: SymbolTargetType;
  readonly target_symbol_name: string;
  readonly access_kind: SymbolTargetType;
  readonly qualifier_name?: string | undefined;
  readonly created_at: string;
}

export class SymbolReference implements ISymbolReference {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly module_id: string,
    public readonly source_symbol_type: SymbolSourceType,
    public readonly target_symbol_id: string,
    public readonly target_symbol_type: SymbolTargetType,
    public readonly target_symbol_name: string,
    public readonly access_kind: SymbolTargetType,
    public readonly created_at: string = new Date().toISOString(),
    public readonly source_symbol_id?: string,
    public readonly source_symbol_name?: string,
    public readonly qualifier_name?: string
  ) {}
}
