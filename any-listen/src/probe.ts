/**
 * 音频地址探测。
 *
 * 用途：播放地址解析出来后确认它真的可播（而不是 302 到错误页或只有几十 KB 的试听片段）。
 * 用 `Range: bytes=0-63` 拉前 64 字节，既省流量又能读到容器 magic。
 */
export interface AudioProbeResult {
  status: number;
  /** 整个文件的字节数（来自 `content-range`，缺失时回退 `content-length`）。 */
  contentLength: number;
  acceptsRanges: boolean;
  /** 前 4 字节的十六进制。 */
  magicHex: string;
  container: 'flac' | 'mp3' | 'ogg' | 'unknown';
  bytesRead: number;
}

const MAGIC: Array<{ hex: string; container: AudioProbeResult['container'] }> = [
  { hex: '664c6143', container: 'flac' }, // fLaC
  { hex: '4f676753', container: 'ogg' }, // OggS
  { hex: '494433', container: 'mp3' }, // ID3
];

function sniffContainer(buffer: Buffer): AudioProbeResult['container'] {
  const head = buffer.subarray(0, 4).toString('hex');
  for (const entry of MAGIC) {
    if (head.startsWith(entry.hex)) return entry.container;
  }
  // 无 ID3 头的裸 MP3：帧同步字 0xFFEx / 0xFFFx
  if (buffer.length >= 2 && buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0) return 'mp3';
  return 'unknown';
}

export async function probeAudioUrl(url: string, options: { timeoutMs?: number } = {}): Promise<AudioProbeResult> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const signal = AbortSignal.timeout(timeoutMs);

  const response = await fetch(url, {
    headers: { Range: 'bytes=0-63' },
    signal,
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentRange = response.headers.get('content-range');
  const totalFromRange = contentRange ? Number(contentRange.split('/')[1]) : Number.NaN;
  const contentLength = Number.isFinite(totalFromRange)
    ? totalFromRange
    : Number(response.headers.get('content-length') ?? buffer.length);

  return {
    status: response.status,
    contentLength,
    acceptsRanges: response.status === 206 || (response.headers.get('accept-ranges') ?? '').includes('bytes'),
    magicHex: buffer.subarray(0, 4).toString('hex'),
    container: sniffContainer(buffer),
    bytesRead: buffer.length,
  };
}
