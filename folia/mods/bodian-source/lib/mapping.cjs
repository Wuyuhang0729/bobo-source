'use strict';

// mods/bodian-source/lib/mapping.cjs
//
// 波点原始响应 → FoliumProviderSong / FoliumProviderCollection 的**纯映射**。
//
// 全部字段名都是真机核对过的（清单见 NOTES.md「三个标签的数据来源」），
// 所以这些函数是"上游一改字段就静默出错"的高危区 —— 逻辑放这里是为了能被
// test/ 下的单测直接盯着，改动必须同步更新那里的 fixture。

/** 取第一个非空字符串（响应里同一语义常有多个别名）。 */
const firstText = (...values) => {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value;
        if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return '';
};

/** 正数才认（响应里 0 / '' / null 都表示"没有"）。 */
const positiveNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/** `artists: [{name}]` 优先；退回 `artist: "A&B"` 的 & 连接形式。 */
const toArtists = (item) => {
    if (Array.isArray(item.artists) && item.artists.length) {
        return item.artists
            .map((artist) => (artist && typeof artist === 'object' ? artist.name : artist))
            .map((name) => (name === undefined || name === null ? '' : String(name).trim()))
            .filter(Boolean);
    }
    const flat = firstText(item.artist);
    return flat ? flat.split('&').map((name) => name.trim()).filter(Boolean) : [];
};

/**
 * 曲目型列表（歌单曲目 / 专辑曲目 / 推荐流）→ FoliumProviderSong。
 * 封面字段是 albumPic（不是 pic/cover），时长单位是秒。
 */
const toProviderSongFromTrackList = (item) => {
    const song = {
        id: firstText(item.id, item.rid, item.musicRid),
        title: firstText(item.name, item.songName, item.title),
        artists: toArtists(item),
    };
    const album = firstText(item.album);
    if (album) song.album = album;
    const cover = firstText(item.albumPic, item.albumPic120, item.pic, item.cover);
    if (cover) song.coverUrl = cover;
    const seconds = positiveNumber(item.duration);
    if (seconds) song.durationMs = Math.round(seconds * 1000);
    return song;
};

/**
 * 搜索 / 单曲详情（库 normalize 过的 BodianSong）→ FoliumProviderSong。
 * 与上面同构，差别只在封面字段是 cover/coverSmall。
 */
const toProviderSongFromSearch = (song) => {
    const artistNames = Array.isArray(song.artists) && song.artists.length
        ? song.artists.map((artist) => (artist && artist.name ? artist.name : artist))
            .map((name) => String(name).trim()).filter(Boolean)
        : (firstText(song.artist) ? firstText(song.artist).split('&').map((name) => name.trim()).filter(Boolean) : []);
    const result = {
        id: String(song.id),
        title: String(song.name ?? ''),
        artists: artistNames,
    };
    if (song.album) result.album = String(song.album);
    const cover = firstText(song.cover, song.coverSmall);
    if (cover) result.coverUrl = cover;
    const seconds = positiveNumber(song.duration);
    if (seconds) result.durationMs = Math.round(seconds * 1000);
    return result;
};

/** 从曲目型响应的 data 里取列表与总数（字段名随接口而异）。 */
const pickSongList = (data) => {
    const source = data && typeof data === 'object' ? data : {};
    const list = source.resultList || source.list || source.musicList || source.songs || [];
    const items = Array.isArray(list) ? list : [];
    const total = positiveNumber(source.total) || items.length;
    return { items, total };
};

/**
 * offset/limit → 波点的页码 pn。
 *
 * 两套起点都在这一个公式里：调用方传 offset（Folia 一律 offset-based），
 * 波点的 pn 从 1 开始（歌单 / 专辑 / 收藏）；搜索接口的 pn 从 0 开始，
 * 但库已经帮我们转过，所以这里同样用 +1 的"库页码"。
 */
const toPageNumber = (offset, limit) => {
    const safeLimit = positiveNumber(limit) || 1;
    const safeOffset = Number.isFinite(Number(offset)) && Number(offset) > 0 ? Number(offset) : 0;
    return Math.floor(safeOffset / safeLimit) + 1;
};

/** 收藏列表（`collect/4/list`）里，带 albumId 的是专辑，其余是歌单。 */
const isCollectedAlbum = (item) => Boolean(item && item.albumId);

/** 自建歌单（`playlist/userCreate`，source 恒为 5）。 */
const toCollectionFromCreated = (playlist) => ({
    id: String(playlist.id),
    name: String(playlist.name || ''),
    type: 'playlist',
    source: '5',
    coverUrl: firstText(playlist.pic, playlist.cover),
    description: String(playlist.description || ''),
    trackCount: positiveNumber(firstText(playlist.musicCount, playlist.musicNum)),
    isOwned: true,
});

/** 收藏的歌单（`collect/4/list` 里没有 albumId 的那些），source 取 sourceType。 */
const toCollectionFromCollected = (item) => ({
    id: String(item.id),
    name: String(item.name || ''),
    type: 'playlist',
    source: firstText(item.sourceType) || '4',
    coverUrl: firstText(item.pic, item.cover),
    description: String(item.description || ''),
    trackCount: positiveNumber(firstText(item.musicCount, item.musicNum)),
    isOwned: false,
});

/** 收藏的专辑；id 用 albumId（宿主会拿它去问 getAlbumTracks）。 */
const toAlbumFromCollected = (item) => ({
    id: String(item.albumId),
    name: String(item.name || ''),
    type: 'album',
    coverUrl: firstText(item.pic, item.cover),
    description: String(item.artist || ''),
    trackCount: positiveNumber(firstText(item.musicCount, item.musicNum)),
    creatorName: String(item.artist || ''),
});

/** 首页模块里的平台歌单（「宝藏歌单库」）→ 电台卡片的 collection。 */
const toRecommendedCollection = (item) => ({
    id: String(item.id),
    name: String(item.name || ''),
    type: 'playlist',
    coverUrl: firstText(item.pic, item.cover),
    // 简介里带 HTML 实体（&nbsp;），带进界面会显示成字面量
    description: String(item.description || '').replace(/&nbsp;/g, ' '),
    playCount: positiveNumber(item.playNum),
    // 平台目录的 sourceType（实测 13），取曲目时要带回去
    providerData: { source: firstText(item.sourceType) || '13' },
});

module.exports = {
    firstText,
    positiveNumber,
    toArtists,
    toProviderSongFromTrackList,
    toProviderSongFromSearch,
    pickSongList,
    toPageNumber,
    isCollectedAlbum,
    toCollectionFromCreated,
    toCollectionFromCollected,
    toAlbumFromCollected,
    toRecommendedCollection,
};
