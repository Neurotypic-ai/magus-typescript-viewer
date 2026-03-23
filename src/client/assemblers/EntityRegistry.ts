export class EntityRegistry {
  private readonly entities = new Map<string, unknown>();

  register<T>(id: string, entity: T): T {
    this.entities.set(id, entity);
    return entity;
  }

  get<T>(id: string): T | undefined {
    return this.entities.get(id) as T | undefined;
  }

  getRequired<T>(id: string): T {
    const entity = this.entities.get(id);
    if (!entity) {
      throw new Error(`Entity not found: ${id}`);
    }
    return entity as T;
  }
}
