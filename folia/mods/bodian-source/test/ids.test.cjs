'use strict';

// mods/bodian-source/test/ids.test.cjs
//
// 跑法：node --test folia/mods/bodian-source/test  （或 node tools/test-mod.mjs）

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeCollectionId, decodeCollectionId } = require('../lib/ids.cjs');

test('编码：source 直接进前缀', () => {
    assert.equal(encodeCollectionId('5', 7899404), 'p5_7899404');
    assert.equal(encodeCollectionId(13, '72330185'), 'p13_72330185');
    assert.equal(encodeCollectionId('4', 42), 'p4_42');
});

test('编码：source 非法/缺失时退到自建歌单（5）', () => {
    assert.equal(encodeCollectionId(undefined, 7), 'p5_7');
    assert.equal(encodeCollectionId(0, 7), 'p5_7');
    assert.equal(encodeCollectionId('--', 7), 'p5_7');
});

test('解码：正常形状', () => {
    assert.deepEqual(decodeCollectionId('p5_7899404'), { source: '5', id: '7899404' });
    assert.deepEqual(decodeCollectionId('p13_72330185'), { source: '13', id: '72330185' });
});

test('解码：原始 id 里带下划线也完整还原', () => {
    assert.deepEqual(decodeCollectionId('p4_a_b_c'), { source: '4', id: 'a_b_c' });
});

test('解码：历史遗留的纯数字 id 返回 null（走 providerData / 缓存兜底）', () => {
    assert.equal(decodeCollectionId('7899404'), null);
    assert.equal(decodeCollectionId(''), null);
    assert.equal(decodeCollectionId(undefined), null);
    assert.equal(decodeCollectionId('p_5_x'), null); // 前缀里必须有 source
});

test('编解码可往返', () => {
    for (const [source, id] of [['5', '1'], ['4', '123456'], ['13', '99']]) {
        assert.deepEqual(decodeCollectionId(encodeCollectionId(source, id)), { source, id });
    }
});
