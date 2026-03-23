import { TypeAlias } from '../../../shared/types/TypeAlias';
import { RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { ITypeAliasCreateDTO, ITypeAliasUpdateDTO } from '../../../shared/types/dto/TypeAliasDTO';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { ITypeAliasRow } from '../types/DatabaseResults';

export class TypeAliasRepository extends BaseRepository<TypeAlias, ITypeAliasCreateDTO, ITypeAliasUpdateDTO> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[TypeAliasRepository]', 'type_aliases');
  }

  async createBatch(items: ITypeAliasCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, module_id, name, type, type_parameters_json)',
      6,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.name,
        dto.type,
        dto.type_parameters_json ?? null,
      ]
    );
  }

  async create(dto: ITypeAliasCreateDTO): Promise<TypeAlias> {
    const results = await this.executeQuery<ITypeAliasRow>(
      'create',
      'INSERT INTO type_aliases (id, package_id, module_id, name, type, type_parameters_json) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
      [dto.id, dto.package_id, dto.module_id, dto.name, dto.type, dto.type_parameters_json ?? null]
    );
    const row = results[0];
    if (!row) {
      throw new RepositoryError('Failed to create type alias', 'create', this.errorTag);
    }
    return this.mapToEntity(row);
  }

  async update(id: string, dto: ITypeAliasUpdateDTO): Promise<TypeAlias> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (dto.name !== undefined) { sets.push('name = ?'); params.push(dto.name); }
    if (dto.type !== undefined) { sets.push('type = ?'); params.push(dto.type); }
    if (dto.type_parameters_json !== undefined) { sets.push('type_parameters_json = ?'); params.push(dto.type_parameters_json); }
    if (sets.length === 0) {
      const existing = await this.retrieveById(id);
      if (!existing) throw new RepositoryError('Type alias not found', 'update', this.errorTag);
      return existing;
    }
    params.push(id);
    const results = await this.executeQuery<ITypeAliasRow>(
      'update',
      `UPDATE type_aliases SET ${sets.join(', ')} WHERE id = ? RETURNING *`,
      params
    );
    const row = results[0];
    if (!row) throw new RepositoryError('Type alias not found', 'update', this.errorTag);
    return this.mapToEntity(row);
  }

  async retrieveById(id: string): Promise<TypeAlias | undefined> {
    const results = await this.executeQuery<ITypeAliasRow>(
      'retrieveById',
      'SELECT * FROM type_aliases WHERE id = ?',
      [id]
    );
    const row = results[0];
    return row ? this.mapToEntity(row) : undefined;
  }

  async retrieveByModuleId(moduleId: string): Promise<TypeAlias[]> {
    const results = await this.executeQuery<ITypeAliasRow>(
      'retrieveByModuleId',
      'SELECT * FROM type_aliases WHERE module_id = ? ORDER BY name',
      [moduleId]
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async retrieveByModuleIds(moduleIds: string[]): Promise<TypeAlias[]> {
    if (moduleIds.length === 0) return [];
    const placeholders = moduleIds.map(() => '?').join(', ');
    const results = await this.executeQuery<ITypeAliasRow>(
      'retrieveByModuleIds',
      `SELECT * FROM type_aliases WHERE module_id IN (${placeholders}) ORDER BY name`,
      moduleIds
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async retrieve(): Promise<TypeAlias[]> {
    const results = await this.executeQuery<ITypeAliasRow>(
      'retrieve all',
      'SELECT * FROM type_aliases ORDER BY name'
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async delete(id: string): Promise<void> {
    await this.executeQuery('delete', 'DELETE FROM type_aliases WHERE id = ?', [id]);
  }

  protected mapToEntity(row: ITypeAliasRow): TypeAlias {
    let typeParameters: string[] = [];
    if (row.type_parameters_json) {
      try {
        const parsed: unknown = JSON.parse(row.type_parameters_json);
        if (Array.isArray(parsed)) {
          typeParameters = parsed.filter((p): p is string => typeof p === 'string');
        }
      } catch {
        // Invalid JSON — default to empty array
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
}
