import { access, readFile } from 'fs/promises';
import { dirname, join, relative } from 'path';

import jscodeshift from 'jscodeshift';

import { Export } from '../../shared/types/Export';
import { createLogger } from '../../shared/utils/logger';
import { generateExportUUID, generateModuleUUID } from '../utils/uuid';

import type { FileLocation } from '../../shared/types/FileLocation';
import type { IModuleCreateDTO } from '../db/repositories/ModuleRepository';
import type { ParseResult } from './ParseResult';
import type { ModuleParserContext } from './module/types';

import { isBarrelFile, parseImportsAndExports } from './module/parseImportsExports';
import { parseClasses } from './module/parseClasses';
import { parseInterfaces } from './module/parseInterfaces';
import { parseEnums, parseFunctions, parseTypeAliases, parseVariables } from './module/parseModuleSymbols';

export class ModuleParser {
  private readonly j = jscodeshift.withParser('tsx');
  private readonly logger = createLogger('ModuleParser');

  constructor(
    private readonly filePath: string,
    private readonly packageId: string,
    private readonly sourceOverride?: string
  ) {}

  async parse(): Promise<ParseResult> {
    const moduleId = generateModuleUUID(this.packageId, this.filePath);
    const relativePath = relative(process.cwd(), this.filePath);

    try {
      const content = this.sourceOverride ?? (await readFile(this.filePath, 'utf-8'));
      const lineCount = content.split('\n').length;
      const root = this.j(content);

      const ctx: ModuleParserContext = {
        j: this.j,
        root,
        packageId: this.packageId,
        moduleId,
        filePath: this.filePath,
        logger: this.logger,
      };

      // 1. Parse imports/exports first (ordering constraint: exports set
      //    is consumed by all module-level symbol parsers below)
      const { imports, exports, reExports } = parseImportsAndExports(ctx);

      // 2. Build module DTO (needs exports/reExports for barrel detection)
      const moduleDTO = await this.createModuleDTO(moduleId, relativePath, lineCount, exports, reExports);

      // 3. Initialize result
      const result: ParseResult = {
        package: undefined,
        modules: [moduleDTO],
        classes: [],
        interfaces: [],
        functions: [],
        typeAliases: [],
        enums: [],
        variables: [],
        methods: [],
        properties: [],
        parameters: [],
        imports: [],
        exports: [],
        classExtends: [],
        classImplements: [],
        interfaceExtends: [],
        symbolUsages: [],
        symbolReferences: [],
      };

      // 4. Parse declarations
      parseClasses(ctx, result);
      parseInterfaces(ctx, result);
      parseFunctions(ctx, exports, result);
      parseTypeAliases(ctx, exports, result);
      parseEnums(ctx, exports, result);
      parseVariables(ctx, exports, result);

      // 5. Finalize imports and exports on the result
      result.imports = Array.from(imports.values());
      result.exports = Array.from(exports).map(
        (exportName) => new Export(generateExportUUID(moduleId, exportName), moduleId, exportName, false)
      );

      return result;
    } catch (error) {
      console.warn(
        `Warning: Failed to process ${relativePath}:`,
        error instanceof Error ? error.message : String(error)
      );

      return {
        modules: [await this.createModuleDTO(moduleId, relativePath)],
        classes: [],
        functions: [],
        typeAliases: [],
        enums: [],
        variables: [],
        interfaces: [],
        methods: [],
        properties: [],
        parameters: [],
        imports: [],
        exports: [],
        classExtends: [],
        classImplements: [],
        interfaceExtends: [],
        symbolUsages: [],
        symbolReferences: [],
      };
    }
  }

  private async createModuleDTO(
    moduleId: string,
    relativePath: string,
    lineCount?: number,
    exports?: Set<string>,
    reExports?: Set<string>
  ): Promise<IModuleCreateDTO> {
    const directory = dirname(this.filePath);
    const fullName = relativePath.split('/').pop() ?? '';
    const name = fullName.replace(/\.[^/.]+$/, '');

    // Check for index files
    let indexFile: string | undefined;
    const indexCandidates = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs', 'index.vue'];
    for (const candidate of indexCandidates) {
      const candidatePath = join(directory, candidate);
      try {
        await access(candidatePath);
        indexFile = candidatePath;
        break;
      } catch {
        // Continue checking candidates
      }
    }

    return {
      id: moduleId,
      package_id: this.packageId,
      name,
      source: {
        directory,
        name,
        filename: this.filePath,
        relativePath,
        index: indexFile,
        isBarrel: exports && reExports ? isBarrelFile(exports, reExports) : false,
      } as FileLocation,
      line_count: lineCount ?? 0,
    };
  }
}
