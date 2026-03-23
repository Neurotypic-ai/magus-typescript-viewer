import type { ConsolaInstance } from 'consola';
import type { Collection, JSCodeshift } from 'jscodeshift';

export interface ModuleParserContext {
  readonly j: JSCodeshift;
  readonly root: Collection;
  readonly packageId: string;
  readonly moduleId: string;
  readonly filePath: string;
  readonly logger: ConsolaInstance;
}
