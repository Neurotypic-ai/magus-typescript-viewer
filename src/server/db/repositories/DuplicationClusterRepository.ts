import { BaseRepository } from './BaseRepository';

import type {
  IDuplicationClusterCreateDTO,
  IDuplicationClusterRow,
} from '../../../shared/types/dto/DuplicationClusterDTO';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';

/**
 * Local domain shape for a duplication cluster.
 * Extends the DTO row and adds the index signature required by BaseRepository.executeQuery.
 */
export interface DuplicationCluster extends IDuplicationClusterRow {
  [key: string]: unknown;
}

export class DuplicationClusterRepository extends BaseRepository<
  DuplicationCluster,
  IDuplicationClusterCreateDTO,
  never
> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[DuplicationClusterRepository]', 'duplication_clusters');
  }

  async createBatch(items: IDuplicationClusterCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, token_count, line_count, fragment_count, fingerprint, fragments_json)',
      7,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.token_count,
        dto.line_count,
        dto.fragment_count,
        dto.fingerprint,
        dto.fragments_json,
      ]
    );
  }

  async create(dto: IDuplicationClusterCreateDTO): Promise<DuplicationCluster> {
    const results = await this.executeQuery<DuplicationCluster>(
      'create',
      `INSERT INTO duplication_clusters (id, package_id, token_count, line_count, fragment_count, fingerprint, fragments_json)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        dto.id,
        dto.package_id,
        dto.token_count,
        dto.line_count,
        dto.fragment_count,
        dto.fingerprint,
        dto.fragments_json,
      ]
    );
    const row = results[0];
    if (!row) {
      throw new Error('Failed to create duplication cluster');
    }
    return row;
  }

  update(_id: string, _dto: never): Promise<DuplicationCluster> {
    throw new Error('Updates not supported for DuplicationClusterRepository');
  }

  async retrieveById(id: string): Promise<DuplicationCluster | undefined> {
    const results = await this.executeQuery<DuplicationCluster>(
      'retrieveById',
      'SELECT * FROM duplication_clusters WHERE id = ?',
      [id]
    );
    return results[0];
  }

  async retrieveByPackageId(packageId: string): Promise<DuplicationCluster[]> {
    const results = await this.executeQuery<DuplicationCluster>(
      'retrieveByPackageId',
      'SELECT * FROM duplication_clusters WHERE package_id = ? ORDER BY token_count DESC',
      [packageId]
    );
    return results;
  }

  async retrieveByModuleId(_moduleId: string): Promise<DuplicationCluster[]> {
    // duplication_clusters has no module_id column — fragments are JSON-encoded.
    return [];
  }

  async retrieve(): Promise<DuplicationCluster[]> {
    const results = await this.executeQuery<DuplicationCluster>(
      'retrieveAll',
      'SELECT * FROM duplication_clusters ORDER BY token_count DESC'
    );
    return results;
  }

  async delete(id: string): Promise<void> {
    await this.executeQuery('delete', 'DELETE FROM duplication_clusters WHERE id = ?', [id]);
  }

  async deleteByPackageId(packageId: string): Promise<void> {
    await this.executeQuery(
      'deleteByPackageId',
      'DELETE FROM duplication_clusters WHERE package_id = ?',
      [packageId]
    );
  }
}
