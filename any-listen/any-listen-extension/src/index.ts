/**
 * Any Listen · 波点音乐扩展。
 *
 * 实现的宿主钩子（必须与 `config.ts` 的 `contributes.resource[].resource` 一致）：
 *   musicSearch / musicUrl / musicLyric / musicPic
 *   songlistSearch / songlistDetail
 *
 * 两条播放通道（都经真机验证）：
 *   A. 车机通道（**匿名**，无需签名、无需 body）
 *      GET nmobi.kuwo.cn/mobi.s?type=convert_url_with_sign
 *      → 普通歌给**完整 FLAC**（实测 52.8MB、Range 可用）；VIP 歌可能只给试听片段
 *   B. 会员通道（需 uid/token；GET **带 body**，签名覆盖 body）
 *      GET bd-api.kuwo.cn/api/play/music/v2/checkRight  → status=4 表示有播放权限
 *      GET bd-api.kuwo.cn/api/play/music/v2/audioUrl    → bd-er.kuwo.cn（会员 CDN）
 *      → 给车机通道拿不到完整音频的 VIP 歌兜底
 *
 * `musicUrl` 选路：先走车机通道；若返回时长明显短于整曲（试听片段），再用会员通道。
 *
 * 其余接口：搜索 / 逐字歌词 / 封面 / 歌单，见各函数注释。
 * 注意本文件**不能**用 `Buffer` / `node:*`：扩展跑在受限 VM 里，编码一律走宿主的
 * `dataConverter`、md5 走宿主的 `utils.crypto`（见 shared/hostApi.ts）。
 */
import {
  console,
  cryptoUtils,
  dataConverter,
  registerListProviderAction,
  registerResourceAction,
  request,
} from './shared/hostApi'

const API_ORIGIN = 'https://bd-api.kuwo.cn'
const SEARCH_PATH = '/api/search/music/list'
const MUSIC_INFO_PATH = '/api/service/music/info'
const PLAYLIST_SEARCH_PATH = '/api/search/playlist/list'
const AUDIO_URL_PATH = '/api/play/music/v2/audioUrl'

/** 车机通道域名（匿名完整音质来源），主域名失败时回退。 */
const CAR_ORIGIN = 'https://nmobi.kuwo.cn'
const CAR_FALLBACK_ORIGIN = 'https://mobi.kuwo.cn'
const CAR_SOURCE = 'kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk'

const LYRIC_ORIGIN = 'https://mlyric.kuwo.cn'

/** 伪装波点 Windows 客户端（匿名即可通过校验；缺 devid/qimei36 会返回 402）。 */
const CLIENT_HEADERS: Record<string, string> = {
  'user-agent': 'Dart/3.3 (dart:io)',
  plat: 'win',
  'api-ver': 'application/json',
  channel: 'W1',
  brand: 'Windows 11 Pro for Workstations',
  net: 'wifi',
  'content-type': 'application/json',
  ver: '1.1.5',
  svrver: '13',
}

const CAR_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
  accept: '*/*',
}

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

/** 设备 id（实测必需）。 */
const DEV_ID = 'aabbccddeeff00112233445566778899'
const CAR_USER = '12345'

/**
 * 账号凭据（扫码登录所得，仅在本机使用）。
 *
 * 取得方式（PyBodian 逆向出的流程，已实测）：
 *   GET  /api/ucenter/login/qrCode       取登录码
 *   GET  /api/ucenter/login/qrCodeStatus 轮询（status=3 表示已确认）
 *   POST /api/ucenter/users/login        换取 uid/token
 *
 * 实测该账号 `isVip=1 / vipType=2`（不含无损），所以会员通道给到 320k；
 * 普通歌仍走车机通道拿 FLAC。token 失效时把 AUTH_TOKEN 置空即退回纯匿名模式。
 */
// 账号凭据从 ./credentials 导入——该文件已在 .gitignore 中排除，避免把 token 提交进仓库
import { AUTH_TOKEN, AUTH_UID } from './credentials'

/** 匿名身份。 */
const ANON_UID = '-1'
const ANON_TOKEN = ''

/** 本扩展的 source key，与 config.ts 里 `contributes.resource[].id` 保持一致。 */
const SOURCE_ID = 'wd'

/**
 * 歌单来源类型的兜底值。
 *
 * 实测两套值不一样（别写死成一个）：
 *   - 搜索结果里的歌单（songlistSearch）→ source = 4
 *   - 账号自建歌单（/api/service/playlist/userCreate）→ source = 5
 * 所以 syncId / listId 里会带 `<source>_<id>` 前缀，这里只是没有前缀时的兜底。
 */
const DEFAULT_PLAYLIST_SOURCE = '5'

/** Any Listen 音质标识 → 波点 `br` 参数（形如 `2000kflac`）。 */
const QUALITY_BR: Record<string, string> = {
  '128k': '128kmp3',
  '320k': '320kmp3',
  flac: '2000kflac',
}
const DEFAULT_BR = '2000kflac'

/** 判定「完整音频 vs 试听片段」的阈值（秒）。匿名试听实测只有 29 秒。 */
const FULL_TRACK_MIN_SECONDS = 60

interface BodianAudio {
  bitrate?: string | number
  format?: string
  level?: string
  size?: string
}

interface BodianSearchItem {
  id?: number | string
  name?: string
  songName?: string
  artist?: string
  album?: string
  albumPic?: string
  duration?: number | string
  audios?: BodianAudio[]
}

interface BodianPlaylistItem {
  id?: number | string
  source?: number | string
  sourceType?: number | string
  name?: string
  pic?: string
  desc?: string
  description?: string
  musicnum?: number | string
  musicCount?: number | string
  playnum?: number | string
  playNum?: number | string
  creator_name?: string
  creatorName?: string
}

interface BodianSearchResponse {
  code?: number
  msg?: string
  data?: { resultList?: BodianSearchItem[] }
}

interface BodianPlaylistSearchResponse {
  code?: number
  data?: { resultList?: BodianPlaylistItem[] }
}

interface BodianPlaylistMusicResponse {
  code?: number
  data?: { list?: BodianSearchItem[]; total?: number | string }
}

interface BodianPlaylistInfoResponse {
  code?: number
  data?: BodianPlaylistItem
}

interface ConvertUrlResponse {
  code?: number
  data?: { url?: string; format?: string; bitrate?: number | string; duration?: number | string }
}

interface AudioUrlResponse {
  code?: number
  data?: {
    audioHttpsUrl?: string
    audioUrl?: string
    format?: string
    bitrate?: number | string
    duration?: number | string
  }
}

interface LyricResponse {
  code?: number
  data?: { content?: string }
}

interface MusicInfoResponse {
  code?: number
  data?: { albumPic?: string; albumPic120?: string }
}

interface ResolvedUrl {
  url: string
  format: string
  bitrate: number
  duration: number
  via: 'car' | 'vip'
}

/** 秒 → `mm:ss`（Any Listen 的 `interval` 格式，例：`03:55`）。 */
function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function toText(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function requireRequest() {
  if (typeof request !== 'function') {
    throw new Error('宿主 request 不可用：请确认 config.ts 的 grant 里声明了 "internet"')
  }
  return request
}

function clientHeaders(uid: string, token: string): Record<string, string> {
  return { ...CLIENT_HEADERS, devid: DEV_ID, qimei36: DEV_ID, uid, token }
}

/**
 * md5（宿主的 `utils.crypto` 提供；VM 里没有 `node:crypto`）。
 * 兼容几种可能的宿主 API 形态，拿不到就抛错——调用方会回退到无需签名的车机通道。
 */
async function md5Hex(text: string): Promise<string> {
  const candidate = cryptoUtils as unknown as {
    createHash?: (algo: string) => { update: (d: string, enc?: string) => { digest: (enc: string) => string } }
    md5?: (text: string) => string | Promise<string>
  }

  if (candidate && typeof candidate.md5 === 'function') {
    return String(await candidate.md5(text))
  }
  if (candidate && typeof candidate.createHash === 'function') {
    return candidate.createHash('md5').update(text, 'utf-8').digest('hex')
  }
  throw new Error('宿主未提供 md5（utils.crypto）')
}

/** Python `quote_plus` 兼容：JS 的 encodeURIComponent 会漏编码 `! * ' ( )`。 */
function pyQuote(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase(),
  )
}

function pyUrlencode(params: Array<[string, string]>): string {
  return params.map(([k, v]) => `${pyQuote(String(k))}=${pyQuote(String(v))}`).join('&')
}

/** 波点签名：`md5("kuwotest" + sorted(字母数字(urlencode(params))) [+ md5(body+"kuwotest")] + path)`。 */
async function bodianSign(path: string, params: Array<[string, string]>, bodyText = ''): Promise<string> {
  const encoded = pyUrlencode(params)
  const alnum = [...encoded].filter((ch) => /[A-Za-z0-9]/.test(ch)).sort().join('')
  let seed = 'kuwotest' + alnum
  if (bodyText) seed += await md5Hex(bodyText + 'kuwotest')
  return md5Hex(seed + path)
}

/**
 * 带签名的 GET（**允许带 body**）——会员通道要求的调用形态。
 *
 * 换成 POST 会得到 `500 Service error`；宿主 RequestOptions 里的 `text` 字段用于传原始 body。
 */
async function signedGet<T>(
  path: string,
  entries: Array<[string, string]>,
  bodyText: string,
  uid: string,
  token: string,
): Promise<T> {
  const send = requireRequest()
  const params: Array<[string, string]> = [...entries]
  const sign = await bodianSign(path, params, bodyText)
  params.push(['sign', sign])

  const response = await send(`${API_ORIGIN}${path}?${pyUrlencode(params)}`, {
    method: 'GET',
    headers: clientHeaders(uid, token),
    text: bodyText,
    timeout: 20_000,
  })

  return response.body as T
}

/** 搜索歌曲。 */
async function searchBodian(keyword: string, page: number, pageSize: number): Promise<BodianSearchItem[]> {
  const send = requireRequest()

  const response = await send(`${API_ORIGIN}${SEARCH_PATH}`, {
    method: 'GET',
    query: {
      pn: String(Math.max(0, page - 1)),
      rn: String(pageSize),
      keyword,
      correct: '1',
      uid: ANON_UID,
      token: ANON_TOKEN,
    },
    headers: clientHeaders(ANON_UID, ANON_TOKEN),
    timeout: 15_000,
  })

  const body = response.body as BodianSearchResponse | undefined
  if (!body || body.code !== 200) {
    throw new Error(`波点搜索失败: code=${body?.code ?? 'N/A'} msg=${body?.msg ?? ''}`)
  }

  return body.data?.resultList ?? []
}

/** 搜索歌单（参数名是 `keyword`，不是 `key`）。 */
async function searchPlaylists(keyword: string, page: number, pageSize: number): Promise<BodianPlaylistItem[]> {
  const send = requireRequest()

  const response = await send(`${API_ORIGIN}${PLAYLIST_SEARCH_PATH}`, {
    method: 'GET',
    query: {
      keyword,
      pn: String(Math.max(0, page - 1)),
      rn: String(pageSize),
      uid: ANON_UID,
      token: ANON_TOKEN,
    },
    headers: clientHeaders(ANON_UID, ANON_TOKEN),
    timeout: 15_000,
  })

  const body = response.body as BodianPlaylistSearchResponse | undefined
  if (!body || body.code !== 200) {
    throw new Error(`波点歌单搜索失败: code=${body?.code ?? 'N/A'}`)
  }

  return body.data?.resultList ?? []
}

/** 取歌单曲目（这个接口的 `pn` 从 1 开始）。 */
async function fetchPlaylistTracks(
  source: string,
  id: string,
  page: number,
  pageSize: number,
): Promise<{ list: BodianSearchItem[]; total: number }> {
  const send = requireRequest()

  const response = await send(`${API_ORIGIN}/api/service/playlist/${id}/musicList`, {
    method: 'GET',
    query: {
      source,
      pn: String(Math.max(1, page)),
      rn: String(pageSize),
      uid: ANON_UID,
      token: ANON_TOKEN,
    },
    headers: clientHeaders(ANON_UID, ANON_TOKEN),
    timeout: 20_000,
  })

  const body = response.body as BodianPlaylistMusicResponse | undefined
  if (!body || body.code !== 200) {
    throw new Error(`波点歌单曲目失败: code=${body?.code ?? 'N/A'} id=${id} source=${source}`)
  }

  const list = body.data?.list ?? []
  return { list, total: Number(body.data?.total ?? list.length) }
}

/** 取歌单元数据。 */
async function fetchPlaylistInfo(source: string, id: string): Promise<BodianPlaylistItem> {
  const send = requireRequest()

  const response = await send(`${API_ORIGIN}/api/service/playlist/info/${id}`, {
    method: 'GET',
    query: { source, uid: ANON_UID, token: ANON_TOKEN },
    headers: clientHeaders(ANON_UID, ANON_TOKEN),
    timeout: 15_000,
  })

  const body = response.body as BodianPlaylistInfoResponse | undefined
  if (!body || body.code !== 200) return {}
  return body.data ?? {}
}

/** 通道 A：车机（匿名、无需签名、无需 body）。 */
async function resolveCarUrl(musicId: string, br: string): Promise<ResolvedUrl> {
  const send = requireRequest()
  const origins = [CAR_ORIGIN, CAR_FALLBACK_ORIGIN]
  let lastError: unknown

  for (const origin of origins) {
    try {
      const response = await send(`${origin}/mobi.s`, {
        method: 'GET',
        query: {
          f: 'web',
          source: CAR_SOURCE,
          type: 'convert_url_with_sign',
          rid: musicId,
          br,
          user: CAR_USER,
          loginUid: CAR_USER,
        },
        headers: CAR_HEADERS,
        timeout: 20_000,
      })

      const body = response.body as ConvertUrlResponse | undefined
      const url = toText(body?.data?.url)
      if (url) {
        return {
          url,
          format: toText(body?.data?.format),
          bitrate: Number(body?.data?.bitrate ?? 0),
          duration: Number(body?.data?.duration ?? 0),
          via: 'car',
        }
      }
      lastError = new Error(`响应里没有 url @ ${origin}`)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`车机通道无法解析: ${musicId}`)
}

/** 通道 B：会员（GET 带 body + 签名）。 */
async function resolveVipUrl(musicId: string, format: string, br: string): Promise<ResolvedUrl> {
  const bodyText = JSON.stringify({ devId: DEV_ID, musicId, format, br, freeSign: '' })

  const response = await signedGet<AudioUrlResponse>(
    AUDIO_URL_PATH,
    [
      ['uid', AUTH_UID],
      ['token', AUTH_TOKEN],
      ['timestamp', String(Date.now())],
      ['devId', DEV_ID],
      ['musicId', musicId],
      ['format', format],
      ['br', br],
      ['freeSign', ''],
    ],
    bodyText,
    AUTH_UID,
    AUTH_TOKEN,
  )

  const url = toText(response?.data?.audioHttpsUrl) || toText(response?.data?.audioUrl)
  if (!url) throw new Error(`会员通道没有返回 URL: code=${response?.code ?? 'N/A'}`)

  return {
    url,
    format: toText(response?.data?.format),
    bitrate: Number(response?.data?.bitrate ?? 0),
    duration: Number(response?.data?.duration ?? 0),
    via: 'vip',
  }
}

/** 拉取逐字歌词原文（`[00:00.000]<1120,-1120>晴<2400,160>天`）。 */
async function fetchVerbatimLyric(musicId: string): Promise<string> {
  const send = requireRequest()
  const inner = `type=lyric&req=2&lrcx=1&rid=${musicId}&songname=&artist=&corp=kuwo&fromchannel=bodian`
  const q = String(await dataConverter(inner, 'utf-8', 'base64'))

  const response = await send(`${LYRIC_ORIGIN}/mobi.s`, {
    method: 'GET',
    query: { f: 'bodian', q, uid: ANON_UID, token: ANON_TOKEN },
    headers: { 'user-agent': MOBILE_UA },
    timeout: 15_000,
  })

  const body = response.body as LyricResponse | undefined
  const content = toText(body?.data?.content)
  if (!content) return ''

  return String(await dataConverter(content, 'base64', 'utf-8'))
}

/**
 * 把酷我的逐字歌词规范化成 Any Listen 认得的格式。
 *
 * 为什么必须做：Any Listen 校验逐字歌词用的是
 *   `/(?:^|\s*)\[\d+:\d+(?:\.\d+)]<\d+,\d+>.+$/m`
 * —— `<\d+,\d+>` **只接受正整数**。而酷我原始格式的第二项常常是负数：
 *   `[00:00.000]<1120,-1120>晴<2400,160>天`
 * 负号不匹配 `\d+`，整首逐字歌词会被判为无效，标记遂以纯文本漏到界面上（表现为歌词里出现 `<4788>`）。
 *
 * 处理方式：逐行取出每个字的起始时间，用「下一个字起始时间 − 当前字起始时间」重算持续时长
 * （行末字给一个保守值），从而保证所有数字非负。
 */
function normalizeAwlyric(raw: string): string {
  const out: string[] = []

  for (const line of raw.split('\n')) {
    const head = /^(\[\d+:\d+(?:\.\d+)?\])/.exec(line)
    if (!head) {
      out.push(line)
      continue
    }

    const tag = head[1] ?? ''
    const body = line.slice(head[0].length)
    const words: Array<{ start: number; text: string }> = []
    const wordRxp = /<(\d+),(-?\d+)>([^<]*)/g

    let matched: RegExpExecArray | null
    while ((matched = wordRxp.exec(body)) !== null) {
      words.push({ start: Number(matched[1] ?? 0), text: matched[3] ?? '' })
    }

    if (words.length === 0) {
      out.push(line)
      continue
    }

    const rebuilt = words
      .map((word, index) => {
        const next = words[index + 1]
        const duration = next ? Math.max(1, next.start - word.start) : 500
        return `<${word.start},${duration}>${word.text}`
      })
      .join('')

    out.push(tag + rebuilt)
  }

  return out.join('\n')
}

/** 去掉所有逐字时间标记，得到普通 LRC。 */
function stripWordMarks(text: string): string {
  return text.replace(/<[^>]*>/g, '')
}

/** 由实际音频信息反推 Any Listen 音质标识。 */
function qualityFromAudio(format: string, bitrate: number, fallback: string): string {
  if (format === 'flac') return 'flac'
  if (format === 'mp3') return bitrate >= 320 ? '320k' : '128k'
  return fallback
}

/**
 * 从波点 `audios[]` 构造 Any Listen 要求的 `meta.qualitys`。
 *
 * 这个字段是**必需的**：宿主会逐条校验搜索结果，`qualitys` 为 null/空会把整条结果丢掉
 * （实测日志：`verify music search array item error ... meta.qualitys is null`）。
 *
 * 只保留能直接播放的三档；`mflac`/`mgg`/`zp` 是 DRM 加密容器，ogg/aac 在 Any Listen
 * 侧没有对应档位，一律不列。若某首歌一条都不匹配，则兜底给三档空 size，避免结果被丢弃。
 */
function buildQualitys(item: BodianSearchItem): AnyListen.Music.MusicQualityType {
  const qualitys: AnyListen.Music.MusicQualityType = {}

  for (const audio of item.audios ?? []) {
    const format = String(audio.format ?? '').toLowerCase()
    const bitrate = Number(audio.bitrate ?? 0)
    const sizeStr = audio.size ? String(audio.size) : null

    if (format === 'mp3' && bitrate === 128) qualitys['128k'] = { sizeStr }
    else if (format === 'mp3' && bitrate === 320) qualitys['320k'] = { sizeStr }
    else if (format === 'flac' && bitrate === 2000) qualitys.flac = { sizeStr }
  }

  if (Object.keys(qualitys).length === 0) {
    qualitys['128k'] = { sizeStr: null }
    qualitys['320k'] = { sizeStr: null }
    qualitys.flac = { sizeStr: null }
  }

  return qualitys
}

/** 波点结果 → Any Listen 的 MusicInfoOnline。 */
function toMusicInfoOnline(item: BodianSearchItem): AnyListen.Music.MusicInfoOnline {
  const musicId = toText(item.id)
  const now = Date.now()

  return {
    id: musicId,
    name: toText(item.name) || toText(item.songName),
    singer: toText(item.artist),
    interval: formatInterval(Number(item.duration ?? 0)),
    isLocal: false,
    meta: {
      musicId,
      albumName: toText(item.album),
      picUrl: toText(item.albumPic) || null,
      source: SOURCE_ID,
      qualitys: buildQualitys(item),
      createTime: now,
      updateTime: now,
      posTime: now,
    },
  }
}

/**
 * 把波点歌单的 `source` 编进 Any Listen 的列表 id。
 *
 * 原因：宿主只会把 `songlistDetail` 的 `id` 原样回传，而波点查歌单曲目**必须**带 `source`，
 * 所以用 `<source>_<id>` 的形式携带；解析时兼容纯数字 id（回退到默认 source）。
 */
function encodeListId(source: string, id: string): string {
  return `${source}_${id}`
}

function decodeListId(encoded: string): { source: string; id: string } {
  const matched = /^(\d+)_(\d+)$/.exec(encoded)
  if (matched) return { source: matched[1] ?? DEFAULT_PLAYLIST_SOURCE, id: matched[2] ?? encoded }
  return { source: DEFAULT_PLAYLIST_SOURCE, id: encoded }
}

/** 波点歌单 → Any Listen 的 SongListItem。 */
function toSongListItem(item: BodianPlaylistItem): AnyListen.Resource.SongListItem {
  const source = toText(item.source ?? item.sourceType) || DEFAULT_PLAYLIST_SOURCE
  const id = toText(item.id)

  return {
    id: encodeListId(source, id),
    name: toText(item.name),
    play_count: toText(item.playnum ?? item.playNum),
    author: toText(item.creator_name ?? item.creatorName),
    img: toText(item.pic),
    desc: toText(item.desc ?? item.description) || null,
    total: Number(item.musicnum ?? item.musicCount ?? 0),
  }
}

registerResourceAction({
  musicSearch: async (params) => {
    const page = params.page || 1
    const limit = params.limit && params.limit > 0 ? params.limit : 20
    const keyword = [params.name, params.artist].filter((v) => !!v && v.trim() !== '').join(' ').trim()

    console.log(`[bodian] musicSearch keyword="${keyword}" page=${page} limit=${limit}`)

    const items = await searchBodian(keyword, page, limit)
    const list = items.map(toMusicInfoOnline)

    console.log(
      `[bodian] musicSearch 返回 ${list.length} 条，首条: ${list[0]?.name ?? '(空)'}，qualitys=${JSON.stringify(list[0]?.meta.qualitys ?? null)}`,
    )

    return { list, total: list.length, page, limit }
  },

  musicUrl: async (params) => {
    const musicId = params.musicInfo.meta.musicId
    const requested = params.quality ?? 'flac'
    const br = QUALITY_BR[requested] ?? DEFAULT_BR

    console.log(`[bodian] musicUrl musicId=${musicId} requested=${requested} br=${br}`)

    // 先走车机通道（匿名即可，普通歌能拿完整 FLAC）
    try {
      const car = await resolveCarUrl(musicId, br)
      const isFull = car.duration <= 0 || car.duration >= FULL_TRACK_MIN_SECONDS
      console.log(
        `[bodian] 车机通道: ${car.format}/${car.bitrate}kbps duration=${car.duration}s 完整=${isFull}`,
      )
      if (isFull) {
        return { url: car.url, quality: qualityFromAudio(car.format, car.bitrate, requested) }
      }
    } catch (error) {
      console.log(`[bodian] 车机通道失败: ${error instanceof Error ? error.message : String(error)}`)
    }

    // 车机通道只给了试听片段（VIP 歌）→ 会员通道兜底
    if (AUTH_TOKEN) {
      const fmt = (QUALITY_BR[requested] ?? DEFAULT_BR).endsWith('flac') ? 'flac' : 'mp3'
      try {
        const vip = await resolveVipUrl(musicId, fmt, br)
        console.log(
          `[bodian] 会员通道: ${vip.format}/${vip.bitrate}kbps duration=${vip.duration}s host=${vip.url.split('/')[2] ?? ''}`,
        )
        return { url: vip.url, quality: qualityFromAudio(vip.format, vip.bitrate, requested) }
      } catch (error) {
        console.log(`[bodian] 会员通道失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    throw new Error(`两条通道都无法解析播放地址: ${musicId}`)
  },

  musicLyric: async (params) => {
    const info = params.musicInfo
    const musicId = info.meta.musicId

    console.log(`[bodian] musicLyric musicId=${musicId}`)

    const verbatim = await fetchVerbatimLyric(musicId)
    // 酷我的 `<开始,-持续>` 含负号，而 Any Listen 只认 `<\d+,\d+>`，必须先规范化
    const awlyric = normalizeAwlyric(verbatim)
    const lyric = stripWordMarks(awlyric)

    console.log(
      `[bodian] musicLyric 原始=${verbatim.length} 规范化后=${awlyric.length} 通过校验=${/(?:^|\s*)\[\d+:\d+(?:\.\d+)?\]<\d+,\d+>/.test(awlyric)}`,
    )

    return {
      lyric,
      awlyric: awlyric || null,
      name: info.name,
      singer: info.singer,
      interval: info.interval,
    }
  },

  musicPic: async (params) => {
    const info = params.musicInfo
    if (info.meta.picUrl) return info.meta.picUrl

    const send = requireRequest()
    const response = await send(`${API_ORIGIN}${MUSIC_INFO_PATH}`, {
      method: 'GET',
      query: { musicId: info.meta.musicId, uid: ANON_UID, token: ANON_TOKEN },
      headers: clientHeaders(ANON_UID, ANON_TOKEN),
      timeout: 15_000,
    })

    const body = response.body as MusicInfoResponse | undefined
    return toText(body?.data?.albumPic) || toText(body?.data?.albumPic120)
  },

  songlistSearch: async (params) => {
    const page = params.page || 1
    const limit = params.limit && params.limit > 0 ? params.limit : 20

    console.log(`[bodian] songlistSearch keyword="${params.keyword}" page=${page} limit=${limit}`)

    const items = await searchPlaylists(params.keyword, page, limit)
    const list = items.map(toSongListItem)

    console.log(
      `[bodian] songlistSearch 返回 ${list.length} 个歌单，首个: ${list[0]?.name ?? '(空)'} (${list[0]?.total ?? 0} 首)`,
    )

    return { list, total: list.length, page, limit }
  },

  songlistDetail: async (params) => {
    const { source, id } = decodeListId(String(params.id))
    const page = params.page || 1
    const limit = params.limit && params.limit > 0 ? params.limit : 100

    console.log(`[bodian] songlistDetail id=${id} source=${source} page=${page} limit=${limit}`)

    // 波点单页有条数上限，宿主可能一次要很多首（limit=10000），所以这里自己分页拉全。
    const perPage = 100
    const wanted = Math.min(limit, 1000)
    const collected: BodianSearchItem[] = []
    let total = 0

    for (let p = page; p <= page + 20; p += 1) {
      const chunk = await fetchPlaylistTracks(source, id, p, perPage)
      total = chunk.total
      if (chunk.list.length === 0) break
      collected.push(...chunk.list)
      if (collected.length >= wanted || collected.length >= total) break
    }

    const detail = await fetchPlaylistInfo(source, id)
    const list = collected.slice(0, wanted).map(toMusicInfoOnline)

    console.log(`[bodian] songlistDetail 返回 ${list.length}/${total} 首，歌单名: ${toText(detail.name)}`)

    return {
      list,
      total,
      page,
      limit,
      info: {
        name: toText(detail.name),
        img: toText(detail.pic),
        desc: toText(detail.desc ?? detail.description),
        author: toText(detail.creatorName ?? detail.creator_name),
        play_count: toText(detail.playNum ?? detail.playnum),
      },
    }
  },
})

/**
 * 「列表提供者」（listProvider）实现。
 *
 * Any Listen 的「我的列表 → 远程歌单」由它供数：用户在客户端里添加一个远程歌单
 * （带 extensionId + source + syncId）后，宿主会回调这里要「歌曲 id 列表」和「歌曲详情」。
 *
 * 对应波点接口（均已用登录态实测）：
 *   歌单曲目 GET /api/service/playlist/{id}/musicList?source=&pn=1&rn=100
 *   我创建的 GET /api/service/playlist/userCreate?userId=
 *   我收藏的 GET /api/service/collect/4/list?userId=&fromUid=&pn=&rn=
 */
async function listMusicIds(listRef: string): Promise<string[]> {
  const { source, id } = decodeListId(listRef)
  const ids: string[] = []

  for (let page = 1; page <= 20; page += 1) {
    const tracks = await fetchPlaylistTracks(source, id, page, 100)
    if (tracks.list.length === 0) break
    for (const item of tracks.list) ids.push(toText(item.id))
    if (ids.length >= tracks.total) break
  }

  return ids
}

/** 取账号自带的歌单（我创建的 / 我收藏的），仅用于日志核对。 */
async function fetchMyPlaylists(): Promise<{ created: BodianPlaylistItem[]; collected: BodianPlaylistItem[] }> {
  const send = requireRequest()

  const safe = async (path: string, query: Record<string, string>): Promise<BodianPlaylistItem[]> => {
    try {
      const response = await send(`${API_ORIGIN}${path}`, {
        method: 'GET',
        query: { ...query, uid: AUTH_UID, token: AUTH_TOKEN },
        headers: clientHeaders(AUTH_UID, AUTH_TOKEN),
        timeout: 20_000,
      })
      const body = response.body as { data?: { playLists?: BodianPlaylistItem[] } } | undefined
      return body?.data?.playLists ?? []
    } catch {
      return []
    }
  }

  const [created, collected] = await Promise.all([
    safe('/api/service/playlist/userCreate', { userId: AUTH_UID }),
    safe('/api/service/collect/4/list', { userId: AUTH_UID, fromUid: AUTH_UID, pn: '1', rn: '200' }),
  ])

  return { created, collected }
}

if (typeof registerListProviderAction === 'function' && AUTH_TOKEN) {
  registerListProviderAction({
    getListMusicIds: async ({ data }) => {
      const syncId = toText((data as { syncId?: string } | undefined)?.syncId)
      console.log(`[bodian] getListMusicIds syncId=${syncId}`)
      try {
        const ids = await listMusicIds(syncId)
        console.log(`[bodian] getListMusicIds 返回 ${ids.length} 个 id`)
        return ids
      } catch (error) {
        console.log(`[bodian] getListMusicIds 失败: ${error instanceof Error ? error.message : String(error)}`)
        return []
      }
    },

    getMusicInfoByIds: async ({ data }) => {
      const payload = data as { ids?: string[]; list?: { syncId?: string } } | undefined
      const ids = payload?.ids ?? []
      const syncId = toText(payload?.list?.syncId)
      console.log(`[bodian] getMusicInfoByIds syncId=${syncId} 请求 ${ids.length} 首`)

      try {
        const { source, id } = decodeListId(syncId)
        const want = new Set(ids)
        const musics: AnyListen.Music.MusicInfoOnline[] = []

        for (let page = 1; page <= 20 && musics.length < ids.length; page += 1) {
          const tracks = await fetchPlaylistTracks(source, id, page, 100)
          if (tracks.list.length === 0) break
          for (const item of tracks.list) {
            if (want.has(toText(item.id))) musics.push(toMusicInfoOnline(item))
          }
        }

        console.log(`[bodian] getMusicInfoByIds 返回 ${musics.length} 首`)
        return { musics }
      } catch (error) {
        console.log(`[bodian] getMusicInfoByIds 失败: ${error instanceof Error ? error.message : String(error)}`)
        return { musics: [] }
      }
    },
  })

  // 顺带把账号里的歌单打进日志：远程歌单需要用户在客户端里指定 syncId（= 歌单 id）
  void fetchMyPlaylists()
    .then(({ created, collected }) => {
      console.log(`[bodian] 账号歌单：我创建的 ${created.length} 个，我收藏的 ${collected.length} 个`)
      for (const item of created.slice(0, 40)) console.log(`[bodian]   创建 ${item.name} (id=${item.id})`)
      for (const item of collected.slice(0, 40)) console.log(`[bodian]   收藏 ${item.name} (id=${item.id})`)
    })
    .catch(() => {})

  console.log('[bodian] 已注册 listProvider（供「我的列表 → 远程歌单」使用）')
}

console.log(
  `[bodian] 波点音乐扩展已注册 musicSearch/musicUrl/musicLyric/musicPic/songlistSearch/songlistDetail（source=${SOURCE_ID}，账号=${AUTH_TOKEN ? AUTH_UID : '匿名'}）`,
)
