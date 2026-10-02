// tools/sync-mod-deps.mjs
//
// 把模组运行期需要的第三方包从 folia/node_modules 同步进模组自己的 node_modules/。
//
// 为什么必须自带：打包版（app.isPackaged）里依赖都在 app.asar 内，模组目录执行
// require('qrcode') 会报 "Cannot find module 'qrcode'" —— 模组目录在 asar 之外，
// 看不到 folia 的 node_modules。规范允许模组自带库（参考 visualizer52hz 的
// vendor/pixi.min.mjs 做法）。
//
// 为什么目录名必须是 `node_modules/`（不是 vendor/ 下）：Node 解析 require('qrcode')
// 时从 index.cjs 所在目录逐级向上找 node_modules。
//
// 只同步到**仓库里的模组目录**。不要往 %APPDATA%\Folia\mods 再放一份：同一 id 两份模组
// 时，加载器只认扫描顺序在前的那份，另一份报 duplicate,平台的存亡于是取决于文件系统顺序
// （详见模组目录里的 NOTES.md）。
//
// 用法：node tools/sync-mod-deps.mjs

import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const MOD_SRC = path.join(REPO, 'folia', 'mods', 'bodian-source');
const FOLIA_MODULES = path.join(REPO, 'folia', 'node_modules');

/** 模组运行期真正需要的包（qrcode 的 cli 依赖 yargs 全家桶不需要）。 */
const PACKAGES = ['qrcode', 'dijkstrajs', 'pngjs'];

/** 纯包袱：qrcode 的 cli 依赖、pngjs 自带的覆盖率报告。 */
const EXCLUDED_DIR_NAMES = new Set(['coverage']);

const copyPackage = (name) => {
  const from = path.join(FOLIA_MODULES, name);
  if (!fs.existsSync(from)) {
    console.log(`  跳过 ${name}（folia/node_modules 里没有）`);
    return false;
  }
  const to = path.join(MOD_SRC, 'node_modules', name);
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const base = path.basename(src);
      // qrcode 下的嵌套 node_modules 是 yargs 全家桶，运行期用不到
      if (base === 'node_modules') return false;
      return !EXCLUDED_DIR_NAMES.has(base);
    },
  });
  return true;
};

console.log(`同步模组依赖 → ${path.relative(REPO, path.join(MOD_SRC, 'node_modules'))}`);
let copied = 0;
for (const name of PACKAGES) {
  if (copyPackage(name)) {
    console.log(`  ✓ ${name}`);
    copied += 1;
  }
}

if (copied === 0) {
  console.error('一个包都没同步到，检查 folia/node_modules 是否存在（先在 folia/ 里 npm install）。');
  process.exit(1);
}

// 冒烟测试：模组入口能 require 到底层依赖
const probe = path.join(MOD_SRC, 'node_modules', 'qrcode');
if (fs.existsSync(probe)) {
  console.log(`  qrcode 就位: ${path.relative(REPO, probe)}`);
}
console.log('完成。打包/分发前再跑一次 node tools/pack-mod.mjs。');
