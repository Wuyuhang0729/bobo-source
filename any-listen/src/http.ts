/**
 * HTTP 层。
 *
 * 两个必须遵守的约束（均来自真机实测）：
 *
 * 1. 波点播放接口要求 **GET 且带 request body** —— 签名覆盖 body。改成 POST 会直接
 *    返回 `500 Service error`。Node 原生 `fetch` 禁止 GET/HEAD 带 body，因此这里用
 *    `node:https` / `node:http` 手工构造请求。
 * 2. 参与签名的 `urlencode` 必须与 Python `quote_plus` 完全一致，否则签名字符串不同。
 *    JS 的 `encodeURIComponent` 会漏编码 `! * ' ( )`，这正是 `pyQuote` 要补的。
 */
import { request as nodeHttpRequest, type IncomingHttpHeaders } from 'node:http';
import { request as nodeHttpsRequest } from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';

export interface HttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** 请求体。设置后会带上 `content-length`；GET 也可以有 body。 */
  body?: string;
  /** 单次请求超时（毫秒）。 */
  timeout?: number;
  /** 网络错误 / 5xx / 429 的重试次数。 */
  retries?: number;
  /** 最大重定向跟随次数。 */
  redirects?: number;
}

export class BodianHttpError extends Error {
  readonly url: string;
  readonly status: number | undefined;
  readonly body: string | undefined;

  constructor(message: string, options: { url: string; status?: number; body?: string; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BodianHttpError';
    this.url = options.url;
    this.status = options.status;
    this.body = options.body;
  }
}

const DEFAULT_TIMEOUT = 15_000;
const DEFAULT_RETRIES = 2;
/**
 * 最大重定向跟随次数。跟随跳转时会**保留 method 与 body** —— 波点播放接口的 GET
 * body 参与签名，丢掉 body 会直接变成签名错误。
 */
const MAX_REDIRECTS = 5;

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Python `urllib.parse.quote_plus`（`safe=''`）等价实现：
 * 不编码 `A-Za-z0-9_.-~`，编码其余一切（包括 JS 默认放行的 `! * ' ( )`）。
 */
export function pyQuote(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/** Python `urllib.parse.urlencode` 等价实现（保留传入顺序）。 */
export function pyUrlencode(
  params: Iterable<readonly [string, string | number | boolean | undefined | null]>,
): string {
  const parts: string[] = [];
  for (const [key, value] of params) {
    parts.push(`${pyQuote(String(key))}=${pyQuote(value === undefined || value === null ? '' : String(value))}`);
  }
  return parts.join('&');
}

function decodeBody(buffer: Buffer, encoding: string | undefined): string {
  if (!encoding) return buffer.toString('utf8');
  switch (encoding.toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return gunzipSync(buffer).toString('utf8');
    case 'br':
      return brotliDecompressSync(buffer).toString('utf8');
    case 'deflate':
      // 有些服务端发的是裸 deflate（没有 zlib 头），两种都试。
      try {
        return inflateSync(buffer).toString('utf8');
      } catch {
        return inflateRawSync(buffer).toString('utf8');
      }
    default:
      return buffer.toString('utf8');
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const backoff = (attempt: number) => Math.min(1_000, 200 * 2 ** attempt);

async function rawRequest(url: string, options: HttpRequestOptions): Promise<HttpResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
    redirects = MAX_REDIRECTS,
  } = options;

  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BodianHttpError(`不支持的协议: ${parsed.protocol}`, { url });
  }
  const send = parsed.protocol === 'https:' ? nodeHttpsRequest : nodeHttpRequest;

  const requestHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) requestHeaders['content-length'] = String(Buffer.byteLength(body));

  return await new Promise<HttpResponse>((resolve, reject) => {
    const req = send(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port === '' ? (parsed.protocol === 'https:' ? 443 : 80) : Number(parsed.port),
        path: parsed.pathname + parsed.search,
        method,
        headers: requestHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('aborted', () => reject(new BodianHttpError(`响应被中断: ${url}`, { url })));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          const location = res.headers.location;
          if (status >= 300 && status < 400 && location && redirects > 0) {
            // 重定向继续保留 method/body：波点 API 的跳转都在 GET 上发生。
            rawRequest(new URL(location, url).toString(), { ...options, redirects: redirects - 1 }).then(resolve, reject);
            return;
          }
          try {
            resolve({ status, headers: res.headers, text: decodeBody(Buffer.concat(chunks), res.headers['content-encoding']) });
          } catch (error) {
            reject(new BodianHttpError(`响应解压失败: ${url}`, { url, status, cause: error }));
          }
        });
      },
    );

    req.setTimeout(timeout, () => {
      req.destroy(new BodianHttpError(`请求超时 (${timeout}ms): ${url}`, { url }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/**
 * 发起一次请求，带超时、重定向跟随与退避重试。
 *
 * 非 2xx **不会**抛错（由调用方决定如何处理）；只有网络层异常与可重试状态码
 * （408/425/429/5xx）才会重试，重试耗尽后抛 `BodianHttpError`。
 */
export async function httpRequest(url: string, options: HttpRequestOptions = {}): Promise<HttpResponse> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await rawRequest(url, options);
      if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
        await sleep(backoff(attempt));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      await sleep(backoff(attempt));
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new BodianHttpError(`请求失败: ${url}`, { url, cause: lastError });
}
