// @ts-check
import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
  {
    ignores: [
      'packages/**/dist/**',
      'packages/**/node_modules/**',
      // add any generated folders here
      'packages/dweb-api-server/src/test/**',
      '**/*.spec.ts'
    ],
  },

  // Base JS recommended
  js.configs.recommended,

  // TS recommended (includes parser)
  tseslint.configs.recommended,

  // Import plugin (recommended + TS rules)
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,

  // Project settings for all TS files in packages
  {
    files: ['packages/**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        // Let TS supply type info from each package tsconfig automatically
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    settings: {
      // 👇 Make eslint-plugin-import resolve via TS paths first, then Node
      'import/resolver': {
        typescript: {
          // Pick up every package tsconfig (which extends the root paths file)
          project: ['packages/*/tsconfig.json'],
          alwaysTryTypes: true,
        },
        node: {
          extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.d.ts'],
        },
      },
      'import/extensions': ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'],
    },
    rules: {
      'import/no-unresolved': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'import/extensions': [
        'error',
        'ignorePackages',
        {
          // TypeScript source files are compiled to .js; write .js in all
          // ESM specifiers (NodeNext moduleResolution enforces this at compile
          // time). Never write .ts/.tsx/.mts/.cts in import paths.
          ts: 'never',
          tsx: 'never',
          mts: 'never',
          cts: 'never',
          js: 'always',
          mjs: 'always',
          cjs: 'always',
        },
      ],
    },
  },
]);
