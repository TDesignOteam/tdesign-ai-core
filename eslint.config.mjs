import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** 纳入 ESLint 检查范围的源文件（与 package.json lint-staged 保持一致） */
const lintFiles = ['packages/**/*.ts', 'eslint.config.mjs', '.prettierrc.mjs'];

export default defineConfig(
  globalIgnores(['**/dist/**', '**/coverage/**', '**/node_modules/**', 'packages/shared/json-patch/**']),
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  {
    files: lintFiles,
    extends: [tseslint.configs.recommended, eslintConfigPrettier],
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
);
