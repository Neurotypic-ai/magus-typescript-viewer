import type { SymbolSourceType, SymbolTargetType } from '../SymbolReference';

/**
 * Data transfer object for creating a symbol reference row.
 */
export interface ISymbolReferenceCreateDTO {
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
}

export interface ISymbolReferenceUpdateDTO {
  source_symbol_id?: string;
  source_symbol_type?: SymbolSourceType;
  source_symbol_name?: string;
  target_symbol_id?: string;
  target_symbol_type?: SymbolTargetType;
  target_symbol_name?: string;
  access_kind?: SymbolTargetType;
  qualifier_name?: string;
}
