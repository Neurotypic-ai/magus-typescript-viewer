import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { readPackage } from 'read-pkg';
import { createServer } from 'vite';

import { Database } from '../db/Database';
import { DuckDBAdapter } from '../db/adapter/DuckDBAdapter';
import { ClassRepository } from '../db/repositories/ClassRepository';
import { EnumRepository } from '../db/repositories/EnumRepository';
import { ExportRepository } from '../db/repositories/ExportRepository';
import { FunctionRepository } from '../db/repositories/FunctionRepository';
import { ImportRepository } from '../db/repositories/ImportRepository';
import { InterfaceRepository } from '../db/repositories/InterfaceRepository';
import { MethodRepository } from '../db/repositories/MethodRepository';
import { ModuleRepository } from '../db/repositories/ModuleRepository';
import { PackageRepository } from '../db/repositories/PackageRepository';
import { ParameterRepository } from '../db/repositories/ParameterRepository';
import { PropertyRepository } from '../db/repositories/PropertyRepository';
import { SymbolReferenceRepository } from '../db/repositories/SymbolReferenceRepository';
import { TypeAliasRepository } from '../db/repositories/TypeAliasRepository';
import { VariableRepository } from '../db/repositories/VariableRepository';
import { SnapshotRepository } from '../db/repositories/SnapshotRepository';
import { GitHistoryService } from '../git/GitHistoryService';
import { PackageParser } from '../parsers/PackageParser';
import { CodeIssueRepository } from '../db/repositories/CodeIssueRepository';
import { InsightEngine } from '../insights/InsightEngine';
import { toSarif } from '../insights/sarif-output';
import { diffInsights } from '../insights/insight-diff';
import { getLatestReport, storeInsightReport } from '../insights/insight-store';
import { RulesEngine } from '../rules/RulesEngine';
import {
  generateCallEdgeUUID,
  generateRelationshipUUID,
  generateSnapshotUUID,
  generateTechDebtMarkerUUID,
  generateTypeReferenceUUID,
} from '../utils/uuid';

import type { IDatabaseAdapter, QueryParams } from '../db/adapter/IDatabaseAdapter';
import type { CodeIssue } from '../rules/Rule';
import type { ParseResult } from '../parsers/ParseResult';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Insert a row, ignoring duplicate key errors */
async function safeInsert(
  adapter: IDatabaseAdapter,
  table: string,
  columns: string,
  values: QueryParams
): Promise<void> {
  const placeholders = values.map(() => '?').join(', ');
  try {
    await adapter.query(`INSERT INTO ${table} ${columns} VALUES (${placeholders})`, values);
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    // Ignore duplicate constraint violations
    if (msg.includes('Duplicate') || msg.includes('UNIQUE') || msg.includes('already exists')) {
      return;
    }
    throw error;
  }
}

async function batchInsertRows(
  adapter: IDatabaseAdapter,
  table: string,
  columns: string,
  rows: QueryParams[],
  chunkSize = 500
): Promise<void> {
  if (rows.length === 0) {
    return;
  }

  const columnCount = rows[0]?.length ?? 0;
  const singleRowPlaceholder = `(${Array.from({ length: columnCount }, () => '?').join(', ')})`;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => singleRowPlaceholder).join(', ');
    const params = chunk.flatMap((row) => row);

    try {
      await adapter.query(`INSERT INTO ${table} ${columns} VALUES ${placeholders}`, params);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (!msg.includes('Duplicate') && !msg.includes('UNIQUE') && !msg.includes('already exists')) {
        throw error;
      }

      for (const row of chunk) {
        await safeInsert(adapter, table, columns, row);
      }
    }
  }
}

/** Update a single column on a row by ID */
async function safeUpdate(
  adapter: IDatabaseAdapter,
  table: string,
  column: string,
  value: string,
  id: string
): Promise<void> {
  try {
    await adapter.query(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [value, id]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    console.warn(`Warning: failed to update ${table}.${column}:`, msg);
  }
}

interface PersistedImportSpecifier {
  imported: string;
  local?: string;
  kind: 'value' | 'type' | 'default' | 'namespace' | 'sideEffect';
}

function normalizeSpecifierKind(kind: string): PersistedImportSpecifier['kind'] {
  if (kind === 'default' || kind === 'type' || kind === 'value' || kind === 'namespace') {
    return kind;
  }
  if (kind === 'typeof') {
    return 'type';
  }
  return 'value';
}

function serializeImportSpecifiers(
  imp: {
    name?: string;
    relativePath?: string;
    fullPath?: string;
    specifiers?: unknown;
  }
): string | undefined {
  const serialized: PersistedImportSpecifier[] = [];
  const sourceLabel = imp.name ?? imp.relativePath ?? imp.fullPath ?? '(side-effect)';

  if (imp.specifiers instanceof Map) {
    imp.specifiers.forEach((specifier, key) => {
      if (!specifier || typeof specifier !== 'object') return;

      const entry = specifier as { name?: string; kind?: string; aliases?: Set<string> };
      const imported = typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : String(key);
      const aliasFromKey = typeof key === 'string' && key.length > 0 && key !== imported ? key : undefined;
      const aliasFromSet = entry.aliases instanceof Set ? Array.from(entry.aliases)[0] : undefined;
      const local = aliasFromSet ?? aliasFromKey;

      serialized.push({
        imported,
        kind: normalizeSpecifierKind(entry.kind ?? 'value'),
        ...(local ? { local } : {}),
      });
    });
  } else if (imp.specifiers && typeof imp.specifiers === 'object') {
    Object.entries(imp.specifiers as Record<string, unknown>).forEach(([key, value]) => {
      if (!value || typeof value !== 'object') return;

      const entry = value as { name?: string; kind?: string; aliases?: string[] };
      const imported = typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : key;
      const aliasFromKey = key !== imported ? key : undefined;
      const aliasFromArray = Array.isArray(entry.aliases) ? entry.aliases[0] : undefined;
      const local = aliasFromArray ?? aliasFromKey;

      serialized.push({
        imported,
        kind: normalizeSpecifierKind(entry.kind ?? 'value'),
        ...(local ? { local } : {}),
      });
    });
  }

  if (serialized.length === 0) {
    serialized.push({
      imported: sourceLabel,
      kind: 'sideEffect',
    });
  }

  return JSON.stringify(serialized);
}

function dedupeBy<T>(rows: T[], getKey: (row: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  rows.forEach((row) => {
    const key = getKey(row);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push(row);
  });

  return deduped;
}

function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  return dedupeBy(rows, (row) => row.id);
}

type ResolutionStatus = 'resolved' | 'ambiguous' | 'unresolved';
type OutputFormat = 'text' | 'json' | 'markdown' | 'sarif';

interface ResolutionSummary {
  resolved: number;
  ambiguous: number;
  unresolved: number;
}

const OUTPUT_FORMATS = new Set<OutputFormat>(['text', 'json', 'markdown', 'sarif']);

function parseOutputFormat(value: string): OutputFormat {
  if (OUTPUT_FORMATS.has(value as OutputFormat)) {
    return value as OutputFormat;
  }

  throw new Error(`Invalid format "${value}". Expected one of: text, json, markdown, sarif.`);
}

function parseFailUnder(value: string): number {
  const threshold = Number.parseInt(value, 10);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
    throw new Error('Fail-under threshold must be an integer between 0 and 100.');
  }

  return threshold;
}

function parseLimit(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) throw new Error('--limit must be a positive integer');
  return n;
}

function addNameToMap(nameMap: Map<string, string[]>, name: string, id: string): void {
  const existing = nameMap.get(name);
  if (existing) {
    if (!existing.includes(id)) {
      existing.push(id);
    }
    return;
  }
  nameMap.set(name, [id]);
}

function resolveFromNameMap(
  explicitId: string | undefined,
  name: string,
  nameMap: Map<string, string[]>
): { id: string | undefined; status: ResolutionStatus } {
  if (explicitId) {
    return { id: explicitId, status: 'resolved' };
  }

  const matches = nameMap.get(name) ?? [];
  if (matches.length === 1) {
    return { id: matches[0], status: 'resolved' };
  }
  if (matches.length > 1) {
    return { id: undefined, status: 'ambiguous' };
  }

  return { id: undefined, status: 'unresolved' };
}

async function persistParseResult(
  adapter: IDatabaseAdapter,
  parseResult: ParseResult,
  repositories: {
    package: PackageRepository;
    module: ModuleRepository;
    class: ClassRepository;
    export: ExportRepository;
    interface: InterfaceRepository;
    function: FunctionRepository;
    typeAlias: TypeAliasRepository;
    enum: EnumRepository;
    variable: VariableRepository;
    import: ImportRepository;
    method: MethodRepository;
    parameter: ParameterRepository;
    property: PropertyRepository;
    symbolReference: SymbolReferenceRepository;
  },
  codeIssues: CodeIssue[],
  snapshotPackageId?: string
): Promise<{ relationshipCount: number; relationStats: Record<'classExtends' | 'classImplements' | 'interfaceExtends', ResolutionSummary> }> {
  await adapter.transaction(async () => {
    // Save package first
    if (parseResult.package) {
      await repositories.package.create(parseResult.package);
    }

    // Batch-insert modules
    await repositories.module.createBatch(dedupeById(parseResult.modules));

    // Batch-insert classes
    await repositories.class.createBatch(dedupeById(parseResult.classes));

    // Batch-insert interfaces
    await repositories.interface.createBatch(dedupeById(parseResult.interfaces));

    // Batch-insert functions
    await repositories.function.createBatch(dedupeById(parseResult.functions));

    // Batch-insert type aliases
    await repositories.typeAlias.createBatch(dedupeById(parseResult.typeAliases));

    // Batch-insert enums
    await repositories.enum.createBatch(dedupeById(parseResult.enums));

    // Batch-insert variables
    await repositories.variable.createBatch(dedupeById(parseResult.variables));

    // Batch-insert methods
    await repositories.method.createBatch(dedupeById(parseResult.methods));

    // Batch-insert parameters
    await repositories.parameter.createBatch(dedupeById(parseResult.parameters));

    // Batch-insert properties
    await repositories.property.createBatch(dedupeById(parseResult.properties));

    // Batch-insert imports with module context (use relativePath for client-side resolution)
    if (parseResult.importsWithModules) {
      const dedupedImports = Array.from(
        new Map(parseResult.importsWithModules.map((entry) => [`${entry.moduleId}:${entry.import.uuid}`, entry])).values()
      );

      const importDTOs = dedupedImports.map(({ import: imp, moduleId }) => {
        // An import is type-only if all its specifiers have kind 'type'
        const specifierValues = Array.from(imp.specifiers.values());
        const isTypeOnly = specifierValues.length > 0 && specifierValues.every((s) => s.kind === 'type');
        return {
          id: imp.uuid,
          package_id: parseResult.package?.id ?? '',
          module_id: moduleId,
          source: imp.relativePath,
          specifiers_json: serializeImportSpecifiers(imp),
          is_type_only: isTypeOnly,
        };
      });
      await repositories.import.createBatch(importDTOs);
    }

    // Batch-insert exports
    const exportDTOs = dedupeBy(parseResult.exports, (row) => row.uuid).map((exp) => ({
      id: exp.uuid,
      package_id: parseResult.package?.id ?? '',
      module_id: exp.module,
      name: exp.name,
      is_default: exp.isDefault,
    }));
    await repositories.export.createBatch(exportDTOs);

    // Batch-insert symbol references
    await repositories.symbolReference.createBatch(dedupeById(parseResult.symbolReferences));

    // Persist code analysis issues
    const codeIssueRepository = new CodeIssueRepository(adapter);
    await codeIssueRepository.deleteByPackageId(parseResult.package?.id ?? '');
    const issueDTOs = codeIssues.map((issue) => ({
      id: issue.id,
      rule_code: issue.rule_code,
      severity: issue.severity,
      message: issue.message,
      suggestion: issue.suggestion,
      package_id: issue.package_id,
      module_id: issue.module_id,
      file_path: issue.file_path,
      entity_id: issue.entity_id,
      entity_type: issue.entity_type,
      entity_name: issue.entity_name,
      parent_entity_id: issue.parent_entity_id,
      parent_entity_type: issue.parent_entity_type,
      parent_entity_name: issue.parent_entity_name,
      property_name: issue.property_name,
      line: issue.line,
      column: issue.column,
      refactor_action: issue.refactor_action,
      refactor_context_json: issue.refactor_context ? JSON.stringify(issue.refactor_context) : undefined,
    }));
    await codeIssueRepository.createBatch(issueDTOs);

    const entityLocationById = new Map<string, { packageId: string; moduleId: string }>();
    parseResult.functions.forEach((fn) => {
      entityLocationById.set(fn.id, {
        packageId: fn.package_id,
        moduleId: fn.module_id,
      });
    });
    parseResult.methods.forEach((method) => {
      entityLocationById.set(method.id, {
        packageId: method.package_id,
        moduleId: method.module_id,
      });
    });
    parseResult.properties.forEach((property) => {
      entityLocationById.set(property.id, {
        packageId: property.package_id,
        moduleId: property.module_id,
      });
    });
    parseResult.parameters.forEach((parameter) => {
      entityLocationById.set(parameter.id, {
        packageId: parameter.package_id,
        moduleId: parameter.module_id,
      });
    });

    const callEdgeRows: QueryParams[] = dedupeBy(parseResult.callEdges ?? [], (edge) =>
      `${edge.callerId}:${edge.calleeName}:${edge.qualifier ?? ''}:${edge.callType}`
    ).flatMap((edge) => {
      const location = entityLocationById.get(edge.callerId);
      if (!location) {
        return [];
      }

      return [[
        generateCallEdgeUUID(edge.callerId, edge.calleeName, edge.qualifier, edge.callType, edge.line),
        location.packageId,
        location.moduleId,
        edge.callerId,
        edge.callerName,
        edge.calleeName,
        edge.qualifier ?? null,
        edge.callType,
        edge.line ?? null,
      ]];
    });
    await batchInsertRows(
      adapter,
      'call_edges',
      '(id, package_id, module_id, caller_id, caller_name, callee_name, qualifier, call_type, line)',
      callEdgeRows,
    );

    const typeReferenceRows: QueryParams[] = dedupeBy(parseResult.typeReferences ?? [], (reference) =>
      `${reference.sourceId}:${reference.sourceKind}:${reference.typeName}:${reference.context}`
    ).flatMap((reference) => {
      const location = entityLocationById.get(reference.sourceId);
      if (!location) {
        return [];
      }

      return [[
        generateTypeReferenceUUID(
          reference.sourceId,
          reference.sourceKind,
          reference.typeName,
          reference.context,
        ),
        location.packageId,
        location.moduleId,
        reference.sourceId,
        reference.sourceKind,
        reference.typeName,
        reference.context,
      ]];
    });
    await batchInsertRows(
      adapter,
      'type_references',
      '(id, package_id, module_id, source_id, source_kind, type_name, context)',
      typeReferenceRows,
    );

    const techDebtMarkerRows: QueryParams[] = dedupeBy(parseResult.techDebtMarkers ?? [], (marker) =>
      `${marker.moduleId ?? ''}:${marker.type}:${String(marker.line)}:${marker.snippet}`
    ).flatMap((marker) => {
      if (!marker.packageId || !marker.moduleId) {
        return [];
      }

      return [[
        generateTechDebtMarkerUUID(marker.moduleId, marker.type, marker.line, marker.snippet),
        marker.packageId,
        marker.moduleId,
        marker.type,
        marker.line,
        marker.snippet,
        marker.severity,
      ]];
    });
    await batchInsertRows(
      adapter,
      'tech_debt_markers',
      '(id, package_id, module_id, marker_type, line, snippet, severity)',
      techDebtMarkerRows,
    );
  });

  // Save relationship records to junction tables
  let relationshipCount = 0;
  const relationStats: Record<'classExtends' | 'classImplements' | 'interfaceExtends', ResolutionSummary> = {
    classExtends: { resolved: 0, ambiguous: 0, unresolved: 0 },
    classImplements: { resolved: 0, ambiguous: 0, unresolved: 0 },
    interfaceExtends: { resolved: 0, ambiguous: 0, unresolved: 0 },
  };

  // Cross-package resolution: only fetch classes/interfaces whose names
  // match unresolved references (Issue #18: avoid full-table scans)
  const unresolvedClassNames = Array.from(
    new Set(
      parseResult.classExtends
        .filter((ref) => !ref.parentId)
        .map((ref) => ref.parentName)
    )
  );
  const unresolvedInterfaceNames = Array.from(
    new Set([
      ...parseResult.classImplements
        .filter((ref) => !ref.interfaceId)
        .map((ref) => ref.interfaceName),
      ...parseResult.interfaceExtends
        .filter((ref) => !ref.parentId)
        .map((ref) => ref.parentName),
    ])
  );

  const globalClassMap = new Map<string, string[]>();
  if (unresolvedClassNames.length > 0) {
    const placeholders = unresolvedClassNames.map(() => '?').join(', ');
    const classRows = await adapter.query<{ id: string; name: string }>(
      snapshotPackageId
        ? `SELECT id, name FROM classes WHERE name IN (${placeholders}) AND package_id = ?`
        : `SELECT id, name FROM classes WHERE name IN (${placeholders})`,
      snapshotPackageId ? [...unresolvedClassNames, snapshotPackageId] : unresolvedClassNames
    );
    for (const row of classRows) {
      addNameToMap(globalClassMap, row.name, row.id);
    }
  }

  const globalInterfaceMap = new Map<string, string[]>();
  if (unresolvedInterfaceNames.length > 0) {
    const placeholders = unresolvedInterfaceNames.map(() => '?').join(', ');
    const interfaceRows = await adapter.query<{ id: string; name: string }>(
      snapshotPackageId
        ? `SELECT id, name FROM interfaces WHERE name IN (${placeholders}) AND package_id = ?`
        : `SELECT id, name FROM interfaces WHERE name IN (${placeholders})`,
      snapshotPackageId ? [...unresolvedInterfaceNames, snapshotPackageId] : unresolvedInterfaceNames
    );
    for (const row of interfaceRows) {
      addNameToMap(globalInterfaceMap, row.name, row.id);
    }
  }

  // Resolve relationships and batch-insert them
  const classExtendsInserts: string[][] = [];
  const classExtendsUpdates: { id: string; extendsId: string }[] = [];

  for (const ref of parseResult.classExtends) {
    const resolution = resolveFromNameMap(ref.parentId, ref.parentName, globalClassMap);
    if (!resolution.id) {
      relationStats.classExtends[resolution.status]++;
      continue;
    }

    if (resolution.id === ref.classId) {
      relationStats.classExtends.unresolved++;
      continue;
    }

    const relId = generateRelationshipUUID(ref.classId, resolution.id, 'class_extends');
    classExtendsInserts.push([relId, ref.classId, resolution.id]);
    classExtendsUpdates.push({ id: ref.classId, extendsId: resolution.id });
    relationshipCount++;
    relationStats.classExtends.resolved++;
  }

  const classImplementsInserts: string[][] = [];
  for (const ref of parseResult.classImplements) {
    const resolution = resolveFromNameMap(ref.interfaceId, ref.interfaceName, globalInterfaceMap);
    if (!resolution.id) {
      relationStats.classImplements[resolution.status]++;
      continue;
    }

    const relId = generateRelationshipUUID(ref.classId, resolution.id, 'class_implements');
    classImplementsInserts.push([relId, ref.classId, resolution.id]);
    relationshipCount++;
    relationStats.classImplements.resolved++;
  }

  const interfaceExtendsInserts: string[][] = [];
  for (const ref of parseResult.interfaceExtends) {
    const resolution = resolveFromNameMap(ref.parentId, ref.parentName, globalInterfaceMap);
    if (!resolution.id) {
      relationStats.interfaceExtends[resolution.status]++;
      continue;
    }

    if (resolution.id === ref.interfaceId) {
      relationStats.interfaceExtends.unresolved++;
      continue;
    }

    const relId = generateRelationshipUUID(ref.interfaceId, resolution.id, 'interface_extends');
    interfaceExtendsInserts.push([relId, ref.interfaceId, resolution.id]);
    relationshipCount++;
    relationStats.interfaceExtends.resolved++;
  }

  // Batch-insert all relationship records in a transaction
  await adapter.transaction(async () => {
    // Batch-insert class_extends
    const CHUNK_SIZE = 500;
    for (let i = 0; i < classExtendsInserts.length; i += CHUNK_SIZE) {
      const chunk = classExtendsInserts.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?)').join(', ');
      const params = chunk.flat();
      try {
        await adapter.query(`INSERT INTO class_extends (id, class_id, parent_id) VALUES ${placeholders}`, params);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        if (!msg.includes('Duplicate') && !msg.includes('UNIQUE') && !msg.includes('already exists')) {
          throw error;
        }
        // Fall back to individual inserts for duplicates
        for (const row of chunk) {
          await safeInsert(adapter, 'class_extends', '(id, class_id, parent_id)', row);
        }
      }
    }

    // Batch-update classes.extends_id
    for (const { id, extendsId } of classExtendsUpdates) {
      await safeUpdate(adapter, 'classes', 'extends_id', extendsId, id);
    }

    // Batch-insert class_implements
    for (let i = 0; i < classImplementsInserts.length; i += CHUNK_SIZE) {
      const chunk = classImplementsInserts.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?)').join(', ');
      const params = chunk.flat();
      try {
        await adapter.query(`INSERT INTO class_implements (id, class_id, interface_id) VALUES ${placeholders}`, params);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        if (!msg.includes('Duplicate') && !msg.includes('UNIQUE') && !msg.includes('already exists')) {
          throw error;
        }
        for (const row of chunk) {
          await safeInsert(adapter, 'class_implements', '(id, class_id, interface_id)', row);
        }
      }
    }

    // Batch-insert interface_extends
    for (let i = 0; i < interfaceExtendsInserts.length; i += CHUNK_SIZE) {
      const chunk = interfaceExtendsInserts.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '(?, ?, ?)').join(', ');
      const params = chunk.flat();
      try {
        await adapter.query(`INSERT INTO interface_extends (id, interface_id, extended_id) VALUES ${placeholders}`, params);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        if (!msg.includes('Duplicate') && !msg.includes('UNIQUE') && !msg.includes('already exists')) {
          throw error;
        }
        for (const row of chunk) {
          await safeInsert(adapter, 'interface_extends', '(id, interface_id, extended_id)', row);
        }
      }
    }
  });

  return { relationshipCount, relationStats };
}

const program = new Command();

program.name('typescript-viewer').description('TypeScript codebase visualization tool').version('1.0.0');

program
  .command('analyze')
  .description('Analyze a TypeScript project')
  .argument('<dir>', 'Directory containing the TypeScript project')
  .option('-o, --output <file>', 'Output database file', 'typescript-viewer.duckdb')
  .option('--no-reset', 'Do not reset the database before analyzing (append mode)')
  .option('--format <format>', 'Output format for insights: text, json, markdown, sarif', parseOutputFormat, 'text')
  .option('--fail-under <score>', 'Exit with code 1 if health score is below this threshold (0-100)', parseFailUnder)
  .option('--diff', 'Show delta against previous insight report')
  .action(async (dir: string, options: { output: string; reset?: boolean; readOnly?: boolean; format: OutputFormat; failUnder?: number; diff?: boolean }) => {
    const spinner = ora('Analyzing TypeScript project...').start();

    try {
      // Initialize database and repositories
      const adapter = new DuckDBAdapter(options.output, { allowWrite: true });
      const db = new Database(adapter, options.output);
      // Default to reset=true for idempotent behavior, unless --no-reset is specified
      const shouldReset = options.reset !== false;
      await db.initializeDatabase(shouldReset);

      const repositories = {
        package: new PackageRepository(adapter),
        module: new ModuleRepository(adapter),
        class: new ClassRepository(adapter),
        export: new ExportRepository(adapter),
        interface: new InterfaceRepository(adapter),
        function: new FunctionRepository(adapter),
        typeAlias: new TypeAliasRepository(adapter),
        enum: new EnumRepository(adapter),
        variable: new VariableRepository(adapter),
        import: new ImportRepository(adapter),
        method: new MethodRepository(adapter),
        parameter: new ParameterRepository(adapter),
        property: new PropertyRepository(adapter),
        symbolReference: new SymbolReferenceRepository(adapter),
      };

      // Parse package.json
      spinner.text = 'Parsing package.json...';
      const pkgJson = await readPackage({ cwd: dir });

      // Create package parser and parse the project
      spinner.text = 'Analyzing TypeScript files...';
      const packageParser = new PackageParser(dir, pkgJson.name, pkgJson.version);
      const parseResult = await packageParser.parse();

      // Run code analysis rules
      spinner.text = 'Running code analysis rules...';
      const rulesEngine = new RulesEngine();
      const codeIssues = await rulesEngine.analyze(parseResult);

      // Save all entities and relationships to database
      spinner.text = 'Saving to database...';
      const { relationshipCount, relationStats } = await persistParseResult(
        adapter,
        parseResult,
        repositories,
        codeIssues
      );

      spinner.succeed(chalk.green('Analysis complete!'));
      console.log();
      console.log(chalk.blue('Statistics:'));
      console.log(chalk.gray('- Files analyzed:'), parseResult.modules.length);
      console.log(chalk.gray('- Modules found:'), parseResult.modules.length);
      console.log(chalk.gray('- Classes found:'), parseResult.classes.length);
      console.log(chalk.gray('- Interfaces found:'), parseResult.interfaces.length);
      console.log(chalk.gray('- Functions found:'), parseResult.functions.length);
      console.log(chalk.gray('- Type aliases found:'), parseResult.typeAliases.length);
      console.log(chalk.gray('- Enums found:'), parseResult.enums.length);
      console.log(chalk.gray('- Variables found:'), parseResult.variables.length);
      console.log(chalk.gray('- Methods found:'), parseResult.methods.length);
      console.log(chalk.gray('- Properties found:'), parseResult.properties.length);
      console.log(chalk.gray('- Parameters found:'), parseResult.parameters.length);
      console.log(chalk.gray('- Imports found:'), parseResult.importsWithModules?.length ?? 0);
      console.log(chalk.gray('- Exports found:'), parseResult.exports.length);
      console.log(chalk.gray('- Code issues found:'), codeIssues.length);
      console.log(chalk.gray('- Relationships found:'), relationshipCount);
      console.log(
        chalk.gray('- class_extends resolution:'),
        'resolved=',
        relationStats.classExtends.resolved,
        'ambiguous=',
        relationStats.classExtends.ambiguous,
        'unresolved=',
        relationStats.classExtends.unresolved
      );
      console.log(
        chalk.gray('- class_implements resolution:'),
        'resolved=',
        relationStats.classImplements.resolved,
        'ambiguous=',
        relationStats.classImplements.ambiguous,
        'unresolved=',
        relationStats.classImplements.unresolved
      );
      console.log(
        chalk.gray('- interface_extends resolution:'),
        'resolved=',
        relationStats.interfaceExtends.resolved,
        'ambiguous=',
        relationStats.interfaceExtends.ambiguous,
        'unresolved=',
        relationStats.interfaceExtends.unresolved
      );

      // Compute codebase insights
      console.log();
      const insightSpinner = ora('Computing codebase insights...').start();
      try {
        const engine = new InsightEngine(adapter);

        // Load previous report before computing new one (for --diff)
        const previousReport = options.diff ? await getLatestReport(adapter) : null;

        const report = await engine.compute();

        // Store the current report for future diffs
        await storeInsightReport(adapter, report);

        insightSpinner.succeed(chalk.green('Insights computed!'));

        const format = options.format;

        if (format === 'json') {
          console.log(JSON.stringify(report, null, 2));
        } else if (format === 'sarif') {
          console.log(JSON.stringify(toSarif(report), null, 2));
        } else if (format === 'markdown') {
          const lines: string[] = [];
          lines.push('# Codebase Insights Report');
          lines.push('');
          lines.push(`**Health Score:** ${report.healthScore.toString()}/100`);
          lines.push(`**Computed:** ${report.computedAt}`);
          if (report.packageId) {
            lines.push(`**Package:** ${report.packageId}`);
          }
          lines.push('');
          lines.push(`| Severity | Count |`);
          lines.push(`|----------|-------|`);
          lines.push(`| Critical | ${report.summary.critical.toString()} |`);
          lines.push(`| Warning  | ${report.summary.warning.toString()} |`);
          lines.push(`| Info     | ${report.summary.info.toString()} |`);
          lines.push('');
          for (const insight of report.insights) {
            const badge = insight.severity === 'critical' ? '**CRITICAL**' : insight.severity === 'warning' ? '*Warning*' : 'Info';
            lines.push(`### ${insight.title} [${badge}]`);
            lines.push('');
            lines.push(insight.description);
            lines.push('');
          }
          console.log(lines.join('\n'));
        } else {
          // Default: text output (original behavior)
          console.log();

          const scoreColor = report.healthScore >= 80 ? chalk.green : report.healthScore >= 50 ? chalk.yellow : chalk.red;
          console.log(chalk.blue('Health Score:'), scoreColor(`${report.healthScore.toString()}/100`));

          // Show diff if --diff flag was passed and a previous report exists
          if (options.diff && previousReport) {
            const diff = diffInsights(previousReport, report);
            const deltaSign = diff.scoreDelta >= 0 ? '+' : '';
            const deltaColor = diff.scoreDelta >= 0 ? chalk.green : chalk.red;
            const deltaStr = deltaColor(`${deltaSign}${diff.scoreDelta.toString()}`);
            console.log(
              chalk.blue('Delta:'),
              `${previousReport.healthScore.toString()} -> ${report.healthScore.toString()} (${deltaStr})`,
              chalk.gray('|'),
              `${diff.newInsights.length.toString()} new warnings, ${diff.resolvedInsights.length.toString()} resolved`,
            );
          } else if (options.diff && !previousReport) {
            console.log(chalk.gray('  No previous report found for comparison'));
          }

          console.log();

          if (report.summary.critical > 0) {
            console.log(chalk.red(`  Critical: ${report.summary.critical.toString()}`));
          }
          if (report.summary.warning > 0) {
            console.log(chalk.yellow(`  Warning:  ${report.summary.warning.toString()}`));
          }
          if (report.summary.info > 0) {
            console.log(chalk.cyan(`  Info:     ${report.summary.info.toString()}`));
          }

          if (report.insights.length > 0) {
            console.log();
            console.log(chalk.blue('Top Insights:'));
            const criticals = report.insights.filter((i) => i.severity === 'critical');
            const warnings = report.insights.filter((i) => i.severity === 'warning');
            const topInsights = [...criticals, ...warnings].slice(0, 10);
            for (const insight of topInsights) {
              const icon = insight.severity === 'critical' ? chalk.red('!') : chalk.yellow('~');
              const entityCount = insight.entities.length.toString();
              console.log(`  ${icon} ${insight.title} (${entityCount} entities)`);
            }
            if (report.insights.length > topInsights.length) {
              const remaining = report.insights.length - topInsights.length;
              console.log(chalk.gray(`  ... and ${remaining.toString()} more info-level insights`));
            }
          }
        }

        // Check --fail-under threshold
        if (options.failUnder !== undefined && report.healthScore < options.failUnder) {
          console.error(
            chalk.red(`\nHealth score ${report.healthScore.toString()} is below threshold ${options.failUnder.toString()}`)
          );
          await db.close();
          process.exit(1);
        }
      } catch (insightError) {
        insightSpinner.warn(chalk.yellow('Insight computation skipped'));
        console.log(chalk.gray('  ' + (insightError instanceof Error ? insightError.message : 'Unknown error')));
      }

      await db.close();
    } catch (error) {
      spinner.fail(chalk.red('Analysis failed!'));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('analyze-history')
  .description('Analyze the git history of a TypeScript project and store per-commit snapshots')
  .argument('<dir>', 'Directory containing the TypeScript project (must be a git repository)')
  .option('-o, --output <file>', 'Output database file', 'typescript-viewer.duckdb')
  .option('--branch <ref>', 'Git branch/ref to walk', 'HEAD')
  .option('--limit <n>', 'Max number of commits to analyze', parseLimit)
  .option('--skip-existing', 'Skip commits already stored in the snapshots table')
  .option('--no-rules', 'Skip RulesEngine for faster analysis')
  .action(async (
    dir: string,
    options: {
      output: string;
      branch?: string;
      limit?: number;
      skipExisting?: boolean;
      rules?: boolean;
    }
  ) => {
    const absoluteDir = resolve(dir);
    const spinner = ora('Initializing history analysis...').start();

    try {
      const adapter = new DuckDBAdapter(options.output, { allowWrite: true });
      const db = new Database(adapter, options.output);
      await db.initializeDatabase(false);

      const repositories = {
        package: new PackageRepository(adapter),
        module: new ModuleRepository(adapter),
        class: new ClassRepository(adapter),
        export: new ExportRepository(adapter),
        interface: new InterfaceRepository(adapter),
        function: new FunctionRepository(adapter),
        typeAlias: new TypeAliasRepository(adapter),
        enum: new EnumRepository(adapter),
        variable: new VariableRepository(adapter),
        import: new ImportRepository(adapter),
        method: new MethodRepository(adapter),
        parameter: new ParameterRepository(adapter),
        property: new PropertyRepository(adapter),
        symbolReference: new SymbolReferenceRepository(adapter),
      };

      const snapshotRepo = new SnapshotRepository(adapter);
      const git = new GitHistoryService(absoluteDir);
      const rulesEngine = new RulesEngine();

      spinner.text = 'Listing commits...';
      const listCommitsOpts: { limit?: number; branch?: string } = {};
      if (options.limit !== undefined) listCommitsOpts.limit = options.limit;
      if (options.branch !== undefined) listCommitsOpts.branch = options.branch;
      let commits = await git.listCommits(listCommitsOpts);

      if (options.skipExisting) {
        const existingHashes = await snapshotRepo.listExistingHashes(absoluteDir);
        commits = commits.filter((c) => !existingHashes.has(c.hash));
      }

      const ordinalOffset = (await snapshotRepo.getMaxOrdinal(absoluteDir)) + 1;

      spinner.text = `Analyzing ${commits.length.toString()} commits...`;

      let stored = 0;
      for (let i = 0; i < commits.length; i++) {
        const commit = commits[i];
        if (!commit) continue;
        spinner.text = `[${(i + 1).toString()}/${commits.length.toString()}] ${commit.shortHash}: ${commit.subject}`;

        let worktree: Awaited<ReturnType<GitHistoryService['createWorktree']>> | undefined;
        try {
          worktree = await git.createWorktree(commit.hash);
          const pkgJson = await readPackage({ cwd: worktree.path });
          const parser = new PackageParser(worktree.path, pkgJson.name, pkgJson.version, commit.hash);
          const parseResult = await parser.parse();
          const codeIssues = options.rules !== false ? await rulesEngine.analyze(parseResult) : [];
          await persistParseResult(adapter, parseResult, repositories, codeIssues, parseResult.package?.id);

          const snapshotId = generateSnapshotUUID(absoluteDir, commit.hash);
          await snapshotRepo.create({
            id: snapshotId,
            repo_path: absoluteDir,
            commit_hash: commit.hash,
            commit_short: commit.shortHash,
            subject: commit.subject,
            author_name: commit.authorName,
            author_email: commit.authorEmail,
            commit_at: commit.committedAt,
            package_id: parseResult.package?.id ?? '',
            ordinal: ordinalOffset + i,
          });

          stored++;
          await worktree.dispose();
        } catch (err) {
          spinner.warn(chalk.yellow(`  Skipped ${commit.shortHash}: ${err instanceof Error ? err.message : String(err)}`));
          try { await worktree?.dispose(); } catch (_disposeErr) { /* ignore */ }
        }
      }

      spinner.succeed(chalk.green(`History analysis complete: ${stored.toString()} commits stored`));
      await db.close();
    } catch (error) {
      spinner.fail(chalk.red('History analysis failed!'));
      console.error(error);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start the visualization server')
  .argument('[file]', 'Database file to visualize', 'typescript-viewer.duckdb')
  .option('-p, --port <number>', 'Port to listen on', '4000')
  .action(async (_file: string, options: { port: string }) => {
    const spinner = ora('Starting visualization server...').start();

    try {
      const server = await createServer({
        configFile: join(__dirname, '../../vite.config.ts'),
        root: join(__dirname, '../..'),
        server: {
          port: parseInt(options.port, 10),
        },
      });

      await server.listen();

      spinner.succeed(chalk.green('Server started!'));
      console.log();
      console.log(chalk.blue('Visualization available at:'), chalk.cyan(`http://localhost:${options.port}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to start server!'));
      console.error(error);
      process.exit(1);
    }
  });

export function cli(args: string[] = process.argv): void {
  program.parse(args);
}
