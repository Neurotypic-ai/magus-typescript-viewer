export type SymbolSourceType = 'module' | 'class' | 'interface' | 'function' | 'method' | 'property';
export type SymbolTargetType = 'method' | 'property';

export interface ISymbolReference {
  id: string;
  package_id: string;
  module_id: string;
  source_symbol_id?: string | undefined;
  source_symbol_type: SymbolSourceType;
  source_symbol_name?: string | undefined;
  target_symbol_id: string;
  target_symbol_type: SymbolTargetType;
  target_symbol_name: string;
  access_kind: SymbolTargetType;
  qualifier_name?: string | undefined;
  created_at: Date;
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
    public readonly created_at: Date = new Date(),
    public readonly source_symbol_id?: string,
    public readonly source_symbol_name?: string,
    public readonly qualifier_name?: string
  ) {}
}
