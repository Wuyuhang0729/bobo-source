# bobo-source · 波点音乐音源（Folia 模组）

[![Release](https://img.shields.io/github/v/release/Wuyuhang0729/bobo-source?label=release)](https://github.com/Wuyuhang0729/bobo-source/releases)
[![test](https://github.com/Wuyuhang0729/bobo-source/actions/workflows/test.yml/badge.svg)](https://github.com/Wuyuhang0729/bobo-source/actions/workflows/test.yml)

把「波点音乐」接成 [Folia](https://github.com/chthollyphile/folia-major) 的在线音源。

> [!IMPORTANT]
> **它需要一份宿主补丁才能完整工作。** 上游 Folia 把模组音源的 `auth` / `userLibrary` /
> `albums` / `recommendations` 一律写死为 `false`，也不转发对应接口，所以**官方原版 Folia 上
> 这个模组只能搜歌、播歌、看歌词**。补丁与逐项说明见 [`folia-本地改动清单.md`](folia-本地改动清单.md)。

---

## 🧭 先选一个

> [!TIP]
> 多数人只需要**第一个** —— 下载 `Folia-Setup-<版本>.exe`，装完就能用。

| 你想要的 | 用什么 | 能拿到 |
|---|---|---|
| ⭐ **只是想听歌（推荐）** | Release 里的 `Folia-Setup-<版本>.exe` | 全部功能 |
| 想要免安装的便携版 | Release 里的 `Folia-<版本>-win-unpacked.zip` | 全部功能，解压即用 |
| 已经有打过补丁的 Folia | Release 里的 `bodian-source-<版本>.zip` | 全部功能，拖进模组面板 |
| 只有官方原版 Folia | ⚠️ 光拖 zip **不够** | 只有搜索 / 播放 / 歌词 |
| **想自己构建 / 改代码** | [带补丁的 Folia fork](https://github.com/Wuyuhang0729/folia-major) | 全部功能（clone 即可） |

---

## ✨ 功能

| | 能力 | 说明 |
|---|---|---|
| 🔍 | **搜索** | 歌曲 + **歌单**（结果页有独立的「歌单」分区，可加载更多） |
| ▶️ | **播放** | 登录后按自己账号的权益取址；未登录退回官方试听片段 |
| 🎤 | **歌词** | 逐字歌词（宿主原生解析 `awlrc`，模组只回原始歌词） |
| 📚 | **曲库** | 我的歌单、收藏专辑、电台（私人 FM / 每日推荐 / 推荐歌单） |
| 👤 | **账号** | 扫码登录（波点音乐 App） |
| 🔄 | **刷新** | 歌单进首页自动刷新，手机上改完刷新一下就能看到 |

---

## 🚀 如何使用

### ① 装安装包（推荐，开箱即用）

1. 从 [Releases](https://github.com/Wuyuhang0729/bobo-source/releases) 下载 **`Folia-Setup-<版本>.exe`**
2. 双击安装，启动 Folia
3. 打开「**设置 → 系统 → 模组**」，找到「**波点音乐**」→ 点 **启用** → 在系统弹窗里点 **确认**
4. 回到首页，把平台切到「**波点音乐**」，点账号区域 **扫码登录**（用波点音乐 App 扫）

> [!IMPORTANT]
> 第 3 步只需要做一次。之后**只要模组文件变了**（更新模组、或你自己改了它的文件），
> 授权会失效、需要再确认一次 —— 这是 Folia 的安全机制（授权按内容摘要绑定），不是故障。

### ② 免安装便携版

1. 下载 `Folia-<版本>-win-unpacked.zip`，解压到任意目录
2. 双击里面的 `Folia.exe`
3. 然后照上面 ① 的第 3、4 步操作

### ③ 已经有「打过补丁」的 Folia

把 `bodian-source-<版本>.zip` 拖进「设置 → 系统 → 模组」面板，然后照上面 ① 的第 3、4 步操作。

> [!WARNING]
> **只有官方原版 Folia 的话，光装模组 zip 只能搜歌 / 播歌 / 看歌词** —— 登录、歌单、专辑、
> 电台、搜歌单都用不了。要完整体验请用 ① 的安装包，或按下方「🔧 从源码构建」自己打补丁。

---

## 🎧 音质

| 通道 | 条件 | 实测结果 |
|---|---|---|
| **账号通道** | 已登录 | 320k / 128k mp3，**全曲**，支持拖动进度 —— 默认走这条 |
| 官方试听 | 未登录 | 前 29 秒片段（官方给匿名身份的能力） |
| 车机通道 | 无需登录 | 整曲，普通歌甚至给完整 FLAC —— **默认关闭** |

> [!NOTE]
> 车机通道不需要登录就能拿到整曲，远超官方给匿名的试听额度，因此默认关闭 —— 代价是**没有无损**。
> 仅自用可以在 `folia/mods/bodian-source/index.cjs` 里把 `ALLOW_CAR_CHANNEL` 改成 `true`。

---

## 🔧 从源码构建

Folia 本体用**已经带补丁的 fork**（[`Wuyuhang0729/folia-major`](https://github.com/Wuyuhang0729/folia-major)，
默认分支 `bobo-source` 就是「上游 + 本仓库的补丁」），所以不用再手工 `git am`：

```powershell
git clone https://github.com/Wuyuhang0729/bobo-source.git BoDianBoFangQi
cd BoDianBoFangQi

# 1) 音源核心库 → 供模组 vendored 使用
cd any-listen; npm install; npm run build:cjs; cd ..

# 2) Folia 本体（默认分支已含宿主补丁）
git clone https://github.com/Wuyuhang0729/folia-major.git folia
cd folia; npm install; cd ..

# 3) 把库产物与运行期依赖同步进模组
node tools/sync-bodian-vendor.mjs
node tools/sync-mod-deps.mjs

# 4) 开发运行（vite + Electron；dev 模式弹出的 DevTools 会被脚本自动关掉）
tools\start-folia.bat

# 或者出安装包 / 免安装版
node tools/build-installer.mjs --dry-run   # 先看会做什么
node tools/build-installer.mjs             # 产物在 folia/release/ 与 tools/out/
```

### 跟进上游更新

那个 fork 的 `bobo-source` 分支 = 上游 `main` + 本仓库的 3 个补丁提交。上游有更新时：

```powershell
cd folia
git remote add upstream https://github.com/chthollyphile/folia-major.git   # 只需一次
git fetch upstream main
git merge upstream/main     # 冲突时按 folia-本地改动清单.md 的「依赖矩阵」分项处理
```

### 补丁本身在本仓库（备选做法）

不想用 fork、或想基于自己那份 Folia 时，补丁也可以单独应用：

```powershell
node tools/apply-patch.ps1            # 自动 clone 上游 + git am（失败回退 git apply -3）
# 或者手工：
git clone https://github.com/chthollyphile/folia-major folia
cd folia; git am ../tools/folia-local-changes.patch
```

补丁基于上游 `6a27d43`（`git am` 失败时用 `git apply -3` 做三方合并）。

---

## 🧩 兼容性

| 组件 | 当前 | 备注 |
|---|---|---|
| 模组 | **0.3.1** | `folia/mods/bodian-source/mod.json`，独立版本号 |
| 宿主源码（推荐） | fork 的 `bobo-source` 分支 | [Wuyuhang0729/folia-major](https://github.com/Wuyuhang0729/folia-major) = 上游 `6a27d43` + 3 个补丁提交，可用 `git merge upstream/main` 跟进上游 |
| 宿主补丁（备选） | 基于上游 `6a27d43` | `tools/folia-local-changes.patch`（3 个提交） |
| 内嵌 Folia | **0.7.11** | 上游版本号，与模组版本无关 |
| Folium 模组平台 | 1 | `mod.json` 的 `folium: 1` |

---

## 📁 目录结构

| 路径 | 说明 |
|---|---|
| `folia/mods/bodian-source/` | **模组本体**：`index.cjs`（主进程，与上游接口的全部交互）、`client.mjs`（provider 注册）、`lib/`（纯逻辑，可单测）、`test/`（单测）、`NOTES.md`（调试札记） |
| `any-listen/` | 波点音源核心库（TypeScript，模组 vendored 它的 CJS 产物） |
| `tools/folia-local-changes.patch` | 宿主侧补丁（对 Folia 的修改） |
| `tools/` | 启动 / 自检 / 打包脚本 |
| `folia-接入方案.md`、`folia-本地改动清单.md` | 接入调研，以及「改了什么、怎么还给上游」的对照清单 |

---

## 🩺 排查

### 源码环境

```powershell
node tools/doctor.mjs        # 四级自检：vite → CDP 页面 → provider 注册 → 模组状态/重复
node tools/probe-bodian.mjs  # 端到端探针：搜索(歌曲/歌单) / FM / 每日推荐 / 歌单 / 专辑与曲目
node tools/test-mod.mjs      # 模组单测（字段映射、id 编解码、失败分类）
```

真机踩过的坑都记在 [`folia/mods/bodian-source/NOTES.md`](folia/mods/bodian-source/NOTES.md)
（打包版白屏、模组重复导致平台消失、授权记录被清空、EPIPE 打崩主进程…… 都带排查步骤）。

### 装的是安装包时

| 想知道 | 看哪里 |
|---|---|
| 模组有没有启用 | `%APPDATA%\Folia\mod-system.json` → `mods.enabled["bodian-source"].enabled` |
| 登录态在不在 | `%APPDATA%\Folia\mods-data\bodian-source\mod-data.json`（**含 token，别外发**） |
| 日志 | 默认**不落盘**：先在「设置 → 开发者」里打开日志保存，之后写到 `%APPDATA%\Folia\logs\` |
| 老是提示「发现新版本」 | 那是 Folia 自己的更新检查，设置里可以关掉 |

---

## ⚠️ 说明与免责

- 非官方项目：与 Folia、波点音乐、酷我及其运营方均无关联，未经任何一方认可。
- 仓库**不含任何音频内容**：不解密 DRM、不转存、不导出，只解析播放地址交给播放器；登录凭据由使用者
  自己扫码获得，只存在本机。
- 使用本项目会**违反平台用户协议**，请自行判断并承担风险；作者不对任何后果负责。若权利人提出异议，
  将配合下线。条款原文与相关判例整理见 [docs/合规调研.md](docs/合规调研.md)。

## 📄 许可

**AGPL-3.0**。`tools/folia-local-changes.patch` 是对
[Folia](https://github.com/chthollyphile/folia-major)（AGPL-3.0）的修改，含 Folia 二进制的产物
（如 `Folia-Setup-*.exe`）按 AGPL-3.0 分发，对应源码 = 本仓库 + 上游仓库。
完整条款见 [LICENSE](LICENSE)，上游来源与修改说明见 [NOTICE](NOTICE)。
