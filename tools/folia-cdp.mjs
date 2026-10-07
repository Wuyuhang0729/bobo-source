// tools/folia-cdp.mjs
//
// 通过 CDP 操作正在运行的 Folia 渲染进程。
// 用法：
//   node tools/folia-cdp.mjs keys             列出 localStorage 所有键
//   node tools/folia-cdp.mjs enable-mods      打开模组系统总开关并刷新
//   node tools/folia-cdp.mjs close-devtools   关掉自动弹出的 DevTools 窗口
//   node tools/folia-cdp.mjs eval "<js>"      在页面里执行一段 JS
//   node tools/folia-cdp.mjs logs [秒数]      抓取页面控制台日志（默认 20 秒）
//
// 连接与目标选择的实现都在 tools/cdp-client.mjs（doctor / probe 共用）。
// 需要 Folia 以 --remote-debugging-port=9444 启动：tools/start-folia.bat 已经带上。

import { closeDevToolsTargets, connect } from './cdp-client.mjs';

const MODS_KEY = 'mod_system_enabled';

const main = async () => {
    const [command, ...args] = process.argv.slice(2);

    if (command === 'close-devtools') {
        if (args.includes('--wait')) {
            // 启动脚本用：dev 运行时会自动弹出 DevTools，而 vite 首次编译可能要十几秒，
            // 一次调用往往太早 —— 这里每 4 秒试一次，关掉就退出。
            for (let attempt = 0; attempt < 8; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 4000));
                const closed = await closeDevToolsTargets().catch(() => 0);
                if (closed > 0) {
                    console.log(`已关闭 ${closed} 个 DevTools 目标`);
                    return;
                }
            }
            console.log('等待超时：没找到需要关闭的 DevTools 目标');
            return;
        }
        const closed = await closeDevToolsTargets();
        console.log(closed > 0 ? `已关闭 ${closed} 个 DevTools 目标` : '没有需要关闭的 DevTools 目标');
        return;
    }

    const cdp = await connect();
    try {
        if (command === 'keys') {
            const raw = await cdp.evaluate(
                "JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))"
            );
            const entries = Object.entries(JSON.parse(raw || '{}'));
            console.log(`localStorage 键（共 ${entries.length} 个）:`);
            entries.sort(([a], [b]) => a.localeCompare(b)).forEach(([key, value]) => {
                const shown = String(value ?? '');
                console.log(`  ${key} = ${shown.length > 60 ? `${shown.slice(0, 60)}…` : shown}`);
            });
        } else if (command === 'enable-mods') {
            const before = await cdp.evaluate(`localStorage.getItem(${JSON.stringify(MODS_KEY)})`);
            console.log(`当前 ${MODS_KEY} = ${before}`);
            await cdp.evaluate(`localStorage.setItem(${JSON.stringify(MODS_KEY)}, 'true')`);
            const after = await cdp.evaluate(`localStorage.getItem(${JSON.stringify(MODS_KEY)})`);
            console.log(`设置后 ${MODS_KEY} = ${after}`);
            console.log('刷新页面让 store 重新读取…');
            await cdp.send('Page.enable');
            await cdp.send('Page.reload', { ignoreCache: false });
            console.log('✓ 已刷新');
        } else if (command === 'eval') {
            const value = await cdp.evaluate(args.join(' '));
            console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
        } else if (command === 'logs') {
            const seconds = Number(args[0]) || 20;
            console.log(`抓取页面控制台 ${seconds} 秒…`);
            await cdp.send('Runtime.enable');
            await cdp.send('Log.enable');
            const lines = [];
            cdp.on((message) => {
                if (message.method === 'Runtime.consoleAPICalled') {
                    const text = (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ');
                    lines.push(`[console.${message.params.type}] ${text}`);
                } else if (message.method === 'Log.entryAdded') {
                    lines.push(`[log.${message.params.entry.level}] ${message.params.entry.text}`);
                }
            });
            await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
            const hit = lines.filter((line) => /bodian|folium|mod/i.test(line));
            console.log(`--- 共 ${lines.length} 条，其中相关 ${hit.length} 条 ---`);
            (hit.length ? hit : lines).slice(-60).forEach((line) => console.log(line));
        } else {
            console.log('用法: node tools/folia-cdp.mjs <keys|enable-mods|close-devtools|eval|logs>');
        }
    } finally {
        cdp.close();
    }
};

main().catch((error) => {
    console.error('失败:', error.message);
    process.exit(1);
});
