import type { NodeMethod } from './NodeMethod';
import type { NodeProperty } from './NodeProperty';

/**
 * Symbol data embedded in module nodes during compact mode.
 * Each entry represents a class or interface with its members.
 */
export interface EmbeddedSymbol {
  id: string;
  type: 'class' | 'interface';
  name: string;
  properties: NodeProperty[];
  methods: NodeMethod[];
}
