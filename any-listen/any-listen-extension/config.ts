import type { ExtensionConfig } from '@any-listen/extension-kit/config'

/**
 * 波点音乐扩展配置。
 *
 * 关键字段说明：
 * - `grant: ['internet']` —— **必须**。服务端 `createRequest()` 只在扩展声明了 internet
 *   权限时才把 `request` 暴露出来，否则扩展拿不到任何网络能力。
 * - `contributes.resource[].id` 就是 source key。这里用 `wd`：LX 里 `bd` 已被"百度音乐"
 *   占用、`xm` 是虾米，`wd` 未被任何源使用。
 * - `buildConfig.isIsolateMode: false` —— 用通用模式。isolate 模式会把扩展放进隔离子进程，
 *   而本扩展依赖宿主直接暴露的 `request` / `utils`。
 */
const config: ExtensionConfig = {
  id: 'bodian',
  name: '波点音乐',
  version: '0.3.0',
  description: '波点音乐音源（Bodian）：搜索 / 完整音质播放地址 / 逐字歌词 / 封面 / 歌单',
  author: 'bodian',
  homepage: 'https://github.com/',
  license: 'MIT',
  target_engine: '1.0.0',
  categories: ['music'],
  tags: ['bodian', 'kuwo', 'music-source', 'wd'],
  grant: ['internet', 'music_list'],
  contributes: {
    resource: [
      {
        id: 'wd',
        name: '波点音乐',
        resource: [
          'musicSearch',
          'musicUrl',
          'musicLyric',
          'musicPic',
          'songlistSearch',
          'songlistDetail',
        ],
      },
    ],
  },
  buildConfig: {
    srcDir: 'src',
    distDir: 'dist',
    outputDir: 'build',
    i18nDir: 'i18n',
    resourcesDir: 'resources',
    isIsolateMode: false,
    mainEntry: 'src/index.ts',
  },
}

export default config
