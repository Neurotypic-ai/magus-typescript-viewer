import { createLogger } from '../../shared/utils/logger';

import { getApiBaseUrl } from './api';

import type { Class } from '../../shared/types/Class';
import type { Enum } from '../../shared/types/Enum';
import type { ModuleFunction } from '../../shared/types/Function';
import type { Interface as SharedInterface } from '../../shared/types/Interface';
import type { Method } from '../../shared/types/Method';
import type { Module } from '../../shared/types/Module';
import type { Package } from '../../shared/types/Package';
import type { Property as SharedProperty } from '../../shared/types/Property';
import type { SymbolReference } from '../../shared/types/SymbolReference';
import type { TypeAlias } from '../../shared/types/TypeAlias';
import { typeCollectionToArray } from '../utils/collections';
import type { Variable } from '../../shared/types/Variable';
import type { ClassStructure } from '../types/ClassStructure';
import type { DependencyPackageGraph } from '../types/DependencyPackageGraph';
import type { DependencyRef } from '../types/DependencyRef';
import type { EnumStructure } from '../types/EnumStructure';
import type { ExternalDependencyRef } from '../types/ExternalDependencyRef';
import type { FunctionStructure } from '../types/FunctionStructure';
import type { ImportRef } from '../types/ImportRef';
import type { InterfaceStructure } from '../types/InterfaceStructure';
import type { ImportSpecifierRef } from '../types/ImportSpecifierRef';
import type { ModuleStructure } from '../types/ModuleStructure';
import type { NodeMethod } from '../types/NodeMethod';
import type { NodeProperty } from '../types/NodeProperty';
import type { SymbolReferenceRef } from '../types/SymbolReferenceRef';
import type { TypeAliasStructure } from '../types/TypeAliasStructure';
import type { VariableStructure } from '../types/VariableStructure';

import { GraphDataCache } from './graphDataCache';

const assemblerLogger = createLogger('GraphDataAssembler');

type PackageBasePayload = Omit<Package, 'modules'>;

interface GraphApiPackagePayload extends PackageBasePayload {
  modules?: Module[];
}

interface GraphApiPayload {
  packages?: GraphApiPackagePayload[];
}

interface ModuleDetailsApiPayload {
  module?: Module;
}

/** Generic: array → Record keyed by keyFn(item), values from mapFn(item). */
function transformCollection<T, R>(
  items: T[],
  keyFn: (t: T) => string,
  mapFn: (t: T) => R
): Record<string, R> {
  const result: Record<string, R> = {};
  items.forEach((item) => {
    result[keyFn(item)] = mapFn(item);
  });
  return result;
}

export class GraphDataAssembler {
  private static readonly CACHE_VERSION = 'v3-graph-summary';
  private readonly baseUrl: string;
  private readonly cache: GraphDataCache;
  private readonly moduleDetailsCache = new Map<string, ModuleStructure | null>();

  constructor(baseUrl?: string, cache?: GraphDataCache) {
    this.baseUrl = baseUrl ?? getApiBaseUrl();
    this.cache = cache ?? GraphDataCache.getInstance();
  }

  /**
   * Creates the final graph data structure with proper typings
   * @param packages The transformed packages
   * @returns A DependencyPackageGraph object
   */
  private createGraphData(
    packages: {
      id: string;
      name: string;
      version: string;
      path: string;
      created_at: string;
      dependencies?: Record<string, DependencyRef>;
      devDependencies?: Record<string, DependencyRef>;
      peerDependencies?: Record<string, DependencyRef>;
      modules?: Record<string, ModuleStructure>;
    }[]
  ): DependencyPackageGraph {
    // Create a properly typed object
    return { packages };
  }

  /**
   * Converts API package payload (with optional module arrays) to DependencyPackageGraph
   */
  private buildGraphDataFromPackages(packages: GraphApiPackagePayload[]): DependencyPackageGraph {
    const enrichedPackages = packages.map((pkg) => {
      const modules = Array.isArray(pkg.modules) ? pkg.modules : [];
      const enrichedModules = this.transformModules(modules);
      return {
        ...this.transformPackage(pkg),
        modules: Object.fromEntries(enrichedModules.map((module) => [module.id, module])),
      };
    });

    return this.createGraphData(enrichedPackages);
  }

  /**
   * Assembles graph data from the API with caching and abort controller support
   * @param signal Optional AbortSignal to cancel the fetch operations
   * @returns A Promise resolving to the dependency package graph
   */
  async assembleGraphData(signal?: AbortSignal): Promise<DependencyPackageGraph> {
    try {
      // Check cache first
      const cacheKey = `${GraphDataAssembler.CACHE_VERSION}:${this.baseUrl}`;
      const cachedData = this.cache.get(cacheKey);
      if (cachedData) {
        assemblerLogger.debug('Using cached graph data...');
        return cachedData;
      }

      // Use a timeout signal if none provided (30s default)
      const fetchSignal = signal ?? AbortSignal.timeout(30_000);

      let graphData: DependencyPackageGraph | null = null;

      assemblerLogger.debug('Fetching graph summary payload from /graph/summary...');
      const summaryResponse = await fetch(this.buildUrl('/graph/summary'), { signal: fetchSignal });
      if (summaryResponse.ok) {
        const summaryPayload = (await summaryResponse.json()) as GraphApiPayload;
        if (Array.isArray(summaryPayload.packages)) {
          assemblerLogger.debug('Fetched graph summary packages:', summaryPayload.packages.length);
          graphData = this.buildGraphDataFromPackages(summaryPayload.packages);
        }
      } else {
        assemblerLogger.warn(
          `Graph summary endpoint unavailable (${summaryResponse.status.toString()}), falling back to /graph.`
        );
      }

      if (!graphData) {
        assemblerLogger.debug('Fetching full graph payload from /graph...');
        const graphResponse = await fetch(this.buildUrl('/graph'), { signal: fetchSignal });
        if (graphResponse.ok) {
          const graphPayload = (await graphResponse.json()) as GraphApiPayload;
          if (Array.isArray(graphPayload.packages)) {
            assemblerLogger.debug('Fetched full graph payload packages:', graphPayload.packages.length);
            graphData = this.buildGraphDataFromPackages(graphPayload.packages);
          }
        } else {
          assemblerLogger.warn(`Graph endpoint unavailable (${graphResponse.status.toString()}), falling back to legacy fetch.`);
        }
      }

      if (!graphData) {
        assemblerLogger.debug('Fetching packages data via legacy endpoints...');
        const packagesResponse = await fetch(this.buildUrl('/packages'), { signal: fetchSignal });
        if (!packagesResponse.ok) {
          throw new Error(`HTTP error! status: ${packagesResponse.status.toString()}`);
        }
        const packages = (await packagesResponse.json()) as Package[];
        assemblerLogger.debug('Fetched packages:', packages.length);

        assemblerLogger.debug('Fetching modules for each package...');
        const results = await Promise.allSettled(
          packages.map(async (pkg) => {
            const modulesResponse = await fetch(this.buildUrl(`/modules?packageId=${pkg.id}`), { signal: fetchSignal });
            if (!modulesResponse.ok) {
              throw new Error(`HTTP error! status: ${modulesResponse.status.toString()}`);
            }
            const modules = (await modulesResponse.json()) as Module[];
            return Object.assign({}, pkg, { modules }) as GraphApiPackagePayload;
          })
        );

        const graphPackages = results
          .filter((result) => {
            if (result.status === 'rejected') {
              assemblerLogger.warn('Failed to fetch modules for a package:', result.reason);
              return false;
            }
            return true;
          })
          .map(
            (result) =>
              (
                result as PromiseFulfilledResult<
                  (typeof results)[number] extends PromiseSettledResult<infer T> ? T : never
                >
              ).value
          );

        graphData = this.buildGraphDataFromPackages(graphPackages);
      }

      // Store in cache
      this.cache.set(cacheKey, graphData);

      assemblerLogger.debug('Assembled graph data with enriched packages...');
      return graphData;
    } catch (error) {
      assemblerLogger.error('Error assembling graph data:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('An unknown error occurred while assembling graph data');
    }
  }

  /**
   * Transforms modules data for the graph
   * @param modules The modules to transform
   * @returns The transformed modules as ModuleStructure[]
   */
  private transformModules(modules: Module[]): ModuleStructure[] {
    // Use type assertion to convert array elements
    return modules.map((module) => {
      const relativePath = module.source.relativePath;
      const transformedImports = this.transformImportCollection(typeCollectionToArray(module.imports));
      // Simple module transformation that meets ModuleStructure requirements
      return {
        id: module.id,
        package_id: module.package_id,
        name: module.name,
        source: {
          relativePath,
        },
        imports: transformedImports,
        externalDependencies: this.buildExternalDependencies(transformedImports),
        symbol_references: this.transformSymbolReferenceCollection(typeCollectionToArray(module.symbol_references)),
        classes: this.transformClassCollection(typeCollectionToArray(module.classes)),
        interfaces: this.transformInterfaceCollection(typeCollectionToArray(module.interfaces)),
        functions: this.transformFunctionCollection(typeCollectionToArray(module.functions)),
        typeAliases: this.transformTypeAliasCollection(typeCollectionToArray(module.typeAliases)),
        enums: this.transformEnumCollection(typeCollectionToArray(module.enums)),
        variables: this.transformVariableCollection(typeCollectionToArray(module.variables)),
        created_at: typeof module.created_at === 'string' ? module.created_at : module.created_at.toISOString(),
      } as ModuleStructure;
    });
  }


  private transformClassCollection(classes: Class[]): Record<string, ClassStructure> {
    return transformCollection(
      classes,
      (cls) => cls.name,
      (cls) => {
        const classObj: ClassStructure = {
          id: cls.id,
          name: cls.name,
          implemented_interfaces: this.transformInterfaceRefs(typeCollectionToArray(cls.implemented_interfaces)),
          properties: this.transformPropertyCollection(typeCollectionToArray(cls.properties)),
          methods: this.transformMethodCollection(typeCollectionToArray(cls.methods)),
          created_at: typeof cls.created_at === 'string' ? cls.created_at : cls.created_at.toISOString(),
        } as unknown as ClassStructure;
        if (cls.extends_id) {
          (classObj as { extends_id?: string }).extends_id = cls.extends_id;
        }
        return classObj;
      }
    );
  }

  private transformInterfaceCollection(interfaces: SharedInterface[]): Record<string, InterfaceStructure> {
    return transformCollection(interfaces, (intf) => intf.name, (intf) => ({
      id: intf.id,
      name: intf.name,
      extended_interfaces: this.transformInterfaceRefs(typeCollectionToArray(intf.extended_interfaces)),
      properties: this.transformPropertyCollection(typeCollectionToArray(intf.properties)),
      methods: this.transformMethodCollection(typeCollectionToArray(intf.methods)),
      created_at: typeof intf.created_at === 'string' ? intf.created_at : intf.created_at.toISOString(),
    }));
  }

  /**
   * Transforms property collection to Record format
   * @param properties Array of properties
   * @returns Record of properties
   */
  private transformPropertyCollection(properties: SharedProperty[]): NodeProperty[] {
    return properties.map((prop) => ({
      id: prop.id,
      name: prop.name,
      type: prop.type,
      visibility: prop.visibility,
      // Note: is_static, default_value from SharedProperty are not in NodeProperty
      // id and created_at are also not directly part of NodeProperty display type
    }));
  }

  /**
   * Transforms method collection to Record format
   * @param methods Array of methods
   * @returns Record of methods
   */
  private transformMethodCollection(methods: Method[]): NodeMethod[] {
    return methods.map((method) => {
      const parameters = typeCollectionToArray(method.parameters);
      return {
        id: method.id,
        name: method.name,
        returnType: method.return_type,
        visibility: method.visibility,
        signature: parameters.map((p) => `${p.name}: ${p.type}`).join(', '),
        // Note: is_static, is_async from SharedMethod are not in NodeMethod display type
        // id and created_at are also not directly part of NodeMethod display type
      };
    });
  }

  /**
   * Transforms package data for the graph
   * @param pkg The package to transform
   * @returns The transformed package data
   */
  private transformPackage(pkg: PackageBasePayload) {
    return {
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      path: pkg.path,
      created_at: typeof pkg.created_at === 'string' ? pkg.created_at : pkg.created_at.toISOString(),
      dependencies: this.transformDependencyCollection(typeCollectionToArray(pkg.dependencies)),
      devDependencies: this.transformDependencyCollection(typeCollectionToArray(pkg.devDependencies)),
      peerDependencies: this.transformDependencyCollection(typeCollectionToArray(pkg.peerDependencies)),
    };
  }

  private transformInterfaceRefs(interfaces: SharedInterface[]): Record<string, { id: string; name?: string }> {
    return transformCollection(interfaces, (intf) => intf.id, (intf) => ({ id: intf.id, name: intf.name }));
  }

  private normalizeImportKind(kind: unknown): ImportSpecifierRef['kind'] {
    if (kind === 'value' || kind === 'type' || kind === 'default' || kind === 'namespace' || kind === 'sideEffect') {
      return kind;
    }
    if (kind === 'typeof') {
      return 'type';
    }
    return 'value';
  }

  private normalizeImportSpecifier(
    key: string | undefined,
    value: unknown
  ): ImportSpecifierRef | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const entry = value as {
      imported?: unknown;
      name?: unknown;
      local?: unknown;
      kind?: unknown;
      aliases?: unknown;
    };

    const importedCandidate = entry.imported ?? entry.name ?? key;
    if (typeof importedCandidate !== 'string' || importedCandidate.length === 0) {
      return undefined;
    }

    let localCandidate: string | undefined;
    if (typeof entry.local === 'string' && entry.local.length > 0) {
      localCandidate = entry.local;
    } else if (Array.isArray(entry.aliases) && typeof entry.aliases[0] === 'string') {
      localCandidate = entry.aliases[0];
    } else if (entry.aliases instanceof Set) {
      const aliasesArr = Array.from(entry.aliases as Set<unknown>);
      const firstAlias = aliasesArr[0];
      if (typeof firstAlias === 'string' && firstAlias.length > 0) {
        localCandidate = firstAlias;
      }
    } else if (typeof key === 'string' && key.length > 0 && key !== importedCandidate) {
      localCandidate = key;
    }

    return {
      imported: importedCandidate,
      ...(localCandidate ? { local: localCandidate } : {}),
      kind: this.normalizeImportKind(entry.kind),
    };
  }

  private parseImportSpecifiers(specifiers: unknown): ImportSpecifierRef[] {
    const normalized: ImportSpecifierRef[] = [];

    if (Array.isArray(specifiers)) {
      specifiers.forEach((entry) => {
        const parsed = this.normalizeImportSpecifier(undefined, entry);
        if (parsed) {
          normalized.push(parsed);
        }
      });
    } else if (specifiers instanceof Map) {
      specifiers.forEach((entry, key) => {
        const parsed = this.normalizeImportSpecifier(String(key), entry);
        if (parsed) {
          normalized.push(parsed);
        }
      });
    } else if (specifiers && typeof specifiers === 'object') {
      Object.entries(specifiers as Record<string, unknown>).forEach(([key, entry]) => {
        const parsed = this.normalizeImportSpecifier(key, entry);
        if (parsed) {
          normalized.push(parsed);
        }
      });
    }

    const deduped = new Map<string, ImportSpecifierRef>();
    normalized.forEach((specifier) => {
      const key = `${specifier.kind}:${specifier.imported}:${specifier.local ?? ''}`;
      if (!deduped.has(key)) {
        deduped.set(key, specifier);
      }
    });

    return Array.from(deduped.values());
  }

  private isExternalImportPath(path: string): boolean {
    if (path.startsWith('./') || path.startsWith('../') || path.startsWith('/') || path.startsWith('@/') || path.startsWith('src/')) {
      return false;
    }
    return true;
  }

  private packageNameFromImportPath(path: string): string | undefined {
    if (!this.isExternalImportPath(path)) {
      return undefined;
    }

    if (path.startsWith('@')) {
      const [scope, pkg] = path.split('/').slice(0, 2);
      if (!scope || !pkg) {
        return undefined;
      }
      return `${scope}/${pkg}`;
    }

    const [pkg] = path.split('/');
    return pkg ?? undefined;
  }

  private buildExternalDependencies(imports: Record<string, ImportRef>): ExternalDependencyRef[] {
    const grouped = new Map<string, { symbols: Set<string>; specifiers: ImportSpecifierRef[] }>();

    Object.values(imports).forEach((imp) => {
      const importPath = imp.path ?? imp.name;
      if (!importPath) {
        return;
      }

      const packageName = imp.packageName ?? this.packageNameFromImportPath(importPath);
      const isExternal = imp.isExternal ?? Boolean(packageName);
      if (!isExternal || !packageName) {
        return;
      }

      const bucket = grouped.get(packageName) ?? { symbols: new Set<string>(), specifiers: [] };
      const specifiers = Array.isArray(imp.specifiers) ? imp.specifiers : [];

      if (specifiers.length === 0) {
        bucket.symbols.add('(side-effect)');
      } else {
        specifiers.forEach((specifier) => {
          bucket.specifiers.push(specifier);
          if (specifier.kind === 'sideEffect') {
            bucket.symbols.add('(side-effect)');
            return;
          }

          const symbolLabel =
            specifier.local && specifier.local !== specifier.imported
              ? `${specifier.imported} as ${specifier.local}`
              : specifier.imported;
          if (symbolLabel.length > 0) {
            bucket.symbols.add(symbolLabel);
          }
        });
      }

      grouped.set(packageName, bucket);
    });

    return Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([packageName, entry]) => {
        const dedupedSpecifiers = Array.from(
          new Map(entry.specifiers.map((specifier) => [`${specifier.kind}:${specifier.imported}:${specifier.local ?? ''}`, specifier])).values()
        );

        return {
          packageName,
          symbols: Array.from(entry.symbols).sort((a, b) => a.localeCompare(b)),
          ...(dedupedSpecifiers.length > 0 ? { specifiers: dedupedSpecifiers } : {}),
        };
      });
  }

  private transformImportCollection(
    imports: {
      uuid: string;
      name?: string;
      relativePath?: string;
      path?: string;
      fullPath?: string;
      isExternal?: boolean;
      packageName?: string;
      specifiers?: unknown;
    }[]
  ): Record<string, ImportRef> {
    return transformCollection(imports, (imp) => imp.uuid, (imp) => {
      const ref: ImportRef = { uuid: imp.uuid } as ImportRef;
      if (imp.name !== undefined) (ref as { name?: string }).name = imp.name;
      if (imp.relativePath !== undefined) (ref as { path?: string }).path = imp.relativePath;
      else if (imp.path !== undefined) (ref as { path?: string }).path = imp.path;
      else if (imp.fullPath !== undefined) (ref as { path?: string }).path = imp.fullPath;
      const path = ref.path ?? ref.name;
      const packageName = imp.packageName ?? (path ? this.packageNameFromImportPath(path) : undefined);
      ref.isExternal =
        typeof imp.isExternal === 'boolean' ? imp.isExternal : Boolean(packageName);
      if (packageName) ref.packageName = packageName;
      ref.specifiers = this.parseImportSpecifiers(imp.specifiers);
      return ref;
    });
  }

  private transformSymbolReferenceCollection(
    references: SymbolReference[]
  ): Record<string, SymbolReferenceRef> {
    return transformCollection(references, (r) => r.id, (reference) => ({
      id: reference.id,
      package_id: reference.package_id,
      module_id: reference.module_id,
      source_symbol_id: reference.source_symbol_id ?? undefined,
      source_symbol_type: reference.source_symbol_type,
      source_symbol_name: reference.source_symbol_name ?? undefined,
      target_symbol_id: reference.target_symbol_id,
      target_symbol_type: reference.target_symbol_type,
      target_symbol_name: reference.target_symbol_name,
      access_kind: reference.access_kind,
      qualifier_name: reference.qualifier_name ?? undefined,
    }));
  }

  private transformFunctionCollection(functions: ModuleFunction[]): Record<string, FunctionStructure> {
    return transformCollection(functions, (fn) => fn.id, (fn) => ({
      id: fn.id,
      name: fn.name,
      returnType: fn.return_type,
      isAsync: fn.is_async,
    }));
  }

  private transformTypeAliasCollection(typeAliases: TypeAlias[]): Record<string, TypeAliasStructure> {
    return transformCollection(typeAliases, (ta) => ta.id, (ta) => ({
      id: ta.id,
      name: ta.name,
      type: ta.type,
      typeParameters: ta.typeParameters.length > 0 ? ta.typeParameters : undefined,
    }));
  }

  private transformEnumCollection(enums: Enum[]): Record<string, EnumStructure> {
    return transformCollection(enums, (en) => en.id, (en) => ({
      id: en.id,
      name: en.name,
      members: en.members,
    }));
  }

  private transformVariableCollection(variables: Variable[]): Record<string, VariableStructure> {
    return transformCollection(variables, (v) => v.id, (v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      kind: v.kind,
      initializer: v.initializer,
    }));
  }

  private transformDependencyCollection(packages: Package[]): Record<string, DependencyRef> {
    return transformCollection(
      packages,
      (p) => p.id,
      (p) => ({ id: p.id, name: p.name, version: p.version } as DependencyRef)
    );
  }

  async fetchModuleDetails(moduleId: string, signal?: AbortSignal): Promise<ModuleStructure | null> {
    if (this.moduleDetailsCache.has(moduleId)) {
      return this.moduleDetailsCache.get(moduleId) ?? null;
    }

    const fetchSignal = signal ?? AbortSignal.timeout(15_000);
    const response = await fetch(this.buildUrl(`/module-details?moduleId=${encodeURIComponent(moduleId)}`), {
      signal: fetchSignal,
    });

    if (response.status === 404) {
      this.moduleDetailsCache.set(moduleId, null);
      return null;
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch module details (${response.status.toString()})`);
    }

    const payload = (await response.json()) as ModuleDetailsApiPayload;
    if (!payload.module) {
      this.moduleDetailsCache.set(moduleId, null);
      return null;
    }

    const transformed = this.transformModules([payload.module]);
    const moduleDetails = transformed[0] ?? null;
    this.moduleDetailsCache.set(moduleId, moduleDetails);
    return moduleDetails;
  }

  /**
   * Clears the cache for the graph data
   */
  public clearCache(): void {
    this.cache.clear();
    this.moduleDetailsCache.clear();
    assemblerLogger.debug('Cleared graph data cache');
  }

  private buildUrl(path: string): string {
    if (!this.baseUrl) return path;
    if (this.baseUrl.endsWith('/') && path.startsWith('/')) {
      return `${this.baseUrl.slice(0, -1)}${path}`;
    }
    return `${this.baseUrl}${path}`;
  }
}
