import { Interface } from '../../../shared/types/Interface';
import { RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';
import { MethodRepository } from './MethodRepository';
import { PropertyRepository } from './PropertyRepository';

import type { DuckDBValue } from '@duckdb/node-api';

import type { Method } from '../../../shared/types/Method';
import type { Property } from '../../../shared/types/Property';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IClassOrInterfaceRow } from '../types/DatabaseResults';


/**
 * Data transfer object for creating a new interface.
 */
export interface IInterfaceCreateDTO {
  /**
   * The unique identifier for the interface.
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
   * The name of the interface.
   */
  name: string;
}

interface IInterfaceUpdateDTO {
  name?: string;
}

/**
 * Repository interface for managing interfaces.
 */
export interface IInterfaceRepository {
  /**
   * Creates a new interface.
   */
  create(dto: IInterfaceCreateDTO): Promise<Interface>;

  /**
   * Finds an interface by its ID.
   */
  findById(id: string): Promise<IInterfaceCreateDTO | null>;

  /**
   * Finds all interfaces in a module.
   */
  findByModuleId(moduleId: string): Promise<IInterfaceCreateDTO[]>;

  /**
   * Deletes an interface by its ID.
   */
  delete(id: string): Promise<void>;
}

export class InterfaceRepository extends BaseRepository<Interface, IInterfaceCreateDTO, IInterfaceUpdateDTO> {
  private readonly methodRepository: MethodRepository;
  private readonly propertyRepository: PropertyRepository;

  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[InterfaceRepository]', 'interfaces');
    this.methodRepository = new MethodRepository(adapter);
    this.propertyRepository = new PropertyRepository(adapter);
  }

  /**
   * Batch-insert multiple interfaces at once. Ignores duplicates.
   */
  async createBatch(items: IInterfaceCreateDTO[]): Promise<void> {
    const now = new Date().toISOString();
    await this.executeBatchInsert(
      '(id, package_id, module_id, name, created_at)',
      5,
      items,
      (dto) => [dto.id, dto.package_id, dto.module_id, dto.name, now]
    );
  }

  async create(dto: IInterfaceCreateDTO): Promise<Interface> {
    try {
      const now = new Date().toISOString();
      const results = await this.executeQuery<IClassOrInterfaceRow>(
        'create',
        'INSERT INTO interfaces (id, package_id, module_id, name, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *',
        [String(dto.id), String(dto.package_id), String(dto.module_id), String(dto.name), now]
      );

      if (results.length === 0) {
        throw new RepositoryError('Interface not created', 'create', this.errorTag);
      }

      const iface = results[0];
      if (!iface) {
        throw new RepositoryError('Interface not created', 'create', this.errorTag);
      }

      return new Interface(
        String(iface.id),
        String(iface.package_id),
        String(iface.module_id),
        String(iface.name),
        new Date(String(iface.created_at)),
        new Map<string, Method>(),
        new Map<string, Property>(),
        new Map<string, Interface>()
      );
    } catch (error) {
      // Only log if it's not already a RepositoryError
      if (!(error instanceof RepositoryError)) {
        this.logger.error(`Failed to create interface: ${dto.name}`, error);
      }
      throw new RepositoryError('Failed to create interface', 'create', this.errorTag, error as Error);
    }
  }

  async update(id: string, dto: IInterfaceUpdateDTO): Promise<Interface> {
    try {
      const updates = [{ field: 'name', value: (dto.name as DuckDBValue) ?? undefined }] satisfies {
        field: string;
        value: DuckDBValue | undefined;
      }[];

      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);

      await this.executeQuery<IClassOrInterfaceRow>(
        'update',
        `UPDATE ${this.tableName} SET ${query} WHERE id = ?`,
        values
      );

      const result = await this.retrieveById(id);
      if (!result) {
        throw new RepositoryError('Interface not found', 'update', this.errorTag, new Error('Interface not found'));
      }
      return result;
    } catch (error) {
      if (!(error instanceof RepositoryError)) {
        this.logger.error(`Failed to update interface: ${id}`, error);
      }
      throw new RepositoryError('Failed to update interface', 'update', this.errorTag, error as Error);
    }
  }

  async retrieve(id?: string, module_id?: string): Promise<Interface[]> {
    try {
      // Build conditions array for more robust query construction
      const conditions: string[] = [];
      const params: DuckDBValue[] = [];

      if (id !== undefined) {
        conditions.push('i.id = ?');
        params.push(String(id));
      }

      if (module_id !== undefined) {
        conditions.push('i.module_id = ?');
        params.push(String(module_id));
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const query = `
        SELECT i.* 
        FROM interfaces i
        ${whereClause}
      `
        .trim()
        .replace(/\s+/g, ' ');

      this.logger.debug('Executing retrieve query:', { query, params });

      const results = await this.executeQuery<IClassOrInterfaceRow>('retrieve', query, params);

      // Fetch all related data for each interface
      const supremeInterfaces = await Promise.all(
        results.map(async (iface) => {
          try {
            this.logger.debug(`Processing interface ${iface.id}`);

            // Use specialized repositories to retrieve methods and properties
            const [methodsMap, propertiesMap] = await Promise.all([
              this.methodRepository.retrieveByParent(String(iface.id), 'interface'),
              this.propertyRepository.retrieveByParent(String(iface.id), 'interface'),
            ]);

            // Fetch extended interfaces without explicit type casting
            const extendedInterfaces = await this.executeQuery<IClassOrInterfaceRow>(
              'retrieve extended',
              `SELECT i.* FROM interfaces i 
               JOIN interface_extends ie ON i.id = ie.extended_id 
               WHERE ie.interface_id = ?`,
              [String(iface.id)]
            );

            this.logger.debug(
              `Found ${String(extendedInterfaces.length)} extended interfaces for interface ${iface.id}`
            );

            // Convert extended interfaces to Map
            const extendedMap = new Map<string, Interface>();
            extendedInterfaces.forEach((extended) => {
              extendedMap.set(String(extended.id), {
                id: String(extended.id),
                package_id: String(extended.package_id),
                module_id: String(extended.module_id),
                name: String(extended.name),
                created_at: new Date(String(extended.created_at)),
                methods: new Map(),
                properties: new Map(),
                extended_interfaces: new Map(),
              });
            });

            return new Interface(
              String(iface.id),
              String(iface.package_id),
              String(iface.module_id),
              String(iface.name),
              new Date(String(iface.created_at)),
              methodsMap,
              propertiesMap,
              extendedMap
            );
          } catch (error) {
            if (error instanceof RepositoryError) {
              throw error;
            }
            throw new RepositoryError(
              `Failed to process interface ${iface.id}`,
              'retrieve',
              this.errorTag,
              error as Error
            );
          }
        })
      );

      return supremeInterfaces;
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to retrieve interfaces', 'retrieve', this.errorTag, error as Error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      // Delete related records first
      await this.executeQuery<IClassOrInterfaceRow>(
        'delete methods',
        'DELETE FROM methods WHERE parent_id = ? AND parent_type = ?',
        [id, 'interface']
      );
      await this.executeQuery<IClassOrInterfaceRow>(
        'delete properties',
        'DELETE FROM properties WHERE parent_id = ? AND parent_type = ?',
        [id, 'interface']
      );

      // Delete the interface itself
      await this.executeQuery<IClassOrInterfaceRow>('delete interface', 'DELETE FROM interfaces WHERE id = ?', [id]);
    } catch (error) {
      if (!(error instanceof RepositoryError)) {
        this.logger.error(`Failed to delete interface: ${id}`, error);
      }
      throw new RepositoryError('Failed to delete interface', 'delete', this.errorTag, error as Error);
    }
  }

  async retrieveById(id: string): Promise<Interface | undefined> {
    const results = await this.retrieve(id);
    return results[0];
  }

  async retrieveByModuleId(module_id: string): Promise<Interface[]> {
    return this.retrieve(undefined, module_id);
  }

  /**
   * Batch-retrieve all interfaces whose module_id is in the given list.
   * Returns lightweight rows (without hydrated methods/properties/extended interfaces)
   * for in-memory distribution by the caller.
   */
  async retrieveByModuleIds(moduleIds: string[]): Promise<Interface[]> {
    if (moduleIds.length === 0) return [];
    try {
      const placeholders = moduleIds.map(() => '?').join(', ');
      const results = await this.executeQuery<IClassOrInterfaceRow>(
        'retrieveByModuleIds',
        `SELECT i.* FROM interfaces i WHERE i.module_id IN (${placeholders})`,
        moduleIds
      );
      return results.map(
        (iface) =>
          new Interface(
            iface.id,
            iface.package_id,
            iface.module_id,
            iface.name,
            new Date(iface.created_at),
            new Map<string, Method>(),
            new Map<string, Property>(),
            new Map<string, Interface>()
          )
      );
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to retrieve interfaces by module IDs', 'retrieveByModuleIds', this.errorTag, error as Error);
    }
  }

}
