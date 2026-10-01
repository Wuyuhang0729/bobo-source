// mods/bodian-source/index.cjs
//
// 波点音乐 · main 入口（主进程）
//
// 这里拥有完整 Node.js 权限（规范原文：模组是「可信代码，不是沙箱」），所以
// 波点的接口签名（md5）、GET-with-body、会员通道全部在这里做——渲染进程里
// 既没有 md5，也不适合放凭据。
//
// client.mjs 的 provider 回调经 folium.rpc.call('bodian:xxx', ...) 调到这里。
//
// 阶段：S1 —— 只建立 rpc 通道并打日志，确认 client 能调到 main。
// S2 起在此实现真实请求（复用 any-listen/bodian 库已验证的协议）。

'use strict';

module.exports = function activate(api) {
    api.log.info(
        `[bodian] main 入口加载 v${api.manifest.version} (folium ${api.host.folium.major}.${api.host.folium.minor})`
    );

    // ---- S1 占位：确认 rpc 通道可用
    api.rpc.handle('bodian:search', async (query, page) => {
        api.log.info(`[bodian] main 收到 search: query="${query}" limit=${page?.limit} offset=${page?.offset}`);
        return { items: [], hasMore: false, total: 0 };
    });

    api.rpc.handle('bodian:getSong', async (id) => {
        api.log.info(`[bodian] main 收到 getSong: id=${id}`);
        return null;
    });

    api.rpc.handle('bodian:getAudioUrl', async (song, quality) => {
        api.log.info(`[bodian] main 收到 getAudioUrl: id=${song?.id} quality=${quality}`);
        return null;
    });

    api.rpc.handle('bodian:getLyrics', async (song) => {
        api.log.info(`[bodian] main 收到 getLyrics: id=${song?.id}`);
        return null;
    });

    api.log.info('[bodian] main 入口就绪，已注册 4 个 rpc handler（S1 占位实现）');
};
