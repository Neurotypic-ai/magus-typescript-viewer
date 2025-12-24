import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadSchema(): string {
  const schemaFileUrl = new URL('./schema.sql', import.meta.url);
  return readFileSync(fileURLToPath(schemaFileUrl), 'utf-8');
}
