import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';

const execFile = promisify(execFileCallback);

export interface GitCommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  authorEmail: string;
  committedAt: Date;
}

export interface WorktreeHandle {
  path: string;
  dispose(): Promise<void>;
}

export class GitHistoryService {
  constructor(private readonly repoPath: string) {}

  async listCommits(opts?: { limit?: number; branch?: string }): Promise<GitCommitInfo[]> {
    const args = ['log', '--format=%H|%h|%s|%aN|%aE|%aI'];
    if (opts?.limit != null) {
      args.push(`--max-count=${opts.limit}`);
    }
    if (opts?.branch != null) {
      args.push(opts.branch);
    }

    let stdout: string;
    try {
      const result = await execFile('git', args, { cwd: this.repoPath });
      stdout = result.stdout;
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found') || msg.includes('No such file or directory') || msg.includes('command not found')) {
        throw new Error('git binary not found. Ensure git is installed and on PATH.');
      }
      const stderr = (error as { stderr?: string }).stderr ?? '';
      if (stderr.toLowerCase().includes('not a git repository')) {
        throw new Error(`Not a git repository: ${this.repoPath}`);
      }
      throw error;
    }

    const commits: GitCommitInfo[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Format: hash|shortHash|subject|authorName|authorEmail|isoDate
      // Subject may contain '|', so we split into at most 6 parts from the right
      const parts = trimmed.split('|');
      if (parts.length < 6) continue;

      const hash = parts[0] ?? '';
      const shortHash = parts[1] ?? '';
      const isoDate = parts[parts.length - 1] ?? '';
      const authorEmail = parts[parts.length - 2] ?? '';
      const authorName = parts[parts.length - 3] ?? '';
      // subject is everything between index 2 and the last 3 fields
      const subject = parts.slice(2, parts.length - 3).join('|');

      commits.push({
        hash,
        shortHash,
        subject,
        authorName,
        authorEmail,
        committedAt: new Date(isoDate),
      });
    }

    // git log returns newest-first; reverse to oldest-first
    commits.reverse();

    return commits;
  }

  async createWorktree(commitHash: string): Promise<WorktreeHandle> {
    const tmpPath = path.join(os.tmpdir(), `magus-wt-${commitHash.slice(0, 7)}-${Date.now()}`);

    try {
      await execFile('git', ['worktree', 'add', '--detach', tmpPath, commitHash], { cwd: this.repoPath });
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.includes('not found') || msg.includes('command not found')) {
        throw new Error('git binary not found. Ensure git is installed and on PATH.');
      }
      const stderr = (error as { stderr?: string }).stderr ?? '';
      if (stderr.toLowerCase().includes('not a git repository')) {
        throw new Error(`Not a git repository: ${this.repoPath}`);
      }
      throw error;
    }

    return {
      path: tmpPath,
      dispose: async () => {
        await execFile('git', ['worktree', 'remove', '--force', tmpPath], { cwd: this.repoPath });
        try {
          await fs.rm(tmpPath, { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      },
    };
  }
}
