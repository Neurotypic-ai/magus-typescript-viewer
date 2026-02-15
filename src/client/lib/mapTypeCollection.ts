import type { TypeCollection } from '../../shared/types/TypeCollection';

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
 * Convert any TypeCollection (Map, Array, or Record) to a flat array.
 * Handles undefined gracefully by returning [].
 */
export function typeCollectionToArray<T>(collection: TypeCollection<T> | undefined): T[] {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (collection instanceof Map) return Array.from(collection.values());
  return Object.values(collection);
}
