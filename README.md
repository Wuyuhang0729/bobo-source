# bobo-source · 波点音乐音源（Folia 模组）

[![Release](https://img.shields.io/github/v/release/Wuyuhang0729/bobo-source?label=release)](https://github.com/Wuyuhang0729/bobo-source/releases)
[![test](https://github.com/Wuyuhang0729/bobo-source/actions/workflows/test.yml/badge.svg)](https://github.com/Wuyuhang0729/bobo-source/actions/workflows/test.yml)

把「波点音乐」接成 [Folia](https://github.com/chthollyphile/folia-major) 的在线音源。


## 🧭 先选一个

> [!TIP]
> 多数人只要**第一个** —— 装完就是「波点音乐版 Folia」，补丁已经在里面了。

| 你想要的 | 用什么 | 能拿到 |
|---|---|---|
| ⭐ **只是想听歌（推荐）** | [下载 `Folia-Setup-<版本>.exe`](https://github.com/Wuyuhang0729/bobo-source/releases/latest)（附件里最大的那个） | 全部功能 |
| 免安装便携版 | [下载 `Folia-<版本>-win-unpacked.zip`](https://github.com/Wuyuhang0729/bobo-source/releases/latest) | 全部功能，解压即用 |
| 已有**打过补丁**的 Folia | `bodian-source-<版本>.zip`，拖进模组面板 | 全部功能 |
| 只有官方原版 Folia | ⚠️ 光拖 zip 不够 | 只有搜索 / 播放 / 歌词 |
| 想自己构建 / 改代码 | [带补丁的 Folia fork](https://github.com/Wuyuhang0729/folia-major) | 全部功能，clone 即可 |

## ✨ 功能

| | 能力 | 说明 |
|---|---|---|
| 🔍 | **搜索** | 歌曲 + **歌单**（独立分区，可加载更多） |
| ▶️ | **播放** | 登录后按自己账号权益取址；未登录退回官方试听片段 |
| 🎤 | **歌词** | 逐字歌词（宿主解析 `awlrc`，模组只回原始歌词） |
| 📚 | **曲库** | 我的歌单、收藏专辑、电台（私人 FM / 每日推荐 / 推荐歌单） |
| 👤 | **账号** | 扫码登录（波点音乐 App） |
| 🔄 | **刷新** | 歌单进首页自动刷新 |

<!-- GIF:search      搜索（歌曲 +「歌单」分区）。删掉此行粘贴动图，建议：<img src="GIF地址" width="820" alt="搜索"> -->
<!-- GIF:playlists   歌单页。建议：<img src="GIF地址" width="820" alt="歌单"> -->
<!-- GIF:now-playing 播放页逐字歌词。建议：<img src="GIF地址" width="820" alt="逐字歌词"> -->

## 🚀 如何使用

### ① 安装包（推荐，开箱即用）

1. 从 [Releases](https://github.com/Wuyuhang0729/bobo-source/releases/latest) 下载 `Folia-Setup-<版本>.exe`（约 141 MB）
2. 双击安装 —— 普通安装向导（可选目录，装完有桌面 / 开始菜单快捷方式）
3. 启动 Folia → 「**设置 → 系统 → 模组**」→ 找到「**波点音乐**」→ **启用** → 弹窗点 **确认**（默认停在「取消」，看清再点）

    <!-- GIF:enable-mod  启用「波点音乐」+ 系统确认弹窗。建议：<img src="GIF地址" width="820" alt="启用模组"> -->

4. 回到首页 → 平台切到「**波点音乐**」→ 点账号区域 **扫码登录**（波点音乐 App 扫）

    <!-- GIF:login-qr    扫码登录弹窗（录弹窗出现即可）。建议：<img src="GIF地址" width="820" alt="扫码登录"> -->

> [!WARNING]
> 安装包**未做代码签名**：Windows 会弹「已保护你的电脑」→ 点「**更多信息**」→「**仍要运行**」；杀软误报属常见，加信任即可。
> 第 3 步只需一次 —— 之后**只要模组文件变了**授权就失效、要再确认一次（Folia 按内容摘要绑定授权，不是故障）。

### ② 免安装便携版

解压 `Folia-<版本>-win-unpacked.zip` 到任意目录 → 双击里面的 `Folia.exe` → 照上面第 3、4 步。

### ③ 已有「打过补丁」的 Folia

把 `bodian-source-<版本>.zip` 拖进「设置 → 系统 → 模组」→ 照上面第 3、4 步。

## 🎧 音质

| 通道 | 条件 | 实测结果 |
|---|---|---|
| **账号通道** | 已登录 | 320k / 128k mp3，**全曲**，可拖动进度 —— 默认走这条 |
| 官方试听 | 未登录 | 前 29 秒片段 |
| 车机通道 | 无需登录 | 整曲，甚至完整 FLAC —— **默认关闭** |

车机通道不需要登录就能拿整曲，远超官方给匿名的额度，因此默认关闭，代价是**没有无损**；仅自用可把
`folia/mods/bodian-source/index.cjs` 里的 `ALLOW_CAR_CHANNEL` 改成 `true`。

## 🔧 从源码构建

Folia 本体用**带补丁的 fork**（`bobo-source` 分支 = 上游 + 本仓库补丁），不用手工 `git am`：

```powershell
git clone https://github.com/Wuyuhang0729/bobo-source.git BoDianBoFangQi; cd BoDianBoFangQi
cd any-listen; npm install; npm run build:cjs; cd ..                     # 音源核心库
git clone https://github.com/Wuyuhang0729/folia-major.git folia
cd folia; npm install; cd ..                                             # Folia（默认分支已含补丁）
node tools/sync-bodian-vendor.mjs; node tools/sync-mod-deps.mjs          # 同步库产物与依赖
tools\start-folia.bat                                                    # 开发运行
node tools/build-installer.mjs                                           # 出安装包 / 免安装版
```

跟进上游更新：`cd folia; git remote add upstream https://github.com/chthollyphile/folia-major.git; git fetch upstream main; git merge upstream/main`
（冲突按 `folia-本地改动清单.md` 的依赖矩阵分项处理）。
不想用 fork、或想基于自己那份 Folia：`node tools/apply-patch.ps1`（补丁基于上游 `6a27d43`，失败回退 `git apply -3`）。
> [!IMPORTANT]
> **它需要一份宿主补丁才能完整工作**：上游 Folia 把模组音源的 `auth` / `userLibrary` / `albums` /
> `recommendations` 写死为 `false` 且不转发接口，所以**官方原版 Folia 上只能搜歌、播歌、看歌词**。
> 补丁与逐项说明见 [`folia-本地改动清单.md`](folia-本地改动清单.md)。

## 🧩 版本

| 组件 | 当前 | 备注 |
|---|---|---|
| 模组 | **0.3.1** | 独立版本号 |
| 内嵌 Folia | **0.7.11** | 上游版本号，与模组版本无关 |
| Folium 模组平台 | 1 | `mod.json` 的 `folium: 1` |
| 宿主补丁 / fork | 上游 `6a27d43` + 3 个提交 | `tools/folia-local-changes.patch` |

## 🩺 排查

```powershell
node tools/doctor.mjs        # 四级自检：vite → CDP 页面 → provider 注册 → 模组状态/重复
node tools/probe-bodian.mjs  # 端到端探针：搜索 / FM / 每日推荐 / 歌单 / 专辑
node tools/test-mod.mjs      # 模组单测
```

| 装的是安装包时 | 看哪里 |
|---|---|
| 模组是否启用 | `%APPDATA%\Folia\mod-system.json` → `mods.enabled["bodian-source"].enabled` |
| 登录态 | `%APPDATA%\Folia\mods-data\bodian-source\mod-data.json`（**含 token，别外发**） |
| 日志 | 默认不落盘：先在「设置 → 开发者」打开日志保存，之后写到 `%APPDATA%\Folia\logs\` |

真机踩过的坑见 [`NOTES.md`](folia/mods/bodian-source/NOTES.md)（打包版白屏、模组重复、授权被清空、EPIPE 打崩主进程）。

## ⚠️ 说明与许可

- 非官方项目：与 Folia、波点音乐、酷我及其运营方均无关联。
- 仓库**不含音频内容**：不解密 DRM、不转存、不导出，只解析播放地址交给播放器；登录凭据由使用者自己扫码获得，只存在本机。
- 使用本项目会**违反平台用户协议**，请自行判断并承担风险；作者不对后果负责，权利人提出异议即配合下线。条款原文与判例见 [docs/合规调研.md](docs/合规调研.md)。
- 许可 **AGPL-3.0**：`tools/folia-local-changes.patch` 是对 [Folia](https://github.com/chthollyphile/folia-major)（AGPL-3.0）的修改；含 Folia 二进制的产物按 AGPL-3.0 分发，对应源码 = 本仓库 + 上游仓库。见 [LICENSE](LICENSE)、[NOTICE](NOTICE)。
