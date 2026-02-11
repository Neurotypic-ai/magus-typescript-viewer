import { readFile, readdir } from 'fs/promises';
import { dirname, join, relative, resolve } from 'path';

import { readPackage } from 'read-pkg';
import ts from 'typescript';

import { PackageImport } from '../../shared/types/Import';
import { createLogger } from '../../shared/utils/logger';
import { generateImportUUID, generatePackageUUID, generateRelationshipUUID } from '../utils/uuid';
import { ModuleParser } from './ModuleParser';

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
import type { ISymbolReferenceCreateDTO } from '../db/repositories/SymbolReferenceRepository';
import type { ParseResult, SymbolUsageRef } from './ParseResult';

interface PackageDependencies {
  dependencies?: Partial<Record<string, string | undefined>> | undefined;
  devDependencies?: Partial<Record<string, string | undefined>> | undefined;
  peerDependencies?: Partial<Record<string, string | undefined>> | undefined;
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
const ALWAYS_EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  'out',
]);

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

  private uniqueById<T extends { id: string }>(items: T[]): T[] {
    return this.uniqueByKey(items, (item) => item.id);
  }

  private uniqueByKey<T>(items: T[], getKey: (item: T) => string): T[] {
    const seen = new Set<string>();
    const unique: T[] = [];

    for (const item of items) {
      const key = getKey(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      unique.push(item);
    }

    return unique;
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

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  private shouldSkipDirectory(dirName: string): boolean {
    return dirName.startsWith('.') || ALWAYS_EXCLUDED_DIRECTORIES.has(dirName);
  }

  private isExcludedPath(fullPath: string): boolean {
    const relativePath = this.normalizePath(relative(this.packagePath, fullPath));
    if (relativePath.startsWith('..')) {
      return true;
    }

    return relativePath
      .split('/')
      .filter((segment) => segment.length > 0)
      .some((segment) => this.shouldSkipDirectory(segment));
  }

  private async traverseDirectory(dir: string): Promise<string[]> {
    if (this.isExcludedPath(dir)) {
      return [];
    }

    const files: string[] = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return files;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (this.shouldSkipDirectory(entry.name)) {
          continue;
        }
        const subFiles = await this.traverseDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && this.isAnalyzableSourceFile(entry.name) && !this.isExcludedPath(fullPath)) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private getIncludeRoots(tsConfig: Record<string, unknown>, configDir: string): string[] {
    const include = Array.isArray(tsConfig['include']) ? tsConfig['include'] : [];
    const roots = new Set<string>();

    include.forEach((pattern) => {
      if (typeof pattern !== 'string' || pattern.trim().length === 0) {
        return;
      }

      const normalizedPattern = this.normalizePath(pattern.trim());
      const wildcardIndex = normalizedPattern.search(/[*{]/);
      const base = wildcardIndex >= 0 ? normalizedPattern.slice(0, wildcardIndex) : normalizedPattern;
      const cleanedBase = base.endsWith('/') ? base.slice(0, -1) : base;
      const candidate = resolve(configDir, cleanedBase.length > 0 ? cleanedBase : '.');
      roots.add(candidate);
    });

    if (roots.size === 0) {
      roots.add(this.packagePath);
    }

    return Array.from(roots);
  }

  private async collectFilesFromTsConfig(): Promise<string[] | null> {
    const tsConfigPath = ts.findConfigFile(this.packagePath, (fileName) => ts.sys.fileExists(fileName), 'tsconfig.json');
    if (!tsConfigPath) {
      return null;
    }

    const configDir = dirname(tsConfigPath);
    const configResult = ts.readConfigFile(tsConfigPath, (fileName) => ts.sys.readFile(fileName));
    if (configResult.error) {
      this.logger.warn(`Failed to read tsconfig at ${tsConfigPath}, falling back to directory traversal`);
      return null;
    }

    const parsedConfig = ts.parseJsonConfigFileContent(configResult.config, ts.sys, configDir, undefined, tsConfigPath);
    if (parsedConfig.errors.length > 0) {
      this.logger.warn(`Encountered tsconfig parse errors at ${tsConfigPath}, continuing with available file list`);
    }

    const fileSet = new Set<string>();

    parsedConfig.fileNames.forEach((fileName) => {
      const absolutePath = resolve(fileName);
      if (!this.isAnalyzableSourceFile(absolutePath)) {
        return;
      }
      if (this.isExcludedPath(absolutePath)) {
        return;
      }
      fileSet.add(absolutePath);
    });

    const includeRoots = this.getIncludeRoots(configResult.config as Record<string, unknown>, configDir);
    for (const root of includeRoots) {
      if (this.isExcludedPath(root)) {
        continue;
      }
      const rootedFiles = await this.traverseDirectory(root);
      rootedFiles.forEach((filePath) => {
        if (filePath.endsWith('.vue')) {
          fileSet.add(resolve(filePath));
        }
      });
    }

    return Array.from(fileSet).sort((a, b) => a.localeCompare(b));
  }

  private async discoverSourceFiles(): Promise<string[]> {
    const filesFromTsConfig = await this.collectFilesFromTsConfig();
    if (filesFromTsConfig) {
      return filesFromTsConfig;
    }
    const files = await this.traverseDirectory(this.packagePath);
    return files.sort((a, b) => a.localeCompare(b));
  }

  async parse(): Promise<ParseResult> {
    const packageId = generatePackageUUID(this.packageName, this.packageVersion);

    // Initialize collection maps
    const imports = new Map<string, Import>();

    // Read package.json and package-lock.json
    const pkg = await readPackage({ cwd: this.packagePath });
    const pkgLock = await this.readPackageLock(this.packagePath);

    // Parse dependencies from package.json metadata only (no node_modules introspection)
    const packageDependencies = pkg as PackageDependencies;
    const dependencies = this.parseDependencies(packageDependencies, pkgLock, 'dependencies', imports);
    const devDependencies = this.parseDependencies(packageDependencies, pkgLock, 'devDependencies', imports);
    const peerDependencies = this.parseDependencies(packageDependencies, pkgLock, 'peerDependencies', imports);

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
    const files = await this.discoverSourceFiles();
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

    const uniqueModules = this.uniqueById(modules);
    const uniqueClasses = this.uniqueById(classes);
    const uniqueInterfaces = this.uniqueById(interfaces);
    const uniqueFunctions = this.uniqueById(functions);
    const uniqueMethods = this.uniqueById(methods);
    const uniqueProperties = this.uniqueById(properties);
    const uniqueParameters = this.uniqueById(parameters);
    const uniqueModuleImports = this.uniqueByKey(moduleImports, (item) => item.uuid);
    const uniqueModuleExports = this.uniqueByKey(moduleExports, (item) => item.uuid);
    const uniqueImportsWithModules = Array.from(
      new Map(importsWithModules.map((entry) => [`${entry.moduleId}:${entry.import.uuid}`, entry])).values()
    );
    const uniqueSymbolReferences = this.uniqueById(symbolReferences);

    return {
      package: packageDTO,
      modules: uniqueModules,
      classes: uniqueClasses,
      interfaces: uniqueInterfaces,
      functions: uniqueFunctions,
      methods: uniqueMethods,
      properties: uniqueProperties,
      parameters: uniqueParameters,
      imports: [...Array.from(imports.values()), ...uniqueModuleImports],
      exports: uniqueModuleExports,
      importsWithModules: uniqueImportsWithModules,
      classExtends,
      classImplements,
      interfaceExtends,
      symbolUsages,
      symbolReferences: uniqueSymbolReferences,
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

  private parseDependencies(
    pkg: PackageDependencies,
    pkgLock: PackageLock,
    type: 'dependencies' | 'devDependencies' | 'peerDependencies',
    imports: Map<string, Import>
  ): Map<string, string> {
    const deps = pkg[type];
    const depsMap = new Map<string, string>();

    if (!deps) return depsMap;

    for (const [name, version] of Object.entries(deps)) {
      if (typeof version !== 'string' || version.length === 0) {
        continue;
      }
      const resolution = pkgLock[name]?.version ?? version;
      const dependencyId = generatePackageUUID(name, resolution);
      depsMap.set(name, dependencyId);
      if (!imports.has(name)) {
        const relativePath = `node_modules/${name}`;
        const packageImport = new PackageImport(
          generateImportUUID(this.packagePath, name),
          relativePath,
          relativePath,
          name,
          new Map(),
          0,
          version,
          resolution,
          pkgLock[name]?.resolved,
          type
        );
        imports.set(name, packageImport);
      }
    }

    return depsMap;
  }
}
