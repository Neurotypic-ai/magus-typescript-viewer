import type { FileLocation } from '../FileLocation';

/**
 * Data transfer object for creating a new module.
 */
export interface IModuleCreateDTO {
  id: string;
  package_id: string;
  name: string;
  source: FileLocation;
  line_count?: number;
}

export interface IModuleUpdateDTO {
  name?: string;
  source?: FileLocation;
}
