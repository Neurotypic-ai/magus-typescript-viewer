/**
 * Provides information about the specifiers used in an import.
 */
export interface IImportSpecifier {
  /**
   * A unique identifier generated from the name of the specifier or kind_name if kind is 'type'.
   * For example, `import type Location` vs `import ModuleDefinition`.
   */
  readonly uuid: string;

  /**
   * The UUID of the export that this import references.
   */
  readonly exportRef?: string | undefined;

  /**
   * The canonical name of the specifier. This should be the name of the export from the module.
   */
  readonly name: string;

  /**
   * The UUIDs of the components that reference this import.
   */
  modules: Set<string>;

  /**
   * The other names that the import is referenced by.
   */
  aliases: Set<string>;

  /**
   * The kind of the specifier.
   */
  readonly kind: 'value' | 'type' | 'typeof' | 'default' | 'namespace' | 'sideEffect';
}

/**
 * Class implementation for ImportSpecifier.
 */
export class ImportSpecifier implements IImportSpecifier {
  constructor(
    public readonly uuid: string,
    public readonly name: string,
    public readonly kind: 'value' | 'type' | 'typeof' | 'default' | 'namespace' | 'sideEffect',
    public readonly exportRef?: string | undefined,
    public readonly modules: Set<string> = new Set(),
    public readonly aliases: Set<string> = new Set()
  ) {}
}

/**
 * Represents an import statement in TypeScript.
 */
export interface IImport {
  /**
   * The UUID for the corresponding export.
   */
  readonly uuid: string;

  /**
   * The full import path.
   */
  readonly fullPath: string;

  /**
   * The relative path of the import to the source path
   */
  readonly relativePath: string;

  /**
   * The name of the import (e.g., 'MyComponent').
   */
  readonly name: string;

  /**
   * The import specifiers.
   */
  readonly specifiers: Map<string, IImportSpecifier>;

  /**
   * The depth of the import in the dependency tree.
   * Indicates how many nested or included components this file is from using only functions from a node module.
   */
  readonly depth: number;
}

/**
 * Class implementation for Import.
 */
export class Import implements IImport {
  constructor(
    public readonly uuid: string,
    public readonly fullPath: string,
    public readonly relativePath: string,
    public readonly name: string,
    public readonly specifiers: Map<string, IImportSpecifier> = new Map(),
    public readonly depth = 0
  ) {}
}

/**
 * Extends Import with additional package-specific information.
 */
export interface IPackageImport extends IImport {
  /**
   * The version of the package.
   */
  readonly version?: string | undefined;

  /**
   * The resolution of the package.
   * Represents the resolved version of the package from yarn.lock.
   */
  readonly resolution?: string | undefined;

  /**
   * The resolved version of the package.
   */
  readonly resolved?: string | undefined;

  /**
   * The type of dependency (e.g., 'dependencies', 'devDependencies', 'peerDependencies').
   */
  readonly type?: 'dependencies' | 'devDependencies' | 'peerDependencies' | undefined;
}

/**
 * Class implementation for PackageImport.
 */
export class PackageImport extends Import implements IPackageImport {
  constructor(
    uuid: string,
    fullPath: string,
    relativePath: string,
    name: string,
    specifiers: Map<string, IImportSpecifier>,
    depth: number,
    public readonly version?: string | undefined,
    public readonly resolution?: string | undefined,
    public readonly resolved?: string | undefined,
    public readonly type?: 'dependencies' | 'devDependencies' | 'peerDependencies' | undefined
  ) {
    super(uuid, fullPath, relativePath, name, specifiers, depth);
  }
}
