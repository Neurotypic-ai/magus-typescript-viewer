/**
 * Module export metadata preserved from the analysis payload.
 */
export interface ModuleExportRef {
  uuid: string;
  name: string;
  localName?: string | undefined;
  exportedFrom?: string | undefined;
  isDefault: boolean;
}
