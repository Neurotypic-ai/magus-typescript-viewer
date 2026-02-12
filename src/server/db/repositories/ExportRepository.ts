import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IDatabaseRow } from '../types/DatabaseResults';

/**
 * Data transfer object for creating a new export.
 */
export interface IExportCreateDTO {
  /**
   * The unique identifier for the export.
   */
  id: string;

  /**
   * The UUID of the parent package.
   */
  package_id: string;

  /**
   * The UUID of the parent module.
   */
  module_id: string;

  /**
   * The name of the exported symbol.
   */
  name: string;

  /**
   * Whether this is a default export.
   */
  is_default: boolean;
}

/**
 * Repository interface for managing exports.
 */
export interface IExportRepository {
  /**
   * Creates a new export.
   */
  create(dto: IExportCreateDTO): Promise<IExportCreateDTO>;

  /**
   * Finds an export by its ID.
   */
  findById(id: string): Promise<IExportCreateDTO | null>;

  /**
   * Finds all exports in a module.
   */
  findByModuleId(moduleId: string): Promise<IExportCreateDTO[]>;

  /**
   * Deletes an export by its ID.
   */
  delete(id: string): Promise<void>;
}

interface IExportUpdateDTO {
  name?: string;
  is_default?: boolean;
}

interface IExportRow extends IDatabaseRow {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  is_default: boolean;
  created_at: string;
}

export class ExportRepository extends BaseRepository<IExportCreateDTO, IExportCreateDTO, IExportUpdateDTO> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[ExportRepository]', 'exports');
  }

  /**
   * Batch-insert multiple exports at once. Ignores duplicates.
   */
  async createBatch(items: IExportCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, module_id, name, is_default)',
      5,
      items,
      (dto) => [dto.id, dto.package_id, dto.module_id, dto.name, dto.is_default]
    );
  }

  async create(dto: IExportCreateDTO): Promise<IExportCreateDTO> {
    try {
      const params: (string | boolean)[] = [dto.id, dto.package_id, dto.module_id, dto.name, dto.is_default];

      await this.executeQuery<IExportRow>(
        'create',
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
        'create',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async update(id: string, dto: IExportUpdateDTO): Promise<IExportCreateDTO> {
    try {
      const updates: { field: string; value: string | boolean }[] = [];

      if (dto.name !== undefined) {
        updates.push({ field: 'name', value: dto.name });
      }
      if (dto.is_default !== undefined) {
        updates.push({ field: 'is_default', value: dto.is_default });
      }

      if (updates.length === 0) {
        throw new NoFieldsToUpdateError('Export', this.errorTag);
      }

      const { query, values } = this.buildUpdateQuery(updates);
      const params = [...values, id];

      await this.executeQuery('update', `UPDATE exports SET ${query} WHERE id = ?`, params);

      const updated = await this.retrieveById(id);
      if (!updated) {
        throw new EntityNotFoundError('Export', id, this.errorTag);
      }

      return updated;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        `Failed to update export: ${error instanceof Error ? error.message : String(error)}`,
        'update',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async retrieveById(id: string): Promise<IExportCreateDTO | undefined> {
    try {
      const results = await this.executeQuery<IExportRow>('retrieveById', 'SELECT * FROM exports WHERE id = ?', [id]);

      if (results.length === 0) {
        return undefined;
      }

      const row = results[0];
      if (!row) {
        return undefined;
      }

      return this.mapToEntity(row);
    } catch (error) {
      throw new RepositoryError(
        `Failed to retrieve export by id: ${error instanceof Error ? error.message : String(error)}`,
        'retrieveById',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async retrieveByModuleId(module_id: string): Promise<IExportCreateDTO[]> {
    return this.retrieve(undefined, module_id);
  }

  async retrieve(id?: string, module_id?: string): Promise<IExportCreateDTO[]> {
    try {
      let query = 'SELECT * FROM exports';
      const params: string[] = [];

      if (id !== undefined) {
        query += ' WHERE id = ?';
        params.push(id);
      } else if (module_id !== undefined) {
        query += ' WHERE module_id = ?';
        params.push(module_id);
      }

      const results = await this.executeQuery<IExportRow>('retrieve', query, params);
      return results.map((row) => this.mapToEntity(row));
    } catch (error) {
      throw new RepositoryError(
        `Failed to retrieve exports: ${error instanceof Error ? error.message : String(error)}`,
        'retrieve',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.executeQuery('delete', 'DELETE FROM exports WHERE id = ?', [id]);
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete export: ${error instanceof Error ? error.message : String(error)}`,
        'delete',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async findByModuleId(moduleId: string): Promise<IExportCreateDTO[]> {
    return this.retrieveByModuleId(moduleId);
  }

  private mapToEntity(row: IExportRow): IExportCreateDTO {
    return {
      id: row.id,
      package_id: row.package_id,
      module_id: row.module_id,
      name: row.name,
      is_default: row.is_default,
    };
  }
}
