import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { DuckDBValue } from '@duckdb/node-api';

import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IDependencyRow } from '../types/DatabaseResults';
import type { IDependencyCreateDTO, IDependencyUpdateDTO } from '../types/Dependency';
import type { DependencyType } from '../types/DependencyType';

interface IDependencyEntity {
  id: string;
  source_id: string;
  target_id: string;
  type: DependencyType;
  created_at: Date;
}

function isValidDependencyDTO(dto: unknown): dto is IDependencyCreateDTO {
  if (!dto || typeof dto !== 'object') {
    return false;
  }

  const record = dto as IDependencyCreateDTO;
  return (
    typeof record.source_id === 'string' &&
    typeof record.target_id === 'string' &&
    typeof record.type === 'string' &&
    ['dependency', 'devDependency', 'peerDependency'].includes(record.type)
  );
}

export class DependencyRepository extends BaseRepository<
  IDependencyEntity,
  IDependencyCreateDTO,
  IDependencyUpdateDTO
> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[DependencyRepository]', 'dependencies');
  }

  async create(dto: IDependencyCreateDTO): Promise<IDependencyEntity> {
    try {
      if (!isValidDependencyDTO(dto)) {
        throw new RepositoryError('Invalid dependency data', 'create', this.errorTag);
      }

      const id = `${dto.source_id}_${dto.target_id}`;
      const now = new Date().toISOString();
      const params: DuckDBValue[] = [id, dto.source_id, dto.target_id, dto.type, now];

      await this.executeQuery<IDependencyRow>(
        'create',
        'INSERT INTO dependencies (id, source_id, target_id, type, created_at) VALUES (?, ?, ?, ?, ?)',
        params
      );

      return {
        id,
        source_id: dto.source_id,
        target_id: dto.target_id,
        type: dto.type,
        created_at: new Date(now),
      };
    } catch (error) {
      // Don't log foreign key constraint errors - they're expected for external packages
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (!errorMsg.includes('foreign key constraint')) {
        this.logger.error('Failed to create dependency', error);
      }
      throw new RepositoryError('Failed to create dependency', 'create', this.errorTag, error as Error);
    }
  }

  async update(id: string, dto: IDependencyUpdateDTO): Promise<IDependencyEntity> {
    try {
      const updates = [{ field: 'type', value: (dto.type as DuckDBValue) ?? undefined }] satisfies {
        field: string;
        value: DuckDBValue | undefined;
      }[];

      if (updates.every((update) => update.value === undefined)) {
        throw new NoFieldsToUpdateError('Dependency', this.errorTag);
      }

      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);

      await this.executeQuery<IDependencyRow>('update', `UPDATE ${this.tableName} SET ${query} WHERE id = ?`, values);

      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError('Dependency', id, this.errorTag);
      }
      return result;
    } catch (error) {
      this.logger.error('Failed to update dependency', error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to update dependency', 'update', this.errorTag, error as Error);
    }
  }

  async retrieve(id?: string, module_id?: string): Promise<IDependencyEntity[]> {
    try {
      let query = 'SELECT * FROM dependencies';
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

      const results = await this.executeQuery<IDependencyRow>('retrieve', query, params);
      const dependencies: IDependencyEntity[] = [];

      for (const dep of results) {
        dependencies.push({
          id: String(dep.id),
          source_id: String(dep.source_id),
          target_id: String(dep.target_id),
          type: dep.type as DependencyType,
          created_at: new Date(String(dep.created_at)),
        });
      }

      return dependencies;
    } catch (error) {
      this.logger.error('Failed to retrieve dependency', error);
      throw new RepositoryError('Failed to retrieve dependency', 'retrieve', this.errorTag, error as Error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.executeQuery<IDependencyRow>('delete', 'DELETE FROM dependencies WHERE id = ?', [id]);
    } catch (error) {
      this.logger.error('Failed to delete dependency', error);
      throw new RepositoryError('Failed to delete dependency', 'delete', this.errorTag, error as Error);
    }
  }

  async findBySourceId(sourceId: string): Promise<IDependencyEntity[]> {
    try {
      const results = await this.executeQuery<IDependencyRow>(
        'findBySourceId',
        'SELECT * FROM dependencies WHERE source_id = ?',
        [sourceId]
      );

      return results.map((dep) => ({
        id: String(dep.id),
        source_id: String(dep.source_id),
        target_id: String(dep.target_id),
        type: dep.type as DependencyType,
        created_at: new Date(String(dep.created_at)),
      }));
    } catch (error) {
      // Be permissive: if dependency table is absent or query fails, return empty list
      this.logger.error('Failed to find dependencies by source (returning empty set)', error);
      return [];
    }
  }

  async findByTargetId(targetId: string): Promise<IDependencyEntity[]> {
    try {
      const results = await this.executeQuery<IDependencyRow>(
        'findByTargetId',
        'SELECT * FROM dependencies WHERE target_id = ?',
        [targetId]
      );

      return results.map((dep) => ({
        id: String(dep.id),
        source_id: String(dep.source_id),
        target_id: String(dep.target_id),
        type: dep.type as DependencyType,
        created_at: new Date(String(dep.created_at)),
      }));
    } catch (error) {
      this.logger.error('Failed to find dependencies by target (returning empty set)', error);
      return [];
    }
  }

  async retrieveById(id: string): Promise<IDependencyEntity | undefined> {
    const results = await this.retrieve(id);
    return results[0];
  }

  async retrieveByModuleId(module_id: string): Promise<IDependencyEntity[]> {
    return this.retrieve(undefined, module_id);
  }
}
