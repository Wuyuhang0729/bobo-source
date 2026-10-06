# Folia 本地改动清单（上游对齐用）

> 这份文档回答三个问题：我们对上游 Folia 做了什么、每一项有多重要、将来怎么还给上游。
> 补丁本体：`tools/folia-local-changes.patch`（重放：`cd folia && git am ../tools/folia-local-changes.patch`）。

## 一、改动总览

| 文件 | 改动 | 不合并的后果 |
|---|---|---|
| `src/mods/folium/contract.ts` | 新增 `FoliumOmniProviderAuth` / `...Library` / `...Recommendations` 契约、`getAlbumTracks`、`providerData` 回传 | **必须**：没有这些类型，模组侧声明 auth/library 在 TS 里就不合法 |
| `src/mods/folium/registries/omniProviders.ts` | 把 `capabilities` 从写死 false 改为按 `def` 判定，并转发 auth / library / catalog / recommendations | **必须**：否则没有登录入口，歌单/专辑/电台 tab 全禁用，且**搜索永远搜不到这个源**（搜索跟随 tab） |
| `src/hooks/useOnlineProviderPlatform.ts` | 模组 provider 的账号刷新 / 退出登录通用兜底 | 重要：否则账号永远 `resolving`，歌单拉不出来 |
| `src/hooks/useHomeProviderRefresh.ts` | 账号未 hydrate 时不触发歌单刷新（竞态） | 重要：否则进首页那次刷新会被吞掉 |
| `src/components/Grid3D.tsx` | `LOGIN_COPY_BY_PROVIDER` 增加 `folium.bodian-source.bodian` | 体验：否则弹窗写成「使用网易云APP扫码」 |
| `src/i18n/locales/{en,in,zh-CN}.ts` | `loginTitleBodian` / `loginNoteBodian` | 同上 |
| `package.json`（build.extraResources） | 把 `mods/bodian-source` 打进 `resources/mods/` | 交付：否则安装包不带模组（仍可用 zip 安装） |
| `src/types/onlineMusic.ts` | `OnlineSearchProvider.searchCollections?` | 搜索歌单：上游搜索只回歌曲，音源"能搜歌单"原本无处返回 |
| `src/services/onlineMusic/omni.ts` | `searchCollections` / `searchProviderCollections` | 同上；未实现的音源返回空页（不抛错，内置源行为不变） |
| `src/stores/useSearchNavigationStore.ts` | 歌单搜索结果（best-effort，与歌曲搜索并行） | 否则搜索页拿不到歌单数据 |
| `src/components/app/search/SearchCollectionCard.tsx` | **新文件**：歌单卡片 | 搜索页「歌单」分区的渲染单元 |
| `src/components/app/search/SearchWorkspace.tsx` | 结果区加「歌单」分区（空态判断同时看两者） | 没有它用户看不到任何歌单结果 |
| `src/components/app/overlays/buildAppOverlaysModel.ts` + `src/App.tsx` | 把「点开歌单」接到既有 `navigateToCollection` | 否则卡片点不动 |

## 二、逐项要点（回上游时要解释的东西）

### 1. `contract.ts` —— 契约面扩展
围绕一个事实：上游把模组 provider 的 `auth`、`userLibrary`、`playlists`、`albums`、`recommendations` 一律写成 `false`，而契约里连对应的 **def 类型**都没有。我们补的是「类型 + 字段」，语义全部与既有约定保持同构：

- `providerData` 直接复用宿主 `ProviderCollection` 已有字段，不是新概念；
- `getCollectionTracks(id, page, providerData)` 的第三参数是**可选**的，旧调用点不受影响；
- `recommendations` 的三个成员全部可选，缺哪个哪个卡片为空。

**回上游时的建议形态**：把 `contract.ts` 的这部分当"实验接口的补齐"单独一个 PR；`capabilities` 判定逻辑改成分项可选（我们已经是这个形态），便于上游按能力逐个放开。

### 2. `registries/omniProviders.ts` —— 适配层
关键点两条：
- `capabilities` 不再硬编码，而是 `typeof def.xxx === 'function'`；
- `validate` 放宽为"search / getAudioUrl / getLyrics / auth 四选一"（原逻辑要求前三者之一，纯登录模组会被拒）。

**回上游时的建议形态**：这段是纯增量，最容易合并；但要注意上游若同时定义了自己的 `recommendations` 形状，需要先对齐字段名（宿主侧是 `getPersonalFm` / `getDailySongs` / `getRecommendedCollections`）。

### 3. `hooks` —— 模组 provider 的兜底
内置平台各有自己的 `useXxxLibrary` hook 负责填账号；模组 provider 没有 hook，于是：
- 刷新时不查表 → 回落到 `omni.getLoginStatus(providerId)`；失败按"匿名已就绪"处理；
- 退出登录同理，兜底把账号落到 `anonymous`；
- `useHomeProviderRefresh` 里显式等一次账号 hydrate，否则那次刷新读到空 `user.id` 直接返回 `[]`。

**回上游时的建议形态**：这两处可以合并成一个 `useModProviderAccount` 之类的小 hook，上游更容易接受"一个模块"而不是"两处特判"。

### 4. `Grid3D.tsx` + i18n —— 登录文案
`LOGIN_COPY_BY_PROVIDER` 按 **运行时全名** `folium.<modid>.<providerId>` 索引（写成 `folium.bodian` 会静默回退网易云文案）。回上游时的形态：文案表改成按 provider 声明（例如 `def.loginCopy`），而不是在 Grid3D 里加字符串常量。

### 5. `package.json` —— 安装包内嵌模组
`extraResources` 用 `from: "mods" + filter: ["bodian-source/**/*"]` 的写法，**仓库里没有这个模组时也不会打包失败**（filter 无匹配即跳过），这是为了上游克隆不包含私人模组时仍能出包。

### 6. 搜索歌单 —— 从契约到界面的四处扩展
上游的搜索只回歌曲（`OnlineSearchProvider` 只有 `searchSongs`，内置三个源也没搜过歌单），所以"音源能搜歌单"这件事在上游根本没有出口。这条链上一共四处：

- `types/onlineMusic.ts`：`searchCollections?`（**可选**，不实现就等于没这个能力）；
- `omni.ts`：`searchCollections` / `searchProviderCollections`，未实现时返回空页而不抛错；
- `useSearchNavigationStore`：与歌曲**并行**取歌单结果，单独 try/catch —— 歌单失败只是"分区不显示"，不能把整次搜索拖成失败；
- 界面：`SearchWorkspace` 的「歌单」分区 + `SearchCollectionCard`，点开复用既有的 `navigateToCollection(..., 'search')`。

**回上游时的建议形态**：这是一条完整的上游级能力（任何 provider 都能实现），最适合整体提一个 PR：契约 + omni + store + UI 一起，四个内置源先不实现，行为与现在完全一致。

**另外两个必须一起改的点**（否则用户会看到"搜不到歌单"）：

- **搜索源要对齐当前平台**：`searchSourceTab` 与激活平台是两份状态，平台切到波点后它可能仍是
  `netease`，而 `netease` 不在音源 tab 列表里（界面上没有高亮）—— 用户以为在搜波点，实际搜的是
  网易云。现在打开搜索覆盖层时对齐，并新增 `setSearchSourceTab`。
- **歌单结果要进缓存**：`restoreSearch`（前进/后退恢复历史）原本会把歌单清空。现在
  `searchCache` 同时存 `results` 与 `collections`（含 `collectionHasMore`）。

歌单分区另外支持「加载更多」（`collectionOffset` / `loadMoreSearchCollections`，一页 12 条）。

## 三、依赖矩阵：上游只合并一部分时会怎样

| 已合并的部分 | 模组还剩什么能力 |
|---|---|
| 只有 contract + registry | 搜索 / 播放 / 歌词 / 登录 / 歌单 tab 可用；**专辑点进去是空的**（缺 catalog.getAlbumTracks 转发）；电台不可用 |
| 再加 hooks | 账号状态与歌单刷新正常 |
| 再加 package.json | 安装包自带音源 |
| 再加「搜索歌单」四处 | 搜索页多出「歌单」分区（只对实现了 `searchCollections` 的音源） |
| 只合并 hooks / i18n（没合并 registry） | 什么都不会点亮 —— `capabilities` 仍是 false |

模组侧对宿主补丁的**功能性依赖只剩一条**：`getPlaylistTracks` 需要 `providerData` 回传 `source`。
这条已经用 **collection id 自解释**（`p5_7899404` 这类前缀）解掉了：模组点开歌单时自己从 id
解出 source，`providerData` 降级成兜底。**已实测**：把 `providerData` 剥掉后，自建歌单
（`p5_96054531`）与推荐歌单（`p13_72245394`）都能正常取到曲目；历史遗留的纯数字 id 走
「providerData → 本地缓存 → 默认 5」兜底也能开（日志会打「用旧 id 兜底」）。

也就是说 registry 补丁即使只合并 capabilities 判定、不合并 providerData 透传，音源功能依然完整。

## 四、升级流程（每次上游前进后）

```powershell
cd folia
git fetch origin
git log --oneline HEAD..origin/main        # 看上游改了什么
git rebase origin/main                     # 或 git merge；冲突集中在上面 7 个文件
# 冲突处理原则：以上游结构为准，只把我们的"增量语义"挪到新结构里；
# 挪不动就先注释掉对应能力（capabilities 判定是分项的，注释掉不至于炸别的）
git format-patch -3 HEAD --stdout | Out-File -Encoding utf8 ..\tools\folia-local-changes.patch
```

## 五、版本与产物对应

| 产物 | 版本来源 | 说明 |
|---|---|---|
| 模组 zip（`tools/out/bodian-source-<v>.zip`） | `mods/bodian-source/mod.json` 的 `version` | 拖进面板安装用 |
| 安装包（`folia/release/Folia-Setup-<v>.exe`） | 上游 `folia/package.json` 的 `version` | **与模组版本无关**；对应关系记录在 `tools/out/installer-info.txt`（`tools/build-installer.mjs` 生成） |
| 宿主补丁 | `folia` 仓库的本地提交 | 每次导出覆盖 `tools/folia-local-changes.patch` |
