import { readFile, readdir } from 'fs/promises';
import { dirname, join, relative } from 'path';

import { readPackageUp } from 'read-package-up';
import { readPackage } from 'read-pkg';

import { Export } from '../../shared/types/Export';
import { PackageImport } from '../../shared/types/Import';
import { createLogger } from '../../shared/utils/logger';
import { generateExportUUID, generateImportUUID, generatePackageUUID } from '../utils/uuid';
import { ModuleParser } from './ModuleParser';

import type { NormalizedPackageJson } from 'read-pkg';

import type { Import } from '../../shared/types/Import';
import type { IClassCreateDTO } from '../db/repositories/ClassRepository';
import type { IFunctionCreateDTO } from '../db/repositories/FunctionRepository';
import type { IInterfaceCreateDTO } from '../db/repositories/InterfaceRepository';
import type { IMethodCreateDTO } from '../db/repositories/MethodRepository';
import type { IModuleCreateDTO } from '../db/repositories/ModuleRepository';
import type { IPackageCreateDTO } from '../db/repositories/PackageRepository';
import type { IParameterCreateDTO } from '../db/repositories/ParameterRepository';
import type { IPropertyCreateDTO } from '../db/repositories/PropertyRepository';
import type { ParseResult } from './ParseResult';

interface PackageDependencies {
  dependencies?: Record<string, string> | undefined;
  devDependencies?: Record<string, string> | undefined;
  peerDependencies?: Record<string, string> | undefined;
}

type PackageLock = Record<string, LockfileEntry | undefined>;

interface LockfileEntry {
  version: string;
  resolved: string;
}

export class PackageParser {
  private readonly logger = createLogger('PackageParser');

  constructor(
    private readonly packagePath: string,
    private readonly packageName: string,
    private readonly packageVersion: string
  ) {}

  private async traverseDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        const subFiles = await this.traverseDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
        // Skip declaration files
        if (!entry.name.endsWith('.d.ts')) {
          files.push(fullPath);
        }
      }
    }

    return files;
  }

  async parse(): Promise<ParseResult> {
    const packageId = generatePackageUUID(this.packageName, this.packageVersion);

    // Initialize collection maps
    const imports = new Map<string, Import>();
    const exports = new Map<string, Export>();
    const packageImports = new Map<string, PackageImport>();

    // Read package.json and package-lock.json
    const result = await readPackage({ cwd: this.packagePath });
    const pkg = result as unknown as { packageJson: NormalizedPackageJson };
    const pkgLock = await this.readPackageLock(this.packagePath);

    // Parse dependencies and collect imports/exports
    const dependencies = await this.parseDependencies(
      pkg as PackageDependencies,
      pkgLock,
      'dependencies',
      imports,
      exports,
      packageImports
    );
    const devDependencies = await this.parseDependencies(
      pkg as PackageDependencies,
      pkgLock,
      'devDependencies',
      imports,
      exports,
      packageImports
    );
    const peerDependencies = await this.parseDependencies(
      pkg as PackageDependencies,
      pkgLock,
      'peerDependencies',
      imports,
      exports,
      packageImports
    );

    // Create exports for this package
    // if (pkg.packageJson.exports && typeof pkg.packageJson.exports === 'object') {
    //   this.parseExports(pkg.packageJson.name, pkg.packageJson.exports, exports);
    // }

    // Create package DTO
    const packageDTO: IPackageCreateDTO = {
      id: packageId,
      name: this.packageName,
      version: this.packageVersion,
      path: this.packagePath,
      dependencies,
      devDependencies,
      peerDependencies,
    };

    // Parse all TypeScript files in the package
    const modules: IModuleCreateDTO[] = [];
    const classes: IClassCreateDTO[] = [];
    const interfaces: IInterfaceCreateDTO[] = [];
    const functions: IFunctionCreateDTO[] = [];
    const methods: IMethodCreateDTO[] = [];
    const properties: IPropertyCreateDTO[] = [];
    const parameters: IParameterCreateDTO[] = [];

    // Find and parse all TypeScript files
    const files = await this.traverseDirectory(this.packagePath);
    const moduleImports: Import[] = [];
    const moduleExports: Export[] = [];
    const importsWithModules: { import: Import; moduleId: string }[] = [];

    for (const file of files) {
      const moduleParser = new ModuleParser(file, packageId);
      const result = await moduleParser.parse();

      const moduleId = result.modules[0]?.id ?? '';

      modules.push(...result.modules);
      classes.push(...result.classes);
      interfaces.push(...result.interfaces);
      functions.push(...result.functions);
      methods.push(...result.methods);
      result.properties.forEach((property) => properties.push(property));
      result.parameters.forEach((parameter) => parameters.push(parameter));
      result.imports.forEach((imp) => {
        moduleImports.push(imp);
        importsWithModules.push({ import: imp, moduleId });
      });
      result.exports.forEach((exp) => moduleExports.push(exp));
    }

    return {
      package: packageDTO,
      modules,
      classes,
      interfaces,
      functions,
      methods,
      properties,
      parameters,
      imports: [...Array.from(imports.values()), ...moduleImports],
      exports: [...Array.from(exports.values()), ...moduleExports],
      importsWithModules,
    };
  }

  private async readPackageLock(packageDir: string): Promise<PackageLock> {
    try {
      const lockPath = join(packageDir, 'package-lock.json');
      const content = await readFile(lockPath, 'utf-8');
      return JSON.parse(content) as PackageLock;
    } catch {
      try {
        const lockPath = join(packageDir, 'yarn.lock');
        const content = await readFile(lockPath, 'utf-8');
        return this.parseYarnLock(content);
      } catch {
        return {};
      }
    }
  }

  private parseYarnLock(content: string): PackageLock {
    // Basic yarn.lock parser
    const deps: PackageLock = {};
    const lines = content.split('\n');
    let currentDep = '';

    for (const line of lines) {
      if (line.startsWith('"') || line.startsWith("'")) {
        const splitAt = line.split('@');
        currentDep = splitAt[0] ? splitAt[0].replace(/["']/g, '') : '';
      } else if (line.includes('version') && currentDep) {
        deps[currentDep] = {
          version: line.split('"')[1] ?? '',
          resolved: '',
        };
      } else if (line.includes('resolved') && currentDep && deps[currentDep]) {
        const entry = deps[currentDep];
        if (entry) {
          entry.resolved = line.split('"')[1] ?? '';
        }
      }
    }

    return deps;
  }

  private async resolvePackagePath(name: string): Promise<string> {
    try {
      // First try to find in node_modules directly
      const nodeModulesPath = join(this.packagePath, 'node_modules', name);
      const pkgJsonPath = join(nodeModulesPath, 'package.json');

      try {
        await readFile(pkgJsonPath, 'utf-8');
        return nodeModulesPath;
      } catch {
        // If not found in direct node_modules, try to find up the tree
        const result = await readPackageUp({ cwd: this.packagePath, normalize: false });
        if (result?.packageJson.name === name) {
          return dirname(result.path);
        }

        // If still not found, try parent node_modules
        const parentNodeModules = join(dirname(this.packagePath), 'node_modules', name);
        await readFile(join(parentNodeModules, 'package.json'), 'utf-8');
        return parentNodeModules;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not resolve package path for ${name}: ${errorMessage}`);
      return join(this.packagePath, 'node_modules', name);
    }
  }

  private async parseDependencies(
    pkg: PackageDependencies,
    pkgLock: PackageLock,
    type: 'dependencies' | 'devDependencies' | 'peerDependencies',
    _imports: Map<string, Import>,
    exports: Map<string, Export>,
    packageImports: Map<string, PackageImport>
  ): Promise<Map<string, string>> {
    const deps = pkg[type];
    const depsMap = new Map<string, string>();

    if (!deps) return depsMap;

    for (const [name, version] of Object.entries(deps)) {
      // Generate UUID for the dependency package
      const resolution = pkgLock[name]?.version ?? version;
      const dependencyId = generatePackageUUID(name, resolution);

      // Store in dependencies map with UUID as value
      depsMap.set(name, dependencyId);

      const resolved = pkgLock[name]?.resolved ?? '';

      // Create package import
      const fullPath = await this.resolvePackagePath(name);
      const relativePath = relative(this.packagePath, fullPath);
      const uuid = generateImportUUID(fullPath, name);

      const packageImport = new PackageImport(
        uuid,
        fullPath,
        relativePath,
        name,
        new Map(),
        0,
        version,
        resolution,
        resolved,
        type
      );

      packageImports.set(packageImport.uuid, packageImport);

      // Try to parse the package's own package.json for exports
      try {
        const depPkg = await readPackageUp({ cwd: dirname(fullPath) });
        if (depPkg?.packageJson.exports) {
          this.parseExports(depPkg.packageJson.name, depPkg.packageJson.exports, exports);
        }
      } catch {
        // Skip if we can't read the dependency's package.json
      }
    }

    return depsMap;
  }

  private parseExports(
    moduleName: string,
    pkgExports: NormalizedPackageJson['exports'],
    exports: Map<string, Export>
  ): void {
    if (!pkgExports) return;

    // Handle different export formats
    if (typeof pkgExports === 'string') {
      // Single export
      this.addExport(moduleName, 'default', pkgExports, true, exports);
    } else if (Array.isArray(pkgExports)) {
      // Array of exports
      pkgExports.forEach((exp, i) => {
        const exportName = `export_${String(i)}`;
        if (typeof exp === 'string') {
          this.addExport(moduleName, exportName, exp, false, exports);
        }
      });
    } else {
      // Object of named exports
      Object.entries(pkgExports).forEach(([key, value]) => {
        if (typeof value === 'string') {
          this.addExport(moduleName, key, value, key === '.', exports);
        }
      });
    }
  }

  private addExport(
    moduleName: string,
    exportName: string,
    exportValue: string,
    isDefault: boolean,
    exports: Map<string, Export>
  ): void {
    const uuid = generateExportUUID(moduleName, exportName);
    const exp = new Export(uuid, moduleName, exportName, isDefault, exportValue);
    exports.set(exp.uuid, exp);
  }
}
