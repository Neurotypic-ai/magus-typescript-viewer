import { readFile } from 'fs/promises';

export class VueScriptExtractor {
  async getSourceOverride(filePath: string): Promise<string | undefined> {
    if (!filePath.endsWith('.vue')) {
      return undefined;
    }

    const vueSource = await readFile(filePath, 'utf-8');
    return this.extractScriptContent(vueSource);
  }

  private extractScriptContent(source: string): string {
    const scriptBlocks: string[] = [];
    let match: RegExpExecArray | null;

    // Create regex locally to avoid global lastIndex state issues across calls
    const scriptBlockPattern =
      /<script\b((?:[^>=]|=\s*"[^"]*"|=\s*'[^']*'|=[^\s>]*)*)>([\s\S]*?)<\/script>/gi;

    while ((match = scriptBlockPattern.exec(source)) !== null) {
      const attributes = match[1] ?? '';
      const scriptBody = match[2] ?? '';

      // Skip external script imports (src attr)
      if (/\bsrc\s*=/.test(attributes)) {
        continue;
      }

      const languageMatch =
        /\blang\s*=\s*(?:['"]([a-z0-9]+)['"]|([a-z0-9]+)(?:\s|$))/i.exec(attributes);
      const language = (languageMatch?.[1] ?? languageMatch?.[2])?.toLowerCase();
      if (language && !['ts', 'tsx', 'js', 'jsx'].includes(language)) {
        continue;
      }

      scriptBlocks.push(scriptBody);
    }

    return scriptBlocks.join('\n');
  }
}
