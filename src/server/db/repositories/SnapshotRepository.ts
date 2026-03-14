import { RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { DuckDBValue } from '@duckdb/node-api';

import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { ISnapshotRow } from '../types/DatabaseResults';

export interface ISnapshotCreateDTO {
  id: string;
  repo_path: string;
  commit_hash: string;
  commit_short: string;
  subject: string;
  author_name: string;
  author_email: string;
  commit_at: Date;
  package_id: string;
  ordinal: number;
}

export interface Snapshot {
  id: string;
  repoPath: string;
  commitHash: string;
  commitShort: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  commitAt: Date;
  packageId: string;
  ordinal: number;
  createdAt: Date;
}

function rowToSnapshot(row: ISnapshotRow): Snapshot {
  return {
    id: row.id,
    repoPath: row.repo_path,
    commitHash: row.commit_hash,
    commitShort: row.commit_short,
    subject: row.subject,
    authorName: row.author_name,
    authorEmail: row.author_email,
    commitAt: new Date(row.commit_at),
    packageId: row.package_id,
    ordinal: row.ordinal,
    createdAt: new Date(row.created_at),
  };
}

export class SnapshotRepository extends BaseRepository<Snapshot, ISnapshotCreateDTO, never> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[SnapshotRepository]', 'snapshots');
  }

  async create(dto: ISnapshotCreateDTO): Promise<Snapshot> {
    try {
      const now = new Date().toISOString();
      const params: DuckDBValue[] = [
        dto.id,
        dto.repo_path,
        dto.commit_hash,
        dto.commit_short,
        dto.subject,
        dto.author_name,
        dto.author_email,
        dto.commit_at.toISOString(),
        dto.package_id,
        dto.ordinal,
        now,
      ];

      await this.adapter.query(
        `INSERT INTO snapshots
          (id, repo_path, commit_hash, commit_short, subject, author_name, author_email, commit_at, package_id, ordinal, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        params
      );

      const results = await this.executeQuery<ISnapshotRow>(
        'create',
        'SELECT * FROM snapshots WHERE id = ?',
        [dto.id]
      );

      const row = results[0];
      if (!row) {
        // Row was ignored due to UNIQUE conflict — fetch by repo+commit
        const existing = await this.findByCommit(dto.repo_path, dto.commit_hash);
        if (existing) {
          return existing;
        }
        throw new RepositoryError(
          `Snapshot with id '${dto.id}' could not be created or retrieved`,
          'create',
          this.errorTag
        );
      }

      return rowToSnapshot(row);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to create snapshot', 'create', this.errorTag, error as Error);
    }
  }

  async retrieve(id?: string): Promise<Snapshot[]> {
    try {
      const query = id ? 'SELECT * FROM snapshots WHERE id = ?' : 'SELECT * FROM snapshots';
      const params: DuckDBValue[] = id ? [id] : [];
      const results = await this.executeQuery<ISnapshotRow>('retrieve', query, params);
      return results.map(rowToSnapshot);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to retrieve snapshot', 'retrieve', this.errorTag, error as Error);
    }
  }

  async retrieveById(id: string): Promise<Snapshot | undefined> {
    try {
      const results = await this.executeQuery<ISnapshotRow>(
        'retrieveById',
        'SELECT * FROM snapshots WHERE id = ?',
        [id]
      );
      return results[0] ? rowToSnapshot(results[0]) : undefined;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to retrieve snapshot by id', 'retrieveById', this.errorTag, error as Error);
    }
  }

  retrieveByModuleId(_moduleId: string): Promise<Snapshot[]> {
    throw new RepositoryError('retrieveByModuleId is not supported for snapshots', 'retrieveByModuleId', this.errorTag);
  }

  update(_id: string, _dto: never): Promise<Snapshot> {
    throw new RepositoryError('update is not supported for snapshots', 'update', this.errorTag);
  }

  async delete(id: string): Promise<void> {
    try {
      await this.executeQuery<ISnapshotRow>(
        'delete',
        'DELETE FROM snapshots WHERE id = ?',
        [id]
      );
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to delete snapshot', 'delete', this.errorTag, error as Error);
    }
  }

  async listByRepo(repoPath: string): Promise<Snapshot[]> {
    try {
      const results = await this.executeQuery<ISnapshotRow>(
        'listByRepo',
        'SELECT * FROM snapshots WHERE repo_path = ? ORDER BY ordinal ASC',
        [repoPath]
      );
      return results.map(rowToSnapshot);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to list snapshots by repo', 'listByRepo', this.errorTag, error as Error);
    }
  }

  async findByCommit(repoPath: string, commitHash: string): Promise<Snapshot | undefined> {
    try {
      const results = await this.executeQuery<ISnapshotRow>(
        'findByCommit',
        'SELECT * FROM snapshots WHERE repo_path = ? AND commit_hash = ?',
        [repoPath, commitHash]
      );
      return results[0] ? rowToSnapshot(results[0]) : undefined;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to find snapshot by commit', 'findByCommit', this.errorTag, error as Error);
    }
  }

  async listExistingHashes(repoPath: string): Promise<Set<string>> {
    try {
      const results = await this.executeQuery<ISnapshotRow>(
        'listExistingHashes',
        'SELECT commit_hash FROM snapshots WHERE repo_path = ?',
        [repoPath]
      );
      return new Set(results.map((r) => r.commit_hash));
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to list existing hashes', 'listExistingHashes', this.errorTag, error as Error);
    }
  }

  async getMaxOrdinal(repoPath: string): Promise<number> {
    try {
      const results = (await this.adapter.query(
        'SELECT COALESCE(MAX(ordinal), -1) AS max_ordinal FROM snapshots WHERE repo_path = ?',
        [repoPath]
      )) as unknown as Array<{ max_ordinal: number | null }>;
      const row = results[0];
      if (!row) {
        return -1;
      }
      const val = row.max_ordinal;
      return typeof val === 'number' ? val : -1;
    } catch (error) {
      throw new RepositoryError('Failed to get max ordinal', 'getMaxOrdinal', this.errorTag, error as Error);
    }
  }
}
