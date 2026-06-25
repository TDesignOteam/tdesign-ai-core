import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['index.ts'],
  format: ['esm', 'cjs'],
  // CJS 使用 named 导出模式，消除 default + named 混用警告；ESM 仍输出 `ChatEngine as default`
  outputOptions: { exports: 'named' },
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // 将内部包 @tdesign/ai-shared 打进产物；immer、json-render 保持外置
  deps: {
    alwaysBundle: ['@tdesign/ai-shared'],
    neverBundle: ['immer', '@json-render/core'],
  },
});
