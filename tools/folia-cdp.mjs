// tools/folia-cdp.mjs
//
// 通过 CDP 操作正在运行的 Folia 渲染进程。
// 用法：
//   node tools/folia-cdp.mjs keys             列出 localStorage 所有键
//   node tools/folia-cdp.mjs enable-mods      打开模组系统总开关并刷新
//   node tools/folia-cdp.mjs eval "<js>"      在页面里执行一段 JS
//   node tools/folia-cdp.mjs logs [秒数]      抓取页面控制台日志（默认 20 秒）
//
// 需要 Folia 以 --remote-debugging-port=9444 启动。

const CDP_PORT = process.env.CDP_PORT || '9444';
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const MODS_KEY = 'mod_system_enabled';

const findPage = async () => {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === 'page' && /localhost:3000|folia/i.test(t.url || ''));
  if (!page) {
    throw new Error(`找不到 Folia 页面；当前有: ${list.map((t) => `${t.type}:${t.url}`).join(', ')}`);
  }
  return page;
};

const connect = async () => {
  const page = await findPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
    setTimeout(() => reject(new Error('CDP 连接超时')), 10000);
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg));
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || '页面内 JS 抛错');
    }
    return result.result?.value;
  };

  return { send, evaluate, on: (fn) => listeners.add(fn), close: () => ws.close() };
};

const main = async () => {
  const [command, ...args] = process.argv.slice(2);
  const cdp = await connect();

  if (command === 'keys') {
    const raw = await cdp.evaluate(
      "JSON.stringify(Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))"
    );
    const entries = Object.entries(JSON.parse(raw || '{}'));
    console.log(`localStorage 键（共 ${entries.length} 个）:`);
    entries.sort(([a], [b]) => a.localeCompare(b)).forEach(([key, value]) => {
      const shown = String(value ?? '');
      console.log(`  ${key} = ${shown.length > 60 ? `${shown.slice(0, 60)}…` : shown}`);
    });
  } else if (command === 'enable-mods') {
    const before = await cdp.evaluate(`localStorage.getItem(${JSON.stringify(MODS_KEY)})`);
    console.log(`当前 ${MODS_KEY} = ${before}`);
    await cdp.evaluate(`localStorage.setItem(${JSON.stringify(MODS_KEY)}, 'true')`);
    const after = await cdp.evaluate(`localStorage.getItem(${JSON.stringify(MODS_KEY)})`);
    console.log(`设置后 ${MODS_KEY} = ${after}`);
    console.log('刷新页面让 store 重新读取…');
    await cdp.send('Page.enable');
    await cdp.send('Page.reload', { ignoreCache: false });
    console.log('✓ 已刷新');
  } else if (command === 'eval') {
    const value = await cdp.evaluate(args.join(' '));
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  } else if (command === 'logs') {
    const seconds = Number(args[0]) || 20;
    console.log(`抓取页面控制台 ${seconds} 秒…`);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    const lines = [];
    cdp.on((msg) => {
      if (msg.method === 'Runtime.consoleAPICalled') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        lines.push(`[console.${msg.params.type}] ${text}`);
      } else if (msg.method === 'Log.entryAdded') {
        lines.push(`[log.${msg.params.entry.level}] ${msg.params.entry.text}`);
      }
    });
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const hit = lines.filter((l) => /bodian|folium|mod/i.test(l));
    console.log(`--- 共 ${lines.length} 条，其中相关 ${hit.length} 条 ---`);
    (hit.length ? hit : lines).slice(-60).forEach((l) => console.log(l));
  } else {
    console.log('用法: node tools/folia-cdp.mjs <keys|enable-mods|eval|logs>');
  }

  cdp.close();
  process.exit(0);
};

main().catch((error) => {
  console.error('失败:', error.message);
  process.exit(1);
});
