import { createLogger } from '../../../shared/utils/logger';
import { RepositoryError } from '../errors/RepositoryError';

import type { Logger } from '../../../shared/utils/logger';
import type { DatabaseRow, IDatabaseAdapter, QueryParams } from '../adapter/IDatabaseAdapter';

export interface IBaseEntity {
  id: string;
}

export interface IBaseRepository<T extends IBaseEntity, CreateDTO, UpdateDTO> {
  create(dto: CreateDTO): Promise<T>;
  update(id: string, dto: UpdateDTO): Promise<T>;
  retrieve(id?: string, module_id?: string): Promise<T | T[]>;
  delete(id: string): Promise<void>;
}

export class DatabaseResultError extends RepositoryError {
  constructor(message: string, operation: string, repository: string) {
    super(message, operation, repository);
    this.name = 'DatabaseResultError';
  }
}

export abstract class BaseRepository<T extends IBaseEntity, CreateDTO, UpdateDTO>
  implements IBaseRepository<T, CreateDTO, UpdateDTO>
{
  protected adapter: IDatabaseAdapter;
  protected readonly errorTag: string;
  protected readonly tableName: string;
  protected readonly logger: Logger;

  constructor(adapter: IDatabaseAdapter, errorTag: string, tableName: string) {
    this.adapter = adapter;
    this.errorTag = errorTag;
    this.tableName = tableName;
    this.logger = createLogger(errorTag);
  }

  abstract create(dto: CreateDTO): Promise<T>;
  abstract update(id: string, dto: UpdateDTO): Promise<T>;
  abstract retrieveById(id: string): Promise<T | undefined>;
  abstract retrieveByModuleId(module_id: string): Promise<T[]>;
  abstract retrieve(id?: string, module_id?: string): Promise<T[]>;
  abstract delete(id: string): Promise<void>;

  protected isDatabaseRow(item: unknown): item is DatabaseRow {
    if (item === null || typeof item !== 'object') {
      return false;
    }

    const record = item as Record<string, unknown>;
    return 'id' in record && typeof record['id'] === 'string';
  }

  protected isArrayOfDatabaseRows<R extends DatabaseRow>(data: unknown): data is R[] {
    if (!Array.isArray(data)) {
      return false;
    }

    return data.every((item) => this.isDatabaseRow(item));
  }

  protected async executeQuery<R extends DatabaseRow>(
    operation: string,
    query: string,
    params: QueryParams = []
  ): Promise<R[]> {
    try {
      this.logger.debug(`Executing ${operation}:`, {
        query,
        params,
        table: this.tableName,
      });

      const result = await this.adapter.query<R>(query, params);

      this.logger.debug(`Query results for ${operation}:`, {
        count: result.length,
        table: this.tableName,
      });

      if (!this.isArrayOfDatabaseRows<R>(result)) {
        throw new DatabaseResultError(
          `Query result is not an array of database rows for operation '${operation}'`,
          operation,
          this.errorTag
        );
      }

      return result;
    } catch (error) {
      // If it's already a RepositoryError, just rethrow it
      if (error instanceof RepositoryError) {
        throw error;
      }

      // For prepared statement errors, include query details in the error metadata
      if (error instanceof Error && error.message.includes('prepared statement')) {
        throw new RepositoryError(
          `Database operation '${operation}' failed in ${this.tableName}: ${error.message}`,
          operation,
          this.errorTag,
          error
        );
      }

      // For all other errors, wrap them in a RepositoryError with context
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
  protected async executeBatchInsert<D>(
    columns: string,
    columnCount: number,
    items: D[],
    itemToParams: (item: D) => QueryParams,
    chunkSize = 500
  ): Promise<void> {
    if (items.length === 0) return;

    const singleRowPlaceholder = `(${Array.from({ length: columnCount }, () => '?').join(', ')})`;

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => singleRowPlaceholder).join(', ');
      const params = chunk.flatMap(itemToParams);
      try {
        await this.adapter.query(
          `INSERT INTO ${this.tableName} ${columns} VALUES ${placeholders}`,
          params
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        // Ignore duplicate constraint violations
        if (msg.includes('Duplicate') || msg.includes('UNIQUE') || msg.includes('already exists')) {
          // Fall back to individual inserts for this chunk to skip only the duplicates
          for (const item of chunk) {
            try {
              await this.adapter.query(
                `INSERT INTO ${this.tableName} ${columns} VALUES ${singleRowPlaceholder}`,
                itemToParams(item)
              );
            } catch (innerError) {
              const innerMsg = innerError instanceof Error ? innerError.message : '';
              if (innerMsg.includes('Duplicate') || innerMsg.includes('UNIQUE') || innerMsg.includes('already exists')) {
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

  protected buildUpdateQuery(updates: { field: string; value: unknown }[]): {
    query: string;
    values: QueryParams;
  } {
    const validUpdates = updates.filter((update) => update.value !== undefined);
    const setClauses = validUpdates.map((update) => `${update.field} = ?`);
    const values = validUpdates.map((update) => update.value);

    return {
      query: setClauses.join(', '),
      values,
    };
  }
}
