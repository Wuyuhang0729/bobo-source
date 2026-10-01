#!/usr/bin/env node
/**
 * 真机验证脚本。
 *
 * 说明：这里刻意**不 mock**任何东西 —— 全部打真实接口。目的有两个：
 *   1. 证明四项能力（搜索/播放/歌词/歌单）在匿名身份下确实可用；
 *   2. 接口哪天变了，跑一次就能定位是哪一层坏了。
 *
 * 用法：
 *   npm run verify          # 先构建再跑
 *   node dist/esm/bin/verify.js
 *
 * 退出码：0 = 全部通过，1 = 有失败项。
 */
import { BodianClient, QUALITY_ORDER, probeAudioUrl, toLxSong, QUALITY_SPECS } from '../src/index.js';
import type { Quality } from '../src/index.js';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok, detail });
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`  ${tag}  ${name}${detail ? `  —  ${detail}` : ''}`);
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

async function checkSearch(client: BodianClient): Promise<Awaited<ReturnType<BodianClient['search']>>> {
  console.log('\n[1/6] 搜索');
  const songs = await client.search('周杰伦 晴天', { pageSize: 3 });
  const first = songs[0];
  record(
    '搜索歌曲',
    songs.length > 0 && first !== undefined,
    first ? `${songs.length} 首，首条 "${first.name}" - ${first.artist}，音质 [${first.availableQualities.join(', ')}]` : '无结果',
  );
  return songs;
}

async function checkPlayUrl(client: BodianClient, musicId: string): Promise<void> {
  console.log('\n[2/6] 播放地址（每档都用 Range 请求确认可播）');
  for (const quality of QUALITY_ORDER) {
    try {
      const resolved = await client.getMusicUrl(musicId, { quality: quality as Quality, fallback: false });
      const probe = await probeAudioUrl(resolved.url);
      const playable = probe.status === 200 || probe.status === 206;
      record(
        `播放地址 ${quality}`,
        playable,
        `via=${resolved.via} ${resolved.format}/${resolved.bitrate}kbps 全曲 ${(probe.contentLength / 1024 / 1024).toFixed(1)}MB ` +
          `magic=${probe.magicHex}(${probe.container}) Range=${probe.acceptsRanges}`,
      );
    } catch (error) {
      record(`播放地址 ${quality}`, false, describeError(error));
    }
  }
}

async function checkLyric(client: BodianClient, musicId: string): Promise<void> {
  console.log('\n[3/6] 歌词');
  const lyric = await client.getLyrics(musicId);
  const isVerbatim = /<-?\d+,-?\d+>/.test(lyric.verbatim);
  const lines = lyric.verbatim.split('\n').filter((line) => line.trim() !== '').length;
  record('逐字歌词', lyric.verbatim.trim() !== '' && isVerbatim, `lxlyric 格式=${isVerbatim}，${lines} 行`);
  record('普通 LRC', lyric.lrc.includes('['), `首行: ${lyric.lrc.split('\n').find((l) => l.trim() !== '') ?? ''}`);
}

async function checkPlaylist(client: BodianClient): Promise<void> {
  console.log('\n[4/6] 歌单');
  const playlists = await client.searchPlaylists('摇滚', { pageSize: 2 });
  const brief = playlists[0];
  record('搜索歌单', brief !== undefined, brief ? `"${brief.name}" id=${brief.id} source=${brief.source} 曲目 ${brief.trackCount}` : '无结果');
  if (!brief) return;

  const playlist = await client.getPlaylist(brief.id, { source: brief.source, limit: 5 });
  const first = playlist.songs[0];
  record(
    '歌单曲目',
    playlist.songs.length > 0 && first !== undefined,
    `"${playlist.name}" 取到 ${playlist.songs.length} 首（标称 ${playlist.trackCount}），首条 "${first?.name ?? ''}"`,
  );

  if (first) {
    const resolved = await client.getMusicUrl(first.id, { quality: 'flac' });
    const probe = await probeAudioUrl(resolved.url);
    record(
      '歌单曲目可播',
      probe.status === 200 || probe.status === 206,
      `${first.name} → ${resolved.format} ${(probe.contentLength / 1024 / 1024).toFixed(1)}MB ${probe.container}`,
    );
  }
}

async function checkPreview(client: BodianClient, musicId: string): Promise<void> {
  console.log('\n[5/6] 匿名试听通道（对照组）');
  try {
    const preview = await client.getPreviewUrl(musicId);
    const snippet = preview.preview ? `${preview.preview.end - preview.preview.start}s` : '未知';
    record(
      'checkRight 试听',
      preview.restricted,
      `restricted=${preview.restricted} 片段 ${snippet} / 全曲 ${preview.duration}s（完整播放请走 convert_url_with_sign）`,
    );
  } catch (error) {
    record('checkRight 试听', false, describeError(error));
  }
}

async function checkDetailAndLx(client: BodianClient, musicId: string): Promise<void> {
  console.log('\n[6/6] 歌曲详情 / LX 映射');
  const detail = await client.getSongDetail(musicId);
  record(
    '歌曲详情',
    detail !== null && detail.name !== '',
    detail
      ? `${detail.name} / ${detail.artist} / ${detail.album} / ${detail.duration}s / 音质 [${detail.availableQualities.join(', ')}]`
      : '取不到',
  );

  const songs = await client.search('晴天', { pageSize: 1 });
  const song = songs[0];
  if (song) {
    const lx = toLxSong(song, QUALITY_SPECS);
    record(
      'toLxSong 映射',
      lx.source === 'bd' && lx.songmid === song.id && lx.types.length > 0,
      `source=${lx.source} songmid=${lx.songmid} interval=${lx.interval} types=[${lx.types.map((t) => t.type).join(', ')}]`,
    );
  }
}

async function main(): Promise<void> {
  console.log('波点音源库 · 真机验证');
  console.log(`Node ${process.version} · ${new Date().toISOString()}`);

  const client = new BodianClient({ timeout: 20_000, retries: 1 });

  const songs = await checkSearch(client);
  const target = songs[0];
  if (!target) {
    console.log('\n搜索没有结果，后续检查无法进行。');
    process.exit(1);
  }

  await checkPlayUrl(client, target.id);
  await checkLyric(client, target.id);
  await checkPlaylist(client);
  await checkPreview(client, target.id);
  await checkDetailAndLx(client, target.id);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${'-'.repeat(60)}`);
  console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`);
  for (const result of failed) console.log(`  FAIL  ${result.name}  —  ${result.detail}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error('\n验证脚本本身出错：', describeError(error));
  process.exit(1);
});
