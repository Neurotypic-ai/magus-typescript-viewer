/**
 * Represents the location of a module in the file system.
 *
 * Included examples reference a Module at the location: src/components/Button/Button.tsx
 */

export interface FileLocation {
  /**
   * The directory containing the component.
   * Example: /path/to/project/src/components/Button/
   */
  readonly directory: string;

  /**
   * The name of the component.
   * Example: Button
   */
  readonly name: string;

  /**
   * The path of the component.
   * Example: /path/to/project/src/components/Button/Button.tsx
   */
  readonly filename: string;

  /**
   * The relative path of the import.
   * Example: components/Button/Button.tsx
   */
  readonly relativePath: string;

  /**
   * The path of an index.ts file, if one exists.
   * Example: /path/to/project/src/components/Button/index.ts
   */
  readonly index?: string;

  /**
   * An array of possible test files related to this component.
   * Example: [ /path/to/project/src/components/Button/tests/Button.test.tsx ]
   */
  readonly tests?: readonly string[];

  /**
   * Indicates if this module is a barrel file (primarily re-exports).
   * A module is considered a barrel if >80% of its exports are re-exports.
   */
  readonly isBarrel?: boolean;
}
