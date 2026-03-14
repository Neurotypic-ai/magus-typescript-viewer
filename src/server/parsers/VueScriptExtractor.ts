import { readFile } from 'fs/promises';

import { parse } from '@vue/compiler-sfc';

export class VueScriptExtractor {
  async getSourceOverride(filePath: string): Promise<string | undefined> {
    if (!filePath.endsWith('.vue')) {
      return undefined;
    }

    const vueSource = await readFile(filePath, 'utf-8');
    return this.extractScriptContent(vueSource);
  }

  private extractScriptContent(source: string): string {
    const { descriptor } = parse(source);
    const scriptBlocks: string[] = [];

    for (const block of [descriptor.script, descriptor.scriptSetup]) {
      if (!block || block.src) {
        continue;
      }

      const language = block.lang?.toLowerCase();
      const normalizedLanguage =
        language === 'typescript' ? 'ts'
        : language === 'javascript' ? 'js'
        : language;

      if (normalizedLanguage && !['ts', 'tsx', 'js', 'jsx'].includes(normalizedLanguage)) {
        continue;
      }

      scriptBlocks.push(block.content);
    }

    return scriptBlocks.join('\n');
  }
}
