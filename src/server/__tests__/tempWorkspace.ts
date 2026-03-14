import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

export interface TempWorkspace {
  root: string;
  resolve: (relativePath: string) => string;
  cleanup: () => Promise<void>;
}

export async function createTempWorkspace(prefix = 'server-test-'): Promise<TempWorkspace> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  return {
    root,
    resolve: (relativePath: string) => join(root, relativePath),
    cleanup: async () => {
      await rm(root, {
        recursive: true,
        force: true,
      });
    },
  };
}

export async function writeWorkspaceFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf-8');
  }
}

export async function createWorkspaceWithFiles(
  files: Record<string, string>,
  options?: { prefix?: string }
): Promise<TempWorkspace> {
  const workspace = await createTempWorkspace(options?.prefix);
  await writeWorkspaceFiles(workspace.root, files);
  return workspace;
}
