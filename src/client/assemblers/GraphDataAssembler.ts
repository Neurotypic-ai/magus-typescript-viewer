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
import type {
  ClassStructure,
  DependencyPackageGraph,
  DependencyRef,
  EnumStructure,
  ExternalDependencyRef,
  FunctionStructure,
  ImportRef,
  InterfaceStructure,
  ImportSpecifierRef,
  ModuleStructure,
  NodeMethod,
  NodeProperty,
  SymbolReferenceRef,
  TypeAliasStructure,
  VariableStructure,
} from '../types';

// Define the missing structures that are used in the class but not externally defined
// These were previously used but now NodeProperty/NodeMethod are used more directly
// interface PropertyStructure {
//   id: string;
//   name: string;
//   type: string;
//   default_value: string;
//   visibility: string;
//   is_static: boolean;
//   created_at: string;
// }

// interface MethodStructure {
//   id: string;
//   name: string;
//   parameters: Parameter[];
//   return_type: string;
//   visibility: string;
//   is_static: boolean;
//   created_at: string;
// }

const assemblerLogger = createLogger('GraphDataAssembler');

type PackageBasePayload = Omit<Package, 'modules'>;

interface GraphApiPackagePayload extends PackageBasePayload {
  modules?: Module[];
}

interface GraphApiPayload {
  packages?: GraphApiPackagePayload[];
}

// Cache for memoizing the graph data
class GraphDataCache {
  private static instance: GraphDataCache | null = null;
  private cache = new Map<string, { data: DependencyPackageGraph; timestamp: number }>();
  private readonly MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

  private constructor() {
    // Private constructor for singleton pattern
  }

  public static getInstance(): GraphDataCache {
    return (GraphDataCache.instance ??= new GraphDataCache());
  }

  public get(key: string): DependencyPackageGraph | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if cache is still valid
    const now = Date.now();
    if (now - entry.timestamp > this.MAX_AGE_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  public set(key: string, data: DependencyPackageGraph): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  public clear(): void {
    this.cache.clear();
  }
}

export class GraphDataAssembler {
  private static readonly CACHE_VERSION = 'v2-import-specifiers';
  private readonly baseUrl: string;
  private readonly cache: GraphDataCache;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? getApiBaseUrl();
    this.cache = GraphDataCache.getInstance();
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

      assemblerLogger.debug('Fetching graph payload from /graph...');
      const graphResponse = await fetch(this.buildUrl('/graph'), { signal: fetchSignal });
      if (graphResponse.ok) {
        const graphPayload = (await graphResponse.json()) as GraphApiPayload;
        if (Array.isArray(graphPayload.packages)) {
          assemblerLogger.debug('Fetched graph payload packages:', graphPayload.packages.length);
          graphData = this.buildGraphDataFromPackages(graphPayload.packages);
        }
      } else {
        assemblerLogger.warn(`Graph endpoint unavailable (${graphResponse.status.toString()}), falling back to legacy fetch.`);
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


  /**
   * Transforms class collection to Record format
   * @param classes Array of classes
   * @returns Record of classes
   */
  private transformClassCollection(classes: Class[]): Record<string, ClassStructure> {
    const result: Record<string, ClassStructure> = {};

    classes.forEach((cls) => {
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

      result[cls.name] = classObj;
    });

    return result;
  }

  /**
   * Transforms interface collection to Record format
   * @param interfaces Array of interfaces
   * @returns Record of interfaces
   */
  private transformInterfaceCollection(interfaces: SharedInterface[]): Record<string, InterfaceStructure> {
    const result: Record<string, InterfaceStructure> = {};

    interfaces.forEach((intf) => {
      result[intf.name] = {
        id: intf.id,
        name: intf.name,
        extended_interfaces: this.transformInterfaceRefs(typeCollectionToArray(intf.extended_interfaces)),
        properties: this.transformPropertyCollection(typeCollectionToArray(intf.properties)),
        methods: this.transformMethodCollection(typeCollectionToArray(intf.methods)),
        created_at: typeof intf.created_at === 'string' ? intf.created_at : intf.created_at.toISOString(),
      };
    });

    return result;
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

  /**
   * Transforms a collection of interfaces into a record of InterfaceRefs keyed by id
   */
  private transformInterfaceRefs(interfaces: SharedInterface[]): Record<string, { id: string; name?: string }> {
    const result: Record<string, { id: string; name?: string }> = {};
    interfaces.forEach((intf) => {
      result[intf.id] = { id: intf.id, name: intf.name };
    });
    return result;
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

  /**
   * Transforms a collection of imports into a record of ImportRef keyed by uuid
   */
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
    const result: Record<string, ImportRef> = {};
    imports.forEach((imp) => {
      const ref: ImportRef = { uuid: imp.uuid } as ImportRef;
      if (imp.name !== undefined) {
        (ref as { name?: string }).name = imp.name;
      }
      if (imp.relativePath !== undefined) {
        (ref as { path?: string }).path = imp.relativePath;
      } else if (imp.path !== undefined) {
        (ref as { path?: string }).path = imp.path;
      } else if (imp.fullPath !== undefined) {
        (ref as { path?: string }).path = imp.fullPath;
      }

      const path = ref.path ?? ref.name;
      const packageName = imp.packageName ?? (path ? this.packageNameFromImportPath(path) : undefined);
      if (typeof imp.isExternal === 'boolean') {
        ref.isExternal = imp.isExternal;
      } else {
        ref.isExternal = Boolean(packageName);
      }
      if (packageName) {
        ref.packageName = packageName;
      }

      ref.specifiers = this.parseImportSpecifiers(imp.specifiers);
      result[imp.uuid] = ref;
    });
    return result;
  }

  private transformSymbolReferenceCollection(
    references: SymbolReference[]
  ): Record<string, SymbolReferenceRef> {
    const result: Record<string, SymbolReferenceRef> = {};
    references.forEach((reference) => {
      result[reference.id] = {
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
      };
    });
    return result;
  }

  private transformFunctionCollection(functions: ModuleFunction[]): Record<string, FunctionStructure> {
    const result: Record<string, FunctionStructure> = {};
    functions.forEach((fn) => {
      result[fn.id] = {
        id: fn.id,
        name: fn.name,
        returnType: fn.return_type,
        isAsync: fn.is_async,
      };
    });
    return result;
  }

  private transformTypeAliasCollection(typeAliases: TypeAlias[]): Record<string, TypeAliasStructure> {
    const result: Record<string, TypeAliasStructure> = {};
    typeAliases.forEach((ta) => {
      result[ta.id] = {
        id: ta.id,
        name: ta.name,
        type: ta.type,
        typeParameters: ta.typeParameters.length > 0 ? ta.typeParameters : undefined,
      };
    });
    return result;
  }

  private transformEnumCollection(enums: Enum[]): Record<string, EnumStructure> {
    const result: Record<string, EnumStructure> = {};
    enums.forEach((en) => {
      result[en.id] = {
        id: en.id,
        name: en.name,
        members: en.members,
      };
    });
    return result;
  }

  private transformVariableCollection(variables: Variable[]): Record<string, VariableStructure> {
    const result: Record<string, VariableStructure> = {};
    variables.forEach((v) => {
      result[v.id] = {
        id: v.id,
        name: v.name,
        type: v.type,
        kind: v.kind,
        initializer: v.initializer,
      };
    });
    return result;
  }

  /**
   * Transforms a collection of packages into a record of DependencyRef keyed by id
   */
  private transformDependencyCollection(packages: Package[]): Record<string, DependencyRef> {
    const result: Record<string, DependencyRef> = {};
    packages.forEach((p) => {
      result[p.id] = { id: p.id, name: p.name, version: p.version } as DependencyRef;
    });
    return result;
  }

  /**
   * Clears the cache for the graph data
   */
  public clearCache(): void {
    this.cache.clear();
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
