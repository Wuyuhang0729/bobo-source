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
// 阶段：S3 —— 真实接口已接入，走 main 入口的 bodian 库。
// 保留 USE_FAKE 开关：置 true 可退回假数据，用于排查「是链路问题还是接口问题」。
const USE_FAKE = false;

/** S1 假数据：用来确认链路通，字段形状与真实 provider 完全一致。 */
const FAKE_SONGS = [
  { id: 'fake-1', title: '晴天（S1 假数据）', artists: ['周杰伦'], album: '叶惠美', durationMs: 269000 },
  { id: 'fake-2', title: '波点音源测试曲（S1 假数据）', artists: ['测试歌手'], album: '测试专辑', durationMs: 180000 },
];

export default function activate(folium) {
  folium.log.info('[bodian] client 入口激活，开始注册 omni provider');

  // provider 回调里所有网络动作都走 main，这里只是转发。
  // 必须定义在 activate 内部：folium 是它的参数，模块作用域里不存在这个变量
  // （放外面会抛 ReferenceError: folium is not defined）。
  const call = (name, ...args) => folium.rpc.call(`bodian.${name}`, ...args);

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

    // ---- 账号：扫码登录（全部实现在 main，这里只转发）
    //
    // 不实现 getQrLoginMethods：宿主据此走「单步流程」——直接出二维码，没有登录方式选择。
    // 注意 getQrTtlMs 必须是同步返回的普通数字（宿主直接调用取值），所以不能走 rpc。
    auth: {
      getLoginStatus: () => call('auth.getStatus'),
      logout: () => call('auth.logout'),
      getQrKey: () => call('auth.getQrKey'),
      createQr: (key) => call('auth.createQr', key),
      checkQr: (key) => call('auth.checkQr', key),
      cancelQr: (key) => call('auth.cancelQr', key),
      getQrTtlMs: () => 3 * 60 * 1000,
    },

    // ---- 我的歌单（自建 + 收藏；实现在 main，这里只转发）
    //
    // 声明了它才会点亮宿主的「歌单」tab。这一步很关键：搜索是跟着当前 tab 走的
    // （isOnlineTab ? activeProviderId : …），tab 被禁用就永远搜不到波点的歌。
    library: {
      getUserCollections: (userId, page) => call('library.getCollections', userId, page),
      // providerData 是列表时我们自己塞进去的 providerData（含 source），点开歌单时原样退回
      getCollectionTracks: (collectionId, page, providerData) =>
        call('library.getCollectionTracks', collectionId, page, providerData ?? null),
      // 声明它才会点亮「专辑」tab（宿主判的是 userLibrary && userAlbums）
      getUserAlbums: (userId, page) => call('library.getAlbums', userId, page),
      // 专辑卡片点开时取曲目：宿主的 catalog 对 type==='album' 只问 getAlbumTracks，
      // 少了这一步，专辑能列出来但点进去是空的
      getAlbumTracks: (albumId, page) => call('library.getAlbumTracks', albumId, page),
    },

    // ---- 电台（私人 FM / 每日推荐 / 推荐歌单）
    //
    // 声明了它才会点亮宿主的「电台」tab（宿主判的是 capabilities.recommendations）。
    // 三张卡片各自独立：宿主把私人 FM 与每日推荐摊成歌，把推荐歌单摊成可点开的卡片。
    recommendations: {
      getPersonalFm: () => call('recommendations.getPersonalFm'),
      getDailySongs: (refresh) => call('recommendations.getDailySongs', Boolean(refresh)),
      getRecommendedCollections: (limit) => call('recommendations.getRecommendedCollections', limit),
    },
  });

  folium.log.info('[bodian] omni provider 注册完成，内部 id 应为 folium.bodian');

  // 卸载时撤销注册（宿主也会兜底清理，这里显式做更干净）
  return () => {
    folium.log.info('[bodian] client 入口卸载，撤销 provider 注册');
    handle.unregister();
  };
}
