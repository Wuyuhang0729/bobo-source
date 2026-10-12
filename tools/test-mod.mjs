// tools/test-mod.mjs
//
// 跑模组的单测（node:test，零依赖）。
// 覆盖的是纯函数层：响应字段映射、collection id 编解码、分页换算 —— 也就是
// "上游一改字段就静默出错"的那部分。UI / rpc / 网络不在这一层测（那要靠 tools/doctor.mjs
// 与 tools/probe-bodian.mjs 跑真机）。
//
// 用法：node tools/test-mod.mjs

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const TEST_DIR = path.join(REPO, 'folia', 'mods', 'bodian-source', 'test');

// 显式列文件：Node 24 的 `node --test <目录>` 会把目录当模块加载，不递归
const testFiles = fs.readdirSync(TEST_DIR)
    .filter((name) => name.endsWith('.test.cjs'))
    .map((name) => path.join(TEST_DIR, name));

if (testFiles.length === 0) {
    console.error(`没有找到测试文件: ${TEST_DIR}`);
    process.exit(1);
}

console.log(`运行模组单测（${testFiles.length} 个文件）: ${path.relative(REPO, TEST_DIR)}`);
const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit', cwd: REPO });

if (result.error) {
    console.error(`无法启动 node --test: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
