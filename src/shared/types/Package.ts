import type { Module } from './Module';
import type { TypeCollection } from './TypeCollection';

/**
 * Represents a package with its dependencies and modules.
 */
export interface IPackage {
  /**
   * The unique identifier for the package.
   */
  id: string;

  /**
   * The name of the package.
   */
  name: string;

  /**
   * The version of the package.
   */
  version: string;

  /**
   * The path to the package.
   */
  path: string;

  /**
   * The creation date of the package.
   */
  created_at: Date;

  /**
   * The dependencies of the package.
   */
  dependencies: TypeCollection<Package>;

  /**
   * The dev dependencies of the package.
   */
  devDependencies: TypeCollection<Package>;

  /**
   * The peer dependencies of the package.
   */
  peerDependencies: TypeCollection<Package>;

  /**
   * The modules in the package.
   */
  modules: TypeCollection<Module>;
}

export class Package implements IPackage {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly version: string,
    public readonly path: string,
    public readonly created_at: Date = new Date(),
    public readonly dependencies: TypeCollection<Package> = new Map(),
    public readonly devDependencies: TypeCollection<Package> = new Map(),
    public readonly peerDependencies: TypeCollection<Package> = new Map(),
    public readonly modules: TypeCollection<Module> = new Map()
  ) {}
}
