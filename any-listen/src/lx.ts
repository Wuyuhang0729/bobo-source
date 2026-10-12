/**
 * 波点歌曲 → LX Music 在线歌曲对象的映射。
 *
 * ⚠️ 重要限制（先说清楚，避免误用）：
 * LX Music 的自定义源协议把 `source` 锁死在 `kw` / `kg` / `tx` / `wy` / `mg` / `local`，
 * 且自定义脚本只被允许接管 `musicUrl` / `lyric` / `pic` 三个 action —— **没有**开放
 * 「搜索 → 返回歌曲列表」的 Provider 接口。所以本文件产出的 `source: 'bd'` 对象
 * 无法直接喂给未改动的 LX Music；它存在的意义是：
 *
 * - 作为**适配层的数据契约**：fork LX 加入 `bd` 源时，搜索/详情/歌单都产出这个结构；
 * - 供 Any Listen 扩展使用（其 extension 体系是开放的）；
 * - 供自研播放器直接消费。
 *
 * 若只想在**不修改** LX 的前提下听波点，可行做法是把波点歌曲伪装成 `kw` 源并只对接
 * `musicUrl`；但那会丢失搜索/歌单，且会让歌曲列表里的来源显示错误 —— 这正是
 * 本仓库选择先做独立 Provider 的原因。
 */
import { formatInterval, qualityFromAudio } from './format.js';
import type { BodianSong, Quality } from './types.js';

/** LX Music 侧的音质标识。 */
export type LxQuality = '128k' | '320k' | 'flac' | 'flac24bit';

/** LX Music 在线歌曲对象。 */
export interface LxSong {
  source: 'bd';
  /** 波点歌曲 id。 */
  songmid: string;
  name: string;
  singer: string;
  albumName: string;
  albumId: string;
  /** `mm:ss`。 */
  interval: string;
  img: string;
  /** 该曲可用的音质档位。 */
  types: Array<{ type: LxQuality }>;
  /** 与 `types` 一一对应的原始信息，LX 会原样带回给 `musicUrl` action。 */
  _types: Record<string, { quality: Quality; format: string; br: string }>;
  /** 保留波点原始 id 字段，便于排障。 */
  meta: { musicId: string; albumId: string; qualitys: Quality[] };
}

/** 单曲映射。`qualitySpecs` 用于填充 `_types`，默认由调用方从 QUALITY_SPECS 传入。 */
export function toLxSong(
  song: BodianSong,
  qualitySpecs: Record<Quality, { format: string; br: string }>,
): LxSong {
  const qualities = song.availableQualities.length > 0 ? song.availableQualities : (['128k', '320k', 'flac'] as Quality[]);

  const types: Array<{ type: LxQuality }> = [];
  const typesMap: LxSong['_types'] = {};

  for (const quality of qualities) {
    const spec = qualitySpecs[quality];
    if (!spec) continue;
    types.push({ type: quality });
    typesMap[quality] = { quality, format: spec.format, br: spec.br };
  }

  return {
    source: 'bd',
    songmid: song.id,
    name: song.name,
    singer: song.artist,
    albumName: song.album,
    albumId: song.albumId,
    interval: formatInterval(song.duration),
    img: song.cover,
    types,
    _types: typesMap,
    meta: { musicId: song.id, albumId: song.albumId, qualitys: qualities },
  };
}

/** LX 音质标识 → 本库音质档位；`flac24bit` 无对应（波点高码率档位是 DRM 加密容器）。 */
export function fromLxQuality(quality: string): Quality | undefined {
  if (quality === '128k' || quality === '320k' || quality === 'flac') return quality;
  return undefined;
}

/** 由实际音频信息反推 LX 音质标识。 */
export function toLxQuality(format: string, bitrate: number): LxQuality | undefined {
  return qualityFromAudio(format, bitrate);
}
