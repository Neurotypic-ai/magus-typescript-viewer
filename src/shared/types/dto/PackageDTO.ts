/**
 * Data transfer object for creating a new package.
 */
export interface IPackageCreateDTO {
  id: string;
  name: string;
  version: string;
  path: string;
  dependencies?: Map<string, string>;
  devDependencies?: Map<string, string>;
  peerDependencies?: Map<string, string>;
}

export interface IPackageUpdateDTO {
  name?: string;
  version?: string;
  path?: string;
}
