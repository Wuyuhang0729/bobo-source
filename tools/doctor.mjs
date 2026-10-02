// tools/doctor.mjs
//
// Folia + 波点音源的四级健康检查。出问题时先跑它，比逐个猜快。
//
//   1. vite dev server（3000）         —— 页面有没有可加载的源
//   2. CDP 页面（9444, localhost:3000）—— Folia 是不是以开发运行时启动的
//   3. provider 是否注册上             —— 缺 folium.<modid>.<providerId> 就是模组没加载
//   4. 模组自身状态                    —— enabled / trustStale / duplicate，对应 NOTES 的排查章节
//
// 用法：node tools/doctor.mjs

import { CDP_HTTP, evaluateOnce, listTargets } from './cdp-client.mjs';

const VITE_URL = process.env.FOLIA_DEV_URL || 'http://localhost:3000/';
const MOD_ID = 'bodian-source';

const results = [];
const record = (level, title, detail, advice) => {
    results.push({ level, title, detail, advice });
    const mark = level === 'ok' ? '✓' : level === 'warn' ? '!' : '✗';
    console.log(`${mark} ${title}${detail ? ` — ${detail}` : ''}`);
    if (advice) console.log(`    → ${advice}`);
};

// 1) vite
let viteOk = false;
try {
    const response = await fetch(VITE_URL, { signal: AbortSignal.timeout(5000) });
    viteOk = response.ok;
    record(viteOk ? 'ok' : 'fail', 'vite dev server', `${VITE_URL} → HTTP ${response.status}`);
} catch (error) {
    record('fail', 'vite dev server', `${VITE_URL} 连不上（${error.message}）`,
        '双击 tools/start-folia.bat，它会先把 vite 拉起来');
}

// 2) CDP 页面
const pageReady = await (async () => {
    if (!viteOk) return false;
    try {
        const targets = await listTargets();
        const pages = targets.filter((target) => target.type === 'page' && /localhost:3000/.test(target.url || ''));
        if (pages.length === 0) {
            record('fail', 'CDP 页面', `没有 localhost:3000 的页面（${CDP_HTTP}）`,
                'Folia 要以 --remote-debugging-port=9444 启动：用 tools/start-folia.bat');
            return false;
        }
        record('ok', 'CDP 页面', pages[0].url);
        return true;
    } catch (error) {
        record('fail', 'CDP 页面', `${CDP_HTTP} 不可用（${error.message}）`,
            'Folia 没在跑，或没带 --remote-debugging-port=9444（tools/start-folia.bat 会带上）');
        return false;
    }
})();

// 3) provider 注册情况
const providerReady = await (async () => {
    if (!pageReady) return false;
    try {
        const providers = await evaluateOnce(
            "(async () => { const m = await import('/src/services/onlineMusic/omni.ts'); return m.omni.getProviderSummaries().map(p => p.providerId); })()"
        );
        const folium = (providers || []).filter((id) => id.startsWith('folium.'));
        if (folium.length === 0) {
            record('fail', 'provider 注册', `只有内置音源: ${(providers || []).join(', ')}`,
                '模组没被加载：看下一项的模组状态，或 NOTES.md「模组重复 / 内容变了 → 平台消失」');
            return false;
        }
        record('ok', 'provider 注册', folium.join(', '));
        return true;
    } catch (error) {
        record('fail', 'provider 注册', String(error.message));
        return false;
    }
})();

// 4) 模组状态
if (pageReady) {
    try {
        const mods = await evaluateOnce(`(async () => {
            if (!window.electron?.mods?.listMods) return null;
            const res = await window.electron.mods.listMods();
            return (res.mods || []).filter(m => String(m.id).includes(${JSON.stringify(MOD_ID)})).map(m => ({
                id: m.id,
                version: m.version ?? null,
                enabled: Boolean(m.enabled),
                trustStale: Boolean(m.trustStale),
                errors: m.validationErrors || null,
            }));
        })()`);
        if (!mods || mods.length === 0) {
            record('fail', `模组 ${MOD_ID}`, '模组列表里没有它',
                '三个扫描目录里找 mod.json：仓库 folia/mods、%APPDATA%\\Folia\\mods、resources\\mods');
        } else {
            const primary = mods.find((mod) => mod.id === MOD_ID);
            const duplicates = mods.filter((mod) => mod.id !== MOD_ID);
            if (primary && primary.enabled) {
                record('ok', `模组 ${MOD_ID}`, `v${primary.version ?? '?'} 已启用`);
            } else {
                record('fail', `模组 ${MOD_ID}`, primary ? (primary.trustStale ? '未启用（trustStale：文件变化后授权失效）' : '未启用') : '只有重复项',
                    '设置 → 系统 → 模组 里重新启用并确认');
            }
            if (duplicates.length) {
                record('fail', '重复模组', duplicates.map((mod) => `${mod.id}${mod.errors ? `（${mod.errors}）` : ''}`).join(', '),
                    '同一 id 只能有一份：删掉多的那份（改名不算，要移出 mods 目录或改 id）');
            }
        }
        if (providerReady) {
            record('ok', '结论', '四层都通，可以正常用波点音源');
        }
    } catch (error) {
        record('warn', `模组 ${MOD_ID}`, `读不到模组状态（${error.message}）`);
    }
}

const failed = results.filter((item) => item.level === 'fail').length;
console.log(`\n检查完成：${results.length - failed}/${results.length} 项通过`);
process.exit(failed > 0 ? 1 : 0);
