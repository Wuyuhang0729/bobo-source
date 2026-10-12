// tools/cdp-client.mjs
//
// 通过 CDP 连到正在运行的 Folia 渲染进程。doctor / probe / folia-cdp 共用这一份，
// 免得每个脚本各写一遍 WebSocket 握手与 pending map。
//
// 约定：目标页面必须是 vite dev server（http://localhost:3000），这样脚本里才能
// `import('/src/…')` 拿到宿主的运行时对象。连接前提是 Folia 带 --remote-debugging-port=9444 启动
// （tools/start-folia.bat 已经带上）。

export const CDP_PORT = process.env.CDP_PORT || '9444';
export const CDP_HTTP = `http://127.0.0.1:${CDP_PORT}`;
export const DEFAULT_PAGE_MATCHER = /localhost:3000/;

/** 列出所有 CDP 目标；CDP 不可用时抛错（调用方自己决定怎么提示）。 */
export const listTargets = async () => {
    const response = await fetch(`${CDP_HTTP}/json/list`);
    if (!response.ok) throw new Error(`CDP 不可用（HTTP ${response.status}）`);
    return await response.json();
};

export const findPage = async (matcher = DEFAULT_PAGE_MATCHER) => {
    const targets = await listTargets();
    const page = targets.find((target) => target.type === 'page' && matcher.test(target.url || ''));
    if (!page) {
        const seen = targets.map((target) => `${target.type}:${target.url}`).join(', ');
        throw new Error(`找不到匹配 ${matcher} 的页面；当前目标: ${seen || '(空)'}`);
    }
    return page;
};

/** 关掉所有 devtools:// 目标（ELECTRON_DEV=true 会自动打开 DevTools 盖住界面）。 */
export const closeDevToolsTargets = async () => {
    let closed = 0;
    for (const target of await listTargets()) {
        if (!/^devtools:/.test(target.url || '')) continue;
        try {
            await fetch(`${CDP_HTTP}/json/close/${target.id}`);
            closed += 1;
        } catch {
            // 关不掉就算了，不影响后续检查
        }
    }
    return closed;
};

/** 建立一条 CDP 连接。返回 { send, evaluate, on, close }。 */
export const connect = async (matcher = DEFAULT_PAGE_MATCHER) => {
    const page = await findPage(matcher);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        // timer 必须显式清掉：留着的话进程退出时 libuv 会在关闭路径上抛
        // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
        const timer = setTimeout(() => reject(new Error('CDP 连接超时')), 10000);
        ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP 连接失败')); }, { once: true });
    });

    let nextId = 0;
    const pending = new Map();
    const listeners = new Set();
    ws.addEventListener('message', (event) => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message);
            pending.delete(message.id);
        } else if (message.method) {
            listeners.forEach((listener) => listener(message));
        }
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, (message) => (message.error
            ? reject(new Error(JSON.stringify(message.error)))
            : resolve(message.result)));
        ws.send(JSON.stringify({ id, method, params }));
    });

    const evaluate = async (expression) => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.exception?.description || '页面内 JS 抛错');
        }
        return result.result?.value;
    };

    return { send, evaluate, on: (listener) => listeners.add(listener), close: () => ws.close() };
};

/** 一次性求值（连接、跑、断开），多数检查用这个就够。 */
export const evaluateOnce = async (expression, matcher = DEFAULT_PAGE_MATCHER) => {
    const cdp = await connect(matcher);
    try {
        return await cdp.evaluate(expression);
    } finally {
        cdp.close();
        // 等 WebSocket 真正关闭再返回：紧接着 process.exit 会让 libuv 在关闭路径上断言
        await new Promise((resolve) => setTimeout(resolve, 120));
    }
};
