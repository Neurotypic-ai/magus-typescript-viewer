import {
  generateClassUUID,
  generateInterfaceUUID,
  generateMethodUUID,
  generateModuleUUID,
  generatePackageUUID,
  generatePropertyUUID,
} from '../../utils/uuid';
import { Database } from '../Database';
import { DuckDBAdapter } from '../adapter/DuckDBAdapter';
import { ClassRepository } from '../repositories/ClassRepository';
import { InterfaceRepository } from '../repositories/InterfaceRepository';
import { MethodRepository } from '../repositories/MethodRepository';
import { ModuleRepository } from '../repositories/ModuleRepository';
import { PackageRepository } from '../repositories/PackageRepository';
import { PropertyRepository } from '../repositories/PropertyRepository';

/**
 * Creates and seeds an in-memory database with sample TypeScript project data.
 * @returns The Database instance with seeded data
 */
export async function createDemoDatabase(): Promise<Database> {
  try {
    // Initialize database adapter and database
    const adapter = new DuckDBAdapter(':memory:');
    await adapter.init();
    const db = new Database(adapter);
    await db.initializeDatabase();

    // Initialize repositories
    const packageRepo = new PackageRepository(adapter);
    const moduleRepo = new ModuleRepository(adapter);
    const classRepo = new ClassRepository(adapter);
    const interfaceRepo = new InterfaceRepository(adapter);
    const methodRepo = new MethodRepository(adapter);
    const propertyRepo = new PropertyRepository(adapter);

    // Generate sample IDs
    const packageId = generatePackageUUID('my-app', '1.0.0');
    const moduleId = generateModuleUUID(packageId, 'greeter');
    const classId = generateClassUUID(packageId, moduleId, 'Greeter');
    const interfaceId = generateInterfaceUUID(packageId, moduleId, 'IGreeter');
    const methodId = generateMethodUUID('demo-package', 'demo-module', interfaceId, 'sayHello');
    const propertyId = generatePropertyUUID('demo-package', 'demo-module', classId, 'name', 'class');

    await packageRepo.create({
      id: packageId,
      name: 'my-app',
      version: '1.0.0',
      path: 'src/my-app',
      dependencies: new Map(),
      devDependencies: new Map(),
      peerDependencies: new Map(),
    });

    await moduleRepo.create({
      id: moduleId,
      package_id: packageId,
      name: 'greeter',
      source: {
        directory: '/src',
        filename: 'greeter.ts',
        relativePath: 'src/greeter.ts',
        isBarrel: false,
        name: 'greeter',
      },
    });

    await classRepo.create({
      id: classId,
      package_id: packageId,
      module_id: moduleId,
      name: 'Greeter',
      extends_id: undefined,
    });

    await interfaceRepo.create({
      id: interfaceId,
      package_id: packageId,
      module_id: moduleId,
      name: 'IGreeter',
    });

    await methodRepo.create({
      id: methodId,
      package_id: packageId,
      module_id: moduleId,
      parent_id: classId,
      name: 'sayHello',
      return_type: 'string',
      parent_type: 'class',
      is_static: false,
      is_async: false,
      visibility: 'public',
    });

    await propertyRepo.create({
      id: propertyId,
      package_id: packageId,
      module_id: moduleId,
      parent_id: classId,
      name: 'name',
      type: 'string',
      parent_type: 'class',
      is_static: false,
      is_readonly: false,
      visibility: 'public',
    });

    return db;
  } catch (error) {
    console.error('Error seeding demo database:', error);
    if (error instanceof Error) {
      throw new Error(`Error seeding demo database: ${error.message}`);
    }
    throw new Error('Error seeding demo database');
  }
}
