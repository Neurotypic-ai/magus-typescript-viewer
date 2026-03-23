import type { DependencyType } from '../DependencyType';

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
