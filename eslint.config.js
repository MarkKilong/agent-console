import js from '@eslint/js';
import next from '@next/eslint-plugin-next';
import checkFile from 'eslint-plugin-check-file';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      'pnpm-lock.yaml',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Plain JS/MJS is not covered by the TS parser's globals.
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        { '**/*.{ts,tsx,mjs,js}': 'KEBAB_CASE' },
        { ignoreMiddleExtensions: true },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        // PascalCase covers React components and the zod `XSchema` constants.
        { selector: 'variable', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
        { selector: 'parameter', format: ['camelCase'], leadingUnderscore: 'allow' },
        {
          // Wire fields are snake_case (`session_id`) and agent tool names are
          // PascalCase (`Bash`). Quoted keys — header names — are exempt.
          selector: ['property', 'objectLiteralProperty', 'typeProperty', 'classProperty'],
          format: ['camelCase', 'snake_case', 'UPPER_CASE', 'PascalCase'],
          filter: { regex: '^[A-Za-z_][A-Za-z0-9_]*$', match: true },
        },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
        { selector: 'import', format: ['camelCase', 'PascalCase'] },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': next },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      // App Router only: the rule looks for a pages/ directory and warns it is missing.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  prettier,
);
