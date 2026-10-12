/**
 * 音质档位映射。
 *
 * 波点搜索响应里的 `audios[]` 会列出该曲所有可用音质，但其中 `mflac` / `mgg` / `zp`
 * 等高码率档位是 **DRM 加密** 容器（`zp` 的 size 字面量就是 `"zpMb"`），不能当普通
 * 音频交给播放器。本库只暴露可直接播放的三档，命名对齐 LX Music 的 `types[].type`。
 */
import type { BodianSearchItem, Quality, QualitySpec } from './types.js';

/**
 * 档位 → 波点接口参数。
 *
 * `br` 即 `convert_url_with_sign` 的 `br` 参数，格式为 `<码率>k<格式>`。
 */
export const QUALITY_SPECS: Record<Quality, QualitySpec> = {
  '128k': { format: 'mp3', br: '128kmp3', verified: true },
  '320k': { format: 'mp3', br: '320kmp3', verified: true },
  flac: { format: 'flac', br: '2000kflac', verified: true },
};

/** 按从低到高的顺序排列，用于降级重试。 */
export const QUALITY_ORDER: readonly Quality[] = ['128k', '320k', 'flac'];

/** LX Music 只认 128k/320k/flac/flac24bit，这里给出直接映射以便适配层使用。 */
export const LX_QUALITY_BY_BODIAN: Record<Quality, '128k' | '320k' | 'flac'> = {
  '128k': '128k',
  '320k': '320k',
  flac: 'flac',
};

export function isQuality(value: string): value is Quality {
  return value === '128k' || value === '320k' || value === 'flac';
}

/**
 * 从搜索结果的 `audios[]` 推导实际可用的音质档位（按 128k → 320k → flac 排序）。
 *
 * 只认白名单组合：`mp3`+128、`mp3`+320、`flac`+2000。加密容器（mflac/mgg/zp）与
 * ogg/aac 一律不列出——它们在 LX 侧没有对应档位，列出来只会让上层困惑。
 */
export function deriveQualities(item: Pick<BodianSearchItem, 'audios'> | undefined): Quality[] {
  const audios = item?.audios ?? [];
  const found = new Set<Quality>();

  for (const audio of audios) {
    const format = (audio.format ?? '').toLowerCase();
    const bitrate = Number(audio.bitrate ?? 0);
    if (format === 'mp3' && bitrate === 128) found.add('128k');
    else if (format === 'mp3' && bitrate === 320) found.add('320k');
    else if (format === 'flac' && bitrate === 2000) found.add('flac');
  }

  return QUALITY_ORDER.filter((quality) => found.has(quality));
}
