// 本体应用前端服务：同一个进程里同时挂载「本体后端接口（OSDK REST）」与「本体应用前端（静态资源）」。
//
// 为什么合并在一个进程：
//   1. 前端只以 OSDK 为后端（SPEC 5.3）。同进程同源，前端不需要跨域、不需要第二套会话模型，
//      每次分析内只有一份本体状态；分析之间隔离对象版本、关系、时钟和审计。
//   2. 分析管理及只读视图聚合属于应用层，放在 /__analysis、/__bootstrap 等路由，
//      原 OSDK 接口、函数、动作与业务规则保持原样。
//
// 启动：node web/server.js --port 27080
//   前端：http://localhost:27080/
//   接口：http://localhost:27080/agent-onto-harness/api/v1/osdk/shwo-weak-coverage
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const { createApp } = require("../src/app.js");
const { createService, BASE } = require("../src/osdk/service.js");
const { Tracker } = require("../src/tracker.js");
const { sseFrame } = require("../src/osdk/http.js");
const { randomUUID, createHash } = require("node:crypto");
const views = require("./context.js");

const PUB = path.join(__dirname, "public");
// 种子数据与文档约定同一个起始时钟：2026-09-11 09:00（前 7 天 MR 已到、还没有工单）
const SEED_CLOCK = "2026-09-11T09:00:00";

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2"
};

let runtime = null;
function makeRuntime() {
  // 追踪统计是测试期的度量，运行时不用共享 tracker；但决策链要靠 tracker.tap 记录推理过程，
  // 所以给每次启动一个独立 tracker（不混进测试覆盖统计，也不跨重启累积）。
  const app = createApp({ tracker: new Tracker(), at: SEED_CLOCK });
  return { app, service: createService(app), active: 0, touched: Date.now() };
}
function boot() {
  const previous = runtime;
  runtime = makeRuntime();
  if (previous && !previous.active) previous.app.store.close();
  return runtime;
}
boot();
// 分析运行时只存在内存中。每次独立分析使用新标识，所有函数、动作与时钟绑定同一个标识。
const analyses = new Map();
const MAX_ANALYSES = 12, IDLE_MS = 60 * 60 * 1000;
function prune() {
  for (const [id, item] of analyses) {
    if (!item.active && Date.now() - item.touched > IDLE_MS) {
      item.app.store.close(); analyses.delete(id);
    }
  }
}
function analysisFor(req) {
  const id = req.headers["x-analysis-id"];
  if (!id) return runtime;
  const item = analyses.get(id);
  if (!item) {
    const e = new Error("本次分析已结束或服务已更新，请重新点击小区开始分析");
    e.status = 410; e.errorCode = "ANALYSIS_EXPIRED"; throw e;
  }
  item.touched = Date.now();
  return item;
}
const staticCache = new Map();

const json = (res, code, obj) => {
  const s = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(s) });
  res.end(s);
};
const readBody = req => new Promise(resolve => {
  let n = 0; const buf = [];
  req.on("data", c => { n += c.length; if (n > 4_000_000) { req.destroy(); return; } buf.push(c); });
  req.on("end", () => { try { resolve(buf.length ? JSON.parse(Buffer.concat(buf).toString("utf8")) : {}); } catch { resolve({}); } });
  req.on("error", () => resolve({}));
});

async function handle(req, res) {
  let selected = null;
  try {
  const u = new URL(req.url, "http://x");
  const pathname = decodeURIComponent(u.pathname);

  if (pathname === "/__analysis" && req.method === "POST") {
    const body = await readBody(req);
    prune();
    if (analyses.size >= MAX_ANALYSES) {
      const e = new Error("当前分析数量已满，请稍后再试"); e.status = 503; e.errorCode = "ANALYSIS_LIMIT"; throw e;
    }
    const item = makeRuntime(), id = randomUUID();
    analyses.set(id, item); item.active++;
    try {
      const initial = await views.bootstrap(item, req.headers, body.includeDefinition !== false);
      const context = body.cellKey ? await views.cellContext(item, req.headers, body.cellKey) : null;
      return json(res, 200, { id, bootstrap: initial, context });
    } catch (e) { analyses.delete(id); item.app.store.close(); throw e; }
    finally { item.active--; }
  }
  if (pathname === "/__analysis" && req.method === "DELETE") {
    const id = req.headers["x-analysis-id"], item = analyses.get(id);
    if (item) { item.retired = true; if (!item.active) { item.app.store.close(); analyses.delete(id); } }
    return json(res, 200, { ok: true });
  }
  const isRuntime = pathname.startsWith(BASE) || ["/__reset", "/__health", "/__bootstrap", "/__summary", "/__cell-context"].includes(pathname);
  if (isRuntime) { selected = analysisFor(req); selected.active++; }
  if (pathname === "/__bootstrap" && req.method === "GET") return json(res, 200, await views.bootstrap(selected, req.headers, u.searchParams.get("definition") !== "false"));
  if (pathname === "/__summary" && req.method === "GET") return json(res, 200, await views.summary(selected, req.headers));
  if (pathname === "/__cell-context" && req.method === "GET") {
    const cell = u.searchParams.get("cell");
    if (!cell) { const e = new Error("缺少小区标识"); e.status = 400; throw e; }
    return json(res, 200, await views.cellContext(selected, req.headers, cell, u.searchParams.get("effectNo")));
  }

  // ── 进程级演示控制（不属于 OSDK 契约）
  if (pathname === "/__reset" && req.method === "POST") {
    const id = req.headers["x-analysis-id"], next = makeRuntime();
    if (id) analyses.set(id, next); else runtime = next;
    selected.retired = true;
    return json(res, 200, { ok: true, clock: next.app.store.peekNow(), note: "本次分析已重置，其他分析保持原状态" });
  }
  if (pathname === "/__health" && req.method === "GET") {
    const a = selected.app;
    return json(res, 200, {
      ok: true, clock: a.store.peekNow(),
      counts: {
        OT_CELL: a.store.count("OT_CELL"), OT_CELL_MR: a.store.count("OT_CELL_MR"), OT_ANTENNA: a.store.count("OT_ANTENNA"),
        OT_SITE: a.store.count("OT_SITE"), OT_AREA: a.store.count("OT_AREA"), OT_TICKET: a.store.count("OT_TICKET"),
        OT_PLAN: a.store.count("OT_PLAN"), OT_EFFECT: a.store.count("OT_EFFECT"), OT_CASE: a.store.count("OT_CASE")
      }
    });
  }

  // ── 本体后端接口（OSDK REST）：与 src/server.js 同一套鉴权、信封与错误码
  if (pathname.startsWith(BASE)) {
    const body = ["POST", "PUT"].includes(req.method) ? await readBody(req) : {};
    const r = await selected.service.dispatch({ method: req.method, path: pathname, headers: req.headers, query: u.searchParams, body });
    // 流式问答：text/event-stream，逐帧写出（与应用层其它接口同源，只是帧格式不同）
    if (r.stream) {
      res.writeHead(r.status, { "content-type": r.contentType, "x-trace-id": r.traceId, ...(r.headers || {}) });
      try {
        for await (const ev of r.stream) res.write(sseFrame(ev));
      } catch (e) {
        res.write(sseFrame({ type: "error", body: { error: true, message: String((e && e.message) || e) } }));
      }
      return res.end();
    }
    const text = JSON.stringify(r.body);
    res.writeHead(r.status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "x-trace-id": r.traceId, "cache-control": "no-store" });
    return res.end(text);
  }

  // ── 静态资源
  let rel = pathname;
  if (rel === "/" || rel === "") rel = "/index.html";
  const file = path.join(PUB, path.normalize(rel).replace(/^([/\\])+/, ""));
  if (!file.startsWith(PUB)) return json(res, 403, { error: "forbidden" });
  fs.stat(file, (statError, stat) => {
    if (statError || !stat.isFile()) { res.writeHead(404); return res.end("404"); }
    const cached = staticCache.get(file);
    if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return sendStatic(cached);
    fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("404"); }
    const entry = { buf, mtime: stat.mtimeMs, size: stat.size, etag: '"' + createHash("sha256").update(buf).digest("hex") + '"' };
    staticCache.set(file, entry); sendStatic(entry);
    });
    function sendStatic(entry) {
      const headers = { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache", etag: entry.etag };
      const matches = String(req.headers["if-none-match"] || "").split(",").some(tag => tag.trim().replace(/^W\//, "") === entry.etag || tag.trim() === "*");
      if (matches) { res.writeHead(304, headers); return res.end(); }
      res.writeHead(200, headers); res.end(entry.buf);
    }
  });
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: true, message: e.message, errorCode: e.errorCode || "SERVER_ERROR" });
    else res.end();
  } finally {
    if (selected) {
      selected.active--;
      if (selected.retired && !selected.active) {
        selected.app.store.close();
        for (const [id, item] of analyses) if (item === selected) analyses.delete(id);
      }
    }
  }
}

if (require.main === module) {
  const arg = process.argv.indexOf("--port");
  const port = arg > -1 ? Number(process.argv[arg + 1]) : Number(process.env.PORT || 27080);
  const host = process.env.HOST || "127.0.0.1";
  http.createServer(handle).listen(port, host, () => {
    console.log(`本体应用前端：http://${host}:${port}/`);
    console.log(`本体后端接口（OSDK）：http://${host}:${port}${BASE}/api/v1/osdk/shwo-weak-coverage`);
    console.log("数据为本地仿真副本（MR、工参、告警、派单），不连接真实网络。");
  });
}
module.exports = { handle, boot };
