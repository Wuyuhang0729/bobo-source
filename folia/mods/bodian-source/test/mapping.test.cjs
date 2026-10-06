'use strict';

// mods/bodian-source/test/mapping.test.cjs
//
// fixture 的字段名与取值取自真机响应（见 NOTES.md 的接口清单）：
// 字段名一旦变化，这里的断言就是第一道红灯。

const test = require('node:test');
const assert = require('node:assert/strict');
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
} = require('../lib/mapping.cjs');

// 首页模块 10（心动收藏相似推荐）里的真实条目形状
const REAL_TRACK = {
    id: 325587834,
    name: 'K.K. House',
    albumId: 13263360,
    album: 'あつまれ どうぶつの森 K.K. Slider Complete Songs Collection',
    albumPic: 'https://img4.kuwo.cn/star/albumcover/800/s3s97/0/2176614079.webp',
    albumPic120: 'https://img4.kuwo.cn/star/albumcover/240/s3s97/0/2176614079.webp',
    artist: 'Nintendo Sound Team',
    artistId: 4876984,
    artistPic: 'https://img3.kuwo.cn/star/starheads/800/s4s94/81/1167160173.webp',
    artists: [{ id: 4876984, name: 'Nintendo Sound Team', pic: 'https://img4.kuwo.cn/star/starheads/120/s4s94/81/1167160173.webp' }],
    duration: 185,
};

test('曲目映射：字段照真实响应走（albumPic 是封面、duration 是秒）', () => {
    assert.deepEqual(toProviderSongFromTrackList(REAL_TRACK), {
        id: '325587834',
        title: 'K.K. House',
        artists: ['Nintendo Sound Team'],
        album: 'あつまれ どうぶつの森 K.K. Slider Complete Songs Collection',
        coverUrl: 'https://img4.kuwo.cn/star/albumcover/800/s3s97/0/2176614079.webp',
        durationMs: 185000,
    });
});

test('曲目映射：没有 artists 时退回 artist 的 & 连接形式', () => {
    const song = toProviderSongFromTrackList({ id: 1, name: 'x', artist: '卢广仲&陶喆& 周杰伦 ', duration: 1 });
    assert.deepEqual(song.artists, ['卢广仲', '陶喆', '周杰伦']);
});

test('曲目映射：别名与缺失字段', () => {
    const aliased = toProviderSongFromTrackList({ rid: 7, songName: '别名', artist: 'A', albumPic120: 'cover-120', duration: 0 });
    assert.equal(aliased.id, '7');
    assert.equal(aliased.title, '别名');
    assert.equal(aliased.coverUrl, 'cover-120');
    assert.ok(!('durationMs' in aliased), 'duration=0 不应产出 durationMs');
    assert.ok(!('album' in aliased), '没有 album 字段时不应凭空造一个');

    const empty = toProviderSongFromTrackList({ id: 8, name: '空' });
    assert.deepEqual(empty.artists, []);
    assert.ok(!('coverUrl' in empty));
});

test('曲目映射：artists 数组里混着字符串也能吃下', () => {
    assert.deepEqual(toProviderSongFromTrackList({ id: 1, name: 'x', artists: ['甲', '', null, '乙'] }).artists, ['甲', '乙']);
});

test('搜索映射：封面取 cover/coverSmall', () => {
    const song = toProviderSongFromSearch({ id: 112893, name: '晴天', artists: [{ name: '周杰伦' }], album: '叶惠美', cover: 'c0', coverSmall: 'c1', duration: 269 });
    assert.deepEqual(song, {
        id: '112893',
        title: '晴天',
        artists: ['周杰伦'],
        album: '叶惠美',
        coverUrl: 'c0',
        durationMs: 269000,
    });
});

test('列表提取：resultList / list / musicList / songs 的回退顺序与 total', () => {
    assert.deepEqual(pickSongList({ resultList: [1], total: 12 }).items, [1]);
    assert.equal(pickSongList({ resultList: [1], total: 12 }).total, 12);
    assert.deepEqual(pickSongList({ list: [2], total: '0' }).items, [2]);
    assert.equal(pickSongList({ list: [2], total: '0' }).total, 1, 'total 非法时回退到条数');
    assert.deepEqual(pickSongList({ musicList: [3] }).items, [3]);
    assert.deepEqual(pickSongList({ songs: [4] }).items, [4]);
    assert.deepEqual(pickSongList(null).items, []);
    assert.deepEqual(pickSongList({ resultList: [1], list: [2] }).items, [1], '优先级：resultList 先');
});

test('分页：offset/limit → pn（波点 pn 从 1 开始）', () => {
    assert.equal(toPageNumber(0, 50), 1);
    assert.equal(toPageNumber(49, 50), 1);
    assert.equal(toPageNumber(50, 50), 2);
    assert.equal(toPageNumber(120, 50), 3);
    assert.equal(toPageNumber(-5, 50), 1, '负 offset 当 0');
    assert.equal(toPageNumber(10, 0), 11, 'limit 非法时按 1 计算，至少不除零');
});

test('收藏列表：带 albumId 的是专辑', () => {
    assert.equal(isCollectedAlbum({ id: 1, albumId: 7899404 }), true);
    assert.equal(isCollectedAlbum({ id: 1, name: '歌单' }), false);
    assert.equal(isCollectedAlbum(null), false);
});

test('自建歌单映射：source 固定 5、isOwned 为真', () => {
    const created = toCollectionFromCreated({ id: 74988403, name: '我的歌单', pic: 'p', description: 'd', musicCount: 26 });
    assert.deepEqual(created, {
        id: '74988403',
        name: '我的歌单',
        type: 'playlist',
        source: '5',
        coverUrl: 'p',
        description: 'd',
        trackCount: 26,
        isOwned: true,
    });
});

test('收藏歌单映射：source 取 sourceType，缺失退 4', () => {
    assert.equal(toCollectionFromCollected({ id: 1, name: 'x', sourceType: 4 }).source, '4');
    assert.equal(toCollectionFromCollected({ id: 1, name: 'x' }).source, '4');
    assert.equal(toCollectionFromCollected({ id: 1, name: 'x', sourceType: 6 }).source, '6');
    assert.equal(toCollectionFromCollected({ id: 1, name: 'x' }).isOwned, false);
});

test('收藏专辑映射：id 用 albumId，creatorName 用 artist', () => {
    const album = toAlbumFromCollected({
        id: 7899404,
        albumId: 7899404,
        name: '幻',
        pic: 'http://img4.kuwo.cn/star/albumcover/500/s4s13/24/2123938459.jpg',
        artist: '苏运莹',
        sourceType: 6,
        musicCount: 12,
    });
    assert.deepEqual(album, {
        id: '7899404',
        name: '幻',
        type: 'album',
        coverUrl: 'http://img4.kuwo.cn/star/albumcover/500/s4s13/24/2123938459.jpg',
        description: '苏运莹',
        trackCount: 12,
        creatorName: '苏运莹',
    });
});

test('推荐歌单映射：sourceType 进 providerData、简介里的 &nbsp; 换成空格', () => {
    const collection = toRecommendedCollection({
        id: 72330185,
        name: 'i人庇护所',
        pic: 'cover',
        description: '独处的时光，比任何陪伴都舒服。i&nbsp;人不用和谁分享',
        playNum: 4733,
        sourceType: 13,
    });
    assert.deepEqual(collection, {
        id: '72330185',
        name: 'i人庇护所',
        type: 'playlist',
        coverUrl: 'cover',
        description: '独处的时光，比任何陪伴都舒服。i 人不用和谁分享',
        playCount: 4733,
        providerData: { source: '13' },
    });
    assert.equal(toRecommendedCollection({ id: 1, name: 'x' }).providerData.source, '13', '缺 sourceType 时按平台目录 13');
});

test('搜歌单映射：source 保留在内部形状里（点开取曲目要用）', () => {
    const collection = toCollectionFromSearch({
        id: 280301309,
        source: '4',
        name: '摇滚现场',
        cover: 'cover-url',
        trackCount: 51,
        playCount: 12043,
        creatorId: '42',
        creatorName: '某人',
        raw: {},
    });
    assert.deepEqual(collection, {
        id: '280301309',
        name: '摇滚现场',
        type: 'playlist',
        source: '4',
        coverUrl: 'cover-url',
        trackCount: 51,
        playCount: 12043,
        creatorName: '某人',
    });
});

test('搜歌单映射：缺字段时不凭空造键，source 退到平台目录 13', () => {
    const minimal = toCollectionFromSearch({ id: 1, name: '只有名字' });
    assert.deepEqual(minimal, { id: '1', name: '只有名字', type: 'playlist', source: '13' });
});
