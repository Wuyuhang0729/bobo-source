/**
 * 波点音乐(Bodian)音源核心库的数据模型。
 *
 * 说明：波点接口没有公开文档，这里的字段名全部来自真机响应。
 * 原始字段名保留在每个模型的 `raw` 里，方便接口变更时对照排查。
 */

/** 播放音质档位。命名对齐 LX Music 的 `types[].type`，方便后续适配层直接映射。 */
export type Quality = '128k' | '320k' | 'flac';

/** 每个音质档位对应的波点 (format, bitrate) 组合。 */
export interface QualitySpec {
  /** 波点 `format` 参数，如 `mp3` / `flac` / `ogg`。 */
  format: string;
  /** 波点 `br` 参数，如 `320kmp3` / `2000kflac`。 */
  br: string;
  /** 该组合是否已在本仓库真机验证过可拿到完整音频。 */
  verified: boolean;
}

/** 搜索接口 `/api/search/music/list` 返回的单条结果（原样保留）。 */
export interface BodianSearchItem {
  id: number | string;
  name?: string;
  songName?: string;
  artist?: string;
  album?: string;
  albumId?: number | string;
  albumPic?: string;
  albumPic120?: string;
  duration?: number | string;
  musicRid?: string;
  artists?: Array<{ id?: number | string; name?: string; pic?: string }>;
  audios?: Array<{ bitrate?: string; format?: string; level?: string; size?: string }>;
  payInfo?: Record<string, unknown>;
  /** 部分响应会带 `freeSign`/`fsig`；匿名搜索结果实测为空，签名时按空串处理。 */
  freeSign?: string;
  fsig?: string;
  [key: string]: unknown;
}

/** 统一的歌曲模型。 */
export interface BodianSong {
  /** 波点歌曲 id（在 LX 侧即 `songmid`）。 */
  id: string;
  /** 歌曲名。 */
  name: string;
  /** 歌手，多歌手以 `&` 连接（波点 `artist` 字段原样）。 */
  artist: string;
  /** 结构化歌手列表。 */
  artists: Array<{ id: string; name: string; pic?: string }>;
  /** 专辑名。 */
  album: string;
  /** 专辑 id。 */
  albumId: string;
  /** 时长（秒）。 */
  duration: number;
  /** 大图封面。 */
  cover: string;
  /** 小图封面。 */
  coverSmall: string;
  /** 波点侧标称可用的音质档位（已剔除加密的 mflac/mgg/zp 等 DRM 格式）。 */
  availableQualities: Quality[];
  /** 原始响应，排障用。 */
  raw: BodianSearchItem;
}

/** 播放地址解析结果。 */
export interface MusicUrlResult {
  /** 可直接交给播放器的音频地址。 */
  url: string;
  /** 实际拿到的音质。可能与请求的档位不同（服务端降级时如实回传）。 */
  quality: Quality;
  /** 音频容器格式，如 `flac` / `mp3`。 */
  format: string;
  /** 标称码率（kbps）。 */
  bitrate: number;
  /** 音频时长（秒）。 */
  duration: number;
  /** 解析所用的通道。 */
  via: 'convert_url_with_sign' | 'bd-api-audioUrl' | 'bd-api-audition';
  /**
   * 是否为受限试听片段（波点 `checkRight` 判定 status=3 时只给前 N 秒）。
   * 匿名 + `convert_url_with_sign` 通道下实测为 `false`（完整音频）。
   */
  restricted: boolean;
  /**
   * 仅当 `restricted` 为 `true` 时有值：试听片段在整曲中的秒数区间。
   *
   * 别和 `duration` 混用 —— 匿名试听实测是 `{ start: 0, end: 29 }`（29 秒），
   * 而 `duration` 返回的是整曲长度（如 269）。本库刻意不动后者，因为它是真实曲长。
   */
  preview?: { start: number; end: number };
}

/** 歌词解析结果。 */
export interface LyricResult {
  /**
   * 逐字歌词，即 LX Music 的 `lxlyric` 格式：
   * `[00:00.000]<1120,-1120>晴<2400,160>天`
   * 波点 `mlyric` 接口直接返回该格式，无需转换。
   */
  verbatim: string;
  /** 去掉逐字时间标记的普通 LRC，可直接塞给只认标准 LRC 的播放器。 */
  lrc: string;
  /** 原始文本（已从 base64 解码）。 */
  raw: string;
}

/** 歌单搜索结果项。 */
export interface BodianPlaylistBrief {
  id: string;
  /** 波点侧来源类型，回查曲目时必须带回 `/musicList?source=`。 */
  source: string;
  name: string;
  cover: string;
  /** 曲目数量。 */
  trackCount: number;
  /** 播放量。 */
  playCount: number;
  creatorId: string;
  creatorName: string;
  raw: Record<string, unknown>;
}

/** 歌单元数据 + 曲目。 */
export interface BodianPlaylist extends BodianPlaylistBrief {
  description: string;
  songs: BodianSong[];
}

/** 客户端鉴权信息。匿名时为 `uid: '-1'`, `token: ''`。 */
export interface BodianAuth {
  uid: string;
  token: string;
  /** 设备 id（`devid` / `qimei36` 请求头）。缺省时随机生成并复用。 */
  devId?: string;
}
