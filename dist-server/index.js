// src/server/cli/index.ts
import { dirname as dirname3, join as join4 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { readPackage as readPackage2 } from "read-pkg";

// src/server/db/Database.ts
import * as fs from "fs/promises";
import { join } from "path";

// src/server/db/schema/schema-loader.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
function loadSchema() {
  const schemaFileUrl = new URL("./schema.sql", import.meta.url);
  return readFileSync(fileURLToPath(schemaFileUrl), "utf-8");
}

// src/server/db/Database.ts
var Database = class {
  adapter;
  dbPath;
  constructor(adapter, dbPath = ":memory:") {
    this.adapter = adapter;
    this.dbPath = dbPath;
  }
  /**
   * Gets the database adapter instance
   */
  getAdapter() {
    return this.adapter;
  }
  /**
   * Returns a set of column names for a given table using DuckDB PRAGMA.
   */
  async getTableColumns(table) {
    const rows = await this.adapter.query(`PRAGMA table_info('${table}')`);
    const names = rows.map((r) => r.name).filter((n) => n.length > 0);
    return new Set(names);
  }
  /**
   * Ensures that the given columns exist on the table; if missing, add them.
   * Definition should include the full column definition (e.g., "parent_type TEXT DEFAULT 'class'").
   */
  async ensureColumns(table, columns) {
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
  async migrateSchemaIfNeeded() {
    await this.ensureColumns("methods", [
      { name: "parent_type", definition: "parent_type TEXT DEFAULT 'class'" },
      { name: "is_abstract", definition: "is_abstract BOOLEAN DEFAULT FALSE" },
      { name: "created_at", definition: "created_at TIMESTAMP DEFAULT current_timestamp" }
    ]);
    await this.ensureColumns("properties", [
      { name: "parent_type", definition: "parent_type TEXT DEFAULT 'class'" },
      { name: "created_at", definition: "created_at TIMESTAMP DEFAULT current_timestamp" }
    ]);
    await this.ensureColumns("interfaces", [
      { name: "created_at", definition: "created_at TIMESTAMP DEFAULT current_timestamp" }
    ]);
    await this.ensureColumns("classes", [
      { name: "created_at", definition: "created_at TIMESTAMP DEFAULT current_timestamp" }
    ]);
    await this.ensureColumns("parameters", [
      { name: "created_at", definition: "created_at TIMESTAMP DEFAULT current_timestamp" }
    ]);
    await this.ensureColumns("imports", [
      { name: "specifiers_json", definition: "specifiers_json TEXT" }
    ]);
  }
  /**
   * Verifies that the database schema exists by checking for the presence of required tables
   */
  async verifySchema() {
    const requiredTables = [
      "packages",
      "dependencies",
      "modules",
      "classes",
      "interfaces",
      "methods",
      "parameters",
      "properties",
      "imports",
      "class_implements",
      "interface_extends",
      "functions",
      "class_extends",
      "symbol_references",
      "type_aliases",
      "enums",
      "variables"
    ];
    for (const table of requiredTables) {
      try {
        await this.adapter.query(`SELECT 1 FROM ${table} LIMIT 1`);
      } catch {
        console.log(`Schema verification missing table: ${table}`);
        return false;
      }
    }
    const methodsColumns = await this.getTableColumns("methods");
    const propertiesColumns = await this.getTableColumns("properties");
    if (!methodsColumns.has("parent_type") || !propertiesColumns.has("parent_type")) {
      return false;
    }
    return true;
  }
  async initializeDatabase(reset = false, allowSchemaChanges = true) {
    console.log("this.dbPath", this.dbPath);
    if (this.dbPath === ":memory:") {
      console.log("initializing in-memory database");
      if (!allowSchemaChanges) {
        throw new Error("Cannot initialize in-memory database in read-only mode without schema changes");
      }
      await this.adapter.init();
      await this.executeSchema(loadSchema());
      await this.migrateSchemaIfNeeded();
      return;
    }
    console.log("initializing file-based database");
    const path = join(process.cwd(), this.dbPath);
    console.log("Absolute path being checked:", path);
    let exists = false;
    try {
      const stats = await fs.stat(path);
      console.log("File stats:", {
        size: stats.size,
        isFile: stats.isFile(),
        created: stats.birthtime,
        modified: stats.mtime
      });
      exists = true;
    } catch (error) {
      console.log("Error checking file:", error);
      exists = false;
    }
    console.log("exists:", exists);
    console.log("reset", reset);
    if (exists && reset) {
      console.log("Resetting database: removing existing file...");
      await fs.unlink(path);
      exists = false;
    }
    await this.adapter.init();
    const schemaIsValid = await this.verifySchema();
    const requiresSchemaInitialization = !exists || reset || !schemaIsValid;
    if (requiresSchemaInitialization && !allowSchemaChanges) {
      throw new Error(
        `Database schema is missing or outdated at ${path}. Run 'pnpm analyze .' to recreate/update the database before starting the read-only server.`
      );
    }
    if (requiresSchemaInitialization) {
      console.log("Loading and executing schema...");
      await this.executeSchema(loadSchema());
      await this.migrateSchemaIfNeeded();
    } else if (allowSchemaChanges) {
      await this.migrateSchemaIfNeeded();
    }
  }
  /**
   * Splits the SQL schema into individual statements and executes each one sequentially.
   * Note: Assumes that semicolons (;) correctly separate statements in your schema.
   */
  async executeSchema(sqlScript) {
    const uncommentedScript = sqlScript.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
    const statements = uncommentedScript.split(";").map((stmt) => stmt.trim()).filter((stmt) => stmt.length > 0);
    for (const stmt of statements) {
      try {
        await this.adapter.query(stmt);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already exists/i.test(message)) {
          continue;
        }
        throw error;
      }
    }
  }
  async close() {
    await this.adapter.close();
  }
};

// src/server/db/adapter/DuckDBAdapter.ts
function isDuckDBRow(row) {
  return Array.isArray(row);
}
function isTimestampValue(value) {
  return typeof value === "object" && value !== null && "micros" in value;
}
function normalizeValue(value) {
  if (value === null || value === void 0) {
    return value;
  }
  if (isTimestampValue(value)) {
    const milliseconds = Number(value.micros) / 1e3;
    return new Date(milliseconds).toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) ? numeric : value.toString();
  }
  return value;
}
function toStringId(value) {
  if (value === null || value === void 0) {
    throw new Error("Row is missing required id field");
  }
  const normalized = normalizeValue(value);
  if (typeof normalized === "string") {
    return normalized;
  }
  if (typeof normalized === "number" || typeof normalized === "boolean") {
    return String(normalized);
  }
  return JSON.stringify(normalized);
}
function convertToRow(duckDBRow, columnNames) {
  if (!isDuckDBRow(duckDBRow)) {
    throw new Error("Invalid row format from DuckDB");
  }
  const id = duckDBRow[0];
  return {
    id: toStringId(id),
    ...Object.fromEntries(
      duckDBRow.slice(1).map((value, index) => [
        columnNames[index + 1] ?? `column_${(index + 1).toString()}`,
        value !== null ? normalizeValue(value) : null
      ])
    )
  };
}
var DuckDBAdapter = class {
  constructor(dbPath, config) {
    this.dbPath = dbPath;
    this.config = config;
    this.poolSize = config?.poolSize ?? 4;
  }
  db;
  availableConnections = [];
  waitingForConnection = [];
  isInitialized = false;
  poolSize;
  async init() {
    if (this.isInitialized) {
      return;
    }
    const duckdb = await import("@duckdb/node-api");
    this.db = await duckdb.DuckDBInstance.create(this.dbPath, {
      access_mode: this.config?.allowWrite ? "READ_WRITE" : "READ_ONLY",
      threads: this.config?.threads ? this.config.threads.toString() : "8"
    });
    for (let i = 0; i < this.poolSize; i++) {
      const connection = await this.db.connect();
      this.availableConnections.push(connection);
    }
    this.isInitialized = true;
  }
  acquireConnection() {
    const available = this.availableConnections.pop();
    if (available) {
      return Promise.resolve(available);
    }
    return new Promise((resolve2) => {
      this.waitingForConnection.push(resolve2);
    });
  }
  releaseConnection(connection) {
    const waiter = this.waitingForConnection.shift();
    if (waiter) {
      waiter(connection);
    } else {
      this.availableConnections.push(connection);
    }
  }
  getDbPath() {
    return this.dbPath;
  }
  async query(sql, params) {
    if (!this.isInitialized) {
      throw new Error("Database not initialized. Call init() first.");
    }
    const connection = await this.acquireConnection();
    try {
      const queryParams = params ?? [];
      const result = await connection.runAndReadAll(sql, queryParams);
      if (typeof result.columnNames !== "function" || typeof result.getRows !== "function") {
        throw new Error("Invalid result from DuckDB query");
      }
      const columnNames = result.columnNames();
      const rows = result.getRows();
      if (!Array.isArray(rows)) {
        throw new Error("Invalid rows format from DuckDB query");
      }
      return rows.map((row) => convertToRow(row, columnNames));
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      this.releaseConnection(connection);
    }
  }
  async close() {
    if (this.isInitialized) {
      await Promise.resolve();
      this.isInitialized = false;
    }
  }
  async transaction(callback) {
    if (!this.isInitialized) {
      throw new Error("Database not initialized. Call init() first.");
    }
    const connection = await this.acquireConnection();
    try {
      await connection.run("BEGIN TRANSACTION");
      const result = await callback();
      await connection.run("COMMIT");
      return result;
    } catch (error) {
      await connection.run("ROLLBACK");
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      this.releaseConnection(connection);
    }
  }
};

// src/shared/types/Class.ts
var Class = class {
  constructor(id, package_id, module_id, name, created_at = /* @__PURE__ */ new Date(), methods = /* @__PURE__ */ new Map(), properties = /* @__PURE__ */ new Map(), implemented_interfaces = /* @__PURE__ */ new Map(), extends_id) {
    this.id = id;
    this.package_id = package_id;
    this.module_id = module_id;
    this.name = name;
    this.created_at = created_at;
    this.methods = methods;
    this.properties = properties;
    this.implemented_interfaces = implemented_interfaces;
    this.extends_id = extends_id;
  }
};

// src/server/db/errors/RepositoryError.ts
var RepositoryError = class _RepositoryError extends Error {
  operation;
  repository;
  cause;
  constructor(message, operation, repository, cause) {
    const fullMessage = `[${repository}] ${operation}: ${message}`;
    super(fullMessage);
    this.name = "RepositoryError";
    this.operation = operation;
    this.repository = repository;
    this.cause = cause ?? void 0;
    Object.setPrototypeOf(this, new.target.prototype);
  }
  /**
   * Get the root cause of the error chain
   */
  getRootCause() {
    const traverse = (error) => {
      if (error instanceof _RepositoryError && error.cause) {
        return traverse(error.cause);
      }
      return error;
    };
    return traverse(this);
  }
  /**
   * Get a string representation of the error chain
   */
  getErrorChain() {
    const chain = [this.message];
    let current = this.cause;
    while (current) {
      chain.push(current.message);
      current = current instanceof _RepositoryError ? current.cause : void 0;
    }
    return chain.join(" -> ");
  }
};
var EntityNotFoundError = class extends RepositoryError {
  constructor(entity, id, repository) {
    super(`${entity} with ID '${id}' not found`, "retrieve", repository);
    this.name = "EntityNotFoundError";
  }
};
var NoFieldsToUpdateError = class extends RepositoryError {
  constructor(entity, repository) {
    super(`No fields provided to update ${entity}`, "update", repository);
    this.name = "NoFieldsToUpdateError";
  }
};

// src/shared/utils/logger.ts
var DEBUG = process.env["DEBUG"] === "true";
var ConsoleLogger = class {
  prefix;
  logQueue = [];
  isProcessing = false;
  constructor(prefix) {
    this.prefix = prefix ?? "";
  }
  async processQueue() {
    if (this.isProcessing || this.logQueue.length === 0) return;
    this.isProcessing = true;
    while (this.logQueue.length > 0) {
      const logFn = this.logQueue.shift();
      if (logFn) {
        logFn();
        await new Promise((resolve2) => setTimeout(resolve2, 0));
      }
    }
    this.isProcessing = false;
  }
  queueLog(logFn) {
    this.logQueue.push(logFn);
    void this.processQueue();
  }
  formatMessage(message) {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().substring(11, 19);
    return `${timestamp} [${this.prefix ?? "Logger"}] ${message}`;
  }
  info(message, ...args) {
    this.queueLog(() => {
      if (args.length > 0) {
        console.log(this.formatMessage(message), ...args);
      } else {
        console.log(this.formatMessage(message));
      }
    });
  }
  debug(message, ...args) {
    if (DEBUG) {
      this.queueLog(() => {
        if (args.length > 0) {
          console.debug(this.formatMessage(`[DEBUG] ${message}`), ...args);
        } else {
          console.debug(this.formatMessage(`[DEBUG] ${message}`));
        }
      });
    }
  }
  error(message, error) {
    this.queueLog(() => {
      const errorMsg = error instanceof Error ? error.message : JSON.stringify(error ?? "");
      console.error(this.formatMessage(`\u274C ${message}`), errorMsg);
    });
  }
  warn(message, ...args) {
    this.queueLog(() => {
      if (args.length > 0) {
        console.warn(this.formatMessage(`\u26A0\uFE0F  ${message}`), ...args);
      } else {
        console.warn(this.formatMessage(`\u26A0\uFE0F  ${message}`));
      }
    });
  }
};
var logger = new ConsoleLogger();
var createLogger = (prefix) => new ConsoleLogger(prefix);

// src/server/db/repositories/BaseRepository.ts
var DatabaseResultError = class extends RepositoryError {
  constructor(message, operation, repository) {
    super(message, operation, repository);
    this.name = "DatabaseResultError";
  }
};
var BaseRepository = class {
  adapter;
  errorTag;
  tableName;
  logger;
  constructor(adapter, errorTag, tableName) {
    this.adapter = adapter;
    this.errorTag = errorTag;
    this.tableName = tableName;
    this.logger = createLogger(errorTag);
  }
  isDatabaseRow(item) {
    if (item === null || typeof item !== "object") {
      return false;
    }
    const record = item;
    return "id" in record && typeof record["id"] === "string";
  }
  isArrayOfDatabaseRows(data) {
    if (!Array.isArray(data)) {
      return false;
    }
    return data.every((item) => this.isDatabaseRow(item));
  }
  async executeQuery(operation, query, params = []) {
    try {
      this.logger.debug(`Executing ${operation}:`, {
        query,
        params,
        table: this.tableName
      });
      const result = await this.adapter.query(query, params);
      this.logger.debug(`Query results for ${operation}:`, {
        count: result.length,
        table: this.tableName
      });
      if (!this.isArrayOfDatabaseRows(result)) {
        throw new DatabaseResultError(
          `Query result is not an array of database rows for operation '${operation}'`,
          operation,
          this.errorTag
        );
      }
      return result;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("prepared statement")) {
        throw new RepositoryError(
          `Database operation '${operation}' failed in ${this.tableName}: ${error.message}`,
          operation,
          this.errorTag,
          error
        );
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new RepositoryError(
        `Database operation '${operation}' failed in ${this.tableName}: ${errorMessage}`,
        operation,
        this.errorTag,
        error instanceof Error ? error : new Error(errorMessage)
      );
    }
  }
  /**
   * Batch-insert multiple rows in chunks to avoid query size limits.
   * Ignores duplicate key errors for each chunk.
   *
   * @param columns - The column names, e.g. "(id, name, module_id)"
   * @param columnCount - Number of columns per row (for placeholder generation)
   * @param items - The items to insert
   * @param itemToParams - Function that converts an item to an array of parameter values
   * @param chunkSize - Maximum rows per INSERT statement (default 500)
   */
  async executeBatchInsert(columns, columnCount, items, itemToParams, chunkSize = 500) {
    if (items.length === 0) return;
    const singleRowPlaceholder = `(${Array.from({ length: columnCount }, () => "?").join(", ")})`;
    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => singleRowPlaceholder).join(", ");
      const params = chunk.flatMap(itemToParams);
      try {
        await this.adapter.query(
          `INSERT INTO ${this.tableName} ${columns} VALUES ${placeholders}`,
          params
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("Duplicate") || msg.includes("UNIQUE") || msg.includes("already exists")) {
          for (const item of chunk) {
            try {
              await this.adapter.query(
                `INSERT INTO ${this.tableName} ${columns} VALUES ${singleRowPlaceholder}`,
                itemToParams(item)
              );
            } catch (innerError) {
              const innerMsg = innerError instanceof Error ? innerError.message : "";
              if (innerMsg.includes("Duplicate") || innerMsg.includes("UNIQUE") || innerMsg.includes("already exists")) {
                continue;
              }
              throw innerError;
            }
          }
        } else {
          throw error;
        }
      }
    }
  }
  buildUpdateQuery(updates) {
    const validUpdates = updates.filter((update) => update.value !== void 0);
    const setClauses = validUpdates.map((update) => `${update.field} = ?`);
    const values = validUpdates.map((update) => update.value);
    return {
      query: setClauses.join(", "),
      values
    };
  }
};

// src/shared/types/Method.ts
var Method = class {
  constructor(id, package_id, module_id, parent_id, name, created_at = /* @__PURE__ */ new Date(), parameters = /* @__PURE__ */ new Map(), return_type = "void", is_static = false, is_async = false, visibility = "public") {
    this.id = id;
    this.package_id = package_id;
    this.module_id = module_id;
    this.parent_id = parent_id;
    this.name = name;
    this.created_at = created_at;
    this.parameters = parameters;
    this.return_type = return_type;
    this.is_static = is_static;
    this.is_async = is_async;
    this.visibility = visibility;
  }
};

// src/shared/types/Parameter.ts
var Parameter = class {
  constructor(id, package_id, module_id, method_id, name, created_at = /* @__PURE__ */ new Date(), type = "any", is_optional = false, is_rest = false, default_value = void 0) {
    this.id = id;
    this.package_id = package_id;
    this.module_id = module_id;
    this.method_id = method_id;
    this.name = name;
    this.created_at = created_at;
    this.type = type;
    this.is_optional = is_optional;
    this.is_rest = is_rest;
    this.default_value = default_value;
  }
};

// src/server/db/repositories/MethodRepository.ts
var MethodRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[MethodRepository]", "methods");
  }
  /**
   * Batch-insert multiple methods at once. Ignores duplicates.
   */
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, module_id, parent_id, parent_type, name, return_type, is_static, is_async, visibility)",
      10,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.parent_id,
        dto.parent_type,
        dto.name,
        dto.return_type,
        dto.is_static,
        dto.is_async,
        dto.visibility
      ]
    );
  }
  async create(dto) {
    try {
      const params = [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.parent_id,
        dto.parent_type,
        dto.name,
        dto.return_type,
        dto.is_static,
        dto.is_async,
        dto.visibility
      ];
      await this.executeQuery(
        "create",
        "INSERT INTO methods (id, package_id, module_id, parent_id, parent_type, name, return_type, is_static, is_async, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params
      );
      return new Method(
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.parent_id,
        dto.name,
        /* @__PURE__ */ new Date(),
        /* @__PURE__ */ new Map(),
        dto.return_type,
        dto.is_static,
        dto.is_async,
        dto.visibility
      );
    } catch (error) {
      this.logger.error("Failed to create method", error);
      throw new RepositoryError("Failed to create method", "create", this.errorTag, error);
    }
  }
  async update(id, dto) {
    try {
      const updates = [
        { field: "name", value: dto.name ?? void 0 },
        { field: "return_type", value: dto.return_type ?? void 0 },
        { field: "is_static", value: dto.is_static ?? void 0 },
        { field: "is_async", value: dto.is_async ?? void 0 },
        { field: "visibility", value: dto.visibility ?? void 0 }
      ];
      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);
      await this.executeQuery("update", `UPDATE ${this.tableName} SET ${query} WHERE id = ?`, values);
      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError("Method", id, this.errorTag);
      }
      return result;
    } catch (error) {
      this.logger.error("Failed to update method", error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to update method", "update", this.errorTag, error);
    }
  }
  async retrieve(id, module_id) {
    try {
      const conditions = [];
      const params = [];
      if (id !== void 0) {
        conditions.push("m.id = ?");
        params.push(id);
      }
      if (module_id !== void 0) {
        conditions.push("m.module_id = ?");
        params.push(module_id);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const query = `
        SELECT m.* 
        FROM methods m
        ${whereClause}
      `.trim().replace(/\s+/g, " ");
      this.logger.debug("Executing retrieve query:", { query, params });
      const results = await this.executeQuery("retrieve", query, params);
      return results.map(
        (method) => new Method(
          method.id,
          method.package_id,
          method.module_id,
          method.parent_id,
          method.name,
          new Date(method.created_at),
          /* @__PURE__ */ new Map(),
          method.return_type,
          method.is_static,
          method.is_async,
          method.visibility
        )
      );
    } catch (error) {
      this.logger.error("Failed to retrieve method", error);
      throw new RepositoryError("Failed to retrieve method", "retrieve", this.errorTag, error);
    }
  }
  async retrieveById(id) {
    const results = await this.retrieve(id);
    return results[0];
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
  async delete(id) {
    try {
      await this.executeQuery("delete parameters", "DELETE FROM parameters WHERE method_id = ?", [id]);
      await this.executeQuery("delete method", "DELETE FROM methods WHERE id = ?", [id]);
    } catch (error) {
      this.logger.error("Failed to delete method", error);
      throw new RepositoryError("Failed to delete method", "delete", this.errorTag, error);
    }
  }
  /**
   * Batch-retrieve all methods for multiple parent IDs of a given type.
   * Returns a Map keyed by parent_id, each value is a Map<string, Method>.
   */
  async retrieveByParentIds(parentIds, parentType) {
    const result = /* @__PURE__ */ new Map();
    if (parentIds.length === 0) return result;
    for (const pid of parentIds) {
      result.set(pid, /* @__PURE__ */ new Map());
    }
    try {
      const placeholders = parentIds.map(() => "?").join(", ");
      const methods = await this.executeQuery(
        "retrieveByParentIds",
        `SELECT m.* FROM methods m WHERE m.parent_id IN (${placeholders}) AND m.parent_type = ?`,
        [...parentIds, parentType]
      );
      if (methods.length === 0) return result;
      const methodIds = methods.map((m) => m.id);
      const paramPlaceholders = methodIds.map(() => "?").join(", ");
      const parameters = await this.executeQuery(
        "retrieveByParentIds parameters",
        `SELECT p.* FROM parameters p WHERE p.method_id IN (${paramPlaceholders})`,
        methodIds
      );
      const paramsByMethod = /* @__PURE__ */ new Map();
      for (const p of parameters) {
        let arr = paramsByMethod.get(p.method_id);
        if (!arr) {
          arr = [];
          paramsByMethod.set(p.method_id, arr);
        }
        arr.push(p);
      }
      for (const method of methods) {
        const methodParameters = /* @__PURE__ */ new Map();
        const methodParams = paramsByMethod.get(method.id) ?? [];
        for (const p of methodParams) {
          methodParameters.set(
            p.id,
            new Parameter(
              p.id,
              p.package_id,
              p.module_id,
              p.method_id,
              p.name,
              new Date(p.created_at),
              p.type,
              Boolean(p.is_optional),
              Boolean(p.is_rest),
              p.default_value ?? void 0
            )
          );
        }
        const methodObj = new Method(
          method.id,
          method.package_id,
          method.module_id,
          method.parent_id,
          method.name,
          new Date(method.created_at ?? (/* @__PURE__ */ new Date()).toISOString()),
          methodParameters,
          method.return_type,
          method.is_static,
          method.is_async,
          method.visibility
        );
        const parentMap = result.get(method.parent_id);
        if (parentMap) {
          parentMap.set(method.id, methodObj);
        }
      }
      return result;
    } catch (error) {
      this.logger.error("Failed to retrieve methods by parent IDs", error);
      throw new RepositoryError(
        "Failed to retrieve methods by parent IDs",
        "retrieveByParentIds",
        this.errorTag,
        error
      );
    }
  }
  async retrieveByParent(parentId, parentType) {
    try {
      const methods = await this.executeQuery(
        "retrieve methods",
        `SELECT m.* FROM methods m 
         WHERE m.parent_id = ? 
         AND m.parent_type = ?`,
        [parentId, parentType]
      );
      this.logger.debug(`Found ${methods.length.toString()} methods for ${parentType} ${parentId}`);
      if (methods.length === 0) {
        this.logger.debug(`No methods found for ${parentType} ${parentId}`);
        return /* @__PURE__ */ new Map();
      }
      const methodIds = methods.map((m) => m.id);
      const placeholders = methodIds.map(() => "?").join(",");
      const parameters = await this.executeQuery(
        "retrieve parameters",
        `SELECT p.* FROM parameters p 
         WHERE p.method_id IN (${placeholders})`,
        methodIds
      );
      this.logger.debug(`Found ${parameters.length.toString()} parameters for ${methodIds.length.toString()} methods`);
      const methodMap = /* @__PURE__ */ new Map();
      for (const method of methods) {
        const methodParameters = /* @__PURE__ */ new Map();
        parameters.filter((p) => p.method_id === method.id).forEach((p) => {
          methodParameters.set(
            p.id,
            new Parameter(
              p.id,
              p.package_id,
              p.module_id,
              p.method_id,
              p.name,
              new Date(p.created_at),
              p.type,
              Boolean(p.is_optional),
              Boolean(p.is_rest),
              p.default_value ?? void 0
            )
          );
        });
        methodMap.set(
          method.id,
          new Method(
            method.id,
            method.package_id,
            method.module_id,
            method.parent_id,
            method.name,
            new Date(method.created_at ?? (/* @__PURE__ */ new Date()).toISOString()),
            methodParameters,
            method.return_type,
            method.is_static,
            method.is_async,
            method.visibility
          )
        );
      }
      return methodMap;
    } catch (error) {
      this.logger.error("Failed to retrieve methods by parent", error);
      throw new RepositoryError(
        "Failed to retrieve methods by parent",
        "retrieveByParent",
        this.errorTag,
        error
      );
    }
  }
};

// src/shared/types/Property.ts
var Property = class {
  constructor(id, package_id, module_id, parent_id, name, created_at = /* @__PURE__ */ new Date(), type = "any", is_static = false, is_readonly = false, visibility = "public", default_value = void 0) {
    this.id = id;
    this.package_id = package_id;
    this.module_id = module_id;
    this.parent_id = parent_id;
    this.name = name;
    this.created_at = created_at;
    this.type = type;
    this.is_static = is_static;
    this.is_readonly = is_readonly;
    this.visibility = visibility;
    this.default_value = default_value;
  }
};

// src/server/db/repositories/PropertyRepository.ts
var PropertyRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[PropertyRepository]", "properties");
  }
  /**
   * Batch-insert multiple properties at once. Ignores duplicates.
   */
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, module_id, parent_id, parent_type, name, type, is_static, is_readonly, visibility)",
      10,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.parent_id,
        dto.parent_type,
        dto.name,
        dto.type,
        dto.is_static,
        dto.is_readonly,
        dto.visibility
      ]
    );
  }
  async create(dto) {
    try {
      const params = [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.parent_id,
        dto.parent_type,
        dto.name,
        dto.type,
        dto.is_static,
        dto.is_readonly,
        dto.visibility
      ];
      await this.executeQuery(
        "create",
        "INSERT INTO properties (id, package_id, module_id, parent_id, parent_type, name, type, is_static, is_readonly, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params
      );
      return new Property(
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.parent_id,
        dto.name,
        /* @__PURE__ */ new Date(),
        dto.type,
        dto.is_static,
        dto.is_readonly,
        dto.visibility
      );
    } catch (error) {
      this.logger.error("Failed to create property", error);
      throw new RepositoryError("Failed to create property", "create", this.errorTag, error);
    }
  }
  async update(id, dto) {
    try {
      const updates = [
        { field: "name", value: dto.name ?? void 0 },
        { field: "type", value: dto.type ?? void 0 },
        { field: "is_static", value: dto.is_static ?? void 0 },
        { field: "is_readonly", value: dto.is_readonly ?? void 0 },
        { field: "visibility", value: dto.visibility ?? void 0 }
      ];
      if (updates.every((update) => update.value === void 0)) {
        throw new NoFieldsToUpdateError("Property", this.errorTag);
      }
      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);
      await this.executeQuery("update", `UPDATE ${this.tableName} SET ${query} WHERE id = ?`, values);
      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError("Property", id, this.errorTag);
      }
      return result;
    } catch (error) {
      this.logger.error("Failed to update property", error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to update property", "update", this.errorTag, error);
    }
  }
  async retrieveById(id) {
    const results = await this.retrieve(id);
    return results[0];
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
  async retrieve(id, module_id) {
    try {
      let query = "SELECT * FROM properties";
      const params = [];
      const conditions = [];
      if (id) {
        conditions.push("id = ?");
        params.push(id);
      }
      if (module_id) {
        conditions.push("module_id = ?");
        params.push(module_id);
      }
      if (conditions.length > 0) {
        query = query + " WHERE " + conditions.join(" AND ");
      }
      const results = await this.executeQuery("retrieve properties", query, params);
      return results.map(
        (prop) => new Property(
          prop.id,
          prop.package_id,
          prop.module_id,
          prop.parent_id,
          prop.name,
          new Date(prop.created_at),
          prop.type,
          prop.is_static,
          prop.is_readonly,
          prop.visibility
        )
      );
    } catch (error) {
      this.logger.error("Failed to retrieve property", error);
      throw new RepositoryError("Failed to retrieve property", "retrieve", this.errorTag, error);
    }
  }
  async delete(id) {
    try {
      await this.executeQuery("delete", "DELETE FROM properties WHERE id = ?", [id]);
    } catch (error) {
      this.logger.error("Failed to delete property", error);
      throw new RepositoryError("Failed to delete property", "delete", this.errorTag, error);
    }
  }
  /**
   * Batch-retrieve all properties for multiple parent IDs of a given type.
   * Returns a Map keyed by parent_id, each value is a Map<string, Property>.
   */
  async retrieveByParentIds(parentIds, parentType) {
    const result = /* @__PURE__ */ new Map();
    if (parentIds.length === 0) return result;
    for (const pid of parentIds) {
      result.set(pid, /* @__PURE__ */ new Map());
    }
    try {
      const placeholders = parentIds.map(() => "?").join(", ");
      const properties = await this.executeQuery(
        "retrieveByParentIds",
        `SELECT * FROM properties WHERE parent_id IN (${placeholders}) AND parent_type = ?`,
        [...parentIds, parentType]
      );
      for (const prop of properties) {
        const propObj = new Property(
          prop.id,
          prop.package_id,
          prop.module_id,
          prop.parent_id,
          prop.name,
          new Date(prop.created_at),
          prop.type,
          prop.is_static,
          prop.is_readonly,
          prop.visibility
        );
        const parentMap = result.get(prop.parent_id);
        if (parentMap) {
          parentMap.set(prop.id, propObj);
        }
      }
      return result;
    } catch (error) {
      this.logger.error("Failed to retrieve properties by parent IDs", error);
      throw new RepositoryError(
        "Failed to retrieve properties by parent IDs",
        "retrieveByParentIds",
        this.errorTag,
        error
      );
    }
  }
  async retrieveByParent(parentId, parentType) {
    try {
      const properties = await this.executeQuery(
        "retrieve properties",
        "SELECT * FROM properties WHERE parent_id = ? AND parent_type = ?",
        [parentId, parentType]
      );
      this.logger.debug(`Found ${properties.length.toString()} properties for ${parentType} ${parentId}`);
      const propertiesMap = /* @__PURE__ */ new Map();
      properties.forEach((prop) => {
        propertiesMap.set(
          prop.id,
          new Property(
            prop.id,
            prop.package_id,
            prop.module_id,
            prop.parent_id,
            prop.name,
            new Date(prop.created_at),
            prop.type,
            prop.is_static,
            prop.is_readonly,
            prop.visibility
          )
        );
      });
      return propertiesMap;
    } catch (error) {
      this.logger.error("Failed to retrieve properties by parent", error);
      throw new RepositoryError(
        "Failed to retrieve properties by parent",
        "retrieveByParent",
        this.errorTag,
        error
      );
    }
  }
};

// src/server/db/repositories/ClassRepository.ts
var ClassRepository = class extends BaseRepository {
  methodRepository;
  propertyRepository;
  constructor(adapter) {
    super(adapter, "[ClassRepository]", "classes");
    this.methodRepository = new MethodRepository(adapter);
    this.propertyRepository = new PropertyRepository(adapter);
  }
  /**
   * Batch-insert multiple classes at once. Ignores duplicates.
   */
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, module_id, name, extends_id)",
      5,
      items,
      (dto) => [dto.id, dto.package_id, dto.module_id, dto.name, dto.extends_id ?? null]
    );
  }
  async create(dto) {
    try {
      const results = await this.executeQuery(
        "create",
        "INSERT INTO classes (id, package_id, module_id, name, extends_id) VALUES (?, ?, ?, ?, ?) RETURNING *",
        [dto.id, dto.package_id, dto.module_id, dto.name, dto.extends_id ?? null]
      );
      if (results.length === 0) {
        throw new EntityNotFoundError("Class", dto.id, this.errorTag);
      }
      const cls = results[0];
      if (!cls) {
        throw new EntityNotFoundError("Class", dto.id, this.errorTag);
      }
      return new Class(
        cls.id,
        cls.package_id,
        cls.module_id,
        cls.name,
        new Date(cls.created_at),
        /* @__PURE__ */ new Map(),
        /* @__PURE__ */ new Map(),
        /* @__PURE__ */ new Map(),
        cls.extends_id ?? void 0
      );
    } catch (error) {
      this.logger.error("Failed to create class", error);
      throw new RepositoryError("Failed to create class", "create", this.errorTag, error);
    }
  }
  async update(id, dto) {
    try {
      const updates = [
        { field: "name", value: dto.name ?? void 0 },
        { field: "extends_id", value: dto.extends_id ?? void 0 }
      ];
      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);
      await this.executeQuery(
        "update",
        `UPDATE ${this.tableName} SET ${query} WHERE id = ?`,
        values
      );
      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError("Class", id, this.errorTag);
      }
      return result;
    } catch (error) {
      this.logger.error("Failed to update class", error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to update class", "update", this.errorTag, error);
    }
  }
  async retrieve(id, module_id) {
    try {
      const conditions = [];
      const params = [];
      if (id !== void 0) {
        conditions.push("c.id = ?");
        params.push(id);
      }
      if (module_id !== void 0) {
        conditions.push("c.module_id = ?");
        params.push(module_id);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const query = `
        SELECT c.* 
        FROM classes c
        ${whereClause}
      `.trim().replace(/\s+/g, " ");
      this.logger.debug("Executing retrieve query:", { query, params });
      const results = await this.executeQuery("retrieve", query, params);
      const ultimateClasses = await Promise.all(
        results.map(async (cls) => {
          try {
            this.logger.debug(`Processing class ${cls.id}`);
            const [methodsMap, propertiesMap] = await Promise.all([
              this.methodRepository.retrieveByParent(cls.id, "class"),
              this.propertyRepository.retrieveByParent(cls.id, "class")
            ]);
            const implementationsQuery = `
              SELECT i.* 
              FROM interfaces i 
              JOIN class_implements ci ON i.id = ci.interface_id 
              WHERE ci.class_id = ?
            `.trim().replace(/\s+/g, " ");
            this.logger.debug("Executing implementations query:", {
              query: implementationsQuery,
              params: [cls.id],
              classId: cls.id
            });
            const implementations = await this.executeQuery(
              "retrieve implementations",
              implementationsQuery,
              [cls.id]
            );
            this.logger.debug(`Found ${String(implementations.length)} implementations for class ${cls.id}`);
            const interfacesMap = /* @__PURE__ */ new Map();
            implementations.forEach((iface) => {
              interfacesMap.set(iface.id, {
                id: iface.id,
                package_id: iface.package_id,
                module_id: iface.module_id,
                name: iface.name,
                created_at: new Date(iface.created_at),
                methods: /* @__PURE__ */ new Map(),
                properties: /* @__PURE__ */ new Map(),
                extended_interfaces: /* @__PURE__ */ new Map()
              });
            });
            return new Class(
              cls.id,
              cls.package_id,
              cls.module_id,
              cls.name,
              new Date(cls.created_at),
              methodsMap,
              propertiesMap,
              interfacesMap,
              cls.extends_id ?? void 0
            );
          } catch (error) {
            if (error instanceof RepositoryError) {
              throw error;
            }
            throw new RepositoryError(`Failed to process class ${cls.id}`, "retrieve", this.errorTag, error);
          }
        })
      );
      return ultimateClasses.filter(Boolean);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to retrieve class", "retrieve", this.errorTag, error);
    }
  }
  async delete(id) {
    try {
      const relatedDeletions = [
        {
          operation: "delete implements",
          query: "DELETE FROM class_implements WHERE class_id = ?"
        },
        {
          operation: "delete methods",
          query: "DELETE FROM methods WHERE parent_id = ? AND parent_type = ?",
          additionalParams: ["class"]
        },
        {
          operation: "delete properties",
          query: "DELETE FROM properties WHERE parent_id = ? AND parent_type = ?",
          additionalParams: ["class"]
        }
      ];
      for (const deletion of relatedDeletions) {
        const params = [id, ...deletion.additionalParams ?? []];
        await this.executeQuery(deletion.operation, deletion.query, params);
      }
      await this.executeQuery("delete class", `DELETE FROM ${this.tableName} WHERE id = ?`, [id]);
    } catch (error) {
      this.logger.error("Failed to delete class", error);
      throw new RepositoryError("Failed to delete class", "delete", this.errorTag, error);
    }
  }
  async retrieveById(id) {
    const results = await this.retrieve(id);
    return results[0];
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
  async retrieveMethods(classId) {
    return this.methodRepository.retrieveByParent(classId, "class");
  }
  async retrieveProperties(classId) {
    return this.propertyRepository.retrieveByParent(classId, "class");
  }
  /**
   * Batch-retrieve all classes whose module_id is in the given list.
   * Returns raw rows (without hydrated methods/properties/interfaces) for
   * in-memory distribution by the caller.
   */
  async retrieveByModuleIds(moduleIds) {
    if (moduleIds.length === 0) return [];
    try {
      const placeholders = moduleIds.map(() => "?").join(", ");
      const results = await this.executeQuery(
        "retrieveByModuleIds",
        `SELECT c.* FROM classes c WHERE c.module_id IN (${placeholders})`,
        moduleIds
      );
      return results.map(
        (cls) => new Class(
          cls.id,
          cls.package_id,
          cls.module_id,
          cls.name,
          new Date(cls.created_at),
          /* @__PURE__ */ new Map(),
          /* @__PURE__ */ new Map(),
          /* @__PURE__ */ new Map(),
          cls.extends_id ?? void 0
        )
      );
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to retrieve classes by module IDs", "retrieveByModuleIds", this.errorTag, error);
    }
  }
  async createWithMethods(dto, methods) {
    try {
      const cls = await this.create(dto);
      if (methods.length > 0) {
        await Promise.all(
          methods.map(
            (method) => this.methodRepository.create({
              ...method,
              parent_id: cls.id,
              parent_type: "class"
            })
          )
        );
      }
      const result = await this.retrieveById(cls.id);
      if (!result) {
        throw new RepositoryError("Class not found after creation", "create", this.errorTag);
      }
      return result;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to create class with methods", "create", this.errorTag, error);
    }
  }
};

// src/shared/types/Enum.ts
var Enum = class {
  constructor(id, package_id, module_id, name, members = [], created_at = /* @__PURE__ */ new Date()) {
    this.id = id;
    this.package_id = package_id;
    this.module_id = module_id;
    this.name = name;
    this.members = members;
    this.created_at = created_at;
  }
};

// src/server/db/repositories/EnumRepository.ts
var EnumRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[EnumRepository]", "enums");
  }
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, module_id, name, members_json)",
      5,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.name,
        dto.members_json ?? null
      ]
    );
  }
  async create(dto) {
    const results = await this.executeQuery(
      "create",
      "INSERT INTO enums (id, package_id, module_id, name, members_json) VALUES (?, ?, ?, ?, ?) RETURNING *",
      [dto.id, dto.package_id, dto.module_id, dto.name, dto.members_json ?? null]
    );
    const row = results[0];
    if (!row) {
      throw new RepositoryError("Failed to create enum", "create", this.errorTag);
    }
    return this.mapToEntity(row);
  }
  async update(id, dto) {
    const sets = [];
    const params = [];
    if (dto.name !== void 0) {
      sets.push("name = ?");
      params.push(dto.name);
    }
    if (dto.members_json !== void 0) {
      sets.push("members_json = ?");
      params.push(dto.members_json);
    }
    if (sets.length === 0) {
      const existing = await this.retrieveById(id);
      if (!existing) throw new RepositoryError("Enum not found", "update", this.errorTag);
      return existing;
    }
    params.push(id);
    const results = await this.executeQuery(
      "update",
      `UPDATE enums SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
      params
    );
    const row = results[0];
    if (!row) throw new RepositoryError("Enum not found", "update", this.errorTag);
    return this.mapToEntity(row);
  }
  async retrieveById(id) {
    const results = await this.executeQuery(
      "retrieveById",
      "SELECT * FROM enums WHERE id = ?",
      [id]
    );
    const row = results[0];
    return row ? this.mapToEntity(row) : void 0;
  }
  async retrieveByModuleId(moduleId) {
    const results = await this.executeQuery(
      "retrieveByModuleId",
      "SELECT * FROM enums WHERE module_id = ? ORDER BY name",
      [moduleId]
    );
    return results.map((row) => this.mapToEntity(row));
  }
  async retrieveByModuleIds(moduleIds) {
    if (moduleIds.length === 0) return [];
    const placeholders = moduleIds.map(() => "?").join(", ");
    const results = await this.executeQuery(
      "retrieveByModuleIds",
      `SELECT * FROM enums WHERE module_id IN (${placeholders}) ORDER BY name`,
      moduleIds
    );
    return results.map((row) => this.mapToEntity(row));
  }
  async retrieve() {
    const results = await this.executeQuery(
      "retrieve all",
      "SELECT * FROM enums ORDER BY name"
    );
    return results.map((row) => this.mapToEntity(row));
  }
  async delete(id) {
    await this.executeQuery("delete", "DELETE FROM enums WHERE id = ?", [id]);
  }
  mapToEntity(row) {
    let members = [];
    if (row.members_json) {
      try {
        const parsed = JSON.parse(row.members_json);
        if (Array.isArray(parsed)) {
          members = parsed.filter((m) => typeof m === "string");
        }
      } catch {
      }
    }
    return new Enum(
      row.id,
      row.package_id,
      row.module_id,
      row.name,
      members,
      new Date(row.created_at)
    );
  }
};

// src/server/db/repositories/ExportRepository.ts
var ExportRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[ExportRepository]", "exports");
  }
  /**
   * Batch-insert multiple exports at once. Ignores duplicates.
   */
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, module_id, name, is_default)",
      5,
      items,
      (dto) => [dto.id, dto.package_id, dto.module_id, dto.name, dto.is_default]
    );
  }
  async create(dto) {
    try {
      const params = [dto.id, dto.package_id, dto.module_id, dto.name, dto.is_default];
      await this.executeQuery(
        "create",
        `
        INSERT INTO exports (id, package_id, module_id, name, is_default)
        VALUES (?, ?, ?, ?, ?)
      `,
        params
      );
      return dto;
    } catch (error) {
      throw new RepositoryError(
        `Failed to create export: ${error instanceof Error ? error.message : String(error)}`,
        "create",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async update(id, dto) {
    try {
      const updates = [];
      if (dto.name !== void 0) {
        updates.push({ field: "name", value: dto.name });
      }
      if (dto.is_default !== void 0) {
        updates.push({ field: "is_default", value: dto.is_default });
      }
      if (updates.length === 0) {
        throw new NoFieldsToUpdateError("Export", this.errorTag);
      }
      const { query, values } = this.buildUpdateQuery(updates);
      const params = [...values, id];
      await this.executeQuery("update", `UPDATE exports SET ${query} WHERE id = ?`, params);
      const updated = await this.retrieveById(id);
      if (!updated) {
        throw new EntityNotFoundError("Export", id, this.errorTag);
      }
      return updated;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        `Failed to update export: ${error instanceof Error ? error.message : String(error)}`,
        "update",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async retrieveById(id) {
    try {
      const results = await this.executeQuery("retrieveById", "SELECT * FROM exports WHERE id = ?", [id]);
      if (results.length === 0) {
        return void 0;
      }
      const row = results[0];
      if (!row) {
        return void 0;
      }
      return this.mapToEntity(row);
    } catch (error) {
      throw new RepositoryError(
        `Failed to retrieve export by id: ${error instanceof Error ? error.message : String(error)}`,
        "retrieveById",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
  async retrieve(id, module_id) {
    try {
      let query = "SELECT * FROM exports";
      const params = [];
      if (id !== void 0) {
        query += " WHERE id = ?";
        params.push(id);
      } else if (module_id !== void 0) {
        query += " WHERE module_id = ?";
        params.push(module_id);
      }
      const results = await this.executeQuery("retrieve", query, params);
      return results.map((row) => this.mapToEntity(row));
    } catch (error) {
      throw new RepositoryError(
        `Failed to retrieve exports: ${error instanceof Error ? error.message : String(error)}`,
        "retrieve",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async delete(id) {
    try {
      await this.executeQuery("delete", "DELETE FROM exports WHERE id = ?", [id]);
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete export: ${error instanceof Error ? error.message : String(error)}`,
        "delete",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async findByModuleId(moduleId) {
    return this.retrieveByModuleId(moduleId);
  }
  mapToEntity(row) {
    return {
      id: row.id,
      package_id: row.package_id,
      module_id: row.module_id,
      name: row.name,
      is_default: row.is_default
    };
  }
};

// src/shared/types/Function.ts
var ModuleFunction = class {
  constructor(id, package_id, module_id, name, created_at = /* @__PURE__ */ new Date(), parameters = /* @__PURE__ */ new Map(), return_type = "void", is_async = false, is_exported = false) {
    this.id = id;
    this.package_id = package_id;
    this.module_id = module_id;
    this.name = name;
    this.created_at = created_at;
    this.parameters = parameters;
    this.return_type = return_type;
    this.is_async = is_async;
    this.is_exported = is_exported;
  }
};

// src/server/db/repositories/FunctionRepository.ts
var FunctionRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[FunctionRepository]", "functions");
  }
  /**
   * Batch-insert multiple functions at once. Ignores duplicates.
   */
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, module_id, name, return_type, is_async, is_exported)",
      7,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.name,
        dto.return_type ?? null,
        dto.is_async ?? false,
        dto.is_exported ?? false
      ]
    );
  }
  async create(dto) {
    try {
      const results = await this.executeQuery(
        "create",
        "INSERT INTO functions (id, package_id, module_id, name, return_type, is_async, is_exported) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
        [
          dto.id,
          dto.package_id,
          dto.module_id,
          dto.name,
          dto.return_type ?? null,
          dto.is_async ?? false,
          dto.is_exported ?? false
        ]
      );
      if (results.length === 0) {
        throw new EntityNotFoundError("Function", dto.id, this.errorTag);
      }
      const func = results[0];
      if (!func) {
        throw new EntityNotFoundError("Function", dto.id, this.errorTag);
      }
      return new ModuleFunction(
        func.id,
        func.package_id,
        func.module_id,
        func.name,
        new Date(func.created_at),
        /* @__PURE__ */ new Map(),
        func.return_type ?? "void",
        func.is_async === "true" || func.is_async === "1",
        func.is_exported === "true" || func.is_exported === "1"
      );
    } catch (error) {
      this.logger.error("Failed to create function", error);
      throw new RepositoryError("Failed to create function", "create", this.errorTag, error);
    }
  }
  async update(id, dto) {
    try {
      const sets = [];
      const params = [];
      if (dto.name !== void 0) {
        sets.push("name = ?");
        params.push(dto.name);
      }
      if (dto.return_type !== void 0) {
        sets.push("return_type = ?");
        params.push(dto.return_type);
      }
      if (dto.is_async !== void 0) {
        sets.push("is_async = ?");
        params.push(dto.is_async);
      }
      if (dto.is_exported !== void 0) {
        sets.push("is_exported = ?");
        params.push(dto.is_exported);
      }
      if (sets.length === 0) {
        const existing = await this.findById(id);
        if (!existing) {
          throw new EntityNotFoundError("Function", id, this.errorTag);
        }
        return existing;
      }
      params.push(id);
      const results = await this.executeQuery(
        "update",
        `UPDATE functions SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
        params
      );
      if (results.length === 0) {
        throw new EntityNotFoundError("Function", id, this.errorTag);
      }
      const func = results[0];
      if (!func) {
        throw new EntityNotFoundError("Function", id, this.errorTag);
      }
      return new ModuleFunction(
        func.id,
        func.package_id,
        func.module_id,
        func.name,
        new Date(func.created_at),
        /* @__PURE__ */ new Map(),
        func.return_type ?? "void",
        func.is_async === "true" || func.is_async === "1",
        func.is_exported === "true" || func.is_exported === "1"
      );
    } catch (error) {
      this.logger.error("Failed to update function", error);
      throw new RepositoryError("Failed to update function", "update", this.errorTag, error);
    }
  }
  async findById(id) {
    try {
      const results = await this.executeQuery(
        "find by id",
        "SELECT * FROM functions WHERE id = ?",
        [id]
      );
      if (results.length === 0) {
        return void 0;
      }
      const func = results[0];
      if (!func) {
        return void 0;
      }
      return new ModuleFunction(
        func.id,
        func.package_id,
        func.module_id,
        func.name,
        new Date(func.created_at),
        /* @__PURE__ */ new Map(),
        func.return_type ?? "void",
        func.is_async === "true" || func.is_async === "1",
        func.is_exported === "true" || func.is_exported === "1"
      );
    } catch (error) {
      this.logger.error("Failed to find function by id", error);
      throw new RepositoryError("Failed to find function by id", "findById", this.errorTag, error);
    }
  }
  async findByModuleId(moduleId) {
    try {
      const results = await this.executeQuery(
        "find by module id",
        "SELECT * FROM functions WHERE module_id = ? ORDER BY name",
        [moduleId]
      );
      return results.map(
        (func) => new ModuleFunction(
          func.id,
          func.package_id,
          func.module_id,
          func.name,
          new Date(func.created_at),
          /* @__PURE__ */ new Map(),
          func.return_type ?? "void",
          func.is_async === "true" || func.is_async === "1",
          func.is_exported === "true" || func.is_exported === "1"
        )
      );
    } catch (error) {
      this.logger.error("Failed to find functions by module id", error);
      throw new RepositoryError(
        "Failed to find functions by module id",
        "findByModuleId",
        this.errorTag,
        error
      );
    }
  }
  async retrieveByModuleIds(moduleIds) {
    if (moduleIds.length === 0) return [];
    try {
      const placeholders = moduleIds.map(() => "?").join(", ");
      const results = await this.executeQuery(
        "retrieveByModuleIds",
        `SELECT * FROM functions WHERE module_id IN (${placeholders}) ORDER BY name`,
        moduleIds
      );
      return results.map((row) => this.mapToEntity(row));
    } catch (error) {
      this.logger.error("Failed to retrieve functions by module IDs", error);
      throw new RepositoryError(
        "Failed to retrieve functions by module IDs",
        "retrieveByModuleIds",
        this.errorTag,
        error
      );
    }
  }
  async delete(id) {
    try {
      await this.executeQuery("delete", "DELETE FROM functions WHERE id = ?", [id]);
    } catch (error) {
      this.logger.error("Failed to delete function", error);
      throw new RepositoryError("Failed to delete function", "delete", this.errorTag, error);
    }
  }
  mapToEntity(row) {
    return new ModuleFunction(
      row.id,
      row.package_id,
      row.module_id,
      row.name,
      new Date(row.created_at),
      /* @__PURE__ */ new Map(),
      row.return_type ?? "void",
      row.is_async === "true" || row.is_async === "1",
      row.is_exported === "true" || row.is_exported === "1"
    );
  }
  // Aliases for BaseRepository compatibility
  async retrieveById(id) {
    return this.findById(id);
  }
  async retrieveByModuleId(moduleId) {
    return this.findByModuleId(moduleId);
  }
  async retrieve() {
    const results = await this.executeQuery(
      "retrieve all",
      "SELECT * FROM functions ORDER BY name"
    );
    return results.map((row) => this.mapToEntity(row));
  }
};

// src/server/db/repositories/ImportRepository.ts
var ImportRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[ImportRepository]", "imports");
  }
  /**
   * Batch-insert multiple imports at once. Ignores duplicates.
   */
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, module_id, source, specifiers_json)",
      5,
      items,
      (dto) => [dto.id, dto.package_id, dto.module_id, dto.source, dto.specifiers_json ?? null]
    );
  }
  async create(dto) {
    try {
      const params = [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.source,
        dto.specifiers_json ?? null
      ];
      await this.executeQuery(
        "create",
        `
        INSERT INTO imports (id, package_id, module_id, source, specifiers_json)
        VALUES (?, ?, ?, ?, ?)
      `,
        params
      );
      return dto;
    } catch (error) {
      throw new RepositoryError(
        `Failed to create import: ${error instanceof Error ? error.message : String(error)}`,
        "create",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async update(id, dto) {
    try {
      const updates = [];
      if (dto.source !== void 0) {
        updates.push({ field: "source", value: dto.source });
      }
      if (dto.specifiers_json !== void 0) {
        updates.push({ field: "specifiers_json", value: dto.specifiers_json });
      }
      if (updates.length === 0) {
        throw new NoFieldsToUpdateError("Import", this.errorTag);
      }
      const { query, values } = this.buildUpdateQuery(updates);
      const params = [...values, id];
      await this.executeQuery("update", `UPDATE imports SET ${query} WHERE id = ?`, params);
      const updated = await this.retrieveById(id);
      if (!updated) {
        throw new EntityNotFoundError("Import", id, this.errorTag);
      }
      return updated;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        `Failed to update import: ${error instanceof Error ? error.message : String(error)}`,
        "update",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async retrieveById(id) {
    try {
      const results = await this.executeQuery("retrieveById", "SELECT * FROM imports WHERE id = ?", [id]);
      if (results.length === 0) {
        return void 0;
      }
      const row = results[0];
      if (!row) {
        return void 0;
      }
      return this.mapToEntity(row);
    } catch (error) {
      throw new RepositoryError(
        `Failed to retrieve import by id: ${error instanceof Error ? error.message : String(error)}`,
        "retrieveById",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
  async retrieve(id, module_id) {
    try {
      let query = "SELECT * FROM imports";
      const params = [];
      if (id !== void 0) {
        query += " WHERE id = ?";
        params.push(id);
      } else if (module_id !== void 0) {
        query += " WHERE module_id = ?";
        params.push(module_id);
      }
      const results = await this.executeQuery("retrieve", query, params);
      return results.map((row) => this.mapToEntity(row));
    } catch (error) {
      throw new RepositoryError(
        `Failed to retrieve imports: ${error instanceof Error ? error.message : String(error)}`,
        "retrieve",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async delete(id) {
    try {
      await this.executeQuery("delete", "DELETE FROM imports WHERE id = ?", [id]);
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete import: ${error instanceof Error ? error.message : String(error)}`,
        "delete",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async findByModuleId(moduleId) {
    return this.retrieveByModuleId(moduleId);
  }
  /**
   * Batch-retrieve all imports whose module_id is in the given list.
   */
  async retrieveByModuleIds(moduleIds) {
    if (moduleIds.length === 0) return [];
    try {
      const placeholders = moduleIds.map(() => "?").join(", ");
      const results = await this.executeQuery(
        "retrieveByModuleIds",
        `SELECT * FROM imports WHERE module_id IN (${placeholders})`,
        moduleIds
      );
      return results.map((row) => this.mapToEntity(row));
    } catch (error) {
      throw new RepositoryError(
        `Failed to retrieve imports by module IDs: ${error instanceof Error ? error.message : String(error)}`,
        "retrieveByModuleIds",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  mapToEntity(row) {
    return {
      id: row.id,
      package_id: row.package_id,
      module_id: row.module_id,
      source: row.source,
      specifiers_json: row.specifiers_json ?? void 0
    };
  }
};

// src/shared/types/Interface.ts
var Interface = class {
  constructor(id, package_id, module_id, name, created_at = /* @__PURE__ */ new Date(), methods = /* @__PURE__ */ new Map(), properties = /* @__PURE__ */ new Map(), extended_interfaces = /* @__PURE__ */ new Map()) {
    this.id = id;
    this.package_id = package_id;
    this.module_id = module_id;
    this.name = name;
    this.created_at = created_at;
    this.methods = methods;
    this.properties = properties;
    this.extended_interfaces = extended_interfaces;
  }
};

// src/server/db/repositories/InterfaceRepository.ts
var InterfaceRepository = class extends BaseRepository {
  methodRepository;
  propertyRepository;
  constructor(adapter) {
    super(adapter, "[InterfaceRepository]", "interfaces");
    this.methodRepository = new MethodRepository(adapter);
    this.propertyRepository = new PropertyRepository(adapter);
  }
  /**
   * Batch-insert multiple interfaces at once. Ignores duplicates.
   */
  async createBatch(items) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await this.executeBatchInsert(
      "(id, package_id, module_id, name, created_at)",
      5,
      items,
      (dto) => [dto.id, dto.package_id, dto.module_id, dto.name, now]
    );
  }
  async create(dto) {
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const results = await this.executeQuery(
        "create",
        "INSERT INTO interfaces (id, package_id, module_id, name, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *",
        [String(dto.id), String(dto.package_id), String(dto.module_id), String(dto.name), now]
      );
      if (results.length === 0) {
        throw new RepositoryError("Interface not created", "create", this.errorTag);
      }
      const iface = results[0];
      if (!iface) {
        throw new RepositoryError("Interface not created", "create", this.errorTag);
      }
      return new Interface(
        String(iface.id),
        String(iface.package_id),
        String(iface.module_id),
        String(iface.name),
        new Date(String(iface.created_at)),
        /* @__PURE__ */ new Map(),
        /* @__PURE__ */ new Map(),
        /* @__PURE__ */ new Map()
      );
    } catch (error) {
      if (!(error instanceof RepositoryError)) {
        this.logger.error(`Failed to create interface: ${dto.name}`, error);
      }
      throw new RepositoryError("Failed to create interface", "create", this.errorTag, error);
    }
  }
  async update(id, dto) {
    try {
      const updates = [{ field: "name", value: dto.name ?? void 0 }];
      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);
      await this.executeQuery(
        "update",
        `UPDATE ${this.tableName} SET ${query} WHERE id = ?`,
        values
      );
      const result = await this.retrieveById(id);
      if (!result) {
        throw new RepositoryError("Interface not found", "update", this.errorTag, new Error("Interface not found"));
      }
      return result;
    } catch (error) {
      if (!(error instanceof RepositoryError)) {
        this.logger.error(`Failed to update interface: ${id}`, error);
      }
      throw new RepositoryError("Failed to update interface", "update", this.errorTag, error);
    }
  }
  async retrieve(id, module_id) {
    try {
      const conditions = [];
      const params = [];
      if (id !== void 0) {
        conditions.push("i.id = ?");
        params.push(String(id));
      }
      if (module_id !== void 0) {
        conditions.push("i.module_id = ?");
        params.push(String(module_id));
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const query = `
        SELECT i.* 
        FROM interfaces i
        ${whereClause}
      `.trim().replace(/\s+/g, " ");
      this.logger.debug("Executing retrieve query:", { query, params });
      const results = await this.executeQuery("retrieve", query, params);
      const supremeInterfaces = await Promise.all(
        results.map(async (iface) => {
          try {
            this.logger.debug(`Processing interface ${iface.id}`);
            const [methodsMap, propertiesMap] = await Promise.all([
              this.methodRepository.retrieveByParent(String(iface.id), "interface"),
              this.propertyRepository.retrieveByParent(String(iface.id), "interface")
            ]);
            const extendedInterfaces = await this.executeQuery(
              "retrieve extended",
              `SELECT i.* FROM interfaces i 
               JOIN interface_extends ie ON i.id = ie.extended_id 
               WHERE ie.interface_id = ?`,
              [String(iface.id)]
            );
            this.logger.debug(
              `Found ${String(extendedInterfaces.length)} extended interfaces for interface ${iface.id}`
            );
            const extendedMap = /* @__PURE__ */ new Map();
            extendedInterfaces.forEach((extended) => {
              extendedMap.set(String(extended.id), {
                id: String(extended.id),
                package_id: String(extended.package_id),
                module_id: String(extended.module_id),
                name: String(extended.name),
                created_at: new Date(String(extended.created_at)),
                methods: /* @__PURE__ */ new Map(),
                properties: /* @__PURE__ */ new Map(),
                extended_interfaces: /* @__PURE__ */ new Map()
              });
            });
            return new Interface(
              String(iface.id),
              String(iface.package_id),
              String(iface.module_id),
              String(iface.name),
              new Date(String(iface.created_at)),
              methodsMap,
              propertiesMap,
              extendedMap
            );
          } catch (error) {
            if (error instanceof RepositoryError) {
              throw error;
            }
            throw new RepositoryError(
              `Failed to process interface ${iface.id}`,
              "retrieve",
              this.errorTag,
              error
            );
          }
        })
      );
      return supremeInterfaces;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to retrieve interfaces", "retrieve", this.errorTag, error);
    }
  }
  async delete(id) {
    try {
      await this.executeQuery(
        "delete methods",
        "DELETE FROM methods WHERE parent_id = ? AND parent_type = ?",
        [id, "interface"]
      );
      await this.executeQuery(
        "delete properties",
        "DELETE FROM properties WHERE parent_id = ? AND parent_type = ?",
        [id, "interface"]
      );
      await this.executeQuery("delete interface", "DELETE FROM interfaces WHERE id = ?", [id]);
    } catch (error) {
      if (!(error instanceof RepositoryError)) {
        this.logger.error(`Failed to delete interface: ${id}`, error);
      }
      throw new RepositoryError("Failed to delete interface", "delete", this.errorTag, error);
    }
  }
  async retrieveById(id) {
    const results = await this.retrieve(id);
    return results[0];
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
  async retrieveMethods(interfaceId) {
    return this.methodRepository.retrieveByParent(interfaceId, "interface");
  }
  async retrieveProperties(interfaceId) {
    return this.propertyRepository.retrieveByParent(interfaceId, "interface");
  }
  /**
   * Batch-retrieve all interfaces whose module_id is in the given list.
   * Returns lightweight rows (without hydrated methods/properties/extended interfaces)
   * for in-memory distribution by the caller.
   */
  async retrieveByModuleIds(moduleIds) {
    if (moduleIds.length === 0) return [];
    try {
      const placeholders = moduleIds.map(() => "?").join(", ");
      const results = await this.executeQuery(
        "retrieveByModuleIds",
        `SELECT i.* FROM interfaces i WHERE i.module_id IN (${placeholders})`,
        moduleIds
      );
      return results.map(
        (iface) => new Interface(
          iface.id,
          iface.package_id,
          iface.module_id,
          iface.name,
          new Date(iface.created_at),
          /* @__PURE__ */ new Map(),
          /* @__PURE__ */ new Map(),
          /* @__PURE__ */ new Map()
        )
      );
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to retrieve interfaces by module IDs", "retrieveByModuleIds", this.errorTag, error);
    }
  }
  async createWithMethods(dto, methods) {
    try {
      const iface = await this.create(dto);
      if (methods.length > 0) {
        await Promise.all(
          methods.map(
            (method) => this.methodRepository.create({
              ...method,
              parent_id: iface.id,
              parent_type: "interface"
            })
          )
        );
      }
      const result = await this.retrieveById(iface.id);
      if (!result) {
        throw new RepositoryError("Interface not found after creation", "create", this.errorTag);
      }
      return result;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to create interface with methods", "create", this.errorTag, error);
    }
  }
};

// src/shared/types/Module.ts
var Module = class {
  constructor(id, package_id, name, source, created_at = /* @__PURE__ */ new Date(), classes = /* @__PURE__ */ new Map(), interfaces = /* @__PURE__ */ new Map(), imports = /* @__PURE__ */ new Map(), exports = /* @__PURE__ */ new Map(), packages = /* @__PURE__ */ new Map(), typeAliases = /* @__PURE__ */ new Map(), enums = /* @__PURE__ */ new Map(), functions = /* @__PURE__ */ new Map(), variables = /* @__PURE__ */ new Map(), referencePaths = [], symbol_references = /* @__PURE__ */ new Map()) {
    this.id = id;
    this.package_id = package_id;
    this.name = name;
    this.source = source;
    this.created_at = created_at;
    this.classes = classes;
    this.interfaces = interfaces;
    this.imports = imports;
    this.exports = exports;
    this.packages = packages;
    this.typeAliases = typeAliases;
    this.enums = enums;
    this.functions = functions;
    this.variables = variables;
    this.referencePaths = referencePaths;
    this.symbol_references = symbol_references;
  }
  /**
   * The UUID namespace for generating unique identifiers for Module instances.
   */
  static UUID_NAMESPACE = "e32ec4a1-3efb-4393-a5a6-00a82d336089";
};

// src/server/db/repositories/ModuleRepository.ts
var ModuleRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[ModuleRepository]", "modules");
  }
  /**
   * Batch-insert multiple modules at once. Ignores duplicates.
   */
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, name, source, directory, filename, relative_path, is_barrel)",
      8,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.name,
        JSON.stringify(dto.source),
        dto.source.directory,
        dto.source.filename,
        dto.source.relativePath,
        Boolean(dto.source.isBarrel ?? false) ? 1 : 0
      ]
    );
  }
  async create(dto) {
    try {
      const results = await this.executeQuery(
        "create",
        `INSERT INTO modules (
          id, package_id, name, source, directory, filename, relative_path, is_barrel
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        [
          dto.id,
          dto.package_id,
          dto.name,
          JSON.stringify(dto.source),
          // Serialize FileLocation
          dto.source.directory,
          dto.source.filename,
          dto.source.relativePath,
          Boolean(dto.source.isBarrel ?? false) ? 1 : 0
        ]
      );
      if (results.length === 0) {
        throw new EntityNotFoundError("Module", dto.id, this.errorTag);
      }
      const mod = results[0];
      if (!mod) {
        throw new EntityNotFoundError("Module", dto.id, this.errorTag);
      }
      return this.createModuleFromRow(mod);
    } catch (error) {
      this.logger.error("Failed to create module", error);
      throw new RepositoryError("Failed to create module", "create", this.errorTag, error);
    }
  }
  async update(id, dto) {
    try {
      const updates = [
        { field: "name", value: dto.name ?? void 0 },
        { field: "source", value: dto.source ? JSON.stringify(dto.source) : void 0 }
      ];
      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);
      await this.executeQuery("update", `UPDATE ${this.tableName} SET ${query} WHERE id = ?`, values);
      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError("Module", id, this.errorTag);
      }
      return result;
    } catch (error) {
      this.logger.error("Failed to update module", error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to update module", "update", this.errorTag, error);
    }
  }
  createModuleFromRow(mod) {
    let source;
    if (mod.source && typeof mod.source === "string" && mod.source !== "undefined" && mod.source !== "null") {
      try {
        source = JSON.parse(mod.source);
      } catch (error) {
        this.logger.warn(`Failed to parse source JSON for module ${mod.id}, creating fallback`, error);
        source = {
          directory: String(mod["directory"] ?? ""),
          name: String(mod.name),
          filename: String(mod["filename"] ?? ""),
          relativePath: String(mod["relative_path"] ?? "")
        };
      }
    } else {
      source = {
        directory: String(mod["directory"] ?? ""),
        name: String(mod.name),
        filename: String(mod["filename"] ?? ""),
        relativePath: String(mod["relative_path"] ?? "")
      };
    }
    return new Module(
      String(mod.id),
      String(mod.package_id),
      String(mod.name),
      source,
      new Date(String(mod.created_at)),
      /* @__PURE__ */ new Map(),
      // classes
      /* @__PURE__ */ new Map(),
      // interfaces
      /* @__PURE__ */ new Map(),
      // imports
      /* @__PURE__ */ new Map(),
      // exports
      /* @__PURE__ */ new Map(),
      // packages
      /* @__PURE__ */ new Map(),
      // typeAliases
      /* @__PURE__ */ new Map(),
      // enums
      /* @__PURE__ */ new Map(),
      // functions
      /* @__PURE__ */ new Map(),
      // variables
      []
      // referencePaths
    );
  }
  async retrieve(id, module_id) {
    try {
      let query = "SELECT * FROM modules";
      const params = [];
      const conditions = [];
      if (id !== void 0) {
        conditions.push("id = ?");
        params.push(id);
      }
      if (module_id !== void 0) {
        conditions.push("package_id = ?");
        params.push(module_id);
      }
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      const results = await this.executeQuery("retrieve", query, params);
      return results.map((mod) => this.createModuleFromRow(mod));
    } catch (error) {
      this.logger.error("Failed to retrieve module", error);
      throw new RepositoryError("Failed to retrieve module", "retrieve", this.errorTag, error);
    }
  }
  async retrieveById(id) {
    const results = await this.retrieve(id);
    return results[0];
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
  async retrieveAll(packageId) {
    try {
      const query = packageId ? "SELECT * FROM modules WHERE package_id = ?" : "SELECT * FROM modules";
      const params = packageId ? [packageId] : [];
      const results = await this.executeQuery("retrieveAll", query, params);
      return results.map((mod) => this.createModuleFromRow(mod));
    } catch (error) {
      this.logger.error("Failed to retrieve all modules", error);
      throw new RepositoryError("Failed to retrieve all modules", "retrieveAll", this.errorTag, error);
    }
  }
  async delete(id) {
    try {
      await this.executeQuery("delete module tests", "DELETE FROM module_tests WHERE module_id = ?", [id]);
      await this.executeQuery("delete classes", "DELETE FROM classes WHERE module_id = ?", [id]);
      await this.executeQuery("delete interfaces", "DELETE FROM interfaces WHERE module_id = ?", [id]);
      await this.executeQuery("delete methods", "DELETE FROM methods WHERE module_id = ?", [id]);
      await this.executeQuery("delete properties", "DELETE FROM properties WHERE module_id = ?", [id]);
      await this.executeQuery("delete parameters", "DELETE FROM parameters WHERE module_id = ?", [id]);
      await this.executeQuery("delete imports", "DELETE FROM imports WHERE module_id = ?", [id]);
      await this.executeQuery("delete type_aliases", "DELETE FROM type_aliases WHERE module_id = ?", [id]);
      await this.executeQuery("delete enums", "DELETE FROM enums WHERE module_id = ?", [id]);
      await this.executeQuery("delete variables", "DELETE FROM variables WHERE module_id = ?", [id]);
      await this.executeQuery("delete module", "DELETE FROM modules WHERE id = ?", [id]);
    } catch (error) {
      this.logger.error("Failed to delete module", error);
      throw new RepositoryError("Failed to delete module", "delete", this.errorTag, error);
    }
  }
};

// src/shared/types/Package.ts
var Package = class {
  constructor(id, name, version, path, created_at = /* @__PURE__ */ new Date(), dependencies = /* @__PURE__ */ new Map(), devDependencies = /* @__PURE__ */ new Map(), peerDependencies = /* @__PURE__ */ new Map(), modules = /* @__PURE__ */ new Map()) {
    this.id = id;
    this.name = name;
    this.version = version;
    this.path = path;
    this.created_at = created_at;
    this.dependencies = dependencies;
    this.devDependencies = devDependencies;
    this.peerDependencies = peerDependencies;
    this.modules = modules;
  }
};

// src/server/db/repositories/DependencyRepository.ts
function isValidDependencyDTO(dto) {
  if (!dto || typeof dto !== "object") {
    return false;
  }
  const record = dto;
  return typeof record.source_id === "string" && typeof record.target_id === "string" && typeof record.type === "string" && ["dependency", "devDependency", "peerDependency"].includes(record.type);
}
var DependencyRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[DependencyRepository]", "dependencies");
  }
  async create(dto) {
    try {
      if (!isValidDependencyDTO(dto)) {
        throw new RepositoryError("Invalid dependency data", "create", this.errorTag);
      }
      const id = `${dto.source_id}_${dto.target_id}`;
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const params = [id, dto.source_id, dto.target_id, dto.type, now];
      await this.executeQuery(
        "create",
        "INSERT INTO dependencies (id, source_id, target_id, type, created_at) VALUES (?, ?, ?, ?, ?)",
        params
      );
      return {
        id,
        source_id: dto.source_id,
        target_id: dto.target_id,
        type: dto.type,
        created_at: new Date(now)
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes("foreign key constraint")) {
        this.logger.error("Failed to create dependency", error);
      }
      throw new RepositoryError("Failed to create dependency", "create", this.errorTag, error);
    }
  }
  async update(id, dto) {
    try {
      const updates = [{ field: "type", value: dto.type ?? void 0 }];
      if (updates.every((update) => update.value === void 0)) {
        throw new NoFieldsToUpdateError("Dependency", this.errorTag);
      }
      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);
      await this.executeQuery("update", `UPDATE ${this.tableName} SET ${query} WHERE id = ?`, values);
      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError("Dependency", id, this.errorTag);
      }
      return result;
    } catch (error) {
      this.logger.error("Failed to update dependency", error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to update dependency", "update", this.errorTag, error);
    }
  }
  async retrieve(id, module_id) {
    try {
      let query = "SELECT * FROM dependencies";
      const params = [];
      const conditions = [];
      if (id) {
        conditions.push("id = ?");
        params.push(id);
      }
      if (module_id) {
        conditions.push("module_id = ?");
        params.push(module_id);
      }
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      const results = await this.executeQuery("retrieve", query, params);
      const dependencies = [];
      for (const dep of results) {
        dependencies.push({
          id: String(dep.id),
          source_id: String(dep.source_id),
          target_id: String(dep.target_id),
          type: dep.type,
          created_at: new Date(String(dep.created_at))
        });
      }
      return dependencies;
    } catch (error) {
      this.logger.error("Failed to retrieve dependency", error);
      throw new RepositoryError("Failed to retrieve dependency", "retrieve", this.errorTag, error);
    }
  }
  async delete(id) {
    try {
      await this.executeQuery("delete", "DELETE FROM dependencies WHERE id = ?", [id]);
    } catch (error) {
      this.logger.error("Failed to delete dependency", error);
      throw new RepositoryError("Failed to delete dependency", "delete", this.errorTag, error);
    }
  }
  async findBySourceId(sourceId) {
    try {
      const results = await this.executeQuery(
        "findBySourceId",
        "SELECT * FROM dependencies WHERE source_id = ?",
        [sourceId]
      );
      return results.map((dep) => ({
        id: String(dep.id),
        source_id: String(dep.source_id),
        target_id: String(dep.target_id),
        type: dep.type,
        created_at: new Date(String(dep.created_at))
      }));
    } catch (error) {
      this.logger.error("Failed to find dependencies by source (returning empty set)", error);
      return [];
    }
  }
  async findByTargetId(targetId) {
    try {
      const results = await this.executeQuery(
        "findByTargetId",
        "SELECT * FROM dependencies WHERE target_id = ?",
        [targetId]
      );
      return results.map((dep) => ({
        id: String(dep.id),
        source_id: String(dep.source_id),
        target_id: String(dep.target_id),
        type: dep.type,
        created_at: new Date(String(dep.created_at))
      }));
    } catch (error) {
      this.logger.error("Failed to find dependencies by target (returning empty set)", error);
      return [];
    }
  }
  async retrieveById(id) {
    const results = await this.retrieve(id);
    return results[0];
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
};

// src/server/db/repositories/PackageRepository.ts
var PackageRepository = class extends BaseRepository {
  dependencyRepository;
  constructor(adapter) {
    super(adapter, "[PackageRepository]", "packages");
    this.dependencyRepository = new DependencyRepository(adapter);
  }
  async create(dto) {
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const results = await this.executeQuery(
        "create",
        "INSERT INTO packages (id, name, version, path, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *",
        [dto.id, dto.name, dto.version, dto.path, now]
      );
      if (results.length === 0) {
        throw new EntityNotFoundError("Package", dto.id, this.errorTag);
      }
      if (dto.dependencies) {
        for (const dependencyId of dto.dependencies.values()) {
          if (dependencyId !== dto.id) {
            try {
              await this.dependencyRepository.create({
                source_id: dto.id,
                target_id: dependencyId,
                type: "dependency"
              });
            } catch {
            }
          }
        }
      }
      if (dto.devDependencies) {
        for (const dependencyId of dto.devDependencies.values()) {
          if (dependencyId !== dto.id) {
            try {
              await this.dependencyRepository.create({
                source_id: dto.id,
                target_id: dependencyId,
                type: "devDependency"
              });
            } catch {
            }
          }
        }
      }
      if (dto.peerDependencies) {
        for (const dependencyId of dto.peerDependencies.values()) {
          if (dependencyId !== dto.id) {
            try {
              await this.dependencyRepository.create({
                source_id: dto.id,
                target_id: dependencyId,
                type: "peerDependency"
              });
            } catch {
            }
          }
        }
      }
      const pkg = results[0];
      if (!pkg) {
        throw new EntityNotFoundError("Package", dto.id, this.errorTag);
      }
      return new Package(
        pkg.id,
        pkg.name,
        pkg.version,
        pkg.path,
        new Date(pkg.created_at),
        /* @__PURE__ */ new Map(),
        /* @__PURE__ */ new Map(),
        /* @__PURE__ */ new Map(),
        /* @__PURE__ */ new Map()
      );
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to create package", "create", this.errorTag, error);
    }
  }
  async update(id, dto) {
    try {
      const updates = [];
      const values = [];
      if (dto.name !== void 0) {
        updates.push("name = ?");
        values.push(dto.name);
      }
      if (dto.version !== void 0) {
        updates.push("version = ?");
        values.push(dto.version);
      }
      if (dto.path !== void 0) {
        updates.push("path = ?");
        values.push(dto.path);
      }
      if (updates.length === 0) {
        throw new NoFieldsToUpdateError("Package", this.errorTag);
      }
      values.push(id);
      await this.executeQuery("update", `UPDATE packages SET ${updates.join(", ")} WHERE id = ?`, values);
      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError("Package", id, this.errorTag);
      }
      return result;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to update package", "update", this.errorTag, error);
    }
  }
  async createPackageWithDependencies(pkg) {
    try {
      const dependencyRows = await this.dependencyRepository.findBySourceId(pkg.id);
      const dependencies = /* @__PURE__ */ new Map();
      const devDependencies = /* @__PURE__ */ new Map();
      const peerDependencies = /* @__PURE__ */ new Map();
      for (const row of dependencyRows) {
        const placeholder = new Package(String(row.target_id), "", "", "", /* @__PURE__ */ new Date());
        switch (row.type) {
          case "dependency":
            dependencies.set(placeholder.id, placeholder);
            break;
          case "devDependency":
            devDependencies.set(placeholder.id, placeholder);
            break;
          case "peerDependency":
            peerDependencies.set(placeholder.id, placeholder);
            break;
        }
      }
      return new Package(
        String(pkg.id),
        String(pkg.name),
        String(pkg.version),
        String(pkg.path),
        new Date(String(pkg.created_at)),
        dependencies,
        devDependencies,
        peerDependencies,
        /* @__PURE__ */ new Map()
      );
    } catch (error) {
      this.logger.error("Dependency hydration failed, returning package without dependencies", error);
      return new Package(
        String(pkg.id),
        String(pkg.name),
        String(pkg.version),
        String(pkg.path),
        new Date(String(pkg.created_at)),
        /* @__PURE__ */ new Map(),
        /* @__PURE__ */ new Map(),
        /* @__PURE__ */ new Map(),
        /* @__PURE__ */ new Map()
      );
    }
  }
  async retrieveById(id) {
    const results = await this.retrieve(id);
    return results[0];
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
  async retrieve(id, module_id) {
    try {
      let query = "SELECT * FROM packages";
      const params = [];
      const conditions = [];
      if (id) {
        conditions.push("id = ?");
        params.push(id);
      }
      if (module_id) {
        conditions.push("module_id = ?");
        params.push(module_id);
      }
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      const results = await this.executeQuery("retrieve", query, params);
      const packages = [];
      for (const pkg of results) {
        packages.push(await this.createPackageWithDependencies(pkg));
      }
      return packages;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to retrieve package", "retrieve", this.errorTag, error);
    }
  }
  async delete(id) {
    try {
      await this.executeQuery(
        "delete dependencies",
        "DELETE FROM dependencies WHERE source_id = ? OR target_id = ?",
        [id, id]
      );
      await this.executeQuery("delete package", "DELETE FROM packages WHERE id = ?", [id]);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to delete package", "delete", this.errorTag, error);
    }
  }
};

// src/server/db/repositories/ParameterRepository.ts
var ParameterRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[ParameterRepository]", "parameters");
  }
  /**
   * Batch-insert multiple parameters at once. Ignores duplicates.
   */
  async createBatch(items) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await this.executeBatchInsert(
      "(id, package_id, module_id, method_id, name, type, is_optional, is_rest, default_value, created_at)",
      10,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.method_id,
        dto.name,
        dto.type,
        dto.is_optional ? 1 : 0,
        dto.is_rest ? 1 : 0,
        dto.default_value ?? "",
        now
      ]
    );
  }
  async create(dto) {
    try {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await this.executeQuery(
        "create",
        `INSERT INTO parameters (
          id,
          package_id,
          module_id,
          method_id,
          name,
          type,
          is_optional,
          is_rest,
          default_value,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          dto.id,
          dto.package_id,
          dto.module_id,
          dto.method_id,
          dto.name,
          dto.type,
          dto.is_optional ? 1 : 0,
          dto.is_rest ? 1 : 0,
          dto.default_value ?? "",
          now
        ]
      );
      return new Parameter(
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.method_id,
        dto.name,
        /* @__PURE__ */ new Date(),
        dto.type,
        dto.is_optional,
        dto.is_rest,
        dto.default_value
      );
    } catch (error) {
      this.logger.error("Failed to create parameter", error);
      throw new RepositoryError("Failed to create parameter", "create", this.errorTag, error);
    }
  }
  async update(id, dto) {
    try {
      const updates = [];
      const values = [];
      if (dto.package_id !== void 0) {
        updates.push("package_id = ?");
        values.push(dto.package_id);
      }
      if (dto.module_id !== void 0) {
        updates.push("module_id = ?");
        values.push(dto.module_id);
      }
      if (dto.method_id !== void 0) {
        updates.push("method_id = ?");
        values.push(dto.method_id);
      }
      if (dto.name !== void 0) {
        updates.push("name = ?");
        values.push(dto.name);
      }
      if (dto.type !== void 0) {
        updates.push("type = ?");
        values.push(dto.type);
      }
      if (dto.is_optional !== void 0) {
        updates.push("is_optional = ?");
        values.push(dto.is_optional ? 1 : 0);
      }
      if (dto.is_rest !== void 0) {
        updates.push("is_rest = ?");
        values.push(dto.is_rest ? 1 : 0);
      }
      if (dto.default_value !== void 0) {
        updates.push("default_value = ?");
        values.push(dto.default_value ?? null);
      }
      if (updates.length === 0) {
        throw new NoFieldsToUpdateError("Parameter", this.errorTag);
      }
      values.push(id);
      await this.executeQuery(
        "update",
        `UPDATE parameters SET ${updates.join(", ")} WHERE id = ?`,
        values
      );
      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError("Parameter", id, this.errorTag);
      }
      return result;
    } catch (error) {
      this.logger.error("Failed to update parameter", error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError("Failed to update parameter", "update", this.errorTag, error);
    }
  }
  async retrieve(id, module_id) {
    try {
      let query = "SELECT * FROM parameters";
      const params = [];
      const conditions = [];
      if (id) {
        conditions.push("id = ?");
        params.push(id);
      }
      if (module_id) {
        conditions.push("module_id = ?");
        params.push(module_id);
      }
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      const results = await this.executeQuery("retrieve", query, params);
      return results.map(
        (param) => new Parameter(
          param.id,
          param.package_id,
          param.module_id,
          param.method_id,
          param.name,
          new Date(param.created_at),
          param.type,
          Boolean(param.is_optional),
          Boolean(param.is_rest),
          param.default_value ?? void 0
        )
      );
    } catch (error) {
      this.logger.error("Failed to retrieve parameter", error);
      throw new RepositoryError("Failed to retrieve parameter", "retrieve", this.errorTag, error);
    }
  }
  async delete(id) {
    try {
      await this.executeQuery("delete", "DELETE FROM parameters WHERE id = ?", [id]);
    } catch (error) {
      this.logger.error("Failed to delete parameter", error);
      throw new RepositoryError("Failed to delete parameter", "delete", this.errorTag, error);
    }
  }
  async findByMethodId(methodId) {
    try {
      const results = await this.executeQuery(
        "findByMethodId",
        "SELECT * FROM parameters WHERE method_id = ? ORDER BY id ASC",
        [methodId]
      );
      return results.map(
        (param) => new Parameter(
          String(param.id),
          String(param.package_id),
          String(param.module_id),
          String(param.method_id),
          String(param.name),
          new Date(String(param.created_at)),
          String(param.type),
          Boolean(param.is_optional),
          Boolean(param.is_rest),
          param.default_value ? String(param.default_value) : void 0
        )
      );
    } catch (error) {
      this.logger.error("Failed to find parameters by method", error);
      throw new RepositoryError("Failed to find parameters by method", "findByMethodId", this.errorTag, error);
    }
  }
  async retrieveById(id) {
    const results = await this.retrieve(id);
    return results[0];
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
};

// src/server/db/repositories/SymbolReferenceRepository.ts
var SymbolReferenceRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[SymbolReferenceRepository]", "symbol_references");
  }
  /**
   * Batch-insert multiple symbol references at once. Ignores duplicates.
   */
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, module_id, source_symbol_id, source_symbol_type, source_symbol_name, target_symbol_id, target_symbol_type, target_symbol_name, access_kind, qualifier_name)",
      11,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.source_symbol_id ?? null,
        dto.source_symbol_type,
        dto.source_symbol_name ?? null,
        dto.target_symbol_id,
        dto.target_symbol_type,
        dto.target_symbol_name,
        dto.access_kind,
        dto.qualifier_name ?? null
      ]
    );
  }
  async create(dto) {
    try {
      await this.executeQuery(
        "create",
        `INSERT INTO symbol_references (
          id,
          package_id,
          module_id,
          source_symbol_id,
          source_symbol_type,
          source_symbol_name,
          target_symbol_id,
          target_symbol_type,
          target_symbol_name,
          access_kind,
          qualifier_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          dto.id,
          dto.package_id,
          dto.module_id,
          dto.source_symbol_id ?? null,
          dto.source_symbol_type,
          dto.source_symbol_name ?? null,
          dto.target_symbol_id,
          dto.target_symbol_type,
          dto.target_symbol_name,
          dto.access_kind,
          dto.qualifier_name ?? null
        ]
      );
      return dto;
    } catch (error) {
      throw new RepositoryError(
        `Failed to create symbol reference: ${error instanceof Error ? error.message : String(error)}`,
        "create",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async update(id, dto) {
    try {
      const updates = [
        { field: "source_symbol_id", value: dto.source_symbol_id ?? void 0 },
        { field: "source_symbol_type", value: dto.source_symbol_type ?? void 0 },
        { field: "source_symbol_name", value: dto.source_symbol_name ?? void 0 },
        { field: "target_symbol_id", value: dto.target_symbol_id ?? void 0 },
        { field: "target_symbol_type", value: dto.target_symbol_type ?? void 0 },
        { field: "target_symbol_name", value: dto.target_symbol_name ?? void 0 },
        { field: "access_kind", value: dto.access_kind ?? void 0 },
        { field: "qualifier_name", value: dto.qualifier_name ?? void 0 }
      ];
      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);
      await this.executeQuery(
        "update",
        `UPDATE symbol_references SET ${query} WHERE id = ?`,
        values
      );
      const updated = await this.retrieveById(id);
      if (!updated) {
        throw new EntityNotFoundError("SymbolReference", id, this.errorTag);
      }
      return updated;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        `Failed to update symbol reference: ${error instanceof Error ? error.message : String(error)}`,
        "update",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  async retrieveById(id) {
    const rows = await this.executeQuery(
      "retrieveById",
      "SELECT * FROM symbol_references WHERE id = ?",
      [id]
    );
    const row = rows[0];
    return row ? this.mapRow(row) : void 0;
  }
  async retrieveByModuleId(module_id) {
    return this.retrieve(void 0, module_id);
  }
  async retrieve(id, module_id) {
    let query = "SELECT * FROM symbol_references";
    const params = [];
    if (id !== void 0) {
      query += " WHERE id = ?";
      params.push(id);
    } else if (module_id !== void 0) {
      query += " WHERE module_id = ?";
      params.push(module_id);
    }
    const rows = await this.executeQuery("retrieve", query, params);
    return rows.map((row) => this.mapRow(row));
  }
  async delete(id) {
    await this.executeQuery("delete", "DELETE FROM symbol_references WHERE id = ?", [id]);
  }
  async findByModuleId(moduleId) {
    return this.retrieveByModuleId(moduleId);
  }
  /**
   * Batch-retrieve all symbol references whose module_id is in the given list.
   */
  async retrieveByModuleIds(moduleIds) {
    if (moduleIds.length === 0) return [];
    try {
      const placeholders = moduleIds.map(() => "?").join(", ");
      const rows = await this.executeQuery(
        "retrieveByModuleIds",
        `SELECT * FROM symbol_references WHERE module_id IN (${placeholders})`,
        moduleIds
      );
      return rows.map((row) => this.mapRow(row));
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        `Failed to retrieve symbol references by module IDs: ${error instanceof Error ? error.message : String(error)}`,
        "retrieveByModuleIds",
        this.errorTag,
        error instanceof Error ? error : void 0
      );
    }
  }
  mapRow(row) {
    return {
      id: row.id,
      package_id: row.package_id,
      module_id: row.module_id,
      source_symbol_id: row.source_symbol_id ?? void 0,
      source_symbol_type: row.source_symbol_type,
      source_symbol_name: row.source_symbol_name ?? void 0,
      target_symbol_id: row.target_symbol_id,
      target_symbol_type: row.target_symbol_type,
      target_symbol_name: row.target_symbol_name,
      access_kind: row.access_kind,
      qualifier_name: row.qualifier_name ?? void 0
    };
  }
};

// src/shared/types/TypeAlias.ts
var TypeAlias = class {
  constructor(id, package_id, module_id, name, type, typeParameters = [], created_at = /* @__PURE__ */ new Date()) {
    this.id = id;
    this.package_id = package_id;
    this.module_id = module_id;
    this.name = name;
    this.type = type;
    this.typeParameters = typeParameters;
    this.created_at = created_at;
  }
};

// src/server/db/repositories/TypeAliasRepository.ts
var TypeAliasRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[TypeAliasRepository]", "type_aliases");
  }
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, module_id, name, type, type_parameters_json)",
      6,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.name,
        dto.type,
        dto.type_parameters_json ?? null
      ]
    );
  }
  async create(dto) {
    const results = await this.executeQuery(
      "create",
      "INSERT INTO type_aliases (id, package_id, module_id, name, type, type_parameters_json) VALUES (?, ?, ?, ?, ?, ?) RETURNING *",
      [dto.id, dto.package_id, dto.module_id, dto.name, dto.type, dto.type_parameters_json ?? null]
    );
    const row = results[0];
    if (!row) {
      throw new RepositoryError("Failed to create type alias", "create", this.errorTag);
    }
    return this.mapToEntity(row);
  }
  async update(id, dto) {
    const sets = [];
    const params = [];
    if (dto.name !== void 0) {
      sets.push("name = ?");
      params.push(dto.name);
    }
    if (dto.type !== void 0) {
      sets.push("type = ?");
      params.push(dto.type);
    }
    if (dto.type_parameters_json !== void 0) {
      sets.push("type_parameters_json = ?");
      params.push(dto.type_parameters_json);
    }
    if (sets.length === 0) {
      const existing = await this.retrieveById(id);
      if (!existing) throw new RepositoryError("Type alias not found", "update", this.errorTag);
      return existing;
    }
    params.push(id);
    const results = await this.executeQuery(
      "update",
      `UPDATE type_aliases SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
      params
    );
    const row = results[0];
    if (!row) throw new RepositoryError("Type alias not found", "update", this.errorTag);
    return this.mapToEntity(row);
  }
  async retrieveById(id) {
    const results = await this.executeQuery(
      "retrieveById",
      "SELECT * FROM type_aliases WHERE id = ?",
      [id]
    );
    const row = results[0];
    return row ? this.mapToEntity(row) : void 0;
  }
  async retrieveByModuleId(moduleId) {
    const results = await this.executeQuery(
      "retrieveByModuleId",
      "SELECT * FROM type_aliases WHERE module_id = ? ORDER BY name",
      [moduleId]
    );
    return results.map((row) => this.mapToEntity(row));
  }
  async retrieveByModuleIds(moduleIds) {
    if (moduleIds.length === 0) return [];
    const placeholders = moduleIds.map(() => "?").join(", ");
    const results = await this.executeQuery(
      "retrieveByModuleIds",
      `SELECT * FROM type_aliases WHERE module_id IN (${placeholders}) ORDER BY name`,
      moduleIds
    );
    return results.map((row) => this.mapToEntity(row));
  }
  async retrieve() {
    const results = await this.executeQuery(
      "retrieve all",
      "SELECT * FROM type_aliases ORDER BY name"
    );
    return results.map((row) => this.mapToEntity(row));
  }
  async delete(id) {
    await this.executeQuery("delete", "DELETE FROM type_aliases WHERE id = ?", [id]);
  }
  mapToEntity(row) {
    let typeParameters = [];
    if (row.type_parameters_json) {
      try {
        const parsed = JSON.parse(row.type_parameters_json);
        if (Array.isArray(parsed)) {
          typeParameters = parsed.filter((p) => typeof p === "string");
        }
      } catch {
      }
    }
    return new TypeAlias(
      row.id,
      row.package_id,
      row.module_id,
      row.name,
      row.type,
      typeParameters,
      new Date(row.created_at)
    );
  }
};

// src/shared/types/Variable.ts
var Variable = class {
  constructor(id, package_id, module_id, name, kind, type = "unknown", initializer, created_at = /* @__PURE__ */ new Date()) {
    this.id = id;
    this.package_id = package_id;
    this.module_id = module_id;
    this.name = name;
    this.kind = kind;
    this.type = type;
    this.initializer = initializer;
    this.created_at = created_at;
  }
};

// src/server/db/repositories/VariableRepository.ts
var VariableRepository = class extends BaseRepository {
  constructor(adapter) {
    super(adapter, "[VariableRepository]", "variables");
  }
  async createBatch(items) {
    await this.executeBatchInsert(
      "(id, package_id, module_id, name, kind, type, initializer)",
      7,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.name,
        dto.kind,
        dto.type ?? null,
        dto.initializer ?? null
      ]
    );
  }
  async create(dto) {
    const results = await this.executeQuery(
      "create",
      "INSERT INTO variables (id, package_id, module_id, name, kind, type, initializer) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *",
      [dto.id, dto.package_id, dto.module_id, dto.name, dto.kind, dto.type ?? null, dto.initializer ?? null]
    );
    const row = results[0];
    if (!row) {
      throw new RepositoryError("Failed to create variable", "create", this.errorTag);
    }
    return this.mapToEntity(row);
  }
  async update(id, dto) {
    const sets = [];
    const params = [];
    if (dto.name !== void 0) {
      sets.push("name = ?");
      params.push(dto.name);
    }
    if (dto.kind !== void 0) {
      sets.push("kind = ?");
      params.push(dto.kind);
    }
    if (dto.type !== void 0) {
      sets.push("type = ?");
      params.push(dto.type);
    }
    if (dto.initializer !== void 0) {
      sets.push("initializer = ?");
      params.push(dto.initializer);
    }
    if (sets.length === 0) {
      const existing = await this.retrieveById(id);
      if (!existing) throw new RepositoryError("Variable not found", "update", this.errorTag);
      return existing;
    }
    params.push(id);
    const results = await this.executeQuery(
      "update",
      `UPDATE variables SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
      params
    );
    const row = results[0];
    if (!row) throw new RepositoryError("Variable not found", "update", this.errorTag);
    return this.mapToEntity(row);
  }
  async retrieveById(id) {
    const results = await this.executeQuery(
      "retrieveById",
      "SELECT * FROM variables WHERE id = ?",
      [id]
    );
    const row = results[0];
    return row ? this.mapToEntity(row) : void 0;
  }
  async retrieveByModuleId(moduleId) {
    const results = await this.executeQuery(
      "retrieveByModuleId",
      "SELECT * FROM variables WHERE module_id = ? ORDER BY name",
      [moduleId]
    );
    return results.map((row) => this.mapToEntity(row));
  }
  async retrieveByModuleIds(moduleIds) {
    if (moduleIds.length === 0) return [];
    const placeholders = moduleIds.map(() => "?").join(", ");
    const results = await this.executeQuery(
      "retrieveByModuleIds",
      `SELECT * FROM variables WHERE module_id IN (${placeholders}) ORDER BY name`,
      moduleIds
    );
    return results.map((row) => this.mapToEntity(row));
  }
  async retrieve() {
    const results = await this.executeQuery(
      "retrieve all",
      "SELECT * FROM variables ORDER BY name"
    );
    return results.map((row) => this.mapToEntity(row));
  }
  async delete(id) {
    await this.executeQuery("delete", "DELETE FROM variables WHERE id = ?", [id]);
  }
  mapToEntity(row) {
    return new Variable(
      row.id,
      row.package_id,
      row.module_id,
      row.name,
      row.kind,
      row.type ?? "unknown",
      row.initializer ?? void 0,
      new Date(row.created_at)
    );
  }
};

// src/server/parsers/PackageParser.ts
import { readFile as readFile2, readdir } from "fs/promises";
import { dirname as dirname2, join as join3, relative as relative2, resolve } from "path";
import { readPackage } from "read-pkg";
import ts from "typescript";

// src/shared/types/Import.ts
var ImportSpecifier = class {
  constructor(uuid, name, kind, exportRef, modules = /* @__PURE__ */ new Set(), aliases = /* @__PURE__ */ new Set()) {
    this.uuid = uuid;
    this.name = name;
    this.kind = kind;
    this.exportRef = exportRef;
    this.modules = modules;
    this.aliases = aliases;
  }
};
var Import = class {
  constructor(uuid, fullPath, relativePath, name, specifiers = /* @__PURE__ */ new Map(), depth = 0) {
    this.uuid = uuid;
    this.fullPath = fullPath;
    this.relativePath = relativePath;
    this.name = name;
    this.specifiers = specifiers;
    this.depth = depth;
  }
};
var PackageImport = class extends Import {
  constructor(uuid, fullPath, relativePath, name, specifiers, depth, version, resolution, resolved, type) {
    super(uuid, fullPath, relativePath, name, specifiers, depth);
    this.version = version;
    this.resolution = resolution;
    this.resolved = resolved;
    this.type = type;
  }
};

// src/server/utils/uuid.ts
import { v5 as uuidv5 } from "uuid";
var NAMESPACES = {
  class: "4e6f2fef-86d8-4313-92ae-11fc409b68b4",
  interface: "e7658749-0c84-4f31-b534-15d95d45cf83",
  package: "58532622-6b61-4607-bb0c-ff8cb5364979",
  method: "b507c1b4-e66e-42e9-81b7-39351a124fe1",
  property: "f06da354-f4f6-4ef1-8d0d-a17662964712",
  parameter: "fa4c32fe-43fd-4fb5-a994-9f2d68e72803",
  module: "a4205160-cef7-471d-a459-24b993d8c0d8",
  enum: "1d6acd05-a181-41bf-be83-b0be97efe3c9",
  function: "d9f8e2b3-7c4a-4d1e-9f6a-5c3b8d2a1e4f",
  export: "33c9c31d-ccfa-47b8-8966-0bb08c51fc45",
  import: "b9a7d20b-45ff-47a4-8eab-42cf921be416",
  typeAlias: "27473cf4-2ac7-477c-a903-01693f9bcf67",
  variable: "c8f3a1e7-5b2d-4a9c-b6e1-d4f7c2a8e3b5",
  moduleDefinition: "e481a0e5-fac9-4ec1-bd87-7f871c807db5"
};
function generateUUID(type, key) {
  return uuidv5(key, NAMESPACES[type]);
}
var generateClassUUID = (packageId, moduleId, name) => generateUUID("class", `${packageId}.${moduleId}.${name}`);
var generateInterfaceUUID = (packageId, moduleId, name) => generateUUID("interface", `${packageId}.${moduleId}.${name}`);
var generatePackageUUID = (name, version) => generateUUID("package", `${name}@${version}`);
var generateMethodUUID = (packageId, moduleId, parentId, name) => generateUUID("method", `${packageId}.${moduleId}.${parentId}.${name}`);
var generatePropertyUUID = (packageId, moduleId, parentId, name, parentType) => generateUUID("property", `${packageId}.${moduleId}.${parentId}.${parentType}.${name}`);
var generateParameterUUID = (methodId, name) => generateUUID("parameter", `${methodId}.${name}`);
var generateModuleUUID = (packageId, modulePath) => generateUUID("module", `${packageId}.${modulePath}`);
var generateEnumUUID = (packageId, moduleId, name) => generateUUID("enum", `${packageId}.${moduleId}.${name}`);
var generateExportUUID = (moduleId, exportName) => generateUUID("export", `${moduleId}.${exportName}`);
var generateImportUUID = (moduleId, importName) => generateUUID("import", `${moduleId}.${importName}`);
var generateTypeAliasUUID = (packageId, moduleId, name) => generateUUID("typeAlias", `${packageId}.${moduleId}.${name}`);
var generateVariableUUID = (packageId, moduleId, name) => generateUUID("variable", `${packageId}.${moduleId}.${name}`);
var generateFunctionUUID = (packageId, moduleId, name) => generateUUID("function", `${packageId}.${moduleId}.${name}`);
var generateRelationshipUUID = (sourceId, targetId, type) => generateUUID("class", `rel:${type}:${sourceId}:${targetId}`);

// src/server/parsers/ModuleParser.ts
import { access, readFile } from "fs/promises";
import { dirname, join as join2, relative } from "path";
import jscodeshift from "jscodeshift";

// src/shared/types/Export.ts
var Export = class {
  constructor(uuid, module, name, isDefault, localName, exportedFrom, imports = /* @__PURE__ */ new Set()) {
    this.uuid = uuid;
    this.module = module;
    this.name = name;
    this.isDefault = isDefault;
    this.localName = localName;
    this.exportedFrom = exportedFrom;
    this.imports = imports;
  }
};

// src/server/parsers/ModuleParser.ts
var ModuleParser = class {
  constructor(filePath, packageId, sourceOverride) {
    this.filePath = filePath;
    this.packageId = packageId;
    this.sourceOverride = sourceOverride;
    this.j = jscodeshift.withParser("tsx");
    this.root = void 0;
    this.logger = createLogger("ModuleParser");
  }
  j;
  root;
  moduleId;
  imports = /* @__PURE__ */ new Map();
  exports = /* @__PURE__ */ new Set();
  reExports = /* @__PURE__ */ new Set();
  logger;
  // Safely get identifier name to work around type issues
  getIdentifierName(id) {
    if (!id) return null;
    if (typeof id === "string") return id;
    if ("name" in id && typeof id.name === "string") {
      return id.name;
    }
    return null;
  }
  /**
   * Extracts the name from a heritage clause node (implements/extends).
   * Handles both TSExpressionWithTypeArguments (has `expression`) and direct Identifiers.
   */
  getHeritageClauseName(node) {
    if ("expression" in node) {
      const expression = node.expression;
      if (expression?.type === "Identifier" && "name" in expression) {
        return expression.name;
      }
    }
    if (node.type === "Identifier" && "name" in node) {
      return node.name;
    }
    return null;
  }
  async parse() {
    this.moduleId = generateModuleUUID(this.packageId, this.filePath);
    const relativePath = relative(process.cwd(), this.filePath);
    try {
      const content = this.sourceOverride ?? await readFile(this.filePath, "utf-8");
      this.root = this.j(content);
      this.imports.clear();
      this.exports.clear();
      this.reExports.clear();
      const result = {
        package: void 0,
        modules: [await this.createModuleDTO(this.moduleId, relativePath)],
        classes: [],
        interfaces: [],
        functions: [],
        typeAliases: [],
        enums: [],
        variables: [],
        methods: [],
        properties: [],
        parameters: [],
        imports: [],
        exports: [],
        classExtends: [],
        classImplements: [],
        interfaceExtends: [],
        symbolUsages: [],
        symbolReferences: []
      };
      this.parseImportsAndExports();
      this.parseClasses(this.moduleId, result);
      this.parseInterfaces(this.moduleId, result);
      this.parseFunctions(this.moduleId, result);
      this.parseTypeAliases(this.moduleId, result);
      this.parseEnums(this.moduleId, result);
      this.parseVariables(this.moduleId, result);
      result.imports = Array.from(this.imports.values());
      result.exports = Array.from(this.exports).map(
        (exportName) => new Export(generateExportUUID(this.moduleId, exportName), this.moduleId, exportName, false)
      );
      return result;
    } catch (error) {
      console.warn(
        `Warning: Failed to process ${relativePath}:`,
        error instanceof Error ? error.message : String(error)
      );
      return {
        modules: [await this.createModuleDTO(this.moduleId, relativePath)],
        classes: [],
        functions: [],
        typeAliases: [],
        enums: [],
        variables: [],
        interfaces: [],
        methods: [],
        properties: [],
        parameters: [],
        imports: [],
        exports: [],
        classExtends: [],
        classImplements: [],
        interfaceExtends: [],
        symbolUsages: [],
        symbolReferences: []
      };
    }
  }
  parseImportsAndExports() {
    if (!this.root) return;
    this.root.find(this.j.ImportDeclaration).forEach((path) => {
      const importPath = path.node.source.value;
      if (typeof importPath !== "string") return;
      const importSpecifiers = /* @__PURE__ */ new Map();
      const isTypeImport = path.node.importKind === "type";
      path.node.specifiers?.forEach((specifier) => {
        if (specifier.type === "ImportSpecifier" && specifier.imported.type === "Identifier") {
          const importedName = specifier.imported.name;
          const localName = specifier.local?.type === "Identifier" ? specifier.local.name : importedName;
          const uuid2 = generateImportUUID(importPath, importedName);
          const kind = isTypeImport ? "type" : "value";
          const aliases = /* @__PURE__ */ new Set();
          if (localName !== importedName) {
            aliases.add(localName);
          }
          const importSpecifier = new ImportSpecifier(
            uuid2,
            importedName,
            kind,
            void 0,
            /* @__PURE__ */ new Set(),
            aliases
          );
          importSpecifiers.set(localName, importSpecifier);
        } else if (specifier.type === "ImportDefaultSpecifier" && specifier.local?.type === "Identifier") {
          const name = specifier.local.name;
          const uuid2 = generateImportUUID(importPath, name);
          const kind = isTypeImport ? "type" : "default";
          const importSpecifier = new ImportSpecifier(uuid2, name, kind, void 0, /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set());
          importSpecifiers.set(name, importSpecifier);
        } else if (specifier.type === "ImportNamespaceSpecifier" && specifier.local?.type === "Identifier") {
          const name = specifier.local.name;
          const uuid2 = generateImportUUID(importPath, name);
          const kind = isTypeImport ? "type" : "namespace";
          const importSpecifier = new ImportSpecifier(uuid2, name, kind, void 0, /* @__PURE__ */ new Set(), /* @__PURE__ */ new Set());
          importSpecifiers.set(name, importSpecifier);
        }
      });
      const existingImport = this.imports.get(importPath);
      if (existingImport) {
        importSpecifiers.forEach((spec, name) => {
          if (!existingImport.specifiers.has(name)) {
            existingImport.specifiers.set(name, spec);
          }
        });
        return;
      }
      const uuid = generateImportUUID(this.moduleId, importPath);
      const imp = new Import(uuid, importPath, importPath, importPath, importSpecifiers);
      this.imports.set(importPath, imp);
    });
    this.root.find(this.j.ExportNamedDeclaration).forEach((path) => {
      if (path.node.source) {
        path.node.specifiers?.forEach((specifier) => {
          if (specifier.exported.type === "Identifier") {
            this.reExports.add(specifier.exported.name);
            this.exports.add(specifier.exported.name);
          }
        });
      } else if (path.node.declaration) {
        if (path.node.declaration.type === "ClassDeclaration" && path.node.declaration.id) {
          const name = this.getIdentifierName(path.node.declaration.id);
          if (name) this.exports.add(name);
        } else if (path.node.declaration.type === "VariableDeclaration") {
          path.node.declaration.declarations.forEach((decl) => {
            if ("id" in decl && decl.id.type === "Identifier") {
              const name = this.getIdentifierName(decl.id);
              if (name) this.exports.add(name);
            }
          });
        } else if (path.node.declaration.type === "FunctionDeclaration" && path.node.declaration.id) {
          const name = this.getIdentifierName(path.node.declaration.id);
          if (name) this.exports.add(name);
        } else if (path.node.declaration.type === "TSTypeAliasDeclaration") {
          const name = this.getIdentifierName(path.node.declaration.id);
          if (name) this.exports.add(name);
        } else if (path.node.declaration.type === "TSEnumDeclaration") {
          const name = this.getIdentifierName(path.node.declaration.id);
          if (name) this.exports.add(name);
        }
      }
    });
    this.root.find(this.j.ExportAllDeclaration).forEach((path) => {
      if (typeof path.node.source.value === "string") {
        this.reExports.add("*");
      }
    });
  }
  isBarrelFile() {
    if (this.exports.size === 0) return false;
    if (this.reExports.has("*")) return true;
    const reExportRatio = this.reExports.size / this.exports.size;
    return reExportRatio > 0.8;
  }
  async createModuleDTO(moduleId, relativePath) {
    const directory = dirname(this.filePath);
    const fullName = relativePath.split("/").pop() ?? "";
    const name = fullName.replace(/\.[^/.]+$/, "");
    let indexFile;
    const indexCandidates = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs", "index.cjs", "index.vue"];
    for (const candidate of indexCandidates) {
      const candidatePath = join2(directory, candidate);
      try {
        await access(candidatePath);
        indexFile = candidatePath;
        break;
      } catch {
      }
    }
    return {
      id: moduleId,
      package_id: this.packageId,
      name,
      source: {
        directory,
        name,
        filename: this.filePath,
        relativePath,
        index: indexFile,
        isBarrel: this.isBarrelFile()
      }
    };
  }
  parseClasses(moduleId, result) {
    if (!this.root) return;
    this.root.find(this.j.ClassDeclaration).forEach((path) => {
      const node = path.node;
      if (!node.id?.name) return;
      const className = this.getIdentifierName(node.id);
      if (!className) return;
      const classId = generateClassUUID(this.packageId, moduleId, className);
      const classDTO = this.createClassDTO(classId, moduleId, node);
      result.classes.push(classDTO);
      if (node.superClass?.type === "Identifier" && node.superClass.name) {
        result.classExtends.push({
          classId,
          parentName: node.superClass.name
        });
      }
      if (node.implements && Array.isArray(node.implements)) {
        for (const impl of node.implements) {
          const name = this.getHeritageClauseName(impl);
          if (name) {
            result.classImplements.push({ classId, interfaceName: name });
          }
        }
      }
      const methods = this.parseClassMethods(moduleId, classId, node, result);
      const properties = this.parseClassProperties(moduleId, classId, node);
      result.methods.push(...methods);
      result.properties.push(...properties);
    });
  }
  createClassDTO(classId, moduleId, node) {
    if (node.id?.type !== "Identifier") {
      throw new Error("Invalid class declaration: missing identifier");
    }
    return {
      id: classId,
      package_id: this.packageId,
      module_id: moduleId,
      name: node.id.name
      // Note: extends_id is no longer set here. The parent class name is captured
      // in result.classExtends and resolved to a UUID after all modules are parsed.
    };
  }
  parseInterfaces(moduleId, result) {
    if (!this.root) return;
    this.root.find(this.j.TSInterfaceDeclaration).forEach((path) => {
      const node = path.node;
      if (node.id.type !== "Identifier" || !node.id.name) return;
      const interfaceId = generateInterfaceUUID(this.packageId, moduleId, node.id.name);
      const interfaceDTO = this.createInterfaceDTO(interfaceId, moduleId, node);
      result.interfaces.push(interfaceDTO);
      if (node.extends && Array.isArray(node.extends)) {
        for (const ext of node.extends) {
          const name = this.getHeritageClauseName(ext);
          if (name) {
            result.interfaceExtends.push({ interfaceId, parentName: name });
          }
        }
      }
      const methods = this.parseInterfaceMethods(moduleId, interfaceId, node, result);
      const properties = this.parseInterfaceProperties(moduleId, interfaceId, node);
      result.methods.push(...methods);
      result.properties.push(...properties);
    });
  }
  createInterfaceDTO(interfaceId, moduleId, node) {
    return {
      id: interfaceId,
      package_id: this.packageId,
      module_id: moduleId,
      name: node.id.type === "Identifier" ? node.id.name : ""
    };
  }
  extractSymbolUsages(node, context) {
    const usages = [];
    const seen = /* @__PURE__ */ new Set();
    this.j(node).find(this.j.MemberExpression).forEach((memberPath) => {
      const member = memberPath.node;
      if (member.type !== "MemberExpression") return;
      let targetName;
      if (member.property.type === "Identifier") {
        targetName = member.property.name;
      } else if ("value" in member.property && typeof member.property.value === "string") {
        targetName = member.property.value;
      }
      if (!targetName) return;
      let qualifierName;
      if (member.object.type === "Identifier") {
        qualifierName = member.object.name;
      } else if (member.object.type === "ThisExpression") {
        qualifierName = "this";
      }
      const isMethodCall = memberPath.name === "callee";
      const targetKind = isMethodCall ? "method" : "property";
      const dedupeKey = `${targetKind}|${qualifierName ?? ""}|${targetName}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      usages.push({
        moduleId: context.moduleId,
        sourceSymbolId: context.sourceSymbolId,
        sourceSymbolType: context.sourceSymbolType,
        sourceSymbolName: context.sourceSymbolName,
        sourceParentName: context.sourceParentName,
        sourceParentType: context.sourceParentType,
        targetName,
        targetKind,
        qualifierName
      });
    });
    return usages;
  }
  parseClassMethods(moduleId, classId, node, result) {
    try {
      const parentName = node.id && typeof node.id === "object" && "name" in node.id && typeof node.id.name === "string" ? node.id.name : void 0;
      return this.parseMethods(this.j(node), "class", classId, moduleId, result, parentName);
    } catch (error) {
      this.logger.error(`Error parsing class methods: ${String(error)}`);
      return [];
    }
  }
  parseInterfaceMethods(moduleId, interfaceId, node, result) {
    try {
      const parentName = "name" in node.id && typeof node.id.name === "string" ? node.id.name : void 0;
      return this.parseMethods(this.j(node), "interface", interfaceId, moduleId, result, parentName);
    } catch (error) {
      this.logger.error(`Error parsing interface methods: ${String(error)}`);
      return [];
    }
  }
  parseMethods(collection, parentType, parentId, moduleId, result, parentName) {
    const methods = [];
    try {
      let methodNodes;
      if (parentType === "class") {
        const classMethods = collection.find(this.j.MethodDefinition);
        const propertyMethods = collection.find(this.j.ClassProperty).filter((path) => {
          const value = path.value.value;
          const hasArrowFunction = Boolean(
            value && typeof value === "object" && "type" in value && value.type === "ArrowFunctionExpression"
          );
          const hasFunctionType = this.isFunctionTypeProperty(path.value);
          return hasArrowFunction || hasFunctionType;
        });
        methodNodes = this.j([...classMethods.paths(), ...propertyMethods.paths()]);
      } else {
        const interfaceMethods = collection.find(this.j.TSMethodSignature);
        const functionTypedProps = collection.find(this.j.TSPropertySignature).filter((path) => {
          return this.isFunctionTypeProperty(path.value);
        });
        methodNodes = this.j([...interfaceMethods.paths(), ...functionTypedProps.paths()]);
      }
      methodNodes.forEach((path) => {
        try {
          const node = path.value;
          const methodName = this.getMethodName(node);
          if (!methodName) {
            this.logger.info("Skipping method with invalid name", {
              parentId,
              nodeType: node.type
            });
            return;
          }
          const methodId = generateMethodUUID(this.packageId, moduleId, parentId, methodName);
          const returnType = this.getReturnType(node);
          const parameters = this.parseParameters(node, methodId, moduleId);
          const isStatic = parentType === "class" && "static" in node && node.static;
          const isAsync = parentType === "class" && "value" in node && node.value !== null && node.value.type === "FunctionExpression" && node.value.async === true;
          methods.push({
            id: methodId,
            name: methodName,
            package_id: this.packageId,
            module_id: moduleId,
            parent_id: parentId,
            parent_type: parentType,
            return_type: returnType,
            is_static: isStatic,
            is_async: isAsync,
            visibility: "public"
            // Default visibility
          });
          const usages = this.extractSymbolUsages(node, {
            moduleId,
            sourceSymbolId: methodId,
            sourceSymbolType: "method",
            sourceSymbolName: methodName,
            sourceParentName: parentName,
            sourceParentType: parentType
          });
          if (usages.length > 0) {
            result.symbolUsages.push(...usages);
          }
          if (parameters.length > 0) {
            result.parameters.push(...parameters);
          }
        } catch (error) {
          this.logger.error("Error parsing individual method:", { error, parentId });
        }
      });
    } catch (error) {
      this.logger.error("Error parsing methods:", { error, parentId });
    }
    return methods;
  }
  parseClassProperties(moduleId, classId, node) {
    try {
      return this.parseProperties(moduleId, classId, "class", node);
    } catch (error) {
      this.logger.error(`Error parsing class properties: ${String(error)}`);
      return [];
    }
  }
  parseInterfaceProperties(moduleId, interfaceId, node) {
    try {
      return this.parseProperties(moduleId, interfaceId, "interface", node);
    } catch (error) {
      this.logger.error(`Error parsing interface properties: ${String(error)}`);
      return [];
    }
  }
  parseProperties(moduleId, parentId, parentType, node) {
    const properties = [];
    const collection = this.j(node);
    const propertyNodes = parentType === "class" ? collection.find(this.j.ClassProperty) : collection.find(this.j.TSPropertySignature);
    propertyNodes.forEach((path, index) => {
      try {
        const propertyNode = path.node;
        const propertyName = this.getPropertyName(propertyNode);
        if (!propertyName) {
          this.logger.error("Invalid property name");
          return;
        }
        const isFunctionType = this.isFunctionTypeProperty(propertyNode);
        if (isFunctionType) {
          this.logger.debug(`Skipping function-typed property: ${propertyName}`);
          return;
        }
        const propertyType = this.getTypeFromAnnotation(propertyNode.typeAnnotation);
        const propertyId = generatePropertyUUID(
          this.packageId,
          moduleId,
          parentId,
          `${propertyName}_${String(index)}`,
          parentType
        );
        properties.push({
          id: propertyId,
          module_id: moduleId,
          parent_id: parentId,
          parent_type: parentType,
          name: propertyName,
          type: propertyType,
          package_id: this.packageId,
          is_static: false,
          is_readonly: false,
          visibility: "public"
        });
      } catch (error) {
        this.logger.error(`Error parsing property: ${String(error)}`);
      }
    });
    return properties;
  }
  /**
   * Check if a property has a function type annotation
   */
  isFunctionTypeProperty(node) {
    try {
      if (node.typeAnnotation?.type !== "TSTypeAnnotation") {
        return false;
      }
      const typeAnnotation = node.typeAnnotation.typeAnnotation;
      return typeAnnotation.type === "TSFunctionType" || typeAnnotation.type === "TSConstructorType" || // Also check for arrow function values
      "value" in node && node.value?.type === "ArrowFunctionExpression";
    } catch (error) {
      this.logger.error("Error checking function type:", { error });
      return false;
    }
  }
  getMethodName(node) {
    try {
      return node.key.type === "Identifier" ? node.key.name : void 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error("Error getting method name:", { error: errorMessage });
      return void 0;
    }
  }
  getPropertyName(node) {
    try {
      if (node.key.type === "Identifier") {
        return node.key.name;
      }
      return void 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error("Error getting property name:", { error: errorMessage });
      return void 0;
    }
  }
  parseParameters(node, methodId, moduleId) {
    const parameters = [];
    try {
      const params = this.getParametersList(node);
      if (!Array.isArray(params)) {
        return parameters;
      }
      for (const param of params) {
        if (param.type !== "Identifier") {
          continue;
        }
        const paramType = this.getTypeFromAnnotation(param.typeAnnotation);
        const paramId = generateParameterUUID(methodId, param.name);
        parameters.push({
          id: paramId,
          name: param.name,
          type: paramType,
          package_id: this.packageId,
          module_id: moduleId,
          method_id: methodId,
          is_optional: false,
          is_rest: false
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error parsing parameters: ${errorMessage}`);
    }
    return parameters;
  }
  getParametersList(node) {
    if ("value" in node && node.value) {
      if ("params" in node.value) {
        return node.value.params;
      }
    }
    if ("parameters" in node) {
      return node.parameters;
    }
    if ("typeAnnotation" in node && node.typeAnnotation?.type === "TSTypeAnnotation") {
      const typeAnnotation = node.typeAnnotation.typeAnnotation;
      if ("parameters" in typeAnnotation && Array.isArray(typeAnnotation.parameters)) {
        return typeAnnotation.parameters;
      }
    }
    return [];
  }
  getReturnType(node) {
    try {
      const returnTypeNode = this.getReturnTypeNode(node);
      return this.getTypeFromAnnotation(returnTypeNode) || "void";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error getting return type: ${errorMessage}`);
      return "void";
    }
  }
  getReturnTypeNode(node) {
    if ("value" in node && node.value) {
      if ("returnType" in node.value && node.value.returnType) {
        return node.value.returnType;
      }
    }
    if ("typeAnnotation" in node && node.typeAnnotation) {
      return node.typeAnnotation;
    }
    return void 0;
  }
  getTypeFromAnnotation(annotation) {
    if (!annotation) {
      return "any";
    }
    try {
      return this.j(annotation).toSource().replace(/[\n\s]+/g, " ").trim() || "any";
    } catch (error) {
      this.logger.error("Error getting type from annotation:", { error: String(error) });
      return "any";
    }
  }
  /**
   * Parse module-level function declarations
   */
  parseFunctions(moduleId, result) {
    if (!this.root) return;
    const seenFunctionIds = /* @__PURE__ */ new Set();
    const captureFunction = (node) => {
      if (node.type !== "FunctionDeclaration" || !node.id) return;
      const idName = this.getIdentifierName(node.id);
      if (!idName) return;
      const functionName = idName;
      const functionId = generateFunctionUUID(this.packageId, moduleId, functionName);
      if (seenFunctionIds.has(functionId)) {
        return;
      }
      seenFunctionIds.add(functionId);
      const isExported = this.exports.has(functionName);
      const returnType = this.getReturnTypeFromNode(node);
      const functionDTO = {
        id: functionId,
        package_id: this.packageId,
        module_id: moduleId,
        name: functionName,
        return_type: returnType,
        is_async: node.async ?? false,
        is_exported: isExported
      };
      result.functions.push(functionDTO);
      const usages = this.extractSymbolUsages(node, {
        moduleId,
        sourceSymbolId: functionId,
        sourceSymbolType: "function",
        sourceSymbolName: functionName
      });
      if (usages.length > 0) {
        result.symbolUsages.push(...usages);
      }
    };
    this.root.find(this.j.Program).forEach((programPath) => {
      const programNode = programPath.node;
      if (programNode.type !== "Program") {
        return;
      }
      programNode.body.forEach((statement) => {
        try {
          if (statement.type === "FunctionDeclaration") {
            captureFunction(statement);
            return;
          }
          if ((statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") && statement.declaration) {
            captureFunction(statement.declaration);
          }
        } catch (error) {
          this.logger.error("Error parsing function:", error);
        }
      });
    });
  }
  /**
   * Get return type from a function node
   */
  getReturnTypeFromNode(node) {
    try {
      if ("returnType" in node && node.returnType) {
        const returnType = node.returnType;
        return this.getTypeFromAnnotation(returnType);
      }
    } catch (error) {
      this.logger.error("Error getting return type:", error);
    }
    return "void";
  }
  /**
   * Parse module-level type alias declarations (type Foo = ...)
   */
  parseTypeAliases(moduleId, result) {
    if (!this.root) return;
    const seenIds = /* @__PURE__ */ new Set();
    const captureTypeAlias = (node) => {
      if (node.type !== "TSTypeAliasDeclaration") return;
      const idName = this.getIdentifierName(node.id);
      if (!idName) return;
      const aliasId = generateTypeAliasUUID(this.packageId, moduleId, idName);
      if (seenIds.has(aliasId)) return;
      seenIds.add(aliasId);
      let typeBody = "unknown";
      try {
        typeBody = this.j(node.typeAnnotation).toSource().replace(/[\n\s]+/g, " ").trim() || "unknown";
      } catch {
        typeBody = "unknown";
      }
      let typeParametersJson;
      try {
        if ("typeParameters" in node && node.typeParameters) {
          const params = node.typeParameters;
          if ("params" in params && Array.isArray(params.params)) {
            const names = params.params.map((p) => this.getIdentifierName(p)).filter((n) => n !== null);
            if (names.length > 0) {
              typeParametersJson = JSON.stringify(names);
            }
          }
        }
      } catch {
      }
      const dto = {
        id: aliasId,
        package_id: this.packageId,
        module_id: moduleId,
        name: idName,
        type: typeBody,
        type_parameters_json: typeParametersJson
      };
      result.typeAliases.push(dto);
    };
    this.root.find(this.j.Program).forEach((programPath) => {
      const programNode = programPath.node;
      if (programNode.type !== "Program") return;
      programNode.body.forEach((statement) => {
        try {
          if (statement.type === "TSTypeAliasDeclaration") {
            captureTypeAlias(statement);
            return;
          }
          if ((statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") && statement.declaration) {
            captureTypeAlias(statement.declaration);
          }
        } catch (error) {
          this.logger.error("Error parsing type alias:", error);
        }
      });
    });
  }
  /**
   * Parse module-level enum declarations
   */
  parseEnums(moduleId, result) {
    if (!this.root) return;
    const seenIds = /* @__PURE__ */ new Set();
    const captureEnum = (node) => {
      if (node.type !== "TSEnumDeclaration") return;
      const idName = this.getIdentifierName(node.id);
      if (!idName) return;
      const enumId = generateEnumUUID(this.packageId, moduleId, idName);
      if (seenIds.has(enumId)) return;
      seenIds.add(enumId);
      let membersJson;
      try {
        if ("members" in node && Array.isArray(node.members)) {
          const memberNames = node.members.map((m) => {
            if ("id" in m && m.id) {
              const mid = m.id;
              if (mid.type === "Identifier" && "name" in mid) {
                return mid.name;
              }
            }
            return null;
          }).filter((n) => n !== null);
          if (memberNames.length > 0) {
            membersJson = JSON.stringify(memberNames);
          }
        }
      } catch {
      }
      const dto = {
        id: enumId,
        package_id: this.packageId,
        module_id: moduleId,
        name: idName,
        members_json: membersJson
      };
      result.enums.push(dto);
    };
    this.root.find(this.j.Program).forEach((programPath) => {
      const programNode = programPath.node;
      if (programNode.type !== "Program") return;
      programNode.body.forEach((statement) => {
        try {
          if (statement.type === "TSEnumDeclaration") {
            captureEnum(statement);
            return;
          }
          if ((statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") && statement.declaration) {
            captureEnum(statement.declaration);
          }
        } catch (error) {
          this.logger.error("Error parsing enum:", error);
        }
      });
    });
  }
  /**
   * Parse module-level variable declarations (const, let, var)
   */
  parseVariables(moduleId, result) {
    if (!this.root) return;
    const seenIds = /* @__PURE__ */ new Set();
    const captureVariableDeclaration = (node) => {
      if (node.type !== "VariableDeclaration") return;
      const kind = node.kind;
      if (!("declarations" in node) || !Array.isArray(node.declarations)) return;
      for (const declarator of node.declarations) {
        try {
          if (!("id" in declarator) || !declarator.id) continue;
          const idNode = declarator.id;
          if (idNode.type !== "Identifier") continue;
          const varName = this.getIdentifierName(idNode);
          if (!varName) continue;
          const varId = generateVariableUUID(this.packageId, moduleId, varName);
          if (seenIds.has(varId)) continue;
          seenIds.add(varId);
          let varType;
          if ("typeAnnotation" in idNode && idNode.typeAnnotation) {
            varType = this.getTypeFromAnnotation(idNode.typeAnnotation);
          }
          let initializer;
          try {
            if ("init" in declarator && declarator.init) {
              const initSource = this.j(declarator.init).toSource().replace(/[\n\s]+/g, " ").trim();
              if (initSource) {
                initializer = initSource.length > 500 ? initSource.slice(0, 500) + "..." : initSource;
              }
            }
          } catch {
          }
          const dto = {
            id: varId,
            package_id: this.packageId,
            module_id: moduleId,
            name: varName,
            kind,
            type: varType,
            initializer
          };
          result.variables.push(dto);
        } catch (error) {
          this.logger.error("Error parsing variable declarator:", error);
        }
      }
    };
    this.root.find(this.j.Program).forEach((programPath) => {
      const programNode = programPath.node;
      if (programNode.type !== "Program") return;
      programNode.body.forEach((statement) => {
        try {
          if (statement.type === "VariableDeclaration") {
            captureVariableDeclaration(statement);
            return;
          }
          if ((statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") && statement.declaration) {
            captureVariableDeclaration(statement.declaration);
          }
        } catch (error) {
          this.logger.error("Error parsing variable:", error);
        }
      });
    });
  }
};

// src/server/parsers/PackageParser.ts
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item !== void 0) {
        results[index] = await fn(item);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
var SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/i;
var VUE_SCRIPT_BLOCK_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
var ALWAYS_EXCLUDED_DIRECTORIES = /* @__PURE__ */ new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  "out"
]);
var PackageParser = class {
  constructor(packagePath, packageName, packageVersion) {
    this.packagePath = packagePath;
    this.packageName = packageName;
    this.packageVersion = packageVersion;
  }
  logger = createLogger("PackageParser");
  isAnalyzableSourceFile(fileName) {
    if (!SOURCE_FILE_PATTERN.test(fileName)) {
      return false;
    }
    if (/\.d\.[cm]?tsx?$/i.test(fileName)) {
      return false;
    }
    return true;
  }
  addNameMapping(nameMap, name, id) {
    const existing = nameMap.get(name);
    if (existing) {
      if (!existing.includes(id)) {
        existing.push(id);
      }
      return;
    }
    nameMap.set(name, [id]);
  }
  resolveUniqueName(nameMap, name) {
    const ids = nameMap.get(name);
    if (ids?.length !== 1) {
      return void 0;
    }
    return ids[0];
  }
  uniqueById(items) {
    return this.uniqueByKey(items, (item) => item.id);
  }
  uniqueByKey(items, getKey) {
    const seen = /* @__PURE__ */ new Set();
    const unique = [];
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
  buildParentMemberKey(parentId, memberName) {
    return `${parentId}:${memberName}`;
  }
  asRecord(value) {
    if (typeof value !== "object" || value === null) {
      return void 0;
    }
    return value;
  }
  asString(value) {
    if (typeof value !== "string") {
      return void 0;
    }
    return value;
  }
  parseClassExtendsRefs(refs) {
    if (!Array.isArray(refs)) {
      return [];
    }
    const parsedRefs = [];
    for (const ref of refs) {
      const parsedRef = this.asRecord(ref);
      if (!parsedRef) {
        continue;
      }
      const classId = this.asString(parsedRef["classId"]);
      const parentName = this.asString(parsedRef["parentName"]);
      if (!classId || !parentName) {
        continue;
      }
      const parentId = this.asString(parsedRef["parentId"]);
      parsedRefs.push(parentId ? { classId, parentName, parentId } : { classId, parentName });
    }
    return parsedRefs;
  }
  parseClassImplementsRefs(refs) {
    if (!Array.isArray(refs)) {
      return [];
    }
    const parsedRefs = [];
    for (const ref of refs) {
      const parsedRef = this.asRecord(ref);
      if (!parsedRef) {
        continue;
      }
      const classId = this.asString(parsedRef["classId"]);
      const interfaceName = this.asString(parsedRef["interfaceName"]);
      if (!classId || !interfaceName) {
        continue;
      }
      const interfaceId = this.asString(parsedRef["interfaceId"]);
      parsedRefs.push(interfaceId ? { classId, interfaceName, interfaceId } : { classId, interfaceName });
    }
    return parsedRefs;
  }
  parseInterfaceExtendsRefs(refs) {
    if (!Array.isArray(refs)) {
      return [];
    }
    const parsedRefs = [];
    for (const ref of refs) {
      const parsedRef = this.asRecord(ref);
      if (!parsedRef) {
        continue;
      }
      const interfaceId = this.asString(parsedRef["interfaceId"]);
      const parentName = this.asString(parsedRef["parentName"]);
      if (!interfaceId || !parentName) {
        continue;
      }
      const parentId = this.asString(parsedRef["parentId"]);
      parsedRefs.push(parentId ? { interfaceId, parentName, parentId } : { interfaceId, parentName });
    }
    return parsedRefs;
  }
  extractVueScriptContent(source) {
    const scriptBlocks = [];
    let match;
    while ((match = VUE_SCRIPT_BLOCK_PATTERN.exec(source)) !== null) {
      const attributes = match[1] ?? "";
      const scriptBody = match[2] ?? "";
      if (/\bsrc\s*=/.test(attributes)) {
        continue;
      }
      const languageMatch = /\blang\s*=\s*['"]?([a-z0-9]+)['"]?/i.exec(attributes);
      const language = languageMatch?.[1]?.toLowerCase();
      if (language && !["ts", "tsx", "js", "jsx"].includes(language)) {
        continue;
      }
      scriptBlocks.push(scriptBody);
    }
    return scriptBlocks.join("\n");
  }
  async getModuleSourceOverride(filePath) {
    if (!filePath.endsWith(".vue")) {
      return void 0;
    }
    const vueSource = await readFile2(filePath, "utf-8");
    return this.extractVueScriptContent(vueSource);
  }
  normalizePath(path) {
    return path.replace(/\\/g, "/");
  }
  shouldSkipDirectory(dirName) {
    return dirName.startsWith(".") || ALWAYS_EXCLUDED_DIRECTORIES.has(dirName);
  }
  isExcludedPath(fullPath) {
    const relativePath = this.normalizePath(relative2(this.packagePath, fullPath));
    if (relativePath.startsWith("..")) {
      return true;
    }
    return relativePath.split("/").filter((segment) => segment.length > 0).some((segment) => this.shouldSkipDirectory(segment));
  }
  async traverseDirectory(dir) {
    if (this.isExcludedPath(dir)) {
      return [];
    }
    const files = [];
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const entry of entries) {
      const fullPath = join3(dir, entry.name);
      if (entry.isDirectory()) {
        if (this.shouldSkipDirectory(entry.name)) {
          continue;
        }
        const subFiles = await this.traverseDirectory(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && this.isAnalyzableSourceFile(entry.name) && !this.isExcludedPath(fullPath)) {
        files.push(fullPath);
      }
    }
    return files;
  }
  getIncludeRoots(tsConfig, configDir) {
    const include = Array.isArray(tsConfig["include"]) ? tsConfig["include"] : [];
    const roots = /* @__PURE__ */ new Set();
    include.forEach((pattern) => {
      if (typeof pattern !== "string" || pattern.trim().length === 0) {
        return;
      }
      const normalizedPattern = this.normalizePath(pattern.trim());
      const wildcardIndex = normalizedPattern.search(/[*{]/);
      const base = wildcardIndex >= 0 ? normalizedPattern.slice(0, wildcardIndex) : normalizedPattern;
      const cleanedBase = base.endsWith("/") ? base.slice(0, -1) : base;
      const candidate = resolve(configDir, cleanedBase.length > 0 ? cleanedBase : ".");
      roots.add(candidate);
    });
    if (roots.size === 0) {
      roots.add(this.packagePath);
    }
    return Array.from(roots);
  }
  async collectFilesFromTsConfig() {
    const tsConfigPath = ts.findConfigFile(this.packagePath, (fileName) => ts.sys.fileExists(fileName), "tsconfig.json");
    if (!tsConfigPath) {
      return null;
    }
    const configDir = dirname2(tsConfigPath);
    const configResult = ts.readConfigFile(tsConfigPath, (fileName) => ts.sys.readFile(fileName));
    if (configResult.error) {
      this.logger.warn(`Failed to read tsconfig at ${tsConfigPath}, falling back to directory traversal`);
      return null;
    }
    const parsedConfig = ts.parseJsonConfigFileContent(configResult.config, ts.sys, configDir, void 0, tsConfigPath);
    if (parsedConfig.errors.length > 0) {
      this.logger.warn(`Encountered tsconfig parse errors at ${tsConfigPath}, continuing with available file list`);
    }
    const fileSet = /* @__PURE__ */ new Set();
    parsedConfig.fileNames.forEach((fileName) => {
      const absolutePath = resolve(fileName);
      if (!this.isAnalyzableSourceFile(absolutePath)) {
        return;
      }
      if (this.isExcludedPath(absolutePath)) {
        return;
      }
      fileSet.add(absolutePath);
    });
    const includeRoots = this.getIncludeRoots(configResult.config, configDir);
    for (const root of includeRoots) {
      if (this.isExcludedPath(root)) {
        continue;
      }
      const rootedFiles = await this.traverseDirectory(root);
      rootedFiles.forEach((filePath) => {
        if (filePath.endsWith(".vue")) {
          fileSet.add(resolve(filePath));
        }
      });
    }
    return Array.from(fileSet).sort((a, b) => a.localeCompare(b));
  }
  async discoverSourceFiles() {
    const filesFromTsConfig = await this.collectFilesFromTsConfig();
    if (filesFromTsConfig) {
      return filesFromTsConfig;
    }
    const files = await this.traverseDirectory(this.packagePath);
    return files.sort((a, b) => a.localeCompare(b));
  }
  async parse() {
    const packageId = generatePackageUUID(this.packageName, this.packageVersion);
    const imports = /* @__PURE__ */ new Map();
    const pkg = await readPackage({ cwd: this.packagePath });
    const pkgLock = await this.readPackageLock(this.packagePath);
    const packageDependencies = pkg;
    const dependencies = this.parseDependencies(packageDependencies, pkgLock, "dependencies", imports);
    const devDependencies = this.parseDependencies(packageDependencies, pkgLock, "devDependencies", imports);
    const peerDependencies = this.parseDependencies(packageDependencies, pkgLock, "peerDependencies", imports);
    const packageDTO = {
      id: packageId,
      name: this.packageName,
      version: this.packageVersion,
      path: this.packagePath,
      dependencies,
      devDependencies,
      peerDependencies
    };
    const modules = [];
    const classes = [];
    const interfaces = [];
    const functions = [];
    const typeAliases = [];
    const enums = [];
    const variables = [];
    const methods = [];
    const properties = [];
    const parameters = [];
    const files = await this.discoverSourceFiles();
    const moduleImports = [];
    const moduleExports = [];
    const importsWithModules = [];
    const rawClassExtends = [];
    const rawClassImplements = [];
    const rawInterfaceExtends = [];
    const symbolUsages = [];
    const parseResults = await mapWithConcurrency(files, 8, async (file) => {
      const sourceOverride = await this.getModuleSourceOverride(file);
      const moduleParser = new ModuleParser(file, packageId, sourceOverride);
      return moduleParser.parse();
    });
    for (const moduleResult of parseResults) {
      const moduleId = moduleResult.modules[0]?.id ?? "";
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
      rawClassExtends.push(...this.parseClassExtendsRefs(moduleResult.classExtends));
      rawClassImplements.push(...this.parseClassImplementsRefs(moduleResult.classImplements));
      rawInterfaceExtends.push(...this.parseInterfaceExtendsRefs(moduleResult.interfaceExtends));
      symbolUsages.push(...moduleResult.symbolUsages);
    }
    const classNameToIds = /* @__PURE__ */ new Map();
    for (const cls of classes) {
      this.addNameMapping(classNameToIds, cls.name, cls.id);
    }
    const interfaceNameToIds = /* @__PURE__ */ new Map();
    for (const iface of interfaces) {
      this.addNameMapping(interfaceNameToIds, iface.name, iface.id);
    }
    const classExtends = rawClassExtends.map((ref) => ({
      classId: ref.classId,
      parentName: ref.parentName,
      parentId: this.resolveUniqueName(classNameToIds, ref.parentName)
    }));
    const classImplements = rawClassImplements.map((ref) => ({
      classId: ref.classId,
      interfaceName: ref.interfaceName,
      interfaceId: this.resolveUniqueName(interfaceNameToIds, ref.interfaceName)
    }));
    const interfaceExtends = rawInterfaceExtends.map((ref) => ({
      interfaceId: ref.interfaceId,
      parentName: ref.parentName,
      parentId: this.resolveUniqueName(interfaceNameToIds, ref.parentName)
    }));
    const symbolReferences = this.resolveSymbolReferences(
      packageId,
      symbolUsages,
      classNameToIds,
      interfaceNameToIds,
      methods,
      properties
    );
    const uniqueModules = this.uniqueById(modules);
    const uniqueClasses = this.uniqueById(classes);
    const uniqueInterfaces = this.uniqueById(interfaces);
    const uniqueFunctions = this.uniqueById(functions);
    const uniqueTypeAliases = this.uniqueById(typeAliases);
    const uniqueEnums = this.uniqueById(enums);
    const uniqueVariables = this.uniqueById(variables);
    const uniqueMethods = this.uniqueById(methods);
    const uniqueProperties = this.uniqueById(properties);
    const uniqueParameters = this.uniqueById(parameters);
    const uniqueModuleImports = this.uniqueByKey(moduleImports, (item) => item.uuid);
    const uniqueModuleExports = this.uniqueByKey(moduleExports, (item) => item.uuid);
    const uniqueImportsWithModules = Array.from(
      new Map(importsWithModules.map((entry) => [`${entry.moduleId}:${entry.import.uuid}`, entry])).values()
    );
    const uniqueSymbolReferences = this.uniqueById(symbolReferences);
    return {
      package: packageDTO,
      modules: uniqueModules,
      classes: uniqueClasses,
      interfaces: uniqueInterfaces,
      functions: uniqueFunctions,
      typeAliases: uniqueTypeAliases,
      enums: uniqueEnums,
      variables: uniqueVariables,
      methods: uniqueMethods,
      properties: uniqueProperties,
      parameters: uniqueParameters,
      imports: [...Array.from(imports.values()), ...uniqueModuleImports],
      exports: uniqueModuleExports,
      importsWithModules: uniqueImportsWithModules,
      classExtends,
      classImplements,
      interfaceExtends,
      symbolUsages,
      symbolReferences: uniqueSymbolReferences
    };
  }
  resolveSymbolReferences(packageId, symbolUsages, classNameToIds, interfaceNameToIds, methods, properties) {
    const methodNameToIds = /* @__PURE__ */ new Map();
    const propertyNameToIds = /* @__PURE__ */ new Map();
    const methodByParentAndName = /* @__PURE__ */ new Map();
    const propertyByParentAndName = /* @__PURE__ */ new Map();
    methods.forEach((method) => {
      this.addNameMapping(methodNameToIds, method.name, method.id);
      this.addNameMapping(methodByParentAndName, this.buildParentMemberKey(method.parent_id, method.name), method.id);
    });
    properties.forEach((property) => {
      this.addNameMapping(propertyNameToIds, property.name, property.id);
      this.addNameMapping(
        propertyByParentAndName,
        this.buildParentMemberKey(property.parent_id, property.name),
        property.id
      );
    });
    const referencesById = /* @__PURE__ */ new Map();
    symbolUsages.forEach((usage) => {
      const isMethodAccess = usage.targetKind === "method";
      const byNameMap = isMethodAccess ? methodNameToIds : propertyNameToIds;
      const byParentAndNameMap = isMethodAccess ? methodByParentAndName : propertyByParentAndName;
      let targetParentId;
      if (usage.qualifierName === "this" && usage.sourceParentName && usage.sourceParentType) {
        targetParentId = usage.sourceParentType === "class" ? this.resolveUniqueName(classNameToIds, usage.sourceParentName) : this.resolveUniqueName(interfaceNameToIds, usage.sourceParentName);
      } else if (usage.qualifierName) {
        targetParentId = this.resolveUniqueName(classNameToIds, usage.qualifierName) ?? this.resolveUniqueName(interfaceNameToIds, usage.qualifierName);
      }
      let targetSymbolId;
      if (targetParentId) {
        targetSymbolId = this.resolveUniqueName(
          byParentAndNameMap,
          this.buildParentMemberKey(targetParentId, usage.targetName)
        );
      }
      targetSymbolId ??= this.resolveUniqueName(byNameMap, usage.targetName);
      if (!targetSymbolId) {
        return;
      }
      const sourceId = usage.sourceSymbolId ?? usage.moduleId;
      const id = generateRelationshipUUID(sourceId, targetSymbolId, `symbol_${usage.targetKind}`);
      referencesById.set(id, {
        id,
        package_id: packageId,
        module_id: usage.moduleId,
        source_symbol_id: usage.sourceSymbolId,
        source_symbol_type: usage.sourceSymbolType,
        source_symbol_name: usage.sourceSymbolName,
        target_symbol_id: targetSymbolId,
        target_symbol_type: usage.targetKind,
        target_symbol_name: usage.targetName,
        access_kind: usage.targetKind,
        qualifier_name: usage.qualifierName
      });
    });
    return Array.from(referencesById.values());
  }
  async readPackageLock(packageDir) {
    try {
      const lockPath = join3(packageDir, "package-lock.json");
      const content = await readFile2(lockPath, "utf-8");
      return JSON.parse(content);
    } catch {
      try {
        const lockPath = join3(packageDir, "yarn.lock");
        const content = await readFile2(lockPath, "utf-8");
        return this.parseYarnLock(content);
      } catch {
        return {};
      }
    }
  }
  parseYarnLock(content) {
    const deps = {};
    const lines = content.split("\n");
    let currentDep = "";
    for (const line of lines) {
      if (line.startsWith('"') || line.startsWith("'")) {
        const splitAt = line.split("@");
        currentDep = splitAt[0] ? splitAt[0].replace(/["']/g, "") : "";
      } else if (line.includes("version") && currentDep) {
        deps[currentDep] = {
          version: line.split('"')[1] ?? "",
          resolved: ""
        };
      } else if (line.includes("resolved") && currentDep && deps[currentDep]) {
        const entry = deps[currentDep];
        if (entry) {
          entry.resolved = line.split('"')[1] ?? "";
        }
      }
    }
    return deps;
  }
  parseDependencies(pkg, pkgLock, type, imports) {
    const deps = pkg[type];
    const depsMap = /* @__PURE__ */ new Map();
    if (!deps) return depsMap;
    for (const [name, version] of Object.entries(deps)) {
      if (typeof version !== "string" || version.length === 0) {
        continue;
      }
      const resolution = pkgLock[name]?.version ?? version;
      const dependencyId = generatePackageUUID(name, resolution);
      depsMap.set(name, dependencyId);
      if (!imports.has(name)) {
        const relativePath = `node_modules/${name}`;
        const packageImport = new PackageImport(
          generateImportUUID(this.packagePath, name),
          relativePath,
          relativePath,
          name,
          /* @__PURE__ */ new Map(),
          0,
          version,
          resolution,
          pkgLock[name]?.resolved,
          type
        );
        imports.set(name, packageImport);
      }
    }
    return depsMap;
  }
};

// src/server/cli/index.ts
var __filename = fileURLToPath2(import.meta.url);
var __dirname = dirname3(__filename);
async function safeInsert(adapter, table, columns, values) {
  const placeholders = values.map(() => "?").join(", ");
  try {
    await adapter.query(`INSERT INTO ${table} ${columns} VALUES (${placeholders})`, values);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    if (msg.includes("Duplicate") || msg.includes("UNIQUE") || msg.includes("already exists")) {
      return;
    }
    throw error;
  }
}
async function safeUpdate(adapter, table, column, value, id) {
  try {
    await adapter.query(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, [value, id]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "";
    console.warn(`Warning: failed to update ${table}.${column}:`, msg);
  }
}
function normalizeSpecifierKind(kind) {
  if (kind === "default" || kind === "type" || kind === "value" || kind === "namespace") {
    return kind;
  }
  if (kind === "typeof") {
    return "type";
  }
  return "value";
}
function serializeImportSpecifiers(imp) {
  const serialized = [];
  const sourceLabel = imp.name ?? imp.relativePath ?? imp.fullPath ?? "(side-effect)";
  if (imp.specifiers instanceof Map) {
    imp.specifiers.forEach((specifier, key) => {
      if (!specifier || typeof specifier !== "object") return;
      const entry = specifier;
      const imported = typeof entry.name === "string" && entry.name.length > 0 ? entry.name : String(key);
      const aliasFromKey = typeof key === "string" && key.length > 0 && key !== imported ? key : void 0;
      const aliasFromSet = entry.aliases instanceof Set ? Array.from(entry.aliases)[0] : void 0;
      const local = aliasFromSet ?? aliasFromKey;
      serialized.push({
        imported,
        kind: normalizeSpecifierKind(entry.kind ?? "value"),
        ...local ? { local } : {}
      });
    });
  } else if (imp.specifiers && typeof imp.specifiers === "object") {
    Object.entries(imp.specifiers).forEach(([key, value]) => {
      if (!value || typeof value !== "object") return;
      const entry = value;
      const imported = typeof entry.name === "string" && entry.name.length > 0 ? entry.name : key;
      const aliasFromKey = key !== imported ? key : void 0;
      const aliasFromArray = Array.isArray(entry.aliases) ? entry.aliases[0] : void 0;
      const local = aliasFromArray ?? aliasFromKey;
      serialized.push({
        imported,
        kind: normalizeSpecifierKind(entry.kind ?? "value"),
        ...local ? { local } : {}
      });
    });
  }
  if (serialized.length === 0) {
    serialized.push({
      imported: sourceLabel,
      kind: "sideEffect"
    });
  }
  return JSON.stringify(serialized);
}
function dedupeBy(rows, getKey) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
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
function dedupeById(rows) {
  return dedupeBy(rows, (row) => row.id);
}
function addNameToMap(nameMap, name, id) {
  const existing = nameMap.get(name);
  if (existing) {
    if (!existing.includes(id)) {
      existing.push(id);
    }
    return;
  }
  nameMap.set(name, [id]);
}
function resolveFromNameMap(explicitId, name, nameMap) {
  if (explicitId) {
    return { id: explicitId, status: "resolved" };
  }
  const matches = nameMap.get(name) ?? [];
  if (matches.length === 1) {
    return { id: matches[0], status: "resolved" };
  }
  if (matches.length > 1) {
    return { id: void 0, status: "ambiguous" };
  }
  return { id: void 0, status: "unresolved" };
}
var program = new Command();
program.name("typescript-viewer").description("TypeScript codebase visualization tool").version("1.0.0");
program.command("analyze").description("Analyze a TypeScript project").argument("<dir>", "Directory containing the TypeScript project").option("-o, --output <file>", "Output database file", "typescript-viewer.duckdb").option("--no-reset", "Do not reset the database before analyzing (append mode)").action(async (dir, options) => {
  const spinner = ora("Analyzing TypeScript project...").start();
  try {
    console.log("options.output", options.output);
    const adapter = new DuckDBAdapter(options.output, { allowWrite: true });
    const db = new Database(adapter, options.output);
    const shouldReset = options.reset !== false;
    console.log(
      "reset mode:",
      shouldReset ? "RESET (will delete existing data)" : "APPEND (will keep existing data)"
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
      symbolReference: new SymbolReferenceRepository(adapter)
    };
    spinner.text = "Parsing package.json...";
    const pkgJson = await readPackage2({ cwd: dir });
    spinner.text = "Analyzing TypeScript files...";
    const packageParser = new PackageParser(dir, pkgJson.name, pkgJson.version);
    const parseResult = await packageParser.parse();
    spinner.text = "Saving to database...";
    await adapter.transaction(async () => {
      if (parseResult.package) {
        await repositories.package.create(parseResult.package);
      }
      await repositories.module.createBatch(dedupeById(parseResult.modules));
      await repositories.class.createBatch(dedupeById(parseResult.classes));
      await repositories.interface.createBatch(dedupeById(parseResult.interfaces));
      await repositories.function.createBatch(dedupeById(parseResult.functions));
      await repositories.typeAlias.createBatch(dedupeById(parseResult.typeAliases));
      await repositories.enum.createBatch(dedupeById(parseResult.enums));
      await repositories.variable.createBatch(dedupeById(parseResult.variables));
      await repositories.method.createBatch(dedupeById(parseResult.methods));
      await repositories.parameter.createBatch(dedupeById(parseResult.parameters));
      await repositories.property.createBatch(dedupeById(parseResult.properties));
      if (parseResult.importsWithModules) {
        const dedupedImports = Array.from(
          new Map(parseResult.importsWithModules.map((entry) => [`${entry.moduleId}:${entry.import.uuid}`, entry])).values()
        );
        const importDTOs = dedupedImports.map(({ import: imp, moduleId }) => ({
          id: imp.uuid,
          package_id: parseResult.package?.id ?? "",
          module_id: moduleId,
          source: imp.relativePath,
          specifiers_json: serializeImportSpecifiers(imp)
        }));
        await repositories.import.createBatch(importDTOs);
      }
      const exportDTOs = dedupeBy(parseResult.exports, (row) => row.uuid).map((exp) => ({
        id: exp.uuid,
        package_id: parseResult.package?.id ?? "",
        module_id: exp.module,
        name: exp.name,
        is_default: exp.isDefault
      }));
      await repositories.export.createBatch(exportDTOs);
      await repositories.symbolReference.createBatch(dedupeById(parseResult.symbolReferences));
    });
    spinner.text = "Saving relationships...";
    let relationshipCount = 0;
    const relationStats = {
      classExtends: { resolved: 0, ambiguous: 0, unresolved: 0 },
      classImplements: { resolved: 0, ambiguous: 0, unresolved: 0 },
      interfaceExtends: { resolved: 0, ambiguous: 0, unresolved: 0 }
    };
    const unresolvedClassNames = [
      ...new Set(
        parseResult.classExtends.filter((ref) => !ref.parentId).map((ref) => ref.parentName)
      )
    ];
    const unresolvedInterfaceNames = [
      .../* @__PURE__ */ new Set([
        ...parseResult.classImplements.filter((ref) => !ref.interfaceId).map((ref) => ref.interfaceName),
        ...parseResult.interfaceExtends.filter((ref) => !ref.parentId).map((ref) => ref.parentName)
      ])
    ];
    const globalClassMap = /* @__PURE__ */ new Map();
    if (unresolvedClassNames.length > 0) {
      const placeholders = unresolvedClassNames.map(() => "?").join(", ");
      const classRows = await adapter.query(
        `SELECT id, name FROM classes WHERE name IN (${placeholders})`,
        unresolvedClassNames
      );
      for (const row of classRows) {
        addNameToMap(globalClassMap, row.name, row.id);
      }
    }
    const globalInterfaceMap = /* @__PURE__ */ new Map();
    if (unresolvedInterfaceNames.length > 0) {
      const placeholders = unresolvedInterfaceNames.map(() => "?").join(", ");
      const interfaceRows = await adapter.query(
        `SELECT id, name FROM interfaces WHERE name IN (${placeholders})`,
        unresolvedInterfaceNames
      );
      for (const row of interfaceRows) {
        addNameToMap(globalInterfaceMap, row.name, row.id);
      }
    }
    const classExtendsInserts = [];
    const classExtendsUpdates = [];
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
      const relId = generateRelationshipUUID(ref.classId, resolution.id, "class_extends");
      classExtendsInserts.push([relId, ref.classId, resolution.id]);
      classExtendsUpdates.push({ id: ref.classId, extendsId: resolution.id });
      relationshipCount++;
      relationStats.classExtends.resolved++;
    }
    const classImplementsInserts = [];
    for (const ref of parseResult.classImplements) {
      const resolution = resolveFromNameMap(ref.interfaceId, ref.interfaceName, globalInterfaceMap);
      if (!resolution.id) {
        relationStats.classImplements[resolution.status]++;
        continue;
      }
      const relId = generateRelationshipUUID(ref.classId, resolution.id, "class_implements");
      classImplementsInserts.push([relId, ref.classId, resolution.id]);
      relationshipCount++;
      relationStats.classImplements.resolved++;
    }
    const interfaceExtendsInserts = [];
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
      const relId = generateRelationshipUUID(ref.interfaceId, resolution.id, "interface_extends");
      interfaceExtendsInserts.push([relId, ref.interfaceId, resolution.id]);
      relationshipCount++;
      relationStats.interfaceExtends.resolved++;
    }
    await adapter.transaction(async () => {
      const CHUNK_SIZE = 500;
      for (let i = 0; i < classExtendsInserts.length; i += CHUNK_SIZE) {
        const chunk = classExtendsInserts.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => "(?, ?, ?)").join(", ");
        const params = chunk.flat();
        try {
          await adapter.query(`INSERT INTO class_extends (id, class_id, parent_id) VALUES ${placeholders}`, params);
        } catch (error) {
          const msg = error instanceof Error ? error.message : "";
          if (!msg.includes("Duplicate") && !msg.includes("UNIQUE") && !msg.includes("already exists")) {
            throw error;
          }
          for (const row of chunk) {
            await safeInsert(adapter, "class_extends", "(id, class_id, parent_id)", row);
          }
        }
      }
      for (const { id, extendsId } of classExtendsUpdates) {
        await safeUpdate(adapter, "classes", "extends_id", extendsId, id);
      }
      for (let i = 0; i < classImplementsInserts.length; i += CHUNK_SIZE) {
        const chunk = classImplementsInserts.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => "(?, ?, ?)").join(", ");
        const params = chunk.flat();
        try {
          await adapter.query(`INSERT INTO class_implements (id, class_id, interface_id) VALUES ${placeholders}`, params);
        } catch (error) {
          const msg = error instanceof Error ? error.message : "";
          if (!msg.includes("Duplicate") && !msg.includes("UNIQUE") && !msg.includes("already exists")) {
            throw error;
          }
          for (const row of chunk) {
            await safeInsert(adapter, "class_implements", "(id, class_id, interface_id)", row);
          }
        }
      }
      for (let i = 0; i < interfaceExtendsInserts.length; i += CHUNK_SIZE) {
        const chunk = interfaceExtendsInserts.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => "(?, ?, ?)").join(", ");
        const params = chunk.flat();
        try {
          await adapter.query(`INSERT INTO interface_extends (id, interface_id, extended_id) VALUES ${placeholders}`, params);
        } catch (error) {
          const msg = error instanceof Error ? error.message : "";
          if (!msg.includes("Duplicate") && !msg.includes("UNIQUE") && !msg.includes("already exists")) {
            throw error;
          }
          for (const row of chunk) {
            await safeInsert(adapter, "interface_extends", "(id, interface_id, extended_id)", row);
          }
        }
      }
    });
    spinner.succeed(chalk.green("Analysis complete!"));
    console.log();
    console.log(chalk.blue("Statistics:"));
    console.log(chalk.gray("- Files analyzed:"), parseResult.modules.length);
    console.log(chalk.gray("- Modules found:"), parseResult.modules.length);
    console.log(chalk.gray("- Classes found:"), parseResult.classes.length);
    console.log(chalk.gray("- Interfaces found:"), parseResult.interfaces.length);
    console.log(chalk.gray("- Functions found:"), parseResult.functions.length);
    console.log(chalk.gray("- Type aliases found:"), parseResult.typeAliases.length);
    console.log(chalk.gray("- Enums found:"), parseResult.enums.length);
    console.log(chalk.gray("- Variables found:"), parseResult.variables.length);
    console.log(chalk.gray("- Methods found:"), parseResult.methods.length);
    console.log(chalk.gray("- Properties found:"), parseResult.properties.length);
    console.log(chalk.gray("- Parameters found:"), parseResult.parameters.length);
    console.log(chalk.gray("- Imports found:"), parseResult.importsWithModules?.length ?? 0);
    console.log(chalk.gray("- Exports found:"), parseResult.exports.length);
    console.log(chalk.gray("- Relationships found:"), relationshipCount);
    console.log(
      chalk.gray("- class_extends resolution:"),
      "resolved=",
      relationStats.classExtends.resolved,
      "ambiguous=",
      relationStats.classExtends.ambiguous,
      "unresolved=",
      relationStats.classExtends.unresolved
    );
    console.log(
      chalk.gray("- class_implements resolution:"),
      "resolved=",
      relationStats.classImplements.resolved,
      "ambiguous=",
      relationStats.classImplements.ambiguous,
      "unresolved=",
      relationStats.classImplements.unresolved
    );
    console.log(
      chalk.gray("- interface_extends resolution:"),
      "resolved=",
      relationStats.interfaceExtends.resolved,
      "ambiguous=",
      relationStats.interfaceExtends.ambiguous,
      "unresolved=",
      relationStats.interfaceExtends.unresolved
    );
    await db.close();
  } catch (error) {
    spinner.fail(chalk.red("Analysis failed!"));
    console.error(error);
    process.exit(1);
  }
});
program.command("serve").description("Start the visualization server").argument("[file]", "Database file to visualize", "typescript-viewer.duckdb").option("-p, --port <number>", "Port to listen on", "4000").action(async (_file, options) => {
  const spinner = ora("Starting visualization server...").start();
  try {
    const { createServer } = await import("vite");
    const server = await createServer({
      configFile: join4(__dirname, "../../vite.config.ts"),
      root: join4(__dirname, "../.."),
      server: {
        port: parseInt(options.port, 10)
      }
    });
    await server.listen();
    spinner.succeed(chalk.green("Server started!"));
    console.log();
    console.log(chalk.blue("Visualization available at:"), chalk.cyan(`http://localhost:${options.port}`));
  } catch (error) {
    spinner.fail(chalk.red("Failed to start server!"));
    console.error(error);
    process.exit(1);
  }
});
function cli(args = process.argv) {
  program.parse(args);
}
export {
  cli
};
