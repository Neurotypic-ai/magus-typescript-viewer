import * as fs from 'fs/promises';
import { join } from 'path';

import { loadSchema } from './schema/schema-loader';

import type { IDatabaseAdapter } from './adapter/IDatabaseAdapter';

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
    ];

    for (const table of requiredTables) {
      try {
        // Check if table exists by selecting 1 row
        await this.adapter.query(`SELECT 1 FROM ${table} LIMIT 1`);
      } catch {
        console.log(`Schema verification missing table: ${table}`);
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
    console.log('this.dbPath', this.dbPath);
    if (this.dbPath === ':memory:') {
      console.log('initializing in-memory database');
      if (!allowSchemaChanges) {
        throw new Error('Cannot initialize in-memory database in read-only mode without schema changes');
      }
      await this.adapter.init();
      await this.executeSchema(loadSchema());
      await this.migrateSchemaIfNeeded();
      return;
    }

    console.log('initializing file-based database');
    const path = join(process.cwd(), this.dbPath);
    console.log('Absolute path being checked:', path);

    let exists = false;
    try {
      const stats = await fs.stat(path);
      console.log('File stats:', {
        size: stats.size,
        isFile: stats.isFile(),
        created: stats.birthtime,
        modified: stats.mtime,
      });
      exists = true;
    } catch (error) {
      console.log('Error checking file:', error);
      exists = false;
    }

    console.log('exists:', exists);
    console.log('reset', reset);

    // For file-based databases, remove the file BEFORE initializing if it exists and reset is true
    if (exists && reset) {
      console.log('Resetting database: removing existing file...');
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
      console.log('Loading and executing schema...');
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
