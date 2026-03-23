import { Class, isClass } from '../../shared/types/Class';
import { Enum } from '../../shared/types/Enum';
import { ModuleFunction } from '../../shared/types/Function';
import { Import, ImportSpecifier } from '../../shared/types/Import';
import { Interface, isInterface } from '../../shared/types/Interface';
import { Method } from '../../shared/types/Method';
import { Module } from '../../shared/types/Module';
import { Package } from '../../shared/types/Package';
import { Parameter } from '../../shared/types/Parameter';
import { Property } from '../../shared/types/Property';
import { SymbolReference } from '../../shared/types/SymbolReference';
import { TypeAlias } from '../../shared/types/TypeAlias';
import { Variable } from '../../shared/types/Variable';
import { EntityRegistry } from './EntityRegistry';
import { getApiBaseUrl } from './api';
import { GraphDataCache } from './graphDataCache';

import type { IEnum } from '../../shared/types/Enum';
import type { IModuleFunction } from '../../shared/types/Function';
import type { IParameter } from '../../shared/types/Parameter';
import type { ISymbolReference } from '../../shared/types/SymbolReference';
import type { ITypeAlias } from '../../shared/types/TypeAlias';
import type { IVariable } from '../../shared/types/Variable';
import type { PackageGraph } from '../../shared/types/Package';

interface GraphApiPackagePayload {
  id: string;
  name: string;
  version: string;
  path: string;
  created_at?: string;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  modules?: unknown;
}

function collectionValues<T>(collection: unknown): T[] {
  if (!collection) return [];
  if (collection instanceof Map) return Array.from(collection.values()) as T[];
  if (collection instanceof Set) return Array.from(collection.values()) as T[];
  if (Array.isArray(collection)) return collection as T[];
  if (typeof collection === 'object') return Object.values(collection as Record<string, unknown>) as T[];
  return [];
}

function toString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function collectionRecords(collection: unknown): Record<string, unknown>[] {
  return collectionValues<unknown>(collection).map((item) => asRecord(item));
}

export class GraphHydrator {
  private static readonly CACHE_VERSION = 'v4-class-hydration';
  private readonly baseUrl: string;
  private readonly cache: GraphDataCache;
  private readonly moduleDetailsCache = new Map<string, Module | null>();

  constructor(baseUrl?: string, cache?: GraphDataCache) {
    this.baseUrl = baseUrl ?? getApiBaseUrl();
    this.cache = cache ?? GraphDataCache.getInstance();
  }

  async assembleGraphData(signal?: AbortSignal): Promise<PackageGraph> {
    const cacheKey = `${GraphHydrator.CACHE_VERSION}:${this.baseUrl}`;
    const cachedData = this.cache.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }

    const fetchSignal = signal ?? AbortSignal.timeout(30_000);
    let packagesPayload: GraphApiPackagePayload[] = [];

    const summaryResponse = await fetch(this.buildUrl('/graph/summary'), { signal: fetchSignal });
    if (summaryResponse.ok) {
      const payload = (await summaryResponse.json()) as { packages?: GraphApiPackagePayload[] };
      packagesPayload = Array.isArray(payload.packages) ? payload.packages : [];
    } else {
      const graphResponse = await fetch(this.buildUrl('/graph'), { signal: fetchSignal });
      if (graphResponse.ok) {
        const payload = (await graphResponse.json()) as { packages?: GraphApiPackagePayload[] };
        packagesPayload = Array.isArray(payload.packages) ? payload.packages : [];
      }
    }

    const registry = new EntityRegistry();
    const graph = this.hydratePackages(packagesPayload, registry);
    this.cache.set(cacheKey, graph);
    return graph;
  }

  async fetchModuleDetails(moduleId: string, signal?: AbortSignal): Promise<Module | null> {
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

    const payload = (await response.json()) as { module?: unknown };
    if (!payload.module) {
      this.moduleDetailsCache.set(moduleId, null);
      return null;
    }

    const registry = new EntityRegistry();
    const module = this.hydrateModule(payload.module, registry);
    this.moduleDetailsCache.set(moduleId, module);
    return module;
  }

  public clearCache(): void {
    this.cache.clear();
    this.moduleDetailsCache.clear();
  }

  private hydratePackages(items: GraphApiPackagePayload[], registry: EntityRegistry): PackageGraph {
    const byId = new Map<string, Package>();
    const graphPackages: Package[] = [];

    for (const raw of items) {
      const modules = this.hydrateModules(raw.modules, registry);
      const pkg = new Package(
        raw.id,
        raw.name,
        raw.version,
        raw.path,
        toString(raw.created_at, new Date().toISOString()),
        new Map(),
        new Map(),
        new Map(),
        modules
      );
      byId.set(pkg.id, registry.register(pkg.id, pkg));
      graphPackages.push(pkg);
    }

    // Second pass for package dependency references.
    for (const raw of items) {
      const pkg = byId.get(raw.id);
      if (!pkg) continue;
      (pkg.dependencies as Map<string, Package>).clear();
      this.hydratePackageRefs(raw.dependencies, byId).forEach((value, key) =>
        (pkg.dependencies as Map<string, Package>).set(key, value)
      );
      this.hydratePackageRefs(raw.devDependencies, byId).forEach((value, key) =>
        (pkg.devDependencies as Map<string, Package>).set(key, value)
      );
      this.hydratePackageRefs(raw.peerDependencies, byId).forEach((value, key) =>
        (pkg.peerDependencies as Map<string, Package>).set(key, value)
      );
    }

    return { packages: graphPackages };
  }

  private hydratePackageRefs(raw: unknown, existing: Map<string, Package>): Map<string, Package> {
    const refs = new Map<string, Package>();
    for (const item of collectionRecords(raw)) {
      const id = toString(item['id']);
      if (!id) continue;
      const found = existing.get(id);
      if (found) {
        refs.set(id, found);
      } else {
        refs.set(
          id,
          new Package(
            id,
            toString(item['name']),
            toString(item['version']),
            toString(item['path']),
            toString(item['created_at'])
          )
        );
      }
    }
    return refs;
  }

  private hydrateModules(raw: unknown, registry: EntityRegistry): Map<string, Module> {
    const modules = new Map<string, Module>();
    const values = collectionValues<unknown>(raw);
    for (const item of values) {
      const module = this.hydrateModule(item, registry);
      modules.set(module.id, module);
    }
    return modules;
  }

  private hydrateModule(raw: unknown, registry: EntityRegistry): Module {
    const row = asRecord(raw);
    const source = asRecord(row['source']);
    const imports = this.hydrateImports(row['imports']);
    const classes = this.hydrateClasses(row['classes'], registry);
    const interfaces = this.hydrateInterfaces(row['interfaces'], registry);
    const functions = this.hydrateFunctions(row['functions']);
    const typeAliases = this.hydrateTypeAliases(row['typeAliases'] ?? row['type_aliases']);
    const enums = this.hydrateEnums(row['enums']);
    const variables = this.hydrateVariables(row['variables']);
    const symbolRefs = this.hydrateSymbolReferences(row['symbol_references']);

    return new Module(
      toString(row['id']),
      toString(row['package_id']),
      toString(row['name']),
      {
        directory: '',
        name: toString(row['name']),
        filename: '',
        relativePath: toString(source['relativePath']),
      },
      toString(row['created_at'], new Date().toISOString()),
      classes,
      interfaces,
      imports,
      new Map(),
      new Map(),
      typeAliases,
      enums,
      functions,
      variables,
      [],
      symbolRefs
    );
  }

  private hydrateClasses(raw: unknown, registry: EntityRegistry): Map<string, Class> {
    const classes = new Map<string, Class>();
    for (const item of collectionRecords(raw)) {
      const methods = this.hydrateMethods(item['methods']);
      const properties = this.hydrateProperties(item['properties']);
      const implemented = this.hydrateInterfaces(item['implemented_interfaces'], registry);
      const cls = new Class(
        toString(item['id']),
        toString(item['package_id']),
        toString(item['module_id']),
        toString(item['name']),
        toString(item['created_at'], new Date().toISOString()),
        methods,
        properties,
        implemented,
        toString(item['extends_id']) || undefined
      );
      const registeredClass = registry.register(cls.id, cls);
      if (!isClass(registeredClass)) {
        throw new TypeError(`Expected hydrated Class instance for ${cls.id}`);
      }
      classes.set(registeredClass.id, registeredClass);
    }
    return classes;
  }

  private hydrateInterfaces(raw: unknown, registry: EntityRegistry): Map<string, Interface> {
    const interfaces = new Map<string, Interface>();
    for (const item of collectionRecords(raw)) {
      const methods = this.hydrateMethods(item['methods']);
      const properties = this.hydrateProperties(item['properties']);
      const extended = this.hydrateInterfaces(item['extended_interfaces'], registry);
      const iface = new Interface(
        toString(item['id']),
        toString(item['package_id']),
        toString(item['module_id']),
        toString(item['name']),
        toString(item['created_at'], new Date().toISOString()),
        methods,
        properties,
        extended
      );
      const registeredInterface = registry.register(iface.id, iface);
      if (!isInterface(registeredInterface)) {
        throw new TypeError(`Expected hydrated Interface instance for ${iface.id}`);
      }
      interfaces.set(registeredInterface.id, registeredInterface);
    }
    return interfaces;
  }

  private hydrateMethods(raw: unknown): Map<string, Method> {
    const methods = new Map<string, Method>();
    for (const item of collectionRecords(raw)) {
      const parameters = this.hydrateParameters(item['parameters']);
      const method = new Method(
        toString(item['id']),
        toString(item['package_id']),
        toString(item['module_id']),
        toString(item['parent_id']),
        toString(item['name']),
        toString(item['created_at'], new Date().toISOString()),
        parameters,
        toString(item['return_type'], toString(item['return_type'], 'void')),
        Boolean(item['is_static']),
        Boolean(item['is_async']),
        toString(item['visibility'], 'public')
      );
      methods.set(method.id, method);
    }
    return methods;
  }

  private hydrateProperties(raw: unknown): Map<string, Property> {
    const properties = new Map<string, Property>();
    for (const item of collectionRecords(raw)) {
      const property = new Property(
        toString(item['id']),
        toString(item['package_id']),
        toString(item['module_id']),
        toString(item['parent_id']),
        toString(item['name']),
        toString(item['created_at'], new Date().toISOString()),
        toString(item['type'], 'any'),
        Boolean(item['is_static']),
        Boolean(item['is_readonly']),
        toString(item['visibility'], 'public'),
        typeof item['default_value'] === 'string' ? item['default_value'] : undefined
      );
      properties.set(property.id, property);
    }
    return properties;
  }

  private hydrateParameters(raw: unknown): Map<string, IParameter> {
    const parameters = new Map<string, IParameter>();
    for (const item of collectionRecords(raw)) {
      const parameter = new Parameter(
        toString(item['id']),
        toString(item['package_id']),
        toString(item['module_id']),
        toString(item['method_id']),
        toString(item['name']),
        toString(item['created_at'], new Date().toISOString()),
        toString(item['type'], 'any'),
        Boolean(item['is_optional']),
        Boolean(item['is_rest']),
        typeof item['default_value'] === 'string' ? item['default_value'] : undefined
      );
      parameters.set(parameter.id, parameter);
    }
    return parameters;
  }

  private hydrateFunctions(raw: unknown): Map<string, IModuleFunction> {
    const functions = new Map<string, IModuleFunction>();
    for (const item of collectionRecords(raw)) {
      const fn = new ModuleFunction(
        toString(item['id']),
        toString(item['package_id']),
        toString(item['module_id']),
        toString(item['name']),
        toString(item['created_at'], new Date().toISOString()),
        new Map(),
        toString(item['return_type'], 'void'),
        Boolean(item['is_async']),
        Boolean(item['is_exported'])
      );
      functions.set(fn.id, fn);
    }
    return functions;
  }

  private hydrateTypeAliases(raw: unknown): Map<string, ITypeAlias> {
    const aliases = new Map<string, ITypeAlias>();
    for (const item of collectionRecords(raw)) {
      const typeParameters = collectionValues<string>(item['type_parameters']).filter(
        (value): value is string => typeof value === 'string'
      );
      const alias = new TypeAlias(
        toString(item['id']),
        toString(item['package_id']),
        toString(item['module_id']),
        toString(item['name']),
        toString(item['type']),
        typeParameters,
        toString(item['created_at'], new Date().toISOString())
      );
      aliases.set(alias.id, alias);
    }
    return aliases;
  }

  private hydrateEnums(raw: unknown): Map<string, IEnum> {
    const enums = new Map<string, IEnum>();
    for (const item of collectionRecords(raw)) {
      const enumMembers = collectionValues<string>(item['members']).filter(
        (value): value is string => typeof value === 'string'
      );
      const en = new Enum(
        toString(item['id']),
        toString(item['package_id']),
        toString(item['module_id']),
        toString(item['name']),
        enumMembers,
        toString(item['created_at'], new Date().toISOString())
      );
      enums.set(en.id, en);
    }
    return enums;
  }

  private hydrateVariables(raw: unknown): Map<string, IVariable> {
    const variables = new Map<string, IVariable>();
    for (const item of collectionRecords(raw)) {
      const variable = new Variable(
        toString(item['id']),
        toString(item['package_id']),
        toString(item['module_id']),
        toString(item['name']),
        toString(item['kind'], 'const') as 'const' | 'let' | 'var',
        toString(item['type'], 'unknown'),
        toString(item['initializer']),
        toString(item['created_at'], new Date().toISOString())
      );
      variables.set(variable.id, variable);
    }
    return variables;
  }

  private hydrateImports(raw: unknown): Map<string, Import> {
    const imports = new Map<string, Import>();
    for (const item of collectionRecords(raw)) {
      const importId = toString(item['uuid'], toString(item['id']));
      const specifiers = new Map<string, ImportSpecifier>();
      const rawSpecifiers = collectionRecords(item['specifiers']);
      rawSpecifiers.forEach((specifierRaw, index) => {
        const imported = toString(specifierRaw['imported'], toString(specifierRaw['name']));
        if (!imported) return;
        const local = toString(specifierRaw['local']);
        const uuid = `${importId}:specifier:${index.toString()}:${imported}`;
        const specifier = new ImportSpecifier(
          uuid,
          imported,
          toString(specifierRaw['kind'], 'value') as
            | 'value'
            | 'type'
            | 'typeof'
            | 'default'
            | 'namespace'
            | 'sideEffect',
          undefined,
          new Set(collectionValues<string>(specifierRaw['modules'])),
          new Set(collectionValues<string>(specifierRaw['aliases']))
        );
        if (local) {
          specifier.aliases.add(local);
        }
        specifiers.set(specifier.uuid, specifier);
      });

      const path = toString(
        item['path'],
        toString(item['relativePath'], toString(item['fullPath'], toString(item['name'])))
      );
      const imp = new Import(
        importId,
        toString(item['fullPath'], path),
        toString(item['relativePath'], path),
        toString(item['name'], path),
        specifiers
      );
      imports.set(imp.uuid, imp);
    }
    return imports;
  }

  private hydrateSymbolReferences(raw: unknown): Map<string, ISymbolReference> {
    const refs = new Map<string, ISymbolReference>();
    for (const item of collectionRecords(raw)) {
      const ref = new SymbolReference(
        toString(item['id']),
        toString(item['package_id']),
        toString(item['module_id']),
        toString(item['source_symbol_type'], 'module') as
          | 'module'
          | 'class'
          | 'interface'
          | 'function'
          | 'method'
          | 'property',
        toString(item['target_symbol_id']),
        toString(item['target_symbol_type'], 'method') as 'method' | 'property',
        toString(item['target_symbol_name']),
        toString(item['access_kind'], 'method') as 'method' | 'property',
        toString(item['created_at'], new Date().toISOString()),
        toString(item['source_symbol_id']) || undefined,
        toString(item['source_symbol_name']) || undefined,
        toString(item['qualifier_name']) || undefined
      );
      refs.set(ref.id, ref);
    }
    return refs;
  }

  private buildUrl(path: string): string {
    if (!this.baseUrl) return path;
    if (this.baseUrl.endsWith('/') && path.startsWith('/')) {
      return `${this.baseUrl.slice(0, -1)}${path}`;
    }
    return `${this.baseUrl}${path}`;
  }
}
