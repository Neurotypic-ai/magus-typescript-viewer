import { BaseRepository } from './BaseRepository';

import type { IEntityMetricCreateDTO, IEntityMetricRow } from '../../../shared/types/dto/EntityMetricDTO';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';

/**
 * Local domain shape for an entity metric.
 * Extends the DTO row and adds the index signature required by BaseRepository.executeQuery.
 */
export interface EntityMetric extends IEntityMetricRow {
  [key: string]: unknown;
}

export class EntityMetricRepository extends BaseRepository<EntityMetric, IEntityMetricCreateDTO, never> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[EntityMetricRepository]', 'entity_metrics');
  }

  async createBatch(items: IEntityMetricCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, snapshot_id, package_id, module_id, entity_id, entity_type, metric_key, metric_value, metric_category)',
      9,
      items,
      (dto) => [
        dto.id,
        dto.snapshot_id,
        dto.package_id,
        dto.module_id ?? null,
        dto.entity_id,
        dto.entity_type,
        dto.metric_key,
        dto.metric_value,
        dto.metric_category,
      ]
    );
  }

  async create(dto: IEntityMetricCreateDTO): Promise<EntityMetric> {
    const results = await this.executeQuery<EntityMetric>(
      'create',
      `INSERT INTO entity_metrics (id, snapshot_id, package_id, module_id, entity_id, entity_type, metric_key, metric_value, metric_category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        dto.id,
        dto.snapshot_id,
        dto.package_id,
        dto.module_id ?? null,
        dto.entity_id,
        dto.entity_type,
        dto.metric_key,
        dto.metric_value,
        dto.metric_category,
      ]
    );
    const row = results[0];
    if (!row) {
      throw new Error('Failed to create entity metric');
    }
    return row;
  }

  update(_id: string, _dto: never): Promise<EntityMetric> {
    throw new Error('Updates not supported for EntityMetricRepository');
  }

  async retrieveById(id: string): Promise<EntityMetric | undefined> {
    const results = await this.executeQuery<EntityMetric>(
      'retrieveById',
      'SELECT * FROM entity_metrics WHERE id = ?',
      [id]
    );
    return results[0];
  }

  async retrieveBySnapshotId(snapshotId: string): Promise<EntityMetric[]> {
    const results = await this.executeQuery<EntityMetric>(
      'retrieveBySnapshotId',
      'SELECT * FROM entity_metrics WHERE snapshot_id = ?',
      [snapshotId]
    );
    return results;
  }

  async retrieveByModuleId(moduleId: string): Promise<EntityMetric[]> {
    const results = await this.executeQuery<EntityMetric>(
      'retrieveByModuleId',
      'SELECT * FROM entity_metrics WHERE module_id = ?',
      [moduleId]
    );
    return results;
  }

  async retrieve(): Promise<EntityMetric[]> {
    const results = await this.executeQuery<EntityMetric>(
      'retrieveAll',
      'SELECT * FROM entity_metrics ORDER BY snapshot_id, metric_key'
    );
    return results;
  }

  async delete(id: string): Promise<void> {
    await this.executeQuery('delete', 'DELETE FROM entity_metrics WHERE id = ?', [id]);
  }

  async deleteBySnapshotId(snapshotId: string): Promise<void> {
    await this.executeQuery(
      'deleteBySnapshotId',
      'DELETE FROM entity_metrics WHERE snapshot_id = ?',
      [snapshotId]
    );
  }
}
