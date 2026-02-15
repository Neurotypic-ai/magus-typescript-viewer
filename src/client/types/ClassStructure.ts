import type { InterfaceRef } from './InterfaceRef';
import type { NodeMethod } from './NodeMethod';
import type { NodeProperty } from './NodeProperty';

/**
 * Class structure
 */
export interface ClassStructure {
  id: string;
  name: string;
  extends_id?: string;
  implemented_interfaces?: Record<string, InterfaceRef>;
  methods?: NodeMethod[];
  properties?: NodeProperty[];
  [key: string]: unknown;
}
