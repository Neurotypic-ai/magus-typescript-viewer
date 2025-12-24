import type { Class } from './Class';
import type { Enum } from './Enum';
import type { Export } from './Export';
import type { FileLocation } from './FileLocation';
import type { Import, PackageImport } from './Import';
import type { Interface } from './Interface';
import type { TypeAlias } from './TypeAlias';
import type { TypeCollection } from './TypeCollection';

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
  readonly created_at: Date;

  /**
   * An array of paths that reference this module.
   */
  readonly referencePaths: string[];

  /**
   * The classes defined in the module.
   */
  readonly classes: TypeCollection<Class>;

  /**
   * The interfaces defined in the module.
   */
  readonly interfaces: TypeCollection<Interface>;

  /**
   * The imports used in the module.
   */
  readonly imports: TypeCollection<Import>;

  /**
   * The exports provided by this module.
   */
  readonly exports: TypeCollection<Export>;

  /**
   * The package imports used by this module.
   */
  readonly packages: TypeCollection<PackageImport>;

  /**
   * The type aliases defined in this module.
   */
  readonly typeAliases: TypeCollection<TypeAlias>;

  /**
   * The enums defined in this module.
   */
  readonly enums: TypeCollection<Enum>;
}

export class Module implements IModule {
  /**
   * The UUID namespace for generating unique identifiers for Module instances.
   */
  static readonly UUID_NAMESPACE = 'e32ec4a1-3efb-4393-a5a6-00a82d336089';

  constructor(
    public readonly id: string,
    public readonly package_id: string,
    public readonly name: string,
    public readonly source: FileLocation,
    public readonly created_at: Date = new Date(),
    public readonly classes: TypeCollection<Class> = new Map(),
    public readonly interfaces: TypeCollection<Interface> = new Map(),
    public readonly imports: TypeCollection<Import> = new Map(),
    public readonly exports: TypeCollection<Export> = new Map(),
    public readonly packages: TypeCollection<PackageImport> = new Map(),
    public readonly typeAliases: TypeCollection<TypeAlias> = new Map(),
    public readonly enums: TypeCollection<Enum> = new Map(),
    public readonly referencePaths: string[] = []
  ) {}
}
