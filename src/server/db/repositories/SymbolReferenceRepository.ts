import { EntityNotFoundError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IDatabaseRow } from '../types/DatabaseResults';

export type SymbolSourceType = 'module' | 'class' | 'interface' | 'function' | 'method' | 'property';
export type SymbolTargetType = 'method' | 'property';

export interface ISymbolReferenceCreateDTO {
  id: string;
  package_id: string;
  module_id: string;
  source_symbol_id?: string | undefined;
  source_symbol_type: SymbolSourceType;
  source_symbol_name?: string | undefined;
  target_symbol_id: string;
  target_symbol_type: SymbolTargetType;
  target_symbol_name: string;
  access_kind: SymbolTargetType;
  qualifier_name?: string | undefined;
}

interface ISymbolReferenceUpdateDTO {
  source_symbol_id?: string;
  source_symbol_type?: SymbolSourceType;
  source_symbol_name?: string;
  target_symbol_id?: string;
  target_symbol_type?: SymbolTargetType;
  target_symbol_name?: string;
  access_kind?: SymbolTargetType;
  qualifier_name?: string;
}

interface ISymbolReferenceRow extends IDatabaseRow {
  package_id: string;
  module_id: string;
  source_symbol_id: string | null;
  source_symbol_type: SymbolSourceType;
  source_symbol_name: string | null;
  target_symbol_id: string;
  target_symbol_type: SymbolTargetType;
  target_symbol_name: string;
  access_kind: SymbolTargetType;
  qualifier_name: string | null;
}

export class SymbolReferenceRepository extends BaseRepository<
  ISymbolReferenceCreateDTO,
  ISymbolReferenceCreateDTO,
  ISymbolReferenceUpdateDTO
> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[SymbolReferenceRepository]', 'symbol_references');
  }

  async create(dto: ISymbolReferenceCreateDTO): Promise<ISymbolReferenceCreateDTO> {
    try {
      await this.executeQuery<ISymbolReferenceRow>(
        'create',
        `INSERT INTO symbol_references (
          id,
          package_id,
          module_id,
          source_symbol_id,
          source_symbol_type,
          source_symbol_name,
          target_symbol_id,
          target_symbol_type,
          target_symbol_name,
          access_kind,
          qualifier_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          dto.id,
          dto.package_id,
          dto.module_id,
          dto.source_symbol_id ?? null,
          dto.source_symbol_type,
          dto.source_symbol_name ?? null,
          dto.target_symbol_id,
          dto.target_symbol_type,
          dto.target_symbol_name,
          dto.access_kind,
          dto.qualifier_name ?? null,
        ]
      );
      return dto;
    } catch (error) {
      throw new RepositoryError(
        `Failed to create symbol reference: ${error instanceof Error ? error.message : String(error)}`,
        'create',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async update(id: string, dto: ISymbolReferenceUpdateDTO): Promise<ISymbolReferenceCreateDTO> {
    try {
      const updates = [
        { field: 'source_symbol_id', value: dto.source_symbol_id ?? undefined },
        { field: 'source_symbol_type', value: dto.source_symbol_type ?? undefined },
        { field: 'source_symbol_name', value: dto.source_symbol_name ?? undefined },
        { field: 'target_symbol_id', value: dto.target_symbol_id ?? undefined },
        { field: 'target_symbol_type', value: dto.target_symbol_type ?? undefined },
        { field: 'target_symbol_name', value: dto.target_symbol_name ?? undefined },
        { field: 'access_kind', value: dto.access_kind ?? undefined },
        { field: 'qualifier_name', value: dto.qualifier_name ?? undefined },
      ];
      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);

      await this.executeQuery<ISymbolReferenceRow>(
        'update',
        `UPDATE symbol_references SET ${query} WHERE id = ?`,
        values
      );

      const updated = await this.retrieveById(id);
      if (!updated) {
        throw new EntityNotFoundError('SymbolReference', id, this.errorTag);
      }
      return updated;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        `Failed to update symbol reference: ${error instanceof Error ? error.message : String(error)}`,
        'update',
        this.errorTag,
        error instanceof Error ? error : undefined
      );
    }
  }

  async retrieveById(id: string): Promise<ISymbolReferenceCreateDTO | undefined> {
    const rows = await this.executeQuery<ISymbolReferenceRow>(
      'retrieveById',
      'SELECT * FROM symbol_references WHERE id = ?',
      [id]
    );
    const row = rows[0];
    return row ? this.mapRow(row) : undefined;
  }

  async retrieveByModuleId(module_id: string): Promise<ISymbolReferenceCreateDTO[]> {
    return this.retrieve(undefined, module_id);
  }

  async retrieve(id?: string, module_id?: string): Promise<ISymbolReferenceCreateDTO[]> {
    let query = 'SELECT * FROM symbol_references';
    const params: string[] = [];
    if (id !== undefined) {
      query += ' WHERE id = ?';
      params.push(id);
    } else if (module_id !== undefined) {
      query += ' WHERE module_id = ?';
      params.push(module_id);
    }

    const rows = await this.executeQuery<ISymbolReferenceRow>('retrieve', query, params);
    return rows.map((row) => this.mapRow(row));
  }

  async delete(id: string): Promise<void> {
    await this.executeQuery<ISymbolReferenceRow>('delete', 'DELETE FROM symbol_references WHERE id = ?', [id]);
  }

  async findByModuleId(moduleId: string): Promise<ISymbolReferenceCreateDTO[]> {
    return this.retrieveByModuleId(moduleId);
  }

  private mapRow(row: ISymbolReferenceRow): ISymbolReferenceCreateDTO {
    return {
      id: row.id,
      package_id: row.package_id,
      module_id: row.module_id,
      source_symbol_id: row.source_symbol_id ?? undefined,
      source_symbol_type: row.source_symbol_type,
      source_symbol_name: row.source_symbol_name ?? undefined,
      target_symbol_id: row.target_symbol_id,
      target_symbol_type: row.target_symbol_type,
      target_symbol_name: row.target_symbol_name,
      access_kind: row.access_kind,
      qualifier_name: row.qualifier_name ?? undefined,
    };
  }
}
