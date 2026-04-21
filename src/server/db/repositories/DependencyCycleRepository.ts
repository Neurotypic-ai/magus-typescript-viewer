import { BaseRepository } from './BaseRepository';

import type {
  IDependencyCycleCreateDTO,
  IDependencyCycleRow,
} from '../../../shared/types/dto/DependencyCycleDTO';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';

/**
 * Local domain shape for a dependency cycle.
 * Extends the DTO row and adds the index signature required by BaseRepository.executeQuery.
 */
export interface DependencyCycle extends IDependencyCycleRow {
  [key: string]: unknown;
}

export class DependencyCycleRepository extends BaseRepository<
  DependencyCycle,
  IDependencyCycleCreateDTO,
  never
> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[DependencyCycleRepository]', 'dependency_cycles');
  }

  async createBatch(items: IDependencyCycleCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, length, participants_json, severity)',
      5,
      items,
      (dto) => [dto.id, dto.package_id, dto.length, dto.participants_json, dto.severity]
    );
  }

  async create(dto: IDependencyCycleCreateDTO): Promise<DependencyCycle> {
    const results = await this.executeQuery<DependencyCycle>(
      'create',
      `INSERT INTO dependency_cycles (id, package_id, length, participants_json, severity)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
      [dto.id, dto.package_id, dto.length, dto.participants_json, dto.severity]
    );
    const row = results[0];
    if (!row) {
      throw new Error('Failed to create dependency cycle');
    }
    return row;
  }

  update(_id: string, _dto: never): Promise<DependencyCycle> {
    throw new Error('Updates not supported for DependencyCycleRepository');
  }

  async retrieveById(id: string): Promise<DependencyCycle | undefined> {
    const results = await this.executeQuery<DependencyCycle>(
      'retrieveById',
      'SELECT * FROM dependency_cycles WHERE id = ?',
      [id]
    );
    return results[0];
  }

  async retrieveByPackageId(packageId: string): Promise<DependencyCycle[]> {
    const results = await this.executeQuery<DependencyCycle>(
      'retrieveByPackageId',
      'SELECT * FROM dependency_cycles WHERE package_id = ? ORDER BY length DESC',
      [packageId]
    );
    return results;
  }

  async retrieveByModuleId(_moduleId: string): Promise<DependencyCycle[]> {
    // dependency_cycles has no module_id column — participants are JSON-encoded.
    return [];
  }

  async retrieve(): Promise<DependencyCycle[]> {
    const results = await this.executeQuery<DependencyCycle>(
      'retrieveAll',
      'SELECT * FROM dependency_cycles ORDER BY length DESC'
    );
    return results;
  }

  async delete(id: string): Promise<void> {
    await this.executeQuery('delete', 'DELETE FROM dependency_cycles WHERE id = ?', [id]);
  }

  async deleteByPackageId(packageId: string): Promise<void> {
    await this.executeQuery(
      'deleteByPackageId',
      'DELETE FROM dependency_cycles WHERE package_id = ?',
      [packageId]
    );
  }
}
