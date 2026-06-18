import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // 将内部包 @tdesign/ai-shared 打进产物；immer 与 json-render 保持外置
  deps: {
    alwaysBundle: ['@tdesign/ai-shared'],
    neverBundle: ['immer', '@json-render/core'],
  },
});
