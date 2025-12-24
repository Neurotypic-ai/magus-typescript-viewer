/**
 * Represents the names of exports that are valid from this file.
 */
export interface IExport {
  /**
   * The UUID for this export.
   */
  readonly uuid: string;

  /**
   * The module UUID that exports the symbol.
   */
  readonly module: string;

  /**
   * The name of the export (e.g., 'exportedVariable').
   */
  readonly name: string;

  /**
   * The local name of the export in the source module, if different from the exported name.
   */
  readonly localName?: string | undefined;

  /**
   * The uuid of the module from which this export is re-exported, if applicable.
   * If not set, this is a top-level export.
   */
  readonly exportedFrom?: string | undefined;

  /**
   * Indicates whether this is a default export.
   */
  readonly isDefault: boolean;

  /**
   * The UUIDs of the imports that reference this export.
   */
  imports: Set<string>;
}

/**
 * Class implementation for Export.
 */
export class Export implements IExport {
  constructor(
    public readonly uuid: string,
    public readonly module: string,
    public readonly name: string,
    public readonly isDefault: boolean,
    public readonly localName?: string | undefined,
    public readonly exportedFrom?: string | undefined,
    public readonly imports: Set<string> = new Set()
  ) {}
}
