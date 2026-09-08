import { bundledLanguages, codeToTokens } from 'shiki/bundle/web';

const THEME = 'github-dark-default';

export type Token = { content: string; color: string | undefined };

const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'shellscript',
  bash: 'shellscript',
  py: 'python',
  sql: 'sql',
  xml: 'xml',
};

export function languageForPath(path: string): string {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const language = BY_EXTENSION[extension] ?? 'text';
  return language in bundledLanguages || language === 'text' ? language : 'text';
}

/** One token array per line; falls back to unhighlighted lines on any failure. */
export async function highlightLines(code: string, language: string): Promise<Token[][]> {
  try {
    const { tokens } = await codeToTokens(code, {
      lang: language as keyof typeof bundledLanguages,
      theme: THEME,
    });
    return tokens.map((line) => line.map(({ content, color }) => ({ content, color })));
  } catch {
    return code.split('\n').map((line) => [{ content: line, color: undefined }]);
  }
}
