/**
 * Entity embedded in a module node (simpler than EmbeddedSymbol since these don't have properties/methods)
 */
export interface EmbeddedModuleEntity {
  id: string;
  type: 'function' | 'type' | 'enum' | 'const' | 'var';
  name: string;
  detail: string;
  tags?: string[] | undefined;
}
