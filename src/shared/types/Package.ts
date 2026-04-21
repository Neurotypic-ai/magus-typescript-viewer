import type { IModule } from './Module';
import type { TypeCollection } from './TypeCollection';

/**
 * Scope of a package.json declared dependency, used to classify edges from a
 * module to an external npm package.
 */
export type PackageJsonDepScope = 'dependency' | 'devDependency' | 'peerDependency';

/**
 * Map of `packageName -> declared scope` for a workspace package's declared
 * package.json dependencies. Stored on the `Package` (rather than the
 * `dependencies` junction table) because external npm packages are never
 * `packages` rows and the junction table's FK silently rejects them.
 */
export type ExternalDepsByName = Record<string, PackageJsonDepScope>;

/**
 * Represents a package with its dependencies and modules.
 */
export interface IPackage {
  /**
   * The unique identifier for the package.
   */
  readonly id: string;

  /**
   * The name of the package.
   */
  readonly name: string;

  /**
   * The version of the package.
   */
  readonly version: string;

  /**
   * The path to the package.
   */
  readonly path: string;

  /**
   * The creation date of the package.
   */
  readonly created_at: string;

  /**
   * The dependencies of the package.
   */
  readonly dependencies: TypeCollection<IPackage>;

  /**
   * The dev dependencies of the package.
   */
  readonly devDependencies: TypeCollection<IPackage>;

  /**
   * The peer dependencies of the package.
   */
  readonly peerDependencies: TypeCollection<IPackage>;

  /**
   * The modules in the package.
   */
  readonly modules: TypeCollection<IModule>;

  /**
   * Package.json-declared deps keyed by package name and mapped to scope.
   * Includes external npm packages that have no row in the `packages` table.
   */
  readonly externalDepsByName?: ExternalDepsByName;
}

export interface PackageGraph {
  readonly packages: Package[];
}

export class Package implements IPackage {
  // externalDepsByName is typed as optional to match IPackage and to let
  // existing test fixtures (and older DB rows that predate the column)
  // construct Package objects without specifying it.
  public readonly externalDepsByName?: ExternalDepsByName;

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly version: string,
    public readonly path: string,
    public readonly created_at: string = new Date().toISOString(),
    public readonly dependencies: TypeCollection<IPackage> = new Map(),
    public readonly devDependencies: TypeCollection<IPackage> = new Map(),
    public readonly peerDependencies: TypeCollection<IPackage> = new Map(),
    public readonly modules: TypeCollection<IModule> = new Map(),
    externalDepsByName?: ExternalDepsByName
  ) {
    if (externalDepsByName !== undefined) {
      this.externalDepsByName = externalDepsByName;
    }
  }
}
