import { cpus } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import chalk from 'chalk';
import { Command } from 'commander';
import { consola } from 'consola';
import ora from 'ora';
import { readPackage } from 'read-pkg';

import { AnalyzerPipeline, loadAnalysisConfig } from '../analysis';
import { CallGraphAnalyzer } from '../analysis/analyzers/CallGraphAnalyzer';
import { ComplexityAnalyzer } from '../analysis/analyzers/ComplexityAnalyzer';
import { CouplingAnalyzer } from '../analysis/analyzers/CouplingAnalyzer';
import { DependencyCruiserAnalyzer } from '../analysis/analyzers/DependencyCruiserAnalyzer';
import { DocumentationAnalyzer } from '../analysis/analyzers/DocumentationAnalyzer';
import { DuplicationAnalyzer } from '../analysis/analyzers/DuplicationAnalyzer';
import { EslintAnalyzer } from '../analysis/analyzers/EslintAnalyzer';
import { KnipAnalyzer } from '../analysis/analyzers/KnipAnalyzer';
import { MaintainabilityIndexAnalyzer } from '../analysis/analyzers/MaintainabilityIndexAnalyzer';
import { RulesEngineAdapter } from '../analysis/analyzers/RulesEngineAdapter';
import { SizeAnalyzer } from '../analysis/analyzers/SizeAnalyzer';
import { TypeSafetyAnalyzer } from '../analysis/analyzers/TypeSafetyAnalyzer';
import { Database } from '../db/Database';
import { DuckDBAdapter } from '../db/adapter/DuckDBAdapter';
import { AnalysisSnapshotRepository } from '../db/repositories/AnalysisSnapshotRepository';
import { ArchitecturalViolationRepository } from '../db/repositories/ArchitecturalViolationRepository';
import { CallEdgeRepository } from '../db/repositories/CallEdgeRepository';
import { ClassRepository } from '../db/repositories/ClassRepository';
import { CodeIssueRepository } from '../db/repositories/CodeIssueRepository';
import { DependencyCycleRepository } from '../db/repositories/DependencyCycleRepository';
import { DuplicationClusterRepository } from '../db/repositories/DuplicationClusterRepository';
import { EntityMetricRepository } from '../db/repositories/EntityMetricRepository';
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
import { InsightEngine } from '../insights/InsightEngine';
import { PackageParser } from '../parsers/PackageParser';
import { generateAnalysisSnapshotUUID, generateRelationshipUUID } from '../utils/uuid';

import type { EntityStatsPatch } from '../analysis';
import type { IDatabaseAdapter } from '../db/adapter/IDatabaseAdapter';

type EntityStatsPatchEntityType = EntityStatsPatch['entity_type'];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliLogger = consola.withTag('CLI');

/** Insert a row, ignoring duplicate key errors */
async function safeInsert(adapter: IDatabaseAdapter, table: string, columns: string, values: string[]): Promise<void> {
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
    cliLogger.warn(`Failed to update ${table}.${column}:`, msg);
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

function serializeImportSpecifiers(imp: {
  name?: string;
  relativePath?: string;
  fullPath?: string;
  specifiers?: unknown;
}): string | undefined {
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

interface ResolutionSummary {
  resolved: number;
  ambiguous: number;
  unresolved: number;
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

const program = new Command();

program.name('typescript-viewer').description('TypeScript codebase visualization tool').version('1.0.0');

interface AnalyzeCommandOptions {
  output: string;
  reset?: boolean;
  readOnly?: boolean;
  analyzers?: string;
  deep?: boolean;
  knip?: boolean;
  eslint?: boolean;
  duplication?: boolean;
  depCruiser?: boolean;
  size?: boolean;
  config?: string;
  maxWorkers?: string;
  baseline?: string;
}

interface MetricDeltaRow {
  metricKey: string;
  entityType: string;
  entityId: string;
  currentValue: number;
  baselineValue: number;
  delta: number;
}

async function reportBaselineDelta(
  adapter: IDatabaseAdapter,
  baseline: string,
  currentSnapshotId: string,
  currentMetrics: readonly {
    entity_id: string;
    entity_type: string;
    metric_key: string;
    metric_value: number;
  }[]
): Promise<void> {
  const snapshotRepository = new AnalysisSnapshotRepository(adapter);
  const entityMetricRepository = new EntityMetricRepository(adapter);

  let baselineId: string | undefined;
  let baselineCreatedAt: string | undefined;

  if (baseline === 'latest') {
    const snapshots = await snapshotRepository.retrieve();
    const sorted = snapshots.slice().sort((a, b) => {
      if (a.created_at === b.created_at) return 0;
      return a.created_at < b.created_at ? 1 : -1;
    });
    // The most-recent is the current run; pick the next one.
    const candidate = sorted.find((snap) => snap.id !== currentSnapshotId);
    if (candidate) {
      baselineId = candidate.id;
      baselineCreatedAt = candidate.created_at;
    }
  } else {
    const snapshot = await snapshotRepository.retrieveById(baseline);
    if (snapshot) {
      baselineId = snapshot.id;
      baselineCreatedAt = snapshot.created_at;
    }
  }

  if (!baselineId) {
    cliLogger.warn(chalk.yellow(`Baseline snapshot '${baseline}' not found; skipping delta report.`));
    return;
  }

  const baselineMetrics = await entityMetricRepository.retrieveBySnapshotId(baselineId);

  const baselineIndex = new Map<string, number>();
  for (const metric of baselineMetrics) {
    const key = `${metric.metric_key}::${metric.entity_type}::${metric.entity_id}`;
    baselineIndex.set(key, metric.metric_value);
  }

  const deltaRows: MetricDeltaRow[] = [];
  const seen = new Set<string>();

  for (const metric of currentMetrics) {
    const key = `${metric.metric_key}::${metric.entity_type}::${metric.entity_id}`;
    seen.add(key);
    const baselineValue = baselineIndex.get(key) ?? 0;
    const delta = metric.metric_value - baselineValue;
    if (delta === 0) continue;
    deltaRows.push({
      metricKey: metric.metric_key,
      entityType: metric.entity_type,
      entityId: metric.entity_id,
      currentValue: metric.metric_value,
      baselineValue: baselineValue,
      delta: delta,
    });
  }

  for (const metric of baselineMetrics) {
    const key = `${metric.metric_key}::${metric.entity_type}::${metric.entity_id}`;
    if (seen.has(key)) continue;
    if (metric.metric_value === 0) continue;
    deltaRows.push({
      metricKey: metric.metric_key,
      entityType: metric.entity_type,
      entityId: metric.entity_id,
      currentValue: 0,
      baselineValue: metric.metric_value,
      delta: -metric.metric_value,
    });
  }

  deltaRows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  cliLogger.log('');
  cliLogger.info(chalk.blue('Baseline comparison:'));
  cliLogger.info(chalk.gray('- Baseline snapshot:'), baselineId);
  if (baselineCreatedAt) {
    cliLogger.info(chalk.gray('- Baseline created_at:'), baselineCreatedAt);
  }
  cliLogger.info(chalk.gray('- Changed metric rows:'), deltaRows.length);

  if (deltaRows.length === 0) {
    cliLogger.info(chalk.gray('  No metric deltas vs baseline.'));
    return;
  }

  const top = deltaRows.slice(0, 10);
  cliLogger.info(chalk.blue('Top 10 metric deltas (by |delta|):'));
  for (const row of top) {
    const sign = row.delta > 0 ? '+' : '';
    const color = row.delta > 0 ? chalk.red : chalk.green;
    const formatted = `${row.metricKey} [${row.entityType} ${row.entityId}] ${row.baselineValue.toString()} -> ${row.currentValue.toString()} (${sign}${row.delta.toString()})`;
    cliLogger.info(`  ${color(formatted)}`);
  }
}

program
  .command('analyze')
  .description('Analyze a TypeScript project')
  .argument('<dir>', 'Directory containing the TypeScript project')
  .option('-o, --output <file>', 'Output database file', 'typescript-viewer.duckdb')
  .option('--no-reset', 'Do not reset the database before analyzing (append mode)')
  .option(
    '--analyzers <csv>',
    'Comma-separated list of analyzer IDs to run (allowlist). Overrides enabledAnalyzers from config.'
  )
  .option('--deep', 'Enable analyzers that require ts-morph (Phase 2)')
  .option('--no-knip', 'Disable the knip analyzer')
  .option('--no-eslint', 'Disable the eslint analyzer')
  .option('--no-duplication', 'Disable the duplication (jscpd) analyzer')
  .option('--no-dep-cruiser', 'Disable the dependency-cruiser analyzer')
  .option('--no-size', 'Disable the size analyzer')
  .option('--config <path>', 'Explicit analysis config file path')
  .option('--max-workers <n>', 'Maximum concurrent per-file workers', String(Math.max(1, cpus().length - 1)))
  .option(
    '--baseline <id|latest>',
    'Compare metrics against a prior snapshot (UUID or "latest" for second-most-recent)'
  )
  .action(async (dir: string, options: AnalyzeCommandOptions) => {
    const spinner = ora('Analyzing TypeScript project...').start();

    try {
      cliLogger.info('options.output', options.output);
      // Initialize database and repositories
      const adapter = new DuckDBAdapter(options.output, { allowWrite: true });
      const db = new Database(adapter, options.output);
      // Default to reset=true for idempotent behavior, unless --no-reset is specified
      const shouldReset = options.reset !== false;
      cliLogger.info(
        'reset mode:',
        shouldReset ? 'RESET (will delete existing data)' : 'APPEND (will keep existing data)'
      );
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

      // Save all entities using batch inserts within a transaction
      spinner.text = 'Saving to database...';

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
            new Map(
              parseResult.importsWithModules.map((entry) => [`${entry.moduleId}:${entry.import.uuid}`, entry])
            ).values()
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
      });

      // Save relationship records to junction tables
      spinner.text = 'Saving relationships...';
      let relationshipCount = 0;
      const relationStats: Record<'classExtends' | 'classImplements' | 'interfaceExtends', ResolutionSummary> = {
        classExtends: { resolved: 0, ambiguous: 0, unresolved: 0 },
        classImplements: { resolved: 0, ambiguous: 0, unresolved: 0 },
        interfaceExtends: { resolved: 0, ambiguous: 0, unresolved: 0 },
      };

      // Cross-package resolution: only fetch classes/interfaces whose names
      // match unresolved references (Issue #18: avoid full-table scans)
      const unresolvedClassNames = [
        ...new Set(parseResult.classExtends.filter((ref) => !ref.parentId).map((ref) => ref.parentName)),
      ];
      const unresolvedInterfaceNames = [
        ...new Set([
          ...parseResult.classImplements.filter((ref) => !ref.interfaceId).map((ref) => ref.interfaceName),
          ...parseResult.interfaceExtends.filter((ref) => !ref.parentId).map((ref) => ref.parentName),
        ]),
      ];

      const globalClassMap = new Map<string, string[]>();
      if (unresolvedClassNames.length > 0) {
        const placeholders = unresolvedClassNames.map(() => '?').join(', ');
        const classRows = await adapter.query<{ id: string; name: string }>(
          `SELECT id, name FROM classes WHERE name IN (${placeholders})`,
          unresolvedClassNames
        );
        for (const row of classRows) {
          addNameToMap(globalClassMap, row.name, row.id);
        }
      }

      const globalInterfaceMap = new Map<string, string[]>();
      if (unresolvedInterfaceNames.length > 0) {
        const placeholders = unresolvedInterfaceNames.map(() => '?').join(', ');
        const interfaceRows = await adapter.query<{ id: string; name: string }>(
          `SELECT id, name FROM interfaces WHERE name IN (${placeholders})`,
          unresolvedInterfaceNames
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
            await adapter.query(
              `INSERT INTO class_implements (id, class_id, interface_id) VALUES ${placeholders}`,
              params
            );
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
            await adapter.query(
              `INSERT INTO interface_extends (id, interface_id, extended_id) VALUES ${placeholders}`,
              params
            );
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

      // ---------------------------------------------------------------
      // Phase 1 analyzer pipeline: run size/knip/eslint/dep-cruiser/
      // duplication + legacy rules via the AnalyzerPipeline, then persist
      // snapshot + all result buckets in a single transaction.
      // ---------------------------------------------------------------
      spinner.text = 'Running analyzer pipeline...';

      const packageRoot = dir;
      const packageId = parseResult.package?.id ?? '';

      const config = await loadAnalysisConfig(packageRoot, options.config);

      // Apply CLI flag overrides on top of the loaded config.
      const disabled = new Set<string>(config.disabledAnalyzers ?? []);
      if (options.size === false) disabled.add('size');
      if (options.knip === false) disabled.add('knip');
      if (options.eslint === false) disabled.add('eslint');
      if (options.depCruiser === false) disabled.add('dep-cruiser');
      if (options.duplication === false) disabled.add('duplication');
      config.disabledAnalyzers = Array.from(disabled);

      if (options.analyzers !== undefined) {
        const allowlist = options.analyzers
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        if (allowlist.length > 0) {
          config.enabledAnalyzers = allowlist;
        }
      }

      if (options.deep === true) {
        config.deep = true;
      }

      if (options.maxWorkers !== undefined) {
        const parsedWorkers = Number.parseInt(options.maxWorkers, 10);
        if (Number.isFinite(parsedWorkers) && parsedWorkers > 0) {
          config.maxWorkers = parsedWorkers;
        }
      }

      const snapshotId = generateAnalysisSnapshotUUID(packageId, new Date().toISOString());

      const sizeAnalyzer = new SizeAnalyzer();
      const knipAnalyzer = new KnipAnalyzer();
      const eslintAnalyzer = new EslintAnalyzer();
      const depCruiserAnalyzer = new DependencyCruiserAnalyzer();
      const duplicationAnalyzer = new DuplicationAnalyzer();
      const rulesEngineAdapter = new RulesEngineAdapter();
      const complexityAnalyzer = new ComplexityAnalyzer();
      const typeSafetyAnalyzer = new TypeSafetyAnalyzer();
      const callGraphAnalyzer = new CallGraphAnalyzer();
      const documentationAnalyzer = new DocumentationAnalyzer();
      const couplingAnalyzer = new CouplingAnalyzer();
      const maintainabilityAnalyzer = new MaintainabilityIndexAnalyzer();
      const pipeline = new AnalyzerPipeline([
        sizeAnalyzer,
        knipAnalyzer,
        eslintAnalyzer,
        depCruiserAnalyzer,
        duplicationAnalyzer,
        rulesEngineAdapter,
        complexityAnalyzer,
        typeSafetyAnalyzer,
        callGraphAnalyzer,
        documentationAnalyzer,
        couplingAnalyzer,
        maintainabilityAnalyzer,
      ]);

      const pipelineStart = Date.now();
      const analyzerResult = await pipeline.run({
        parseResult,
        packageRoot,
        packageId,
        snapshotId,
        repositories: {},
        config,
        logger: consola.withTag('CLI.Analyze'),
      });
      const pipelineDurationMs = Date.now() - pipelineStart;

      // Persist snapshot row + analyzer results in a single transaction.
      spinner.text = 'Persisting analyzer results...';
      const snapshotRepository = new AnalysisSnapshotRepository(adapter);
      const entityMetricRepository = new EntityMetricRepository(adapter);
      const codeIssueRepository = new CodeIssueRepository(adapter);
      const callEdgeRepository = new CallEdgeRepository(adapter);
      const depCycleRepository = new DependencyCycleRepository(adapter);
      const dupClusterRepository = new DuplicationClusterRepository(adapter);
      const archViolationRepository = new ArchitecturalViolationRepository(adapter);

      await adapter.transaction(async () => {
        // Remove prior snapshot-scoped rows for this package so re-runs stay idempotent.
        await snapshotRepository.deleteByPackageId(packageId);
        await codeIssueRepository.deleteByPackageId(packageId);
        await callEdgeRepository.deleteByPackageId(packageId);
        await depCycleRepository.deleteByPackageId(packageId);
        await dupClusterRepository.deleteByPackageId(packageId);

        await snapshotRepository.create({
          id: snapshotId,
          package_id: packageId,
          created_at: new Date().toISOString(),
          duration_ms: pipelineDurationMs,
        });

        const metrics = analyzerResult.metrics ?? [];
        if (metrics.length > 0) {
          await entityMetricRepository.createBatch(metrics);
        }

        const findings = analyzerResult.findings ?? [];
        if (findings.length > 0) {
          await codeIssueRepository.createBatch(findings);
        }

        const callEdges = analyzerResult.callEdges ?? [];
        if (callEdges.length > 0) {
          await callEdgeRepository.createBatch(callEdges);
        }

        const cycles = analyzerResult.cycles ?? [];
        if (cycles.length > 0) {
          await depCycleRepository.createBatch(cycles);
        }

        const duplications = analyzerResult.duplications ?? [];
        if (duplications.length > 0) {
          await dupClusterRepository.createBatch(duplications);
        }

        const archViolations = analyzerResult.architecturalViolations ?? [];
        if (archViolations.length > 0) {
          await archViolationRepository.createBatch(archViolations);
        }

        // Apply per-module column patches emitted by analyzers (e.g. SizeAnalyzer).
        for (const patch of analyzerResult.moduleStats ?? []) {
          const entries = Object.entries(patch.columns);
          if (entries.length === 0) continue;
          const setClause = entries.map(([column]) => `${column} = ?`).join(', ');
          const values = entries.map(([, value]) => value);
          await adapter.query(`UPDATE modules SET ${setClause} WHERE id = ?`, [...values, patch.module_id]);
        }

        // Apply per-entity column patches, routed by entity_type to the correct table.
        const entityTypeToTable: Record<EntityStatsPatchEntityType, string> = {
          method: 'methods',
          function: 'functions',
          class: 'classes',
          interface: 'interfaces',
          parameter: 'parameters',
        };
        for (const patch of analyzerResult.entityStats ?? []) {
          const table = entityTypeToTable[patch.entity_type];
          if (!table) continue;
          const entries = Object.entries(patch.columns);
          if (entries.length === 0) continue;
          const setClause = entries.map(([column]) => `${column} = ?`).join(', ');
          const values = entries.map(([, value]) => value);
          await adapter.query(`UPDATE ${table} SET ${setClause} WHERE id = ?`, [...values, patch.entity_id]);
        }
      });

      spinner.succeed(chalk.green('Analysis complete!'));
      cliLogger.log('');
      cliLogger.info(chalk.blue('Statistics:'));
      cliLogger.info(chalk.gray('- Files analyzed:'), parseResult.modules.length);
      cliLogger.info(chalk.gray('- Modules found:'), parseResult.modules.length);
      cliLogger.info(chalk.gray('- Classes found:'), parseResult.classes.length);
      cliLogger.info(chalk.gray('- Interfaces found:'), parseResult.interfaces.length);
      cliLogger.info(chalk.gray('- Functions found:'), parseResult.functions.length);
      cliLogger.info(chalk.gray('- Type aliases found:'), parseResult.typeAliases.length);
      cliLogger.info(chalk.gray('- Enums found:'), parseResult.enums.length);
      cliLogger.info(chalk.gray('- Variables found:'), parseResult.variables.length);
      cliLogger.info(chalk.gray('- Methods found:'), parseResult.methods.length);
      cliLogger.info(chalk.gray('- Properties found:'), parseResult.properties.length);
      cliLogger.info(chalk.gray('- Parameters found:'), parseResult.parameters.length);
      cliLogger.info(chalk.gray('- Imports found:'), parseResult.importsWithModules?.length ?? 0);
      cliLogger.info(chalk.gray('- Exports found:'), parseResult.exports.length);
      cliLogger.info(chalk.gray('- Relationships found:'), relationshipCount);
      cliLogger.info(
        chalk.gray('- class_extends resolution:'),
        'resolved=',
        relationStats.classExtends.resolved,
        'ambiguous=',
        relationStats.classExtends.ambiguous,
        'unresolved=',
        relationStats.classExtends.unresolved
      );
      cliLogger.info(
        chalk.gray('- class_implements resolution:'),
        'resolved=',
        relationStats.classImplements.resolved,
        'ambiguous=',
        relationStats.classImplements.ambiguous,
        'unresolved=',
        relationStats.classImplements.unresolved
      );
      cliLogger.info(
        chalk.gray('- interface_extends resolution:'),
        'resolved=',
        relationStats.interfaceExtends.resolved,
        'ambiguous=',
        relationStats.interfaceExtends.ambiguous,
        'unresolved=',
        relationStats.interfaceExtends.unresolved
      );

      // Analyzer pipeline summary
      cliLogger.log('');
      cliLogger.info(chalk.blue('Analyzer pipeline:'));
      cliLogger.info(chalk.gray('- Snapshot id:'), snapshotId);
      cliLogger.info(chalk.gray('- Duration (ms):'), pipelineDurationMs);
      cliLogger.info(chalk.gray('- Metrics:'), analyzerResult.metrics?.length ?? 0);
      cliLogger.info(chalk.gray('- Findings:'), analyzerResult.findings?.length ?? 0);
      cliLogger.info(chalk.gray('- Call edges:'), analyzerResult.callEdges?.length ?? 0);
      cliLogger.info(chalk.gray('- Cycles:'), analyzerResult.cycles?.length ?? 0);
      cliLogger.info(chalk.gray('- Duplications:'), analyzerResult.duplications?.length ?? 0);
      cliLogger.info(
        chalk.gray('- Architectural violations:'),
        analyzerResult.architecturalViolations?.length ?? 0
      );
      cliLogger.info(chalk.gray('- Module patches:'), analyzerResult.moduleStats?.length ?? 0);
      cliLogger.info(chalk.gray('- Entity patches:'), analyzerResult.entityStats?.length ?? 0);

      // Per-analyzer timing table
      if (pipeline.lastRunTimings.size > 0) {
        const rows = Array.from(pipeline.lastRunTimings.entries()).map(([id, ms]) => ({
          id,
          ms,
          status: pipeline.lastRunStatus.get(id) ?? 'ok',
        }));
        const idWidth = Math.max(8, ...rows.map((row) => row.id.length));
        const statusWidth = 8;
        const durationHeader = 'Duration';
        const durationWidth = Math.max(
          durationHeader.length,
          ...rows.map((row) => `${row.ms.toString()}ms`.length)
        );

        cliLogger.log('');
        cliLogger.info(chalk.blue('Analyzer timings:'));
        const header = `${'Analyzer'.padEnd(idWidth)}  ${'Status'.padEnd(statusWidth)}  ${durationHeader.padStart(durationWidth)}`;
        const rule = '─'.repeat(idWidth + statusWidth + durationWidth + 4);
        cliLogger.log(chalk.gray(header));
        cliLogger.log(chalk.gray(rule));
        for (const row of rows) {
          const statusLabel = row.status.padEnd(statusWidth);
          const statusColored =
            row.status === 'ok'
              ? chalk.green(statusLabel)
              : row.status === 'skipped'
                ? chalk.yellow(statusLabel)
                : chalk.red(statusLabel);
          const durationCell = `${row.ms.toString()}ms`.padStart(durationWidth);
          cliLogger.log(`${row.id.padEnd(idWidth)}  ${statusColored}  ${chalk.cyan(durationCell)}`);
        }
      }

      // Baseline comparison (only when --baseline is provided)
      if (options.baseline !== undefined && options.baseline.length > 0) {
        try {
          await reportBaselineDelta(adapter, options.baseline, snapshotId, analyzerResult.metrics ?? []);
        } catch (baselineError) {
          cliLogger.warn(
            chalk.yellow('Baseline comparison failed:'),
            baselineError instanceof Error ? baselineError.message : 'Unknown error'
          );
        }
      }

      // Compute codebase insights
      cliLogger.log('');
      const insightSpinner = ora('Computing codebase insights...').start();
      try {
        const engine = new InsightEngine(adapter);
        const report = await engine.compute();

        insightSpinner.succeed(chalk.green('Insights computed!'));
        cliLogger.log('');

        const scoreColor = report.healthScore >= 80 ? chalk.green : report.healthScore >= 50 ? chalk.yellow : chalk.red;
        cliLogger.info(chalk.blue('Health Score:'), scoreColor(`${report.healthScore.toString()}/100`));
        cliLogger.log('');

        if (report.summary.critical > 0) {
          cliLogger.error(chalk.red(`  Critical: ${report.summary.critical.toString()}`));
        }
        if (report.summary.warning > 0) {
          cliLogger.warn(chalk.yellow(`  Warning:  ${report.summary.warning.toString()}`));
        }
        if (report.summary.info > 0) {
          cliLogger.info(chalk.cyan(`  Info:     ${report.summary.info.toString()}`));
        }

        if (report.insights.length > 0) {
          cliLogger.log('');
          cliLogger.info(chalk.blue('Top Insights:'));
          const criticals = report.insights.filter((i) => i.severity === 'critical');
          const warnings = report.insights.filter((i) => i.severity === 'warning');
          const topInsights = [...criticals, ...warnings].slice(0, 10);
          for (const insight of topInsights) {
            const icon = insight.severity === 'critical' ? chalk.red('!') : chalk.yellow('~');
            const entityCount = insight.entities.length.toString();
            cliLogger.info(`  ${icon} ${insight.title} (${entityCount} entities)`);
          }
          if (report.insights.length > topInsights.length) {
            const remaining = report.insights.length - topInsights.length;
            cliLogger.info(chalk.gray(`  ... and ${remaining.toString()} more info-level insights`));
          }
        }
      } catch (insightError) {
        insightSpinner.warn(chalk.yellow('Insight computation skipped'));
        cliLogger.warn(chalk.gray('  ' + (insightError instanceof Error ? insightError.message : 'Unknown error')));
      }

      await db.close();
    } catch (error) {
      spinner.fail(chalk.red('Analysis failed!'));
      cliLogger.error(error);
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
      // Import dynamically to avoid loading React in CLI mode
      const { createServer } = await import('vite');

      const server = await createServer({
        configFile: join(__dirname, '../../vite.config.ts'),
        root: join(__dirname, '../..'),
        server: {
          port: parseInt(options.port, 10),
        },
      });

      await server.listen();

      spinner.succeed(chalk.green('Server started!'));
      cliLogger.log('');
      cliLogger.success(chalk.blue('Visualization available at:'), chalk.cyan(`http://localhost:${options.port}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to start server!'));
      cliLogger.error(error);
      process.exit(1);
    }
  });

export function cli(args: string[] = process.argv): void {
  program.parse(args);
}
