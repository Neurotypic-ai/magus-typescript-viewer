import { generatePackageUUID } from '../utils/uuid';
import { DependencyParser } from './DependencyParser';
import { FileDiscovery, DEFAULT_FILE_DISCOVERY_CONFIG } from './FileDiscovery';
import { ModuleParser } from './ModuleParser';
import { RelationshipResolver } from './RelationshipResolver';
import { VueScriptExtractor } from './VueScriptExtractor';

import type { Export } from '../../shared/types/Export';
import type { Import } from '../../shared/types/Import';
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

export class PackageParser {
  private readonly fileDiscovery: FileDiscovery;
  private readonly vueExtractor: VueScriptExtractor;
  private readonly dependencyParser: DependencyParser;
  private readonly relationshipResolver: RelationshipResolver;
  private readonly config: FileDiscoveryConfig;

  constructor(
    private readonly packagePath: string,
    private readonly packageName: string,
    private readonly packageVersion: string,
    config?: Partial<FileDiscoveryConfig>
  ) {
    this.config = { ...DEFAULT_FILE_DISCOVERY_CONFIG, ...config };
    this.fileDiscovery = new FileDiscovery(packagePath, this.config);
    this.vueExtractor = new VueScriptExtractor();
    this.dependencyParser = new DependencyParser(packagePath);
    this.relationshipResolver = new RelationshipResolver();
  }

  async parse(): Promise<ParseResult> {
    const packageId = generatePackageUUID(this.packageName, this.packageVersion);

    // 1. Parse dependencies from package.json
    const depResult = await this.dependencyParser.parseDependencies();

    // 2. Create package DTO
    const packageDTO: IPackageCreateDTO = {
      id: packageId,
      name: this.packageName,
      version: this.packageVersion,
      path: this.packagePath,
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
    return {
      package: packageDTO,
      modules: uniqueById(collected.modules),
      classes: uniqueById(collected.classes),
      interfaces: uniqueById(collected.interfaces),
      functions: uniqueById(collected.functions),
      typeAliases: uniqueById(collected.typeAliases),
      enums: uniqueById(collected.enums),
      variables: uniqueById(collected.variables),
      methods: uniqueById(collected.methods),
      properties: uniqueById(collected.properties),
      parameters: uniqueById(collected.parameters),
      imports: [...Array.from(depResult.imports.values()), ...uniqueByKey(collected.moduleImports, (i) => i.uuid)],
      exports: uniqueByKey(collected.moduleExports, (e) => e.uuid),
      importsWithModules: Array.from(
        new Map(collected.importsWithModules.map((entry) => [`${entry.moduleId}:${entry.import.uuid}`, entry])).values()
      ),
      classExtends: resolved.classExtends,
      classImplements: resolved.classImplements,
      interfaceExtends: resolved.interfaceExtends,
      symbolUsages: collected.symbolUsages,
      symbolReferences: uniqueById(symbolReferences),
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
      moduleResult.properties.forEach((property) => properties.push(property));
      moduleResult.parameters.forEach((parameter) => parameters.push(parameter));
      moduleResult.imports.forEach((imp) => {
        moduleImports.push(imp);
        importsWithModules.push({ import: imp, moduleId });
      });
      moduleResult.exports.forEach((exp) => moduleExports.push(exp));

      rawClassExtends.push(...moduleResult.classExtends);
      rawClassImplements.push(...moduleResult.classImplements);
      rawInterfaceExtends.push(...moduleResult.interfaceExtends);
      symbolUsages.push(...moduleResult.symbolUsages);
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
