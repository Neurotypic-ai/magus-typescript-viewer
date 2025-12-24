import type { DependencyType } from './DependencyType';

/**
 * Represents a dependency relationship between packages.
 */
export interface IDependency {
  /**
   * The unique identifier for the dependency.
   */
  id: string;

  /**
   * The ID of the source package.
   */
  source_id: string;

  /**
   * The ID of the target package.
   */
  target_id: string;

  /**
   * The type of dependency relationship.
   */
  type: DependencyType;

  /**
   * The timestamp when the dependency was created.
   */
  created_at: Date;
}

/**
 * Data transfer object for creating a new dependency.
 */
export interface IDependencyCreateDTO {
  /**
   * The ID of the source package.
   */
  source_id: string;

  /**
   * The ID of the target package.
   */
  target_id: string;

  /**
   * The type of dependency relationship.
   */
  type: DependencyType;
}

/**
 * Data transfer object for updating a dependency.
 */
export interface IDependencyUpdateDTO {
  /**
   * The type of dependency relationship.
   */
  type?: DependencyType;
}
