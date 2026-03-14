import { readFile } from 'fs/promises';
import { join } from 'path';

import { readPackage } from 'read-pkg';

import { PackageImport } from '../../shared/types/Import';
import { generateImportUUID, generatePackageUUID } from '../utils/uuid';

import type { Import } from '../../shared/types/Import';

interface PackageDependencies {
  dependencies?: Partial<Record<string, string | undefined>> | undefined;
  devDependencies?: Partial<Record<string, string | undefined>> | undefined;
  peerDependencies?: Partial<Record<string, string | undefined>> | undefined;
}

type PackageLock = Record<string, LockfileEntry | undefined>;

interface LockfileEntry {
  version: string;
  resolved: string;
}

export interface DependencyParseResult {
  dependencies: Map<string, string>;
  devDependencies: Map<string, string>;
  peerDependencies: Map<string, string>;
  imports: Map<string, Import>;
}

export class DependencyParser {
  constructor(private readonly packagePath: string) {}

  async parseDependencies(): Promise<DependencyParseResult> {
    const pkg = await readPackage({ cwd: this.packagePath });
    const pkgLock = await this.readPackageLock();
    const packageDependencies = pkg as PackageDependencies;

    const imports = new Map<string, Import>();
    const dependencies = this.parseDependencyType(packageDependencies, pkgLock, 'dependencies', imports);
    const devDependencies = this.parseDependencyType(packageDependencies, pkgLock, 'devDependencies', imports);
    const peerDependencies = this.parseDependencyType(packageDependencies, pkgLock, 'peerDependencies', imports);

    return { dependencies, devDependencies, peerDependencies, imports };
  }

  private parseDependencyType(
    pkg: PackageDependencies,
    pkgLock: PackageLock,
    type: 'dependencies' | 'devDependencies' | 'peerDependencies',
    imports: Map<string, Import>
  ): Map<string, string> {
    const deps = pkg[type];
    const depsMap = new Map<string, string>();

    if (!deps) return depsMap;

    for (const [name, version] of Object.entries(deps)) {
      if (typeof version !== 'string' || version.length === 0) {
        continue;
      }
      const resolution = pkgLock[name]?.version ?? version;
      const dependencyId = generatePackageUUID(name, resolution);
      depsMap.set(name, dependencyId);
      if (!imports.has(name)) {
        const relativePath = `node_modules/${name}`;
        const packageImport = new PackageImport(
          generateImportUUID(this.packagePath, name),
          relativePath,
          relativePath,
          name,
          new Map(),
          0,
          version,
          resolution,
          pkgLock[name]?.resolved,
          type
        );
        imports.set(name, packageImport);
      }
    }

    return depsMap;
  }

  private async readPackageLock(): Promise<PackageLock> {
    try {
      const lockPath = join(this.packagePath, 'package-lock.json');
      const content = await readFile(lockPath, 'utf-8');
      return JSON.parse(content) as PackageLock;
    } catch {
      try {
        const lockPath = join(this.packagePath, 'yarn.lock');
        const content = await readFile(lockPath, 'utf-8');
        return this.parseYarnLock(content);
      } catch {
        return {};
      }
    }
  }

  private parseYarnLock(content: string): PackageLock {
    const deps: PackageLock = {};
    const lines = content.split('\n');
    let currentDep = '';

    const packageNamePattern = /^["']?(@?[^@"']+)@/;

    for (const line of lines) {
      if (line.startsWith('"') || line.startsWith("'") || line.startsWith('@')) {
        const nameMatch = packageNamePattern.exec(line);
        currentDep = nameMatch?.[1] ?? '';
      } else if (line.includes('version') && currentDep) {
        const entry = (deps[currentDep] ??= { version: '', resolved: '' });
        entry.version = line.split('"')[1] ?? '';
      } else if (line.includes('resolved') && currentDep) {
        const entry = (deps[currentDep] ??= { version: '', resolved: '' });
        entry.resolved = line.split('"')[1] ?? '';
      }
    }

    return deps;
  }
}
