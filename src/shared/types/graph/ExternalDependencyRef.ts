import type { IImportSpecifier } from '../Import';

export interface ExternalDependencyRef {
  packageName: string;
  symbols: string[];
  specifiers?: IImportSpecifier[];
}
