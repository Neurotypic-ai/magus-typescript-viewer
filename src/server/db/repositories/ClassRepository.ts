import { Class } from '../../../shared/types/Class';
import { EntityNotFoundError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';
import { MethodRepository } from './MethodRepository';
import { PropertyRepository } from './PropertyRepository';

import type { DuckDBValue } from '@duckdb/node-api';

import type { Interface } from '../../../shared/types/Interface';
import type { Method } from '../../../shared/types/Method';
import type { Property } from '../../../shared/types/Property';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IClassOrInterfaceRow } from '../types/DatabaseResults';


/**
 * Data transfer object for creating a new class.
 */
export interface IClassCreateDTO {
  /**
   * The unique identifier for the class.
   */
  id: string;

  /**
   * The UUID of the parent package.
   */
  package_id: string;

  /**
   * The UUID of the parent module.
   */
  module_id: string;

  /**
   * The name of the class.
   */
  name: string;

  /**
   * The ID of the parent class (if this class extends another).
   */
  extends_id?: string | undefined;
}

interface IClassUpdateDTO {
  name?: string;
  extends_id?: string;
}

/**
 * Repository interface for managing classes.
 */
export interface IClassRepository {
  /**
   * Creates a new class.
   */
  create(dto: IClassCreateDTO): Promise<Class>;

  /**
   * Finds a class by its ID.
   */
  findById(id: string): Promise<IClassCreateDTO | null>;

  /**
   * Finds all classes in a module.
   */
  findByModuleId(moduleId: string): Promise<IClassCreateDTO[]>;

  /**
   * Deletes a class by its ID.
   */
  delete(id: string): Promise<void>;
}

export class ClassRepository extends BaseRepository<Class, IClassCreateDTO, IClassUpdateDTO> {
  private readonly methodRepository: MethodRepository;
  private readonly propertyRepository: PropertyRepository;

  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[ClassRepository]', 'classes');
    this.methodRepository = new MethodRepository(adapter);
    this.propertyRepository = new PropertyRepository(adapter);
  }

  /**
   * Batch-insert multiple classes at once. Ignores duplicates.
   */
  async createBatch(items: IClassCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, module_id, name, extends_id)',
      5,
      items,
      (dto) => [dto.id, dto.package_id, dto.module_id, dto.name, dto.extends_id ?? null]
    );
  }

  async create(dto: IClassCreateDTO): Promise<Class> {
    try {
      const results = await this.executeQuery<IClassOrInterfaceRow>(
        'create',
        'INSERT INTO classes (id, package_id, module_id, name, extends_id) VALUES (?, ?, ?, ?, ?) RETURNING *',
        [dto.id, dto.package_id, dto.module_id, dto.name, dto.extends_id ?? null]
      );

      if (results.length === 0) {
        throw new EntityNotFoundError('Class', dto.id, this.errorTag);
      }

      const cls: IClassOrInterfaceRow | undefined = results[0];
      if (!cls) {
        throw new EntityNotFoundError('Class', dto.id, this.errorTag);
      }

      return new Class(
        cls.id,
        cls.package_id,
        cls.module_id,
        cls.name,
        new Date(cls.created_at),
        new Map<string, Method>(),
        new Map<string, Property>(),
        new Map<string, Interface>(),
        cls.extends_id ?? undefined
      );
    } catch (error) {
      this.logger.error('Failed to create class', error);
      throw new RepositoryError('Failed to create class', 'create', this.errorTag, error as Error);
    }
  }

  async update(id: string, dto: IClassUpdateDTO): Promise<Class> {
    try {
      const updates = [
        { field: 'name', value: (dto.name as DuckDBValue) ?? undefined },
        { field: 'extends_id', value: (dto.extends_id as DuckDBValue) ?? undefined },
      ] satisfies { field: string; value: DuckDBValue | undefined }[];

      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);

      await this.executeQuery<IClassOrInterfaceRow>(
        'update',
        `UPDATE ${this.tableName} SET ${query} WHERE id = ?`,
        values
      );

      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError('Class', id, this.errorTag);
      }
      return result;
    } catch (error) {
      this.logger.error('Failed to update class', error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to update class', 'update', this.errorTag, error as Error);
    }
  }

  async retrieve(id?: string, module_id?: string): Promise<Class[]> {
    try {
      // Build conditions array for more robust query construction
      const conditions: string[] = [];
      const params: DuckDBValue[] = [];

      if (id !== undefined) {
        conditions.push('c.id = ?');
        params.push(id);
      }

      if (module_id !== undefined) {
        conditions.push('c.module_id = ?');
        params.push(module_id);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const query = `
        SELECT c.* 
        FROM classes c
        ${whereClause}
      `
        .trim()
        .replace(/\s+/g, ' ');

      this.logger.debug('Executing retrieve query:', { query, params });

      const results = await this.executeQuery<IClassOrInterfaceRow>('retrieve', query, params);

      // Fetch all related data for each class
      const ultimateClasses = await Promise.all(
        results.map(async (cls) => {
          try {
            this.logger.debug(`Processing class ${cls.id}`);

            // Use specialized repositories to retrieve methods and properties
            const [methodsMap, propertiesMap] = await Promise.all([
              this.methodRepository.retrieveByParent(cls.id, 'class'),
              this.propertyRepository.retrieveByParent(cls.id, 'class'),
            ]);

            // Build conditions array for implementations query
            const implementationsQuery = `
              SELECT i.* 
              FROM interfaces i 
              JOIN class_implements ci ON i.id = ci.interface_id 
              WHERE ci.class_id = ?
            `
              .trim()
              .replace(/\s+/g, ' ');

            this.logger.debug('Executing implementations query:', {
              query: implementationsQuery,
              params: [cls.id],
              classId: cls.id,
            });

            // Fetch implemented interfaces with proper parameter handling
            const implementations = await this.executeQuery<IClassOrInterfaceRow>(
              'retrieve implementations',
              implementationsQuery,
              [cls.id]
            );

            this.logger.debug(`Found ${String(implementations.length)} implementations for class ${cls.id}`);

            // Convert interfaces to Map with explicit type conversion
            const interfacesMap = new Map<string, Interface>();
            implementations.forEach((iface) => {
              interfacesMap.set(iface.id, {
                id: iface.id,
                package_id: iface.package_id,
                module_id: iface.module_id,
                name: iface.name,
                created_at: new Date(iface.created_at),
                methods: new Map(),
                properties: new Map(),
                extended_interfaces: new Map(),
              });
            });

            return new Class(
              cls.id,
              cls.package_id,
              cls.module_id,
              cls.name,
              new Date(cls.created_at),
              methodsMap,
              propertiesMap,
              interfacesMap,
              cls.extends_id ?? undefined
            );
          } catch (error) {
            if (error instanceof RepositoryError) {
              throw error;
            }
            throw new RepositoryError(`Failed to process class ${cls.id}`, 'retrieve', this.errorTag, error as Error);
          }
        })
      );

      return ultimateClasses.filter(Boolean);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to retrieve class', 'retrieve', this.errorTag, error as Error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      // Group related deletions
      const relatedDeletions = [
        {
          operation: 'delete implements',
          query: 'DELETE FROM class_implements WHERE class_id = ?',
        },
        {
          operation: 'delete methods',
          query: 'DELETE FROM methods WHERE parent_id = ? AND parent_type = ?',
          additionalParams: ['class'],
        },
        {
          operation: 'delete properties',
          query: 'DELETE FROM properties WHERE parent_id = ? AND parent_type = ?',
          additionalParams: ['class'],
        },
      ];

      // Execute deletions in order
      for (const deletion of relatedDeletions) {
        const params = [id, ...(deletion.additionalParams ?? [])];
        await this.executeQuery<IClassOrInterfaceRow>(deletion.operation, deletion.query, params);
      }

      // Delete the main entity
      await this.executeQuery<IClassOrInterfaceRow>('delete class', `DELETE FROM ${this.tableName} WHERE id = ?`, [id]);
    } catch (error) {
      this.logger.error('Failed to delete class', error);
      throw new RepositoryError('Failed to delete class', 'delete', this.errorTag, error as Error);
    }
  }

  async retrieveById(id: string): Promise<Class | undefined> {
    const results = await this.retrieve(id);
    return results[0];
  }

  async retrieveByModuleId(module_id: string): Promise<Class[]> {
    return this.retrieve(undefined, module_id);
  }

  /**
   * Batch-retrieve all classes whose module_id is in the given list.
   * Returns raw rows (without hydrated methods/properties/interfaces) for
   * in-memory distribution by the caller.
   */
  async retrieveByModuleIds(moduleIds: string[]): Promise<Class[]> {
    if (moduleIds.length === 0) return [];
    try {
      const placeholders = moduleIds.map(() => '?').join(', ');
      const results = await this.executeQuery<IClassOrInterfaceRow>(
        'retrieveByModuleIds',
        `SELECT c.* FROM classes c WHERE c.module_id IN (${placeholders})`,
        moduleIds
      );
      return results.map(
        (cls) =>
          new Class(
            cls.id,
            cls.package_id,
            cls.module_id,
            cls.name,
            new Date(cls.created_at),
            new Map<string, Method>(),
            new Map<string, Property>(),
            new Map<string, Interface>(),
            cls.extends_id ?? undefined
          )
      );
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to retrieve classes by module IDs', 'retrieveByModuleIds', this.errorTag, error as Error);
    }
  }

}
