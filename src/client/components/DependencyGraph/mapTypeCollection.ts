import type { TypeCollection } from '../../../shared/types/TypeCollection';

/**
 * Generic function to map over a TypeCollection regardless of its underlying type
 */
export function mapTypeCollection<T, R>(collection: TypeCollection<T>, mapper: (item: T) => R): R[] {
  if (collection instanceof Map) {
    return Array.from(collection.values()).map(mapper);
  } else if (Array.isArray(collection)) {
    return collection.map(mapper);
  } else {
    return Object.values(collection).map(mapper);
  }
}

/**
 * Flattens a TypeCollection property from an array of objects into a single array
 * @param objects Array of objects containing a TypeCollection property
 * @param collectionKey Key of the TypeCollection property to flatten
 * @returns Array of flattened values from all TypeCollections
 */
export function flattenTypeCollections<T, V>(objects: T[], collectionKey: keyof T): V[] {
  return objects.flatMap((obj) => {
    const collection = obj[collectionKey] as unknown as TypeCollection<V>;
    if (collection instanceof Map) {
      return Array.from(collection.values());
    } else if (Array.isArray(collection)) {
      return collection;
    } else {
      return Object.values(collection);
    }
  });
}

// Example usage:
// const allModules = flattenTypeCollections<Package, Module>(packages, 'modules');
