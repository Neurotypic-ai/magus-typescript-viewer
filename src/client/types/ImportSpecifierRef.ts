export interface ImportSpecifierRef {
  imported: string;
  local?: string;
  kind: 'value' | 'type' | 'default' | 'namespace' | 'sideEffect';
}
