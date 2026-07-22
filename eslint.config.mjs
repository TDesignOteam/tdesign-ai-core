import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

/** 纳入 ESLint 检查范围的 TypeScript 源文件 */
const tsLintFiles = ['packages/**/*.ts'];

export default defineConfig(
  globalIgnores(['**/dist/**', '**/coverage/**', '**/node_modules/**', 'packages/shared/json-patch/**']),
  { linterOptions: { reportUnusedDisableDirectives: 'warn' } },
  {
    files: tsLintFiles,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ┌─ 暂缓规则：如何启用 ─────────────────────────────────────────────────────
      // │ extends 使用 recommendedTypeChecked，下列规则默认是 error。
      // │ 当前用「[当前] off」覆盖以通过 lint；注释行是「[启用时]」的目标配置。
      // │
      // │ 启用替换步骤（每条规则相同）：
      // │   1. 删除带 [当前] 的 off 行
      // │   2. 去掉紧挨其下方 [启用时] 行的注释符 //
      // │   3. 运行 pnpm lint，按报错修源码后重复，直至通过
      // │
      // │ 示例——启用 no-explicit-any 为 warn：
      // │   删：'@typescript-eslint/no-explicit-any': 'off',
      // │   改：// '@typescript-eslint/no-explicit-any': 'warn',
      // │   为：'@typescript-eslint/no-explicit-any': 'warn',
      // └────────────────────────────────────────────────────────────────────────

      // [当前] 允许 @ts-ignore；[启用时] 见下方注释行
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        {
          'ts-expect-error': 'allow-with-description',
          'ts-ignore': true,
          'ts-nocheck': true,
        },
      ],
      // [启用时] 删上方整块 ban-ts-comment 配置，取消下行注释：
      // '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],

      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // ── 阶段 1：any 收敛（顺序：no-explicit-any → no-unsafe-* → ban-ts-comment）──
      // [当前] off
      '@typescript-eslint/no-explicit-any': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-explicit-any': 'warn',

      // [当前] off
      '@typescript-eslint/no-empty-object-type': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-empty-object-type': 'error',

      // [当前] off
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-unsafe-assignment': 'error',

      // [当前] off
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-unsafe-member-access': 'error',

      // [当前] off
      '@typescript-eslint/no-unsafe-argument': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-unsafe-argument': 'error',

      // [当前] off
      '@typescript-eslint/no-unsafe-return': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-unsafe-return': 'error',

      // [当前] off
      '@typescript-eslint/no-unsafe-call': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-unsafe-call': 'error',

      // [当前] off
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-unsafe-enum-comparison': 'error',

      // ── 阶段 2：strict type-checked（阶段 1 基本清零后再开）────────────────────
      // [当前] off
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      // [当前] off
      '@typescript-eslint/restrict-template-expressions': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/restrict-template-expressions': 'error',

      // [当前] off
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-redundant-type-constituents': 'error',

      // [当前] off
      '@typescript-eslint/require-await': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/require-await': 'error',

      // [当前] off
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/prefer-promise-reject-errors': 'error',

      // [当前] off
      '@typescript-eslint/no-base-to-string': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-base-to-string': 'error',

      // [当前] off
      '@typescript-eslint/no-implied-eval': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-implied-eval': 'error',

      // ── 阶段 3：异步规则（裸 Promise 需补 void / await / .catch）──────────────
      // [当前] off
      '@typescript-eslint/no-floating-promises': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-floating-promises': 'error',

      // [当前] off
      '@typescript-eslint/no-misused-promises': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/no-misused-promises': 'error',

      // [当前] off
      '@typescript-eslint/await-thenable': 'off',
      // [启用时] 删上一行 off，取消下行注释：
      // '@typescript-eslint/await-thenable': 'error',
    },
  },
);
