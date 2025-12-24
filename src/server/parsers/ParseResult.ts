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
}
