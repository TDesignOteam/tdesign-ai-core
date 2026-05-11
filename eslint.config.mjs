import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'],
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['packages/**/*.ts'],
    rules: {
      'no-undef': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
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
    files: ['packages/shared/json-patch/**/*.ts'],
    rules: {
      'no-prototype-builtins': 'off',
      'no-var': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
