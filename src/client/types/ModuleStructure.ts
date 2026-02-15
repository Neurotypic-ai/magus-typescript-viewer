import type { ImportRef } from './ImportRef';
import type { SymbolReferenceRef } from './SymbolReferenceRef';
import type { ClassStructure } from './ClassStructure';
import type { InterfaceStructure } from './InterfaceStructure';
import type { FunctionStructure } from './FunctionStructure';
import type { TypeAliasStructure } from './TypeAliasStructure';
import type { EnumStructure } from './EnumStructure';
import type { VariableStructure } from './VariableStructure';

/**
 * Module structure
 */
export interface ModuleStructure {
  id: string;
  name: string;
  package_id: string;
  source: {
    relativePath: string;
    [key: string]: unknown;
  };
  imports?: Record<string, ImportRef>;
  symbol_references?: Record<string, SymbolReferenceRef>;
  classes?: Record<string, ClassStructure>;
  interfaces?: Record<string, InterfaceStructure>;
  functions?: Record<string, FunctionStructure>;
  typeAliases?: Record<string, TypeAliasStructure>;
  enums?: Record<string, EnumStructure>;
  variables?: Record<string, VariableStructure>;
  [key: string]: unknown;
}
