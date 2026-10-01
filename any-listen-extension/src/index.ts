/**
 * Any Listen · 波点音乐扩展。
 *
 * 实现的宿主钩子（必须与 `config.ts` 的 `contributes.resource[].resource` 一致）：
 *   musicSearch / musicUrl / musicLyric / musicPic
 *   songlistSearch / songlistDetail
 *
 * 全部走**匿名**波点接口（真机验证见 ../bodian 仓库的 verify 输出）：
 *   搜索     GET bd-api.kuwo.cn/api/search/music/list   （pn 从 0 开始；缺 devid 头会 402）
 *   播放地址 GET nmobi.kuwo.cn/mobi.s?type=convert_url_with_sign
 *            ↑ 匿名即可拿**完整音质**（FLAC 整曲、支持 Range），且**无需签名/无需 body**
 *   逐字歌词 GET mlyric.kuwo.cn/mobi.s?f=bodian （返回 base64 的逐字歌词）
 *   封面     meta.picUrl，缺失时回退 GET bd-api.kuwo.cn/api/service/music/info
 *   歌单搜索 GET bd-api.kuwo.cn/api/search/playlist/list?keyword=（注意是 keyword 不是 key）
 *   歌单曲目 GET bd-api.kuwo.cn/api/service/playlist/{id}/musicList?source=（pn 从 1 开始）
 *   歌单信息 GET bd-api.kuwo.cn/api/service/playlist/info/{id}?source=
 *
 * 注意本文件**不能**用 `Buffer` / `node:*`：扩展跑在受限 VM 里，编码一律走宿主的
 * `dataConverter`（见 shared/hostApi.ts 的说明）。
 */
import { console, dataConverter, registerResourceAction, request } from './shared/hostApi'

const API_ORIGIN = 'https://bd-api.kuwo.cn'
const SEARCH_PATH = '/api/search/music/list'
const MUSIC_INFO_PATH = '/api/service/music/info'
const PLAYLIST_SEARCH_PATH = '/api/search/playlist/list'

/** 车机通道域名（完整的匿名音质来源），主域名失败时回退。 */
const CAR_ORIGIN = 'https://nmobi.kuwo.cn'
const CAR_FALLBACK_ORIGIN = 'https://mobi.kuwo.cn'
const CAR_SOURCE = 'kwplayercar_ar_6.0.0.9_B_jiakong_vh.apk'

const LYRIC_ORIGIN = 'https://mlyric.kuwo.cn'

/** 伪装波点 Windows 客户端（匿名即可通过校验）。 */
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

/** 匿名身份：`uid=-1`、空 token，外加一个实测可用的固定设备 id。 */
const ANON_UID = '-1'
const ANON_TOKEN = ''
const DEV_ID = 'aabbccddeeff00112233445566778899'
const CAR_USER = '12345'

/** 本扩展的 source key，与 config.ts 里 `contributes.resource[].id` 保持一致。 */
const SOURCE_ID = 'wd'

/** 歌单来源类型的兜底值（实测歌单搜索返回的 source 就是 4）。 */
const DEFAULT_PLAYLIST_SOURCE = '4'

/** Any Listen 音质标识 → 波点 `br` 参数（形如 `2000kflac`）。 */
const QUALITY_BR: Record<string, string> = {
  '128k': '128kmp3',
  '320k': '320kmp3',
  flac: '2000kflac',
}
const DEFAULT_BR = '2000kflac'

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

interface LyricResponse {
  code?: number
  data?: { content?: string }
}

interface MusicInfoResponse {
  code?: number
  data?: { albumPic?: string; albumPic120?: string }
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

function clientHeaders(): Record<string, string> {
  return { ...CLIENT_HEADERS, devid: DEV_ID, qimei36: DEV_ID }
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

/** 调波点搜索接口，返回原始结果列表。 */
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
    headers: clientHeaders(),
    timeout: 15_000,
  })

  const body = response.body as BodianSearchResponse | undefined
  if (!body || body.code !== 200) {
    throw new Error(`波点搜索失败: code=${body?.code ?? 'N/A'} msg=${body?.msg ?? ''}`)
  }

  return body.data?.resultList ?? []
}

/** 搜索波点歌单。 */
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
    headers: clientHeaders(),
    timeout: 15_000,
  })

  const body = response.body as BodianPlaylistSearchResponse | undefined
  if (!body || body.code !== 200) {
    throw new Error(`波点歌单搜索失败: code=${body?.code ?? 'N/A'}`)
  }

  return body.data?.resultList ?? []
}

/** 取歌单曲目（注意：波点这个接口的 `pn` 从 1 开始）。 */
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
    headers: clientHeaders(),
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
    headers: clientHeaders(),
    timeout: 15_000,
  })

  const body = response.body as BodianPlaylistInfoResponse | undefined
  if (!body || body.code !== 200) return {}
  return body.data ?? {}
}

/** 通过车机通道解析播放地址（匿名、无需签名、无需 body）。 */
async function resolveMusicUrl(
  musicId: string,
  br: string,
): Promise<{ url: string; format: string; bitrate: number }> {
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
        return { url, format: toText(body?.data?.format), bitrate: Number(body?.data?.bitrate ?? 0) }
      }
      lastError = new Error(`响应里没有 url @ ${origin}`)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`无法解析播放地址: ${musicId}`)
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

/** 由实际音频信息反推 Any Listen 音质标识。 */
function qualityFromAudio(format: string, bitrate: number, fallback: string): string {
  if (format === 'flac') return 'flac'
  if (format === 'mp3') return bitrate >= 320 ? '320k' : '128k'
  return fallback
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

    const result = await resolveMusicUrl(musicId, br)
    const actualQuality = qualityFromAudio(result.format, result.bitrate, requested)

    console.log(
      `[bodian] musicUrl 解析成功: ${result.format}/${result.bitrate}kbps → quality=${actualQuality} host=${result.url.split('/')[2] ?? ''}`,
    )

    return { url: result.url, quality: actualQuality }
  },

  musicLyric: async (params) => {
    const info = params.musicInfo
    const musicId = info.meta.musicId

    console.log(`[bodian] musicLyric musicId=${musicId}`)

    const verbatim = await fetchVerbatimLyric(musicId)
    // 去掉逐字时间标记即为普通 LRC；原文（含标记）就是 Any Listen 的 awlyric 格式
    const lyric = verbatim.replace(/<-?\d+,-?\d+>/g, '')

    console.log(`[bodian] musicLyric 逐字=${verbatim.includes('<') && verbatim.includes(',')} 长度=${verbatim.length}`)

    return {
      lyric,
      awlyric: verbatim || null,
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
      headers: clientHeaders(),
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

    console.log(`[bodian] songlistSearch 返回 ${list.length} 个歌单，首个: ${list[0]?.name ?? '(空)'} (${list[0]?.total ?? 0} 首)`)

    return { list, total: list.length, page, limit }
  },

  songlistDetail: async (params) => {
    const { source, id } = decodeListId(String(params.id))
    const page = params.page || 1
    const limit = params.limit && params.limit > 0 ? params.limit : 100

    console.log(`[bodian] songlistDetail id=${id} source=${source} page=${page} limit=${limit}`)

    const [tracks, detail] = await Promise.all([
      fetchPlaylistTracks(source, id, page, limit),
      fetchPlaylistInfo(source, id),
    ])
    const list = tracks.list.map(toMusicInfoOnline)

    console.log(`[bodian] songlistDetail 返回 ${list.length}/${tracks.total} 首，歌单名: ${toText(detail.name)}`)

    return {
      list,
      total: tracks.total,
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

console.log(
  `[bodian] 波点音乐扩展已注册 musicSearch/musicUrl/musicLyric/musicPic/songlistSearch/songlistDetail（source=${SOURCE_ID}）`,
)
