// mods/bodian-source/index.cjs
//
// 波点音乐 · main 入口（主进程）
//
// 这里拥有完整 Node.js 权限（规范原文：模组是「可信代码，不是沙箱」），所以
// 波点的接口签名（md5）、GET-with-body、会员通道、扫码登录全部在这里做——
// 渲染进程既没有 md5，也不适合放凭据。
//
// client.mjs 的 provider 回调经 folium.rpc.call('bodian.xxx', ...) 调到这里。
// 注意 rpc 名字必须匹配 /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/，**不能用冒号**。
//
// 复用 any-listen 里已验证的 bodian 库（tools/sync-bodian-vendor.mjs 把它的
// CJS 产物同步到 ./vendor/bodian）；登录部分用库导出的签名与 HTTP 原语自己搭。

'use strict';

const QRCode = require('qrcode');
// 音频代理需要流式转发与自建服务，所以用 node 原生 http/https
// （库导出的 httpRequest 是一次性拉完，不适合喂给 <audio>）
const http = require('node:http');
const https = require('node:https');
const { URL: NodeURL } = require('node:url');
const {
    BodianApiError,
    BodianClient,
    BODIAN_API_ORIGIN,
    DEFAULT_CLIENT_HEADERS,
    bodianSign,
    httpRequest,
} = require('./vendor/bodian');
// 纯映射 / 编解码 / 错误分类都在 lib/ 下，由 tools/test-mod.mjs 跑单测盯着
const { encodeCollectionId, decodeCollectionId } = require('./lib/ids.cjs');
const {
    toProviderSongFromTrackList,
    toProviderSongFromSearch,
    pickSongList,
    toPageNumber,
    isCollectedAlbum,
    toCollectionFromCreated,
    toCollectionFromCollected,
    toAlbumFromCollected,
    toRecommendedCollection,
    toCollectionFromSearch,
} = require('./lib/mapping.cjs');
const { describeFailure, formatFailure } = require('./lib/errors.cjs');

const nodeHttpRequest = http.request;
const nodeHttpsRequest = https.request;

/** Folia 的音质档位 → 波点档位。 */
const QUALITY_BY_FOLIA = {
    standard: '128k',
    high: '320k',
    lossless: 'flac',
    hires: 'flac', // 该账号无真 hires，兜到无损
};

/** 波点播放地址带时效，保守按 30 分钟记。 */
const URL_TTL_MS = 30 * 60 * 1000;

/**
 * 歌单 / 专辑列表的缓存时长。
 *
 * 只用来省掉「翻页时把前两页重打一遍」：宿主每次刷新都从 offset=0 开始，那条路径按强制
 * 刷新处理，所以这个 TTL 不会挡住「手机上改完歌单，Folia 里刷新一下」。
 */
const COLLECTIONS_CACHE_TTL_MS = 60 * 1000;

/**
 * 二维码内容**必须是一个 URL**：真机验证过，直接放裸 qrCode 手机端会报「无法识别」。
 */
const QR_CONTENT_PREFIX = 'https://bodian-oia.kuwo.cn/bodian/download.html?pageName=login_pc&pt=3';

/** 波点不报二维码寿命，按 3 分钟估（到点由 UI 给「刷新二维码」）。 */
const QR_TTL_MS = 3 * 60 * 1000;

/** 登录凭据在模组 storage 里的键。 */
const AUTH_STORAGE_KEY = 'bodian.auth';

/**
 * 固定的设备 id。
 *
 * 波点把 token 和「签发它时的 devid」绑定：换一个 devid 再带同一个 token 请求会被判为
 * 无效。实测 /api/service/playlist/userCreate 返回 code=-101，而收藏接口不校验这种绑定，
 * 于是症状是"只有部分接口出错"，极易被误判成数据或过滤逻辑的问题。
 *
 * 用固定值而非每次随机，是为了让同一个 token 在重启、重建 client 之后都还能用。
 */
const DEV_ID = 'aabbccddeeff00112233445566778899';

module.exports = function activate(api) {
    api.log.info(
        `[bodian] main 入口加载 v${api.manifest.version} (folium ${api.host.folium.major}.${api.host.folium.minor})`
    );

    // ---- 账号态：扫码登录写入，启动时从 storage 恢复
    const auth = { uid: '-1', token: '' };
    let currentUser = null;
    // devId 全程固定（见 DEV_ID 注释）：一旦在这里随机，带 token 的请求就会失效
    let client = new BodianClient({ devId: DEV_ID });

    /** 用登录态重建 client。devId 必须沿用同一个，原因见 DEV_ID 注释。 */
    const rebuildClient = () => {
        client = new BodianClient({ uid: auth.uid, token: auth.token, devId: DEV_ID });
    };

    /**
     * 请求头 = 库的客户端头 + devid/qimei36。
     *
     * devid 不在 DEFAULT_CLIENT_HEADERS 里，但少了它波点一律回 402 request invalid。
     */
    const clientHeaders = () => ({
        ...DEFAULT_CLIENT_HEADERS,
        devid: DEV_ID,
        qimei36: DEV_ID,
    });

    /**
     * 信封校验：与库的 requestJson 同一套判定。
     *
     * HTTP 非 200 / 响应不是 JSON / `code !== 200` 一律抛 BodianApiError。
     * 之前这里直接 `JSON.parse(response.text)` 返回，`code=-101`（签名、devid 绑定或 token
     * 失效）这类失败会带着 `data === undefined` 一路往下走，最后变成"空列表" ——
     * 用户和日志都看不出是被上游拒了。
     */
    const parseEnvelope = (path, response) => {
        if (response && response.status !== undefined && Number(response.status) !== 200) {
            throw new BodianApiError(`HTTP ${response.status} @ ${path}`, {
                code: Number(response.status),
                path,
                raw: String(response.text || '').slice(0, 300),
            });
        }
        let parsed;
        try {
            parsed = JSON.parse(response.text);
        } catch {
            throw new BodianApiError(`响应不是合法 JSON @ ${path}`, {
                code: -1,
                path,
                raw: String(response.text || '').slice(0, 300),
            });
        }
        if (parsed && typeof parsed === 'object' && parsed.code !== undefined && Number(parsed.code) !== 200) {
            throw new BodianApiError(`接口错误 code=${parsed.code} msg=${parsed.msg ?? ''} @ ${path}`, {
                code: Number(parsed.code),
                path,
                raw: parsed,
            });
        }
        return parsed;
    };

    /** 统一失败日志：一行里带 kind/code/msg，grep `kind=` 就能筛查。 */
    const logFailure = (scope, error) => {
        const failure = describeFailure(error);
        api.log.warn(`[bodian] ${scope} 失败 ${formatFailure(failure)}`);
        return failure;
    };

    /**
     * 列表类回调的失败出口：记日志，然后把空结果还给宿主。
     *
     * 为什么仍然返回空而不是抛：音源"这一次没取到"是常态（网络抖动、上游限流），
     * 抛出去会让宿主整屏报错，比空列表更糟。真正要点开的东西（曲目、播放地址、歌词）
     * 不在这里 —— 它们照旧抛错或返回 null，让界面能明确说"这条不行"。
     */
    const failEmpty = (scope, error, emptyValue) => {
        logFailure(scope, error);
        return emptyValue;
    };

    /**
     * 带签名的 bd-api GET。
     *
     * `lenient` 用于登录链路：那几条接口的"未扫码/未确认"状态本身就可能伴随非 200 的
     * 信封值，收紧校验反而会破坏已验证的扫码流程，所以只在非登录路径严格校验。
     */
    const signedGet = async (path, params = {}, { lenient = false } = {}) => {
        const merged = { ...params, uid: auth.uid, token: auth.token, timestamp: Date.now() };
        const entries = Object.entries(merged).map(([key, value]) => [key, String(value)]);
        const sign = bodianSign(path, entries);
        const query = new URLSearchParams([...entries, ['sign', sign]]).toString();
        const response = await httpRequest(`${BODIAN_API_ORIGIN}${path}?${query}`, {
            headers: clientHeaders(),
        });
        return lenient ? JSON.parse(response.text) : parseEnvelope(path, response);
    };

    /** 带签名的 bd-api POST（登录换票用）。 */
    const signedPost = async (path, params = {}, body = {}) => {
        const bodyText = JSON.stringify(body);
        const merged = { ...params, uid: auth.uid, token: auth.token, timestamp: Date.now() };
        const entries = Object.entries(merged).map(([key, value]) => [key, String(value)]);
        const sign = bodianSign(path, entries, bodyText);
        const query = new URLSearchParams([...entries, ['sign', sign]]).toString();
        const response = await httpRequest(`${BODIAN_API_ORIGIN}${path}?${query}`, {
            method: 'POST',
            headers: clientHeaders(),
            body: bodyText,
        });
        return parseEnvelope(path, response);
    };

    /** 启动时恢复上次的登录态。 */
    const restoreAuth = async () => {
        try {
            // 注意：storage 下还有一层 data（electron/modSystem/modApi.cjs 的 modApi.storage.data）
            const saved = await api.storage.data.get(AUTH_STORAGE_KEY);
            if (!saved || typeof saved !== 'object') return;
            const uid = typeof saved.uid === 'string' ? saved.uid : '';
            const token = typeof saved.token === 'string' ? saved.token : '';
            if (!uid || !token) return;
            auth.uid = uid;
            auth.token = token;
            // devId 固定，所以旧凭据（历史版本存的没有 devId 字段）也能继续用——
            // 只要它是用这个固定值签发的。
            rebuildClient();
            currentUser = saved.user && typeof saved.user === 'object'
                ? saved.user
                : { id: uid, nickname: '波点用户' };
            api.log.info(`[bodian] 已恢复登录态 uid=${uid} devid=${DEV_ID.slice(0, 8)}`);
        } catch (error) {
            api.log.warn(`[bodian] 恢复登录态失败: ${error && error.message}`);
        }
    };

    // ---------------------------------------------------------------- 搜索
    api.rpc.handle('bodian.search', async (query, page) => {
        const limit = Number(page && page.limit) > 0 ? Number(page.limit) : 20;
        const offset = Number(page && page.offset) > 0 ? Number(page.offset) : 0;

        try {
            // 库的 page 从 1 开始计数，而 Folia 给的是 offset
            const list = await client.search(String(query), { page: toPageNumber(offset, limit), pageSize: limit });
            const items = list.map(toProviderSongFromSearch);
            api.log.info(`[bodian] search "${query}" offset=${offset} → ${items.length} 条`);
            return { items, hasMore: items.length >= limit };
        } catch (error) {
            return failEmpty(`搜索 "${query}"`, error, { items: [], hasMore: false });
        }
    });

    // ------------------------------------------------------------ 搜索歌单
    // 真机验证：GET /api/search/playlist/list?keyword=&pn=&rn=（库内部把 1-based page 转成
    // 从 0 开始的 pn）→ data.resultList，条目带 source/sourceType —— 取曲目要用它。
    api.rpc.handle('bodian.searchCollections', async (query, page) => {
        const limit = Number(page && page.limit) > 0 ? Number(page.limit) : 20;
        const offset = Number(page && page.offset) > 0 ? Number(page.offset) : 0;

        try {
            const list = await client.searchPlaylists(String(query), {
                page: toPageNumber(offset, limit),
                pageSize: limit,
            });
            const items = list
                .map(toCollectionFromSearch)
                .filter((collection) => collection.id && collection.name)
                // id 自带 source：点开时模组自己解码，宿主不需要回传 providerData
                .map(({ source, ...rest }) => ({
                    ...rest,
                    id: encodeCollectionId(source, rest.id),
                    providerData: { source },
                }));
            api.log.info(`[bodian] searchCollections "${query}" offset=${offset} → ${items.length} 个`);
            // 库只回 list、不回 total，所以按"这一页填满了就还有下一页"判断
            return { items, hasMore: items.length >= limit };
        } catch (error) {
            return failEmpty(`搜索歌单 "${query}"`, error, { items: [], hasMore: false });
        }
    });

    // ------------------------------------------------------------ 单曲详情
    api.rpc.handle('bodian.getSong', async (id) => {
        try {
            const song = await client.getSongDetail(String(id));
            return song ? toProviderSongFromSearch(song) : null;
        } catch (error) {
            // 队列 / 历史重开后靠它还原，取不到就返回 null（宿主会按缺详情处理）
            logFailure(`单曲详情 ${id}`, error);
            return null;
        }
    });

    // ------------------------------------------------------------ 音频代理
    //
    // 为什么需要它：Folia 的 <audio> 带 crossOrigin="anonymous"（供 Web Audio 分析用），
    // 而波点的 CDN **不返回任何 CORS 头** —— 浏览器于是拒绝加载，表现为
    //   errorCode=4 MEDIA_ELEMENT_ERROR: Format error
    // 实测 car-bj / car-er / car-lv 的 http 与 https 都没有 Access-Control-Allow-Origin。
    //
    // 所以在本地起一个只监听 127.0.0.1 的代理：自己补 CORS 头、透传 Range（拖动进度条要用），
    // getAudioUrl 直接返回这个本地地址。

    let audioProxyPort = 0;

    const startAudioProxy = () => {
        const server = http.createServer((req, res) => {
            const parsed = new NodeURL(req.url || '/', 'http://127.0.0.1');
            const target = parsed.searchParams.get('u');

            if (!target) {
                res.writeHead(400, { 'access-control-allow-origin': '*' });
                res.end('missing u');
                return;
            }
            // 只转发到该域名的 CDN，免得变成开放代理
            if (!/^https?:\/\/[a-z0-9.-]*kuwo\.cn\//i.test(target)) {
                res.writeHead(403, { 'access-control-allow-origin': '*' });
                res.end('forbidden');
                return;
            }

            const upstreamHeaders = { ...DEFAULT_CLIENT_HEADERS };
            if (req.headers.range) upstreamHeaders.range = String(req.headers.range);

            const send = target.startsWith('https:') ? nodeHttpsRequest : nodeHttpRequest;
            api.log.info(`[bodian] 代理转发 ${target.slice(0, 85)}… range=${upstreamHeaders.range || '(无)'}`);
            const upstream = send(target, { method: 'GET', headers: upstreamHeaders }, (up) => {
                api.log.info(`[bodian] 代理上游响应 status=${up.statusCode} type=${up.headers['content-type'] || '-'}`);
                res.writeHead(up.statusCode || 200, {
                    'access-control-allow-origin': '*',
                    'access-control-expose-headers': 'Content-Range, Accept-Ranges, Content-Length, Content-Type',
                    'content-type': up.headers['content-type'] || 'audio/mpeg',
                    'accept-ranges': 'bytes',
                    ...(up.headers['content-length'] ? { 'content-length': up.headers['content-length'] } : {}),
                    ...(up.headers['content-range'] ? { 'content-range': up.headers['content-range'] } : {}),
                });
                up.pipe(res);
            });

            upstream.on('error', (error) => {
                api.log.warn(
                    `[bodian] 代理上游错误 code=${error && error.code} msg=${error && error.message} ` +
                    `target=${target.slice(0, 70)}`
                );
                if (!res.headersSent) res.writeHead(502, { 'access-control-allow-origin': '*' });
                res.end();
            });
            // 客户端断开时才销毁上游。注意必须是 res 而不是 req：
            // 对 GET 来说 req 流在请求头读完的瞬间就触发 'close'，监听它会刚连上就掐掉上游。
            res.on('close', () => upstream.destroy());

            // ★ 必须显式 end()：http.request() 只创建请求对象、并不发送。
            // 少了它，TCP 能连上但请求发不完整，上游会一直等到超时才 RST ——
            // 现象是客户端 readyState 永远停在 0、日志里只有 ECONNRESET。
            // （这个 bug 花了不少时间：请求行/Host/所有头都和直连逐字节相同，
            //   差别只在少了这一次 end()。）
            upstream.end();
        });

        server.on('error', (error) => api.log.warn(`[bodian] 音频代理启动失败: ${error && error.message}`));
        server.listen(0, '127.0.0.1', () => {
            audioProxyPort = server.address().port;
            api.log.info(`[bodian] 音频代理已启动 http://127.0.0.1:${audioProxyPort}/`);
        });
        return server;
    };

    /** 把外部音频地址包成本地代理地址（带 CORS，供 Folia 的 <audio crossOrigin> 使用）。 */
    const proxied = (url) => (audioProxyPort
        ? `http://127.0.0.1:${audioProxyPort}/a?u=${encodeURIComponent(url)}`
        : url);

    // ------------------------------------------------------------ 播放地址
    api.rpc.handle('bodian.getAudioUrl', async (song, quality) => {
        const target = QUALITY_BY_FOLIA[quality] || 'flac';
        const id = String(song && song.id);

        try {
            const result = await client.getMusicUrl(id, { quality: target });
            api.log.info(
                `[bodian] getAudioUrl ${id} 请求=${target} 实得=${result.quality}/${result.format} ` +
                `时长=${result.duration}s 通道=${result.via}${audioProxyPort ? ' → 本地代理' : '（未代理！）'}`
            );
            return { url: proxied(result.url), expiresAt: Date.now() + URL_TTL_MS };
        } catch (error) {
            // 拿不到就返回 null，让宿主显示「无法播放」，不要把异常抛穿到界面
            logFailure(`播放地址 ${id}（请求 ${target}）`, error);
            return null;
        }
    });

    // ---------------------------------------------------------------- 歌词
    api.rpc.handle('bodian.getLyrics', async (song) => {
        const id = String(song && song.id);

        try {
            const result = await client.getLyrics(id);
            return { lrc: result.lrc };
        } catch (error) {
            logFailure(`歌词 ${id}`, error);
            return null;
        }
    });

    // ------------------------------------------------------------ 我的歌单
    // 真机验证过的三个接口：
    //   GET /api/service/playlist/userCreate?userId=              → data.playLists（自建，source=5）
    //   GET /api/service/collect/4/list?userId=&fromUid=&pn=&rn=  → data.playLists（收藏，混专辑）
    //   GET /api/service/playlist/{id}/musicList?source=5&pn=&rn= → 曲目（pn 从 1 开始）
    //
    // 收藏那份的 sourceType 是 6/13，其中带 albumId/artist 的其实是**专辑**而不是歌单，
    // 按用户要求过滤掉。

    // 曲目型列表（歌单曲目 / 专辑曲目 / 推荐流）→ FoliumProviderSong 的映射在
    // lib/mapping.cjs（纯函数、由 test/mapping.test.cjs 盯着字段名）。

    /**
     * 自建 + 收藏合并后的列表（内部形状：带 source、**原始** id）。
     *
     * 缓存只服务翻页：宿主每次「刷新歌单」都从 offset=0 拉第一页（进首页时也会），
     * 所以把第一页当刷新信号，永远重打接口 —— 否则手机上刚改的歌单在缓存没过期前看不到。
     * 60 秒内的翻页仍然吃缓存，不重复打两次上游。
     */
    let collectionsCache = null;

    const loadCollections = async ({ force = false } = {}) => {
        const now = Date.now();
        if (!force && collectionsCache && now - collectionsCache.at < COLLECTIONS_CACHE_TTL_MS) {
            return collectionsCache.items;
        }

        const uid = auth.uid;
        const items = [];

        try {
            const created = await signedGet('/api/service/playlist/userCreate', { userId: uid });
            const list = (created && created.data && created.data.playLists) || [];
            api.log.info(
                `[bodian] userCreate uid=${uid} token=${auth.token ? auth.token.slice(0, 8) : '(空)'} 自建条数=${list.length}`
            );
            items.push(...list.map(toCollectionFromCreated));
        } catch (error) {
            logFailure('取「我创建的歌单」', error);
        }

        try {
            const collected = await signedGet('/api/service/collect/4/list', {
                userId: uid, fromUid: uid, pn: '1', rn: '200',
            });
            const list = (collected && collected.data && collected.data.playLists) || [];
            // 真机数据：带 albumId 的条目是专辑（由 loadAlbums 那条路出），歌单条目没有这个字段
            items.push(...list.filter((item) => !isCollectedAlbum(item)).map(toCollectionFromCollected));
        } catch (error) {
            logFailure('取「我收藏的歌单」', error);
        }

        collectionsCache = { at: now, items };
        api.log.info(`[bodian] 歌单列表：自建 + 收藏共 ${items.length} 个`);
        return items;
    };

    api.rpc.handle('bodian.library.getCollections', async (userId, page) => {
        const limit = Number(page && page.limit) > 0 ? Number(page.limit) : 50;
        const offset = Number(page && page.offset) > 0 ? Number(page.offset) : 0;

        // offset=0 就是宿主那侧的「刷新歌单」：进首页、点同步都会从这里重新拉一遍
        const all = await loadCollections({ force: offset === 0 });
        const slice = all.slice(offset, offset + limit);
        return {
            items: slice.map(({ source, ...rest }) => ({
                // id 自带 source（p5_xxx）：点开时模组自己就能解释它，不依赖宿主回传 providerData
                ...rest,
                id: encodeCollectionId(source, rest.id),
                // providerData 仍然带上 —— 宿主保留透传时作为交叉校验，没保留也不影响
                providerData: { source },
            })),
            hasMore: offset + slice.length < all.length,
            total: all.length,
        };
    });

    api.rpc.handle('bodian.library.getCollectionTracks', async (collectionId, page, providerData) => {
        const limit = Number(page && page.limit) > 0 ? Number(page.limit) : 100;
        const offset = Number(page && page.offset) > 0 ? Number(page.offset) : 0;
        const pn = toPageNumber(offset, limit); // 波点的 pn 从 1 开始

        /**
         * source 决定「这本目录是谁」：自建 5、收藏 4、平台歌单 13…
         *
         * 主路径是 id 自解释（`p13_7899404`）；旧数据（历史遗留的纯数字 id）走兜底：
         * 宿主回传的 providerData → 缓存里按 id 找 → 默认自建歌单。
         */
        const decoded = decodeCollectionId(collectionId);
        const upstreamId = decoded ? decoded.id : String(collectionId);
        let source = decoded ? decoded.source : '';

        if (!source && providerData && providerData.source) {
            source = String(providerData.source);
        }
        if (!source) {
            let all = await loadCollections();
            let found = all.find((collection) => collection.id === upstreamId);
            if (!found) {
                all = await loadCollections({ force: true });
                found = all.find((collection) => collection.id === upstreamId);
            }
            source = (found && found.source) || '5';
            api.log.info(`[bodian] 歌单 ${upstreamId} 用旧 id 兜底 → source=${source}`);
        }

        try {
            const response = await signedGet(`/api/service/playlist/${upstreamId}/musicList`, {
                source,
                pn: String(pn),
                rn: String(limit),
            });
            const { items, total } = pickSongList(response && response.data);
            const songs = items.map(toProviderSongFromTrackList).filter((song) => song.id && song.title);
            return {
                items: songs,
                hasMore: offset + songs.length < total,
                total,
            };
        } catch (error) {
            // 用户主动点开的列表：把错误抛给宿主，界面才会说「这条没打开」而不是显示空
            logFailure(`歌单 ${upstreamId} 曲目`, error);
            throw error;
        }
    });

    // ------------------------------------------------------------ 我的专辑
    // 复用同一个收藏接口：带 albumId 的条目就是专辑（歌单那条路径已把这类过滤掉了）。
    // 专辑 id 用 albumId，宿主点进专辑时会拿它去取曲目。

    let albumsCache = null;

    const loadAlbums = async ({ force = false } = {}) => {
        const now = Date.now();
        if (!force && albumsCache && now - albumsCache.at < COLLECTIONS_CACHE_TTL_MS) {
            return albumsCache.items;
        }

        const items = [];
        try {
            const collected = await signedGet('/api/service/collect/4/list', {
                userId: auth.uid, fromUid: auth.uid, pn: '1', rn: '200',
            });
            const list = (collected && collected.data && collected.data.playLists) || [];
            items.push(...list.filter(isCollectedAlbum).map(toAlbumFromCollected));
        } catch (error) {
            logFailure('取「我收藏的专辑」', error);
        }

        albumsCache = { at: now, items };
        api.log.info(`[bodian] 专辑列表：${items.length} 个`);
        return items;
    };

    api.rpc.handle('bodian.library.getAlbums', async (userId, page) => {
        const limit = Number(page && page.limit) > 0 ? Number(page.limit) : 50;
        const offset = Number(page && page.offset) > 0 ? Number(page.offset) : 0;

        const all = await loadAlbums({ force: offset === 0 });
        const slice = all.slice(offset, offset + limit);
        return {
            items: slice,
            hasMore: offset + slice.length < all.length,
            total: all.length,
        };
    });

    // 专辑曲目：宿主的 catalog 对 type==='album' 只问这一条路径，缺了它专辑点进去是空的。
    // 真机验证：GET /api/service/album/music/{albumId}?pn&rn → data.resultList（与歌单曲目同构）
    api.rpc.handle('bodian.library.getAlbumTracks', async (albumId, page) => {
        const limit = Number(page && page.limit) > 0 ? Number(page.limit) : 500;
        const offset = Number(page && page.offset) > 0 ? Number(page.offset) : 0;
        const pn = toPageNumber(offset, limit); // 与歌单一致：pn 从 1 开始

        try {
            const response = await signedGet(`/api/service/album/music/${albumId}`, {
                pn: String(pn),
                rn: String(limit),
            });
            const { items, total } = pickSongList(response && response.data);
            const songs = items.map(toProviderSongFromTrackList).filter((song) => song.id && song.title);
            api.log.info(`[bodian] 专辑曲目 ${albumId} pn=${pn} → ${songs.length}/${total} 条`);
            return {
                items: songs,
                hasMore: offset + songs.length < total,
                total,
            };
        } catch (error) {
            // 专辑卡片点开失败：返回空表（列表类语义），日志里有 kind/code 可查
            return failEmpty(`专辑曲目 ${albumId}`, error, { items: [], hasMore: false, total: 0 });
        }
    });

    // ---------------------------------------------------------------- 电台
    // 宿主「电台」tab 的三张卡片，各一个数据源（都是真机探到的接口，全部走签名）：
    //   私人 FM   GET /api/service/music/recommendList        → data.musicList
    //   每日推荐  GET /api/service/home/module?moduleId=10    → data.musicList（心动收藏相似推荐）
    //   推荐歌单  GET /api/service/home/module?moduleId=2     → data.songList（宝藏歌单库，sourceType=13）
    //
    // 推荐歌单的卡片 id 同样自带 source（p13_xxx），点开时不依赖宿主回传 providerData。

    api.rpc.handle('bodian.recommendations.getPersonalFm', async () => {
        try {
            const response = await signedGet('/api/service/music/recommendList', {
                // 这几个是波点客户端写死的组合值；fg=1 表示冷启动取推荐流
                fg: '1',
                lock: '0',
                // 每次换一个冷启动时间：实测同一时间戳重复请求会拿到同一批歌
                lastColdStartTime: String(Date.now()),
                scrollNum: '1',
                resourceId: '0',
                recoMode: 'normal',
                source: '0',
                sourceId: '0',
                totalNum: '20',
            });
            const list = (response && response.data && response.data.musicList) || [];
            const items = list.map(toProviderSongFromTrackList).filter((song) => song.id && song.title);
            api.log.info(`[bodian] 私人 FM → ${items.length} 首`);
            return items;
        } catch (error) {
            return failEmpty('私人 FM', error, []);
        }
    });

    /**
     * 每日推荐。
     *
     * 波点没有字面的「每日推荐」，用首页模块顶上：module 10「心动收藏相似推荐」当主源，
     * 空了（例如账号刚注册、收藏为空）再退到 module 3「偶遇心动单曲」。两者都是一组 15 首。
     * refresh 只是宿主点刷新时传的标记，这里每次都重新请求服务端，不做本地缓存。
     */
    api.rpc.handle('bodian.recommendations.getDailySongs', async (refresh) => {
        for (const moduleId of ['10', '3']) {
            try {
                const response = await signedGet('/api/service/home/module', { moduleId });
                const list = (response && response.data && response.data.musicList) || [];
                const items = list.map(toProviderSongFromTrackList).filter((song) => song.id && song.title);
                if (items.length) {
                    api.log.info(
                        `[bodian] 每日推荐 module=${moduleId} refresh=${Boolean(refresh)} → ${items.length} 首`
                    );
                    return items;
                }
            } catch (error) {
                logFailure(`每日推荐 module=${moduleId}`, error);
            }
        }
        api.log.warn('[bodian] 每日推荐：两个模块都没给歌');
        return [];
    });

    api.rpc.handle('bodian.recommendations.getRecommendedCollections', async (limit) => {
        const size = Number(limit) > 0 ? Number(limit) : 20;
        try {
            const response = await signedGet('/api/service/home/module', { moduleId: '2' });
            const list = (response && response.data && response.data.songList) || [];
            const items = list
                .filter((item) => item && item.id && item.name)
                .slice(0, size)
                .map(toRecommendedCollection)
                .map((collection) => ({
                    ...collection,
                    // 与歌单列表同样的约定：id 自带 source，点开时模组自己解释
                    id: encodeCollectionId(collection.providerData.source, collection.id),
                }));
            api.log.info(`[bodian] 推荐歌单 → ${items.length} 个`);
            return items;
        } catch (error) {
            return failEmpty('推荐歌单', error, []);
        }
    });

    // ------------------------------------------------------ 账号：扫码登录
    // 波点流程（真机验证）：
    //   GET  /api/ucenter/login/qrCode                     → data.qrCode
    //   GET  /api/ucenter/login/qrCodeStatus?qrCode=<key>  → status 1=未扫 2=待确认 3=已确认
    //   POST /api/ucenter/users/login {authType:10,qrCode} → data.id / data.token / data.userInfo

    api.rpc.handle('bodian.auth.getStatus', async () => {
        api.log.info(`[bodian] auth.getStatus → ${currentUser ? currentUser.nickname : '(未登录)'}`);
        return currentUser || null;
    });

    api.rpc.handle('bodian.auth.getQrTtlMs', async () => QR_TTL_MS);

    api.rpc.handle('bodian.auth.getQrKey', async () => {
        // lenient：登录链路的"未扫码/未确认"状态可能伴随非 200 的信封值，收紧会破坏已验流程
        const response = await signedGet('/api/ucenter/login/qrCode', {}, { lenient: true });
        const key = response && response.data && response.data.qrCode;
        if (!key) throw new Error(`波点未返回 qrCode: ${JSON.stringify(response).slice(0, 200)}`);
        api.log.info(`[bodian] 已创建扫码会话 key=${String(key).slice(0, 8)}…`);
        return String(key);
    });

    api.rpc.handle('bodian.auth.createQr', async (key) => {
        const content = `${QR_CONTENT_PREFIX}&id=${encodeURIComponent(String(key))}`;
        // data URL 直接交给宿主的 <img src>，不依赖任何外部二维码服务
        return QRCode.toDataURL(content, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
    });

    api.rpc.handle('bodian.auth.checkQr', async (key) => {
        let status = 0;
        try {
            const response = await signedGet('/api/ucenter/login/qrCodeStatus', { qrCode: String(key) }, { lenient: true });
            status = Number(response && response.data && response.data.status) || 0;
        } catch (error) {
            const failure = logFailure('查询扫码状态', error);
            return { state: 'error', message: `查询扫码状态失败: ${failure.message}` };
        }

        if (status === 2) return { state: 'scanned' };
        if (status !== 3) return { state: 'waiting' };

        // status=3：手机上已确认，换票
        try {
            const response = await signedPost('/api/ucenter/users/login', {}, { authType: 10, qrCode: String(key) });
            const data = (response && response.data) || {};
            const uid = data.id === undefined || data.id === null ? '' : String(data.id);
            const token = typeof data.token === 'string' ? data.token : '';
            if (!uid || !token) {
                return { state: 'error', message: '波点确认了登录，但没有返回 uid/token' };
            }

            auth.uid = uid;
            auth.token = token;
            rebuildClient();

            const info = data.userInfo || {};
            currentUser = {
                id: uid,
                nickname: String(info.nickname || info.name || '波点用户'),
                ...(info.pic ? { avatarUrl: String(info.pic) } : {}),
                ...(Number.isFinite(Number(info.isVip)) ? { vipType: Number(info.isVip) } : {}),
            };
            await api.storage.data.set(AUTH_STORAGE_KEY, { uid, token, user: currentUser, devId: DEV_ID });
            api.log.info(`[bodian] 登录成功 uid=${uid} nickname=${currentUser.nickname} devid=${DEV_ID.slice(0, 8)}`);
            return { state: 'confirmed' };
        } catch (error) {
            const failure = logFailure('换取登录凭据', error);
            return { state: 'error', message: `换取登录凭据失败: ${failure.message}` };
        }
    });

    api.rpc.handle('bodian.auth.cancelQr', async () => {
        // 波点没有显式取消接口，会话会自行过期；保持幂等即可
        return null;
    });

    api.rpc.handle('bodian.auth.logout', async () => {
        auth.uid = '-1';
        auth.token = '';
        currentUser = null;
        rebuildClient();
        try {
            await api.storage.data.delete(AUTH_STORAGE_KEY);
        } catch (error) {
            api.log.warn(`[bodian] 清除登录态失败: ${error && error.message}`);
        }
        api.log.info('[bodian] 已退出登录');
        return null;
    });

    void restoreAuth();
    // 音频代理必须起来：Folia 的 <audio crossOrigin="anonymous"> 要求 CORS，
    // 而波点 CDN 不提供，只能由本地代理补上（见 startAudioProxy 的注释）。
    startAudioProxy();

    api.log.info('[bodian] main 入口就绪（搜索 / 详情 / 播放 / 歌词 / 扫码登录 / 音频代理）');
};
