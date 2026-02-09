import { createLogger } from '../../shared/utils/logger';

import { getApiBaseUrl } from '../config/api';

import type { Class } from '../../shared/types/Class';
import type { Interface as SharedInterface } from '../../shared/types/Interface';
import type { Method } from '../../shared/types/Method';
import type { Module } from '../../shared/types/Module';
import type { Package } from '../../shared/types/Package';
import type { Property as SharedProperty } from '../../shared/types/Property';
import type { TypeCollection } from '../../shared/types/TypeCollection';
import type {
  ClassStructure,
  DependencyPackageGraph,
  DependencyRef,
  ImportRef,
  InterfaceStructure,
  ModuleStructure,
  NodeMethod,
  NodeProperty,
} from '../components/DependencyGraph/types';

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
   * Assembles graph data from the API with caching and abort controller support
   * @param signal Optional AbortSignal to cancel the fetch operations
   * @returns A Promise resolving to the dependency package graph
   */
  async assembleGraphData(signal?: AbortSignal): Promise<DependencyPackageGraph> {
    try {
      // Check cache first
      const cacheKey = this.baseUrl;
      const cachedData = this.cache.get(cacheKey);
      if (cachedData) {
        assemblerLogger.debug('Using cached graph data...');
        return cachedData;
      }

      assemblerLogger.debug('Fetching packages data...');
      const packagesResponse = await fetch(this.buildUrl('/packages'), signal ? { signal } : {});
      if (!packagesResponse.ok) {
        throw new Error(`HTTP error! status: ${packagesResponse.status.toString()}`);
      }
      const packages = (await packagesResponse.json()) as Package[];
      assemblerLogger.debug('Fetched packages:', packages.length);

      // Fetch modules and their dependencies for each package
      assemblerLogger.debug('Fetching modules for each package...');
      const enrichedPackages = await Promise.all(
        packages.map(async (pkg) => {
          assemblerLogger.debug(`Fetching modules for package: ${pkg.name}`);
          const modulesResponse = await fetch(
            this.buildUrl(`/modules?packageId=${pkg.id}`),
            signal ? { signal } : {}
          );
          if (!modulesResponse.ok) {
            throw new Error(`HTTP error! status: ${modulesResponse.status.toString()}`);
          }
          const modules = (await modulesResponse.json()) as Module[];
          assemblerLogger.debug(`Fetched ${modules.length.toString()} modules for package: ${pkg.name}`);

          // Transform the module data
          const enrichedModules = this.transformModules(modules);

          // Transform the package data and include modules
          return {
            ...this.transformPackage(pkg),
            modules: Object.fromEntries(enrichedModules.map((m) => [m.id, m])),
          };
        })
      );

      // Create the final graph data
      const graphData = this.createGraphData(enrichedPackages);

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
      // Simple module transformation that meets ModuleStructure requirements
      return {
        id: module.id,
        package_id: module.package_id,
        name: module.name,
        source: {
          relativePath,
        },
        imports: this.transformImportCollection(this.typeCollectionToArray(module.imports)),
        classes: this.transformClassCollection(this.typeCollectionToArray(module.classes)),
        interfaces: this.transformInterfaceCollection(this.typeCollectionToArray(module.interfaces)),
        created_at: typeof module.created_at === 'string' ? module.created_at : module.created_at.toISOString(),
      } as ModuleStructure;
    });
  }

  /**
   * Converts a TypeCollection to an array
   * @param collection The collection to convert
   * @returns An array of items from the collection
   */
  private typeCollectionToArray<T>(collection: TypeCollection<T> | undefined): T[] {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (collection instanceof Map) return Array.from(collection.values());
    return Object.values(collection);
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
        implemented_interfaces: this.transformInterfaceRefs(this.typeCollectionToArray(cls.implemented_interfaces)),
        properties: this.transformPropertyCollection(this.typeCollectionToArray(cls.properties)),
        methods: this.transformMethodCollection(this.typeCollectionToArray(cls.methods)),
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
        extended_interfaces: this.transformInterfaceRefs(this.typeCollectionToArray(intf.extended_interfaces)),
        properties: this.transformPropertyCollection(this.typeCollectionToArray(intf.properties)),
        methods: this.transformMethodCollection(this.typeCollectionToArray(intf.methods)),
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
      const parameters = this.typeCollectionToArray(method.parameters);
      return {
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
  private transformPackage(pkg: Package) {
    return {
      id: pkg.id,
      name: pkg.name,
      version: pkg.version,
      path: pkg.path,
      created_at: typeof pkg.created_at === 'string' ? pkg.created_at : pkg.created_at.toISOString(),
      dependencies: this.transformDependencyCollection(this.typeCollectionToArray(pkg.dependencies)),
      devDependencies: this.transformDependencyCollection(this.typeCollectionToArray(pkg.devDependencies)),
      peerDependencies: this.transformDependencyCollection(this.typeCollectionToArray(pkg.peerDependencies)),
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

  /**
   * Transforms a collection of imports into a record of ImportRef keyed by uuid
   */
  private transformImportCollection(
    imports: { uuid: string; name?: string; relativePath?: string }[]
  ): Record<string, ImportRef> {
    const result: Record<string, ImportRef> = {};
    imports.forEach((imp) => {
      const ref: ImportRef = { uuid: imp.uuid } as ImportRef;
      if (imp.name !== undefined) {
        (ref as { name?: string }).name = imp.name;
      }
      if (imp.relativePath !== undefined) {
        (ref as { path?: string }).path = imp.relativePath;
      }
      result[imp.uuid] = ref;
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
