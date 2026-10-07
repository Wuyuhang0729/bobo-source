# 波点音乐音源 · Folia 模组

把「波点音乐」接成 [Folia](https://github.com/chthollyphile/folia-major) 的在线音源。
另附一份**宿主侧补丁** —— 因为上游的模组接口把「登录 / 歌单 / 专辑 / 电台 / 搜歌单」一律写死为不支持，
不让模组碰，所以这几项必须在宿主侧补齐。

> **非官方项目**：与 Folia、波点音乐、酷我均无关联，也未获任何一方认可或授权。
>
> 本仓库**不含任何音频内容**：不解密 DRM、不转存、不导出、不落盘音频文件，只解析播放地址交给播放器。
> 登录凭据（token）由使用者自己扫码获得，仅存于本机模组存储。
>
> **取址只走你自己账号的权益**（详见「音质」一节）。仅供个人学习与自用。

## 能力

- **搜索**：歌曲 + **歌单**（结果页有独立的「歌单」分区，可加载更多）
- **播放**：登录后按自己账号的权益取址；未登录退回官方试听片段
- **逐字歌词**：宿主原生支持 `awlrc`，模组只回原始歌词
- **我的歌单 / 收藏专辑 / 电台**（私人 FM、每日推荐、推荐歌单），歌单进首页自动刷新
- **扫码登录**：用波点音乐 App 扫二维码

## 音质（重要，请先读）

| 通道 | 条件 | 实测结果 | 本仓库默认 |
|---|---|---|---|
| 账号通道 | 已登录 | 320k / 128k mp3，**全曲**，支持 Range | ✅ 使用 |
| 官方试听 | 未登录 | 前 29 秒片段（官方给匿名身份的能力） | ✅ 使用 |
| 车机通道 | 无需登录 | 整曲，普通歌甚至给**完整 FLAC** | ❌ **默认关闭** |

车机通道不需要登录就能拿整曲（远超过官方给匿名的试听额度），公开分发时属于"提供规避手段"，
因此默认关闭。**代价是失去无损**：账号通道实测不返回 FLAC，音质上限 320k mp3。

如果你仅自用、清楚自己在做什么，可以打开 `folia/mods/bodian-source/index.cjs` 里的
`ALLOW_CAR_CHANNEL = true` 拿回无损。

## 三种用法

| 场景 | 做法 |
|---|---|
| 已有 Folia，只装模组 | 从 [Releases](../../releases) 下载 `bodian-source-<版本>.zip`，拖进「设置 → 系统 → 模组」面板，首次需在原生弹窗里确认启用一次 |
| 想要开箱即用 | 下载 Release 里的 `Folia-Setup-<版本>.exe` 安装；启动后在「设置 → 系统 → 模组」里确认启用「波点音乐」 |
| 从源码跑 / 改代码 | 见下 |

> 安装包内嵌了 Folia 本体，因此同时受 AGPL-3.0 约束（见「许可」）；不需要它就用第一种方式。

## 从源码构建

本仓库**不含** Folia 本体（上游是独立仓库），需要自己拉一份并应用补丁：

```powershell
git clone <本仓库> BoDianBoFangQi
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

# 4) 开发运行（vite + Electron，DevTools 会自动关掉）
tools\start-folia.bat

# 或者出一份安装包 / 免安装版
node tools/build-installer.mjs --dry-run   # 先看会做什么
node tools/build-installer.mjs             # folia/release/ 下产出绿色版与 Setup
```

## 目录

| 路径 | 说明 |
|---|---|
| `folia/mods/bodian-source/` | **模组本体**：`index.cjs`（主进程 / 与上游接口的全部交互）、`client.mjs`（provider 注册）、`lib/`（纯逻辑，可单测）、`test/`（单测）、`NOTES.md`（调试札记） |
| `any-listen/` | 波点音源核心库（TypeScript，模组 vendored 它的 CJS 产物） |
| `tools/folia-local-changes.patch` | 宿主侧补丁（对 Folia 的修改，AGPL-3.0） |
| `tools/` | 启动 / 自检 / 打包脚本（`doctor` / `probe` / `pack-mod` / `build-installer` …） |
| `folia-接入方案.md`、`folia-本地改动清单.md` | 接入调研与「改了什么、怎么还给上游」的对照清单 |

## 自检与排查

```powershell
node tools/doctor.mjs        # 四级自检：vite → CDP 页面 → provider 注册 → 模组状态/重复
node tools/probe-bodian.mjs  # 端到端探针：搜索(歌曲/歌单) / FM / 每日推荐 / 歌单 / 专辑与曲目
node tools/test-mod.mjs      # 模组单测（字段映射、id 编解码、失败分类）
```

真机踩过的坑都记在 `folia/mods/bodian-source/NOTES.md`（打包版白屏、模组重复导致平台消失、
授权记录被清空、EPIPE 打崩主进程…… 都有排查步骤）。

## 许可

- `tools/folia-local-changes.patch` 是对 [Folia](https://github.com/chthollyphile/folia-major)（AGPL-3.0）的**修改**，同样以 **AGPL-3.0** 提供；
- 本仓库中发布或分发的、包含 Folia 代码或其二进制（含 `Folia-Setup-*.exe`）的产物，均按 AGPL-3.0 分发 —— 对应源码即本仓库 + 上游仓库（补丁基点在 `tools/folia-local-changes.patch` 的提交信息里）；
- 模组本体（`folia/mods/bodian-source/`）与 `any-listen/` 库：**AGPL-3.0**。

完整条款见 [LICENSE](LICENSE)，上游来源与修改说明见 [NOTICE](NOTICE)。

## 免责

本项目仅供个人学习与自用。使用者需自行确保其使用方式符合当地法律及相关服务条款（包括但不限于
所用账号的服务协议）；作者不对使用后果承担任何责任。若相关权利人提出异议，将立即配合下线。
