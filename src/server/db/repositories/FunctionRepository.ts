import { ModuleFunction } from '../../../shared/types/Function';
import { EntityNotFoundError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { DuckDBValue } from '@duckdb/node-api';

import type { Parameter } from '../../../shared/types/Parameter';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';

/**
 * Row type for functions table
 */
export interface IFunctionRow {
  [key: string]: string | null;
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  return_type: string | null;
  is_async: string;
  is_exported: string;
  created_at: string;
}

/**
 * Data transfer object for creating a new function.
 */
export interface IFunctionCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  return_type?: string;
  is_async?: boolean;
  is_exported?: boolean;
  has_explicit_return_type?: boolean;
}

interface IFunctionUpdateDTO {
  name?: string;
  return_type?: string;
  is_async?: boolean;
  is_exported?: boolean;
}

export class FunctionRepository extends BaseRepository<ModuleFunction, IFunctionCreateDTO, IFunctionUpdateDTO> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[FunctionRepository]', 'functions');
  }

  /**
   * Batch-insert multiple functions at once. Ignores duplicates.
   */
  async createBatch(items: IFunctionCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, module_id, name, return_type, is_async, is_exported, has_explicit_return_type)',
      8,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.name,
        dto.return_type ?? null,
        dto.is_async ?? false,
        dto.is_exported ?? false,
        dto.has_explicit_return_type ?? false,
      ]
    );
  }

  async create(dto: IFunctionCreateDTO): Promise<ModuleFunction> {
    try {
      const results = await this.executeQuery<IFunctionRow>(
        'create',
        'INSERT INTO functions (id, package_id, module_id, name, return_type, is_async, is_exported, has_explicit_return_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
        [
          dto.id,
          dto.package_id,
          dto.module_id,
          dto.name,
          dto.return_type ?? null,
          dto.is_async ?? false,
          dto.is_exported ?? false,
          dto.has_explicit_return_type ?? false,
        ]
      );

      if (results.length === 0) {
        throw new EntityNotFoundError('Function', dto.id, this.errorTag);
      }

      const func = results[0];
      if (!func) {
        throw new EntityNotFoundError('Function', dto.id, this.errorTag);
      }

      return new ModuleFunction(
        func.id,
        func.package_id,
        func.module_id,
        func.name,
        new Date(func.created_at),
        new Map<string, Parameter>(),
        func.return_type ?? 'void',
        func.is_async === 'true' || func.is_async === '1',
        func.is_exported === 'true' || func.is_exported === '1'
      );
    } catch (error) {
      this.logger.error('Failed to create function', error);
      throw new RepositoryError('Failed to create function', 'create', this.errorTag, error as Error);
    }
  }

  async update(id: string, dto: IFunctionUpdateDTO): Promise<ModuleFunction> {
    try {
      const sets: string[] = [];
      const params: DuckDBValue[] = [];

      if (dto.name !== undefined) {
        sets.push('name = ?');
        params.push(dto.name);
      }
      if (dto.return_type !== undefined) {
        sets.push('return_type = ?');
        params.push(dto.return_type);
      }
      if (dto.is_async !== undefined) {
        sets.push('is_async = ?');
        params.push(dto.is_async);
      }
      if (dto.is_exported !== undefined) {
        sets.push('is_exported = ?');
        params.push(dto.is_exported);
      }

      if (sets.length === 0) {
        const existing = await this.findById(id);
        if (!existing) {
          throw new EntityNotFoundError('Function', id, this.errorTag);
        }
        return existing;
      }

      params.push(id);
      const results = await this.executeQuery<IFunctionRow>(
        'update',
        `UPDATE functions SET ${sets.join(', ')} WHERE id = ? RETURNING *`,
        params
      );

      if (results.length === 0) {
        throw new EntityNotFoundError('Function', id, this.errorTag);
      }

      const func = results[0];
      if (!func) {
        throw new EntityNotFoundError('Function', id, this.errorTag);
      }

      return new ModuleFunction(
        func.id,
        func.package_id,
        func.module_id,
        func.name,
        new Date(func.created_at),
        new Map<string, Parameter>(),
        func.return_type ?? 'void',
        func.is_async === 'true' || func.is_async === '1',
        func.is_exported === 'true' || func.is_exported === '1'
      );
    } catch (error) {
      this.logger.error('Failed to update function', error);
      throw new RepositoryError('Failed to update function', 'update', this.errorTag, error as Error);
    }
  }

  async findById(id: string): Promise<ModuleFunction | undefined> {
    try {
      const results = await this.executeQuery<IFunctionRow>(
        'find by id',
        'SELECT * FROM functions WHERE id = ?',
        [id]
      );

      if (results.length === 0) {
        return undefined;
      }

      const func = results[0];
      if (!func) {
        return undefined;
      }

      return new ModuleFunction(
        func.id,
        func.package_id,
        func.module_id,
        func.name,
        new Date(func.created_at),
        new Map<string, Parameter>(),
        func.return_type ?? 'void',
        func.is_async === 'true' || func.is_async === '1',
        func.is_exported === 'true' || func.is_exported === '1'
      );
    } catch (error) {
      this.logger.error('Failed to find function by id', error);
      throw new RepositoryError('Failed to find function by id', 'findById', this.errorTag, error as Error);
    }
  }

  async findByModuleId(moduleId: string): Promise<ModuleFunction[]> {
    try {
      const results = await this.executeQuery<IFunctionRow>(
        'find by module id',
        'SELECT * FROM functions WHERE module_id = ? ORDER BY name',
        [moduleId]
      );

      return results.map(
        (func) =>
          new ModuleFunction(
            func.id,
            func.package_id,
            func.module_id,
            func.name,
            new Date(func.created_at),
            new Map<string, Parameter>(),
            func.return_type ?? 'void',
            func.is_async === 'true' || func.is_async === '1',
            func.is_exported === 'true' || func.is_exported === '1'
          )
      );
    } catch (error) {
      this.logger.error('Failed to find functions by module id', error);
      throw new RepositoryError(
        'Failed to find functions by module id',
        'findByModuleId',
        this.errorTag,
        error as Error
      );
    }
  }

  async retrieveByModuleIds(moduleIds: string[]): Promise<ModuleFunction[]> {
    if (moduleIds.length === 0) return [];
    try {
      const placeholders = moduleIds.map(() => '?').join(', ');
      const results = await this.executeQuery<IFunctionRow>(
        'retrieveByModuleIds',
        `SELECT * FROM functions WHERE module_id IN (${placeholders}) ORDER BY name`,
        moduleIds
      );
      return results.map((row) => this.mapToEntity(row));
    } catch (error) {
      this.logger.error('Failed to retrieve functions by module IDs', error);
      throw new RepositoryError(
        'Failed to retrieve functions by module IDs',
        'retrieveByModuleIds',
        this.errorTag,
        error as Error
      );
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.executeQuery('delete', 'DELETE FROM functions WHERE id = ?', [id]);
    } catch (error) {
      this.logger.error('Failed to delete function', error);
      throw new RepositoryError('Failed to delete function', 'delete', this.errorTag, error as Error);
    }
  }

  protected mapToEntity(row: IFunctionRow): ModuleFunction {
    return new ModuleFunction(
      row.id,
      row.package_id,
      row.module_id,
      row.name,
      new Date(row.created_at),
      new Map<string, Parameter>(),
      row.return_type ?? 'void',
      row.is_async === 'true' || row.is_async === '1',
      row.is_exported === 'true' || row.is_exported === '1'
    );
  }

  // Aliases for BaseRepository compatibility
  async retrieveById(id: string): Promise<ModuleFunction | undefined> {
    return this.findById(id);
  }

  async retrieveByModuleId(moduleId: string): Promise<ModuleFunction[]> {
    return this.findByModuleId(moduleId);
  }

  async retrieve(): Promise<ModuleFunction[]> {
    const results = await this.executeQuery<IFunctionRow>(
      'retrieve all',
      'SELECT * FROM functions ORDER BY name'
    );
    return results.map((row) => this.mapToEntity(row));
  }
}
