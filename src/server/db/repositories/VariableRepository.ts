import { Variable } from '../../../shared/types/Variable';
import { RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';

export interface IVariableRow {
  [key: string]: string | null;
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  kind: string;
  type: string | null;
  initializer: string | null;
  created_at: string;
}

export interface IVariableCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  name: string;
  kind: 'const' | 'let' | 'var';
  type?: string | undefined;
  initializer?: string | undefined;
}

interface IVariableUpdateDTO {
  name?: string;
  kind?: 'const' | 'let' | 'var';
  type?: string;
  initializer?: string;
}

export class VariableRepository extends BaseRepository<Variable, IVariableCreateDTO, IVariableUpdateDTO> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[VariableRepository]', 'variables');
  }

  async createBatch(items: IVariableCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, module_id, name, kind, type, initializer)',
      7,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.name,
        dto.kind,
        dto.type ?? null,
        dto.initializer ?? null,
      ]
    );
  }

  async create(dto: IVariableCreateDTO): Promise<Variable> {
    const results = await this.executeQuery<IVariableRow>(
      'create',
      'INSERT INTO variables (id, package_id, module_id, name, kind, type, initializer) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
      [dto.id, dto.package_id, dto.module_id, dto.name, dto.kind, dto.type ?? null, dto.initializer ?? null]
    );
    const row = results[0];
    if (!row) {
      throw new RepositoryError('Failed to create variable', 'create', this.errorTag);
    }
    return this.mapToEntity(row);
  }

  async update(id: string, dto: IVariableUpdateDTO): Promise<Variable> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (dto.name !== undefined) { sets.push('name = ?'); params.push(dto.name); }
    if (dto.kind !== undefined) { sets.push('kind = ?'); params.push(dto.kind); }
    if (dto.type !== undefined) { sets.push('type = ?'); params.push(dto.type); }
    if (dto.initializer !== undefined) { sets.push('initializer = ?'); params.push(dto.initializer); }
    if (sets.length === 0) {
      const existing = await this.retrieveById(id);
      if (!existing) throw new RepositoryError('Variable not found', 'update', this.errorTag);
      return existing;
    }
    params.push(id);
    const results = await this.executeQuery<IVariableRow>(
      'update',
      `UPDATE variables SET ${sets.join(', ')} WHERE id = ? RETURNING *`,
      params
    );
    const row = results[0];
    if (!row) throw new RepositoryError('Variable not found', 'update', this.errorTag);
    return this.mapToEntity(row);
  }

  async retrieveById(id: string): Promise<Variable | undefined> {
    const results = await this.executeQuery<IVariableRow>(
      'retrieveById',
      'SELECT * FROM variables WHERE id = ?',
      [id]
    );
    const row = results[0];
    return row ? this.mapToEntity(row) : undefined;
  }

  async retrieveByModuleId(moduleId: string): Promise<Variable[]> {
    const results = await this.executeQuery<IVariableRow>(
      'retrieveByModuleId',
      'SELECT * FROM variables WHERE module_id = ? ORDER BY name',
      [moduleId]
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async retrieveByModuleIds(moduleIds: string[]): Promise<Variable[]> {
    if (moduleIds.length === 0) return [];
    const placeholders = moduleIds.map(() => '?').join(', ');
    const results = await this.executeQuery<IVariableRow>(
      'retrieveByModuleIds',
      `SELECT * FROM variables WHERE module_id IN (${placeholders}) ORDER BY name`,
      moduleIds
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async retrieve(): Promise<Variable[]> {
    const results = await this.executeQuery<IVariableRow>(
      'retrieve all',
      'SELECT * FROM variables ORDER BY name'
    );
    return results.map((row) => this.mapToEntity(row));
  }

  async delete(id: string): Promise<void> {
    await this.executeQuery('delete', 'DELETE FROM variables WHERE id = ?', [id]);
  }

  protected mapToEntity(row: IVariableRow): Variable {
    return new Variable(
      row.id,
      row.package_id,
      row.module_id,
      row.name,
      row.kind as 'const' | 'let' | 'var',
      row.type ?? 'unknown',
      row.initializer ?? undefined,
      new Date(row.created_at)
    );
  }
}
