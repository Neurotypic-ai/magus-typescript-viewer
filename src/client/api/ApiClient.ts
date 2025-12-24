import type { Module } from '../../shared/types/Module';
import type { Package } from '../../shared/types/Package';

export class ApiClient {
  constructor(private baseUrl: string) {}

  async getPackages(): Promise<Package[]> {
    return this.get<Package>('/packages');
  }

  async getModules(packageId: string): Promise<Module[]> {
    return this.get<Module>('/modules', { packageId });
  }

  private async get<T>(resource: string, queryParams?: Record<string, string>): Promise<T[]> {
    const queryString = queryParams ? `?${new URLSearchParams(queryParams).toString()}` : '';
    const response = await fetch(`${this.baseUrl}${resource}${queryString}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status.toString()}`);
    }

    const data = (await response.json()) as T[];

    if (!Array.isArray(data)) {
      throw new Error('Invalid response: data is not an array');
    }

    if (!data.every((item) => typeof item === 'object')) {
      throw new Error('Invalid response: items are not objects');
    }

    return data;
  }
}
