import { readFile, readdir } from 'fs/promises';
import { dirname, join, relative } from 'path';

import { readPackageUp } from 'read-package-up';
import { readPackage } from 'read-pkg';

import { Export } from '../../shared/types/Export';
import { PackageImport } from '../../shared/types/Import';
import { createLogger } from '../../shared/utils/logger';
import { generateExportUUID, generateImportUUID, generatePackageUUID, generateRelationshipUUID } from '../utils/uuid';
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
import type { ISymbolReferenceCreateDTO } from '../db/repositories/SymbolReferenceRepository';
import type { ParseResult, SymbolUsageRef } from './ParseResult';

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

interface DeferredClassExtendsRef {
  classId: string;
  parentName: string;
  parentId?: string | undefined;
}

interface DeferredClassImplementsRef {
  classId: string;
  interfaceName: string;
  interfaceId?: string | undefined;
}

interface DeferredInterfaceExtendsRef {
  interfaceId: string;
  parentName: string;
  parentId?: string | undefined;
}

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/i;
const VUE_SCRIPT_BLOCK_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

export class PackageParser {
  private readonly logger = createLogger('PackageParser');

  constructor(
    private readonly packagePath: string,
    private readonly packageName: string,
    private readonly packageVersion: string
  ) {}

  private isAnalyzableSourceFile(fileName: string): boolean {
    if (!SOURCE_FILE_PATTERN.test(fileName)) {
      return false;
    }

    // Skip declaration files (e.g. .d.ts)
    if (/\.d\.[cm]?tsx?$/i.test(fileName)) {
      return false;
    }

    return true;
  }

  private addNameMapping(nameMap: Map<string, string[]>, name: string, id: string): void {
    const existing = nameMap.get(name);
    if (existing) {
      if (!existing.includes(id)) {
        existing.push(id);
      }
      return;
    }

    nameMap.set(name, [id]);
  }

  private resolveUniqueName(nameMap: Map<string, string[]>, name: string): string | undefined {
    const ids = nameMap.get(name);
    if (ids?.length !== 1) {
      return undefined;
    }
    return ids[0];
  }

  private buildParentMemberKey(parentId: string, memberName: string): string {
    return `${parentId}:${memberName}`;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    return value as Record<string, unknown>;
  }

  private asString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    return value;
  }

  private parseClassExtendsRefs(refs: unknown): DeferredClassExtendsRef[] {
    if (!Array.isArray(refs)) {
      return [];
    }

    const parsedRefs: DeferredClassExtendsRef[] = [];
    for (const ref of refs) {
      const parsedRef = this.asRecord(ref);
      if (!parsedRef) {
        continue;
      }

      const classId = this.asString(parsedRef['classId']);
      const parentName = this.asString(parsedRef['parentName']);
      if (!classId || !parentName) {
        continue;
      }

      const parentId = this.asString(parsedRef['parentId']);
      parsedRefs.push(parentId ? { classId, parentName, parentId } : { classId, parentName });
    }

    return parsedRefs;
  }

  private parseClassImplementsRefs(refs: unknown): DeferredClassImplementsRef[] {
    if (!Array.isArray(refs)) {
      return [];
    }

    const parsedRefs: DeferredClassImplementsRef[] = [];
    for (const ref of refs) {
      const parsedRef = this.asRecord(ref);
      if (!parsedRef) {
        continue;
      }

      const classId = this.asString(parsedRef['classId']);
      const interfaceName = this.asString(parsedRef['interfaceName']);
      if (!classId || !interfaceName) {
        continue;
      }

      const interfaceId = this.asString(parsedRef['interfaceId']);
      parsedRefs.push(interfaceId ? { classId, interfaceName, interfaceId } : { classId, interfaceName });
    }

    return parsedRefs;
  }

  private parseInterfaceExtendsRefs(refs: unknown): DeferredInterfaceExtendsRef[] {
    if (!Array.isArray(refs)) {
      return [];
    }

    const parsedRefs: DeferredInterfaceExtendsRef[] = [];
    for (const ref of refs) {
      const parsedRef = this.asRecord(ref);
      if (!parsedRef) {
        continue;
      }

      const interfaceId = this.asString(parsedRef['interfaceId']);
      const parentName = this.asString(parsedRef['parentName']);
      if (!interfaceId || !parentName) {
        continue;
      }

      const parentId = this.asString(parsedRef['parentId']);
      parsedRefs.push(parentId ? { interfaceId, parentName, parentId } : { interfaceId, parentName });
    }

    return parsedRefs;
  }

  private extractVueScriptContent(source: string): string {
    const scriptBlocks: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = VUE_SCRIPT_BLOCK_PATTERN.exec(source)) !== null) {
      const attributes = match[1] ?? '';
      const scriptBody = match[2] ?? '';

      // Skip external script imports (src attr)
      if (/\bsrc\s*=/.test(attributes)) {
        continue;
      }

      const languageMatch = /\blang\s*=\s*['"]?([a-z0-9]+)['"]?/i.exec(attributes);
      const language = languageMatch?.[1]?.toLowerCase();
      if (language && !['ts', 'tsx', 'js', 'jsx'].includes(language)) {
        continue;
      }

      scriptBlocks.push(scriptBody);
    }

    return scriptBlocks.join('\n');
  }

  private async getModuleSourceOverride(filePath: string): Promise<string | undefined> {
    if (!filePath.endsWith('.vue')) {
      return undefined;
    }

    const vueSource = await readFile(filePath, 'utf-8');
    return this.extractVueScriptContent(vueSource);
  }

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
      } else if (entry.isFile() && this.isAnalyzableSourceFile(entry.name)) {
        files.push(fullPath);
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

    // Parse all supported source files in the package
    const modules: IModuleCreateDTO[] = [];
    const classes: IClassCreateDTO[] = [];
    const interfaces: IInterfaceCreateDTO[] = [];
    const functions: IFunctionCreateDTO[] = [];
    const methods: IMethodCreateDTO[] = [];
    const properties: IPropertyCreateDTO[] = [];
    const parameters: IParameterCreateDTO[] = [];

    // Find and parse all supported source files
    const files = await this.traverseDirectory(this.packagePath);
    const moduleImports: Import[] = [];
    const moduleExports: Export[] = [];
    const importsWithModules: { import: Import; moduleId: string }[] = [];

    // Collect raw relationship refs from all modules (name-based, not yet resolved)
    const rawClassExtends: DeferredClassExtendsRef[] = [];
    const rawClassImplements: DeferredClassImplementsRef[] = [];
    const rawInterfaceExtends: DeferredInterfaceExtendsRef[] = [];
    const symbolUsages: SymbolUsageRef[] = [];

    for (const file of files) {
      const sourceOverride = await this.getModuleSourceOverride(file);
      const moduleParser = new ModuleParser(file, packageId, sourceOverride);
      const moduleResult: ParseResult = await moduleParser.parse();

      const moduleId = moduleResult.modules[0]?.id ?? '';

      modules.push(...moduleResult.modules);
      classes.push(...moduleResult.classes);
      interfaces.push(...moduleResult.interfaces);
      functions.push(...moduleResult.functions);
      methods.push(...moduleResult.methods);
      moduleResult.properties.forEach((property) => properties.push(property));
      moduleResult.parameters.forEach((parameter) => parameters.push(parameter));
      moduleResult.imports.forEach((imp) => {
        moduleImports.push(imp);
        importsWithModules.push({ import: imp, moduleId });
      });
      moduleResult.exports.forEach((exp) => moduleExports.push(exp));

      // Collect deferred relationship data
      rawClassExtends.push(...this.parseClassExtendsRefs(moduleResult.classExtends));
      rawClassImplements.push(...this.parseClassImplementsRefs(moduleResult.classImplements));
      rawInterfaceExtends.push(...this.parseInterfaceExtendsRefs(moduleResult.interfaceExtends));
      symbolUsages.push(...moduleResult.symbolUsages);
    }

    // Build name→ID lookup maps for first-pass resolution within this package
    // Names can be duplicated across modules, so map to arrays and resolve only unique matches.
    const classNameToIds = new Map<string, string[]>();
    for (const cls of classes) {
      this.addNameMapping(classNameToIds, cls.name, cls.id);
    }
    const interfaceNameToIds = new Map<string, string[]>();
    for (const iface of interfaces) {
      this.addNameMapping(interfaceNameToIds, iface.name, iface.id);
    }

    // Resolve relationship IDs when a name maps uniquely within this package.
    const classExtends: DeferredClassExtendsRef[] = rawClassExtends.map((ref) => ({
      classId: ref.classId,
      parentName: ref.parentName,
      parentId: this.resolveUniqueName(classNameToIds, ref.parentName),
    }));

    const classImplements: DeferredClassImplementsRef[] = rawClassImplements.map((ref) => ({
      classId: ref.classId,
      interfaceName: ref.interfaceName,
      interfaceId: this.resolveUniqueName(interfaceNameToIds, ref.interfaceName),
    }));

    const interfaceExtends: DeferredInterfaceExtendsRef[] = rawInterfaceExtends.map((ref) => ({
      interfaceId: ref.interfaceId,
      parentName: ref.parentName,
      parentId: this.resolveUniqueName(interfaceNameToIds, ref.parentName),
    }));

    const symbolReferences = this.resolveSymbolReferences(
      packageId,
      symbolUsages,
      classNameToIds,
      interfaceNameToIds,
      methods,
      properties
    );

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
      classExtends,
      classImplements,
      interfaceExtends,
      symbolUsages,
      symbolReferences,
    };
  }

  private resolveSymbolReferences(
    packageId: string,
    symbolUsages: SymbolUsageRef[],
    classNameToIds: Map<string, string[]>,
    interfaceNameToIds: Map<string, string[]>,
    methods: IMethodCreateDTO[],
    properties: IPropertyCreateDTO[]
  ): ISymbolReferenceCreateDTO[] {
    const methodNameToIds = new Map<string, string[]>();
    const propertyNameToIds = new Map<string, string[]>();
    const methodByParentAndName = new Map<string, string[]>();
    const propertyByParentAndName = new Map<string, string[]>();

    methods.forEach((method) => {
      this.addNameMapping(methodNameToIds, method.name, method.id);
      this.addNameMapping(methodByParentAndName, this.buildParentMemberKey(method.parent_id, method.name), method.id);
    });

    properties.forEach((property) => {
      this.addNameMapping(propertyNameToIds, property.name, property.id);
      this.addNameMapping(
        propertyByParentAndName,
        this.buildParentMemberKey(property.parent_id, property.name),
        property.id
      );
    });

    const referencesById = new Map<string, ISymbolReferenceCreateDTO>();

    symbolUsages.forEach((usage) => {
      const isMethodAccess = usage.targetKind === 'method';
      const byNameMap = isMethodAccess ? methodNameToIds : propertyNameToIds;
      const byParentAndNameMap = isMethodAccess ? methodByParentAndName : propertyByParentAndName;

      let targetParentId: string | undefined;
      if (usage.qualifierName === 'this' && usage.sourceParentName && usage.sourceParentType) {
        targetParentId =
          usage.sourceParentType === 'class'
            ? this.resolveUniqueName(classNameToIds, usage.sourceParentName)
            : this.resolveUniqueName(interfaceNameToIds, usage.sourceParentName);
      } else if (usage.qualifierName) {
        targetParentId =
          this.resolveUniqueName(classNameToIds, usage.qualifierName) ??
          this.resolveUniqueName(interfaceNameToIds, usage.qualifierName);
      }

      let targetSymbolId: string | undefined;
      if (targetParentId) {
        targetSymbolId = this.resolveUniqueName(
          byParentAndNameMap,
          this.buildParentMemberKey(targetParentId, usage.targetName)
        );
      }
      targetSymbolId ??= this.resolveUniqueName(byNameMap, usage.targetName);
      if (!targetSymbolId) {
        return;
      }

      const sourceId = usage.sourceSymbolId ?? usage.moduleId;
      const id = generateRelationshipUUID(sourceId, targetSymbolId, `symbol_${usage.targetKind}`);
      referencesById.set(id, {
        id,
        package_id: packageId,
        module_id: usage.moduleId,
        source_symbol_id: usage.sourceSymbolId,
        source_symbol_type: usage.sourceSymbolType,
        source_symbol_name: usage.sourceSymbolName,
        target_symbol_id: targetSymbolId,
        target_symbol_type: usage.targetKind,
        target_symbol_name: usage.targetName,
        access_kind: usage.targetKind,
        qualifier_name: usage.qualifierName,
      });
    });

    return Array.from(referencesById.values());
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
