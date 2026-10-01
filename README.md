# bodian

波点音乐（Bodian / `bodian.kuwo.cn`）音源核心库。**零运行时依赖**、TypeScript 编写、ESM + CJS 双输出。

定位：把波点的「搜索 / 播放地址 / 歌词 / 歌单」四件事做成一个干净、可复用的 Provider，
供 fork 的 LX Music、Any Listen 扩展或自研播放器消费。**它本身不是播放器。**

---

## 一、已经过真机验证的结论

下面每一条都是实际打接口跑出来的，不是照抄别人的实现。

| 能力 | 接口 | 匿名可用 | 备注 |
|---|---|---|---|
| 搜索歌曲 | `GET bd-api.kuwo.cn/api/search/music/list` | ✅ | `pn` 从 **0** 开始；参数是 `keyword`；缺 `devid`/`qimei36` 头会返回 `402` |
| 搜索歌单 | `GET bd-api.kuwo.cn/api/search/playlist/list` | ✅ | 参数是 `keyword`（用 `key` 得到空列表） |
| 歌单曲目 | `GET bd-api.kuwo.cn/api/service/playlist/{id}/musicList` | ✅ | `pn` 从 **1** 开始；需带 `source`（搜索结果里给） |
| 歌单信息 | `GET bd-api.kuwo.cn/api/service/playlist/info/{id}` | ✅ | 字段 `musicCount` / `playNum` / `creatorName` |
| 歌曲详情 | `GET bd-api.kuwo.cn/api/service/music/info?musicId=` | ✅ | 返回结构与**搜索接口同构**（连 `audios[]` 一起给）；酷我 H5 的 `songinfoandlrc` 会间歇返回 `301 音乐查询失败`，已弃用 |
| **完整音质播放地址** | `GET nmobi.kuwo.cn/mobi.s?...type=convert_url_with_sign` | ✅ | **这是匿名播放的主路径** |
| 播放权限/试听 | `GET bd-api.kuwo.cn/api/play/music/v2/checkRight` | ⚠️ | 匿名只给 **29 秒**试听片段；必须 GET 带 body |
| 会员播放地址 | `GET bd-api.kuwo.cn/api/play/music/v2/audioUrl` | ❌ | 需有效 `uid`/`token`，第一版未实现 |
| 逐字歌词 | `GET mlyric.kuwo.cn/mobi.s?f=bodian` | ✅ | 返回 base64 的**逐字歌词**，格式与 LX 的 `lxlyric` 完全一致 |

### 三个容易踩错的关键点

1. **匿名就能拿完整音质**，走的是车机客户端的 `convert_url_with_sign`，而不是 bd-api 的
   `checkRight` / `audioUrl`。实测 `br=2000kflac` 返回整曲 FLAC：`55,397,039` 字节、
   magic `664c6143`（`fLaC`）、`Range: bytes=0-1023` 返回 `206`（可拖动进度条）。
   同期 `checkRight` 只给 `audition { start: 0, end: 29 }`。
2. **播放接口必须 GET 且带 request body**（签名覆盖 body）。改成 `POST` 会得到
   `500 Service error`。Node 原生 `fetch` 禁止 GET 带 body，所以本库用 `node:https` 手工构造。
3. **签名里的 `urlencode` 必须等价 Python `quote_plus`**，否则排序后的字符集不同、签名不匹配。
   JS 的 `encodeURIComponent` 会漏编码 `! * ' ( )` —— 见 `src/http.ts` 的 `pyQuote`。

签名算法（`src/sign.ts`）：

```
seed = "kuwotest" + 字母数字(urlencode(params)) 排序拼接
若带 body: seed += md5(body + "kuwotest")
sign = md5(seed + path)
```

---

## 二、用法

```ts
import { BodianClient } from 'bodian';

const client = new BodianClient(); // 匿名，无需登录

// 1. 搜索
const songs = await client.search('周杰伦 晴天', { pageSize: 5 });
console.log(songs[0].name, songs[0].artist, songs[0].availableQualities);

// 2. 播放地址（默认 flac，失败自动降级 320k → 128k）
const { url, quality, format, duration } = await client.getMusicUrl(songs[0]!.id);
// url 可直接交给播放器

// 3. 歌词
const { verbatim, lrc } = await client.getLyrics(songs[0]!.id);
// verbatim: [00:00.000]<1120,-1120>晴<2400,160>天   ← LX 的 lxlyric 格式

// 4. 歌单（支持分享链接）
const playlist = await client.getPlaylist('https://bodian.kuwo.cn/playlist?pid=280301309&source=4', {
  limit: 50,
});
console.log(playlist.name, playlist.songs.length);
```

可选：确认地址真的可播

```ts
import { probeAudioUrl } from 'bodian';
const probe = await probeAudioUrl(url); // Range: bytes=0-63
console.log(probe.status, probe.contentLength, probe.container); // 206, 55397039, 'flac'
```

---

## 三、目录结构

```
src/
  http.ts        Python quote_plus 兼容 + GET-with-body + 超时/重试/重定向/解压
  sign.ts        bd-api md5 签名
  api.ts         各端点薄封装（搜索/歌单/checkRight/audioUrl/convertUrl/歌词/详情）
  client.ts      BodianClient 门面：search / getMusicUrl / getLyrics / getPlaylist / getSongDetail
  normalize.ts   原始响应 → 统一模型
  qualities.ts   音质档位映射（剔除 DRM 加密容器）
  format.ts      时间/歌词文本格式化
  probe.ts       音频地址探测（Range + magic）
  lx.ts          波点歌曲 → LX Music 在线歌曲对象映射
  types.ts       数据模型
bin/
  verify.ts      真机验证 CLI（npm run verify）
```

---

## 四、音质档位

只暴露三档，命名对齐 LX Music：

| 本库 | LX | 波点参数 | 状态 |
|---|---|---|---|
| `128k` | `128k` | `br=128kmp3` | 可播 |
| `320k` | `320k` | `br=320kmp3` | 可播 |
| `flac` | `flac` | `br=2000kflac` | 可播（整曲，Range 可用） |

`flac24bit` **没有对应档位**：波点搜索响应里确实列出了 `mflac` / `mgg` / `zp` 等高码率条目，
但它们是 **DRM 加密容器**（`zp` 的 size 字面量就是 `"zpMb"`），不能当普通音频交给播放器，
因此 `deriveQualities()` 会主动把它们过滤掉。

---

## 五、接入 LX Music / Any Listen 的现状（重要）

**LX Music**：自定义源协议把 `source` 锁死在 `kw` / `kg` / `tx` / `wy` / `mg` / `local`，
且自定义脚本只被允许接管 `musicUrl` / `lyric` / `pic` —— **没有**开放「搜索 → 返回歌曲列表」的
Provider 接口。所以 `src/lx.ts` 产出的 `source: 'bd'` 对象**无法直接喂给未改动的 LX Music**。

想在不修改 LX 的前提下听波点，只能把歌伪装成 `kw` 并只对接 `musicUrl`，代价是丢掉搜索与歌单、
且列表里来源显示错误。要做「真正的波点源」，就得 fork LX 把 `bd` 加进类型链，或者走 Any Listen。

**Any Listen**：扩展体系是开放的，本库可直接作为它的扩展内部客户端。`src/lx.ts` 也可以作为
数据契约复用。

---

## 六、已知局限

- `convert_url_with_sign` 属于第三方车机通道，**波点随时可能收紧**；这是匿名方案唯一的完整音质来源。
- 未实现登录 / VIP：`uid` / `token` 选项已预留，`audioUrl()` 已按协议实现但未做登录流程。
- 波点接口**没有官方文档**，所有字段都是逆向外加真机验证所得，服务端改动会导致失效。
  遇到问题时 `BodianSong.raw` 里保留了原始响应。
- 歌单 `source` 必须与歌单匹配（搜索接口会返回），纯 id 调用时默认 `4`。
- 本项目仅供个人学习与研究使用，请勿用于分发或商业用途。
