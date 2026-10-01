// mods/bodian-source/client.mjs
//
// 波点音乐 · client 入口（渲染进程）
//
// 为什么 provider 注册在这里：Folium 的实验接口（含 omni.providers）只在主窗口
// 被惰性加载（见 src/mods/folium/experimental.ts 的注释），所以注册表只能在
// client 里够得着。
//
// 为什么网络请求不在这里：波点的接口签名要 md5，而渲染进程没有现成的 md5
// （WebCrypto 只有 SHA 系列）。所以真正的请求全部经 folium.rpc 交给 main 入口
// 用 Node 的 crypto + https 完成。
//
// 阶段：S1/S2 —— 先验证「模组能加载 / provider 能注册 / 搜索能出结果」。
// 把 USE_FAKE 改成 false 即切到真实接口调用。
//
// 注意：rpc 名字必须匹配 /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/，也就是**不能用冒号**，
// 所以这里统一用 `bodian.` 前缀。

const USE_FAKE = true;

/** provider 回调里所有网络动作都走 main，这里只是转发。 */
const call = (name, ...args) => folium.rpc.call(`bodian.${name}`, ...args);

/** S1 假数据：用来确认链路通，字段形状与真实 provider 完全一致。 */
const FAKE_SONGS = [
  { id: 'fake-1', title: '晴天（S1 假数据）', artists: ['周杰伦'], album: '叶惠美', durationMs: 269000 },
  { id: 'fake-2', title: '波点音源测试曲（S1 假数据）', artists: ['测试歌手'], album: '测试专辑', durationMs: 180000 },
];

export default function activate(folium) {
  folium.log.info('[bodian] client 入口激活，开始注册 omni provider');

  const handle = folium.experimental['omni.providers'].register({
    id: 'bodian',
    displayName: '波点音乐',
    shortName: '波点',

    // ---- 搜索
    async search(query, page) {
      folium.log.info(`[bodian] search query="${query}" limit=${page.limit} offset=${page.offset}`);
      if (USE_FAKE) {
        return { items: FAKE_SONGS, hasMore: false, total: FAKE_SONGS.length };
      }
      return call('search', query, page);
    },

    // ---- 单曲详情（队列/历史里重开后靠它还原）
    async getSong(id) {
      if (USE_FAKE) {
        return FAKE_SONGS.find((song) => song.id === id) ?? null;
      }
      return call('getSong', id);
    },

    // ---- 播放地址
    async getAudioUrl(song, quality) {
      folium.log.info(`[bodian] getAudioUrl id=${song.id} quality=${quality}`);
      if (USE_FAKE) {
        // S1 不真放音：返回 null，让宿主显示「无法播放」，避免误以为接通了。
        return null;
      }
      return call('getAudioUrl', song, quality);
    },

    // ---- 歌词（awlrc 逐字格式由宿主 parseLRC 自动识别）
    async getLyrics(song) {
      folium.log.info(`[bodian] getLyrics id=${song.id}`);
      if (USE_FAKE) {
        return {
          lrc: '[00:00.000]<0,600>S<600,600>1<1200,600> <1800,600>假<2400,600>数<3000,600>据<3600,600>歌<4200,600>词',
        };
      }
      return call('getLyrics', song);
    },
  });

  folium.log.info('[bodian] omni provider 注册完成，内部 id 应为 folium.bodian');

  // 卸载时撤销注册（宿主也会兜底清理，这里显式做更干净）
  return () => {
    folium.log.info('[bodian] client 入口卸载，撤销 provider 注册');
    handle.unregister();
  };
}
