export interface Serializable {
  serialize(): string;
}

export interface Identifiable {
  readonly id: string;
}

/** A generic repository contract with multiple inheritance. */
export interface Repository<T> extends Serializable, Identifiable {
  readonly id: string;
  name: string;
  findById(id: string): Promise<T>;
  save(entity: T): Promise<void>;
  delete?(id: string): Promise<boolean>;
}

export interface ChildRepo extends Repository<string> {
  search(query: string): string[];
}
