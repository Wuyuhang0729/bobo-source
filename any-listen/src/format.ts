/** 时间与歌词文本的格式化工具。 */
import type { Quality } from './types.js';

/** 秒 → `mm:ss`（LX Music 的 `interval` 字段格式）。 */
export function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** 秒 → `mm:ss.mmm`（LRC 时间标签）。 */
export function formatLrcTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.000';
  const totalMs = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMs / 60_000);
  const restMs = totalMs % 60_000;
  const secs = Math.floor(restMs / 1000);
  const ms = restMs % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * 去掉逐字歌词的时间标记，得到普通 LRC。
 * `[00:00.000]<1120,-1120>晴<2400,160>天` → `[00:00.000]晴天`
 */
export function stripVerbatimMarks(text: string): string {
  return text.replace(/<-?\d+,-?\d+>/g, '');
}

/** 由实际返回的容器/码率反推音质档位（服务端可能降级）。 */
export function qualityFromAudio(format: string, bitrate: number): Quality | undefined {
  const container = format.toLowerCase();
  if (container === 'flac') return 'flac';
  if (container === 'mp3') return bitrate >= 320 ? '320k' : '128k';
  return undefined;
}
