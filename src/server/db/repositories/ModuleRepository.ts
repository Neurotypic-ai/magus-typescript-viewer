import { Module } from '../../../shared/types/Module';
import { EntityNotFoundError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { DuckDBValue } from '@duckdb/node-api';

import type { FileLocation } from '../../../shared/types/FileLocation';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IModuleRow } from '../types/DatabaseResults';

/**
 * Data transfer object for creating a new module.
 */
export interface IModuleCreateDTO {
  /**
   * The unique identifier for the module.
   */
  id: string;

  /**
   * The UUID of the parent package.
   */
  package_id: string;

  /**
   * The name of the module.
   */
  name: string;

  /**
   * The source location information for this module.
   */
  source: FileLocation;

  /**
   * Number of lines of code in the source file.
   */
  line_count?: number;
}

interface IModuleUpdateDTO {
  name?: string;
  source?: FileLocation;
}

export class ModuleRepository extends BaseRepository<Module, IModuleCreateDTO, IModuleUpdateDTO> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[ModuleRepository]', 'modules');
  }

  /**
   * Batch-insert multiple modules at once. Ignores duplicates.
   */
  async createBatch(items: IModuleCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, name, source, directory, filename, relative_path, is_barrel, line_count)',
      9,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.name,
        JSON.stringify(dto.source),
        dto.source.directory,
        dto.source.filename,
        dto.source.relativePath,
        (dto.source.isBarrel ?? false) ? 1 : 0,
        dto.line_count ?? 0,
      ]
    );
  }

  async create(dto: IModuleCreateDTO): Promise<Module> {
    try {
      const results = await this.executeQuery<IModuleRow>(
        'create',
        `INSERT INTO modules (
          id, package_id, name, source, directory, filename, relative_path, is_barrel, line_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        [
          dto.id,
          dto.package_id,
          dto.name,
          JSON.stringify(dto.source), // Serialize FileLocation
          dto.source.directory,
          dto.source.filename,
          dto.source.relativePath,
          (dto.source.isBarrel ?? false) ? 1 : 0,
          dto.line_count ?? 0,
        ]
      );

      if (results.length === 0) {
        throw new EntityNotFoundError('Module', dto.id, this.errorTag);
      }

      const mod: IModuleRow | undefined = results[0];
      if (!mod) {
        throw new EntityNotFoundError('Module', dto.id, this.errorTag);
      }

      return this.createModuleFromRow(mod);
    } catch (error) {
      this.logger.error('Failed to create module', error);
      throw new RepositoryError('Failed to create module', 'create', this.errorTag, error as Error);
    }
  }

  async update(id: string, dto: IModuleUpdateDTO): Promise<Module> {
    try {
      const updates = [
        { field: 'name', value: dto.name ?? undefined },
        { field: 'source', value: dto.source ? JSON.stringify(dto.source) : undefined },
      ] satisfies { field: string; value: DuckDBValue | undefined }[];

      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);

      await this.executeQuery<IModuleRow>('update', `UPDATE ${this.tableName} SET ${query} WHERE id = ?`, values);

      const result = await this.retrieveById(id);

      if (!result) {
        throw new EntityNotFoundError('Module', id, this.errorTag);
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to update module', error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to update module', 'update', this.errorTag, error as Error);
    }
  }

  private createModuleFromRow(mod: IModuleRow): Module {
    // Handle source field which may be null, undefined, or a JSON string
    let source: FileLocation;
    if (mod.source && typeof mod.source === 'string' && mod.source !== 'undefined' && mod.source !== 'null') {
      try {
        source = JSON.parse(mod.source) as FileLocation;
      } catch (error) {
        // If JSON parsing fails, create a minimal FileLocation from other fields
        this.logger.warn(`Failed to parse source JSON for module ${mod.id}, creating fallback`, error);
        source = {
          directory: String(mod['directory'] ?? ''),
          name: String(mod['filename'] ?? ''),
          filename: String(mod['filename'] ?? ''),
          relativePath: String(mod['relative_path'] ?? ''),
        };
      }
    } else {
      // Create fallback FileLocation from denormalized fields
      source = {
        directory: String(mod['directory'] ?? ''),
        name: String(mod['filename'] ?? ''),
        filename: String(mod['filename'] ?? ''),
        relativePath: String(mod['relative_path'] ?? ''),
      };
    }

    return new Module(
      mod.id,
      mod.package_id,
      mod.name,
      source,
      new Date(mod.created_at),
      new Map(), // classes
      new Map(), // interfaces
      new Map(), // imports
      new Map(), // exports
      new Map(), // packages
      new Map(), // typeAliases
      new Map(), // enums
      new Map(), // functions
      new Map(), // variables
      [] // referencePaths
    );
  }

  async retrieve(id?: string, module_id?: string): Promise<Module[]> {
    try {
      let query = 'SELECT * FROM modules';
      const params: DuckDBValue[] = [];
      const conditions: string[] = [];

      if (id !== undefined) {
        conditions.push('id = ?');
        params.push(id);
      }

      if (module_id !== undefined) {
        conditions.push('package_id = ?');
        params.push(module_id);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
      }

      const results = await this.executeQuery<IModuleRow>('retrieve', query, params);
      return results.map((mod) => this.createModuleFromRow(mod));
    } catch (error) {
      this.logger.error('Failed to retrieve module', error);
      throw new RepositoryError('Failed to retrieve module', 'retrieve', this.errorTag, error as Error);
    }
  }

  async retrieveById(id: string): Promise<Module | undefined> {
    const results = await this.retrieve(id);
    return results[0];
  }

  async retrieveByModuleId(module_id: string): Promise<Module[]> {
    return this.retrieve(undefined, module_id);
  }

  async retrieveAll(packageId?: string): Promise<Module[]> {
    try {
      const query = packageId ? 'SELECT * FROM modules WHERE package_id = ?' : 'SELECT * FROM modules';
      const params = packageId ? [packageId] : [];

      const results = await this.executeQuery<IModuleRow>('retrieveAll', query, params);
      return results.map((mod) => this.createModuleFromRow(mod));
    } catch (error) {
      this.logger.error('Failed to retrieve all modules', error);
      throw new RepositoryError('Failed to retrieve all modules', 'retrieveAll', this.errorTag, error as Error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.cascadeDelete(id, [
        { table: 'parameters', where: 'module_id = ?', params: [id] },
        { table: 'class_implements', where: 'class_id IN (SELECT id FROM classes WHERE module_id = ?)', params: [id] },
        { table: 'class_extends', where: 'class_id IN (SELECT id FROM classes WHERE module_id = ?)', params: [id] },
        { table: 'interface_extends', where: 'interface_id IN (SELECT id FROM interfaces WHERE module_id = ?)', params: [id] },
        { table: 'methods', where: 'module_id = ?', params: [id] },
        { table: 'properties', where: 'module_id = ?', params: [id] },
        { table: 'symbol_references', where: 'module_id = ?', params: [id] },
        { table: 'code_issues', where: 'module_id = ?', params: [id] },
        { table: 'module_tests', where: 'module_id = ?', params: [id] },
        { table: 'classes', where: 'module_id = ?', params: [id] },
        { table: 'interfaces', where: 'module_id = ?', params: [id] },
        { table: 'functions', where: 'module_id = ?', params: [id] },
        { table: 'imports', where: 'module_id = ?', params: [id] },
        { table: 'exports', where: 'module_id = ?', params: [id] },
        { table: 'type_aliases', where: 'module_id = ?', params: [id] },
        { table: 'enums', where: 'module_id = ?', params: [id] },
        { table: 'variables', where: 'module_id = ?', params: [id] },
      ]);
    } catch (error) {
      this.logger.error('Failed to delete module', error);
      throw new RepositoryError('Failed to delete module', 'delete', this.errorTag, error as Error);
    }
  }
}
