/**
 * Base type for all database values that can be passed as parameters
 */
export type QueryParams = unknown[];

/**
 * Define a base database row type that all results must extend
 */
export interface DatabaseRow {
  id: string;
  [key: string]: unknown;
}

/**
 * Redefine QueryResult as an array of rows with proper type constraints
 */
export type QueryResult<T extends DatabaseRow = DatabaseRow> = T[];

/**
 * Interface defining the standardized database adapter contract.
 */
export interface IDatabaseAdapter {
  /**
   * Initializes the database connection and performs any necessary setup.
   * This should be called before any other database operations.
   * @returns A promise that resolves when initialization is complete
   * @throws {Error} If initialization fails
   */
  init(): Promise<void>;

  /**
   * Executes a SQL query with optional parameters.
   * The adapter is responsible for converting parameters to the appropriate DuckDB types.
   * @template T - The expected return type of the query, must extend DatabaseRow
   * @param sql - The SQL query string to execute
   * @param params - Parameters to safely inject into the query
   * @returns A promise that resolves with the query results of type T[]
   * @throws {Error} If the query execution fails
   */
  query<T extends DatabaseRow = DatabaseRow>(sql: string, params?: QueryParams): Promise<QueryResult<T>>;

  /**
   * Closes the database connection and performs cleanup.
   * This should be called when the database connection is no longer needed.
   * @returns A promise that resolves when the connection is successfully closed
   * @throws {Error} If closing the connection fails
   */
  close(): Promise<void>;

  /**
   * Executes a callback function within a database transaction.
   * If the callback throws an error, the transaction will be rolled back.
   * If the callback completes successfully, the transaction will be committed.
   * @param callback - The function to execute within the transaction
   * @returns A promise that resolves with the callback's return value
   * @throws {Error} If the transaction fails or if the callback throws an error
   */
  transaction<T>(callback: () => Promise<T>): Promise<T>;

  /**
   * Returns the path or connection string to the database.
   * This can be useful for logging, debugging, or connection management.
   * @returns The database path or connection string
   */
  getDbPath(): string;
}
