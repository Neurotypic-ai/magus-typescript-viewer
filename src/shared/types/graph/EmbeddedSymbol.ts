import type { IMethod } from '../Method';
import type { ParentType } from '../ParentType';
import type { IProperty } from '../Property';

/**
 * Symbol data embedded in module nodes during compact mode.
 * Each entry represents a class or interface with its members.
 */
export interface EmbeddedSymbol {
  id: string;
  type: ParentType;
  name: string;
  properties: IProperty[];
  methods: IMethod[];
}
