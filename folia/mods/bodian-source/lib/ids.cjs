'use strict';

// mods/bodian-source/lib/ids.cjs
//
// collection id 的自解释编码。
//
// 为什么需要它：波点同一个数字 id 在不同目录里含义不同 —— 自建歌单（source=5）、
// 收藏歌单（source=4）、平台歌单（source=13）的曲目接口都要带 source，而宿主点开卡片时
// 只把 id 递回来。早期实现靠"卡片上附 providerData.source、宿主动点开时原样退回"，
// 那把模组的功能性依赖压在了宿主侧补丁（providerData 透传）上 —— 上游不合并那处补丁，
// 平台歌单就点不开。
//
// 把 source 编进 id 之后，模组自己就能解释它，providerData 退化成兜底。
// 编码形状 `p<source>_<原始id>`：宿主把它当不透明字符串，纯数字 id 视为旧数据（走兜底路径）。

/** 编码：`p13_7899404`。source 缺失时按自建歌单（5）处理。 */
const encodeCollectionId = (source, id) => {
    const numericSource = Number(source);
    const safeSource = Number.isFinite(numericSource) && numericSource > 0 ? String(numericSource) : '5';
    return `p${safeSource}_${id}`;
};

/** 解码；不是本模组编的 id（例如历史遗留的纯数字）返回 null。 */
const decodeCollectionId = (raw) => {
    const text = String(raw ?? '');
    const matched = /^p(\d+)_(.+)$/.exec(text);
    if (!matched) return null;
    return { source: matched[1], id: matched[2] };
};

module.exports = { encodeCollectionId, decodeCollectionId };
