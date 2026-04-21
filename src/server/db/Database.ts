import * as fs from 'fs/promises';
import { join } from 'path';

import { consola } from 'consola';

import { loadSchema } from './schema/schema-loader';

import type { IDatabaseAdapter } from './adapter/IDatabaseAdapter';

const databaseLogger = consola.withTag('Database');

export class Database {
  private adapter: IDatabaseAdapter;
  private dbPath: string;

  constructor(adapter: IDatabaseAdapter, dbPath = ':memory:') {
    this.adapter = adapter;
    this.dbPath = dbPath;
  }

  /**
   * Gets the database adapter instance
   */
  public getAdapter(): IDatabaseAdapter {
    return this.adapter;
  }

  /**
   * Returns a set of column names for a given table using DuckDB PRAGMA.
   */
  private async getTableColumns(table: string): Promise<Set<string>> {
    const rows = await this.adapter.query<{ id: string; name: string }>(`PRAGMA table_info('${table}')`);
    const names = rows.map((r) => r.name).filter((n) => n.length > 0);
    return new Set(names);
  }

  /**
   * Ensures that the given columns exist on the table; if missing, add them.
   * Definition should include the full column definition (e.g., "parent_type TEXT DEFAULT 'class'").
   */
  private async ensureColumns(table: string, columns: { name: string; definition: string }[]): Promise<void> {
    const existing = await this.getTableColumns(table);
    for (const col of columns) {
      if (!existing.has(col.name)) {
        await this.adapter.query(`ALTER TABLE ${table} ADD COLUMN ${col.definition}`);
      }
    }
  }

  /**
   * Performs lightweight, idempotent migrations to add columns introduced in newer schemas
   * to existing databases without requiring a full reset.
   */
  private async migrateSchemaIfNeeded(): Promise<void> {
    // Packages table: JSON-encoded map of package.json dep names → scope.
    // Added so module → externalPackage edges can be classified as
    // dependency / devDependency / peerDependency, which the junction
    // table can't hold (FK to packages fails for external npm packages).
    await this.ensureColumns('packages', [
      { name: 'package_json_deps_json', definition: 'package_json_deps_json TEXT' },
    ]);

    // Methods table: ensure columns used by queries exist
    await this.ensureColumns('methods', [
      { name: 'parent_type', definition: "parent_type TEXT DEFAULT 'class'" },
      { name: 'is_abstract', definition: 'is_abstract BOOLEAN DEFAULT FALSE' },
      { name: 'created_at', definition: 'created_at TIMESTAMP DEFAULT current_timestamp' },
      { name: 'start_line', definition: 'start_line INTEGER' },
      { name: 'end_line', definition: 'end_line INTEGER' },
      { name: 'logical_lines', definition: 'logical_lines INTEGER' },
      { name: 'cyclomatic', definition: 'cyclomatic INTEGER' },
      { name: 'cognitive', definition: 'cognitive INTEGER' },
      { name: 'max_nesting', definition: 'max_nesting INTEGER' },
      { name: 'parameter_count', definition: 'parameter_count INTEGER' },
      { name: 'has_jsdoc', definition: 'has_jsdoc BOOLEAN' },
      { name: 'return_type_is_any', definition: 'return_type_is_any BOOLEAN' },
    ]);

    // Properties table
    await this.ensureColumns('properties', [
      { name: 'parent_type', definition: "parent_type TEXT DEFAULT 'class'" },
      { name: 'created_at', definition: 'created_at TIMESTAMP DEFAULT current_timestamp' },
    ]);

    // Interfaces table
    await this.ensureColumns('interfaces', [
      { name: 'created_at', definition: 'created_at TIMESTAMP DEFAULT current_timestamp' },
      { name: 'start_line', definition: 'start_line INTEGER' },
      { name: 'end_line', definition: 'end_line INTEGER' },
      { name: 'has_jsdoc', definition: 'has_jsdoc BOOLEAN' },
    ]);

    // Classes table
    await this.ensureColumns('classes', [
      { name: 'created_at', definition: 'created_at TIMESTAMP DEFAULT current_timestamp' },
      { name: 'start_line', definition: 'start_line INTEGER' },
      { name: 'end_line', definition: 'end_line INTEGER' },
      { name: 'has_jsdoc', definition: 'has_jsdoc BOOLEAN' },
    ]);

    // Parameters table
    await this.ensureColumns('parameters', [
      { name: 'created_at', definition: 'created_at TIMESTAMP DEFAULT current_timestamp' },
      { name: 'type_is_any', definition: 'type_is_any BOOLEAN' },
      { name: 'is_implicit_any', definition: 'is_implicit_any BOOLEAN' },
    ]);

    // Functions table: mirror methods additions
    await this.ensureColumns('functions', [
      { name: 'start_line', definition: 'start_line INTEGER' },
      { name: 'end_line', definition: 'end_line INTEGER' },
      { name: 'logical_lines', definition: 'logical_lines INTEGER' },
      { name: 'cyclomatic', definition: 'cyclomatic INTEGER' },
      { name: 'cognitive', definition: 'cognitive INTEGER' },
      { name: 'max_nesting', definition: 'max_nesting INTEGER' },
      { name: 'parameter_count', definition: 'parameter_count INTEGER' },
      { name: 'has_jsdoc', definition: 'has_jsdoc BOOLEAN' },
      { name: 'return_type_is_any', definition: 'return_type_is_any BOOLEAN' },
    ]);

    // Modules table: size/complexity aggregates
    await this.ensureColumns('modules', [
      { name: 'physical_lines', definition: 'physical_lines INTEGER' },
      { name: 'logical_lines', definition: 'logical_lines INTEGER' },
      { name: 'comment_lines', definition: 'comment_lines INTEGER' },
      { name: 'halstead_volume', definition: 'halstead_volume DOUBLE' },
    ]);

    // Imports table
    await this.ensureColumns('imports', [{ name: 'specifiers_json', definition: 'specifiers_json TEXT' }]);

    // Ensure code_issues table exists (optional — not in requiredTables)
    try {
      await this.adapter.query('SELECT 1 FROM code_issues LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE code_issues (
        id CHAR(36) PRIMARY KEY,
        rule_code TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
        message TEXT NOT NULL,
        suggestion TEXT,
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        module_id CHAR(36) NOT NULL REFERENCES modules (id),
        file_path TEXT NOT NULL,
        entity_id CHAR(36),
        entity_type TEXT CHECK (entity_type IN ('class', 'interface', 'property', 'method', 'function', 'typeAlias', 'variable')),
        entity_name TEXT,
        parent_entity_id CHAR(36),
        parent_entity_type TEXT CHECK (parent_entity_type IN ('class', 'interface')),
        parent_entity_name TEXT,
        property_name TEXT,
        line INTEGER,
        "column" INTEGER,
        refactor_action TEXT,
        refactor_context_json TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
      )`);
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_code_issues_module_id ON code_issues (module_id)');
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_code_issues_package_id ON code_issues (package_id)');
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_code_issues_entity_id ON code_issues (entity_id)');
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_code_issues_rule_code ON code_issues (rule_code)');
    }

    // Ensure analysis tables exist (added by advanced-analysis integration).
    await this.ensureAnalysisTables();
  }

  /**
   * Creates analysis tables (snapshots, entity_metrics, call_edges, dependency_cycles,
   * duplication_clusters, architectural_violations) if they are missing. Idempotent.
   */
  private async ensureAnalysisTables(): Promise<void> {
    try {
      await this.adapter.query('SELECT 1 FROM analysis_snapshots LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE analysis_snapshots (
        id CHAR(36) PRIMARY KEY,
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        analyzer_versions_json TEXT,
        config_json TEXT,
        duration_ms INTEGER
      )`);
      await this.adapter.query(
        'CREATE INDEX IF NOT EXISTS idx_analysis_snapshots_package_id ON analysis_snapshots (package_id)'
      );
    }

    try {
      await this.adapter.query('SELECT 1 FROM entity_metrics LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE entity_metrics (
        id CHAR(36) PRIMARY KEY,
        snapshot_id CHAR(36) NOT NULL REFERENCES analysis_snapshots (id),
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        module_id CHAR(36),
        entity_id CHAR(36) NOT NULL,
        entity_type TEXT NOT NULL CHECK (entity_type IN ('package', 'module', 'class', 'interface', 'method', 'function', 'property', 'typeAlias', 'variable', 'enum')),
        metric_key TEXT NOT NULL,
        metric_value DOUBLE NOT NULL,
        metric_category TEXT NOT NULL CHECK (metric_category IN ('complexity', 'coupling', 'typeSafety', 'size', 'documentation', 'deadCode', 'duplication', 'testing', 'composite')),
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        UNIQUE (snapshot_id, entity_id, entity_type, metric_key)
      )`);
      await this.adapter.query(
        'CREATE INDEX IF NOT EXISTS idx_entity_metrics_entity ON entity_metrics (entity_id, entity_type)'
      );
      await this.adapter.query(
        'CREATE INDEX IF NOT EXISTS idx_entity_metrics_module_id ON entity_metrics (module_id)'
      );
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_entity_metrics_key ON entity_metrics (metric_key)');
      await this.adapter.query(
        'CREATE INDEX IF NOT EXISTS idx_entity_metrics_snapshot ON entity_metrics (snapshot_id)'
      );
    }

    try {
      await this.adapter.query('SELECT 1 FROM call_edges LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE call_edges (
        id CHAR(36) PRIMARY KEY,
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        module_id CHAR(36) NOT NULL REFERENCES modules (id),
        source_entity_id CHAR(36) NOT NULL,
        source_entity_type TEXT NOT NULL CHECK (source_entity_type IN ('method', 'function')),
        target_entity_id CHAR(36),
        target_entity_type TEXT CHECK (target_entity_type IN ('method', 'function')),
        target_name TEXT,
        target_qualifier TEXT,
        call_expression_line INTEGER,
        is_async_call BOOLEAN NOT NULL DEFAULT FALSE,
        is_awaited BOOLEAN NOT NULL DEFAULT FALSE,
        resolution_status TEXT NOT NULL CHECK (resolution_status IN ('resolved', 'ambiguous', 'unresolved', 'external')),
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
      )`);
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_call_edges_source ON call_edges (source_entity_id)');
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_call_edges_target ON call_edges (target_entity_id)');
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_call_edges_module_id ON call_edges (module_id)');
    }

    try {
      await this.adapter.query('SELECT 1 FROM dependency_cycles LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE dependency_cycles (
        id CHAR(36) PRIMARY KEY,
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        length INTEGER NOT NULL,
        participants_json TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
      )`);
      await this.adapter.query(
        'CREATE INDEX IF NOT EXISTS idx_dependency_cycles_package ON dependency_cycles (package_id)'
      );
    }

    try {
      await this.adapter.query('SELECT 1 FROM duplication_clusters LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE duplication_clusters (
        id CHAR(36) PRIMARY KEY,
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        token_count INTEGER NOT NULL,
        line_count INTEGER NOT NULL,
        fragment_count INTEGER NOT NULL,
        fingerprint TEXT NOT NULL,
        fragments_json TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
      )`);
      await this.adapter.query(
        'CREATE INDEX IF NOT EXISTS idx_duplication_clusters_package ON duplication_clusters (package_id)'
      );
    }

    try {
      await this.adapter.query('SELECT 1 FROM architectural_violations LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE architectural_violations (
        id CHAR(36) PRIMARY KEY,
        snapshot_id CHAR(36) NOT NULL REFERENCES analysis_snapshots (id),
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        rule_name TEXT NOT NULL,
        source_module_id CHAR(36),
        target_module_id CHAR(36),
        source_layer TEXT,
        target_layer TEXT,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
        message TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp
      )`);
      await this.adapter.query(
        'CREATE INDEX IF NOT EXISTS idx_arch_violations_package ON architectural_violations (package_id)'
      );
      await this.adapter.query(
        'CREATE INDEX IF NOT EXISTS idx_arch_violations_snapshot ON architectural_violations (snapshot_id)'
      );
      await this.adapter.query(
        'CREATE INDEX IF NOT EXISTS idx_arch_violations_source ON architectural_violations (source_module_id)'
      );
    }
  }

  /**
   * Verifies that the database schema exists by checking for the presence of required tables
   */
  private async verifySchema(): Promise<boolean> {
    const requiredTables = [
      'packages',
      'dependencies',
      'modules',
      'classes',
      'interfaces',
      'methods',
      'parameters',
      'properties',
      'imports',
      'class_implements',
      'interface_extends',
      'functions',
      'class_extends',
      'symbol_references',
      'type_aliases',
      'enums',
      'variables',
    ];

    for (const table of requiredTables) {
      try {
        // Check if table exists by selecting 1 row
        await this.adapter.query(`SELECT 1 FROM ${table} LIMIT 1`);
      } catch {
        databaseLogger.warn(`Schema verification missing table: ${table}`);
        return false;
      }
    }

    // Additional column-level verification for critical columns used by queries
    const methodsColumns = await this.getTableColumns('methods');
    const propertiesColumns = await this.getTableColumns('properties');

    if (!methodsColumns.has('parent_type') || !propertiesColumns.has('parent_type')) {
      return false;
    }

    return true;
  }

  public async initializeDatabase(reset = false, allowSchemaChanges = true): Promise<void> {
    databaseLogger.info('dbPath', this.dbPath);
    if (this.dbPath === ':memory:') {
      databaseLogger.info('Initializing in-memory database');
      if (!allowSchemaChanges) {
        throw new Error('Cannot initialize in-memory database in read-only mode without schema changes');
      }
      await this.adapter.init();
      await this.executeSchema(loadSchema());
      await this.migrateSchemaIfNeeded();
      return;
    }

    databaseLogger.info('Initializing file-based database');
    const path = join(process.cwd(), this.dbPath);
    databaseLogger.info('Absolute path being checked:', path);

    let exists = false;
    try {
      const stats = await fs.stat(path);
      databaseLogger.info('File stats:', {
        size: stats.size,
        isFile: stats.isFile(),
        created: stats.birthtime,
        modified: stats.mtime,
      });
      exists = true;
    } catch (error) {
      databaseLogger.warn('Error checking file:', error);
      exists = false;
    }

    databaseLogger.info('exists:', exists);
    databaseLogger.info('reset', reset);

    // For file-based databases, remove the file BEFORE initializing if it exists and reset is true
    if (exists && reset) {
      databaseLogger.info('Resetting database: removing existing file...');
      await fs.unlink(path);
      exists = false;
    }

    // Initialize the adapter (this will create a new database if needed)
    await this.adapter.init();

    const shouldVerifyExistingSchema = exists && !reset;
    const schemaIsValid = shouldVerifyExistingSchema ? await this.verifySchema() : false;
    const requiresSchemaInitialization = !exists || reset || !schemaIsValid;

    // If schema changes are not allowed (read-only mode), fail early with a clear error.
    if (requiresSchemaInitialization && !allowSchemaChanges) {
      throw new Error(
        `Database schema is missing or outdated at ${path}. Run 'pnpm analyze .' to recreate/update the database before starting the read-only server.`
      );
    }

    // If the file doesn't exist, or if reset is true, or if schema verification fails,
    // we need to execute the schema.
    if (requiresSchemaInitialization) {
      databaseLogger.info('Loading and executing schema...');
      await this.executeSchema(loadSchema());
      await this.migrateSchemaIfNeeded();
    } else if (allowSchemaChanges) {
      // For existing databases with tables present, attempt lightweight migrations
      await this.migrateSchemaIfNeeded();
    }
  }

  /**
   * Splits the SQL schema into individual statements and executes each one sequentially.
   * Note: Assumes that semicolons (;) correctly separate statements in your schema.
   */
  private async executeSchema(sqlScript: string): Promise<void> {
    // Remove lines that start with '--'
    const uncommentedScript = sqlScript
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');

    // Split the uncommented script into individual SQL statements.
    const statements = uncommentedScript
      .split(';')
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0);

    for (const stmt of statements) {
      try {
        await this.adapter.query(stmt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Ignore idempotent errors when tables or indexes already exist
        if (/already exists/i.test(message)) {
          continue;
        }
        throw error;
      }
    }
  }

  public async close(): Promise<void> {
    await this.adapter.close();
  }
}
