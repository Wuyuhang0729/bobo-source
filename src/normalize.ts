/**
 * 波点原始响应 → 统一模型的归一化逻辑。
 *
 * 波点接口没有文档，同一字段在不同接口里会呈现不同形态（数字/字符串、缺省、空串），
 * 这里统一收敛一次，并把原始对象挂在 `raw` 上以便排障。
 */
import { deriveQualities } from './qualities.js';
import type { BodianPlaylistBrief, BodianSearchItem, BodianSong } from './types.js';

/** 转数字，失败时回退。 */
export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** 转字符串，`undefined`/`null` 回退为空串。 */
export function toText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return String(value);
}

/** 归一化单条歌曲（搜索接口与歌单曲目接口的字段结构一致）。 */
export function normalizeSong(item: BodianSearchItem): BodianSong {
  const artists = (item.artists ?? [])
    .map((artist) => ({
      id: toText(artist.id),
      name: toText(artist.name),
      ...(artist.pic ? { pic: String(artist.pic) } : {}),
    }))
    .filter((artist) => artist.id !== '' || artist.name !== '');

  const cover = toText(item.albumPic);

  return {
    id: toText(item.id),
    name: toText(item.name) || toText(item.songName),
    artist: toText(item.artist),
    artists,
    album: toText(item.album),
    albumId: toText(item.albumId),
    duration: toNumber(item.duration),
    cover,
    coverSmall: toText(item.albumPic120) || cover,
    availableQualities: deriveQualities(item),
    raw: item,
  };
}

/** 归一化歌单摘要（歌单搜索结果与歌单信息接口共用）。 */
export function normalizePlaylistBrief(raw: Record<string, unknown>): BodianPlaylistBrief {
  return {
    id: toText(raw.id),
    source: toText(raw.source ?? raw.sourceType),
    name: toText(raw.name),
    cover: toText(raw.pic),
    trackCount: toNumber(raw.musicnum ?? raw.musicCount),
    playCount: toNumber(raw.playnum ?? raw.playNum),
    creatorId: toText(raw.creator_id ?? raw.creatorId),
    creatorName: toText(raw.creator_name ?? raw.creatorName),
    raw,
  };
}

/**
 * 从波点歌单分享链接里取出歌单 id 与 `source`。
 *
 * 支持形如 `https://bodian.kuwo.cn/playlist?pid=280301309&source=4` 的链接，
 * 也支持直接传纯数字 id。
 */
export function parsePlaylistRef(input: string): { id: string; source: string | undefined } {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return { id: trimmed, source: undefined };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`无法解析歌单链接: ${input}`);
  }

  const id =
    url.searchParams.get('pid') ??
    url.searchParams.get('playlistId') ??
    url.searchParams.get('playListId') ??
    url.searchParams.get('id') ??
    url.pathname.split('/').filter(Boolean).pop()?.replace(/\.html?$/, '') ??
    '';

  if (!/^\d+$/.test(id)) throw new Error(`歌单链接里没有找到数字 id: ${input}`);

  const source = url.searchParams.get('source') ?? url.searchParams.get('sourceType');
  return { id, source: source ?? undefined };
}
