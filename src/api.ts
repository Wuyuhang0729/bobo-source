/**
 * 波点各接口的薄封装。
 *
 * 每个函数只负责「拼参数 → 发请求 → 校验 code」，不做模型转换（那是 normalize 的职责）。
 * 所有端点与请求头均来自真机验证，出处标注在各函数注释里。
 */
import { randomInt } from 'node:crypto';

import { httpRequest, pyQuote, pyUrlencode } from './http.js';
import { toNumber } from './normalize.js';
import { bodianSign } from './sign.js';
import type { BodianSearchItem } from './types.js';

export const BODIAN_API_ORIGIN = 'https://bd-api.kuwo.cn';
/** `convert_url_with_sign` 主用的车机域名。 */
export const BODIAN_CAR_ORIGIN = 'https://nmobi.kuwo.cn';
/** 车机域名的备选。 */
export const BODIAN_CAR_FALLBACK_ORIGIN = 'https://mobi.kuwo.cn';
export const BODIAN_LYRIC_ORIGIN = 'https://mlyric.kuwo.cn';
export const BODIAN_H5_ORIGIN = 'https://m.kuwo.cn';

/**
 * 伪装波点 Windows 客户端。匿名（`uid=-1`、`token=''`）即可通过校验，
 * 但缺 `devid`/`qimei36` 会被拒（返回 `402`）。
 */
export const DEFAULT_CLIENT_HEADERS: Readonly<Record<string, string>> = {
  'user-agent': 'Dart/3.3 (dart:io)',
  plat: 'win',
  'api-ver': 'application/json',
  channel: 'W1',
  brand: 'Windows 11 Pro for Workstations',
  net: 'wifi',
  'content-type': 'application/json',
  ver: '1.1.5',
  svrver: '13',
};

/** `convert_url_with_sign` 的车机客户端标识。 */
const CAR_CLIENT_SOURCE = 'kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk';
const CAR_CLIENT_HEADERS: Readonly<Record<string, string>> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  accept: '*/*',
};

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';

export interface ApiContext {
  uid: string;
  token: string;
  devId: string;
  timeout?: number;
  retries?: number;
}

/** 接口返回 `code !== 200`，或 HTTP 层异常时的错误。 */
export class BodianApiError extends Error {
  readonly code: number;
  readonly path: string;
  readonly raw: unknown;

  constructor(message: string, options: { code: number; path: string; raw?: unknown }) {
    super(message);
    this.name = 'BodianApiError';
    this.code = options.code;
    this.path = options.path;
    this.raw = options.raw;
  }
}

interface Envelope<T> {
  code: number;
  msg?: string;
  data: T;
}

interface RequestOptions {
  path: string;
  headers?: Record<string, string>;
  body?: string;
  method?: string;
  timeout?: number;
  retries?: number;
}

function clientHeaders(ctx: ApiContext): Record<string, string> {
  return { ...DEFAULT_CLIENT_HEADERS, devid: ctx.devId, qimei36: ctx.devId };
}

async function requestJson<T>(url: string, options: RequestOptions): Promise<Envelope<T>> {
  const response = await httpRequest(url, {
    method: options.method ?? 'GET',
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.body !== undefined ? { body: options.body } : {}),
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    ...(options.retries !== undefined ? { retries: options.retries } : {}),
  });

  if (response.status !== 200) {
    throw new BodianApiError(`HTTP ${response.status} @ ${options.path}`, {
      code: response.status,
      path: options.path,
      raw: response.text.slice(0, 300),
    });
  }

  let parsed: Envelope<T>;
  try {
    parsed = JSON.parse(response.text) as Envelope<T>;
  } catch {
    throw new BodianApiError(`响应不是合法 JSON @ ${options.path}`, {
      code: -1,
      path: options.path,
      raw: response.text.slice(0, 300),
    });
  }

  if (parsed.code !== 200) {
    throw new BodianApiError(`接口错误 code=${parsed.code} msg=${parsed.msg ?? ''} @ ${options.path}`, {
      code: parsed.code,
      path: options.path,
      raw: parsed,
    });
  }

  return parsed;
}

/** Python `quote(str, safe="=&")`：保留 `=` 与 `&` 不编码。 */
function quoteKeepingSeparators(value: string): string {
  return pyQuote(value).split('%3D').join('=').split('%26').join('&');
}

/**
 * 搜索歌曲。
 *
 * 真机验证：`GET /api/search/music/list?pn=0&rn=20&keyword=…&correct=1&uid=-1&token=`
 * → `code=200`，`data.resultList[]`。注意 `pn` 从 **0** 开始。
 */
export async function searchMusic(
  ctx: ApiContext,
  params: { keyword: string; page?: number; pageSize?: number },
): Promise<{ list: BodianSearchItem[]; total: number }> {
  const path = '/api/search/music/list';
  const query: Array<[string, string]> = [
    ['pn', String(Math.max(0, (params.page ?? 1) - 1))],
    ['rn', String(params.pageSize ?? 20)],
    ['keyword', params.keyword],
    ['correct', '1'],
    ['uid', ctx.uid],
    ['token', ctx.token],
  ];

  const envelope = await requestJson<{ resultList?: BodianSearchItem[]; total?: number }>(
    `${BODIAN_API_ORIGIN}${path}?${pyUrlencode(query)}`,
    { path, headers: clientHeaders(ctx), ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}), ...(ctx.retries !== undefined ? { retries: ctx.retries } : {}) },
  );

  const list = envelope.data?.resultList ?? [];
  return { list, total: toNumber(envelope.data?.total, list.length) };
}

/**
 * 搜索歌单。
 *
 * 真机验证：参数名是 `keyword`（不是 `key`，用 `key` 会得到空列表）。
 */
export async function searchPlaylists(
  ctx: ApiContext,
  params: { keyword: string; page?: number; pageSize?: number },
): Promise<{ list: Array<Record<string, unknown>>; total: number }> {
  const path = '/api/search/playlist/list';
  const query: Array<[string, string]> = [
    ['keyword', params.keyword],
    ['pn', String(Math.max(0, (params.page ?? 1) - 1))],
    ['rn', String(params.pageSize ?? 20)],
    ['uid', ctx.uid],
    ['token', ctx.token],
  ];

  const envelope = await requestJson<{ resultList?: Array<Record<string, unknown>>; total?: number }>(
    `${BODIAN_API_ORIGIN}${path}?${pyUrlencode(query)}`,
    { path, headers: clientHeaders(ctx), ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}), ...(ctx.retries !== undefined ? { retries: ctx.retries } : {}) },
  );

  const list = envelope.data?.resultList ?? [];
  return { list, total: toNumber(envelope.data?.total, list.length) };
}

/**
 * 取歌单曲目。
 *
 * 真机验证：`GET /api/service/playlist/{id}/musicList?source=4&pn=1&rn=100&uid=-1&token=`
 * → `code=200`，`data.list[]` + `data.total`。注意 `pn` 从 **1** 开始（与搜索接口不同）。
 */
export async function playlistMusicList(
  ctx: ApiContext,
  params: { playlistId: string; source?: string; page?: number; pageSize?: number },
): Promise<{ list: BodianSearchItem[]; total: number }> {
  const path = `/api/service/playlist/${params.playlistId}/musicList`;
  const query: Array<[string, string]> = [
    ['source', params.source ?? '5'],
    ['pn', String(Math.max(1, params.page ?? 1))],
    ['rn', String(params.pageSize ?? 100)],
    ['uid', ctx.uid],
    ['token', ctx.token],
  ];

  const envelope = await requestJson<{ list?: BodianSearchItem[]; total?: number }>(
    `${BODIAN_API_ORIGIN}${path}?${pyUrlencode(query)}`,
    { path, headers: clientHeaders(ctx), ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}), ...(ctx.retries !== undefined ? { retries: ctx.retries } : {}) },
  );

  const list = envelope.data?.list ?? [];
  return { list, total: toNumber(envelope.data?.total, list.length) };
}

/** 取歌单元数据。真机验证字段：`id/name/pic/creatorName/description/musicCount/playNum`。 */
export async function playlistInfo(
  ctx: ApiContext,
  params: { playlistId: string; source?: string },
): Promise<Record<string, unknown>> {
  const path = `/api/service/playlist/info/${params.playlistId}`;
  const query: Array<[string, string]> = [
    ['source', params.source ?? '5'],
    ['uid', ctx.uid],
    ['token', ctx.token],
  ];

  const envelope = await requestJson<Record<string, unknown>>(
    `${BODIAN_API_ORIGIN}${path}?${pyUrlencode(query)}`,
    { path, headers: clientHeaders(ctx), ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}), ...(ctx.retries !== undefined ? { retries: ctx.retries } : {}) },
  );

  return envelope.data ?? {};
}

/**
 * 取歌曲详情。
 *
 * 真机验证：`GET /api/service/music/info?musicId=228908&uid=-1&token=` → `code=200`，
 * 且字段结构与搜索接口**同构**（`name` / `artist` / `artists` / `album` / `albumPic` /
 * `duration` / `audios`），所以可以直接交给 `normalizeSong`，连音质列表一起拿到。
 *
 * 注：早期实现用的是酷我 H5 的 `songinfoandlrc`，那个接口会间歇性返回
 * `status: 301 音乐查询失败`，且从不返回音质列表 —— 详情职责已改由本接口承担。
 */
export async function musicInfo(ctx: ApiContext, params: { musicId: string }): Promise<BodianSearchItem> {
  const path = '/api/service/music/info';
  const query: Array<[string, string]> = [
    ['musicId', params.musicId],
    ['uid', ctx.uid],
    ['token', ctx.token],
  ];

  const envelope = await requestJson<BodianSearchItem | null>(
    `${BODIAN_API_ORIGIN}${path}?${pyUrlencode(query)}`,
    { path, headers: clientHeaders(ctx), ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}), ...(ctx.retries !== undefined ? { retries: ctx.retries } : {}) },
  );

  const data = envelope.data;
  if (!data || !data.id) {
    throw new BodianApiError(`歌曲详情为空: ${params.musicId}`, { code: -1, path, raw: envelope.data });
  }
  return data;
}

export interface CheckRightResult {
  /** 波点状态码：`3` 表示只能试听（片段）。 */
  status: number;
  raw: Record<string, unknown>;
}

/**
 * 查询播放权限。
 *
 * 真机验证：**必须 GET 带 body**（`POST` → `500 Service error`），且 `sign` 覆盖 body。
 * 匿名下返回 `data.audition`（试听片段，`start=0 end=29`）—— 所以匿名播放不走这条路径，
 * 见 {@link convertUrl}。
 */
export async function checkRight(
  ctx: ApiContext,
  params: { musicId: string; freeSign?: string },
): Promise<CheckRightResult> {
  const path = '/api/play/music/v2/checkRight';
  const freeSign = params.freeSign ?? '';
  const body = JSON.stringify({ musicId: Number(params.musicId), freeSign });

  const query: Array<[string, string]> = [
    ['uid', ctx.uid],
    ['token', ctx.token],
    ['timestamp', String(Date.now())],
    ['musicId', params.musicId],
    ['freeSign', freeSign],
  ];
  query.push(['sign', bodianSign(path, query, body)]);

  const envelope = await requestJson<Record<string, unknown>>(
    `${BODIAN_API_ORIGIN}${path}?${pyUrlencode(query)}`,
    { path, headers: clientHeaders(ctx), body, ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}), ...(ctx.retries !== undefined ? { retries: ctx.retries } : {}) },
  );

  return { status: toNumber(envelope.data?.status, 0), raw: envelope.data ?? {} };
}

/**
 * 取正式播放地址（会员通道）。
 *
 * 真机验证与 {@link checkRight} 同样要求 GET 带 body。此接口对匿名身份只会返回试听
 * 片段，需要有效 `uid`/`token`；第一版不做登录，因此默认播放链路用 {@link convertUrl}。
 */
export async function audioUrl(
  ctx: ApiContext,
  params: { musicId: string; format: string; br: string; freeSign?: string },
): Promise<Record<string, unknown>> {
  const path = '/api/play/music/v2/audioUrl';
  const freeSign = params.freeSign ?? '';
  const musicId = String(params.musicId);
  const body = JSON.stringify({
    devId: ctx.devId,
    musicId,
    format: params.format,
    br: params.br,
    freeSign,
  });

  const query: Array<[string, string]> = [
    ['uid', ctx.uid],
    ['token', ctx.token],
    ['timestamp', String(Date.now())],
    ['devId', ctx.devId],
    ['musicId', musicId],
    ['format', params.format],
    ['br', params.br],
    ['freeSign', freeSign],
  ];
  query.push(['sign', bodianSign(path, query, body)]);

  const envelope = await requestJson<Record<string, unknown>>(
    `${BODIAN_API_ORIGIN}${path}?${pyUrlencode(query)}`,
    {
      path,
      headers: { ...clientHeaders(ctx), uid: ctx.uid, token: ctx.token },
      body,
      ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}),
      ...(ctx.retries !== undefined ? { retries: ctx.retries } : {}),
    },
  );

  return envelope.data ?? {};
}

export interface ConvertUrlResult {
  url: string;
  format: string;
  bitrate: number;
  duration: number;
  raw: Record<string, unknown>;
}

/**
 * 通过车机客户端的 `convert_url_with_sign` 取播放地址。
 *
 * 这是**匿名可用**的完整音质通道：真机验证返回 FLAC 完整音频
 * （`55,397,039` 字节、`fLaC` magic、`Range` 请求返回 `206`），
 * 与 `checkRight` 的 29 秒试听形成对比。无需签名，`br` 形如 `2000kflac`。
 *
 * 主域名失败时自动回退到 `mobi.kuwo.cn`。
 */
export async function convertUrl(
  ctx: ApiContext,
  params: { musicId: string; br: string },
): Promise<ConvertUrlResult> {
  const path = '/mobi.s';
  const query = new URLSearchParams({
    f: 'web',
    source: CAR_CLIENT_SOURCE,
    type: 'convert_url_with_sign',
    rid: String(params.musicId),
    br: params.br,
    user: String(randomInt(1_000_000, 10_000_000)),
    loginUid: String(randomInt(1_000_000, 10_000_000)),
  });

  const origins = [BODIAN_CAR_ORIGIN, BODIAN_CAR_FALLBACK_ORIGIN];
  let lastError: unknown;

  for (const origin of origins) {
    try {
      const envelope = await requestJson<Record<string, unknown>>(`${origin}${path}?${query.toString()}`, {
        path,
        headers: { ...CAR_CLIENT_HEADERS },
        ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}),
        ...(ctx.retries !== undefined ? { retries: ctx.retries } : {}),
      });

      const url = typeof envelope.data?.url === 'string' ? envelope.data.url : '';
      if (!url) throw new BodianApiError(`响应里没有 url @ ${origin}`, { code: -1, path, raw: envelope.data });

      return {
        url,
        format: String(envelope.data?.format ?? ''),
        bitrate: toNumber(envelope.data?.bitrate),
        duration: toNumber(envelope.data?.duration),
        raw: envelope.data ?? {},
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new BodianApiError('convert_url_with_sign 全部通道失败', { code: -1, path });
}

/**
 * 取逐字歌词。
 *
 * 真机验证：`GET mlyric.kuwo.cn/mobi.s?f=bodian&q=<base64>&uid=-1&token=` → `code=200`，
 * `data.content` 是 **base64 的逐字歌词**（`[00:00.000]<1120,-1120>晴<2400,160>天`），
 * 正好就是 LX Music 的 `lxlyric` 格式。
 */
export async function lyric(ctx: ApiContext, params: { musicId: string }): Promise<string> {
  const path = '/mobi.s';
  const inner = `type=lyric&req=2&lrcx=1&rid=${params.musicId}&songname=&artist=&corp=kuwo&fromchannel=bodian`;
  const q = Buffer.from(quoteKeepingSeparators(inner), 'utf8').toString('base64');
  const query = pyUrlencode([
    ['f', 'bodian'],
    ['q', q],
    ['uid', ctx.uid],
    ['token', ctx.token],
  ]);

  const envelope = await requestJson<{ content?: string }>(`${BODIAN_LYRIC_ORIGIN}${path}?${query}`, {
    path,
    headers: { 'user-agent': MOBILE_UA },
    ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}),
    ...(ctx.retries !== undefined ? { retries: ctx.retries } : {}),
  });

  const content = envelope.data?.content;
  if (!content) return '';
  return Buffer.from(content, 'base64').toString('utf8');
}

/**
 * 取歌曲元信息（专辑 / 时长 / 封面）。
 *
 * 波点自身没有暴露「按 id 取详情」的接口，这里用酷我 H5 的 `songinfoandlrc`，
 * 它同时提供标准 LRC（`lrclist`）作为逐字歌词的备选来源。
 */
export async function mobileSongInfo(
  ctx: ApiContext,
  params: { musicId: string },
): Promise<{ info: Record<string, unknown>; lrcList: Array<{ lineLyric?: string; time?: string }> }> {
  const path = '/newh5/singles/songinfoandlrc';
  const url = `${BODIAN_H5_ORIGIN}${path}?${pyUrlencode([['musicId', params.musicId]])}`;

  const response = await httpRequest(url, {
    headers: {
      'user-agent': MOBILE_UA,
      referer: `${BODIAN_H5_ORIGIN}/yinyue/${params.musicId}`,
      accept: 'application/json, text/plain, */*',
    },
    ...(ctx.timeout !== undefined ? { timeout: ctx.timeout } : {}),
    ...(ctx.retries !== undefined ? { retries: ctx.retries } : {}),
  });

  if (response.status !== 200) {
    throw new BodianApiError(`HTTP ${response.status} @ ${path}`, { code: response.status, path });
  }

  let parsed: { code?: number; data?: { songinfo?: Record<string, unknown>; lrclist?: Array<{ lineLyric?: string; time?: string }> } };
  try {
    parsed = JSON.parse(response.text) as typeof parsed;
  } catch {
    throw new BodianApiError(`响应不是合法 JSON @ ${path}`, { code: -1, path, raw: response.text.slice(0, 200) });
  }

  return { info: parsed.data?.songinfo ?? {}, lrcList: parsed.data?.lrclist ?? [] };
}
