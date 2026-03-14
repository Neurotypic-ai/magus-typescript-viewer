import { readdir } from 'fs/promises';
import { dirname, join, relative, resolve } from 'path';

import ts from 'typescript';

import { createLogger } from '../../shared/utils/logger';

import type { Logger } from '../../shared/utils/logger';

export interface FileDiscoveryConfig {
  /** Maximum number of concurrent file parse operations */
  concurrency: number;
  /** Directories to always exclude from traversal */
  excludedDirectories: Set<string>;
  /** Regex pattern matching analyzable source file extensions */
  sourceFilePattern: RegExp;
}

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  'out',
]);

const DEFAULT_SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs|vue)$/i;

const DEFAULT_CONCURRENCY = 8;

export const DEFAULT_FILE_DISCOVERY_CONFIG: FileDiscoveryConfig = {
  concurrency: DEFAULT_CONCURRENCY,
  excludedDirectories: DEFAULT_EXCLUDED_DIRECTORIES,
  sourceFilePattern: DEFAULT_SOURCE_FILE_PATTERN,
};

export class FileDiscovery {
  private readonly logger: Logger;

  constructor(
    private readonly packagePath: string,
    private readonly config: FileDiscoveryConfig
  ) {
    this.logger = createLogger('FileDiscovery');
  }

  async collectFiles(): Promise<string[]> {
    const filesFromTsConfig = await this.collectFilesFromTsConfig();
    if (filesFromTsConfig) {
      return filesFromTsConfig;
    }
    const files = await this.traverseDirectory(this.packagePath);
    return files.sort((a, b) => a.localeCompare(b));
  }

  isAnalyzableSourceFile(fileName: string): boolean {
    return this.config.sourceFilePattern.test(fileName) && !/\.d\.[cm]?tsx?$/i.test(fileName);
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }

  private shouldSkipDirectory(dirName: string): boolean {
    return dirName.startsWith('.') || this.config.excludedDirectories.has(dirName);
  }

  isExcludedPath(fullPath: string): boolean {
    const relativePath = this.normalizePath(relative(this.packagePath, fullPath));
    if (relativePath.startsWith('..')) {
      return true;
    }

    return relativePath
      .split('/')
      .filter((segment) => segment.length > 0)
      .some((segment) => this.shouldSkipDirectory(segment));
  }

  private async traverseDirectory(dir: string): Promise<string[]> {
    if (this.isExcludedPath(dir)) {
      return [];
    }

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const subDirPromises: Promise<string[]>[] = [];
    const fileResults: string[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!this.shouldSkipDirectory(entry.name)) {
          subDirPromises.push(this.traverseDirectory(fullPath));
        }
      } else if (entry.isFile() && this.isAnalyzableSourceFile(entry.name)) {
        fileResults.push(fullPath);
      }
    }

    const subResults = await Promise.all(subDirPromises);
    for (const sub of subResults) fileResults.push(...sub);
    return fileResults;
  }

  private getIncludeRoots(tsConfig: Record<string, unknown>, configDir: string): string[] {
    const include = Array.isArray(tsConfig['include']) ? tsConfig['include'] : [];
    const roots = new Set<string>();

    for (const pattern of include) {
      if (typeof pattern !== 'string' || pattern.trim().length === 0) {
        continue;
      }

      const normalizedPattern = this.normalizePath(pattern.trim());
      const wildcardIndex = normalizedPattern.search(/[*{]/);
      const base = wildcardIndex >= 0 ? normalizedPattern.slice(0, wildcardIndex) : normalizedPattern;
      const cleanedBase = base.endsWith('/') ? base.slice(0, -1) : base;
      const candidate = resolve(configDir, cleanedBase.length > 0 ? cleanedBase : '.');
      roots.add(candidate);
    }

    if (roots.size === 0) {
      roots.add(this.packagePath);
    }

    return Array.from(roots);
  }

  private async collectFilesFromTsConfig(): Promise<string[] | null> {
    const tsConfigPath = ts.findConfigFile(this.packagePath, (fileName) => ts.sys.fileExists(fileName), 'tsconfig.json');
    if (!tsConfigPath) {
      return null;
    }

    const configDir = dirname(tsConfigPath);
    const configResult = ts.readConfigFile(tsConfigPath, (fileName) => ts.sys.readFile(fileName));
    if (configResult.error) {
      this.logger.warn(`Failed to read tsconfig at ${tsConfigPath}, falling back to directory traversal`);
      return null;
    }

    const parsedConfig = ts.parseJsonConfigFileContent(configResult.config, ts.sys, configDir, undefined, tsConfigPath);
    if (parsedConfig.errors.length > 0) {
      this.logger.warn(`Encountered tsconfig parse errors at ${tsConfigPath}, continuing with available file list`);
    }

    const fileSet = new Set<string>();

    for (const fileName of parsedConfig.fileNames) {
      const absolutePath = resolve(fileName);
      if (!this.isAnalyzableSourceFile(absolutePath)) {
        continue;
      }
      if (this.isExcludedPath(absolutePath)) {
        continue;
      }
      fileSet.add(absolutePath);
    }

    const includeRoots = this.getIncludeRoots(configResult.config as Record<string, unknown>, configDir);
    for (const root of includeRoots) {
      if (this.isExcludedPath(root)) {
        continue;
      }
      const rootedFiles = await this.traverseDirectory(root);
      for (const filePath of rootedFiles) {
        if (filePath.endsWith('.vue')) {
          fileSet.add(resolve(filePath));
        }
      }
    }

    return Array.from(fileSet).sort((a, b) => a.localeCompare(b));
  }
}
