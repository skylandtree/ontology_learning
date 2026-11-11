// 大模型接入验证：用本地假 OpenAI 兼容服务测语义问答编排层（不需要真 API Key）。
// 运行：node test/llm.js
const http = require("node:http");
const { createLLM } = require("../src/llm.js");
const { createLLMQA, CANON, checkGrounded } = require("../src/qa-llm.js");
const { createQA } = require("../src/qa.js");
const { qaWorld } = require("../src/qa-eval.js");

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) { pass += 1; console.log("  ✓ " + name); }
  else { fail += 1; console.log("  ✗ " + name + (detail ? " —— " + detail : "")); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fakeServer(handler) {
  const srv = http.createServer((req, res) => {
    let buf = "";
    req.on("data", c => { buf += c; });
    req.on("end", async () => {
      let body = {};
      try { body = JSON.parse(buf); } catch { /* 忽略 */ }
      const sys = (body.messages || []).map(m => String(m.content || "")).join("\n");
      const stage = /语义解析器/.test(sys) ? "understand" : "naturalize";
      let out;
      try { out = await handler(stage, body); } catch { out = "{}"; }
      const send = (status, payload) => { try { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); } catch { /* 超时后连接已断 */ } };
      if (out && out.__sleep) { await sleep(out.__sleep); return send(200, { choices: [{ message: { content: "慢" } }] }); }
      // 网关的流式返回（SSE）：逐段 data 帧。__streamGap 模拟真实网关"一段一段慢慢吐"
      if (out && out.__stream) {
        try {
          res.writeHead(200, { "content-type": "text/event-stream" });
          for (const c of out.__stream) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
            if (out.__streamGap) await sleep(out.__streamGap);
          }
          res.write("data: [DONE]\n\n");
          res.end();
        } catch { /* 连接已断 */ }
        return;
      }
      if (out && out.__status) return send(out.__status, { error: { message: "fake error" } });
      const content = typeof out === "string" ? out : JSON.stringify(out);
      send(200, {
        id: "fake", object: "chat.completion", model: body.model || "fake-model",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 },
      });
    });
  });
  return new Promise(resolve => srv.listen(0, "127.0.0.1", () => {
    const port = srv.address().port;
    resolve({ baseUrl: `http://127.0.0.1:${port}/v1`, close: () => new Promise(r => srv.close(r)) });
  }));
}

(async () => {
  const app = qaWorld().app;
  const cells = app.store.list("OT_CELL").map(c => c.cellName);
  const CELL = cells.find(n => /崇贤达/.test(n)) || cells[0];
  const newQA = () => { const qa = createQA(app); return { qa, llmqa: llm => createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } }) }; };

  // ── 1 意图模板：48 条标准问句都要被规则引擎识别为同一意图
  console.log("1 意图模板与规则引擎一致");
  {
    const bad = [];
    for (const [name, c] of Object.entries(CANON)) {
      const q = c.say.replace(/\{cell\}/g, CELL).replace(/\{date\}/g, "2026-09-22").replace(/\{ids\}/g, "F_08").replace(/\{subject\}/g, "SHCHM");
      const out = createQA(app).ask(q);
      if (out.intent !== name) bad.push(`${name}→${out.intent}`);
    }
    t(`全部 ${Object.keys(CANON).length} 个意图都有可命中的标准问句`, bad.length === 0, bad.join("，"));
  }

  // ── 2 未配置 API Key：完全退回规则问答
  console.log("2 未配置 API Key 时退回规则");
  {
    const { qa } = newQA();
    const llm = createLLM({ apiKey: "", baseUrl: "http://127.0.0.1:1/v1" });
    const llmqa = createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } });
    const q = "哪些小区弱覆盖";
    const r = await llmqa.ask(q);
    const rule = createQA(app).ask(q);
    t("llm.enabled 为 false", llm.enabled === false);
    t("回答与纯规则一致", r.text === rule.text && r.intent === rule.intent, `by=${r.by} intent=${r.intent}`);
    t("标注 by=rule 且带 llm 状态", r.by === "rule" && r.llm && r.llm.enabled === false);
  }

  // ── 3 正常链路：口语化提问 → 理解 → 取事实 → 自然化
  console.log("3 正常链路：口语问法被理解并自然化");
  {
    const srv = await fakeServer((stage, body) => {
      if (stage === "understand") return { intent: "cause", cell: CELL, dates: [], ids: [], reason: "用户在问该小区的根因" };
      const facts = (body.messages || []).map(m => String(m.content || "")).join("\n");
      const m = facts.match(/事实：([^\n]+)/);
      return "按本体判断，问题出在总下倾角偏小。" + (m ? m[1].slice(0, 160) : "");
    });
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "test-key", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa } = newQA();
    const llmqa = createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } });
    const r = await llmqa.ask("崇贤达那个站为啥弱覆盖啊", { history: [{ role: "user", content: "崇贤达NF02H_222 的情况" }] });
    t("由大模型改写（by=llm）", r.by === "llm", JSON.stringify(r.llm));
    t("意图被正确识别为 cause", r.intent === "cause", r.intent);
    t("回答含自然语言开头", /按本体判断/.test(r.text));
    t("数值落地通过", r.grounded.ok === true, JSON.stringify(r.grounded));
    t("回传模型名与用量", r.llm.model === "fake-model" && !!r.llm.understood);
    await srv.close();
  }

  // ── 4 模型编造数字：重试仍编造则回退规则原文
  console.log("4 编造数字时回退规则原文");
  {
    const srv = await fakeServer(stage => (stage === "understand"
      ? { intent: "cause", cell: CELL, dates: [], ids: [], reason: "问根因" }
      : "总下倾角差了 9.99 度，建议调整到 12.34 度。"));
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa } = newQA();
    const llmqa = createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } });
    const r = await llmqa.ask(`${CELL} 的根因是哪一类问题`);
    t("编造内容未进入回答", !/9\.99|12\.34/.test(r.text), r.text);
    t("回退为规则原文（by=rule）", r.by === "rule");
    t("记录回退原因", r.llm && r.llm.groundedRetry === true, JSON.stringify(r.llm && r.llm.ungrounded));
    await srv.close();
  }

  // ── 5 接口 500：不抛异常，按规则回答
  console.log("5 接口故障时降级");
  {
    const srv = await fakeServer(() => ({ __status: 500 }));
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa } = newQA();
    const llmqa = createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } });
    const r = await llmqa.ask("哪些小区弱覆盖");
    t("仍然给出规则答案", r.intent === "scan" && r.text.length > 10, r.intent);
    t("标注 by=rule", r.by === "rule");
    t("记录错误码", r.llm && (r.llm.planError || r.llm.error) && /HTTP_500|AUTH|BAD_JSON/.test((r.llm.planError || r.llm.error).code), JSON.stringify(r.llm && (r.llm.planError || r.llm.error)));
    await srv.close();
  }

  // ── 6 超时
  console.log("6 超时降级");
  {
    const srv = await fakeServer(() => ({ __sleep: 400 }));
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 80 });
    const { qa } = newQA();
    const llmqa = createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } });
    const r = await llmqa.ask("工单有哪些状态");
    t("超时后仍按规则回答", r.intent === "meta.states" && r.by === "rule");
    // 规则引擎能直接识别的问题不再调语义解析，超时发生在自然化这一步；错误码照样要如实记下
    t("错误码为 TIMEOUT", r.llm && (r.llm.planError || r.llm.error) && (r.llm.planError || r.llm.error).code === "TIMEOUT", JSON.stringify(r.llm && (r.llm.planError || r.llm.error)));
    await srv.close();
  }

  // ── 7 语义解析返回 fallback：不硬塞意图
  console.log("7 无法归类时不做臆测");
  {
    const srv = await fakeServer(stage => (stage === "understand"
      ? { intent: "fallback", cell: "", dates: [], ids: [], reason: "与技术问题无关" }
      : "这个问题超出本体范围。"));
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa } = newQA();
    const llmqa = createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } });
    const r = await llmqa.ask("今天天气怎么样");
    t("采用规则兜底意图", r.intent === "fallback");
    t("仍走大模型自然化（说明边界）", r.by === "llm" && /超出本体范围/.test(r.text), `${r.by} ${r.text.slice(0, 40)}`);
    await srv.close();
  }

  // ── 8 落地检查的单元行为
  console.log("8 数值与实体落地检查");
  {
    const out = { text: "总下倾 6°，缺口 1.35°", src: [{ totalTilt: 6, deficit: 1.35 }], refs: ["F_08"] };
    t("事实内的数字通过", checkGrounded("总下倾 6 度，缺口 1.35 度", out).ok === true);
    t("事实外的数字被标记", checkGrounded("缺口 2.7 度", out).ok === false);
    t("编造小区名被判定为严重问题", checkGrounded("崇贤达NF02H_999 也受影响", out).severe === true);
  }

  // ── 9 OSDK 接口上的大模型模式：同一路径、同一信封，不是另一套后端
  console.log("9 OSDK /qa/ask 的大模型模式（与规则模式同路径）");
  {
    const srv = await fakeServer((stage, body) => {
      if (stage === "understand") return { intent: "cause", cell: CELL, dates: [], ids: [], reason: "问根因" };
      const facts = (body.messages || []).map(m => String(m.content || "")).join("\n");
      const m = facts.match(/事实：([^\n]+)/);
      return "按本体判断，问题出在总下倾角偏小。" + (m ? m[1].slice(0, 160) : "");
    });
    const KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"];
    const saved = KEYS.map(k => [k, process.env[k]]);
    process.env.LLM_BASE_URL = srv.baseUrl; process.env.LLM_API_KEY = "test-key"; process.env.LLM_MODEL = "fake-model";
    try {
      const { createService } = require("../src/osdk/service.js");
      const svc = createService(qaWorld().app);
      const H = { "currentnetuserid": "t", "x-sys-code": "data", "x-context-key-groups": encodeURIComponent("地市优化工程师") };
      const P = "/agent-onto-harness/api/v1/osdk/shwo-weak-coverage/qa/ask";

      // 显式指定 mode，不依赖本机 config/llm.config.json 的默认档位（那是运维的事，测试只验两种模式的契约）
      const r1 = svc.dispatch({ method: "POST", path: P, headers: H, query: new Map(), body: { question: "哪些小区弱覆盖", mode: "rule" } });
      t("规则模式同步返回（不是 Promise）", !(r1 instanceof Promise));
      t("规则模式 by=rule", r1.body.data.by === "rule", String(r1.body.data.by));
      t("规则模式信封 code=0", r1.body.code === 0);

      const p2 = svc.dispatch({ method: "POST", path: P, headers: H, query: new Map(), body: { question: "崇贤达那个站为啥弱覆盖啊", mode: "llm" } });
      t("大模型模式返回 Promise（异步路由）", p2 instanceof Promise);
      const r2 = await p2;
      t("成功信封 code=0", r2.body.code === 0, JSON.stringify(r2.body).slice(0, 160));
      t("由大模型改写（by=llm）", r2.body.data.by === "llm", JSON.stringify(r2.body.data.llm));
      t("回传模型名", !!(r2.body.data.llm && r2.body.data.llm.model === "fake-model"), JSON.stringify(r2.body.data.llm));
      t("数值落地通过", !!(r2.body.data.grounded && r2.body.data.grounded.ok), JSON.stringify(r2.body.data.grounded));
      t("带 traceId 且与信封一致", !!(r2.body.traceId && r2.traceId === r2.body.traceId));
      t("事实仍来自本体函数（refs 非空）", Array.isArray(r2.body.data.refs) && r2.body.data.refs.length > 0, JSON.stringify(r2.body.data.refs));
    } finally {
      for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      await srv.close();
    }
  }

  // ── 10 未配置 Key 时，接口上的大模型模式退回规则（不报错、不假装是大模型）
  console.log("10 未配置 Key 时接口退回规则");
  {
    const KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"];
    const saved = KEYS.map(k => [k, process.env[k]]);
    const savedCfg = process.env.LLM_CONFIG_FILE;
    for (const k of KEYS) delete process.env[k];
    // 指向不存在的配置文件：这组用例要的是"什么都没配"，不能被本地 config/llm.config.json 影响
    process.env.LLM_CONFIG_FILE = require("node:path").join(__dirname, "no-such-llm.config.json");
    try {
      const { createService } = require("../src/osdk/service.js");
      const svc = createService(qaWorld().app);
      const H = { "currentnetuserid": "t", "x-sys-code": "data", "x-context-key-groups": encodeURIComponent("地市优化工程师") };
      const P = "/agent-onto-harness/api/v1/osdk/shwo-weak-coverage/qa/ask";
      const r = await svc.dispatch({ method: "POST", path: P, headers: H, query: new Map(), body: { question: "哪些小区弱覆盖", mode: "llm" } });
      t("信封 code=0", r.body.code === 0, JSON.stringify(r.body).slice(0, 160));
      t("退回规则并标注 by=rule", r.body.data.by === "rule", String(r.body.data.by));
      t("标注大模型未启用", !!(r.body.data.llm && r.body.data.llm.enabled === false), JSON.stringify(r.body.data.llm));
      t("仍给出回答原文", typeof r.body.data.text === "string" && r.body.data.text.length > 10);
    } finally {
      for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      if (savedCfg === undefined) delete process.env.LLM_CONFIG_FILE; else process.env.LLM_CONFIG_FILE = savedCfg;
    }
  }

  // ── 11 真机 HTTP：异步路由（大模型模式）经 HTTP 层同样通
  console.log("11 真机 HTTP 上的大模型模式（异步路由）");
  {
    const srv = await fakeServer((stage, body) => {
      if (stage === "understand") return { intent: "cause", cell: CELL, dates: [], ids: [], reason: "问根因" };
      const facts = (body.messages || []).map(m => String(m.content || "")).join("\n");
      const m = facts.match(/事实：([^\n]+)/);
      return "按本体判断，问题出在总下倾角偏小。" + (m ? m[1].slice(0, 160) : "");
    });
    const KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"];
    const saved = KEYS.map(k => [k, process.env[k]]);
    process.env.LLM_BASE_URL = srv.baseUrl; process.env.LLM_API_KEY = "test-key"; process.env.LLM_MODEL = "fake-model";
    let http = null;
    try {
      const { createServer } = require("../src/osdk/http.js");
      http = createServer();
      await new Promise(r => http.listen(0, "127.0.0.1", r));
      const url = `http://127.0.0.1:${http.address().port}/agent-onto-harness/api/v1/osdk/shwo-weak-coverage/qa/ask`;
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "currentnetuserid": "t", "x-sys-code": "data", "x-context-key-groups": encodeURIComponent("地市优化工程师") }, body: JSON.stringify({ question: "崇贤达那个站为啥弱覆盖啊", mode: "llm" }) });
      const j = await res.json();
      t("HTTP 200", res.status === 200, String(res.status));
      t("信封 code=0", j.code === 0, JSON.stringify(j).slice(0, 160));
      t("by=llm（异步路由经 HTTP 层）", j.data.by === "llm", JSON.stringify(j.data.llm));
      t("落地通过", !!(j.data.grounded && j.data.grounded.ok), JSON.stringify(j.data.grounded));
      t("带 x-trace-id 响应头", !!res.headers.get("x-trace-id"), "缺响应头");
    } finally {
      for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      if (http) await new Promise(r => http.close(r));
      await srv.close();
    }
  }

  // ── 12 本地配置文件：api_key／base_url／model_name 从文件读，语义理解开关也从文件读
  console.log("12 本地配置文件（config/llm.config.json）");
  {
    const fs = require("node:fs"), os = require("node:os"), p = require("node:path");
    const tmp = p.join(os.tmpdir(), "shwo-llm-test-" + process.pid + ".json");
    const { readConfig, readFileConfig } = require("../src/llm.js");
    const savedFile = process.env.LLM_CONFIG_FILE;
    const savedKeys = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "LLM_ENABLED", "LLM_SEMANTIC_ENGINE"].map(k => [k, process.env[k]]);

    // 12a 文件读出 api_key / base_url / model_name
    fs.writeFileSync(tmp, JSON.stringify({ semantic_engine: "llm", api_key: "sk-from-file", base_url: "http://127.0.0.1:9/v1", model_name: "file-model", timeout_ms: 1234 }));
    for (const [k] of savedKeys) delete process.env[k];
    process.env.LLM_CONFIG_FILE = tmp;
    const c1 = readConfig(process.env);
    t("从文件读出 api_key", c1.apiKey === "sk-from-file", c1.apiKey);
    t("从文件读出 base_url", c1.baseUrl === "http://127.0.0.1:9/v1", c1.baseUrl);
    t("从文件读出 model_name", c1.model === "file-model", c1.model);
    t("从文件读出 timeout_ms", c1.timeoutMs === 1234, String(c1.timeoutMs));
    t("从文件读出语义理解开关 semantic_engine=llm", c1.semanticEngine === "llm", c1.semanticEngine);
    t("文件路径如实回报", c1.configFile === tmp, String(c1.configFile));

    // 12b 有 api_key 即视为启用（不必再写 enabled）
    const l1 = createLLM();
    t("文件里有 api_key 即启用大模型", l1.enabled === true, JSON.stringify(l1.describe()));

    // 12c 配置文件里 enabled=false 一律关掉
    fs.writeFileSync(tmp, JSON.stringify({ api_key: "sk-from-file", enabled: false }));
    const l2 = createLLM();
    t("配置文件 enabled=false 关掉大模型", l2.enabled === false, JSON.stringify(l2.describe()));

    // 12d 环境变量覆盖文件
    fs.writeFileSync(tmp, JSON.stringify({ api_key: "sk-from-file", model_name: "file-model" }));
    process.env.LLM_MODEL = "env-model";
    t("环境变量覆盖文件里的 model_name", readConfig(process.env).model === "env-model", readConfig(process.env).model);

    // 12e 代码入参覆盖环境变量
    t("代码入参覆盖环境变量", createLLM({ model: "code-model" }).conf.model === "code-model", createLLM({ model: "code-model" }).conf.model);

    // 12f 文件不存在或不是合法 JSON：不影响规则问答，只如实标注
    process.env.LLM_CONFIG_FILE = p.join(os.tmpdir(), "shwo-no-such-" + process.pid + ".json");
    const l3 = createLLM();
    t("配置文件不存在时不报错、按未配置处理", l3.enabled === false && !l3.conf.configError, JSON.stringify(l3.describe()));
    fs.writeFileSync(tmp, "{ 这不是 JSON");
    process.env.LLM_CONFIG_FILE = tmp;
    const l4 = createLLM();
    t("配置文件不是合法 JSON 时如实标注错误、仍按未配置处理", l4.enabled === false && !!l4.conf.configError, JSON.stringify(l4.describe()));

    // 12g OSDK 的语义理解开关接口：回报默认档位与模型可用性
    fs.writeFileSync(tmp, JSON.stringify({ semantic_engine: "rule", api_key: "sk-from-file" }));
    process.env.LLM_CONFIG_FILE = tmp;
    {
      const { createService } = require("../src/osdk/service.js");
      const svc = createService(qaWorld().app);
      const H = { "currentnetuserid": "t", "x-sys-code": "data", "x-context-key-groups": encodeURIComponent("地市优化工程师") };
      const P = "/agent-onto-harness/api/v1/osdk/shwo-weak-coverage/qa/mode";
      const m = svc.dispatch({ method: "GET", path: P, headers: H, query: new Map(), body: {} });
      t("GET /qa/mode 返回信封 code=0", m.body.code === 0, JSON.stringify(m.body).slice(0, 200));
      t("回报 semanticEngine=rule（按文件）", m.body.data.semanticEngine === "rule", String(m.body.data.semanticEngine));
      t("回报模型已启用", m.body.data.llm.enabled === true, JSON.stringify(m.body.data.llm));
      t("回报模型名与配置文件路径", m.body.data.llm.model === undefined || m.body.data.llm.configFile === tmp, JSON.stringify(m.body.data.llm));
    }

    // 12h 语义理解开关为 llm 时，/qa/ask 缺省 mode 也走大模型
    {
      const srv = await fakeServer(stage => (stage === "understand"
        ? { intent: "cause", cell: CELL, dates: [], ids: [], reason: "问根因" }
        : "按本体判断，问题出在总下倾角偏小。"));
      fs.writeFileSync(tmp, JSON.stringify({ semantic_engine: "llm", api_key: "sk-from-file", base_url: srv.baseUrl, model_name: "file-model" }));
      process.env.LLM_CONFIG_FILE = tmp;
      const { createService } = require("../src/osdk/service.js");
      const svc = createService(qaWorld().app);
      const H = { "currentnetuserid": "t", "x-sys-code": "data", "x-context-key-groups": encodeURIComponent("地市优化工程师") };
      const P = "/agent-onto-harness/api/v1/osdk/shwo-weak-coverage/qa/ask";
      const r = await svc.dispatch({ method: "POST", path: P, headers: H, query: new Map(), body: { question: "崇贤达那个站为啥弱覆盖啊" } });
      t("semantic_engine=llm 时缺省即走大模型（by=llm）", r.body.data.by === "llm", JSON.stringify(r.body.data.llm));
      await srv.close();
    }

    // 还原环境并清理临时文件
    for (const [k, v] of savedKeys) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (savedFile === undefined) delete process.env.LLM_CONFIG_FILE; else process.env.LLM_CONFIG_FILE = savedFile;
    try { fs.unlinkSync(tmp); } catch { /* 已删 */ }
  }

  // ── 13 流式：网关的流式返回与问答流式接口
  console.log("13 流式（SSE）");
  {
    // 13a 客户端能解析网关的流式返回
    const srv = await fakeServer(() => ({ __stream: ["问题出在总下倾角偏小：", "总下倾 6°，推荐下倾 7.35°，缺口 1.35°。"] }));
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const chunks = [];
    for await (const c of llm.chatStream([{ role: "user", content: "根因" }])) chunks.push(c);
    t("网关的流式返回被逐段解析出来", chunks.join("") === "问题出在总下倾角偏小：总下倾 6°，推荐下倾 7.35°，缺口 1.35°。", JSON.stringify(chunks));
    t("逐段送出（不止一段）", chunks.length === 2, String(chunks.length));
    await srv.close();
  }
  {
    // 13b 问答的流式接口在大模型模式下同样按帧送出
    const srv = await fakeServer(stage => (stage === "understand"
      ? { intent: "scan", cell: "", dates: [], ids: [], reason: "问哪些小区弱覆盖" }
      : { __stream: ["发现清单里共 12 个小区：", "达到 6、未达到 3、证据不足 3。"] }));
    const KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"];
    const saved = KEYS.map(k => [k, process.env[k]]);
    process.env.LLM_BASE_URL = srv.baseUrl; process.env.LLM_API_KEY = "test-key"; process.env.LLM_MODEL = "fake-model";
    try {
      const { createServer } = require("../src/osdk/http.js");
      const http = createServer();
      await new Promise(r => http.listen(0, "127.0.0.1", r));
      const url = `http://127.0.0.1:${http.address().port}/agent-onto-harness/api/v1/osdk/shwo-weak-coverage/qa/ask/stream`;
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", currentnetuserid: "t", "x-sys-code": "data", "x-context-key-groups": encodeURIComponent("地市优化工程师") }, body: JSON.stringify({ question: "哪些小区弱覆盖", mode: "llm" }) });
      const raw = await res.text();
      const frames = raw.split("\n\n").filter(Boolean).map(f => {
        const ev = { type: "", data: null };
        for (const line of f.split("\n")) {
          if (line.startsWith("event:")) ev.type = line.slice(6).trim();
          else if (line.startsWith("data:")) { try { ev.data = JSON.parse(line.slice(5).trim()); } catch { ev.data = null; } }
        }
        return ev;
      });
      const types = frames.map(f => f.type);
      const iRefs = types.indexOf("refs"), iDelta = types.indexOf("delta");
      t("大模型模式：响应是 text/event-stream", (res.headers.get("content-type") || "").includes("text/event-stream"), res.headers.get("content-type"));
      t("帧顺序：先 meta（阶段），再 refs（本体资源），再 delta…，最后 done", types[0] === "meta" && iRefs > 0 && iDelta > iRefs && types[types.length - 1] === "done", types.join(","));
      const deltas = frames.filter(f => f.type === "delta").map(f => f.data.text || "").join("");
      const done = frames[frames.length - 1].data.out || {};
      t("增量拼起来就是完整回答", deltas === done.text && deltas.length > 0, `增量 ${deltas.length} 字`);
      t("最终回答由大模型改写（by=llm）", done.by === "llm", String(done.by));
      t("落地检查通过（数值都来自本体事实）", done.grounded && done.grounded.ok === true, JSON.stringify(done.grounded));
      t("refs 帧给出依据的本体资源", ((frames.find(f => f.type === "refs") || {}).data?.refs || []).includes("F_12"), JSON.stringify((frames.find(f => f.type === "refs") || {}).data));
      await new Promise(r => http.close(r));
    } finally {
      for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      await srv.close();
    }
  }

  {
    // 13c 首字不等整段生成完：网关一段一段吐（每段间隔 200ms），首段增量应明显早于末段
    const srv = await fakeServer(() => ({ __stream: ["发现清单里共 12 个小区。", "达到 6、未达到 3、证据不足 3。"], __streamGap: 200 }));
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa } = newQA();
    const llmqa = createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } });
    const t0 = Date.now(); let first = 0, last = 0;
    for await (const ev of llmqa.askStream("哪些小区弱覆盖", { readOnly: true })) {
      if (ev.type === "delta") { if (!first) first = Date.now() - t0; last = Date.now() - t0; }
    }
    t("首段增量先到：边生成边送，不等整段生成完", first > 0 && last - first >= 120, `首段 ${first}ms，末段 ${last}ms`);
    await srv.close();
  }
  {
    // 13d 规则引擎能直接识别的问句不再整轮调语义解析（省掉一次串行往返）
    const calls = [];
    const srv = await fakeServer(stage => { calls.push(stage); return { __stream: ["按本体判断，工单状态见事实。"] }; });
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa } = newQA();
    const llmqa = createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } });
    const r = await llmqa.ask("工单有哪些状态");
    t("规则能识别的问句跳过语义解析（只调一次模型做措辞）", r.intent === "meta.states" && calls.length === 1 && calls[0] === "naturalize", calls.join(","));
    await srv.close();
  }
  {
    // 13e 口语问法规则接不住时，仍由大模型解析意图
    const calls = [];
    const srv = await fakeServer(stage => {
      calls.push(stage);
      return stage === "understand" ? { intent: "cause", cell: CELL, dates: [], ids: [], reason: "问根因" } : { __stream: ["按本体判断，问题出在总下倾角偏小。"] };
    });
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa } = newQA();
    const llmqa = createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } });
    const r = await llmqa.ask("崇贤达那个站为啥弱覆盖啊");
    t("规则接不住时才调语义解析，且结果被采用", r.intent === "cause" && calls[0] === "understand" && r.by === "llm", calls.join(",") + " / " + r.by);
    await srv.close();
  }

  console.log(`\n结果：${pass}/${pass + fail} 条断言通过`);  if (fail) { console.log("有用例未通过"); process.exitCode = 1; }
})();
