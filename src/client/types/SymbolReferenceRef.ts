export interface SymbolReferenceRef {
  id: string;
  package_id: string;
  module_id: string;
  source_symbol_id?: string | undefined;
  source_symbol_type: 'module' | 'class' | 'interface' | 'function' | 'method' | 'property';
  source_symbol_name?: string | undefined;
  target_symbol_id: string;
  target_symbol_type: 'method' | 'property';
  target_symbol_name: string;
  access_kind: 'method' | 'property';
  qualifier_name?: string | undefined;
}
