import { createLogger } from '../../shared/utils/logger';
import { generatePackageUUID } from '../utils/uuid';
import { DependencyParser } from './DependencyParser';
import { FileDiscovery, DEFAULT_FILE_DISCOVERY_CONFIG } from './FileDiscovery';
import { ModuleParser } from './ModuleParser';
import { RelationshipResolver } from './RelationshipResolver';
import { VueScriptExtractor } from './VueScriptExtractor';
import { detectCircularDependencies } from './utils/detectCircularDependencies';

import type { Export } from '../../shared/types/Export';
import type { Import } from '../../shared/types/Import';
import type { CallEdge } from './utils/extractCallGraph';
import type { CircularDependency, ModuleDescriptor } from './utils/detectCircularDependencies';
import type { TechDebtMarker } from './utils/detectTechDebt';
import type { TypeReference } from './utils/extractTypeReferences';
import type { IClassCreateDTO } from '../db/repositories/ClassRepository';
import type { IEnumCreateDTO } from '../db/repositories/EnumRepository';
import type { IFunctionCreateDTO } from '../db/repositories/FunctionRepository';
import type { IInterfaceCreateDTO } from '../db/repositories/InterfaceRepository';
import type { IMethodCreateDTO } from '../db/repositories/MethodRepository';
import type { IModuleCreateDTO } from '../db/repositories/ModuleRepository';
import type { IPackageCreateDTO } from '../db/repositories/PackageRepository';
import type { IParameterCreateDTO } from '../db/repositories/ParameterRepository';
import type { IPropertyCreateDTO } from '../db/repositories/PropertyRepository';
import type { ITypeAliasCreateDTO } from '../db/repositories/TypeAliasRepository';
import type { IVariableCreateDTO } from '../db/repositories/VariableRepository';
import type { FileDiscoveryConfig } from './FileDiscovery';
import type { ModuleComplexityMetrics } from './utils/moduleAnalysis';
import type { ClassExtendsRef, ClassImplementsRef, InterfaceExtendsRef, ParseResult, SymbolUsageRef } from './ParseResult';

/** @deprecated Use {@link FileDiscoveryConfig} instead */
export type PackageParserConfig = FileDiscoveryConfig;

/**
 * Runs an async mapping function over items with bounded concurrency.
 * Workers pull from a shared index to keep all slots busy.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await fn(item);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function isProjectImportPath(importPath: string): boolean {
  return (
    importPath.startsWith('.')
    || importPath.startsWith('/')
    || importPath.startsWith('@/')
    || importPath.startsWith('src/')
  );
}

function getExternalImportedNames(imports: Import[]): Set<string> {
  const names = new Set<string>();

  for (const importRecord of imports) {
    const importPath = importRecord.relativePath || importRecord.fullPath;
    if (!importPath || isProjectImportPath(importPath)) {
      continue;
    }

    importRecord.specifiers.forEach((specifier, localName) => {
      names.add(localName);
      specifier.aliases.forEach((alias) => names.add(alias));
    });
  }

  return names;
}

export class PackageParser {
  private readonly fileDiscovery: FileDiscovery;
  private readonly vueExtractor: VueScriptExtractor;
  private readonly dependencyParser: DependencyParser;
  private readonly relationshipResolver: RelationshipResolver;
  private readonly config: FileDiscoveryConfig;
  private readonly logger = createLogger('PackageParser');

  constructor(
    private readonly packagePath: string,
    private readonly packageName: string,
    private readonly packageVersion: string,
    private readonly commitHash?: string,
    config?: Partial<FileDiscoveryConfig>
  ) {
    this.config = { ...DEFAULT_FILE_DISCOVERY_CONFIG, ...config };
    this.fileDiscovery = new FileDiscovery(packagePath, this.config);
    this.vueExtractor = new VueScriptExtractor();
    this.dependencyParser = new DependencyParser(packagePath);
    this.relationshipResolver = new RelationshipResolver();
  }

  async parse(): Promise<ParseResult> {
    const packageId = generatePackageUUID(this.packageName, this.packageVersion, this.commitHash);

    // 1. Parse dependencies from package.json
    const depResult = await this.dependencyParser.parseDependencies();

    // 2. Create package DTO
    const packageDTO: IPackageCreateDTO = {
      id: packageId,
      name: this.packageName,
      version: this.packageVersion,
      path: this.packagePath,
      ...(this.commitHash !== undefined ? { commit_hash: this.commitHash } : {}),
      dependencies: depResult.dependencies,
      devDependencies: depResult.devDependencies,
      peerDependencies: depResult.peerDependencies,
    };

    // 3. Discover source files
    const files = await this.fileDiscovery.collectFiles();

    // 4. Parse all files concurrently
    const parseResults = await mapWithConcurrency(files, this.config.concurrency, async (file) => {
      const sourceOverride = await this.vueExtractor.getSourceOverride(file);
      const moduleParser = new ModuleParser(file, packageId, sourceOverride);
      return moduleParser.parse();
    });

    // 5. Collect results from all modules
    const collected = this.collectModuleResults(parseResults);

    // 5a. Detect circular dependencies among parsed modules
    const moduleDescriptors: ModuleDescriptor[] = collected.modules.map((m) => {
      const modulePath = m.source.relativePath;
      const moduleImports = collected.importsWithModules
        .filter((entry) => entry.moduleId === m.id)
        .map((entry) => ({ source: entry.import.relativePath }));
      return { path: modulePath, imports: moduleImports };
    });
    const circularDependencies: CircularDependency[] = detectCircularDependencies(moduleDescriptors);
    if (circularDependencies.length > 0) {
      this.logger.info(`Found ${String(circularDependencies.length)} circular dependencies`);
    }

    // 5b. Collect call edges from per-module results
    // TODO: Call graph extraction (extractCallEdges) needs to happen during AST parsing
    // in ModuleParser where function body AST nodes are available. Once ModuleParser
    // populates callEdges on each module's ParseResult, they will be aggregated here.
    const callEdges: CallEdge[] = collected.callEdges;

    // 6. Build name lookup maps
    const classNameToIds = new Map<string, Set<string>>();
    for (const cls of collected.classes) {
      this.relationshipResolver.addNameMapping(classNameToIds, cls.name, cls.id);
    }
    const interfaceNameToIds = new Map<string, Set<string>>();
    for (const iface of collected.interfaces) {
      this.relationshipResolver.addNameMapping(interfaceNameToIds, iface.name, iface.id);
    }

    // 7. Resolve relationships
    const resolved = this.relationshipResolver.resolveRelationships(
      collected.rawClassExtends,
      collected.rawClassImplements,
      collected.rawInterfaceExtends,
      classNameToIds,
      interfaceNameToIds
    );

    // 8. Resolve symbol references
    const { resolved: symbolReferences } = this.relationshipResolver.resolveSymbolReferences(
      packageId,
      collected.symbolUsages,
      classNameToIds,
      interfaceNameToIds,
      collected.methods,
      collected.properties
    );

    // 9. Deduplicate and assemble final result
    const modules = uniqueById(collected.modules);
    const classes = uniqueById(collected.classes);
    const interfaces = uniqueById(collected.interfaces);
    const functions = uniqueById(collected.functions);
    const typeAliases = uniqueById(collected.typeAliases);
    const enums = uniqueById(collected.enums);
    const variables = uniqueById(collected.variables);
    const methods = uniqueById(collected.methods);
    const properties = uniqueById(collected.properties);
    const parameters = uniqueById(collected.parameters);
    const exports = uniqueByKey(collected.moduleExports, (e) => e.uuid);
    const imports = [
      ...Array.from(depResult.imports.values()),
      ...uniqueByKey(collected.moduleImports, (i) => i.uuid),
    ];
    const typeReferences = uniqueByKey(
      collected.typeReferences,
      (ref) => `${ref.sourceId}:${ref.sourceKind}:${ref.context}:${ref.typeName}`
    );

    return {
      package: packageDTO,
      modules,
      classes,
      interfaces,
      functions,
      typeAliases,
      enums,
      variables,
      methods,
      properties,
      parameters,
      imports,
      exports,
      importsWithModules: Array.from(
        new Map(collected.importsWithModules.map((entry) => [`${entry.moduleId}:${entry.import.uuid}`, entry])).values()
      ),
      classExtends: resolved.classExtends,
      classImplements: resolved.classImplements,
      interfaceExtends: resolved.interfaceExtends,
      symbolUsages: collected.symbolUsages,
      symbolReferences: uniqueById(symbolReferences),
      techDebtMarkers: collected.techDebtMarkers,
      moduleMetrics: aggregateModuleMetrics(collected.moduleMetrics),
      circularDependencies,
      callEdges,
      typeReferences,
    };
  }

  private collectModuleResults(parseResults: ParseResult[]): CollectedModuleData {
    const modules: IModuleCreateDTO[] = [];
    const classes: IClassCreateDTO[] = [];
    const interfaces: IInterfaceCreateDTO[] = [];
    const functions: IFunctionCreateDTO[] = [];
    const typeAliases: ITypeAliasCreateDTO[] = [];
    const enums: IEnumCreateDTO[] = [];
    const variables: IVariableCreateDTO[] = [];
    const methods: IMethodCreateDTO[] = [];
    const properties: IPropertyCreateDTO[] = [];
    const parameters: IParameterCreateDTO[] = [];
    const moduleImports: Import[] = [];
    const moduleExports: Export[] = [];
    const importsWithModules: { import: Import; moduleId: string }[] = [];
    const rawClassExtends: ClassExtendsRef[] = [];
    const rawClassImplements: ClassImplementsRef[] = [];
    const rawInterfaceExtends: InterfaceExtendsRef[] = [];
    const symbolUsages: SymbolUsageRef[] = [];
    const callEdges: CallEdge[] = [];
    const techDebtMarkers: TechDebtMarker[] = [];
    const moduleMetrics: ModuleComplexityMetrics[] = [];
    const typeReferences: TypeReference[] = [];

    for (const moduleResult of parseResults) {
      const moduleId = moduleResult.modules[0]?.id ?? '';

      modules.push(...moduleResult.modules);
      classes.push(...moduleResult.classes);
      interfaces.push(...moduleResult.interfaces);
      functions.push(...moduleResult.functions);
      typeAliases.push(...moduleResult.typeAliases);
      enums.push(...moduleResult.enums);
      variables.push(...moduleResult.variables);
      methods.push(...moduleResult.methods);
      properties.push(...moduleResult.properties);
      parameters.push(...moduleResult.parameters);
      moduleExports.push(...moduleResult.exports);
      for (const imp of moduleResult.imports) {
        moduleImports.push(imp);
        importsWithModules.push({ import: imp, moduleId });
      }

      rawClassExtends.push(...moduleResult.classExtends);
      rawClassImplements.push(...moduleResult.classImplements);
      rawInterfaceExtends.push(...moduleResult.interfaceExtends);
      symbolUsages.push(...moduleResult.symbolUsages);
      if (moduleResult.callEdges && moduleResult.callEdges.length > 0) {
        callEdges.push(...moduleResult.callEdges);
      }
      if (moduleResult.techDebtMarkers && moduleResult.techDebtMarkers.length > 0) {
        techDebtMarkers.push(...moduleResult.techDebtMarkers);
      }
      if (moduleResult.moduleMetrics) {
        moduleMetrics.push(moduleResult.moduleMetrics);
      }
      if (moduleResult.typeReferences && moduleResult.typeReferences.length > 0) {
        const externalImportedTypeNames = getExternalImportedNames(moduleResult.imports);
        typeReferences.push(
          ...moduleResult.typeReferences.filter((reference) => !externalImportedTypeNames.has(reference.typeName))
        );
      }
    }

    return {
      modules,
      classes,
      interfaces,
      functions,
      typeAliases,
      enums,
      variables,
      methods,
      properties,
      parameters,
      moduleImports,
      moduleExports,
      importsWithModules,
      rawClassExtends,
      rawClassImplements,
      rawInterfaceExtends,
      symbolUsages,
      callEdges,
      techDebtMarkers,
      moduleMetrics,
      typeReferences,
    };
  }
}

interface CollectedModuleData {
  modules: IModuleCreateDTO[];
  classes: IClassCreateDTO[];
  interfaces: IInterfaceCreateDTO[];
  functions: IFunctionCreateDTO[];
  typeAliases: ITypeAliasCreateDTO[];
  enums: IEnumCreateDTO[];
  variables: IVariableCreateDTO[];
  methods: IMethodCreateDTO[];
  properties: IPropertyCreateDTO[];
  parameters: IParameterCreateDTO[];
  moduleImports: Import[];
  moduleExports: Export[];
  importsWithModules: { import: Import; moduleId: string }[];
  rawClassExtends: ClassExtendsRef[];
  rawClassImplements: ClassImplementsRef[];
  rawInterfaceExtends: InterfaceExtendsRef[];
  symbolUsages: SymbolUsageRef[];
  callEdges: CallEdge[];
  techDebtMarkers: TechDebtMarker[];
  moduleMetrics: ModuleComplexityMetrics[];
  typeReferences: TypeReference[];
}

function aggregateModuleMetrics(metrics: ModuleComplexityMetrics[]): ModuleComplexityMetrics | undefined {
  if (metrics.length === 0) {
    return undefined;
  }

  const aggregate = metrics.reduce<ModuleComplexityMetrics>(
    (totals, metric) => ({
      exportCount: totals.exportCount + metric.exportCount,
      importCount: totals.importCount + metric.importCount,
      reExportCount: totals.reExportCount + metric.reExportCount,
      isBarrelFile: totals.isBarrelFile || metric.isBarrelFile,
      reExportRatio: totals.reExportRatio + metric.reExportRatio,
      importSourceCount: totals.importSourceCount + metric.importSourceCount,
      fanOut: totals.fanOut + metric.fanOut,
    }),
    {
      exportCount: 0,
      importCount: 0,
      reExportCount: 0,
      isBarrelFile: false,
      reExportRatio: 0,
      importSourceCount: 0,
      fanOut: 0,
    }
  );

  return {
    ...aggregate,
    reExportRatio: aggregate.reExportRatio / metrics.length,
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return uniqueByKey(items, (item) => item.id);
}

function uniqueByKey<T>(items: T[], getKey: (item: T) => string): T[] {
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
