# bobo-source · 波点音乐音源（Folia 模组）

[![Release](https://img.shields.io/github/v/release/Wuyuhang0729/bobo-source?label=release)](https://github.com/Wuyuhang0729/bobo-source/releases)

把「波点音乐」接成 [Folia](https://github.com/chthollyphile/folia-major) 的在线音源。

另附一份**宿主侧补丁**：上游的模组接口把「登录 / 歌单 / 专辑 / 电台 / 搜歌单」写死为不支持，
所以这几项得在宿主侧补齐 —— 补丁与改动说明见
[`folia-本地改动清单.md`](folia-本地改动清单.md)。

## 功能

| 能力 | 说明 |
|---|---|
| 搜索 | 歌曲 + **歌单**（结果页有独立的「歌单」分区，可加载更多） |
| 播放 | 登录后按自己账号的权益取址；未登录退回官方试听片段 |
| 歌词 | 逐字歌词（宿主原生解析 `awlrc`，模组只回原始歌词） |
| 曲库 | 我的歌单、收藏专辑、电台（私人 FM / 每日推荐 / 推荐歌单） |
| 账号 | 扫码登录（波点音乐 App） |
| 刷新 | 歌单进首页自动刷新，手机上改完刷新一下就能看到 |

## 安装

| 你的情况 | 做法 |
|---|---|
| 已经有 Folia | 从 [Releases](https://github.com/Wuyuhang0729/bobo-source/releases) 下载 `bodian-source-<版本>.zip`，拖进「设置 → 系统 → 模组」面板 |
| 想要开箱即用 | 下载 `Folia-Setup-<版本>.exe` 安装（里面已经带了这个音源） |
| 想改代码 | 见下方「从源码构建」 |

> 首次使用需要在「设置 → 系统 → 模组」里**确认启用一次**（模组拥有应用完整权限，宿主要求逐个模块确认）。

## 音质

| 通道 | 条件 | 实测结果 |
|---|---|---|
| **账号通道** | 已登录 | 320k / 128k mp3，**全曲**，支持拖动进度 —— 默认走这条 |
| 官方试听 | 未登录 | 前 29 秒片段（官方给匿名身份的能力） |
| 车机通道 | 无需登录 | 整曲，普通歌甚至给完整 FLAC —— **默认关闭** |

车机通道不需要登录就能拿到整曲，远超官方给匿名的试听额度，因此默认关闭，代价是**没有无损**。
仅自用可以在 `folia/mods/bodian-source/index.cjs` 里把 `ALLOW_CAR_CHANNEL` 改成 `true`。

## 从源码构建

本仓库**不含** Folia 本体（上游是独立仓库），需要自己拉一份并应用补丁：

```powershell
git clone https://github.com/Wuyuhang0729/bobo-source.git BoDianBoFangQi
cd BoDianBoFangQi

# 1) 音源核心库 → 供模组 vendored 使用
cd any-listen; npm install; npm run build:cjs; cd ..

# 2) 上游 Folia + 宿主侧补丁
git clone https://github.com/chthollyphile/folia-major folia
cd folia; npm install
git am ../tools/folia-local-changes.patch     # 补丁基于上游 6a27d43；上游前进后用 git apply -3
cd ..

# 3) 把库产物与运行期依赖同步进模组
node tools/sync-bodian-vendor.mjs
node tools/sync-mod-deps.mjs

# 4) 开发运行（vite + Electron；dev 模式弹出的 DevTools 会被脚本自动关掉）
tools\start-folia.bat

# 或者出安装包 / 免安装版
node tools/build-installer.mjs --dry-run   # 先看会做什么
node tools/build-installer.mjs             # 产物在 folia/release/
```

## 目录结构

| 路径 | 说明 |
|---|---|
| `folia/mods/bodian-source/` | **模组本体**：`index.cjs`（主进程，与上游接口的全部交互）、`client.mjs`（provider 注册）、`lib/`（纯逻辑，可单测）、`test/`（单测）、`NOTES.md`（调试札记） |
| `any-listen/` | 波点音源核心库（TypeScript，模组 vendored 它的 CJS 产物） |
| `tools/folia-local-changes.patch` | 宿主侧补丁（对 Folia 的修改） |
| `tools/` | 启动 / 自检 / 打包脚本 |
| `folia-接入方案.md`、`folia-本地改动清单.md` | 接入调研，以及「改了什么、怎么还给上游」的对照清单 |

## 自检与排查

```powershell
node tools/doctor.mjs        # 四级自检：vite → CDP 页面 → provider 注册 → 模组状态/重复
node tools/probe-bodian.mjs  # 端到端探针：搜索(歌曲/歌单) / FM / 每日推荐 / 歌单 / 专辑与曲目
node tools/test-mod.mjs      # 模组单测（字段映射、id 编解码、失败分类）
```

真机踩过的坑都记在 [`folia/mods/bodian-source/NOTES.md`](folia/mods/bodian-source/NOTES.md)
（打包版白屏、模组重复导致平台消失、授权记录被清空、EPIPE 打崩主进程…… 都带排查步骤）。

## 说明与免责

- 非官方项目：与 Folia、波点音乐、酷我及其运营方均无关联，未经任何一方认可。
- 仓库**不含任何音频内容**：不解密 DRM、不转存、不导出，只解析播放地址交给播放器；登录凭据由使用者
  自己扫码获得，只存在本机。
- 使用本项目会**违反平台用户协议**，请自行判断并承担风险；作者不对任何后果负责。若权利人提出异议，
  将配合下线。条款原文与相关判例整理见 [docs/合规调研.md](docs/合规调研.md)。

## 许可

**AGPL-3.0**。`tools/folia-local-changes.patch` 是对
[Folia](https://github.com/chthollyphile/folia-major)（AGPL-3.0）的修改，含 Folia 二进制的产物
（如 `Folia-Setup-*.exe`）按 AGPL-3.0 分发，对应源码 = 本仓库 + 上游仓库。
完整条款见 [LICENSE](LICENSE)，上游来源与修改说明见 [NOTICE](NOTICE)。
