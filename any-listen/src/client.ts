/**
 * `BodianClient` —— 本库的对外门面。
 *
 * 第一版覆盖四个能力（对应方案里的阶段 1）：搜索、播放地址、歌词、歌单。
 * 全部匿名可用，不需要登录；`uid` / `token` 选项是为后续接账号预留的。
 */
import { randomBytes } from 'node:crypto';

import {
  audioUrl as apiAudioUrl,
  checkRight as apiCheckRight,
  convertUrl as apiConvertUrl,
  lyric as apiLyric,
  mobileSongInfo,
  musicInfo as apiMusicInfo,
  playlistInfo as apiPlaylistInfo,
  playlistMusicList as apiPlaylistMusicList,
  searchMusic,
  searchPlaylists,
  type ApiContext,
} from './api.js';
import { formatInterval, formatLrcTime, qualityFromAudio, stripVerbatimMarks } from './format.js';
import { normalizePlaylistBrief, normalizeSong, parsePlaylistRef, toNumber, toText } from './normalize.js';
import { QUALITY_ORDER, QUALITY_SPECS } from './qualities.js';
import type {
  BodianAuth,
  BodianPlaylist,
  BodianPlaylistBrief,
  BodianSong,
  LyricResult,
  MusicUrlResult,
  Quality,
} from './types.js';

export interface BodianClientOptions {
  /** 匿名传 `-1`（默认）。 */
  uid?: string;
  /** 匿名传空串（默认）。第一版不实现登录流程。 */
  token?: string;
  /** 设备 id；缺省时随机生成一次并在实例内复用。 */
  devId?: string;
  /** 单次请求超时（毫秒），默认 15000。 */
  timeout?: number;
  /** 网络错误 / 5xx 重试次数，默认 2。 */
  retries?: number;
  /** 搜索默认每页条数，默认 20。 */
  pageSize?: number;
}

export interface SearchOptions {
  page?: number;
  pageSize?: number;
}

export interface MusicUrlOptions {
  /** 目标音质，默认 `flac`。 */
  quality?: Quality;
  /**
   * 目标音质拿不到时是否自动降级（默认 `true`）。降级顺序：flac → 320k → 128k。
   */
  fallback?: boolean;
}

export interface GetPlaylistOptions {
  /** 歌单来源类型。缺省时用链接里的 `source`，再缺省为 `4`。 */
  source?: string;
  /** 最多取多少首，默认 300（防止超大歌单一次拉爆）。 */
  limit?: number;
}

/** 歌单曲目的分页大小，波点接口允许到 100。 */
const PLAYLIST_PAGE_SIZE = 100;
/** 歌单分页的硬上限，避免异常响应导致死循环。 */
const PLAYLIST_MAX_PAGES = 50;

export class BodianClient {
  readonly auth: Required<BodianAuth>;

  private readonly ctx: ApiContext;
  private readonly pageSize: number;

  constructor(options: BodianClientOptions = {}) {
    const devId = options.devId ?? randomBytes(16).toString('hex');
    const uid = options.uid ?? '-1';
    const token = options.token ?? '';

    this.auth = { uid, token, devId };
    this.ctx = {
      uid,
      token,
      devId,
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
      ...(options.retries !== undefined ? { retries: options.retries } : {}),
    };
    this.pageSize = options.pageSize ?? 20;
  }

  /** 当前是否匿名（无有效 uid/token）。 */
  get isAnonymous(): boolean {
    return this.auth.uid === '-1' || this.auth.uid === '' || this.auth.token === '';
  }

  /**
   * 搜索歌曲。
   *
   * `options.page` 从 **1** 开始计数（内部转成波点的 `pn`，后者从 0 开始）。
   */
  async search(keyword: string, options: SearchOptions = {}): Promise<BodianSong[]> {
    const { list } = await searchMusic(this.ctx, {
      keyword,
      page: options.page ?? 1,
      pageSize: options.pageSize ?? this.pageSize,
    });
    return list.map(normalizeSong);
  }

  /** 搜索歌单。 */
  async searchPlaylists(keyword: string, options: SearchOptions = {}): Promise<BodianPlaylistBrief[]> {
    const { list } = await searchPlaylists(this.ctx, {
      keyword,
      page: options.page ?? 1,
      pageSize: options.pageSize ?? this.pageSize,
    });
    return list.map(normalizePlaylistBrief);
  }

  /**
   * 取歌曲详情。
   *
   * 走 bd-api 的 `/api/service/music/info`：真机验证返回结构与搜索接口**同构**，
   * 因此连音质列表一起拿到。取不到时返回 `null`（不抛错）。
   */
  async getSongDetail(musicId: string): Promise<BodianSong | null> {
    try {
      const song = normalizeSong(await apiMusicInfo(this.ctx, { musicId }));
      return song.name === '' ? null : song;
    } catch {
      return null;
    }
  }

  /**
   * 解析播放地址（匿名即可拿到完整音质）。
   *
   * 走车机客户端的 `convert_url_with_sign`：真机验证返回完整 FLAC（55 MB 整曲，
   * `Range` 可用），而不是 `checkRight` 那种 29 秒试听片段。
   */
  async getMusicUrl(musicId: string, options: MusicUrlOptions = {}): Promise<MusicUrlResult> {
    const requested = options.quality ?? 'flac';
    const requestedIndex = QUALITY_ORDER.indexOf(requested);
    const candidates =
      options.fallback === false || requestedIndex <= 0
        ? [requested]
        : QUALITY_ORDER.slice(0, requestedIndex + 1).reverse();

    let lastError: unknown;

    for (const quality of candidates) {
      const spec = QUALITY_SPECS[quality];
      try {
        const result = await apiConvertUrl(this.ctx, { musicId, br: spec.br });
        const actual = qualityFromAudio(result.format, result.bitrate) ?? quality;

        return {
          url: result.url,
          quality: actual,
          format: result.format || spec.format,
          bitrate: result.bitrate,
          duration: result.duration,
          via: 'convert_url_with_sign',
          restricted: false,
        };
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error(`无法解析播放地址: ${musicId}`);
  }

  /**
   * 解析播放地址（**账号通道**）。
   *
   * 与 {@link getMusicUrl}（车机通道，匿名就能拿到整曲）相对：这条走 bd-api 的
   * `checkRight` → `audioUrl`，用**登录账号自己的权益**换地址，因此需要有效的 `uid`/`token`；
   * 没有登录态时用 {@link getPreviewUrl}（官方给匿名的 29 秒片段）。
   *
   * 真机验证（登录态）：普通歌与 VIP 歌都返回**全曲**地址（字段 `audioHttpsUrl`），`Range` 可用
   * （206）；这条通道上 flac 请求会被服务端降级成 320k mp3，音质上限取决于账号权益。
   */
  async getAccountUrl(musicId: string, options: MusicUrlOptions = {}): Promise<MusicUrlResult> {
    const requested = options.quality ?? '320k';
    const requestedIndex = QUALITY_ORDER.indexOf(requested);
    const candidates =
      options.fallback === false || requestedIndex <= 0
        ? [requested]
        : QUALITY_ORDER.slice(0, requestedIndex + 1).reverse();

    let lastError: unknown;

    for (const quality of candidates) {
      const spec = QUALITY_SPECS[quality];
      try {
        // 先问权限再换地址：真机 status 1 = 普通歌、4 = VIP 歌，登录后两者都放行全曲
        await apiCheckRight(this.ctx, { musicId });
        const data = await apiAudioUrl(this.ctx, { musicId, format: spec.format, br: spec.br });
        const url = toText(data.audioHttpsUrl) || toText(data.audioUrl);
        if (!url) throw new Error(`账号通道未返回播放地址: ${musicId}`);

        const actual = qualityFromAudio(toText(data.format), toNumber(data.bitrate)) ?? quality;

        return {
          url,
          quality: actual,
          format: toText(data.format) || spec.format,
          bitrate: toNumber(data.bitrate),
          duration: toNumber(data.duration),
          via: 'bd-api-audioUrl',
          restricted: false,
        };
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new Error(`无法解析账号播放地址: ${musicId}`);
  }

  /**
   * 匿名试听地址（`checkRight` 通道）。
   *
   * 真机验证：匿名下波点只给前 29 秒片段（`audition.start=0, end=29`），
   * 因此日常播放请用 {@link getMusicUrl}；本方法保留给「受限试听」场景。
   */
  async getPreviewUrl(musicId: string): Promise<MusicUrlResult> {
    const { raw } = await apiCheckRight(this.ctx, { musicId });
    const audition = (raw.audition ?? {}) as Record<string, unknown>;
    const url = toText(audition.https) || toText(audition.url) || toText(audition.car_url_https);
    if (!url) throw new Error(`匿名试听地址缺失: ${musicId}`);

    return {
      url,
      quality: qualityFromAudio(toText(audition.format), toNumber(audition.br)) ?? '128k',
      format: toText(audition.format) || 'mp3',
      bitrate: toNumber(audition.br),
      duration: toNumber(audition.duration),
      via: 'bd-api-audition',
      restricted: true,
      preview: { start: toNumber(audition.start), end: toNumber(audition.end) },
    };
  }

  /**
   * 取歌词。
   *
   * `verbatim` 是波点原生返回的逐字歌词，格式与 LX Music 的 `lxlyric` 一致
   * （`[00:00.000]<1120,-1120>晴<2400,160>天`）；`lrc` 是去掉逐字标记的普通 LRC。
   * 逐字歌词取不到时回退到 H5 接口的标准 LRC 行。
   */
  async getLyrics(musicId: string): Promise<LyricResult> {
    let verbatim = '';
    try {
      verbatim = await apiLyric(this.ctx, { musicId });
    } catch {
      verbatim = '';
    }

    if (verbatim.trim() !== '') {
      return { verbatim, lrc: stripVerbatimMarks(verbatim), raw: verbatim };
    }

    const { lrcList } = await mobileSongInfo(this.ctx, { musicId });
    const lrc = lrcList
      .map((line) => `[${formatLrcTime(toNumber(line.time))}]${line.lineLyric ?? ''}`)
      .join('\n');

    return { verbatim: lrc, lrc, raw: lrc };
  }

  /**
   * 取歌单（元数据 + 曲目）。
   *
   * `ref` 可以是纯数字 id，也可以是波点歌单分享链接（`?pid=…&source=…`）。
   */
  async getPlaylist(ref: string, options: GetPlaylistOptions = {}): Promise<BodianPlaylist> {
    const parsed = parsePlaylistRef(ref);
    // source 缺省为 4：实测歌单搜索返回的 source=4 能正常回查曲目。若拿到空列表，
    // 说明 source 不匹配，请显式传入 options.source 或使用带 source 的分享链接。
    const source = options.source ?? parsed.source ?? '4';
    const limit = options.limit ?? 300;

    const meta = await apiPlaylistInfo(this.ctx, { playlistId: parsed.id, source });
    const brief = normalizePlaylistBrief({
      ...meta,
      id: toText(meta.id) || parsed.id,
      source: toText(meta.source ?? meta.sourceType) || source,
    });

    const songs: BodianSong[] = [];
    for (let page = 1; page <= PLAYLIST_MAX_PAGES; page += 1) {
      const { list, total } = await apiPlaylistMusicList(this.ctx, {
        playlistId: parsed.id,
        source,
        page,
        pageSize: PLAYLIST_PAGE_SIZE,
      });

      if (list.length === 0) break;
      songs.push(...list.map(normalizeSong));

      if (songs.length >= total || songs.length >= limit) break;
      if (list.length < PLAYLIST_PAGE_SIZE) break;
    }

    return {
      ...brief,
      description: toText(meta.description),
      songs: songs.slice(0, limit),
    };
  }

  /** 便捷方法：把秒数格式化成 LX 的 `interval` 形式。 */
  static formatInterval = formatInterval;
}
