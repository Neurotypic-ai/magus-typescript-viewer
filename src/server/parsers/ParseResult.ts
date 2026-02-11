import type { Export } from '../../shared/types/Export';
import type { Import } from '../../shared/types/Import';
import type { IClassCreateDTO } from '../db/repositories/ClassRepository';
import type { IFunctionCreateDTO } from '../db/repositories/FunctionRepository';
import type { IInterfaceCreateDTO } from '../db/repositories/InterfaceRepository';
import type { IMethodCreateDTO } from '../db/repositories/MethodRepository';
import type { IModuleCreateDTO } from '../db/repositories/ModuleRepository';
import type { IPackageCreateDTO } from '../db/repositories/PackageRepository';
import type { IParameterCreateDTO } from '../db/repositories/ParameterRepository';
import type { IPropertyCreateDTO } from '../db/repositories/PropertyRepository';
import type { ISymbolReferenceCreateDTO } from '../db/repositories/SymbolReferenceRepository';

/**
 * Represents a deferred relationship between a class and its parent class.
 * Stored as a name reference during parsing, resolved to UUIDs after all modules are parsed.
 */
export interface ClassExtendsRef {
  classId: string;
  parentName: string;
  parentId?: string | undefined;
}

/**
 * Represents a deferred relationship between a class and an interface it implements.
 */
export interface ClassImplementsRef {
  classId: string;
  interfaceName: string;
  interfaceId?: string | undefined;
}

/**
 * Represents a deferred relationship between an interface and a parent interface it extends.
 */
export interface InterfaceExtendsRef {
  interfaceId: string;
  parentName: string;
  parentId?: string | undefined;
}

export interface SymbolUsageRef {
  moduleId: string;
  sourceSymbolId?: string | undefined;
  sourceSymbolType: 'method' | 'function';
  sourceSymbolName?: string | undefined;
  sourceParentName?: string | undefined;
  sourceParentType?: 'class' | 'interface' | undefined;
  targetName: string;
  targetKind: 'method' | 'property';
  qualifierName?: string | undefined;
}

export interface ParseResult {
  package?: IPackageCreateDTO | undefined;
  modules: IModuleCreateDTO[];
  classes: IClassCreateDTO[];
  interfaces: IInterfaceCreateDTO[];
  functions: IFunctionCreateDTO[];
  methods: IMethodCreateDTO[];
  properties: IPropertyCreateDTO[];
  parameters: IParameterCreateDTO[];
  imports: Import[];
  exports: Export[];
  importsWithModules?: { import: Import; moduleId: string }[];

  /** Deferred class extends relationships (name-based, resolved after all modules are parsed) */
  classExtends: ClassExtendsRef[];
  /** Deferred class implements relationships (name-based, resolved after all modules are parsed) */
  classImplements: ClassImplementsRef[];
  /** Deferred interface extends relationships (name-based, resolved after all modules are parsed) */
  interfaceExtends: InterfaceExtendsRef[];

  /** Raw symbol usages captured by parser before name resolution */
  symbolUsages: SymbolUsageRef[];
  /** Resolved symbol references to persist */
  symbolReferences: ISymbolReferenceCreateDTO[];
}
