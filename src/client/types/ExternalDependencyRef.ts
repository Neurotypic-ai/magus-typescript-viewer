import type { ImportSpecifierRef } from './ImportSpecifierRef';

export interface ExternalDependencyRef {
  packageName: string;
  symbols: string[];
  specifiers?: ImportSpecifierRef[];
}
