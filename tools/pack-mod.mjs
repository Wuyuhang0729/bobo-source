// tools/pack-mod.mjs
//
// 把波点音源模组打成一个 zip，供 Folia 的模组面板「拖入安装」（mods/README.md 的
// zip 安装路径），或解压到 %APPDATA%\Folia\mods\ 给安装版用。
//
// 为什么要单独打包：模组目录里混着开发残留（.bak、日志、编辑器临时文件），
// 而 zip 安装会把整个包原样落到用户目录 —— 手动右键压缩很容易把这些也带上，
// 更糟的是把同一份模组打成两份装进去（见 NOTES.md「模组重复 → 平台消失」）。
//
// 自带依赖：qrcode 及其运行期依赖必须一起进包，否则安装版 require('qrcode') 直接报
// Cannot find module（打包版里模组目录在 asar 之外，看不到 folia 的 node_modules）。
//
// 用法：node tools/pack-mod.mjs
// 产物：tools/out/bodian-source-<version>.zip

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const REPO = path.resolve(import.meta.dirname, '..');
const MOD_SRC = path.join(REPO, 'folia', 'mods', 'bodian-source');
const OUT_DIR = path.join(REPO, 'tools', 'out');

// 只带运行期需要的东西，其余（.bak / .log / 临时文件）一律不进包
const INCLUDE_FILES = ['mod.json', 'index.cjs', 'client.mjs', 'NOTES.md'];
const INCLUDE_DIRS = ['lib', 'vendor', 'node_modules'];
const EXCLUDED_SUFFIXES = ['.bak', '.log', '.tmp', '.orig'];
// 这些子目录是纯包袱：qrcode 的 cli 依赖（yargs 全家桶）、pngjs 自带的覆盖率报告。
// qrcode 的运行期入口只 require('./server') → pngjs，不碰 yargs（bin 才用）。
const EXCLUDED_DIR_PREFIXES = ['node_modules/qrcode/node_modules/', 'node_modules/pngjs/coverage/'];

// ── 分发前的敏感信息扫描 ────────────────────────────────────────────────
// 模组会被打成 zip / 装进安装包发出去（甚至可能提给上游），而开发期的日志、临时脚本
// 很容易把账号 token / uid 抄进注释或文档。这里在打包这一步挡住。
// DEV_ID 是**故意写死**的设备标识（token 与它绑定，见 index.cjs 注释），不是凭据。
const SENSITIVE_WHITELIST = ['aabbccddeeff00112233445566778899'];
const SENSITIVE_RULES = [
    { id: 'token-like-hex', description: '疑似 token（32 位十六进制）', pattern: /\b[0-9a-f]{32}\b/gi },
    { id: 'uid-literal', description: '账号 uid 字面量', pattern: /\buid=\d{6,}/gi },
    { id: 'token-assignment', description: 'token 赋值字面量', pattern: /["']?token["']?\s*[:=]\s*["'][^"']{12,}["']/gi },
];

const scanSensitive = (entries) => {
    const findings = [];
    for (const entry of entries) {
        if (!/\.(cjs|mjs|js|json|md|txt)$/i.test(entry.relative)) continue;
        // 第三方代码（node_modules / vendor）不扫：不是我们写的，也不含我们的凭据，
        // 而且 pngjs 之类的位图数据会被 32 位十六进制规则误判。
        if (entry.relative.startsWith('node_modules/') || entry.relative.startsWith('vendor/')) continue;
        let text;
        try {
            text = fs.readFileSync(entry.full, 'utf8');
        } catch {
            continue;
        }
        for (const rule of SENSITIVE_RULES) {
            const matches = text.match(rule.pattern) || [];
            for (const match of matches) {
                if (SENSITIVE_WHITELIST.some((allowed) => match.includes(allowed))) continue;
                findings.push({ file: entry.relative, rule: rule.id, description: rule.description, sample: match.slice(0, 24) });
            }
        }
    }
    return findings;
};

const readManifest = () => {
  const manifestPath = path.join(MOD_SRC, 'mod.json');
  if (!fs.existsSync(manifestPath)) {
    console.error(`找不到模组清单: ${manifestPath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
};

const collectFiles = (dirPath, prefix = '') => {
  const files = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const name = entry.name;
    const relative = prefix ? `${prefix}/${name}` : name;
    if (EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix))) continue;
    if (entry.isDirectory() && EXCLUDED_DIR_PREFIXES.some((p) => `${relative}/`.startsWith(p))) continue;
    const full = path.join(dirPath, name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, relative));
    } else if (entry.isFile()) {
      files.push({ full, relative });
    }
  }
  return files;
};

const manifest = readManifest();
const entries = [];

for (const name of INCLUDE_FILES) {
  const full = path.join(MOD_SRC, name);
  if (fs.existsSync(full)) {
    entries.push({ full, relative: name });
  } else if (name !== 'NOTES.md') {
    console.error(`模组缺文件: ${name}`);
    process.exit(1);
  }
}

for (const dir of INCLUDE_DIRS) {
  const full = path.join(MOD_SRC, dir);
  if (!fs.existsSync(full)) {
    console.error(`模组缺目录: ${dir}（node_modules 由 tools/sync-mod-deps 之类的手工同步，vendor 由 tools/sync-bodian-vendor.mjs 生成）`);
    process.exit(1);
  }
  entries.push(...collectFiles(full, dir));
}

// 依赖自检：qrcode 少一个运行期包，安装版就起不来
const REQUIRED_MODULES = ['qrcode', 'dijkstrajs', 'pngjs'];
const packed = new Set(entries.map((entry) => entry.relative));
const missing = REQUIRED_MODULES.filter((name) => !packed.has(`node_modules/${name}/package.json`));
if (missing.length) {
  console.error(`node_modules 里缺运行期依赖: ${missing.join(', ')}`);
  console.error('先把依赖同步进模组目录（从 folia/node_modules 复制）再打包。');
  process.exit(1);
}

// 敏感信息扫描：挡在打包这一步，避免把账号凭据随 zip / 安装包发出去
const allowSensitive = process.argv.includes('--allow-sensitive');
const findings = scanSensitive(entries);
if (findings.length && !allowSensitive) {
  console.error(`发现 ${findings.length} 处疑似敏感信息，已中止打包：`);
  for (const finding of findings) {
    console.error(`  [${finding.rule}] ${finding.file}: ${finding.description} → ${finding.sample}…`);
  }
  console.error('确认无误后可用 `--allow-sensitive` 跳过（例如固定设备号这类有意写死的值）。');
  process.exit(1);
}

// 用 folia 自带的 adm-zip（electron-builder 的依赖），不额外装包
const requireFromFolia = createRequire(path.join(REPO, 'folia', 'package.json'));
const AdmZip = requireFromFolia('adm-zip');

fs.mkdirSync(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, `bodian-source-${manifest.version}.zip`);
fs.rmSync(outPath, { force: true });

const zip = new AdmZip();
for (const entry of entries) {
  zip.addFile(entry.relative, fs.readFileSync(entry.full));
}
zip.writeZip(outPath);

const bytes = fs.statSync(outPath).size;
console.log(`已打包 ${entries.length} 个文件 → ${path.relative(REPO, outPath)}`);
console.log(`版本 ${manifest.version}，体积 ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log('安装方式（二选一）：');
console.log('  1. Folia 设置 → 系统 → 模组：把 zip 拖进模组面板；');
console.log('  2. 解压到 %APPDATA%\\Folia\\mods\\bodian-source\\ 后重启 Folia。');
console.log('装完在模组列表里点启用并确认（原生弹窗默认按钮是「取消」）。');
