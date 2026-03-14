/**
 * A well-documented service class.
 */
export class Widget implements Serializable {
  readonly id: string;
  private name: string;
  protected count: number = 0;
  static version = '1.0';

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  async fetch(): Promise<string> {
    return this.name;
  }

  static create(id: string): Widget {
    return new Widget(id, 'default');
  }
}

export class SpecialWidget extends Widget {
  override async fetch(): Promise<string> {
    return 'special';
  }
}
