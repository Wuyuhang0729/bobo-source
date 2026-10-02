'use strict';

// mods/bodian-source/lib/errors.cjs
//
// 上游失败分类。
//
// 为什么需要：这个音源的失败形态是混杂的 —— HTTP 层直接抛（超时/连接重置）、
// 信封层拒绝（`code=-101` 这类）、响应形状变了（JSON 解析不过、字段没了）。
// 早期代码一律 `log.warn(msg)` 然后返回空数组，于是"电台是空的"到底是没数据、
// token 过期还是上游改了字段，日志里看不出来。
//
// describeFailure 把它归一成 (kind, code, message)：
//   network  —— 连接层失败（重试/检查网络，通常自愈）
//   shape    —— 响应不是合法 JSON（上游形状变了，要看 raw）
//   rejected —— 上游明确拒绝（看 code：-101 多为签名/参数/token 问题）
//   unknown  —— 其余

const NETWORK_CODES = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
    'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ABORT_ERR',
]);

const NETWORK_HINTS = /timeout|timed out|socket hang up|fetch failed|network|ECONN|网络/i;
const JSON_HINTS = /JSON/i;

/** 上游明确"拒绝"里最值得单独看一眼的一类：签名/参数/token 无效。 */
const TOKEN_REJECTION_CODES = new Set([-101, 401, 403]);

/**
 * @param {unknown} error 任意抛出物
 * @returns {{ kind: 'network'|'shape'|'rejected'|'unknown', code: number|null, message: string }}
 */
const describeFailure = (error) => {
    // 注意 `Number(null) === 0`：null/undefined 必须显式排除，否则"没有 code 的错误"会被当成 code=0
    const rawCode = error === null || error === undefined
        ? undefined
        : (error.code !== undefined ? error.code : error.status);
    const hasCode = rawCode !== undefined && rawCode !== null && Number.isFinite(Number(rawCode));
    const code = hasCode ? Number(rawCode) : null;
    const message = error && error.message ? String(error.message) : String(error ?? '未知错误');

    if (code !== null && NETWORK_CODES.has(String(rawCode))) return { kind: 'network', code, message };
    if (NETWORK_HINTS.test(message)) return { kind: 'network', code, message };
    if (error instanceof SyntaxError || JSON_HINTS.test(message)) return { kind: 'shape', code, message };
    if (code !== null) return { kind: 'rejected', code, message };
    return { kind: 'unknown', code, message };
};

/** 失败是否属于"签名/参数/token 被拒"——这种要看是不是登录态过期。 */
const isTokenRejection = (failure) => Boolean(failure && failure.kind === 'rejected' && TOKEN_REJECTION_CODES.has(failure.code));

/** 拼一行结构化日志文案（统一形状，方便 grep `kind=`）。 */
const formatFailure = (failure) => (
    `kind=${failure.kind} code=${failure.code ?? '-'} msg=${failure.message}`
);

module.exports = { describeFailure, isTokenRejection, formatFailure, NETWORK_CODES, TOKEN_REJECTION_CODES };
