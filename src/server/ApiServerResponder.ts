import { consola } from 'consola';

import { isClass } from '../shared/types/Class';
import { isInterface } from '../shared/types/Interface';
import { isMethod } from '../shared/types/Method';
import { isProperty } from '../shared/types/Property';
import { Module } from '../shared/types/Module';
import { Database } from './db/Database';
import { DuckDBAdapter } from './db/adapter/DuckDBAdapter';
import { RepositoryError } from './db/errors/RepositoryError';
import { ClassRepository } from './db/repositories/ClassRepository';
import { CodeIssueRepository } from './db/repositories/CodeIssueRepository';
import { EnumRepository } from './db/repositories/EnumRepository';
import { FunctionRepository } from './db/repositories/FunctionRepository';
import { ImportRepository } from './db/repositories/ImportRepository';
import { InterfaceRepository } from './db/repositories/InterfaceRepository';
import { MethodRepository } from './db/repositories/MethodRepository';
import { ModuleRepository } from './db/repositories/ModuleRepository';
import { PackageRepository } from './db/repositories/PackageRepository';
import { PropertyRepository } from './db/repositories/PropertyRepository';
import { SymbolReferenceRepository } from './db/repositories/SymbolReferenceRepository';
import { TypeAliasRepository } from './db/repositories/TypeAliasRepository';
import { VariableRepository } from './db/repositories/VariableRepository';
import { InsightEngine } from './insights/InsightEngine';

import type { Package } from '../shared/types/Package';
import type { TypeCollection } from '../shared/types/TypeCollection';
import type { CodeIssueRef } from '../shared/types/api/CodeIssueRef';
import type { InsightReport } from '../shared/types/api/Insight';
import type { Method } from '../shared/types/Method';
import type { Property } from '../shared/types/Property';
import type { CodeIssueEntity } from './db/types/CodeIssueEntity';

export interface ApiServerResponderOptions {
  dbPath?: string;
  readOnly?: boolean;
}

interface PackagesResponseItem {
  id: string;
  name: string;
  version: string;
  path: string;
  created_at: string;
  dependencies: TypeCollection<Package>;
  devDependencies: TypeCollection<Package>;
  peerDependencies: TypeCollection<Package>;
  modules: string[];
}

interface GraphResponseItem extends Omit<PackagesResponseItem, 'modules'> {
  modules: Module[];
}

interface PersistedImportSpecifier {
  imported: string;
  local?: string;
  kind: 'value' | 'type' | 'default' | 'namespace' | 'sideEffect';
}

function normalizeImportSpecifier(value: unknown): PersistedImportSpecifier | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const entry = value as { imported?: unknown; local?: unknown; kind?: unknown };
  if (typeof entry.imported !== 'string' || entry.imported.length === 0) {
    return undefined;
  }

  const kind =
    entry.kind === 'value' ||
    entry.kind === 'type' ||
    entry.kind === 'default' ||
    entry.kind === 'namespace' ||
    entry.kind === 'sideEffect'
      ? entry.kind
      : 'value';

  return {
    imported: entry.imported,
    ...(typeof entry.local === 'string' && entry.local.length > 0 ? { local: entry.local } : {}),
    kind,
  };
}

function parseImportSpecifiers(specifiersJson: string | undefined): PersistedImportSpecifier[] {
  if (!specifiersJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(specifiersJson) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const normalized = parsed
      .map((entry) => normalizeImportSpecifier(entry))
      .filter((entry): entry is PersistedImportSpecifier => Boolean(entry));

    return normalized;
  } catch {
    return [];
  }
}

function inferExternalPackageName(source: string): string | undefined {
  if (
    !source ||
    source.startsWith('.') ||
    source.startsWith('/') ||
    source.startsWith('@/') ||
    source.startsWith('src/')
  ) {
    return undefined;
  }

  if (source.startsWith('@')) {
    const [scope, name] = source.split('/').slice(0, 2);
    if (!scope || !name) {
      return undefined;
    }
    return `${scope}/${name}`;
  }

  const [packageName] = source.split('/');
  return packageName ?? undefined;
}

const typeCollectionToArray = <T>(collection: TypeCollection<T> | undefined): T[] => {
  if (!collection) {
    return [];
  }
  if (collection instanceof Map) {
    return Array.from(collection.values());
  }
  if (Array.isArray(collection)) {
    return collection;
  }
  return Object.values(collection);
};

function filterHydratedMethods(methods: unknown): Map<string, Method> {
  if (!(methods instanceof Map)) {
    return new Map<string, Method>();
  }

  const filtered = new Map<string, Method>();
  for (const [id, method] of methods.entries()) {
    if (!isMethod(method)) continue;
    filtered.set(id as string, method);
  }

  return filtered;
}

function filterHydratedProperties(properties: unknown): Map<string, Property> {
  if (!(properties instanceof Map)) {
    return new Map<string, Property>();
  }

  const filtered = new Map<string, Property>();
  for (const [id, property] of properties.entries()) {
    if (!isProperty(property)) continue;
    filtered.set(id as string, property);
  }

  return filtered;
}

function codeIssueSeverityToPublic(severity: string): 'info' | 'warning' | 'error' {
  if (severity === 'info' || severity === 'warning' || severity === 'error') {
    return severity;
  }
  return 'info';
}

function codeIssueEntityToRef(entity: CodeIssueEntity): CodeIssueRef {
  return {
    id: entity.id,
    rule_code: entity.rule_code,
    severity: codeIssueSeverityToPublic(entity.severity),
    message: entity.message,
    ...(entity.suggestion !== undefined ? { suggestion: entity.suggestion } : {}),
    module_id: entity.module_id,
    ...(entity.entity_id !== undefined ? { entity_id: entity.entity_id } : {}),
    ...(entity.entity_type !== undefined ? { entity_type: entity.entity_type } : {}),
    ...(entity.entity_name !== undefined ? { entity_name: entity.entity_name } : {}),
    ...(entity.parent_entity_id !== undefined ? { parent_entity_id: entity.parent_entity_id } : {}),
    ...(entity.parent_entity_type !== undefined ? { parent_entity_type: entity.parent_entity_type } : {}),
    ...(entity.parent_entity_name !== undefined ? { parent_entity_name: entity.parent_entity_name } : {}),
    ...(entity.property_name !== undefined ? { property_name: entity.property_name } : {}),
    ...(entity.line !== undefined ? { line: entity.line } : {}),
    ...(entity.column !== undefined ? { column: entity.column } : {}),
    ...(entity.refactor_action !== undefined ? { refactor_action: entity.refactor_action } : {}),
  };
}

export class ApiServerResponder {
  private readonly database: Database;
  private readonly dbAdapter: DuckDBAdapter;
  private readonly logger = consola.withTag('ApiServerResponder');
  private readonly readOnly: boolean;

  private readonly classRepository: ClassRepository;
  private readonly enumRepository: EnumRepository;
  private readonly functionRepository: FunctionRepository;
  private readonly interfaceRepository: InterfaceRepository;
  private readonly importRepository: ImportRepository;
  private readonly methodRepository: MethodRepository;
  private readonly moduleRepository: ModuleRepository;
  private readonly packageRepository: PackageRepository;
  private readonly propertyRepository: PropertyRepository;
  private readonly symbolReferenceRepository: SymbolReferenceRepository;
  private readonly typeAliasRepository: TypeAliasRepository;
  private readonly variableRepository: VariableRepository;
  private readonly codeIssueRepository: CodeIssueRepository;

  constructor(options: ApiServerResponderOptions = {}) {
    const dbPath = options.dbPath ?? 'typescript-viewer.duckdb';
    this.readOnly = options.readOnly ?? false;
    this.dbAdapter = new DuckDBAdapter(dbPath, { allowWrite: !this.readOnly });
    this.database = new Database(this.dbAdapter, dbPath);

    // Initialize repositories
    this.classRepository = new ClassRepository(this.dbAdapter);
    this.enumRepository = new EnumRepository(this.dbAdapter);
    this.functionRepository = new FunctionRepository(this.dbAdapter);
    this.interfaceRepository = new InterfaceRepository(this.dbAdapter);
    this.importRepository = new ImportRepository(this.dbAdapter);
    this.methodRepository = new MethodRepository(this.dbAdapter);
    this.moduleRepository = new ModuleRepository(this.dbAdapter);
    this.packageRepository = new PackageRepository(this.dbAdapter);
    this.propertyRepository = new PropertyRepository(this.dbAdapter);
    this.symbolReferenceRepository = new SymbolReferenceRepository(this.dbAdapter);
    this.typeAliasRepository = new TypeAliasRepository(this.dbAdapter);
    this.variableRepository = new VariableRepository(this.dbAdapter);
    this.codeIssueRepository = new CodeIssueRepository(this.dbAdapter);
  }

  async initialize(): Promise<void> {
    try {
      // Initialize database connection and prevent schema mutations in read-only mode.
      await this.database.initializeDatabase(false, !this.readOnly);
      this.logger.info(`Database initialized in ${this.readOnly ? 'read-only' : 'read-write'} mode`);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to initialize database',
        'initialize',
        'ApiServerResponder',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async getPackages(): Promise<PackagesResponseItem[]> {
    try {
      const packages = await this.packageRepository.retrieve();
      return packages.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        version: pkg.version,
        path: pkg.path,
        created_at: pkg.created_at,
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
        peerDependencies: pkg.peerDependencies,
        // Intentionally omitted to avoid a package-level N+1 module lookup.
        modules: [],
      }));
    } catch (error) {
      this.logger.error('Failed to get packages, returning empty list', error);
      return [];
    }
  }

  async getGraph(): Promise<{ packages: GraphResponseItem[] }> {
    try {
      const packages = await this.packageRepository.retrieve();
      const PACKAGE_CONCURRENCY = 4;
      const queue = packages.map((pkg, index) => ({ pkg, index }));
      const responses = new Map<number, GraphResponseItem>();

      const worker = async (): Promise<void> => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) {
            return;
          }
          const { pkg, index } = next;

          try {
            const modules = await this.getModules(pkg.id);
            responses.set(index, {
              id: pkg.id,
              name: pkg.name,
              version: pkg.version,
              path: pkg.path,
              created_at: pkg.created_at,
              dependencies: pkg.dependencies,
              devDependencies: pkg.devDependencies,
              peerDependencies: pkg.peerDependencies,
              modules,
            });
          } catch (error) {
            this.logger.error(`Failed to build graph package payload for ${pkg.id}`, error);
            responses.set(index, {
              id: pkg.id,
              name: pkg.name,
              version: pkg.version,
              path: pkg.path,
              created_at: pkg.created_at,
              dependencies: pkg.dependencies,
              devDependencies: pkg.devDependencies,
              peerDependencies: pkg.peerDependencies,
              modules: [],
            });
          }
        }
      };

      const workerCount = Math.min(PACKAGE_CONCURRENCY, Math.max(1, queue.length));
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      return {
        packages: packages
          .map((_, index) => responses.get(index))
          .filter((item): item is GraphResponseItem => Boolean(item)),
      };
    } catch (error) {
      this.logger.error('Failed to build graph payload, returning empty graph', error);
      return { packages: [] };
    }
  }

  private toGraphSummaryModule(module: Module): Module {
    const summarizedClasses = typeCollectionToArray(
      module.classes as TypeCollection<{
        id: string;
        package_id: string;
        module_id: string;
        name: string;
        created_at: string;
        extends_id?: string;
        methods?: TypeCollection<unknown>;
        properties?: TypeCollection<unknown>;
        implemented_interfaces?: TypeCollection<{
          id: string;
          package_id: string;
          module_id: string;
          name: string;
          created_at: string;
        }>;
      }>
    ).map((cls) => ({
      id: cls.id,
      package_id: cls.package_id,
      module_id: cls.module_id,
      name: cls.name,
      created_at: cls.created_at,
      ...(cls.extends_id ? { extends_id: cls.extends_id } : {}),
      implemented_interfaces: typeCollectionToArray(cls.implemented_interfaces).map((iface) => ({
        id: iface.id,
        package_id: iface.package_id,
        module_id: iface.module_id,
        name: iface.name,
        created_at: iface.created_at,
      })),
      methods: typeCollectionToArray(cls.methods),
      properties: typeCollectionToArray(cls.properties),
    }));

    const summarizedInterfaces = typeCollectionToArray(
      module.interfaces as TypeCollection<{
        id: string;
        package_id: string;
        module_id: string;
        name: string;
        created_at: string;
        methods?: TypeCollection<unknown>;
        properties?: TypeCollection<unknown>;
        extended_interfaces?: TypeCollection<{
          id: string;
          package_id: string;
          module_id: string;
          name: string;
          created_at: string;
        }>;
      }>
    ).map((iface) => ({
      id: iface.id,
      package_id: iface.package_id,
      module_id: iface.module_id,
      name: iface.name,
      created_at: iface.created_at,
      extended_interfaces: typeCollectionToArray(iface.extended_interfaces).map((extended) => ({
        id: extended.id,
        package_id: extended.package_id,
        module_id: extended.module_id,
        name: extended.name,
        created_at: extended.created_at,
      })),
      methods: typeCollectionToArray(iface.methods),
      properties: typeCollectionToArray(iface.properties),
    }));

    const summarizedImports = typeCollectionToArray(
      module.imports as TypeCollection<{
        uuid: string;
        name?: string;
        relativePath?: string;
        fullPath?: string;
        path?: string;
        specifiers?: unknown;
        isExternal?: boolean;
        packageName?: string;
      }>
    ).map((imp) => ({
      uuid: imp.uuid,
      ...(imp.name ? { name: imp.name } : {}),
      ...(imp.relativePath ? { relativePath: imp.relativePath } : {}),
      ...(imp.fullPath ? { fullPath: imp.fullPath } : {}),
      ...(imp.path ? { path: imp.path } : {}),
      ...(Array.isArray(imp.specifiers) ? { specifiers: imp.specifiers } : {}),
      ...(typeof imp.isExternal === 'boolean' ? { isExternal: imp.isExternal } : {}),
      ...(imp.packageName ? { packageName: imp.packageName } : {}),
    }));

    return {
      id: module.id,
      package_id: module.package_id,
      name: module.name,
      source: module.source,
      created_at: module.created_at,
      referencePaths: module.referencePaths,
      classes: summarizedClasses,
      interfaces: summarizedInterfaces,
      imports: summarizedImports,
      exports: typeCollectionToArray(module.exports),
      packages: typeCollectionToArray(module.packages),
      typeAliases: typeCollectionToArray(module.typeAliases),
      enums: typeCollectionToArray(module.enums),
      functions: typeCollectionToArray(module.functions),
      variables: typeCollectionToArray(module.variables),
      symbol_references: typeCollectionToArray(module.symbol_references),
    } as unknown as Module;
  }

  async getGraphSummary(): Promise<{ packages: GraphResponseItem[] }> {
    try {
      const packages = await this.packageRepository.retrieve();
      const PACKAGE_CONCURRENCY = 4;
      const queue = packages.map((pkg, index) => ({ pkg, index }));
      const responses = new Map<number, GraphResponseItem>();

      const worker = async (): Promise<void> => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) {
            return;
          }
          const { pkg, index } = next;

          try {
            const modules = (await this.getModules(pkg.id)).map((module) => this.toGraphSummaryModule(module));
            responses.set(index, {
              id: pkg.id,
              name: pkg.name,
              version: pkg.version,
              path: pkg.path,
              created_at: pkg.created_at,
              dependencies: pkg.dependencies,
              devDependencies: pkg.devDependencies,
              peerDependencies: pkg.peerDependencies,
              modules,
            });
          } catch (error) {
            this.logger.error(`Failed to build graph summary package payload for ${pkg.id}`, error);
            responses.set(index, {
              id: pkg.id,
              name: pkg.name,
              version: pkg.version,
              path: pkg.path,
              created_at: pkg.created_at,
              dependencies: pkg.dependencies,
              devDependencies: pkg.devDependencies,
              peerDependencies: pkg.peerDependencies,
              modules: [],
            });
          }
        }
      };

      const workerCount = Math.min(PACKAGE_CONCURRENCY, Math.max(1, queue.length));
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      return {
        packages: packages
          .map((_, index) => responses.get(index))
          .filter((item): item is GraphResponseItem => Boolean(item)),
      };
    } catch (error) {
      this.logger.error('Failed to build graph summary payload, returning empty graph', error);
      return { packages: [] };
    }
  }

  async getModuleDetails(moduleId: string): Promise<Module | null> {
    try {
      const module = await this.moduleRepository.retrieveById(moduleId);
      if (!module) {
        return null;
      }

      const packageModules = await this.getModules(module.package_id);
      return packageModules.find((candidate) => candidate.id === moduleId) ?? null;
    } catch (error) {
      this.logger.error(`Failed to retrieve module details for ${moduleId}`, error);
      return null;
    }
  }

  async getModules(packageId: string): Promise<Module[]> {
    try {
      const modules = await this.moduleRepository.retrieveAll(packageId);
      if (modules.length === 0) return [];

      // Collect all module IDs upfront
      const moduleIds = modules.map((m) => m.id);

      // Batch-fetch all entities for all modules in one query each
      const [
        allClasses,
        allInterfaces,
        allFunctions,
        allTypeAliases,
        allEnums,
        allVariables,
        allImports,
        allSymbolRefs,
      ] = await Promise.all([
        this.classRepository.retrieveByModuleIds(moduleIds),
        this.interfaceRepository.retrieveByModuleIds(moduleIds),
        this.functionRepository.retrieveByModuleIds(moduleIds),
        this.typeAliasRepository.retrieveByModuleIds(moduleIds),
        this.enumRepository.retrieveByModuleIds(moduleIds),
        this.variableRepository.retrieveByModuleIds(moduleIds),
        this.importRepository.retrieveByModuleIds(moduleIds),
        this.symbolReferenceRepository.retrieveByModuleIds(moduleIds),
      ]);

      // Collect all class IDs and interface IDs for batch method/property retrieval
      const classIds = allClasses.map((c) => c.id);
      const interfaceIds = allInterfaces.map((i) => i.id);

      // Batch-fetch all methods and properties for all classes and interfaces
      const [classMethodsMap, classPropertiesMap, ifaceMethodsMap, ifacePropertiesMap] = await Promise.all([
        this.methodRepository.retrieveByParentIds(classIds, 'class'),
        this.propertyRepository.retrieveByParentIds(classIds, 'class'),
        this.methodRepository.retrieveByParentIds(interfaceIds, 'interface'),
        this.propertyRepository.retrieveByParentIds(interfaceIds, 'interface'),
      ]);

      // Group classes by module_id
      const classesByModule = new Map<string, typeof allClasses>();
      for (const cls of allClasses) {
        let arr = classesByModule.get(cls.module_id);
        if (!arr) {
          arr = [];
          classesByModule.set(cls.module_id, arr);
        }
        arr.push(cls);
      }

      // Group interfaces by module_id
      const interfacesByModule = new Map<string, typeof allInterfaces>();
      for (const iface of allInterfaces) {
        let arr = interfacesByModule.get(iface.module_id);
        if (!arr) {
          arr = [];
          interfacesByModule.set(iface.module_id, arr);
        }
        arr.push(iface);
      }

      // Group imports by module_id
      const importsByModule = new Map<string, typeof allImports>();
      for (const imp of allImports) {
        let arr = importsByModule.get(imp.module_id);
        if (!arr) {
          arr = [];
          importsByModule.set(imp.module_id, arr);
        }
        arr.push(imp);
      }

      // Group functions by module_id
      const functionsByModule = new Map<string, typeof allFunctions>();
      for (const fn of allFunctions) {
        let arr = functionsByModule.get(fn.module_id);
        if (!arr) {
          arr = [];
          functionsByModule.set(fn.module_id, arr);
        }
        arr.push(fn);
      }

      // Group type aliases by module_id
      const typeAliasesByModule = new Map<string, typeof allTypeAliases>();
      for (const ta of allTypeAliases) {
        let arr = typeAliasesByModule.get(ta.module_id);
        if (!arr) {
          arr = [];
          typeAliasesByModule.set(ta.module_id, arr);
        }
        arr.push(ta);
      }

      // Group enums by module_id
      const enumsByModule = new Map<string, typeof allEnums>();
      for (const en of allEnums) {
        let arr = enumsByModule.get(en.module_id);
        if (!arr) {
          arr = [];
          enumsByModule.set(en.module_id, arr);
        }
        arr.push(en);
      }

      // Group variables by module_id
      const variablesByModule = new Map<string, typeof allVariables>();
      for (const v of allVariables) {
        let arr = variablesByModule.get(v.module_id);
        if (!arr) {
          arr = [];
          variablesByModule.set(v.module_id, arr);
        }
        arr.push(v);
      }

      // Group symbol references by module_id
      const symbolRefsByModule = new Map<string, typeof allSymbolRefs>();
      for (const ref of allSymbolRefs) {
        let arr = symbolRefsByModule.get(ref.module_id);
        if (!arr) {
          arr = [];
          symbolRefsByModule.set(ref.module_id, arr);
        }
        arr.push(ref);
      }

      // Build enriched modules from in-memory data
      const enrichedModules: Module[] = [];
      for (const mod of modules) {
        try {
          // Build classes map for this module
          const classes = new Map();
          const moduleClasses = classesByModule.get(mod.id) ?? [];
          for (const cls of moduleClasses) {
            if (!isClass(cls)) continue;

            const methods = filterHydratedMethods(classMethodsMap.get(cls.id));
            const properties = filterHydratedProperties(classPropertiesMap.get(cls.id));
            classes.set(cls.id, {
              id: cls.id,
              package_id: cls.package_id,
              module_id: cls.module_id,
              name: cls.name,
              created_at: cls.created_at,
              methods,
              properties,
              implemented_interfaces: cls.implemented_interfaces,
              extends_id: cls.extends_id,
            });
          }

          // Build interfaces map for this module
          const interfaces = new Map();
          const moduleInterfaces = interfacesByModule.get(mod.id) ?? [];
          for (const iface of moduleInterfaces) {
            if (!isInterface(iface)) continue;

            const methods = filterHydratedMethods(ifaceMethodsMap.get(iface.id));
            const properties = filterHydratedProperties(ifacePropertiesMap.get(iface.id));
            interfaces.set(iface.id, {
              id: iface.id,
              package_id: iface.package_id,
              module_id: iface.module_id,
              name: iface.name,
              created_at: iface.created_at,
              methods,
              properties,
              extended_interfaces: iface.extended_interfaces,
            });
          }

          // Build imports map for this module
          const imports = new Map();
          const moduleImports = importsByModule.get(mod.id) ?? [];
          for (const imp of moduleImports) {
            const specifiers = parseImportSpecifiers(imp.specifiers_json);
            const packageName = inferExternalPackageName(imp.source);
            imports.set(imp.id, {
              uuid: imp.id,
              fullPath: imp.source,
              relativePath: imp.source,
              name: imp.source,
              specifiers,
              isExternal: Boolean(packageName),
              ...(packageName ? { packageName } : {}),
              depth: 0,
            });
          }

          // Build functions map for this module
          const functions = new Map();
          const moduleFunctions = functionsByModule.get(mod.id) ?? [];
          for (const fn of moduleFunctions) {
            functions.set(fn.id, fn);
          }

          // Build type aliases map for this module
          const typeAliases = new Map();
          const moduleTypeAliases = typeAliasesByModule.get(mod.id) ?? [];
          for (const ta of moduleTypeAliases) {
            typeAliases.set(ta.id, ta);
          }

          // Build enums map for this module
          const enums = new Map();
          const moduleEnums = enumsByModule.get(mod.id) ?? [];
          for (const en of moduleEnums) {
            enums.set(en.id, en);
          }

          // Build variables map for this module
          const variables = new Map();
          const moduleVariables = variablesByModule.get(mod.id) ?? [];
          for (const v of moduleVariables) {
            variables.set(v.id, v);
          }

          // Build symbol references map for this module
          const symbolReferences = new Map();
          const moduleSymbolRefs = symbolRefsByModule.get(mod.id) ?? [];
          for (const ref of moduleSymbolRefs) {
            symbolReferences.set(ref.id, {
              ...ref,
              created_at: new Date().toISOString(),
            });
          }

          enrichedModules.push(
            new Module(
              mod.id,
              mod.package_id,
              mod.name,
              mod.source,
              mod.created_at,
              classes,
              interfaces,
              imports,
              mod.exports,
              mod.packages,
              typeAliases,
              enums,
              functions,
              variables,
              mod.referencePaths,
              symbolReferences
            )
          );
        } catch (error) {
          this.logger.error(`Failed to process module ${mod.id}:`, error);
          // Continue with next module
        }
      }

      return enrichedModules;
    } catch (error) {
      this.logger.error('Failed to get modules, returning empty list', error);
      return [];
    }
  }

  async getCodeIssues(): Promise<CodeIssueRef[]> {
    try {
      const rows = await this.codeIssueRepository.retrieve();
      return rows.map(codeIssueEntityToRef);
    } catch {
      // Table may not exist if analysis hasn't been run
      return [];
    }
  }

  async getCodeIssueById(id: string): Promise<CodeIssueRef | undefined> {
    try {
      const entity = await this.codeIssueRepository.retrieveById(id);
      return entity ? codeIssueEntityToRef(entity) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Full stored issue for server-only routes (e.g. /refactor) that need file_path and refactor_context.
   */
  async getCodeIssueEntityById(id: string): Promise<CodeIssueEntity | undefined> {
    try {
      return await this.codeIssueRepository.retrieveById(id);
    } catch {
      return undefined;
    }
  }

  async getInsights(packageId?: string): Promise<InsightReport> {
    const engine = new InsightEngine(this.dbAdapter);
    return engine.compute(packageId);
  }
}
