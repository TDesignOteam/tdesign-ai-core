import { defineConfig } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

const banner = `/**
 * ${pkg.name} v${pkg.version}
 * (c) ${new Date().getFullYear()} ${pkg.author}
 * @license ${pkg.license}
 */
`;

export default defineConfig([
  {
    entry: ['index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    // ESM 面向 npm/bundler 使用：内部 shared 打进产物，peer/运行时依赖保持外置。
    deps: {
      alwaysBundle: ['@tdesign/ai-shared'],
      neverBundle: ['immer', '@json-render/core'],
    },
    outputOptions: {
      banner,
    },
  },
  {
    entry: ['index.ts'],
    format: ['iife'],
    globalName: 'TDesignAIChatEngine',
    dts: false,
    sourcemap: true,
    platform: 'browser',
    // IIFE 面向 CDN `<script>` 使用：挂到 window.TDesignAIChatEngine，standalone 避免浏览器解析裸模块依赖。
    deps: {
      alwaysBundle: ['@tdesign/ai-shared', '@json-render/core', 'immer', 'zod'],
    },
    outputOptions: {
      banner,
      entryFileNames: 'index.iife.js',
      exports: 'named',
    },
  },
]);
