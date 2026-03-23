import type { IClass } from './Class';
import type { IEnum } from './Enum';
import type { IExport } from './Export';
import type { FileLocation } from './FileLocation';
import type { IModuleFunction } from './Function';
import type { Import, IPackageImport } from './Import';
import type { IInterface } from './Interface';
import type { ISymbolReference } from './SymbolReference';
import type { ITypeAlias } from './TypeAlias';
import type { TypeCollection } from './TypeCollection';
import type { IVariable } from './Variable';

/**
 * Represents a module in a package.
 */
export interface IModule {
  /**
   * The unique identifier for the module.
   */
  readonly id: string;

  /**
   * The UUID of the parent package.
   */
  readonly package_id: string;

  /**
   * The name of the module.
   */
  readonly name: string;

  /**
   * The source location information for this module.
   */
  readonly source: FileLocation;

  /**
   * The creation date of the module.
   */
  readonly created_at: string;

  /**
   * An array of paths that reference this module.
   */
  readonly referencePaths: string[];

  /**
   * The classes defined in the module.
   */
  readonly classes: TypeCollection<IClass>;

  /**
   * The interfaces defined in the module.
   */
  readonly interfaces: TypeCollection<IInterface>;

  /**
   * The imports used in the module.
   */
  readonly imports: TypeCollection<Import>;

  /**
   * The exports provided by this module.
   */
  readonly exports: TypeCollection<IExport>;

  /**
   * The package imports used by this module.
   */
  readonly packages: TypeCollection<IPackageImport>;

  /**
   * The type aliases defined in this module.
   */
  readonly typeAliases: TypeCollection<ITypeAlias>;

  /**
   * The enums defined in this module.
   */
  readonly enums: TypeCollection<IEnum>;

  /**
   * The module-level functions defined in this module.
   */
  readonly functions: TypeCollection<IModuleFunction>;

  /**
   * The module-level variables (const/let/var) defined in this module.
   */
  readonly variables: TypeCollection<IVariable>;

  /**
   * References from symbols in this module to method/property symbols.
   */
  readonly symbol_references: TypeCollection<ISymbolReference>;
}

export class Module implements IModule {
  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly name: string,
    public readonly source: FileLocation,
    public readonly created_at: string = new Date().toISOString(),
    public readonly classes: TypeCollection<IClass> = new Map(),
    public readonly interfaces: TypeCollection<IInterface> = new Map(),
    public readonly imports: TypeCollection<Import> = new Map(),
    public readonly exports: TypeCollection<IExport> = new Map(),
    public readonly packages: TypeCollection<IPackageImport> = new Map(),
    public readonly typeAliases: TypeCollection<ITypeAlias> = new Map(),
    public readonly enums: TypeCollection<IEnum> = new Map(),
    public readonly functions: TypeCollection<IModuleFunction> = new Map(),
    public readonly variables: TypeCollection<IVariable> = new Map(),
    public readonly referencePaths: string[] = [],
    public readonly symbol_references: TypeCollection<ISymbolReference> = new Map()
  ) {}
}
