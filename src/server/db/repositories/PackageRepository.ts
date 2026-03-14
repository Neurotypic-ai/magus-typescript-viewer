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
      const updates = [
        { field: 'name', value: (dto.name as DuckDBValue) ?? undefined },
        { field: 'version', value: (dto.version as DuckDBValue) ?? undefined },
        { field: 'path', value: (dto.path as DuckDBValue) ?? undefined },
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
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('does not exist') || msg.includes('Table') || msg.includes('not found')) {
        this.logger.warn('Dependency hydration failed (table may not exist), returning package without dependencies', error as Error);
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
      this.logger.error('Dependency hydration failed', error as Error);
      throw new RepositoryError('Failed to hydrate package dependencies', 'createPackageWithDependencies', this.errorTag, error as Error);
    }
  }

  async retrieveById(id: string): Promise<Package | undefined> {
    const results = await this.retrieve(id);
    return results[0];
  }

  async retrieveByModuleId(module_id: string): Promise<Package[]> {
    return this.retrieve(undefined, module_id);
  }

  async retrieve(id?: string, _module_id?: string): Promise<Package[]> {
    try {
      let query = 'SELECT * FROM packages';
      const params: DuckDBValue[] = [];
      const conditions: string[] = [];

      if (id) {
        conditions.push('id = ?');
        params.push(id);
      }

      // Note: packages table has no module_id column.
      // The _module_id parameter exists only to satisfy the BaseRepository interface.

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
      // Delete parameters
      await this.executeQuery<IPackageRow>(
        'delete parameters',
        'DELETE FROM parameters WHERE package_id = ?',
        [id]
      );

      // Delete junction tables for classes
      await this.executeQuery<IPackageRow>(
        'delete class_implements',
        'DELETE FROM class_implements WHERE class_id IN (SELECT id FROM classes WHERE package_id = ?)',
        [id]
      );
      await this.executeQuery<IPackageRow>(
        'delete class_extends',
        'DELETE FROM class_extends WHERE class_id IN (SELECT id FROM classes WHERE package_id = ?)',
        [id]
      );

      // Delete junction tables for interfaces
      await this.executeQuery<IPackageRow>(
        'delete interface_extends',
        'DELETE FROM interface_extends WHERE interface_id IN (SELECT id FROM interfaces WHERE package_id = ?)',
        [id]
      );

      // Delete symbol references and code issues
      await this.executeQuery<IPackageRow>(
        'delete symbol_references',
        'DELETE FROM symbol_references WHERE package_id = ?',
        [id]
      );
      await this.executeQuery<IPackageRow>(
        'delete code_issues',
        'DELETE FROM code_issues WHERE package_id = ?',
        [id]
      );

      // Delete methods and properties
      await this.executeQuery<IPackageRow>(
        'delete methods',
        'DELETE FROM methods WHERE package_id = ?',
        [id]
      );
      await this.executeQuery<IPackageRow>(
        'delete properties',
        'DELETE FROM properties WHERE package_id = ?',
        [id]
      );

      // Delete module tests
      await this.executeQuery<IPackageRow>(
        'delete module_tests',
        'DELETE FROM module_tests WHERE module_id IN (SELECT id FROM modules WHERE package_id = ?)',
        [id]
      );

      // Delete functions, imports, exports
      await this.executeQuery<IPackageRow>(
        'delete functions',
        'DELETE FROM functions WHERE package_id = ?',
        [id]
      );
      await this.executeQuery<IPackageRow>(
        'delete imports',
        'DELETE FROM imports WHERE package_id = ?',
        [id]
      );
      await this.executeQuery<IPackageRow>(
        'delete exports',
        'DELETE FROM exports WHERE package_id = ?',
        [id]
      );

      // Delete type aliases, enums, variables
      await this.executeQuery<IPackageRow>(
        'delete type_aliases',
        'DELETE FROM type_aliases WHERE package_id = ?',
        [id]
      );
      await this.executeQuery<IPackageRow>(
        'delete enums',
        'DELETE FROM enums WHERE package_id = ?',
        [id]
      );
      await this.executeQuery<IPackageRow>(
        'delete variables',
        'DELETE FROM variables WHERE package_id = ?',
        [id]
      );

      // Delete classes, interfaces, modules
      await this.executeQuery<IPackageRow>(
        'delete classes',
        'DELETE FROM classes WHERE package_id = ?',
        [id]
      );
      await this.executeQuery<IPackageRow>(
        'delete interfaces',
        'DELETE FROM interfaces WHERE package_id = ?',
        [id]
      );
      await this.executeQuery<IPackageRow>(
        'delete modules',
        'DELETE FROM modules WHERE package_id = ?',
        [id]
      );

      // Delete dependencies
      await this.executeQuery<IPackageRow>(
        'delete dependencies',
        'DELETE FROM dependencies WHERE source_id = ? OR target_id = ?',
        [id, id]
      );

      // Delete the package itself
      await this.executeQuery<IPackageRow>('delete package', 'DELETE FROM packages WHERE id = ?', [id]);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to delete package', 'delete', this.errorTag, error as Error);
    }
  }
}
