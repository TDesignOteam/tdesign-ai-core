import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@tdesign/ai-shared': fileURLToPath(new URL('./packages/shared/index.ts', import.meta.url)),
      '@tdesign/ai-chat-engine': fileURLToPath(new URL('./packages/chat-engine/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/**/__tests__/*.{test,spec}.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['packages/{chat-engine,shared}/**/*.ts'],
      exclude: [
        'packages/**/__tests__/**',
        'packages/**/*.d.ts',
        'packages/*/dist/**',
        'packages/chat-engine/**/types/**',
        'packages/chat-engine/type.ts',
        'packages/chat-engine/tsdown.config.ts',
      ],
    },
  },
});
