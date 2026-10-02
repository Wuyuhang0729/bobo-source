'use strict';

// mods/bodian-source/test/errors.test.cjs

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeFailure, isTokenRejection, formatFailure } = require('../lib/errors.cjs');

test('连接层失败归 network', () => {
    assert.equal(describeFailure(Object.assign(new Error('connect ECONNRESET'), { code: 'ECONNRESET' })).kind, 'network');
    assert.equal(describeFailure(new Error('socket hang up')).kind, 'network');
    assert.equal(describeFailure(new Error('request timeout')).kind, 'network');
});

test('JSON 解析失败归 shape（上游形状变了）', () => {
    let parseError;
    try { JSON.parse('<html>'); } catch (error) { parseError = error; }
    assert.equal(describeFailure(parseError).kind, 'shape');
    assert.equal(describeFailure(new Error('响应不是合法 JSON @ /api/x')).kind, 'shape');
});

test('信封拒绝归 rejected，并保留 code', () => {
    const failure = describeFailure(Object.assign(new Error('接口错误 code=-101 msg= @ /api/service/playlist/userCreate'), { code: -101 }));
    assert.equal(failure.kind, 'rejected');
    assert.equal(failure.code, -101);
    assert.equal(isTokenRejection(failure), true);
});

test('HTTP 错误码也是 rejected，但不当作 token 问题', () => {
    const failure = describeFailure(Object.assign(new Error('HTTP 500 @ /api/x'), { code: 500 }));
    assert.equal(failure.kind, 'rejected');
    assert.equal(isTokenRejection(failure), false);
});

test('裸错误归 unknown，且日志行形状稳定', () => {
    const failure = describeFailure(new Error('something odd'));
    assert.equal(failure.kind, 'unknown');
    assert.equal(failure.code, null);
    assert.equal(formatFailure({ kind: 'rejected', code: -101, message: 'x' }), 'kind=rejected code=-101 msg=x');
    assert.equal(formatFailure({ kind: 'unknown', code: null, message: 'x' }), 'kind=unknown code=- msg=x');
});

test('null / undefined 不会炸', () => {
    assert.equal(describeFailure(null).kind, 'unknown');
    assert.equal(describeFailure(undefined).kind, 'unknown');
    assert.equal(describeFailure('boom').message, 'boom');
});
