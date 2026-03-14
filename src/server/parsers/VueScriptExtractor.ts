import { readFile } from 'fs/promises';

const VUE_SCRIPT_BLOCK_PATTERN = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

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

    // Reset lastIndex since we reuse the global regex
    VUE_SCRIPT_BLOCK_PATTERN.lastIndex = 0;

    while ((match = VUE_SCRIPT_BLOCK_PATTERN.exec(source)) !== null) {
      const attributes = match[1] ?? '';
      const scriptBody = match[2] ?? '';

      // Skip external script imports (src attr)
      if (/\bsrc\s*=/.test(attributes)) {
        continue;
      }

      const languageMatch = /\blang\s*=\s*['"]?([a-z0-9]+)['"]?/i.exec(attributes);
      const language = languageMatch?.[1]?.toLowerCase();
      if (language && !['ts', 'tsx', 'js', 'jsx'].includes(language)) {
        continue;
      }

      scriptBlocks.push(scriptBody);
    }

    return scriptBlocks.join('\n');
  }
}
