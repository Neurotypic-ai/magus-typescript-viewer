import type { InterfaceRef } from './InterfaceRef';
import type { NodeMethod } from './NodeMethod';
import type { NodeProperty } from './NodeProperty';

/**
 * Interface structure
 */
export interface InterfaceStructure {
  id: string;
  name: string;
  extended_interfaces?: Record<string, InterfaceRef>;
  methods?: NodeMethod[];
  properties?: NodeProperty[];
  [key: string]: unknown;
}
