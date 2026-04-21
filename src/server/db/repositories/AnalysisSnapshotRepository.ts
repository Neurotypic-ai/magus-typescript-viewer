import { BaseRepository } from './BaseRepository';

import type {
  IAnalysisSnapshotCreateDTO,
  IAnalysisSnapshotRow,
} from '../../../shared/types/dto/AnalysisSnapshotDTO';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';

/**
 * Local domain shape for an analysis snapshot.
 * Extends the DTO row and adds the index signature required by BaseRepository.executeQuery.
 */
export interface AnalysisSnapshot extends IAnalysisSnapshotRow {
  [key: string]: unknown;
}

export class AnalysisSnapshotRepository extends BaseRepository<
  AnalysisSnapshot,
  IAnalysisSnapshotCreateDTO,
  never
> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[AnalysisSnapshotRepository]', 'analysis_snapshots');
  }

  async createBatch(items: IAnalysisSnapshotCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, created_at, analyzer_versions_json, config_json, duration_ms)',
      6,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.created_at ?? null,
        dto.analyzer_versions_json ?? null,
        dto.config_json ?? null,
        dto.duration_ms ?? null,
      ]
    );
  }

  async create(dto: IAnalysisSnapshotCreateDTO): Promise<AnalysisSnapshot> {
    const results = await this.executeQuery<AnalysisSnapshot>(
      'create',
      `INSERT INTO analysis_snapshots (id, package_id, created_at, analyzer_versions_json, config_json, duration_ms)
       VALUES (?, ?, COALESCE(?, current_timestamp), ?, ?, ?) RETURNING *`,
      [
        dto.id,
        dto.package_id,
        dto.created_at ?? null,
        dto.analyzer_versions_json ?? null,
        dto.config_json ?? null,
        dto.duration_ms ?? null,
      ]
    );
    const row = results[0];
    if (!row) {
      throw new Error('Failed to create analysis snapshot');
    }
    return row;
  }

  update(_id: string, _dto: never): Promise<AnalysisSnapshot> {
    throw new Error('Updates not supported for AnalysisSnapshotRepository');
  }

  async retrieveById(id: string): Promise<AnalysisSnapshot | undefined> {
    const results = await this.executeQuery<AnalysisSnapshot>(
      'retrieveById',
      'SELECT * FROM analysis_snapshots WHERE id = ?',
      [id]
    );
    return results[0];
  }

  async retrieveByPackageId(packageId: string): Promise<AnalysisSnapshot[]> {
    const results = await this.executeQuery<AnalysisSnapshot>(
      'retrieveByPackageId',
      'SELECT * FROM analysis_snapshots WHERE package_id = ? ORDER BY created_at DESC',
      [packageId]
    );
    return results;
  }

  async retrieveByModuleId(_moduleId: string): Promise<AnalysisSnapshot[]> {
    // analysis_snapshots has no module_id column
    return [];
  }

  async retrieve(): Promise<AnalysisSnapshot[]> {
    const results = await this.executeQuery<AnalysisSnapshot>(
      'retrieveAll',
      'SELECT * FROM analysis_snapshots ORDER BY created_at DESC'
    );
    return results;
  }

  async delete(id: string): Promise<void> {
    // DuckDB doesn't support ON DELETE CASCADE — remove dependents manually first.
    await this.executeQuery('deleteArchViolations', 'DELETE FROM architectural_violations WHERE snapshot_id = ?', [id]);
    await this.executeQuery('deleteEntityMetrics', 'DELETE FROM entity_metrics WHERE snapshot_id = ?', [id]);
    await this.executeQuery('delete', 'DELETE FROM analysis_snapshots WHERE id = ?', [id]);
  }

  async deleteByPackageId(packageId: string): Promise<void> {
    // Clean up dependents first to satisfy FK constraints.
    await this.executeQuery(
      'deleteArchViolationsForPackage',
      `DELETE FROM architectural_violations
       WHERE snapshot_id IN (SELECT id FROM analysis_snapshots WHERE package_id = ?)`,
      [packageId]
    );
    await this.executeQuery(
      'deleteEntityMetricsForPackage',
      `DELETE FROM entity_metrics
       WHERE snapshot_id IN (SELECT id FROM analysis_snapshots WHERE package_id = ?)`,
      [packageId]
    );
    await this.executeQuery(
      'deleteByPackageId',
      'DELETE FROM analysis_snapshots WHERE package_id = ?',
      [packageId]
    );
  }
}
