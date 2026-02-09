import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import chalk from 'chalk';
import { Command } from 'commander';
import ora from 'ora';
import { readPackage } from 'read-pkg';

import { Database } from '../db/Database';
import { DuckDBAdapter } from '../db/adapter/DuckDBAdapter';
import { ClassRepository } from '../db/repositories/ClassRepository';
import { ExportRepository } from '../db/repositories/ExportRepository';
import { FunctionRepository } from '../db/repositories/FunctionRepository';
import { ImportRepository } from '../db/repositories/ImportRepository';
import { InterfaceRepository } from '../db/repositories/InterfaceRepository';
import { MethodRepository } from '../db/repositories/MethodRepository';
import { ModuleRepository } from '../db/repositories/ModuleRepository';
import { PackageRepository } from '../db/repositories/PackageRepository';
import { ParameterRepository } from '../db/repositories/ParameterRepository';
import { PropertyRepository } from '../db/repositories/PropertyRepository';
import { PackageParser } from '../parsers/PackageParser';
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
        import: new ImportRepository(adapter),
        method: new MethodRepository(adapter),
        parameter: new ParameterRepository(adapter),
        property: new PropertyRepository(adapter),
      };

      // Parse package.json
      spinner.text = 'Parsing package.json...';
      const pkgJson = await readPackage({ cwd: dir });

      // Create package parser and parse the project
      spinner.text = 'Analyzing TypeScript files...';
      const packageParser = new PackageParser(dir, pkgJson.name, pkgJson.version);
      const parseResult = await packageParser.parse();

      // Save all entities using repositories
      spinner.text = 'Saving to database...';

      // Save package first
      if (parseResult.package) {
        await repositories.package.create(parseResult.package);
      }

      // Save modules
      for (const module of parseResult.modules) {
        await repositories.module.create(module);
      }

      // Save classes
      for (const cls of parseResult.classes) {
        await repositories.class.create(cls);
      }

      // Save interfaces
      for (const iface of parseResult.interfaces) {
        await repositories.interface.create(iface);
      }

      // Save functions
      for (const func of parseResult.functions) {
        await repositories.function.create(func);
      }
      // Save methods
      for (const method of parseResult.methods) {
        await repositories.method.create(method);
      }

      // Save parameters
      for (const param of parseResult.parameters) {
        await repositories.parameter.create(param);
      }

      // Save properties
      for (const prop of parseResult.properties) {
        await repositories.property.create(prop);
      }

      // Save imports with module context (use relativePath for client-side resolution)
      if (parseResult.importsWithModules) {
        for (const { import: imp, moduleId } of parseResult.importsWithModules) {
          const importDTO = {
            id: imp.uuid,
            package_id: parseResult.package?.id ?? '',
            module_id: moduleId,
            source: imp.relativePath,
          };
          await repositories.import.create(importDTO);
        }
      }

      // Save exports
      for (const exp of parseResult.exports) {
        const exportDTO = {
          id: exp.uuid,
          package_id: parseResult.package?.id ?? '',
          module_id: exp.module,
          name: exp.name,
          is_default: exp.isDefault,
        };
        await repositories.export.create(exportDTO);
      }

      // Save relationship records to junction tables
      spinner.text = 'Saving relationships...';
      let relationshipCount = 0;

      // Cross-package resolution: query DB for all known classes/interfaces
      // to resolve any names that weren't found within this package
      const allClassRows = await adapter.query<{ id: string; name: string }>(
        'SELECT id, name FROM classes'
      );
      const allInterfaceRows = await adapter.query<{ id: string; name: string }>(
        'SELECT id, name FROM interfaces'
      );
      const globalClassMap = new Map<string, string>();
      for (const row of allClassRows) {
        globalClassMap.set(row.name, row.id);
      }
      const globalInterfaceMap = new Map<string, string>();
      for (const row of allInterfaceRows) {
        globalInterfaceMap.set(row.name, row.id);
      }

      // Save class_extends records
      for (const ref of parseResult.classExtends) {
        // ref.parentName is either a resolved UUID or a raw name needing DB lookup
        let parentId = ref.parentName;
        if (!parentId.includes('-')) {
          // Not a UUID — try global DB lookup
          parentId = globalClassMap.get(parentId) ?? '';
        }
        if (parentId && parentId !== ref.classId) {
          const relId = generateRelationshipUUID(ref.classId, parentId, 'class_extends');
          await safeInsert(adapter, 'class_extends', '(id, class_id, parent_id)', [relId, ref.classId, parentId]);
          // Also update the class's extends_id column
          await safeUpdate(adapter, 'classes', 'extends_id', parentId, ref.classId);
          relationshipCount++;
        }
      }

      // Save class_implements records
      for (const ref of parseResult.classImplements) {
        let interfaceId = ref.interfaceName;
        if (!interfaceId.includes('-')) {
          interfaceId = globalInterfaceMap.get(interfaceId) ?? '';
        }
        if (interfaceId) {
          const relId = generateRelationshipUUID(ref.classId, interfaceId, 'class_implements');
          await safeInsert(adapter, 'class_implements', '(id, class_id, interface_id)', [relId, ref.classId, interfaceId]);
          relationshipCount++;
        }
      }

      // Save interface_extends records
      for (const ref of parseResult.interfaceExtends) {
        let parentId = ref.parentName;
        if (!parentId.includes('-')) {
          parentId = globalInterfaceMap.get(parentId) ?? '';
        }
        if (parentId && parentId !== ref.interfaceId) {
          const relId = generateRelationshipUUID(ref.interfaceId, parentId, 'interface_extends');
          await safeInsert(adapter, 'interface_extends', '(id, interface_id, extended_id)', [relId, ref.interfaceId, parentId]);
          relationshipCount++;
        }
      }

      spinner.succeed(chalk.green('Analysis complete!'));
      console.log();
      console.log(chalk.blue('Statistics:'));
      console.log(chalk.gray('- Files analyzed:'), parseResult.modules.length);
      console.log(chalk.gray('- Modules found:'), parseResult.modules.length);
      console.log(chalk.gray('- Classes found:'), parseResult.classes.length);
      console.log(chalk.gray('- Interfaces found:'), parseResult.interfaces.length);
      console.log(chalk.gray('- Methods found:'), parseResult.methods.length);
      console.log(chalk.gray('- Properties found:'), parseResult.properties.length);
      console.log(chalk.gray('- Parameters found:'), parseResult.parameters.length);
      console.log(chalk.gray('- Imports found:'), parseResult.importsWithModules?.length ?? 0);
      console.log(chalk.gray('- Exports found:'), parseResult.exports.length);
      console.log(chalk.gray('- Relationships found:'), relationshipCount);

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
