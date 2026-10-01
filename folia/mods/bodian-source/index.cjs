// mods/bodian-source/index.cjs
//
// 波点音乐 · main 入口（主进程）
//
// 这里拥有完整 Node.js 权限（规范原文：模组是「可信代码，不是沙箱」），所以
// 波点的接口签名（md5）、GET-with-body、会员通道全部在这里做——渲染进程里
// 既没有 md5，也不适合放凭据。
//
// client.mjs 的 provider 回调经 folium.rpc.call('bodian.xxx', ...) 调到这里。
// 注意 rpc 名字必须匹配 /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/，**不能用冒号**。
//
// 真实实现复用 any-listen 里已验证过的 bodian 库（由 tools/sync-bodian-vendor.mjs
// 把它的 CJS 产物同步到 ./vendor/bodian）。

'use strict';

const { BodianClient } = require('./vendor/bodian');

/** Folia 的音质档位 → 波点档位。 */
const QUALITY_BY_FOLIA = {
    standard: '128k',
    high: '320k',
    lossless: 'flac',
    hires: 'flac', // 该账号无真 hires，兜到无损
};

/** 波点播放地址带时效，保守按 30 分钟记。 */
const URL_TTL_MS = 30 * 60 * 1000;

module.exports = function activate(api) {
    api.log.info(
        `[bodian] main 入口加载 v${api.manifest.version} (folium ${api.host.folium.major}.${api.host.folium.minor})`
    );

    // 账号凭据在 S6 接入后注入；当前匿名。
    const client = new BodianClient();
    api.log.info(`[bodian] BodianClient 就绪（匿名=${client.isAnonymous}，devId=${client.auth.devId.slice(0, 8)}…）`);

    /** BodianSong → FoliumProviderSong。字段缺省时整个键省略，避免回传 null。 */
    const toProviderSong = (song) => {
        const artists = Array.isArray(song.artists) && song.artists.length
            ? song.artists.map((artist) => artist && artist.name).filter(Boolean)
            : (song.artist ? String(song.artist).split('&').map((name) => name.trim()).filter(Boolean) : []);
        return {
            id: String(song.id),
            title: String(song.name ?? ''),
            artists,
            ...(song.album ? { album: String(song.album) } : {}),
            ...(song.cover || song.coverSmall ? { coverUrl: String(song.cover || song.coverSmall) } : {}),
            ...(Number.isFinite(song.duration) && song.duration > 0
                ? { durationMs: Math.round(song.duration * 1000) }
                : {}),
        };
    };

    // ---------------------------------------------------------------- 搜索
    api.rpc.handle('bodian.search', async (query, page) => {
        const limit = Number(page && page.limit) > 0 ? Number(page.limit) : 20;
        const offset = Number(page && page.offset) > 0 ? Number(page.offset) : 0;
        // 库的 page 从 1 开始计数，而 Folia 给的是 offset
        const pageNumber = Math.floor(offset / limit) + 1;

        api.log.info(`[bodian] search "${query}" limit=${limit} offset=${offset} → page=${pageNumber}`);
        const list = await client.search(String(query), { page: pageNumber, pageSize: limit });
        const items = list.map(toProviderSong);
        api.log.info(`[bodian] search 返回 ${items.length} 条，首条: ${items[0] ? items[0].title : '(空)'}`);
        return { items, hasMore: items.length >= limit };
    });

    // ------------------------------------------------------------ 单曲详情
    api.rpc.handle('bodian.getSong', async (id) => {
        const song = await client.getSongDetail(String(id));
        api.log.info(`[bodian] getSong ${id} → ${song ? song.name : '(未找到)'}`);
        return song ? toProviderSong(song) : null;
    });

    // ------------------------------------------------------------ 播放地址
    api.rpc.handle('bodian.getAudioUrl', async (song, quality) => {
        const target = QUALITY_BY_FOLIA[quality] || 'flac';
        const id = String(song && song.id);

        try {
            const result = await client.getMusicUrl(id, { quality: target });
            api.log.info(
                `[bodian] getAudioUrl ${id} 请求=${target} 实得=${result.quality}/${result.format} ` +
                `时长=${result.duration}s 通道=${result.via}`
            );
            return { url: result.url, expiresAt: Date.now() + URL_TTL_MS };
        } catch (error) {
            // 拿不到就返回 null，让宿主显示「无法播放」，不要把异常抛穿到界面
            api.log.warn(`[bodian] getAudioUrl 失败 id=${id} 请求=${target}: ${error && error.message}`);
            return null;
        }
    });

    // ---------------------------------------------------------------- 歌词
    api.rpc.handle('bodian.getLyrics', async (song) => {
        const id = String(song && song.id);

        try {
            const result = await client.getLyrics(id);
            const hasVerbatim = typeof result.verbatim === 'string' && result.verbatim.trim() !== '';
            api.log.info(`[bodian] getLyrics ${id} 逐字=${hasVerbatim} 行数≈${result.lrc.split('\n').length}`);
            // 先给普通 LRC；逐字（awlrc）留到 S5 单独验证宿主解析
            return { lrc: result.lrc };
        } catch (error) {
            api.log.warn(`[bodian] getLyrics 失败 id=${id}: ${error && error.message}`);
            return null;
        }
    });

    api.log.info('[bodian] main 入口就绪（真实实现，4 个 rpc handler）');
};
