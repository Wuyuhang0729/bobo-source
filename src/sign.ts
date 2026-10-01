/**
 * 波点播放接口的请求签名。
 *
 * 逆向自客户端（musicdl / UnblockNeteaseMusic 的波点实现是同一套），本仓库真机复现通过：
 *
 * ```
 * seed = "kuwotest" + 字母数字(urlencode(params)) 排序后拼接
 * 若带 body: seed += md5(body + "kuwotest")
 * sign = md5(seed + path)
 * ```
 *
 * 注意两个易错点：
 * - `urlencode` 必须用 `pyUrlencode`（Python `quote_plus` 语义），否则排序后的字符集不同；
 * - body 必须是 `JSON.stringify` 的紧凑形式（等价 Python `separators=(',', ':')`，
 *   `ensure_ascii=False`），因为它的 md5 直接进签名。
 */
import { createHash } from 'node:crypto';

import { pyUrlencode } from './http.js';

/** 固定的盐前缀，来自客户端实现。 */
const SALT_PREFIX = 'kuwotest';

export function md5(input: string): string {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

/**
 * 计算请求签名。
 *
 * @param path 接口路径，例如 `/api/play/music/v2/checkRight`（含前导斜杠，不含 query）。
 * @param params 查询参数（**不含** `sign` 自身）。
 * @param bodyText 请求体原文；无 body 时传空串。
 */
export function bodianSign(
  path: string,
  params: Iterable<readonly [string, string | number | boolean | undefined | null]>,
  bodyText = '',
): string {
  const alnum = [...pyUrlencode(params)]
    .filter((char) => /[A-Za-z0-9]/.test(char))
    .sort()
    .join('');

  let seed = SALT_PREFIX + alnum;
  if (bodyText) seed += md5(bodyText + SALT_PREFIX);

  return md5(seed + path);
}
