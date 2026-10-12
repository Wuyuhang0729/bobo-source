/**
 * 波点音乐(Bodian)音源核心库。
 *
 * 匿名可用：搜索 / 完整音质播放地址 / 逐字歌词 / 歌单，零运行时依赖。
 */
export { BodianClient } from './client.js';
export type {
  BodianClientOptions,
  GetPlaylistOptions,
  MusicUrlOptions,
  SearchOptions,
} from './client.js';

export {
  BODIAN_API_ORIGIN,
  BODIAN_CAR_FALLBACK_ORIGIN,
  BODIAN_CAR_ORIGIN,
  BODIAN_H5_ORIGIN,
  BODIAN_LYRIC_ORIGIN,
  BodianApiError,
  DEFAULT_CLIENT_HEADERS,
  audioUrl,
  checkRight,
  convertUrl,
  lyric,
  mobileSongInfo,
  musicInfo,
  playlistInfo,
  playlistMusicList,
  searchMusic,
  searchPlaylists,
} from './api.js';
export type { ApiContext, CheckRightResult, ConvertUrlResult } from './api.js';

export { BodianHttpError, httpRequest, pyQuote, pyUrlencode } from './http.js';
export type { HttpRequestOptions, HttpResponse } from './http.js';

export { bodianSign, md5 } from './sign.js';

export {
  LX_QUALITY_BY_BODIAN,
  QUALITY_ORDER,
  QUALITY_SPECS,
  deriveQualities,
  isQuality,
} from './qualities.js';

export {
  normalizePlaylistBrief,
  normalizeSong,
  parsePlaylistRef,
  toNumber,
  toText,
} from './normalize.js';

export {
  formatInterval,
  formatLrcTime,
  qualityFromAudio,
  stripVerbatimMarks,
} from './format.js';

export { probeAudioUrl } from './probe.js';
export type { AudioProbeResult } from './probe.js';

export { fromLxQuality, toLxQuality, toLxSong } from './lx.js';
export type { LxQuality, LxSong } from './lx.js';

export type {
  BodianAuth,
  BodianPlaylist,
  BodianPlaylistBrief,
  BodianSearchItem,
  BodianSong,
  LyricResult,
  MusicUrlResult,
  Quality,
  QualitySpec,
} from './types.js';
