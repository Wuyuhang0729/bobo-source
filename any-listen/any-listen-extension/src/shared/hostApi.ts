/**
 * 扩展宿主 API 桥接。
 *
 * 扩展**不在**自由 Node 环境里运行 —— Any Listen 把它放进一个受限 VM
 * （服务端 `server/extension-preload.js`）：
 *
 *   globalThis.require = (moduleName) => {...}   // 只放行宿主模块
 *   globalThis.setTimeout / setInterval          // 走 IPC
 *   globalThis.eval / Function                   // 被替换
 *   freezeObjectProperty(globalThis)             // 全局冻结
 *
 * 所以这里**不能**引入任何依赖 `node:https` / `node:crypto` / `Buffer` 的实现：
 * 网络走 `request`，base64/编码走 `dataConverter`，哈希走 `crypto`。
 *
 * 另外 `request` 只有声明了 `grant: ['internet']` 的扩展才拿得到
 * （服务端 `createRequest()` 里那句 `if (extension.grant.includes("internet"))`）。
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = require('any-listen') as AnyListenHostApi

type ConverterFormatFrom = 'base64' | 'hex' | 'utf-8'
type ConverterFormatTo = 'binary' | 'base64' | 'hex' | 'utf-8'

export interface AnyListenHostApi {
  registerResourceAction: (actions: Partial<AnyListen_API.ResourceAction>) => void
  request?: (
    url: string,
    options?: AnyListen_API.RequestOptions,
  ) => Promise<AnyListen_API.Response<unknown>>
  logcat: {
    debug: (...args: unknown[]) => void
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }
  env: { version: string }
  t: (key: string, vals?: Record<string, unknown>) => string
  utils: {
    crypto: AnyListen_API.Crypto
    dataConverter: {
      (input: string, fromEncoding?: ConverterFormatFrom, toEncoding?: ConverterFormatTo): Promise<
        string | Uint8Array
      >
      (input: Uint8Array, toEncoding?: ConverterFormatTo): Promise<string | Uint8Array>
    }
    iconv: unknown
    zlib: unknown
  }
}

/** 用宿主的 logcat 取代全局 console —— 输出会落到 `data/logs/extension.log`。 */
export const console = {
  log: (...args: unknown[]) => api.logcat.info(...args),
  info: (...args: unknown[]) => api.logcat.info(...args),
  warn: (...args: unknown[]) => api.logcat.warn(...args),
  error: (...args: unknown[]) => api.logcat.error(...args),
}

export const version = api.env.version
export const registerResourceAction = api.registerResourceAction

/**
 * 注册「列表提供者」：让扩展为「我的列表」里的**远程歌单**供数。
 * 需要 config.ts 里声明 `grant: ['internet', 'music_list']`。
 */
export const registerListProviderAction = (
  api as { registerListProviderAction?: (actions: Partial<AnyListen_API.ListProviderAction>) => void }
).registerListProviderAction
export const t = api.t
export const cryptoUtils = api.utils.crypto

/** 宿主 HTTP 客户端：请求实际由宿主进程发出，所以不存在 CORS 问题。 */
export const request = api.request

/**
 * 编码转换（**异步**）。VM 里没有 `Buffer` / `btoa`，base64 编解码只能走它：
 *
 * - 编码：`await dataConverter(str, 'utf-8', 'base64')`
 * - 解码：`await dataConverter(b64, 'base64', 'utf-8')`
 */
export const dataConverter = api.utils.dataConverter
