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
