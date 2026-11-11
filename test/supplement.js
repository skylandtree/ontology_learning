// 本体外知识补充层测试：本体答不了时，LLM 补一段通用参考；补得对、补得可控、补不写库。
// 运行：node test/supplement.js
const http = require("node:http");
const { createLLM } = require("../src/llm.js");
const { createLLMQA } = require("../src/qa-llm.js");
const { createQA } = require("../src/qa.js");
const { checkSupplement, GAP_KIND } = require("../src/qa-supplement.js");
const { qaWorld } = require("../src/qa-eval.js");

let pass = 0, fail = 0;
const t = (name, cond, detail) => {
  if (cond) { pass += 1; console.log("  ✓ " + name); }
  else { fail += 1; console.log("  ✗ " + name + (detail ? " —— " + detail : "")); }
};

// 假网关：按提示词区分三个阶段——语义解析器／自然化／知识顾问（补充）
function fakeServer(handler) {
  const srv = http.createServer((req, res) => {
    let buf = "";
    req.on("data", c => { buf += c; });
    req.on("end", async () => {
      let body = {};
      try { body = JSON.parse(buf); } catch { /* 忽略 */ }
      const sys = (body.messages || []).map(m => String(m.content || "")).join("\n");
      const stage = /语义解析器/.test(sys) ? "understand" : /知识顾问/.test(sys) ? "supplement" : "naturalize";
      let out;
      try { out = await handler(stage, body); } catch { out = "{}"; }
      const send = (status, payload) => { try { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); } catch { /* 已断 */ } };
      const content = typeof out === "string" ? out : JSON.stringify(out);
      send(200, { id: "fake", object: "chat.completion", model: body.model || "fake-model",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 42, completion_tokens: 18, total_tokens: 60 } });
    });
  });
  return new Promise(resolve => srv.listen(0, "127.0.0.1", () => {
    const port = srv.address().port;
    resolve({ baseUrl: `http://127.0.0.1:${port}/v1`, close: () => new Promise(r => srv.close(r)) });
  }));
}

(async () => {
  const world = qaWorld();
  const app = world.app;
  const cells = app.store.list("OT_CELL").map(c => c.cellName);
  const CELL = cells.find(n => /崇贤达/.test(n)) || cells[0];
  const NEWQA = () => { const qa = createQA(app); return { qa, llmqa: llm => createLLMQA({ qa, app, llm, opts: { defaultCell: CELL } }) }; };
  // 建好一套 llmqa（用假网关）
  const withLLM = async handler => {
    const srv = await fakeServer(handler);
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa, llmqa } = NEWQA();
    return { srv, qa, llmqa: llmqa(llm) };
  };

  // ── 1 规则层：本体答不了时必须显式声明缺口类型
  console.log("1 规则层声明缺口（本体答不了的五种形态）");
  {
    const qa = createQA(app);
    const cases = [
      ["范围外：重叠覆盖工单", "杨浦那张重叠覆盖的工单怎么处理", "scope"],
      ["能力缺口：调功率", "能不能把发射功率调高一点", "capability"],
      ["能力缺口：预测", "能不能预测下个月的话务趋势", "capability"],
      ["规则缺口：NR 下倾", "5G 小区能不能用这个方法判断根因", "rule"],
    ];
    for (const [name, q, kind] of cases) {
      const out = qa.ask(q);
      t(`${name} → gap.kind=${kind}`, out.gap && out.gap.kind === kind, `实际 ${out.gap ? out.gap.kind : "无 gap"}｜intent=${out.intent}`);
      t(`${name} → gap 带边界说明`, !!(out.gap && out.gap.boundary && out.gap.boundary.length > 8), out.gap ? out.gap.boundary : "");
    }
    const fb = qa.ask("今天天气怎么样");
    t("意图未识别 → gap.kind=unrecognized", fb.gap && fb.gap.kind === "unrecognized", `实际 ${fb.gap ? fb.gap.kind : "无 gap"}`);
    t("五种缺口类型都有中文名", Object.keys(GAP_KIND).length === 5 && Object.values(GAP_KIND).every(Boolean), JSON.stringify(GAP_KIND));
  }

  // ── 2 本体能答的问题不触发补充（补充只在缺口时出现）
  console.log("2 本体能答时不补");
  {
    const srv = await fakeServer(stage => {
      if (stage === "understand") return { intent: "cause", cell: CELL, dates: [], ids: [], reason: "问根因" };
      if (stage === "supplement") return "这一段不该出现。";
      const facts = (body => body)(null);
      return "按本体判断，问题出在总下倾角偏小。";
    });
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa, llmqa } = NEWQA();
    const r = await llmqa.ask(`${CELL} 的根因是哪一类问题`);
    t("没有 supplement 字段", !r.supplement, JSON.stringify(r.supplement));
    t("回答仍来自本体规则", r.by === "llm" && r.refs.length > 0, `${r.by} ${r.refs}`);
    await srv.close();
  }

  // ── 3 缺口时补一段通用参考，且不写库
  console.log("3 缺口时补一段通用参考");
  {
    const srv = await fakeServer(stage => {
      if (stage === "understand") return { intent: "unsupported", cell: "", dates: [], ids: [], reason: "问调功率" };
      if (stage === "supplement") return "发射功率是弱覆盖排查里的一个常规方向，通常先看现网功率与规划值的差距，再结合 MR 逐日采样分布判断是不是功率受限。这类问题在当前工作台里没有建模，结论要由地市优化工程师结合现场情况确认。";
      return "本体的措施字典里没有这类调整。";
    });
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa, llmqa } = NEWQA();
    const before = app.store.runs().length;
    const r = await llmqa.ask("能不能把发射功率调高一点");
    const after = app.store.runs().length;
    t("产生 supplement 且 ok", !!(r.supplement && r.supplement.ok), JSON.stringify(r.supplement));
    t("缺口类型带出来", r.supplement && r.supplement.kind === "capability", r.supplement ? r.supplement.kind : "");
    t("补充段有缺口类型中文名", r.supplement && /能力缺口/.test(r.supplement.kindLabel), r.supplement ? r.supplement.kindLabel : "");
    t("补充段正文非空", r.supplement && r.supplement.text.length > 20, r.supplement ? r.supplement.text : "");
    t("补充段带免责说明", r.supplement && /不是本体的判定/.test(r.supplement.text), r.supplement ? r.supplement.text.slice(-80) : "");
    t("补充不写库（动作审计条数不变）", before === after, `${before} → ${after}`);
    t("补充不并入本体事实文本", !/发射功率是弱覆盖排查/.test(r.text), r.text.slice(0, 160));
    await srv.close();
  }

  // ── 4 补充段的落地检查：编号不编造、不冒充判定、不给指令、不给参数
  console.log("4 补充段的落地检查");
  {
    const g = checkSupplement("可以先看 F_08 的判定过程。", ["F_08"], "rule");
    t("引用本体已有的编号放行", g.ok === true, JSON.stringify(g.issues));
    const g2 = checkSupplement("可以先看 F_99 的判定过程。", ["F_08"], "rule");
    t("编造编号被拦下", g2.ok === false && /编号/.test(g2.issues.join("")), JSON.stringify(g2.issues));
    const g3 = checkSupplement("这个小区判定为命中，建议下倾 2 度。", [], "rule");
    t("冒充判定被拦下", g3.ok === false && /判定/.test(g3.issues.join("")), JSON.stringify(g3.issues));
    const g4 = checkSupplement("把功率调到 23 dBm 试试。", [], "capability");
    t("可执行指令被拦下", g4.ok === false && /指令/.test(g4.issues.join("")), JSON.stringify(g4.issues));
    const g5 = checkSupplement("门限取 20%，容差 0.5 度。", [], "rule");
    t("疑似系统参数的数值被拦下", g5.ok === false && /数值/.test(g5.issues.join("")), JSON.stringify(g5.issues));
    const g6 = checkSupplement("参考 3GPP TS 38.901 的 n78 频段口径。", [], "rule");
    t("标准编号与频段号放行", g6.ok === true, JSON.stringify(g6.issues));
    const g7 = checkSupplement("预计下个月会继续恶化。", [], "capability");
    t("能力缺口不给趋势结论", g7.ok === false && /趋势/.test(g7.issues.join("")), JSON.stringify(g7.issues));
    const g8 = checkSupplement("这个小区未命中，不符合派单条件。", [], "rule");
    t("“未命中”不算冒充判定", g8.ok === true, JSON.stringify(g8.issues));
  }

  // ── 5 补充两次都不过检查：整段丢弃，回答仍是规则原文（不放行不合格内容）
  console.log("5 补充不合格就丢弃");
  {
    let calls = 0;
    const srv = await fakeServer(stage => {
      if (stage === "understand") return { intent: "unsupported", cell: "", dates: [], ids: [], reason: "问调功率" };
      if (stage === "supplement") { calls += 1; return "这个小区判定为命中，建议把功率调到 23 dBm。"; }
      return "本体的措施字典里没有这类调整。";
    });
    const llm = createLLM({ baseUrl: srv.baseUrl, apiKey: "k", model: "fake-model", retries: 0, timeoutMs: 3000 });
    const { qa, llmqa } = NEWQA();
    const r = await llmqa.ask("能不能把发射功率调高一点");
    t("重写了一次仍不合格就不补", r.supplement && r.supplement.ok === false, JSON.stringify(r.supplement));
    t("补充文本为空", r.supplement && !r.supplement.text, r.supplement ? r.supplement.text : "");
    t("不合格内容没有进入回答", !/23 dBm|判定为命中/.test(r.text), r.text.slice(0, 200));
    t("问题点回给了模型重写", calls >= 2, `调用 ${calls} 次`);
    await srv.close();
  }

  // ── 6 模型不可用时：照常回答，只是没有补充
  console.log("6 模型不可用时不补也不报错");
  {
    const llm = createLLM({ apiKey: "", baseUrl: "http://127.0.0.1:1/v1" });
    const { qa, llmqa } = NEWQA();
    const r = await llmqa.ask("能不能把发射功率调高一点");
    t("退回规则回答", r.by === "rule" && r.intent === "unsupported", `${r.by}/${r.intent}`);
    t("没有补充段", !r.supplement, JSON.stringify(r.supplement));
    t("规则回答仍说明边界", /措施字典/.test(r.text), r.text.slice(0, 120));
  }

  // ── 7 流式接口：补充作为独立的一帧送出，不混进本体的 delta
  console.log("7 流式接口里的补充帧");
  {
    const srv = await fakeServer(stage => {
      if (stage === "understand") return { intent: "unsupported", cell: "", dates: [], ids: [], reason: "问调功率" };
      if (stage === "supplement") return "功率是常规排查方向之一，但当前工作台没有把它建成措施，结论要由工程师结合现场确认。";
      return "本体的措施字典里没有这类调整。";
    });
    const KEYS = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"];
    const saved = KEYS.map(k => [k, process.env[k]]);
    process.env.LLM_BASE_URL = srv.baseUrl; process.env.LLM_API_KEY = "test-key"; process.env.LLM_MODEL = "fake-model";
    let http = null;
    try {
      const { createServer } = require("../src/osdk/http.js");
      http = createServer();
      await new Promise(r => http.listen(0, "127.0.0.1", r));
      const url = `http://127.0.0.1:${http.address().port}/agent-onto-harness/api/v1/osdk/shwo-weak-coverage/qa/ask/stream`;
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", currentnetuserid: "t", "x-sys-code": "data", "x-context-key-groups": encodeURIComponent("地市优化工程师") }, body: JSON.stringify({ question: "能不能把发射功率调高一点", mode: "llm" }) });
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
      t("有一帧独立的 supplement", types.includes("supplement"), types.join(","));
      const sf = frames.find(f => f.type === "supplement");
      t("补充帧带缺口类型与正文", !!(sf && sf.data.supplement && sf.data.supplement.kind === "capability" && sf.data.supplement.text.length > 10), JSON.stringify(sf && sf.data));
      const done = frames[frames.length - 1].data.out || {};
      t("最终结果带 supplement 字段", !!(done.supplement && done.supplement.ok), JSON.stringify(done.supplement));
      t("补充不并入本体事实文本", !/功率是常规排查方向/.test(done.text), done.text.slice(0, 160));
      t("本体的落地检查只管事实（仍通过）", done.grounded && done.grounded.ok === true, JSON.stringify(done.grounded));
      await new Promise(r => http.close(r));
    } finally {
      for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[v] = v; }
      await srv.close();
    }
  }

  console.log(`\n结果：${pass}/${pass + fail} 条断言通过`);
  if (fail) { console.log("有用例未通过"); process.exitCode = 1; }
})();
