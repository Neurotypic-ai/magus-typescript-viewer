import { Package } from '../../../shared/types/Package';
import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../errors/RepositoryError';
import { isMissingTableError } from '../errors/isMissingTableError';
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

  /**
   * The git commit hash this package snapshot was parsed from.
   */
  commit_hash?: string;
}

interface IPackageUpdateDTO {
  name?: string;
  version?: string;
  path?: string;
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
      const columns = dto.commit_hash
        ? '(id, name, version, path, commit_hash, created_at)'
        : '(id, name, version, path, created_at)';
      const placeholders = dto.commit_hash ? '(?, ?, ?, ?, ?, ?)' : '(?, ?, ?, ?, ?)';
      const values = dto.commit_hash
        ? [dto.id, dto.name, dto.version, dto.path, dto.commit_hash, now]
        : [dto.id, dto.name, dto.version, dto.path, now];
      const results = await this.executeQuery<IPackageRow>(
        'create',
        `INSERT INTO packages ${columns} VALUES ${placeholders} RETURNING *`,
        values
      );

      if (results.length === 0) {
        throw new EntityNotFoundError('Package', dto.id, this.errorTag);
      }

      const knownPackageRows = await this.executeQuery<IPackageRow>(
        'list-ids',
        'SELECT id FROM packages',
      );
      const knownPackageIds = new Set(knownPackageRows.map((r) => r['id'] as string));

      const depGroups: Array<{ ids: Map<string, string>; type: 'dependency' | 'devDependency' | 'peerDependency' }> = [];
      if (dto.dependencies) depGroups.push({ ids: dto.dependencies, type: 'dependency' });
      if (dto.devDependencies) depGroups.push({ ids: dto.devDependencies, type: 'devDependency' });
      if (dto.peerDependencies) depGroups.push({ ids: dto.peerDependencies, type: 'peerDependency' });

      for (const group of depGroups) {
        for (const dependencyId of group.ids.values()) {
          if (dependencyId !== dto.id && knownPackageIds.has(dependencyId)) {
            await this.dependencyRepository.create({
              source_id: dto.id,
              target_id: dependencyId,
              type: group.type,
            });
          }
        }
      }

      const pkg = results[0];
      if (!pkg) {
        throw new EntityNotFoundError('Package', dto.id, this.errorTag);
      }
      return this.createPackage(pkg);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to create package', 'create', this.errorTag, error as Error);
    }
  }

  async update(id: string, dto: IPackageUpdateDTO): Promise<Package> {
    try {
      const updates = [
        { field: 'name', value: dto.name ?? undefined },
        { field: 'version', value: dto.version ?? undefined },
        { field: 'path', value: dto.path ?? undefined },
      ] satisfies { field: string; value: DuckDBValue | undefined }[];

      const { query, values } = this.buildUpdateQuery(updates);

      if (!query) {
        throw new NoFieldsToUpdateError('Package', this.errorTag);
      }

      values.push(id);
      await this.executeQuery<IPackageRow>('update', `UPDATE packages SET ${query} WHERE id = ?`, values);

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

  private createPackage(
    pkg: IPackageRow,
    dependencies = new Map<string, Package>(),
    devDependencies = new Map<string, Package>(),
    peerDependencies = new Map<string, Package>()
  ): Package {
    return new Package(
      pkg.id,
      pkg.name,
      pkg.version,
      pkg.path,
      new Date(pkg.created_at),
      dependencies,
      devDependencies,
      peerDependencies,
      new Map()
    );
  }

  private async createPackageWithDependencies(pkg: IPackageRow): Promise<Package> {
    try {
      const dependencyRows = await this.dependencyRepository.findBySourceId(pkg.id);

      const dependencies = new Map<string, Package>();
      const devDependencies = new Map<string, Package>();
      const peerDependencies = new Map<string, Package>();

      for (const row of dependencyRows) {
        const placeholder = new Package(row.target_id, '', '', '', new Date());
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

      return this.createPackage(pkg, dependencies, devDependencies, peerDependencies);
    } catch (error) {
      if (isMissingTableError(error)) {
        this.logger.warn('Dependency hydration failed (table may not exist), returning package without dependencies', error as Error);
        return this.createPackage(pkg);
      }
      this.logger.error('Dependency hydration failed', error as Error);
      throw new RepositoryError('Failed to hydrate package dependencies', 'createPackageWithDependencies', this.errorTag, error as Error);
    }
  }

  async retrieveById(id: string): Promise<Package | undefined> {
    const results = await this.retrieve(id);
    return results[0];
  }

  retrieveByModuleId(_module_id: string): Promise<Package[]> {
    return Promise.resolve([]);
  }

  async retrieve(id?: string, _module_id?: string): Promise<Package[]> {
    try {
      const query = id ? 'SELECT * FROM packages WHERE id = ?' : 'SELECT * FROM packages';
      const params: DuckDBValue[] = id ? [id] : [];
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
      await this.cascadeDelete(id, [
        { table: 'parameters', where: 'package_id = ?', params: [id] },
        { table: 'class_implements', where: 'class_id IN (SELECT id FROM classes WHERE package_id = ?)', params: [id] },
        { table: 'class_extends', where: 'class_id IN (SELECT id FROM classes WHERE package_id = ?)', params: [id] },
        { table: 'interface_extends', where: 'interface_id IN (SELECT id FROM interfaces WHERE package_id = ?)', params: [id] },
        { table: 'symbol_references', where: 'package_id = ?', params: [id] },
        { table: 'code_issues', where: 'package_id = ?', params: [id] },
        { table: 'methods', where: 'package_id = ?', params: [id] },
        { table: 'properties', where: 'package_id = ?', params: [id] },
        { table: 'module_tests', where: 'module_id IN (SELECT id FROM modules WHERE package_id = ?)', params: [id] },
        { table: 'functions', where: 'package_id = ?', params: [id] },
        { table: 'imports', where: 'package_id = ?', params: [id] },
        { table: 'exports', where: 'package_id = ?', params: [id] },
        { table: 'type_aliases', where: 'package_id = ?', params: [id] },
        { table: 'enums', where: 'package_id = ?', params: [id] },
        { table: 'variables', where: 'package_id = ?', params: [id] },
        { table: 'classes', where: 'package_id = ?', params: [id] },
        { table: 'interfaces', where: 'package_id = ?', params: [id] },
        { table: 'modules', where: 'package_id = ?', params: [id] },
        { table: 'dependencies', where: 'source_id = ? OR target_id = ?', params: [id, id] },
      ]);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to delete package', 'delete', this.errorTag, error as Error);
    }
  }
}
