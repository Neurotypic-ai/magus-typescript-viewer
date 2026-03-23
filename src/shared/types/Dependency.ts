import type { DependencyType } from './DependencyType';

/**
 * Represents a dependency relationship between packages.
 */
export interface IDependency {
  /**
   * The unique identifier for the dependency.
   */
  readonly id: string;

  /**
   * The ID of the source package.
   */
  readonly source_id: string;

  /**
   * The ID of the target package.
   */
  readonly target_id: string;

  /**
   * The type of dependency relationship.
   */
  readonly type: DependencyType;

  /**
   * The timestamp when the dependency was created.
   */
  readonly created_at: string;
}
