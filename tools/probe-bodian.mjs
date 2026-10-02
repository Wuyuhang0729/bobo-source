// tools/probe-bodian.mjs
//
// 端到端功能探针：从正在运行的 Folia 页面里调 Omni 的公共 API，逐个跑通
// 搜索 / 私人 FM / 每日推荐 / 推荐歌单 / 我的歌单 / 专辑 / 曲目，并把每步的条数与耗时打出来。
//
// 设计上有意**不碰 token**：请求全部经渲染进程的 omni 层（等同于用户在界面上点一下），
// 所以脚本里没有任何凭据，也不会在日志里泄漏。
//
// 用法：node tools/probe-bodian.mjs

import { evaluateOnce } from './cdp-client.mjs';

// 页面内表达式：只用单引号，避免与外层模板字符串打架
const EXPRESSION = `(async () => {
  const steps = [];
  const step = async (name, fn) => {
    const started = Date.now();
    try {
      const value = await fn();
      steps.push({ name: name, ok: true, ms: Date.now() - started, value: value });
    } catch (error) {
      steps.push({ name: name, ok: false, ms: Date.now() - started, error: String((error && error.message) || error) });
    }
  };

  const omni = (await import('/src/services/onlineMusic/omni.ts')).omni;
  const registry = await import('/src/services/onlineMusic/providerRegistry.ts');
  const providerId = omni.getProviderSummaries().map(p => p.providerId).find(id => id.indexOf('folium.') === 0);
  const provider = providerId ? registry.getOnlineMusicProvider(providerId) : null;
  const summary = omni.getActiveProviderSummary ? omni.getActiveProviderSummary() : null;
  const user = summary && summary.user ? summary.user : null;

  await step('provider 已注册', async () => {
    if (!providerId) throw new Error('provider 列表里没有 folium.*（模组没加载？先跑 tools/doctor.mjs）');
    return { providerId: providerId };
  });

  await step('搜索「晴天」', async () => {
    if (!provider || !provider.search) throw new Error('provider 没有 search 能力');
    const page = await provider.search.searchSongs('晴天', 5, 0);
    return { count: page.items.length, first: page.items.slice(0, 3).map(s => s.name) };
  });

  await step('私人 FM', async () => {
    const songs = await omni.getPersonalFm();
    if (songs.length === 0) throw new Error('返回 0 首（看 folia.log 里 [bodian] 私人 FM 那行）');
    return { count: songs.length, first: songs.slice(0, 3).map(s => s.name) };
  });

  await step('每日推荐', async () => {
    const songs = await omni.getDailySongs();
    if (songs.length === 0) throw new Error('返回 0 首（看 folia.log 里「每日推荐」那行）');
    return { count: songs.length, first: songs.slice(0, 3).map(s => s.name) };
  });

  await step('推荐歌单', async () => {
    const feed = await omni.getHomeFeed(10);
    const collections = feed.recommendedCollections || [];
    if (collections.length === 0) throw new Error('返回 0 个');
    return { count: collections.length, first: collections.slice(0, 3).map(c => c.name) };
  });

  await step('我的歌单', async () => {
    if (!user) throw new Error('未登录：先扫码');
    const playlists = await omni.refreshProviderPlaylists(providerId);
    if (playlists.length === 0) throw new Error('返回 0 个（看 folia.log 里 userCreate 那行）');
    return { count: playlists.length, first: playlists.slice(0, 3).map(c => c.name) };
  });

  await step('歌单曲目（取第一个歌单的前 5 首）', async () => {
    if (!user) throw new Error('未登录：先扫码');
    const playlists = await omni.refreshProviderPlaylists(providerId);
    if (playlists.length === 0) throw new Error('没有歌单可点');
    const page = await omni.getCollectionTracks(playlists[0], { limit: 5, offset: 0 });
    return { playlist: playlists[0].name, count: page.items.length, first: page.items.slice(0, 3).map(s => s.name) };
  });

  await step('我的专辑', async () => {
    if (!user) throw new Error('未登录：先扫码');
    const page = await omni.getUserAlbums(user.id, { limit: 20, offset: 0 });
    return { count: page.items.length, first: page.items.slice(0, 3).map(a => a.name) };
  });

  await step('专辑曲目（取第一张专辑的前 5 首）', async () => {
    if (!user) throw new Error('未登录：先扫码');
    const albums = await omni.getUserAlbums(user.id, { limit: 20, offset: 0 });
    if (albums.items.length === 0) throw new Error('没有专辑可点');
    const page = await omni.getCollectionTracks(albums.items[0], { limit: 5, offset: 0 });
    return { album: albums.items[0].name, count: page.items.length, first: page.items.slice(0, 3).map(s => s.name) };
  });

  return JSON.stringify({ providerId: providerId, user: user ? user.nickname : null, steps: steps });
})()`;

const raw = await evaluateOnce(EXPRESSION).catch((error) => {
    console.error(`探针跑不起来: ${error.message}`);
    console.error('先确认 Folia 在运行且带 --remote-debugging-port=9444（tools/start-folia.bat）。');
    process.exit(1);
});

const report = JSON.parse(raw || '{}');
console.log(`provider: ${report.providerId || '(未注册)'}   账号: ${report.user || '(未登录)'}\n`);

let failed = 0;
for (const step of report.steps || []) {
    const mark = step.ok ? '✓' : '✗';
    const timing = `${String(step.ms).padStart(5)}ms`;
    if (step.ok) {
        const value = step.value || {};
        const count = value.count !== undefined ? `${value.count}` : '-';
        const names = (value.first || []).join(' / ');
        const label = value.playlist || value.album || '';
        console.log(`${mark} ${timing}  ${step.name} → ${count} 条${label ? `（${label}）` : ''}${names ? `: ${names}` : ''}`);
    } else {
        failed += 1;
        console.log(`${mark} ${timing}  ${step.name} → ${step.error}`);
    }
}

console.log(`\n${(report.steps || []).length - failed}/${(report.steps || []).length} 步通过`);
console.log('失败步骤的细节都在 folia.log（tools\\out\\folia.log），日志行带 kind=/code= 便于区分是网络、上游拒绝还是形状变化。');
process.exit(failed > 0 ? 1 : 0);
