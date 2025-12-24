import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IDatabaseRow } from '../types/DatabaseResults';

/**
 * Data transfer object for creating a new import.
 */
export interface IImportCreateDTO {
  /**
   * The unique identifier for the import.
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
   * The source path of the import.
   */
  source: string;
}

/**
 * Repository interface for managing imports.
 */
export interface IImportRepository {
  /**
   * Creates a new import.
   */
  create(dto: IImportCreateDTO): Promise<IImportCreateDTO>;

  /**
   * Finds an import by its ID.
   */
  findById(id: string): Promise<IImportCreateDTO | null>;

  /**
   * Finds all imports in a module.
   */
  findByModuleId(moduleId: string): Promise<IImportCreateDTO[]>;

  /**
   * Deletes an import by its ID.
   */
  delete(id: string): Promise<void>;
}

interface IImportUpdateDTO {
  source?: string;
}

interface IImportRow extends IDatabaseRow {
  id: string;
  package_id: string;
  module_id: string;
  source: string;
  created_at: string;
}

export class ImportRepository extends BaseRepository<IImportCreateDTO, IImportCreateDTO, IImportUpdateDTO> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[ImportRepository]', 'imports');
  }

  async create(dto: IImportCreateDTO): Promise<IImportCreateDTO> {
    try {
      const params: string[] = [dto.id, dto.package_id, dto.module_id, dto.source];

      await this.executeQuery<IImportRow>(
        'create',
        `
        INSERT INTO imports (id, package_id, module_id, source)
        VALUES (?, ?, ?, ?)
      `,
        params
      );

      return dto;
    } catch (error) {
      throw new RepositoryError(
        `Failed to create import: ${error instanceof Error ? error.message : String(error)}`,
        'create',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async update(id: string, dto: IImportUpdateDTO): Promise<IImportCreateDTO> {
    try {
      const updates: { field: string; value: string }[] = [];

      if (dto.source !== undefined) {
        updates.push({ field: 'source', value: dto.source });
      }

      if (updates.length === 0) {
        throw new NoFieldsToUpdateError('Import', this.errorTag);
      }

      const { query, values } = this.buildUpdateQuery(updates);
      const params = [...values, id];

      await this.executeQuery('update', `UPDATE imports SET ${query} WHERE id = ?`, params);

      const updated = await this.retrieveById(id);
      if (!updated) {
        throw new EntityNotFoundError('Import', id, this.errorTag);
      }

      return updated;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        `Failed to update import: ${error instanceof Error ? error.message : String(error)}`,
        'update',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async retrieveById(id: string): Promise<IImportCreateDTO | undefined> {
    try {
      const results = await this.executeQuery<IImportRow>('retrieveById', 'SELECT * FROM imports WHERE id = ?', [id]);

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
        `Failed to retrieve import by id: ${error instanceof Error ? error.message : String(error)}`,
        'retrieveById',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async retrieveByModuleId(module_id: string): Promise<IImportCreateDTO[]> {
    return this.retrieve(undefined, module_id);
  }

  async retrieve(id?: string, module_id?: string): Promise<IImportCreateDTO[]> {
    try {
      let query = 'SELECT * FROM imports';
      const params: string[] = [];

      if (id !== undefined) {
        query += ' WHERE id = ?';
        params.push(id);
      } else if (module_id !== undefined) {
        query += ' WHERE module_id = ?';
        params.push(module_id);
      }

      const results = await this.executeQuery<IImportRow>('retrieve', query, params);
      return results.map((row) => this.mapToEntity(row));
    } catch (error) {
      throw new RepositoryError(
        `Failed to retrieve imports: ${error instanceof Error ? error.message : String(error)}`,
        'retrieve',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.executeQuery('delete', 'DELETE FROM imports WHERE id = ?', [id]);
    } catch (error) {
      throw new RepositoryError(
        `Failed to delete import: ${error instanceof Error ? error.message : String(error)}`,
        'delete',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async findByModuleId(moduleId: string): Promise<IImportCreateDTO[]> {
    return this.retrieveByModuleId(moduleId);
  }

  private mapToEntity(row: IImportRow): IImportCreateDTO {
    return {
      id: row.id,
      package_id: row.package_id,
      module_id: row.module_id,
      source: row.source,
    };
  }
}
