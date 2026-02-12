import { Property } from '../../../shared/types/Property';
import { EntityNotFoundError, NoFieldsToUpdateError, RepositoryError } from '../errors/RepositoryError';
import { BaseRepository } from './BaseRepository';

import type { DuckDBValue } from '@duckdb/node-api';

import type { VisibilityType } from '../../../shared/types/VisibilityType';
import type { IDatabaseAdapter } from '../adapter/IDatabaseAdapter';
import type { IPropertyRow } from '../types/DatabaseResults';

/**
 * Data transfer object for creating a new property.
 */
export interface IPropertyCreateDTO {
  /**
   * The unique identifier for the property.
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
   * The UUID of the parent class or interface.
   */
  parent_id: string;

  /**
   * The type of the parent (class or interface).
   */
  parent_type: 'class' | 'interface';

  /**
   * The name of the property.
   */
  name: string;

  /**
   * The type of the property.
   */
  type: string;

  /**
   * Whether the property is static.
   */
  is_static: boolean;

  /**
   * Whether the property is readonly.
   */
  is_readonly: boolean;

  /**
   * The visibility of the property (public, private, protected).
   */
  visibility: string;
}

/**
 * Repository interface for managing properties.
 */
export interface IPropertyRepository {
  /**
   * Creates a new property.
   */
  create(dto: IPropertyCreateDTO): Promise<Property>;

  /**
   * Finds a property by its ID.
   */
  findById(id: string): Promise<IPropertyCreateDTO | null>;

  /**
   * Finds all properties in a parent (class or interface).
   */
  findByParentId(parentId: string): Promise<IPropertyCreateDTO[]>;

  /**
   * Deletes a property by its ID.
   */
  delete(id: string): Promise<void>;
}

interface IPropertyUpdateDTO {
  name?: string;
  type?: string;
  is_static?: boolean;
  is_readonly?: boolean;
  visibility?: VisibilityType;
}

export class PropertyRepository extends BaseRepository<Property, IPropertyCreateDTO, IPropertyUpdateDTO> {
  constructor(adapter: IDatabaseAdapter) {
    super(adapter, '[PropertyRepository]', 'properties');
  }

  /**
   * Batch-insert multiple properties at once. Ignores duplicates.
   */
  async createBatch(items: IPropertyCreateDTO[]): Promise<void> {
    await this.executeBatchInsert(
      '(id, package_id, module_id, parent_id, parent_type, name, type, is_static, is_readonly, visibility)',
      10,
      items,
      (dto) => [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.parent_id,
        dto.parent_type,
        dto.name,
        dto.type,
        dto.is_static,
        dto.is_readonly,
        dto.visibility,
      ]
    );
  }

  async create(dto: IPropertyCreateDTO): Promise<Property> {
    try {
      const params: (string | boolean)[] = [
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.parent_id,
        dto.parent_type,
        dto.name,
        dto.type,
        dto.is_static,
        dto.is_readonly,
        dto.visibility,
      ];

      await this.executeQuery<IPropertyRow>(
        'create',
        'INSERT INTO properties (id, package_id, module_id, parent_id, parent_type, name, type, is_static, is_readonly, visibility) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        params
      );

      return new Property(
        dto.id,
        dto.package_id,
        dto.module_id,
        dto.parent_id,
        dto.name,
        new Date(),
        dto.type,
        dto.is_static,
        dto.is_readonly,
        dto.visibility
      );
    } catch (error) {
      this.logger.error('Failed to create property', error);
      throw new RepositoryError('Failed to create property', 'create', this.errorTag, error as Error);
    }
  }

  async update(id: string, dto: IPropertyUpdateDTO): Promise<Property> {
    try {
      const updates = [
        { field: 'name', value: (dto.name as DuckDBValue) ?? undefined },
        { field: 'type', value: (dto.type as DuckDBValue) ?? undefined },
        { field: 'is_static', value: (dto.is_static as DuckDBValue) ?? undefined },
        { field: 'is_readonly', value: (dto.is_readonly as DuckDBValue) ?? undefined },
        { field: 'visibility', value: (dto.visibility as DuckDBValue) ?? undefined },
      ] satisfies { field: string; value: DuckDBValue | undefined }[];

      if (updates.every((update) => update.value === undefined)) {
        throw new NoFieldsToUpdateError('Property', this.errorTag);
      }

      const { query, values } = this.buildUpdateQuery(updates);
      values.push(id);

      await this.executeQuery<IPropertyRow>('update', `UPDATE ${this.tableName} SET ${query} WHERE id = ?`, values);

      const result = await this.retrieveById(id);
      if (!result) {
        throw new EntityNotFoundError('Property', id, this.errorTag);
      }
      return result;
    } catch (error) {
      this.logger.error('Failed to update property', error);
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError('Failed to update property', 'update', this.errorTag, error as Error);
    }
  }

  async retrieveById(id: string): Promise<Property | undefined> {
    const results = await this.retrieve(id);
    return results[0];
  }

  async retrieveByModuleId(module_id: string): Promise<Property[]> {
    return this.retrieve(undefined, module_id);
  }

  async retrieve(id?: string, module_id?: string): Promise<Property[]> {
    try {
      let query = 'SELECT * FROM properties';
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
        query = query + ' WHERE ' + conditions.join(' AND ');
      }

      const results = await this.executeQuery<IPropertyRow>('retrieve properties', query, params);
      return results.map(
        (prop) =>
          new Property(
            prop.id,
            prop.package_id,
            prop.module_id,
            prop.parent_id,
            prop.name,
            new Date(prop.created_at),
            prop.type,
            prop.is_static,
            prop.is_readonly,
            prop.visibility as VisibilityType
          )
      );
    } catch (error) {
      this.logger.error('Failed to retrieve property', error);
      throw new RepositoryError('Failed to retrieve property', 'retrieve', this.errorTag, error as Error);
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.executeQuery<IPropertyRow>('delete', 'DELETE FROM properties WHERE id = ?', [id]);
    } catch (error) {
      this.logger.error('Failed to delete property', error);
      throw new RepositoryError('Failed to delete property', 'delete', this.errorTag, error as Error);
    }
  }

  /**
   * Batch-retrieve all properties for multiple parent IDs of a given type.
   * Returns a Map keyed by parent_id, each value is a Map<string, Property>.
   */
  async retrieveByParentIds(
    parentIds: string[],
    parentType: 'class' | 'interface'
  ): Promise<Map<string, Map<string, Property>>> {
    const result = new Map<string, Map<string, Property>>();
    if (parentIds.length === 0) return result;

    // Initialise empty maps for every requested parent
    for (const pid of parentIds) {
      result.set(pid, new Map<string, Property>());
    }

    try {
      const placeholders = parentIds.map(() => '?').join(', ');
      const properties = await this.executeQuery<IPropertyRow>(
        'retrieveByParentIds',
        `SELECT * FROM properties WHERE parent_id IN (${placeholders}) AND parent_type = ?`,
        [...parentIds, parentType]
      );

      for (const prop of properties) {
        const propObj = new Property(
          prop.id,
          prop.package_id,
          prop.module_id,
          prop.parent_id,
          prop.name,
          new Date(prop.created_at),
          prop.type,
          prop.is_static,
          prop.is_readonly,
          prop.visibility as VisibilityType
        );

        const parentMap = result.get(prop.parent_id);
        if (parentMap) {
          parentMap.set(prop.id, propObj);
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Failed to retrieve properties by parent IDs', error);
      throw new RepositoryError(
        'Failed to retrieve properties by parent IDs',
        'retrieveByParentIds',
        this.errorTag,
        error as Error
      );
    }
  }

  async retrieveByParent(parentId: string, parentType: 'class' | 'interface'): Promise<Map<string, Property>> {
    try {
      // Fetch properties with proper parameter handling
      const properties = await this.executeQuery<IPropertyRow>(
        'retrieve properties',
        'SELECT * FROM properties WHERE parent_id = ? AND parent_type = ?',
        [parentId, parentType]
      );

      this.logger.debug(`Found ${properties.length.toString()} properties for ${parentType} ${parentId}`);

      // Convert properties to Map with proper type handling
      const propertiesMap = new Map<string, Property>();
      properties.forEach((prop) => {
        propertiesMap.set(
          prop.id,
          new Property(
            prop.id,
            prop.package_id,
            prop.module_id,
            prop.parent_id,
            prop.name,
            new Date(prop.created_at),
            prop.type,
            prop.is_static,
            prop.is_readonly,
            prop.visibility as VisibilityType
          )
        );
      });

      return propertiesMap;
    } catch (error) {
      this.logger.error('Failed to retrieve properties by parent', error);
      throw new RepositoryError(
        'Failed to retrieve properties by parent',
        'retrieveByParent',
        this.errorTag,
        error as Error
      );
    }
  }
}
