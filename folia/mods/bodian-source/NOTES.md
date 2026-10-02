# 波点音源接入 Folia — 调试札记

记录本次接入过程中踩到的、**只有真机才能发现**的坑，避免以后重复踩。

## 已确认的关键事实（真机验证，别靠猜）

### provider id 的真实格式

```
folium.<模组id>.<providerId>
例：folium.bodian-source.bodian
```

来源：`src/mods/folium/registries/omniProviders.ts` 的 `foliumProviderId()`，
注册时以 `register(mod.id, def)` 传入，所以是**两段**（模组 id + provider 自己的 id）。
运行时由 `omni.getProviderSummaries()` 的 `providerId` 字段报出，可用 CDP 直接读到：

```js
console.log(JSON.stringify(omni.getProviderSummaries().map(p => p.providerId)))
// → ["netease","kugou","qq","folium.bodian-source.bodian"]
```

**踩过的坑**：`Grid3D.tsx` 的 `LOGIN_COPY_BY_PROVIDER` 是按这个全名索引的，
写成 `folium.bodian` 不会命中，会静默回退 `NETEASE_LOGIN_COPY` —— 表现就是
「点波点卡片，弹出来却是『使用网易云APP扫码』」。

### main 入口的 storage 多一层 data

```js
api.storage.data.get(key)      // ✅ 正确
api.storage.get(key)           // ❌ is not a function
```

来源：`electron/modSystem/modApi.cjs` 的 `modApi.storage.data.{get,set,has,delete,keys}`。

### dev 模式会自动打开 DevTools

`electron/main.cjs` 里 `if (isElectronDevRuntime()) win.webContents.openDevTools()`。
DevTools 窗口会盖住 Folia 主界面，看起来就像「什么都没显示」。
用 CDP 的 `/json/close/<id>` 关掉它（见 `close-devtools.mjs`）。

### folia/.git 不能改名或删除

Tailwind v4 靠 `.git` 定位「项目根」做内容扫描。改名后 utility class 一条都不生成
（`index.css` 从 252KB 掉到 12KB），界面变成一堆没有样式的裸文字。

## 验证 UI 必须截图

`document.body.innerText` 只能证明文字在，**证明不了样式对**。
用 `shot.mjs`（CDP `Page.captureScreenshot`）截图看。

---

## 波点音源要出现，必须打开的三道开关（缺一条就「没有波点」）

这不是「打开开发者模式」一句话能带过的，实际是三层，逐层缺一不可：

1. **必须以开发版运行**：`app.isPackaged === false` 时加载器才会把仓库的 `folia/mods/`
   加进扫描目录（`electron/modSystem/modSystem.cjs` 的 `getModsDirectories()`）。
   安装版只扫 `%APPDATA%\Folia\mods` 与 `<安装目录>\resources\mods`，**看不到仓库里的这份**。
2. **启动时要带 `ELECTRON_DEV=true`**：否则 Electron 加载的是 `dist/index.html`（上次构建的
   产物），改 `folia/src/**` 完全不生效 —— 现象是「改了半天界面没变」。
   带 `--remote-debugging-port=9444` 才好用 CDP 排查。参考 `tools/start-folia.bat`：
   ```bat
   set ELECTRON_DEV=true
   node_modules\electron\dist\electron.exe . --remote-debugging-port=9444
   ```
   （`ELECTRON_DEV=true` 会顺手打开 DevTools 窗口盖住界面，用 CDP 的 `/json/close/<id>` 关掉。）
3. **模组系统总开关 + 单个模组确认**：设置 → 系统 → 模组 →「模组系统」（实验性，等价于
   `localStorage.mod_system_enabled = true`，命令行可 `node tools/folia-cdp.mjs enable-mods`）；
   然后在同一页的列表里把「波点音乐」启用，走原生确认弹窗（**默认按钮是「取消」**）。
   仓库 `mods/` 下的模组属于「开发源」，确认一次之后**改文件不会撤销授权**（只有开发版有这个豁免），
   所以开发期改完不用反复确认。

## 模组重复 / 内容变了 → 平台「消失」的排查方法

症状：平台选择器里没有「波点音乐」（只剩网易云 / 酷狗 / QQ），搜索自然也搜不到波点。
三条实测结论（本机复现过）：

1. **同一个 id 只能有一份**。出现两份时只有扫描顺序在前的那份加载，另一份在模组列表里
   显示成 `bodian-source-duplicate-bodian-source`，错误为 `duplicate mod id "bodian-source"`，
   保持未启用。
2. **哪份在前由文件系统的目录顺序决定**，既不是字母序也不是「仓库那份优先」。所以「我放的是
   同一份模组」这个前提不成立 —— 胜出的可能是你没在用的那份。
3. **授权按 `id + 内容摘要(sha256)` 绑定**（`electron/modSystem/modSystem.cjs` 的
   `resolveTrust`）。扫描到的那份内容与上次确认的不一致、且不在开发源目录（仓库 `mods/`）时，
   授权直接失效并**自动禁用** —— 实测：把改过内容的副本放进 `%APPDATA%\Folia\mods`、同时移走
   仓库那份，模组列表给出 `enabled: false, trustStale: true`，`omni.getProviderSummaries()` 里
   `folium.bodian-source.bodian` 直接消失。

排查步骤：

1. **看模组列表**（设置 → 系统 → 模组）：出现 `duplicate mod id` 条目，或「该模组的文件在你上次
   确认之后发生了变化，已自动禁用」，就是这条问题。
2. **三个扫描目录各查一遍同 id**（一个 id 只留一份）：
   ```powershell
   Get-ChildItem -Recurse -Filter mod.json `
     G:\BoDianBoFangQi\folia\mods, "$env:APPDATA\Folia\mods", `
     G:\BoDianBoFangQi\folia\node_modules\electron\dist\resources\mods |
     ForEach-Object { "{0}: {1}" -f $_.FullName, ((Get-Content $_.FullName -Raw | ConvertFrom-Json).id) }
   ```
3. **CDP 一条命令判断 provider 有没有注册上**（没有 `folium.*` 就是根本没加载）：
   ```js
   // 连上 http://127.0.0.1:9444 的页面后
   omni.getProviderSummaries().map(p => p.providerId)
   // → ["netease","kugou","qq","folium.bodian-source.bodian"]
   ```
4. **修法**：删掉多的那份。注意**改名不算解决** —— 改名不改 `mod.json` 里的 `id`，依旧是重复项；
   要把它移出 `mods/` 扫描目录，或改掉那份的 `id`。备份目录放在 `mods/` 里面（`xxx.bak` 之类）
   同样算重复项。改完重启 Folia。

## 歌单 / 专辑 / 电台三个标签的数据来源（真机验证过的接口）

宿主侧的三个门槛（`src/mods/folium/registries/omniProviders.ts` 的本地扩展）：

| 界面 | 宿主判什么 | 模组要提供 |
|---|---|---|
| 歌单 tab | `userLibrary && playlists` | `library.getUserCollections`（+ `getCollectionTracks` 才可点开） |
| 专辑 tab | `userLibrary && userAlbums` | `library.getUserAlbums` + **`getAlbumTracks`** |
| 电台 tab | `capabilities.recommendations` | `recommendations.getPersonalFm / getDailySongs / getRecommendedCollections` |

**专辑那个坑**：`omni.getCollectionTracks` 按 `collection.type` 分流 —— `type === 'album'` 只问
`catalog.getAlbumTracks`，不会走 `getPlaylistTracks`。少了 `getAlbumTracks`，专辑卡片能列出来，
**点进去是空的**（不报错，最容易误判成接口问题）。

**providerData 要能回来**：推荐歌单是平台目录（`sourceType=13`），不在「我的歌单」缓存里，
所以卡片上的 `providerData.source` 必须在点开时原样退回模组（宿主适配层会透传
`collection.providerData`），否则取曲目会猜错 `source`。

接口清单（全部带签名，`GET`）：

| 用途 | 路径 | 关键点 |
|---|---|---|
| 歌单曲目 | `/api/service/playlist/{id}/musicList` | `source`（自建 5 / 收藏 4 / 平台 13），`pn` **从 1 开始** |
| 收藏列表（歌单+专辑混合） | `/api/service/collect/4/list` | 带 `albumId` 的才是专辑 |
| 专辑曲目 | `/api/service/album/music/{albumId}` | 返回 `data.resultList`，字段与歌单曲目同构 |
| 私人 FM | `/api/service/music/recommendList` | `fg=1&lock=0&recoMode=normal&scrollNum&totalNum`；**每次换 `lastColdStartTime` 才给新歌**（固定值会反复给同一批） |
| 每日推荐 | `/api/service/home/module?moduleId=10` | 「心动收藏相似推荐」，`data.musicList`；空则退 `moduleId=3`（偶遇心动单曲） |
| 推荐歌单 | `/api/service/home/module?moduleId=2` | 「宝藏歌单库」，`data.songList`，`sourceType=13` |
| 首页模块目录 | `/api/service/home/index` | `data.moduleList` 列出全部模块的 `id/type/name`，找新模块从这里查 |

**歌单同步刷新**：宿主进首页 / 点同步会调 `omni.refreshProviderPlaylists()`，它从 `offset=0`
重新拉 `library.getUserPlaylists`。模组把 **`offset === 0` 当刷新信号**强制打上游；
60 秒缓存只服务翻页，不挡刷新。专辑 tab 每次进入（列表为空时）与订阅变更事件
`folia-refresh-favorite-albums` 都会重新拉。

## 换机器 / 装成安装版（三条路）

这个项目由两块组成，换机器时两块都要带：

| 部分 | 在哪 | 怎么带 |
|---|---|---|
| 模组本体（音源代码） | 根仓库 `folia/mods/bodian-source/` | `git clone` 本仓库 |
| 宿主侧本地扩展（登录 / 歌单 / 专辑 / 电台 + 打包配置） | `folia/`（上游检出）里的 9 个文件 | `tools/folia-local-changes.patch` |

patch 是用 `git format-patch` 导出的一个提交，换机重放 `git am` 即可，改动痕迹与提交信息都在。

### 新机器从零开始

```powershell
git clone <本仓库> BoDianBoFangQi
cd BoDianBoFangQi

cd any-listen; npm install; npm run build:cjs; cd ..     # 波点音源核心库（模组依赖它的 CJS 产物）
git clone https://github.com/chthollyphile/folia-major folia
cd folia; npm install
git am ../tools/folia-local-changes.patch                # 上游前进过就用 git apply -3
cd ..

node tools/sync-bodian-vendor.mjs   # 库的 CJS 产物 → 模组 vendor/
node tools/sync-mod-deps.mjs        # qrcode 等运行期依赖 → 模组 node_modules/
tools\start-folia.bat               # 开发运行 = vite + ELECTRON_DEV=true + CDP 9444
```

### 出一份能直接安装的安装包

```powershell
cd folia
npm run build                                    # 前端产物 → dist/
npx electron-builder --win nsis --publish never
# → folia/release/Folia-Setup-<version>.exe
```

`folia/package.json` 的 `extraResources` 已经把 `mods/bodian-source` 打进 `resources/mods/`，
所以装完就有这个音源 —— 启动 Folia → 设置 → 系统 → 模组 → 启用「波点音乐」并确认一次。
注意**安装版没有开发源豁免**：装好后别再改安装目录里的模组文件，改了会被判为内容变化并自动禁用
（要改就改仓库里的那份，重新打包）。

### 只在已有 Folia 上装这个模组

```powershell
node tools/pack-mod.mjs      # → tools/out/bodian-source-<version>.zip
```

把 zip 拖进「设置 → 系统 → 模组」面板，或解压到 `%APPDATA%\Folia\mods\bodian-source\` 后重启。
**两种方式只选一种**：用户目录和仓库目录各留一份，就是上一节说的「重复 → 平台消失」。
