// tools/build-installer.mjs
//
// 出一条能直接安装的 Windows 安装包，并把「安装包版本 ↔ 模组版本」记下来。
//
// 为什么需要包装而不是手敲：完整出包有四步，且首次打包要从 GitHub 下载 nsis / winCodeSign，
// 国内直连大概率 ETIMEDOUT —— 镜像环境变量写在这里，免得每次凭记忆敲一遍。
//
// 用法：
//   node tools/build-installer.mjs --dry-run    # 只打印将执行的步骤（不耗时）
//   node tools/build-installer.mjs              # 真出包（约 5–10 分钟）
//
// 产物：
//   folia/release/Folia-Setup-<上游版本>.exe   —— 内含 resources/mods/bodian-source
//   tools/out/installer-info.txt               —— 安装包 ↔ 模组版本的对应关系

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const FOLIA = path.join(REPO, 'folia');
const OUT_DIR = path.join(REPO, 'tools', 'out');
const DRY_RUN = process.argv.includes('--dry-run');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const modManifest = readJson(path.join(FOLIA, 'mods', 'bodian-source', 'mod.json'));
const foliaPackage = readJson(path.join(FOLIA, 'package.json'));

const steps = [
    {
        name: '同步模组依赖（qrcode 等运行期包）',
        command: process.execPath,
        args: [path.join(REPO, 'tools', 'sync-mod-deps.mjs')],
        cwd: REPO,
    },
    {
        name: '前端构建（vite → dist/）',
        command: 'npm',
        args: ['run', 'build'],
        cwd: FOLIA,
        shell: true,
        // ELECTRON=true 是关键，不是可选项：vite.config 里
        //   base: process.env.ELECTRON === 'true' ? './' : '/'
        // 少它的话产物引用 `/assets/…`，在 file:// 下会解析成 `file:///G:/assets/…`（不存在）
        // —— 打包版窗口停在启动画面，控制台还没有任何报错，很容易误判成"打包失败"。
        // 上游 build:electron 同样带上它（还会构建 windowtolayer / wallpaper-helper，
        // 那两个需要额外工具链，这里不做；Windows 主功能不依赖它们）。
        env: { ELECTRON: 'true', ELECTRON_DEV: 'false' },
    },
    {
        name: 'electron-builder 出 NSIS 安装包',
        command: 'npx',
        args: ['electron-builder', '--win', 'nsis', '--publish', 'never'],
        cwd: FOLIA,
        shell: true,
        env: {
            ELECTRON_BUILDER_BINARIES_MIRROR: 'https://npmmirror.com/mirrors/electron-builder-binaries/',
            ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
        },
    },
    {
        // 免安装版：把 win-unpacked 打成 zip（用 Windows 自带的 bsdtar，-a 按扩展名选格式）
        name: '绿色版打包（win-unpacked → zip）',
        command: 'tar',
        args: [
            '-a', '-c', '-f',
            path.join(OUT_DIR, `Folia-${foliaPackage.version}-win-unpacked.zip`),
            '-C', path.join(FOLIA, 'release', 'win-unpacked'),
            '.',
        ],
        cwd: REPO,
    },
];

console.log(`安装包版本（上游 folia/package.json）: ${foliaPackage.version}`);
console.log(`内嵌模组版本（mod.json）:             ${modManifest.version}`);
console.log('');

// 打包前自检：正在运行的 Folia/eletron 会占住 release/win-unpacked 里的 dll，
// electron-builder 替换文件时报 EPERM: operation not permitted, unlink '...d3dcompiler_47.dll'
// —— 报错信息完全不提"进程占用"，很容易误判成权限问题或磁盘问题，所以在这里先拦一道。
if (process.platform === 'win32') {
    const running = ['Folia.exe', 'electron.exe'].filter((image) => {
        const out = spawnSync('tasklist', ['/NH', '/FI', `IMAGENAME eq ${image}`], { encoding: 'utf8' }).stdout || '';
        return out.toLowerCase().includes(image.toLowerCase());
    });
    if (running.length > 0) {
        console.error(`✗ 检测到 ${running.join(' / ')} 正在运行 —— 请先关闭 Folia（含开发模式窗口）再打包。`);
        console.error('  否则 electron-builder 会因文件占用失败，报错形如：');
        console.error("  EPERM: operation not permitted, unlink '...\\release\\win-unpacked\\d3dcompiler_47.dll'");
        process.exit(1);
    }
}

if (DRY_RUN) {
    steps.forEach((step, index) => {
        console.log(`[${index + 1}/${steps.length}] ${step.name}`);
        console.log(`    cwd: ${path.relative(REPO, step.cwd) || '.'}`);
        console.log(`    cmd: ${step.command} ${step.args.join(' ')}`);
        if (step.env) {
            for (const [key, value] of Object.entries(step.env)) console.log(`    env: ${key}=${value}`);
        }
    });
    console.log('\n--dry-run：没有实际执行。');
    process.exit(0);
}

for (const step of steps) {
    console.log(`\n=== ${step.name} ===`);
    const result = spawnSync(step.command, step.args, {
        cwd: step.cwd,
        stdio: 'inherit',
        shell: Boolean(step.shell),
        env: { ...process.env, ...(step.env || {}) },
    });
    if (result.error) {
        console.error(`步骤失败：${result.error.message}`);
        process.exit(1);
    }
    if (result.status !== 0) {
        console.error(`步骤失败（退出码 ${result.status}）`);
        process.exit(1);
    }
}

// 记录版本对应关系：安装包名字里只有上游版本，看不出里面装的是哪个模组版本
const releaseDir = path.join(FOLIA, 'release');
const setupFiles = fs.existsSync(releaseDir)
    ? fs.readdirSync(releaseDir).filter((name) => /^Folia-Setup-.*\.exe$/.test(name))
    : [];
const head = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: FOLIA, encoding: 'utf8' });
const headHash = head.status === 0 ? head.stdout.trim() : '(读不到)';

fs.mkdirSync(OUT_DIR, { recursive: true });
const infoPath = path.join(OUT_DIR, 'installer-info.txt');
const lines = [
    `打包时间: ${new Date().toISOString()}`,
    `安装包版本（folia/package.json）: ${foliaPackage.version}`,
    `内嵌模组版本（mod.json）: ${modManifest.version}`,
    `folia 提交: ${headHash}`,
    `产物: ${setupFiles.length ? setupFiles.map((name) => `release/${name}`).join(', ') : '(没找到 Folia-Setup-*.exe)'}`,
    '',
    '说明：安装版没有开发源豁免，装完后改安装目录里的模组文件会让授权失效；',
    '      要改就改仓库里的 folia/mods/bodian-source，然后重新跑本脚本。',
    '',
].join('\n');

fs.writeFileSync(infoPath, lines, 'utf8');
console.log(`\n完成。版本对应关系 → ${path.relative(REPO, infoPath)}`);
console.log(lines.trim());
