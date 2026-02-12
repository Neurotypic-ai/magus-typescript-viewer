import { Package } from '../../../shared/types/Package';
import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';
import { DependencyRepository } from './DependencyRepository';

import type { DuckDBValue } from '@duckdb/node-api';

import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IPackageRow } from '../types/DatabaseResults';

/**
 * Data transfer object for creating a new package.
 */
export interface IPackageCreateDTO {
  /**
   * The unique identifier for the package.
   */
  id: string;

  /**
   * The name of the package.
   */
  name: string;

  /**
   * The version of the package.
   */
  version: string;

  /**
   * The path to the package.
   */
  path: string;

  /**
   * The dependencies of the package.
   */
  dependencies?: Map<string, string>;

  /**
   * The dev dependencies of the package.
   */
  devDependencies?: Map<string, string>;

  /**
   * The peer dependencies of the package.
   */
  peerDependencies?: Map<string, string>;
}

interface IPackageUpdateDTO {
  name?: string;
  version?: string;
  path?: string;
}

/**
 * Repository interface for managing packages.
 */
export interface IPackageRepository {
  /**
   * Creates a new package.
   */
  create(dto: IPackageCreateDTO): Promise<Package>;

  /**
   * Updates a package.
   */
  update(id: string, dto: IPackageUpdateDTO): Promise<Package>;

  /**
   * Finds a package by its ID.
   */
  findById(id: string): Promise<Package | null>;

  /**
   * Finds all packages.
   */
  findAll(): Promise<IPackageCreateDTO[]>;

  /**
   * Deletes a package by its ID.
   */
  delete(id: string): Promise<void>;
}

export class PackageRepository extends BaseRepository<Package, IPackageCreateDTO, IPackageUpdateDTO> {
  private dependencyRepository: DependencyRepository;

  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[PackageRepository]', 'packages');
    this.dependencyRepository = new DependencyRepository(adapter);
  }

  async create(dto: IPackageCreateDTO): Promise<Package> {
    try {
      const now = new Date().toISOString();
      const results = await this.executeQuery<IPackageRow>(
        'create',
        'INSERT INTO packages (id, name, version, path, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
        [dto.id, dto.name, dto.version, dto.path, now]
      );

      if (results.length === 0) {
        throw new EntityNotFoundError('Package', dto.id, this.errorTag);
      }

      // Create dependencies using DependencyRepository
      // Only create dependency records for packages that exist in our database
      // Skip external npm packages that we haven't analyzed
      if (dto.dependencies) {
        for (const dependencyId of dto.dependencies.values()) {
          if (dependencyId !== dto.id) {
            try {
              await this.dependencyRepository.create({
                source_id: dto.id,
                target_id: dependencyId,
                type: 'dependency',
              });
            } catch {
              // Silently skip dependencies that don't exist in the database (external packages)
            }
          }
        }
      }
      if (dto.devDependencies) {
        for (const dependencyId of dto.devDependencies.values()) {
          if (dependencyId !== dto.id) {
            try {
              await this.dependencyRepository.create({
                source_id: dto.id,
                target_id: dependencyId,
                type: 'devDependency',
              });
            } catch {
              // Silently skip dependencies that don't exist in the database (external packages)
            }
          }
        }
      }
      if (dto.peerDependencies) {
        for (const dependencyId of dto.peerDependencies.values()) {
          if (dependencyId !== dto.id) {
            try {
              await this.dependencyRepository.create({
                source_id: dto.id,
                target_id: dependencyId,
                type: 'peerDependency',
              });
            } catch {
              // Silently skip dependencies that don't exist in the database (external packages)
            }
          }
        }
      }

      const pkg = results[0];
      if (!pkg) {
        throw new EntityNotFoundError('Package', dto.id, this.errorTag);
      }
      return new Package(
        pkg.id,
        pkg.name,
        pkg.version,
        pkg.path,
        new Date(pkg.created_at),
        new Map(),
        new Map(),
        new Map(),
        new Map()
      );
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to create package', 'create', this.errorTag, error as Error);
    }
  }

  async update(id: string, dto: IPackageUpdateDTO): Promise<Package> {
    try {
      const updates: string[] = [];
      const values: string[] = [];

      if (dto.name !== undefined) {
        updates.push('name = ?');
        values.push(dto.name);
      }
      if (dto.version !== undefined) {
        updates.push('version = ?');
        values.push(dto.version);
      }
      if (dto.path !== undefined) {
        updates.push('path = ?');
        values.push(dto.path);
      }

      if (updates.length === 0) {
        throw new NoFieldsToUpdateError('Package', this.errorTag);
      }

      values.push(id);
      await this.executeQuery<IPackageRow>('update', `UPDATE packages SET ${updates.join(', ')} WHERE id = ?`, values);

      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError('Package', id, this.errorTag);
      }
      return result;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to update package', 'update', this.errorTag, error as Error);
    }
  }

  private async createPackageWithDependencies(pkg: IPackageRow): Promise<Package> {
    // Gracefully degrade: return package with empty dependency maps if dependency retrieval fails
    try {
      const dependencyRows = await this.dependencyRepository.findBySourceId(pkg.id);

      const dependencies = new Map<string, Package>();
      const devDependencies = new Map<string, Package>();
      const peerDependencies = new Map<string, Package>();

      // Best-effort: do not recursively hydrate dependent packages to avoid cycles and heavy queries
      for (const row of dependencyRows) {
        const placeholder = new Package(String(row.target_id), '', '', '', new Date());
        switch (row.type) {
          case 'dependency':
            dependencies.set(placeholder.id, placeholder);
            break;
          case 'devDependency':
            devDependencies.set(placeholder.id, placeholder);
            break;
          case 'peerDependency':
            peerDependencies.set(placeholder.id, placeholder);
            break;
        }
      }

      return new Package(
        String(pkg.id),
        String(pkg.name),
        String(pkg.version),
        String(pkg.path),
        new Date(String(pkg.created_at)),
        dependencies,
        devDependencies,
        peerDependencies,
        new Map()
      );
    } catch (error) {
      this.logger.error('Dependency hydration failed, returning package without dependencies', error as Error);
      return new Package(
        String(pkg.id),
        String(pkg.name),
        String(pkg.version),
        String(pkg.path),
        new Date(String(pkg.created_at)),
        new Map(),
        new Map(),
        new Map(),
        new Map()
      );
    }
  }

  async retrieveById(id: string): Promise<Package | undefined> {
    const results = await this.retrieve(id);
    return results[0];
  }

  async retrieveByModuleId(module_id: string): Promise<Package[]> {
    return this.retrieve(undefined, module_id);
  }

  async retrieve(id?: string, module_id?: string): Promise<Package[]> {
    try {
      let query = 'SELECT * FROM packages';
      const params: DuckDBValue[] = [];
      const conditions: string[] = [];

      if (id) {
        conditions.push('id = ?');
        params.push(id);
      }

      if (module_id) {
        conditions.push('module_id = ?');
        params.push(module_id);
      }

      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }

      const results = await this.executeQuery<IPackageRow>('retrieve', query, params);
      const packages: Package[] = [];

      for (const pkg of results) {
        packages.push(await this.createPackageWithDependencies(pkg));
      }

      return packages;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to retrieve package', 'retrieve', this.errorTag, error as Error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      // First delete dependencies
      await this.executeQuery<IPackageRow>(
        'delete dependencies',
        'DELETE FROM dependencies WHERE source_id = ? OR target_id = ?',
        [id, id]
      );

      // Then delete the package
      await this.executeQuery<IPackageRow>('delete package', 'DELETE FROM packages WHERE id = ?', [id]);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to delete package', 'delete', this.errorTag, error as Error);
    }
  }
}
