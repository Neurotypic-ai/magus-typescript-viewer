import * as fs from 'fs/promises';
import { resolve } from 'path';

import { getErrorMessage } from '../../shared/utils/errorUtils';
import { createLogger } from '../../shared/utils/logger';
import { loadSchema } from './schema/schema-loader';

import type { Logger } from '../../shared/utils/logger';
import type { IDatabaseAdapter } from './adapter/IDatabaseAdapter';

export class Database {
  private adapter: IDatabaseAdapter;
  private dbPath: string;
  private readonly logger: Logger = createLogger('[Database]');

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
    // Methods table: ensure columns used by queries exist
    await this.ensureColumns('methods', [
      { name: 'parent_type', definition: "parent_type TEXT DEFAULT 'class'" },
      { name: 'is_abstract', definition: 'is_abstract BOOLEAN DEFAULT FALSE' },
      { name: 'created_at', definition: 'created_at TIMESTAMP DEFAULT current_timestamp' },
    ]);

    // Properties table
    await this.ensureColumns('properties', [
      { name: 'parent_type', definition: "parent_type TEXT DEFAULT 'class'" },
      { name: 'created_at', definition: 'created_at TIMESTAMP DEFAULT current_timestamp' },
    ]);

    // Interfaces table
    await this.ensureColumns('interfaces', [
      { name: 'created_at', definition: 'created_at TIMESTAMP DEFAULT current_timestamp' },
    ]);

    // Classes table
    await this.ensureColumns('classes', [
      { name: 'created_at', definition: 'created_at TIMESTAMP DEFAULT current_timestamp' },
    ]);

    // Parameters table
    await this.ensureColumns('parameters', [
      { name: 'created_at', definition: 'created_at TIMESTAMP DEFAULT current_timestamp' },
    ]);

    // Imports table
    await this.ensureColumns('imports', [
      { name: 'specifiers_json', definition: 'specifiers_json TEXT' },
    ]);

    // Packages table: ensure commit_hash column exists
    await this.ensureColumns('packages', [
      { name: 'commit_hash', definition: 'commit_hash CHAR(40)' },
    ]);

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

    try {
      await this.adapter.query('SELECT 1 FROM call_edges LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE call_edges (
        id CHAR(36) PRIMARY KEY,
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        module_id CHAR(36) NOT NULL REFERENCES modules (id),
        caller_id CHAR(36) NOT NULL,
        caller_name TEXT NOT NULL,
        callee_name TEXT NOT NULL,
        qualifier TEXT,
        call_type TEXT NOT NULL CHECK (call_type IN ('function', 'method', 'constructor', 'static')),
        line INTEGER,
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        UNIQUE (caller_id, callee_name, qualifier, call_type)
      )`);
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_call_edges_module_id ON call_edges (module_id)');
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_call_edges_caller_id ON call_edges (caller_id)');
    }

    try {
      await this.adapter.query('SELECT 1 FROM type_references LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE type_references (
        id CHAR(36) PRIMARY KEY,
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        module_id CHAR(36) NOT NULL REFERENCES modules (id),
        source_id CHAR(36) NOT NULL,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('property', 'method', 'parameter')),
        type_name TEXT NOT NULL,
        context TEXT NOT NULL CHECK (context IN ('property_type', 'parameter_type', 'return_type', 'generic_argument')),
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        UNIQUE (source_id, source_kind, type_name, context)
      )`);
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_type_references_module_id ON type_references (module_id)');
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_type_references_source_id ON type_references (source_id)');
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_type_references_type_name ON type_references (type_name)');
    }

    try {
      await this.adapter.query('SELECT 1 FROM tech_debt_markers LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE tech_debt_markers (
        id CHAR(36) PRIMARY KEY,
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        module_id CHAR(36) NOT NULL REFERENCES modules (id),
        marker_type TEXT NOT NULL CHECK (marker_type IN ('any_type', 'ts_ignore', 'ts_expect_error', 'type_assertion', 'non_null_assertion', 'todo_comment', 'fixme_comment', 'hack_comment')),
        line INTEGER NOT NULL,
        snippet TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        UNIQUE (module_id, marker_type, line, snippet)
      )`);
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_tech_debt_markers_module_id ON tech_debt_markers (module_id)');
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_tech_debt_markers_marker_type ON tech_debt_markers (marker_type)');
    }

    // Ensure snapshots table exists (optional — not in requiredTables)
    try {
      await this.adapter.query('SELECT 1 FROM snapshots LIMIT 1');
    } catch {
      await this.adapter.query(`CREATE TABLE snapshots (
        id CHAR(36) NOT NULL PRIMARY KEY,
        repo_path TEXT NOT NULL,
        commit_hash CHAR(40) NOT NULL,
        commit_short CHAR(7) NOT NULL,
        subject TEXT NOT NULL,
        author_name TEXT NOT NULL,
        author_email TEXT NOT NULL,
        commit_at TIMESTAMP NOT NULL,
        package_id CHAR(36) NOT NULL REFERENCES packages (id),
        ordinal INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT current_timestamp,
        UNIQUE (repo_path, commit_hash)
      )`);
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_snapshots_repo_path ON snapshots (repo_path)');
      await this.adapter.query('CREATE INDEX IF NOT EXISTS idx_snapshots_ordinal ON snapshots (ordinal)');
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
      'call_edges',
      'type_references',
      'tech_debt_markers',
      'type_aliases',
      'enums',
      'variables',
    ];

    for (const table of requiredTables) {
      try {
        // Check if table exists by selecting 1 row
        await this.adapter.query(`SELECT 1 FROM ${table} LIMIT 1`);
      } catch {
        this.logger.debug(`Schema verification missing table: ${table}`);
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
    this.logger.debug('Initializing database', { dbPath: this.dbPath });
    if (this.dbPath === ':memory:') {
      this.logger.debug('Initializing in-memory database');
      if (!allowSchemaChanges) {
        throw new Error('Cannot initialize in-memory database in read-only mode without schema changes');
      }
      await this.adapter.init();
      await this.executeSchema(loadSchema());
      await this.migrateSchemaIfNeeded();
      return;
    }

    this.logger.debug('Initializing file-based database');
    const path = resolve(process.cwd(), this.dbPath);
    this.logger.debug('Absolute path being checked:', path);

    let exists = false;
    try {
      const stats = await fs.stat(path);
      this.logger.debug('File stats:', {
        size: stats.size,
        isFile: stats.isFile(),
        created: stats.birthtime,
        modified: stats.mtime,
      });
      exists = true;
    } catch (error) {
      this.logger.debug('Database file does not exist yet', error);
      exists = false;
    }

    this.logger.debug('Database state:', { exists, reset });

    // For file-based databases, remove the file BEFORE initializing if it exists and reset is true
    if (exists && reset) {
      this.logger.debug('Resetting database: removing existing file...');
      await fs.unlink(path);
      exists = false;
    }

    // Initialize the adapter (this will create a new database if needed)
    await this.adapter.init();

    const schemaIsValid = await this.verifySchema();
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
      this.logger.debug('Loading and executing schema...');
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
        const message = getErrorMessage(error);
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
