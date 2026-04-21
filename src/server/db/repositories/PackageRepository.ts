import { Package } from '../../../shared/types/Package';
import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';
import { DependencyRepository } from './DependencyRepository';

import type { DuckDBValue } from '@duckdb/node-api';

import type { ExternalDepsByName, PackageJsonDepScope } from '../../../shared/types/Package';
import type { IPackageCreateDTO, IPackageUpdateDTO } from '../../../shared/types/dto/PackageDTO';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IPackageRow } from '../types/DatabaseResults';

/**
 * Merge a DTO's dependency Maps into the single `{name: scope}` shape stored
 * in `packages.package_json_deps_json`. Precedence for a name appearing in
 * multiple scopes: dependency > peerDependency > devDependency (matches how
 * package managers resolve overlap — production wins).
 */
function buildExternalDepsByName(dto: IPackageCreateDTO): ExternalDepsByName {
  const result: ExternalDepsByName = {};
  dto.devDependencies?.forEach((_id, name) => {
    result[name] = 'devDependency';
  });
  dto.peerDependencies?.forEach((_id, name) => {
    result[name] = 'peerDependency';
  });
  dto.dependencies?.forEach((_id, name) => {
    result[name] = 'dependency';
  });
  return result;
}

function parseExternalDepsJson(raw: string | null | undefined): ExternalDepsByName {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: ExternalDepsByName = {};
    for (const [name, scope] of Object.entries(parsed as Record<string, unknown>)) {
      if (scope === 'dependency' || scope === 'devDependency' || scope === 'peerDependency') {
        out[name] = scope as PackageJsonDepScope;
      }
    }
    return out;
  } catch {
    return {};
  }
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
      const externalDepsByName = buildExternalDepsByName(dto);
      const externalDepsJson = JSON.stringify(externalDepsByName);
      const results = await this.executeQuery<IPackageRow>(
        'create',
        'INSERT INTO packages (id, name, version, path, package_json_deps_json, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
        [dto.id, dto.name, dto.version, dto.path, externalDepsJson, now]
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
        pkg.created_at,
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        externalDepsByName
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
    // DuckDB rows come back with values typed as `DuckDBValue | undefined`.
    // For a nullable TEXT column we coerce to string|null|undefined before parsing.
    const rawDepsJson = pkg['package_json_deps_json'];
    const externalDepsByName = parseExternalDepsJson(
      typeof rawDepsJson === 'string' ? rawDepsJson : null
    );

    // Gracefully degrade: return package with empty dependency maps if dependency retrieval fails
    try {
      const dependencyRows = await this.dependencyRepository.findBySourceId(pkg.id);

      const dependencies = new Map<string, Package>();
      const devDependencies = new Map<string, Package>();
      const peerDependencies = new Map<string, Package>();

      // Best-effort: do not recursively hydrate dependent packages to avoid cycles and heavy queries
      for (const row of dependencyRows) {
        const placeholder = new Package(row.target_id, '', '', '', new Date().toISOString());
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
        pkg.id,
        pkg.name,
        pkg.version,
        pkg.path,
        pkg.created_at,
        dependencies,
        devDependencies,
        peerDependencies,
        new Map(),
        externalDepsByName
      );
    } catch (error) {
      this.logger.error('Dependency hydration failed, returning package without dependencies', error as Error);
      return new Package(
        pkg.id,
        pkg.name,
        pkg.version,
        pkg.path,
        pkg.created_at,
        new Map(),
        new Map(),
        new Map(),
        new Map(),
        externalDepsByName
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
