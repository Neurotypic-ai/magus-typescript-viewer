import { Parameter } from '../../../shared/types/Parameter';
import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { DuckDBValue } from '@duckdb/node-api';

import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IParameterRow } from '../types/DatabaseResults';

/**
 * Data transfer object for creating a new parameter.
 */
export interface IParameterCreateDTO {
  /**
   * The unique identifier for the parameter.
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
   * The UUID of the parent method.
   */
  method_id: string;

  /**
   * The name of the parameter.
   */
  name: string;

  /**
   * The type of the parameter.
   */
  type: string;

  /**
   * Whether the parameter is optional.
   */
  is_optional: boolean;

  /**
   * Whether the parameter is a rest parameter.
   */
  is_rest: boolean;

  /**
   * The default value of the parameter, if any.
   */
  default_value?: string;
}

/**
 * Repository for managing parameters in the database.
 */
export class ParameterRepository extends BaseRepository<Parameter, IParameterCreateDTO, Partial<IParameterCreateDTO>> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[ParameterRepository]', 'parameters');
  }

  async create(dto: IParameterCreateDTO): Promise<Parameter> {
    try {
      const now = new Date().toISOString();
      await this.executeQuery<IParameterRow>(
        'create',
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
          dto.default_value ?? '',
          now,
        ]
      );

      return new Parameter(
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.method_id,
        dto.name,
        new Date(),
        dto.type,
        dto.is_optional,
        dto.is_rest,
        dto.default_value
      );
    } catch (error) {
      this.logger.error('Failed to create parameter', error);
      throw new RepositoryError('Failed to create parameter', 'create', this.errorTag, error as Error);
    }
  }

  async update(id: string, dto: Partial<IParameterCreateDTO>): Promise<Parameter> {
    try {
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (dto.package_id !== undefined) {
        updates.push('package_id = ?');
        values.push(dto.package_id);
      }
      if (dto.module_id !== undefined) {
        updates.push('module_id = ?');
        values.push(dto.module_id);
      }
      if (dto.method_id !== undefined) {
        updates.push('method_id = ?');
        values.push(dto.method_id);
      }
      if (dto.name !== undefined) {
        updates.push('name = ?');
        values.push(dto.name);
      }
      if (dto.type !== undefined) {
        updates.push('type = ?');
        values.push(dto.type);
      }
      if (dto.is_optional !== undefined) {
        updates.push('is_optional = ?');
        values.push(dto.is_optional ? 1 : 0);
      }
      if (dto.is_rest !== undefined) {
        updates.push('is_rest = ?');
        values.push(dto.is_rest ? 1 : 0);
      }
      if (dto.default_value !== undefined) {
        updates.push('default_value = ?');
        values.push(dto.default_value ?? null);
      }

      if (updates.length === 0) {
        throw new NoFieldsToUpdateError('Parameter', this.errorTag);
      }

      values.push(id);
      await this.executeQuery<IParameterRow>(
        'update',
        `UPDATE parameters SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError('Parameter', id, this.errorTag);
      }
      return result;
    } catch (error) {
      this.logger.error('Failed to update parameter', error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to update parameter', 'update', this.errorTag, error as Error);
    }
  }

  async retrieve(id?: string, module_id?: string): Promise<Parameter[]> {
    try {
      let query = 'SELECT * FROM parameters';
      const params: DuckDBValue[] = [];
      const conditions: string[] = [];

      if (id) {
        conditions.push('id = ?');
        params.push(id);
      }

      if (module_id) {
        conditions.push('module_id = ?');
        params.push(module_id);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      const results = await this.executeQuery<IParameterRow>('retrieve', query, params);
      return results.map(
        (param) =>
          new Parameter(
            param.id,
            param.package_id,
            param.module_id,
            param.method_id,
            param.name,
            new Date(param.created_at),
            param.type,
            Boolean(param.is_optional),
            Boolean(param.is_rest),
            param.default_value ?? undefined
          )
      );
    } catch (error) {
      this.logger.error('Failed to retrieve parameter', error);
      throw new RepositoryError('Failed to retrieve parameter', 'retrieve', this.errorTag, error as Error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.executeQuery<IParameterRow>('delete', 'DELETE FROM parameters WHERE id = ?', [id]);
    } catch (error) {
      this.logger.error('Failed to delete parameter', error);
      throw new RepositoryError('Failed to delete parameter', 'delete', this.errorTag, error as Error);
    }
  }

  async findByMethodId(methodId: string): Promise<Parameter[]> {
    try {
      const results = await this.executeQuery<IParameterRow>(
        'findByMethodId',
        'SELECT * FROM parameters WHERE method_id = ? ORDER BY id ASC',
        [methodId]
      );

      return results.map(
        (param) =>
          new Parameter(
            String(param.id),
            String(param.package_id),
            String(param.module_id),
            String(param.method_id),
            String(param.name),
            new Date(String(param.created_at)),
            String(param.type),
            Boolean(param.is_optional),
            Boolean(param.is_rest),
            param.default_value ? String(param.default_value) : undefined
          )
      );
    } catch (error) {
      this.logger.error('Failed to find parameters by method', error);
      throw new RepositoryError('Failed to find parameters by method', 'findByMethodId', this.errorTag, error as Error);
    }
  }

  async retrieveById(id: string): Promise<Parameter | undefined> {
    const results = await this.retrieve(id);
    return results[0];
  }

  async retrieveByModuleId(module_id: string): Promise<Parameter[]> {
    return this.retrieve(undefined, module_id);
  }
}
