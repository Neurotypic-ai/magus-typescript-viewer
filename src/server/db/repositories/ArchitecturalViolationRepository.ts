import { BaseRepository } from './BaseRepository';

import type {
  IArchitecturalViolationCreateDTO,
  IArchitecturalViolationRow,
} from '../../../shared/types/dto/ArchitecturalViolationDTO';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';

/**
 * Local domain shape for an architectural-rule violation.
 * Extends the DTO row and adds the index signature required by BaseRepository.executeQuery.
 */
export interface ArchitecturalViolation extends IArchitecturalViolationRow {
  [key: string]: unknown;
}

export class ArchitecturalViolationRepository extends BaseRepository<
  ArchitecturalViolation,
  IArchitecturalViolationCreateDTO,
  never
> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[ArchitecturalViolationRepository]', 'architectural_violations');
  }

  async createBatch(items: IArchitecturalViolationCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, snapshot_id, package_id, rule_name, source_module_id, target_module_id, source_layer, target_layer, severity, message)',
      10,
      items,
      (dto) => [
        dto.id,
        dto.snapshot_id,
        dto.package_id,
        dto.rule_name,
        dto.source_module_id ?? null,
        dto.target_module_id ?? null,
        dto.source_layer ?? null,
        dto.target_layer ?? null,
        dto.severity,
        dto.message,
      ]
    );
  }

  async create(dto: IArchitecturalViolationCreateDTO): Promise<ArchitecturalViolation> {
    const results = await this.executeQuery<ArchitecturalViolation>(
      'create',
      `INSERT INTO architectural_violations (id, snapshot_id, package_id, rule_name, source_module_id, target_module_id, source_layer, target_layer, severity, message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        dto.id,
        dto.snapshot_id,
        dto.package_id,
        dto.rule_name,
        dto.source_module_id ?? null,
        dto.target_module_id ?? null,
        dto.source_layer ?? null,
        dto.target_layer ?? null,
        dto.severity,
        dto.message,
      ]
    );
    const row = results[0];
    if (!row) {
      throw new Error('Failed to create architectural violation');
    }
    return row;
  }

  update(_id: string, _dto: never): Promise<ArchitecturalViolation> {
    throw new Error('Updates not supported for ArchitecturalViolationRepository');
  }

  async retrieveById(id: string): Promise<ArchitecturalViolation | undefined> {
    const results = await this.executeQuery<ArchitecturalViolation>(
      'retrieveById',
      'SELECT * FROM architectural_violations WHERE id = ?',
      [id]
    );
    return results[0];
  }

  async retrieveBySnapshotId(snapshotId: string): Promise<ArchitecturalViolation[]> {
    const results = await this.executeQuery<ArchitecturalViolation>(
      'retrieveBySnapshotId',
      'SELECT * FROM architectural_violations WHERE snapshot_id = ?',
      [snapshotId]
    );
    return results;
  }

  async retrieveByModuleId(moduleId: string): Promise<ArchitecturalViolation[]> {
    const results = await this.executeQuery<ArchitecturalViolation>(
      'retrieveByModuleId',
      'SELECT * FROM architectural_violations WHERE source_module_id = ? OR target_module_id = ?',
      [moduleId, moduleId]
    );
    return results;
  }

  async retrieve(): Promise<ArchitecturalViolation[]> {
    const results = await this.executeQuery<ArchitecturalViolation>(
      'retrieveAll',
      'SELECT * FROM architectural_violations ORDER BY severity, rule_name'
    );
    return results;
  }

  async delete(id: string): Promise<void> {
    await this.executeQuery('delete', 'DELETE FROM architectural_violations WHERE id = ?', [id]);
  }

  async deleteBySnapshotId(snapshotId: string): Promise<void> {
    await this.executeQuery(
      'deleteBySnapshotId',
      'DELETE FROM architectural_violations WHERE snapshot_id = ?',
      [snapshotId]
    );
  }
}
