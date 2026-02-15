import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { readPackage } from 'read-pkg';

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
import { PackageParser } from '../parsers/PackageParser';
import { CodeIssueRepository } from '../db/repositories/CodeIssueRepository';
import { RulesEngine } from '../rules/RulesEngine';
import { generateRelationshipUUID } from '../utils/uuid';

import type { IDatabaseAdapter } from '../db/adapter/IDatabaseAdapter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Insert a row, ignoring duplicate key errors */
async function safeInsert(
  adapter: IDatabaseAdapter,
  table: string,
  columns: string,
  values: string[]
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

program
  .command('analyze')
  .description('Analyze a TypeScript project')
  .argument('<dir>', 'Directory containing the TypeScript project')
  .option('-o, --output <file>', 'Output database file', 'typescript-viewer.duckdb')
  .option('--no-reset', 'Do not reset the database before analyzing (append mode)')
  .action(async (dir: string, options: { output: string; reset?: boolean; readOnly?: boolean }) => {
    const spinner = ora('Analyzing TypeScript project...').start();

    try {
      console.log('options.output', options.output);
      // Initialize database and repositories
      const adapter = new DuckDBAdapter(options.output, { allowWrite: true });
      const db = new Database(adapter, options.output);
      // Default to reset=true for idempotent behavior, unless --no-reset is specified
      const shouldReset = options.reset !== false;
      console.log(
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

      // Run code analysis rules
      spinner.text = 'Running code analysis rules...';
      const rulesEngine = new RulesEngine();
      const codeIssues = await rulesEngine.analyze(parseResult);

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
        ...new Set(
          parseResult.classExtends
            .filter((ref) => !ref.parentId)
            .map((ref) => ref.parentName)
        ),
      ];
      const unresolvedInterfaceNames = [
        ...new Set([
          ...parseResult.classImplements
            .filter((ref) => !ref.interfaceId)
            .map((ref) => ref.interfaceName),
          ...parseResult.interfaceExtends
            .filter((ref) => !ref.parentId)
            .map((ref) => ref.parentName),
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

      await db.close();
    } catch (error) {
      spinner.fail(chalk.red('Analysis failed!'));
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
