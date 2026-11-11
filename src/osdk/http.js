// HTTP 包装：把 OSDK 服务挂到 node:http 上（Base URL = http://{host}:{port}/agent-onto-harness）。
// 与进程内 dispatch 走同一套鉴权、信封与错误码；这里只负责读请求体、拼查询参数、写响应。
const http = require("node:http");
const { createApp } = require("../app.js"), { createService } = require("./service.js");

// 种子数据与文档约定同一个起始时钟：2026-09-11 09:00（前 7 天 MR 已到、还没有工单）
const SEED_CLOCK = "2026-09-11T09:00:00";

// SSE 帧：event 是事件名，data 是 JSON 载荷
const sseFrame = ev => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;

function createServer(opt = {}) {
  const app = opt.app || createApp({ tracker: null, at: opt.at || SEED_CLOCK });
  const service = opt.service || createService(app);
  const read = req => new Promise(resolve => {
    let s = ""; req.on("data", d => { s += d; if (s.length > 4_000_000) req.destroy(); });
    req.on("end", () => { try { resolve(s ? JSON.parse(s) : {}); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x"), body = ["POST", "PUT"].includes(req.method) ? await read(req) : {};
    const r = await service.dispatch({ method: req.method, path: u.pathname, headers: req.headers, query: u.searchParams, body });
    // 流式问答：text/event-stream，逐帧写出
    if (r.stream) {
      res.writeHead(r.status, { "content-type": r.contentType, "x-trace-id": r.traceId, ...(r.headers || {}) });
      try {
        for await (const ev of r.stream) res.write(sseFrame(ev));
      } catch (e) {
        res.write(sseFrame({ type: "error", body: { error: true, message: String(e && e.message || e) } }));
      }
      return res.end();
    }
    const text = JSON.stringify(r.body);
    res.writeHead(r.status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "x-trace-id": r.traceId });
    res.end(text);
  });
  server.app = app; server.service = service;
  return server;
}
module.exports = { createServer, sseFrame };
