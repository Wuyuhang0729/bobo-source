// tools/sync-bodian-vendor.mjs
//
// 把 any-listen 里 bodian 库的 CommonJS 产物同步到模组的 vendor/ 目录。
//
// 为什么需要这一步：模组的 main 入口是 index.cjs（CommonJS），而 bodian 库是
// TypeScript 源码；直接 require 不到 TS。库自带的 dist/cjs 产物就是给这种场景用的
// （package.json 的 exports.require 指向它）。
//
// 为什么不直接在 folia/package.json 里加 file: 依赖：那是上游仓库的文件，改它会被
// 上游更新冲掉。模组自带 vendored 库是规范允许的做法（参考 visualizer52hz 的
// vendor/pixi.min.mjs）。
//
// 用法：node tools/sync-bodian-vendor.mjs

import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const LIB_DIST = path.join(REPO, 'any-listen', 'dist', 'cjs');       // tsc 产物根
const VENDOR = path.join(REPO, 'folia', 'mods', 'bodian-source', 'vendor', 'bodian');

if (!fs.existsSync(path.join(LIB_DIST, 'src', 'index.js'))) {
  console.error(`找不到库的 CJS 产物: ${LIB_DIST}/src/index.js`);
  console.error('请先在 any-listen/ 里执行 npm run build:cjs');
  process.exit(1);
}

fs.rmSync(path.dirname(VENDOR), { recursive: true, force: true });
fs.mkdirSync(VENDOR, { recursive: true });

/** 递归拷贝目录，只保留运行期需要的 .js 与 package.json。 */
const copyRuntime = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyRuntime(src, dest);
    } else if (entry.name.endsWith('.js') || entry.name === 'package.json') {
      fs.copyFileSync(src, dest);
    }
  }
};

copyRuntime(LIB_DIST, path.join(VENDOR, 'dist', 'cjs'));

// 模组 require('.../vendor/bodian') 时的入口清单
fs.writeFileSync(
  path.join(VENDOR, 'package.json'),
  `${JSON.stringify({
    name: 'bodian',
    version: '0.1.0',
    description: '波点音乐音源核心库（vendored 到模组内，由 tools/sync-bodian-vendor.mjs 生成）',
    main: './dist/cjs/src/index.js',
    type: 'commonjs',
  }, null, 2)}\n`,
  'utf8'
);

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((sum, e) => sum + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);

console.log(`已同步 bodian 库 → ${path.relative(REPO, VENDOR)}`);
console.log(`文件数: ${count(VENDOR)}，入口: vendor/bodian/dist/cjs/src/index.js`);
