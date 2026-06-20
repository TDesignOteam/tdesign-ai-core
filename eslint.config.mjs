import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/node_modules/**',
    'packages/shared/json-patch/**',
  ]),
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  tseslint.configs.recommended,
  {
    files: ['packages/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-empty-object-type': [
        'error',
        {
          allowWithName: 'AIContentTypeOverrides',
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // 协议适配层数据结构高度动态，待 schema 完善后逐步收紧
    files: ['packages/chat-engine/adapters/**/*.ts', 'packages/shared/immutable-patch.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
