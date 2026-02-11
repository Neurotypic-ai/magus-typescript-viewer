import { Module } from '../shared/types/Module';
import { createLogger } from '../shared/utils/logger';
import { Database } from './db/Database';
import { DuckDBAdapter } from './db/adapter/DuckDBAdapter';
import { RepositoryError } from './db/errors/RepositoryError';
import { ClassRepository } from './db/repositories/ClassRepository';
import { ImportRepository } from './db/repositories/ImportRepository';
import { InterfaceRepository } from './db/repositories/InterfaceRepository';
import { ModuleRepository } from './db/repositories/ModuleRepository';
import { PackageRepository } from './db/repositories/PackageRepository';
import { SymbolReferenceRepository } from './db/repositories/SymbolReferenceRepository';

import type { Package } from '../shared/types/Package';
import type { TypeCollection } from '../shared/types/TypeCollection';

export interface ApiServerResponderOptions {
  dbPath?: string;
  readOnly?: boolean;
}

export class ApiServerResponder {
  private readonly database: Database;
  private readonly dbAdapter: DuckDBAdapter;
  private readonly logger;
  private readonly readOnly: boolean;

  private readonly classRepository: ClassRepository;
  private readonly interfaceRepository: InterfaceRepository;
  private readonly importRepository: ImportRepository;
  private readonly moduleRepository: ModuleRepository;
  private readonly packageRepository: PackageRepository;
  private readonly symbolReferenceRepository: SymbolReferenceRepository;

  constructor(options: ApiServerResponderOptions = {}) {
    const dbPath = options.dbPath ?? 'typescript-viewer.duckdb';
    this.readOnly = options.readOnly ?? false;
    this.dbAdapter = new DuckDBAdapter(dbPath, { allowWrite: !this.readOnly });
    this.database = new Database(this.dbAdapter, dbPath);
    this.logger = createLogger('ApiServerResponder');

    // Initialize repositories
    this.classRepository = new ClassRepository(this.dbAdapter);
    this.interfaceRepository = new InterfaceRepository(this.dbAdapter);
    this.importRepository = new ImportRepository(this.dbAdapter);
    this.moduleRepository = new ModuleRepository(this.dbAdapter);
    this.packageRepository = new PackageRepository(this.dbAdapter);
    this.symbolReferenceRepository = new SymbolReferenceRepository(this.dbAdapter);
  }

  async initialize(): Promise<void> {
    try {
      // Initialize database connection and prevent schema mutations in read-only mode.
      await this.database.initializeDatabase(false, !this.readOnly);
      this.logger.info(`Database initialized in ${this.readOnly ? 'read-only' : 'read-write'} mode`);
    } catch (error) {
      if (error instanceof RepositoryError) {
        throw error;
      }
      throw new RepositoryError(
        'Failed to initialize database',
        'initialize',
        'ApiServerResponder',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async getPackages(): Promise<
    {
      id: string;
      name: string;
      version: string;
      path: string;
      created_at: Date;
      dependencies: TypeCollection<Package>;
      devDependencies: TypeCollection<Package>;
      peerDependencies: TypeCollection<Package>;
      modules: string[];
    }[]
  > {
    try {
      const packages = await this.packageRepository.retrieve();

      // Fetch module IDs for each package
      const packagesWithModuleIds = await Promise.all(
        packages.map(async (pkg) => {
          try {
            const modules = await this.moduleRepository.retrieveAll(pkg.id);
            const moduleIds = modules.map((mod) => mod.id);

            // Return plain object with moduleIds array
            return {
              id: pkg.id,
              name: pkg.name,
              version: pkg.version,
              path: pkg.path,
              created_at: pkg.created_at,
              dependencies: pkg.dependencies,
              devDependencies: pkg.devDependencies,
              peerDependencies: pkg.peerDependencies,
              modules: moduleIds,
            };
          } catch (error) {
            this.logger.error(`Failed to get module IDs for package ${pkg.id}`, error);
            return {
              id: pkg.id,
              name: pkg.name,
              version: pkg.version,
              path: pkg.path,
              created_at: pkg.created_at,
              dependencies: pkg.dependencies,
              devDependencies: pkg.devDependencies,
              peerDependencies: pkg.peerDependencies,
              modules: [],
            };
          }
        })
      );

      return packagesWithModuleIds;
    } catch (error) {
      this.logger.error('Failed to get packages, returning empty list', error);
      return [];
    }
  }

  async getModules(packageId: string): Promise<Module[]> {
    try {
      const modules = await this.moduleRepository.retrieveAll(packageId);
      const enrichedModules: Module[] = [];

      // Process modules sequentially to avoid overwhelming the database
      for (const mod of modules) {
        try {
          // Load classes first
          const classes = new Map();
          const classesArray = await this.classRepository.retrieve(undefined, mod.id);

          // Process each class sequentially
          for (const cls of classesArray) {
            try {
              // Use repository methods directly
              const methods = await this.classRepository.retrieveMethods(cls.id);
              const properties = await this.classRepository.retrieveProperties(cls.id);

              // Create class with its methods and properties
              classes.set(cls.id, {
                id: cls.id,
                package_id: cls.package_id,
                module_id: cls.module_id,
                name: cls.name,
                created_at: cls.created_at,
                methods,
                properties,
                implemented_interfaces: cls.implemented_interfaces,
                extends_id: cls.extends_id,
              });
            } catch (error) {
              this.logger.error(`Failed to process class ${cls.id} in module ${mod.id}:`, error);
              // Continue with next class
            }
          }

          // Load interfaces
          const interfaces = new Map();
          const interfacesArray = await this.interfaceRepository.retrieve(undefined, mod.id);

          // Process each interface sequentially
          for (const iface of interfacesArray) {
            try {
              // Use repository methods directly
              const methods = await this.interfaceRepository.retrieveMethods(iface.id);
              const properties = await this.interfaceRepository.retrieveProperties(iface.id);

              // Create interface with its methods and properties
              interfaces.set(iface.id, {
                id: iface.id,
                package_id: iface.package_id,
                module_id: iface.module_id,
                name: iface.name,
                created_at: iface.created_at,
                methods,
                properties,
                extended_interfaces: iface.extended_interfaces,
              });
            } catch (error) {
              this.logger.error(`Failed to process interface ${iface.id} in module ${mod.id}:`, error);
              // Continue with next interface
            }
          }

          // Load imports for this module
          const imports = new Map();
          const symbolReferences = new Map();
          try {
            const importsArray = await this.importRepository.findByModuleId(mod.id);
            for (const imp of importsArray) {
              imports.set(imp.id, {
                uuid: imp.id,
                fullPath: imp.source,
                relativePath: imp.source,
                name: imp.source,
                specifiers: new Map(),
                depth: 0,
              });
            }
          } catch (error) {
            this.logger.error(`Failed to load imports for module ${mod.id}:`, error);
            // Continue with empty imports
          }

          try {
            const symbolRefs = await this.symbolReferenceRepository.findByModuleId(mod.id);
            for (const ref of symbolRefs) {
              symbolReferences.set(ref.id, {
                ...ref,
                created_at: new Date(),
              });
            }
          } catch (error) {
            this.logger.error(`Failed to load symbol references for module ${mod.id}:`, error);
          }

          // Create enriched module
          enrichedModules.push(
            new Module(
              mod.id,
              mod.package_id,
              mod.name,
              mod.source,
              mod.created_at,
              classes,
              interfaces,
              imports,
              mod.exports,
              mod.packages,
              mod.typeAliases,
              mod.enums,
              mod.referencePaths,
              symbolReferences
            )
          );
        } catch (error) {
          this.logger.error(`Failed to process module ${mod.id}:`, error);
          // Continue with next module
        }
      }

      return enrichedModules;
    } catch (error) {
      this.logger.error('Failed to get modules, returning empty list', error);
      return [];
    }
  }
}
