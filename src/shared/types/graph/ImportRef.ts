import type { ImportSpecifierRef } from './ImportSpecifierRef';

/**
 * Import structure
 */
export interface ImportRef {
  uuid: string;
  name?: string;
  path?: string;
  isExternal?: boolean;
  packageName?: string;
  specifiers?: ImportSpecifierRef[];
}
