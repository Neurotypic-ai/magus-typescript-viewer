import { BaseRepository } from './BaseRepository';

import type { ICallEdgeCreateDTO, ICallEdgeRow } from '../../../shared/types/dto/CallEdgeDTO';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';

/**
 * Local domain shape for a call-graph edge.
 * Extends the DTO row and adds the index signature required by BaseRepository.executeQuery.
 */
interface CallEdge extends ICallEdgeRow {
  [key: string]: unknown;
}

export class CallEdgeRepository extends BaseRepository<CallEdge, ICallEdgeCreateDTO, never> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[CallEdgeRepository]', 'call_edges');
  }

  async createBatch(items: ICallEdgeCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, module_id, source_entity_id, source_entity_type, target_entity_id, target_entity_type, target_name, target_qualifier, call_expression_line, is_async_call, is_awaited, resolution_status)',
      13,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.source_entity_id,
        dto.source_entity_type,
        dto.target_entity_id ?? null,
        dto.target_entity_type ?? null,
        dto.target_name ?? null,
        dto.target_qualifier ?? null,
        dto.call_expression_line ?? null,
        (dto.is_async_call ?? false) ? 1 : 0,
        (dto.is_awaited ?? false) ? 1 : 0,
        dto.resolution_status,
      ]
    );
  }

  async create(dto: ICallEdgeCreateDTO): Promise<CallEdge> {
    const results = await this.executeQuery<CallEdge>(
      'create',
      `INSERT INTO call_edges (id, package_id, module_id, source_entity_id, source_entity_type, target_entity_id, target_entity_type, target_name, target_qualifier, call_expression_line, is_async_call, is_awaited, resolution_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.source_entity_id,
        dto.source_entity_type,
        dto.target_entity_id ?? null,
        dto.target_entity_type ?? null,
        dto.target_name ?? null,
        dto.target_qualifier ?? null,
        dto.call_expression_line ?? null,
        (dto.is_async_call ?? false) ? 1 : 0,
        (dto.is_awaited ?? false) ? 1 : 0,
        dto.resolution_status,
      ]
    );
    const row = results[0];
    if (!row) {
      throw new Error('Failed to create call edge');
    }
    return row;
  }

  update(_id: string, _dto: never): Promise<CallEdge> {
    throw new Error('Updates not supported for CallEdgeRepository');
  }

  async retrieveById(id: string): Promise<CallEdge | undefined> {
    const results = await this.executeQuery<CallEdge>('retrieveById', 'SELECT * FROM call_edges WHERE id = ?', [id]);
    return results[0];
  }

  async retrieveByPackageId(packageId: string): Promise<CallEdge[]> {
    const results = await this.executeQuery<CallEdge>(
      'retrieveByPackageId',
      'SELECT * FROM call_edges WHERE package_id = ?',
      [packageId]
    );
    return results;
  }

  async retrieveByModuleId(moduleId: string): Promise<CallEdge[]> {
    const results = await this.executeQuery<CallEdge>(
      'retrieveByModuleId',
      'SELECT * FROM call_edges WHERE module_id = ?',
      [moduleId]
    );
    return results;
  }

  async retrieve(): Promise<CallEdge[]> {
    const results = await this.executeQuery<CallEdge>(
      'retrieveAll',
      'SELECT * FROM call_edges ORDER BY module_id, source_entity_id'
    );
    return results;
  }

  async delete(id: string): Promise<void> {
    await this.executeQuery('delete', 'DELETE FROM call_edges WHERE id = ?', [id]);
  }

  async deleteByPackageId(packageId: string): Promise<void> {
    await this.executeQuery('deleteByPackageId', 'DELETE FROM call_edges WHERE package_id = ?', [packageId]);
  }
}
