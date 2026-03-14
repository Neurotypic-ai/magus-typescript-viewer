import { Enum } from '../../../shared/types/Enum';
import { RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';

export interface IEnumRow {
  [key: string]: string | null;
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  members_json: string | null;
  created_at: string;
}

export interface IEnumCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  members_json?: string | undefined;
  description?: string | undefined;
}

interface IEnumUpdateDTO {
  name?: string;
  members_json?: string;
}

export class EnumRepository extends BaseRepository<Enum, IEnumCreateDTO, IEnumUpdateDTO> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[EnumRepository]', 'enums');
  }

  async createBatch(items: IEnumCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, module_id, name, members_json)',
      5,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.name,
        dto.members_json ?? null,
      ]
    );
  }

  async create(dto: IEnumCreateDTO): Promise<Enum> {
    const results = await this.executeQuery<IEnumRow>(
      'create',
      'INSERT INTO enums (id, package_id, module_id, name, members_json) VALUES (?, ?, ?, ?, ?) RETURNING *',
      [dto.id, dto.package_id, dto.module_id, dto.name, dto.members_json ?? null]
    );
    const row = results[0];
    if (!row) {
      throw new RepositoryError('Failed to create enum', 'create', this.errorTag);
    }
    return this.mapToEntity(row);
  }

  async update(id: string, dto: IEnumUpdateDTO): Promise<Enum> {
    const updates = [
      { field: 'name', value: dto.name },
      { field: 'members_json', value: dto.members_json },
    ] satisfies { field: string; value: string | undefined }[];

    const { query, values } = this.buildUpdateQuery(updates);

    if (!query) {
      const existing = await this.retrieveById(id);
      if (!existing) throw new RepositoryError('Enum not found', 'update', this.errorTag);
      return existing;
    }

    values.push(id);
    const results = await this.executeQuery<IEnumRow>(
      'update',
      `UPDATE enums SET ${query} WHERE id = ? RETURNING *`,
      values
    );
    const row = results[0];
    if (!row) throw new RepositoryError('Enum not found', 'update', this.errorTag);
    return this.mapToEntity(row);
  }

  async retrieveById(id: string): Promise<Enum | undefined> {
    const results = await this.executeQuery<IEnumRow>(
      'retrieveById',
      'SELECT * FROM enums WHERE id = ?',
      [id]
    );
    const row = results[0];
    return row ? this.mapToEntity(row) : undefined;
  }

  async retrieveByModuleId(moduleId: string): Promise<Enum[]> {
    const results = await this.executeQuery<IEnumRow>(
      'retrieveByModuleId',
      'SELECT * FROM enums WHERE module_id = ? ORDER BY name',
      [moduleId]
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async retrieveByModuleIds(moduleIds: string[]): Promise<Enum[]> {
    if (moduleIds.length === 0) return [];
    const placeholders = moduleIds.map(() => '?').join(', ');
    const results = await this.executeQuery<IEnumRow>(
      'retrieveByModuleIds',
      `SELECT * FROM enums WHERE module_id IN (${placeholders}) ORDER BY name`,
      moduleIds
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async retrieve(): Promise<Enum[]> {
    const results = await this.executeQuery<IEnumRow>(
      'retrieve all',
      'SELECT * FROM enums ORDER BY name'
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async delete(id: string): Promise<void> {
    await this.executeQuery('delete', 'DELETE FROM enums WHERE id = ?', [id]);
  }

  protected mapToEntity(row: IEnumRow): Enum {
    const rawMembers = this.parseJsonField<unknown>(row.members_json, []);
    const members = (Array.isArray(rawMembers) ? rawMembers : []).filter(
      (m): m is string => typeof m === 'string'
    );
    return new Enum(
      row.id,
      row.package_id,
      row.module_id,
      row.name,
      members,
      new Date(row.created_at)
    );
  }
}
