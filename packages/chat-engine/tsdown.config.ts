import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    // ESM 面向 npm/bundler 使用：内部 shared 打进产物，peer/运行时依赖保持外置。
    deps: {
      alwaysBundle: ['@tdesign/ai-shared'],
      neverBundle: ['immer', '@json-render/core'],
    },
  },
  {
    entry: ['index.ts'],
    format: ['iife'],
    globalName: 'TDesignAIChatEngine',
    dts: false,
    sourcemap: true,
    clean: false,
    outDir: 'dist',
    platform: 'browser',
    // IIFE 面向 CDN `<script>` 使用：挂到 window.TDesignAIChatEngine，standalone 避免浏览器解析裸模块依赖。
    deps: {
      alwaysBundle: ['@tdesign/ai-shared', '@json-render/core', 'immer', 'zod'],
      onlyBundle: false,
    },
    outputOptions: {
      entryFileNames: 'index.iife.js',
      exports: 'named',
    },
  },
]);
