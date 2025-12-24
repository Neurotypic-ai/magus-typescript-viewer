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
