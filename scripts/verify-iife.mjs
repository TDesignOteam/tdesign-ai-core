/**
 * 验证 chat-engine 的 IIFE 产物（dist/index.iife.js）是否可在浏览器 <script> 场景下使用。
 *
 * 为什么这样能覆盖“可用性”和“完整性”：
 * 1. 可用性（可独立加载）
 *    - IIFE 面向无 bundler 的 CDN / 普通 <script>，浏览器不能解析 npm 裸模块名。
 *    - 先静态扫描产物里是否残留 bare import / dynamic import（如 'immer'）。
 *    - 一旦出现，说明依赖没有打进包，脚本在真实浏览器里会直接加载失败。
 * 2. 可用性（全局挂载正确）
 *    - 用 node:vm 模拟 window / self / globalThis，把 IIFE 当普通脚本执行。
 *    - 这比 import() 更接近 <script src="...">：不会当 ESM 解析，也不会注入 Node 模块解析。
 *    - 执行后检查 window.TDesignAIChatEngine 是否存在；不存在说明 globalName / 打包形态坏了。
 * 3. 完整性（关键导出没有被 tree-shake 掉或改名）
 *    - 只做 smoke，不跑全量业务逻辑，但要求关键公共 API 仍挂在全局对象上：
 *      default / AGUIAdapter / AGUIEventType。
 *    - 这些符号若缺失，通常意味着 named export 映射、default export 或入口 re-export 出了问题。
 * 4. 隔离执行
 *    - harness 写到临时目录并用子进程跑，避免污染当前 verify 进程的全局环境，
 *      也避免 sandbox 副作用影响后续 type-check / lint。
 *
 * 边界：这是构建后 smoke，不是浏览器 e2e；不覆盖网络、DOM、真实 CDN 缓存等问题。
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const iifeEntry = new URL('../packages/chat-engine/dist/index.iife.js', import.meta.url);
const source = await readFile(iifeEntry, 'utf8');

// IIFE must not contain bare imports; it should be standalone.
const bareImportPattern = /(?:^|\n)\s*import\s+(?:[^'"]*\s+from\s+)?['"]([^./][^'"]*)['"]/g;
const bareDynamicImportPattern = /import\(\s*['"]([^./][^'"]*)['"]\s*\)/g;
const bareExports = [...source.matchAll(bareImportPattern), ...source.matchAll(bareDynamicImportPattern)].map(
  (match) => match[1],
);
if (bareExports.length > 0) {
  throw new Error(`IIFE bundle must not contain bare imports: ${bareExports.join(', ')}`);
}

// Simulate browser globals: load IIFE in a sandbox with window/globalThis.
const harnessDir = await mkdtemp(join(tmpdir(), 'ai-core-iife-'));
const harnessPath = join(harnessDir, 'load-iife.mjs');
const harness = `
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const source = await readFile(process.argv[2], 'utf8');
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;

runInContext(source, createContext(sandbox), { filename: 'index.iife.js' });

const globalApi = sandbox.TDesignAIChatEngine;
if (!globalApi || typeof globalApi !== 'object') {
  throw new Error('window.TDesignAIChatEngine is missing after loading IIFE');
}

const required = ['default', 'AGUIAdapter', 'AGUIEventType'];
const missing = required.filter((name) => !(name in globalApi));
if (missing.length > 0) {
  throw new Error(\`window.TDesignAIChatEngine missing exports: \${missing.join(', ')}\`);
}

console.log(
  \`IIFE smoke test passed: global TDesignAIChatEngine has \${Object.keys(globalApi).length} symbols.\`,
);
`;

await writeFile(harnessPath, harness, 'utf8');

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [harnessPath, iifeEntry.pathname], {
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`IIFE harness exited with code ${code}`));
  });
  child.on('error', reject);
});

await rm(harnessDir, { recursive: true, force: true });
