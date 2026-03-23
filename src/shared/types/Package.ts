import type { Module } from './Module';
import type { TypeCollection } from './TypeCollection';

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
  readonly dependencies: TypeCollection<Package>;

  /**
   * The dev dependencies of the package.
   */
  readonly devDependencies: TypeCollection<Package>;

  /**
   * The peer dependencies of the package.
   */
  readonly peerDependencies: TypeCollection<Package>;

  /**
   * The modules in the package.
   */
  readonly modules: TypeCollection<Module>;
}

export interface PackageGraph {
  readonly packages: Package[];
}

export class Package implements IPackage {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly version: string,
    public readonly path: string,
    public readonly created_at: string = new Date().toISOString(),
    public readonly dependencies: TypeCollection<Package> = new Map(),
    public readonly devDependencies: TypeCollection<Package> = new Map(),
    public readonly peerDependencies: TypeCollection<Package> = new Map(),
    public readonly modules: TypeCollection<Module> = new Map()
  ) {}
}
