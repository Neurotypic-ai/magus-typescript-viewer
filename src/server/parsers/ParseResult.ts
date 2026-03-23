import type { Export } from '../../shared/types/Export';
import type { Import } from '../../shared/types/Import';
import type { IClassCreateDTO } from '../../shared/types/dto/ClassDTO';
import type { IEnumCreateDTO } from '../../shared/types/dto/EnumDTO';
import type { IFunctionCreateDTO } from '../../shared/types/dto/FunctionDTO';
import type { IInterfaceCreateDTO } from '../../shared/types/dto/InterfaceDTO';
import type { IMethodCreateDTO } from '../../shared/types/dto/MethodDTO';
import type { IModuleCreateDTO } from '../../shared/types/dto/ModuleDTO';
import type { IPackageCreateDTO } from '../../shared/types/dto/PackageDTO';
import type { IParameterCreateDTO } from '../../shared/types/dto/ParameterDTO';
import type { IPropertyCreateDTO } from '../../shared/types/dto/PropertyDTO';
import type { ISymbolReferenceCreateDTO } from '../../shared/types/dto/SymbolReferenceDTO';
import type { ITypeAliasCreateDTO } from '../../shared/types/dto/TypeAliasDTO';
import type { IVariableCreateDTO } from '../../shared/types/dto/VariableDTO';

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
  typeAliases: ITypeAliasCreateDTO[];
  enums: IEnumCreateDTO[];
  variables: IVariableCreateDTO[];
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
