# 波点音乐 → Folia（folia-major）接入方案

> 调研对象：https://github.com/chthollyphile/folia-major
> 调研版本：`main` 分支（克隆于 2026-10-02，53 MB / 2216 文件）
> 结论：**核心能力（搜索 / 播放 / 歌词）可行；账号与歌单框架不开放，但在模组内部自行实现即可**
> 声明：仅供本人自用，不上架官方模组市场

---

## 一、结论速览

| 目标能力 | 可行性 | 实现位置 |
|---|---|---|
| 搜索歌曲 | ✅ 框架支持 | `omni.providers` → `search()` |
| 播放（含 VIP 高音质） | ✅ 框架支持 | `omni.providers` → `getAudioUrl()` |
| 逐字歌词 | ✅ 框架**原生**支持 | `omni.providers` → `getLyrics()`，格式 `awlrc` |
| 封面 / 专辑 / 时长 | ✅ 随歌曲元数据 | `FoliumProviderSong.coverUrl/album/durationMs` |
| **扫码登录** | ✅ **模组内部自己实现** | `client.mjs` 画二维码 + `main` 轮询 |
| **VIP 音质** | ✅ 模组内部用 token | `getAudioUrl()` 里走会员通道 |
| **个人歌单** | ⚠️ 框架不支持，需借道 | 见 §6（这是唯一需要迂回的地方） |

**一句话**：Folia 把"音源"抽象得很干净——**搜索/播放/歌词三件事它全包**，账号这类"它不关心的事"交给我在模组里自己做。

---

## 二、为什么必须写成模组（"不要乱放"的答案）

Folia 有正规的**模组平台 Folium 1.3**（形状参照 Minecraft Forge）。规范原文在 `mods/README.md`（42 KB）：

> Folium 是 Folia 的模组平台……模组通过**注册表**往宿主里加东西，通过**事件总线**介入宿主行为，通过**服务**调用宿主能力；确实要碰宿主内部时，走一个明确标注、钉死宿主版本的 **internals** 通道。

所以：

- ✅ **正确做法**：在 `mods/` 下建独立模组目录，用注册表把音源注册进去；
- ❌ **错误做法**：改 `src/services/onlineMusic/` 加一个内置 provider，或往 `api/` 里塞波点逻辑。

**为什么**：内置 provider 会被上游更新冲掉，而且要动宿主的类型系统（`ProviderCapabilities`、`onlineMusic` 服务），改动面大、升级即冲突。模组是**独立目录 + 自带清单**，宿主更新不受影响，禁用即卸载干净（规范承诺："a disabled mod leaves nothing behind"）。

---

## 三、模组结构（照样例来）

参考样例：`mods/sample-transparent-mov-export/`（有 main + client）

```
mods/bodian-source/
├── mod.json          # 清单（必需）
├── index.cjs         # main 入口：注册 provider、登录轮询（完整 Node.js 权限）
├── client.mjs        # client 入口：登录界面（二维码 UI）
└── preview.jpg       # 面板预览图（可选）
```

### `mod.json`

```json
{
  "folium": 1,
  "id": "bodian-source",
  "name": "波点音乐",
  "version": "0.1.0",
  "author": "（你自己）",
  "description": "波点音乐在线音源：搜索、播放（VIP 音质）、逐字歌词、扫码登录。",
  "main": "index.cjs",
  "client": "client.mjs",
  "experimental": ["omni.providers"],
  "permissions": ["net.fetch", "filesystem.data"]
}
```

**逐字段说明**：

| 字段 | 值 | 依据 |
|---|---|---|
| `folium` | `1` | 清单版本（所有样例都是 `1`） |
| `main` | `"index.cjs"` | 主进程入口，样例用 `.cjs` |
| `client` | `"client.mjs"` | 渲染进程入口，样例用 `.mjs` |
| `experimental` | `["omni.providers"]` | ★ **不写这个，provider 注册接口直接拿不到** |
| `permissions` | `net.fetch` + `filesystem.data` | 前者发网络请求，后者存 token |

> `experimental` 的写法参照 `mods/visualizer52hz/mod.json`：
> ```json
> "experimental": ["ponder.targets"]
> ```
> 规范说明：实验接口"需要在清单里显式选用"。

> 注意：**`auth`、`userLibrary`、`playlists` 不在可声明范围内**——它们是 `ProviderCapabilities` 里被写死 `false` 的字段（见 §5），写进清单也没用。

---

## 四、provider 实现（核心）

契约定义在 `src/mods/folium/contract.ts:1015`：

```ts
export interface FoliumOmniProviderDef {
    id: string;
    displayName: string;
    shortName?: string;
    search?(query: string, page: { limit: number; offset: number }):
        Promise<{ items: FoliumProviderSong[]; hasMore: boolean; total?: number }>;
    getSong?(id: string): Promise<FoliumProviderSong | null>;
    getAudioUrl?(song: FoliumProviderSong, quality: FoliumAudioQuality):
        Promise<{ url: string; expiresAt?: number } | null>;
    getLyrics?(song: FoliumProviderSong):
        Promise<{ lrc: string; translationLrc?: string } | null>;
}

export interface FoliumProviderSong {
    id: string;
    title: string;
    artists: string[];
    album?: string;
    coverUrl?: string;
    durationMs?: number;
}

export type FoliumAudioQuality = 'standard' | 'high' | 'lossless' | 'hires';
```

注册方式（`src/mods/folium/registries/omniProviders.ts`）：

```ts
folium.omni.providers.register({
  id: 'bodian',
  displayName: '波点音乐',
  shortName: '波点',
  search: ...,
  getSong: ...,
  getAudioUrl: ...,
  getLyrics: ...,
})
```

**校验规则**（写错会直接报错）：
- `search` / `getAudioUrl` / `getLyrics` **至少实现一个**，否则抛
  `omni.providers.register: implement at least one of search / getAudioUrl / getLyrics`
- 宿主内部 id 是 `folium.bodian`（点号分隔，避免与内置 provider 的 id 冲突）

### 4.1 与已有 `bodian` 库的复用关系

**大利好**：`main` 入口运行在主进程，**拥有完整 Node.js 权限**（规范原文：模组是"可信代码，不是沙箱"）。所以之前为 Any Listen 写的受限沙箱适配**全部可以扔掉**：

| 已有模块 | 能否直接复用 | 说明 |
|---|---|---|
| `src/sign.ts` | ✅ 直接复用 | md5 签名，Node `crypto` 可用 |
| `src/http.ts` | ✅ 基本复用 | Node `https` 可用（GET 带 body 不再是难题） |
| `src/api.ts` | ✅ 直接复用 | 端点封装 |
| `src/qualities.ts` | ✅ 直接复用 | 三档音质映射 |
| `src/probe.ts` | ✅ 按需 | 可用 `net.fetch` 或 Node 实现 Range 探测 |
| `src/normalize.ts` | ⚠️ 改造 | 输出要转成 `FoliumProviderSong` |
| `src/lx.ts` | ❌ 丢弃 | LX 专用，Folia 用不上 |
| 扩展的 `hostApi.ts` | ❌ 丢弃 | 那是 Any Listen 沙箱的桥接层 |

**音质映射**：

| Folia 档位 | 波点 `br` 参数 |
|---|---|
| `standard` | `128kmp3` |
| `high` | `320kmp3` |
| `lossless` | `2000kflac` |
| `hires` | `2000kflac`（兜底，该账号无真 hires） |

### 4.2 播放地址：沿用双通道策略

沿用已验证的选路（详见 `实现文档.md` §2.1）：

1. 先试**车机通道**（`nmobi.kuwo.cn/mobi.s?type=convert_url_with_sign`，匿名、无需签名）——普通歌给**完整 FLAC**；
2. 若返回片段（`< 60s`）或失败 → 走**会员通道**（`checkRight` → `audioUrl`，需 token）——VIP 歌给 320k；
3. 返回 `{ url }`，并带上 `expiresAt`（波点地址是带时效的，建议设为 `Date.now() + 30min`）。

### 4.3 歌词：直接喂 `awlrc`，不用自己修

Folia 的 `src/utils/lyrics/parserCore.ts` 有：

```ts
export type LyricParseFormat = TimedLyricFormat | 'yrc' | 'qrc' | 'krc' | 'awlrc';

/**
 * Parses the word-by-word track of a KuGou/LX `[awlrc:...]` container.
 * Unlike KRC, the line head carries only a start timestamp — the line end is derived from the last
 * syllable, whose `<offsetMs,durationMs>` marker is relative to the line start.
 */
export const parseAwlrc = (...) => { ... }
```

**关键代码**（它自己就修了酷我的毛病）：

```ts
let cursorMs = 0;
// Cursor repairs the zero-duration and backwards syllable markers KuGou occasionally emits.
const offsetMs  = Math.max(parseInt(wordMatch[1], 10), cursorMs);
const durationMs = Math.max(parseInt(wordMatch[2], 10), 1);
```

那句注释 **"repairs the zero-duration and backwards syllable markers KuGou occasionally emits"** 说明：**酷我/波点那种 `<1120,-1120>` 的负 duration，Folia 自己会兜住**。

**格式**（行头只有起始时间，字的 offset **相对行首**）：

```
[00:00.000]<0,1120>晴<1120,160>天<1280,1440>...
```

**所以 `getLyrics()` 只需返回波点原始逐字文本**（或经我们已有的 `normalizeAwlyric()` 再算一遍更保险），宿主用 `parseLRC(lrc, translationLrc)` 自动识别。翻译轨可以作为 `translationLrc` 单独给。

> 待实测确认：是否需要 `[awlrc:...]` 容器前缀包裹，还是裸 `<a,b>` 就能被 `parseLRC` 识别。这是接入后第一个要验的点。

---

## 五、能力边界（框架写死的部分，必须知道）

`registries/omniProviders.ts` 里，模组 provider 的能力表是**硬编码**的：

```ts
const capabilities: ProviderCapabilities = {
    search:  typeof def.search === 'function',       // ✅ 由你决定
    playback: typeof def.getAudioUrl === 'function', // ✅ 由你决定
    lyrics:  typeof def.getLyrics === 'function',    // ✅ 由你决定
    auth: false,              // ❌ 账号 —— 固定 false
    userLibrary: false,       // ❌ 用户曲库（个人歌单）—— 固定 false
    playlists: false,         // ❌ 歌单 —— 固定 false
    albums: false,            // ❌ 专辑
    artists: false,           // ❌ 歌手
    recommendations: false,   // ❌ 推荐
    mutations: false,         // ❌ 写操作
    wordByWordLyrics: false,  // ❌ 逐字歌词 —— 标记为 false
};
```

**这就是官方那句话的真正含义**：

> 尤其是 `omni.providers` 等 Omni provider 接口，仍属实验接口，尚不具备应用内置 Omni provider 的对等能力。

**读法**：
- `auth`/`userLibrary`/`playlists` 为 `false` → **框架不会提供"账号"与"歌单"的 UI 入口**，也不会把账号态暴露给宿主；
- `wordByWordLyrics: false` → **框架不认为模组源提供逐字歌词**。但注意：`getLyrics` 返回的 LRC **照样会被 `parseLRC` 解析**，而 `parseLRC` 是支持 `awlrc` 的。所以**逐字很可能实际可用，只是框架的能力标记不认**（待实测）。

---

## 六、两个"框架不管"的需求怎么办

### 6.1 登录（你的重点要求：**不要让你去文件夹**）

**框架不给 `auth` 能力，但登录根本不需要它** —— provider 是我自己写的代码，我可以在模组内部全流程实现：

```
┌─ client.mjs（渲染进程，你在界面上看到的部分）───────────────┐
│                                                            │
│  「波点音乐」设置页 / 命令面板项                             │
│      ↓ 点击「登录波点账号」                                  │
│  弹出模组自己的面板：                                        │
│    ┌──────────────────┐                                    │
│    │   ██ ▄▄ ██ ▄▄     │  ← 直接画二维码（canvas / SVG）      │
│    │   ▄▄ ██ ▄▄ ██     │     不用你去找任何文件               │
│    │   ██ ▄▄ ██ ▄▄     │                                    │
│    └──────────────────┘                                    │
│    状态：等待扫码… / 已扫码，请在手机上确认 / ✅ 登录成功      │
│                                                            │
└────────────────────────────────────────────────────────────┘
        │ rpc.call('login.start')      ▲ rpc 返回状态
        ▼                              │
┌─ index.cjs（主进程，完整 Node 权限）───────────────────────┐
│  1. GET  /api/ucenter/login/qrCode        → qrCode         │
│  2. 拼 URL 内容：                                          │
│     https://bodian-oia.kuwo.cn/bodian/download.html        │
│       ?pageName=login_pc&pt=3&id=<qrCode>                  │
│  3. 轮询 /login/qrCodeStatus（1=未扫 / 2=待确认 / 3=已确认） │
│  4. POST /api/ucenter/users/login {authType:10, qrCode}     │
│     → { id: uid, token, userInfo }                          │
│  5. folium.storage.set('auth', { uid, token, nickname })    │
└────────────────────────────────────────────────────────────┘
```

**落地点**：
- **二维码渲染**：`client.mjs` 里用 canvas 画（可以自带一个极简 QR 编码器，或让 `main` 把二维码渲染成 data URL 传过来）；
- **token 存储**：`folium.storage`（需 `filesystem.data` 权限，1 MB 上限，够用）；
- **免重复登录**：启动时若 storage 里有 token，先调一次轻量接口验证有效性（比如取一次用户信息），失效才提示重新扫码；
- **登录态对框架透明**：`getAudioUrl()` 内部读 storage 里的 token 走会员通道；没登录就退回匿名车机通道。

**这样你从头到尾只在 Folia 界面里点两下，扫一次码，不碰任何文件夹。**

### 6.2 个人歌单

框架的 `userLibrary` / `playlists` 能力被写死为 `false`，所以**没有现成的"把我的歌单灌进 Folia 列表"的通道**。可选路径（按推荐度）：

| 方案 | 做法 | 评价 |
|---|---|---|
| **A. 自己画一个列表界面** | `client.mjs` 用 `stageLayers` / `playerPanelTabs` / `commands` 注册一个"波点歌单"面板，自己 `net.fetch` 拉歌单、点击就播 | **最干净**，完全在模组内闭环，不碰宿主数据结构 |
| **B. `omni.hooks` 换源** | 用 `omni.audioSourceResolved` 把某些歌的地址替换掉 | 只解决"播不了"，不解决"看得到歌单" |
| **C. 直接写宿主的库** | 像在 Any Listen 里那样写 SQLite | ❌ 不推荐：需要 `internals` 通道钉死宿主版本，升级即坏 |

**建议先做 A**——因为 §6.1 的登录做完后，歌单接口（`userCreate` + `musicList`，`source=5`）我们已经完全掌握，画个列表界面就能用。

---

## 七、实施步骤（建议顺序）

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **S1** | 建 `mods/bodian-source/`，`mod.json` 只声明 `omni.providers`；`index.cjs` 实现最小 provider（`search` 返回固定一条假数据） | 「设置 → 实验室 → 模组系统」开启后，面板里出现该模组；启用时二次确认窗口正常；搜索能出这条假数据 |
| **S2** | 接入真实 `search`（复用 `bodian` 库的 `sign`/`http`/`api`） | Folia 搜索"晴天"能出 20 条，带封面与时长 |
| **S3** | 接入 `getAudioUrl`（双通道） | 点歌能播放；VIP 歌也能播；控制台能看到走了哪条通道 |
| **S4** | 接入 `getLyrics`（awlrc） | 全屏歌词逐字点亮；**确认是否要 `[awlrc:` 容器前缀** |
| **S5** | 登录：`client.mjs` 二维码 UI + `main` 轮询 + storage | **全程在界面里完成，不碰文件夹**；登录后音质提升 |
| **S6** | 个人歌单面板（方案 A） | 界面上能看到自己的歌单并点击播放 |

---

## 八、需要注意的坑（提前记下来）

1. **`experimental: ["omni.providers"]` 必须写**，否则注册接口拿不到（实验接口需显式 opt-in）。
2. **模组系统默认关闭**：要在「设置 → 实验室 → 模组系统」里开总开关，之后单个模组仍要**逐个二次确认**（原生窗口，默认按钮是「取消」）。
3. **信任绑定内容摘要**：任何文件改动都会使授权失效并**自动禁用**。但——规范里有一条对我们极有用的豁免：
   > 唯一的例外是**未打包的开发版**里、位于仓库 `mods/` 目录的模组：首次启用仍需确认，之后文件变化会把授权更新到新内容，方便开发调试。

   → **所以开发期就把模组放在仓库的 `mods/` 目录里**，改完文件不用反复重新确认。安装版不扫描仓库目录，用户目录（`userData/mods`）没有这个豁免。
4. **`wordByWordLyrics` 标记为 false**，但 `parseLRC` 支持 `awlrc`，两者可能不一致——S4 要实测。
5. **播放地址有时效**：`getAudioSource` 返回支持 `expiresAt`，务必填，否则长时间播放后切歌可能拿到过期地址。
6. **不要导出音频流**：规范明确禁止"导出 provider 原始音频流或解密后的音频文件"的模组（法律风险）。我们的做法是**只解析地址交给播放器**，不落盘、不解密。
7. **`getSong` 可选但有价值**：队列和历史里存的歌曲在重开后需要靠它还原详情（`sourceRef.mediaId` 保留的是模组的原始 id）。
8. **网络能力**：样例 `sample-progress-bar` 仅凭 `client` 就用了 `net.fetch`，说明渲染进程也能无 CORS 发请求；但**登录等敏感逻辑放 `main`** 更稳（完整 Node 权限，能直接用 `bodian` 库）。

---

## 九、调研结论

**可以做，而且比在 Any Listen 上做舒服得多**：

1. **官方劝阻的那句话，针对的是"上架官方市场"**。你的场景是自用本地模组，且规范里专门为"仓库 `mods/` 目录下的开发版模组"留了免反复确认的开发豁免——**作者本就预期有人在本地写模组**。
2. **三件核心事（搜索/播放/歌词）框架全包**，接口干净；逐字歌词甚至**原生支持 `awlrc`**，连酷我的负数标记都替我们修了。
3. **登录完全不受限**：`auth` 能力为 false 只意味着"框架不张罗账号"，而 provider 是自写代码，登录可以在模组内做到完全在界面里完成（二维码直接画在 Folia 里）。
4. **唯一需要迂回的是个人歌单**（`userLibrary`/`playlists` 写死 false）——建议自己画个面板，而不是去写宿主数据库。
5. **已有资产复用度高**：`bodian` 库的签名/HTTP/端点/音质映射模块可直接搬进 `main` 入口，只有输出格式和 LX 适配层要改。

---

## 附录：关键文件对照

| 用途 | 仓库路径 |
|---|---|
| 模组平台规范（42 KB，必读） | `mods/README.md` |
| 契约唯一来源 | `src/mods/folium/contract.ts` |
| provider 注册与宿主适配 | `src/mods/folium/registries/omniProviders.ts` |
| 实验接口说明 | `src/mods/folium/experimental.ts` |
| 歌词解析（含 awlrc） | `src/utils/lyrics/parserCore.ts`（`parseAwlrc` 约 1150 行） |
| provider 能力与类型 | `src/types/onlineMusic.ts` |
| 样例：纯 client + net.fetch / storage | `mods/sample-progress-bar/` |
| 样例：client → rpc → main | `mods/sample-transparent-mov-export/` |
| 样例：`experimental` 字段写法 | `mods/visualizer52hz/mod.json` |
