// 本体后端服务：按《OSDK REST API 规范 v1.0》把本体能力暴露为 REST 接口。
// 规范内的 8 个能力域（Metadata／Query／Mutation／Aggregate／Function／Action／ObjectSet／Search Around）全部实现；
// 另有一组规范外的应用层接口（同一前缀下另起路径，README 里分开标名）：问答、仿真时钟、动作审计、版本历史、
// 关系读取、来源事实、MR 数据到达、完整本体定义。
// dispatch(req) 是同步的进程内入口，HTTP 包装见 http.js——两者走同一套鉴权、信封与错误码。
const { createMeta } = require("./meta.js"), { createObjects } = require("./objects.js"), { OPS } = require("./where.js");
const E = require("./errors.js"), { OsdkError } = E;
const { createQA } = require("../qa.js");
const { createLLMQA } = require("../qa-llm.js");
const { createQAStream } = require("../qa-stream.js");
const { createLLM } = require("../llm.js");

const BASE = "/agent-onto-harness";
const ROLE_KEYS = { "optimizer-bot": "优化本体", bot: "优化本体", engineer: "地市优化工程师", optimizer: "地市优化工程师",
  supervisor: "优化主管", field: "现场维护人员", expert: "优化专家", knowledge: "知识维护人" };

const decode = s => { try { return decodeURIComponent(String(s)); } catch { return String(s); } };
function rolesOf(headers) {
  const raw = headers["x-context-key-groups"];
  if (!raw) return [];
  return String(Array.isArray(raw) ? raw.join(",") : raw).split(",").map(s => s.trim()).filter(Boolean).map(s => { const v = decode(s); return ROLE_KEYS[v] || ROLE_KEYS[v.toLowerCase()] || v; });
}

function createService(app, opt = {}) {
  const meta = createMeta(app.ont), obj = createObjects(app, meta), qa = opt.qa === null ? null : createQA(app);
  // 大模型问答：同一路径的可选模式，不是另一套后端。未配置 LLM_API_KEY 时 llm.enabled=false，
  // 请求自动退回规则问答，接口路径、信封与 errorCode 与规则模式完全一致。
  // 语义理解引擎的默认档位来自本地配置文件 config/llm.config.json（semantic_engine：rule｜llm）。
  const llm = createLLM();
  const llmConf = llm.conf;
  const llmqa = qa ? createLLMQA({ qa, app, llm }) : null;
  const qastream = qa ? createQAStream({ qa, llmqa, llmConf }) : null;
  const now = () => app.store.peekNow();
  const permission = (effect = "ALLOW", reason = "AllowedByRowFilter") => ({ traceId: E.traceId(), decision: { effect, reason } });
  const must = (p, names, what) => { const miss = names.filter(n => p[n] === undefined || p[n] === null); if (miss.length) throw new OsdkError("INVALID_PARAMETER", `${what} 缺入参：${miss.join("、")}`); };
  const num = (v, what) => { if (typeof v !== "number" || !Number.isFinite(v)) throw new OsdkError("INVALID_PARAMETER", `${what} 应为数值`); return v; };

  // ── 函数：只计算、不写记录（F_05／F_06／F_07／F_08／F_11／F_12 需要读对象，经 facts／函数服务组装输入）
  const FN = {
    F_01: p => { must(p, ["siteA", "siteB"], "F_01"); return app.F.F01(p.siteA, p.siteB); },
    F_02: p => { must(p, ["h", "theta", "beta"], "F_02"); return app.F.F02(num(p.h, "h"), num(p.theta, "theta"), num(p.beta, "beta"), p.rat || "LTE"); },
    F_03: p => { must(p, ["mechTilt", "elecTilt"], "F_03"); return app.F.F03(num(p.mechTilt, "mechTilt"), num(p.elecTilt, "elecTilt")); },
    F_04: p => { must(p, ["h", "beta", "Rt"], "F_04"); return app.F.F04(num(p.h, "h"), num(p.beta, "beta"), num(p.Rt, "Rt")); },
    F_05: p => {
      must(p, ["cellKey", "date"], "F_05");
      const rule = p.ruleId ? app.ont.raw.dispatchRules.find(r => r.ruleId === p.ruleId) : (app.facts.ruleFor(p.cellKey, p.date + "T00:00:00").rule || null);
      if (p.ruleId && !rule) throw new OsdkError("INVALID_PARAMETER", `未知的派单规则：${p.ruleId}`);
      const o = app.facts.mr(p.cellKey, p.date);
      return app.F.F05(p.date, o && { ...o.doc, mrKey: `${p.cellKey}@${p.date}`, version: o.ver }, rule);
    },
    F_06: p => { must(p, ["cellKey"], "F_06"); return app.svc.discover(p.cellKey, p.refTime || now()); },
    F_07: p => { must(p, ["cellKey", "hitDates"], "F_07"); if (!Array.isArray(p.hitDates)) throw new OsdkError("INVALID_PARAMETER", "hitDates 应为数组"); return app.svc.falseWeak(p.cellKey, p.hitDates, p.refTime || now()); },
    F_08: p => { must(p, ["cellKey"], "F_08"); return app.svc.matchTilt(p.cellKey, p.asOf || now()); },
    F_09: p => { must(p, ["gap", "adjustType"], "F_09"); return app.F.F09(num(p.gap, "gap"), p.adjustType); },
    F_10: p => { must(p, ["cellKey", "adjustType", "planDelta"], "F_10"); return app.svc.impact(p.cellKey, p.adjustType, num(p.planDelta, "planDelta"), p.asOf || now(), p.fixedDelta); },
    F_11: p => {
      must(p, ["planNo"], "F_11");
      const plan = app.store.doc("OT_PLAN", p.planNo); if (!plan) throw new OsdkError("OBJECT_NOT_FOUND", `方案 ${p.planNo} 不存在`);
      const ticket = app.store.doc("OT_TICKET", plan.ticketNo); if (!ticket) throw new OsdkError("OBJECT_NOT_FOUND", `工单 ${plan.ticketNo} 不存在`);
      if (!plan.execution || !plan.execution.executeTime) throw new OsdkError("INVALID_PARAMETER", `方案 ${p.planNo} 尚无执行信息，不能评价（F_11 前提：方案已实施）`);
      return app.svc.effect(ticket, plan, plan.execution.executeTime, p.refTime || now());
    },
    F_12: p => { must(p, ["scope"], "F_12"); if (!Array.isArray(p.scope)) throw new OsdkError("INVALID_PARAMETER", "scope 应为数组"); return app.svc.scan(p.scope, p.refTime || now()); }
  };
  function executeFunction(code, body = {}) {
    const def = meta.functions.find(f => f.code === code);
    if (!def) throw new OsdkError("OSDK_FUNCTION_NOT_FOUND", `函数 ${code} 不在本体中`);
    if (!def.executable) throw new OsdkError("OSDK_FUNCTION_TYPE_UNSUPPORTED", `函数 ${code} 当前不可执行`);
    if (def.type !== "QUERY") throw new OsdkError("OSDK_FUNCTION_TYPE_UNSUPPORTED", `函数 ${code} 类型为 ${def.type}，不支持执行`);
    const params = body.params || body || {}, before = app.store.runs().length, result = FN[code](params);
    let out = result;
    if (out && Array.isArray(out.items) && (body.limit !== undefined || body.offset !== undefined)) {
      const total = out.items.length, offset = body.offset || 0, limit = body.limit === undefined ? 100 : body.limit;
      out = { ...out, items: out.items.slice(offset, offset + limit), totalCount: total };
    }
    return { result: out, meta: { functionCode: code, functionVersion: def.version, readOnly: true, writes: app.store.runs().length - before }, permission: permission("ALLOW", "FunctionReadOnly") };
  }

  // ── 动作：参数校验 → 角色校验 → 约束（事务内）→ 审计；拒绝按 SPEC 的失败码透出
  function executeAction(code, body = {}, ctx = {}) {
    const def = meta.actions.find(a => a.code === code);
    if (!def) throw new OsdkError("OSDK_ACTION_NOT_FOUND", `动作 ${code} 不在本体中`);
    const params = body.params || body || {}, roles = ctx.roles || [];
    const role = roles.find(r => def.roles.includes(r)) || roles[0] || null;
    if (!role) throw new OsdkError("PERMISSION_DENIED", `缺角色：动作 ${code} 允许 ${def.roles.join("／")}，须在 x-context-key-groups 中给出`);
    // 角色与“只定义不运行”的拒绝都交给动作层判定：拒绝同样要留审计（SPEC 3.2）
    const before = app.store.runs().length, r = app.act(code, params, { role, name: ctx.user || role });
    const runs = app.store.runs().slice(before), last = runs[runs.length - 1] || null;
    const audit = last ? { runId: last.runId, actionId: last.actionId, actor: last.actor, role: last.role, target: last.target, outcome: last.outcome, time: last.t } : null;
    if (!r.ok) throw new OsdkError(r.code, r.msg || r.code, { actionId: code, audit, result: r.result === undefined ? null : r.result });
    return { result: r.result, audit, permission: permission("ALLOW", "ActionRolesAllowed") };
  }

  // ── 路由
  function route(method, seg, query, body, ctx) {
    const [p0, p1, p2, p3, p4] = seg;
    const ont = meta.code;
    const isOnt = p0 === "api" && p1 === "v1" && p2 === "osdk";
    if (!isOnt) return null;
    const rest = seg.slice(3);   // 去掉 api/v1/osdk
    const [r0, r1, r2, r3] = rest;
    if (method === "GET" && r0 === "ontologies" && rest.length === 1) return { data: { items: [meta.ontology()], totalCount: 1 } };
    if (method === "GET" && r0 === "errorCodes") return { data: { items: E.REGISTRY, totalCount: E.REGISTRY.length } };
    if (r0 !== ont) throw new OsdkError("NO_CONFIG", `本体 ${r0} 不存在（可用：${ont}）`);
    if (method === "GET" && r1 === "objectTypes" && rest.length === 2) {
      const items = meta.objectTypes(); return { data: { items, totalCount: items.length } };
    }
    if (method === "GET" && r1 === "objectTypes" && rest.length === 3) {
      if (!meta.hasType(r2)) throw new OsdkError("OBJECT_NOT_FOUND", `对象类型 ${r2} 不在本体中`);
      return { data: meta.schema(r2) };
    }
    if (method === "GET" && r1 === "definition") return { data: app.ont.raw };
    if (method === "GET" && r1 === "functions") {
      const t = query.get("type"), items = meta.functions.filter(f => !t || f.type === t);
      return { data: { items, totalCount: items.length } };
    }
    if (method === "GET" && r1 === "actions") {
      const t = query.get("type"), items = meta.actions.filter(a => !t || a.type === t);
      return { data: { items, totalCount: items.length } };
    }
    if (method === "POST" && r1 === "functions" && r3 === "execute") return { data: executeFunction(r2, body) };
    if (method === "POST" && r1 === "actions" && r3 === "execute") return { data: executeAction(r2, body, ctx) };
    if (method === "POST" && r1 === "search-around") return { data: obj.searchAround(body) };
    if (method === "GET" && r1 === "relations") return { data: obj.allRelations({ rt: query.get("rt") || undefined, from: query.get("from") || undefined, to: query.get("to") || undefined, asOf: query.get("asOf") || undefined }) };
    // DM_01：MR 平台日汇总到达／更正——按业务日期归日，同日新增版本并建 RT_16（INV_17），不创建工单
    if (method === "POST" && r1 === "ingest" && r2 === "cell-mr") {
      const rows = body.rows;
      if (!Array.isArray(rows) || !rows.length) throw new OsdkError("INVALID_PARAMETER", "rows 必填（OT_CELL_MR 行数组）");
      for (const r of rows) if (!r.cellKey || !r.date || typeof r.sampleTotal !== "number" || typeof r.sampleWeak !== "number") throw new OsdkError("INVALID_PARAMETER", "每行须含 cellKey、date、sampleTotal、sampleWeak");
      require("../loader.js").loadMR(app.store, rows);
      return { data: { received: rows.length, cells: [...new Set(rows.map(r => r.cellKey))] } };
    }
    if (method === "POST" && r1 === "object-sets" && r2 === "compose") return { data: obj.compose(body) };
    if (r1 === "objects" && r2) {
      const t = r2, key = r3, sub = rest[4];
      if (method === "GET" && !key) { const q = obj.query(t, { asOf: query.get("asOf"), limit: Number(query.get("limit") || 100), offset: Number(query.get("offset") || 0) }); return { data: q }; }
      if (method === "GET" && key === "aggregate") throw new OsdkError("INVALID_PARAMETER", "聚合请用 POST");
      if (method === "POST" && key === "query") return { data: obj.query(t, body) };
      if (method === "POST" && key === "aggregate") return { data: obj.aggregate(t, body) };
      if (method === "POST" && !key) { const r = obj.create(t, body); return { status: r.status, data: r.data }; }
      if (method === "GET" && key && sub === "history") return { data: obj.history(t, key) };
      if (method === "GET" && key && sub === "relations") return { data: obj.relations(t, key, { rt: query.get("rt") || undefined, asOf: query.get("asOf") || undefined }) };
      if (method === "GET" && key) return { data: obj.getAt(t, key, query.get("asOf"), query.get("ver")) };
      if (method === "PUT" && key) return { data: obj.update(t, key, body, { source: query.get("source") || undefined }) };
      if (method === "DELETE" && key) return { data: obj.remove(t, key) };
    }
    if (r1 === "audit" && r2 === "runs" && method === "GET") {
      const f = { actionId: query.get("actionId") || undefined, target: query.get("target") || undefined, outcome: query.get("outcome") || undefined };
      const items = app.store.runs(f); return { data: { items, totalCount: items.length } };
    }
    if (r1 === "facts" && r2 === "antenna-state" && method === "GET") {
      const st = app.facts.antennaState(r3, query.get("asOf") || undefined);
      if (!st) throw new OsdkError("OBJECT_NOT_FOUND", `天线 ${r3} 不存在`);
      return { data: st };
    }
    if (r1 === "facts" && r2 === "alarms" && method === "GET") {
      const cell = query.get("cell"); if (!cell) throw new OsdkError("INVALID_PARAMETER", "cell 必填");
      const items = app.store.alarms(cell); return { data: { items, totalCount: items.length } };
    }
    if (r1 === "facts" && r2 === "field-executions" && method === "GET") {
      const cell = query.get("cell"); if (!cell) throw new OsdkError("INVALID_PARAMETER", "cell 必填");
      const r = app.facts.fieldExecutions(cell, query.get("asOf") || undefined);
      return { data: { items: r.items, pending: r.pending, totalCount: r.totalCount } };
    }
    // 现场回填记录上报（来源事实，应用层）：现场维护人员把实测值报回来。
    // 这不是本体动作，不写任何 OT_ 对象；回填仍要由 A_06 按 INV_07／INV_08 校验后写入。
    // 决策链停在「实施回填」等这条记录时，人工在这里补上，再重新执行链即可继续。
    if (r1 === "facts" && r2 === "field-executions" && method === "POST") {
      const q = body.cellKey || body.cell;
      const cell = q ? (app.store.doc("OT_CELL", q) || app.store.list("OT_CELL").find(c => c.cellName === q)) : null;
      if (!cell) throw new OsdkError("OBJECT_NOT_FOUND", `小区 ${q || "（未给出）"} 不存在`);
      const allowed = ((meta.actions.find(a => a.code === "A_06") || {}).roles) || [];
      const role = (ctx.roles || []).find(r => allowed.includes(r));
      if (!role) throw new OsdkError("PERMISSION_DENIED", `现场回填记录须由 ${allowed.join("／")} 上报（x-context-key-groups）`);
      must(body, ["antennaId", "param", "toValue", "executeTime"], "现场回填记录");
      num(body.toValue, "toValue");
      if (body.fromValue !== undefined) num(body.fromValue, "fromValue");
      const receipt = body.receipt || "成功";
      if (!["成功", "失败"].includes(receipt)) throw new OsdkError("INVALID_PARAMETER", "receipt 只能是 成功／失败");
      const rec = {
        taskno: body.taskno || `FR-${String(cell.cellKey).replace(/[^0-9A-Za-z]/g, "")}-${now().replace(/[^0-9]/g, "").slice(0, 14)}`,
        cellName: cell.cellName, cellKey: cell.cellKey,
        antennaId: body.antennaId, param: body.param,
        fromValue: body.fromValue, toValue: body.toValue,
        executeTime: body.executeTime, receivedAt: body.receivedAt || now(),
        executor: body.executor || role, receipt
      };
      (app.seed.fieldExecutions = app.seed.fieldExecutions || []).push(rec);
      return { data: { ...rec, reportedBy: role } };
    }
    if (r1 === "sim" && r2 === "clock") {
      if (method === "POST") { if (!body.now) throw new OsdkError("INVALID_PARAMETER", "now 必填"); app.at(body.now); }
      return { data: { now: now() } };
    }
    // 本体执行链路（应用层）：某小区跑过的业务流程，按本体要素摊开（步骤／函数／约束／规则／对象／关系）
    if (r1 === "trace" && r2 === "cell" && method === "GET") {
      const q = query.get("cell") || query.get("cellKey");
      if (!q) throw new OsdkError("INVALID_PARAMETER", "cell 必填（小区标识或名称）");
      const hit = app.store.doc("OT_CELL", q) || app.store.list("OT_CELL").find(c => c.cellName === q);
      if (!hit) throw new OsdkError("OBJECT_NOT_FOUND", `小区 ${q} 不存在`);
      const key = hit.cellKey || hit.id;
      const tr = app.trace.cellTrace(key, { at: query.get("at") || undefined });
      if (!tr) throw new OsdkError("OBJECT_NOT_FOUND", `小区 ${q} 不存在`);
      return { data: tr };
    }
    // 自主决策链（应用层）：一次调用把某小区从「发现与判定」推进到「闭环与案例」。
    // 每一步都走本体自己的动作入口，链不绕过角色校验与 INV 约束；走到本体走不动的地方就停在那一步并说明原因。
    // 链会用各动作在本体动作表里允许的角色委托执行（含 SPEC 要求人工确认的步骤），并在报告里标 humanGate。
    // until：只执行到第几步（1～7），返回 outcome=partial 与 nextStep；前端据此一步一调、一步一显。
    if (r1 === "chain" && r2 === "run" && method === "POST") {
      const q = body.cellKey || body.cell;
      if (!q) throw new OsdkError("INVALID_PARAMETER", "cellKey 必填");
      const hit = app.store.doc("OT_CELL", q) || app.store.list("OT_CELL").find(c => c.cellName === q);
      if (!hit) throw new OsdkError("OBJECT_NOT_FOUND", `小区 ${q} 不存在`);
      const rep = app.chain.runChain(hit.cellKey || hit.id, {
        actor: ctx.user, delegate: body.delegate !== false,
        until: body.until === undefined || body.until === null ? undefined : Number(body.until)
      });
      return { data: rep };
    }
    if (r1 === "qa" && r2 === "mode" && method === "GET") {
      // 语义理解开关：规则／大模型由配置文件（config/llm.config.json 的 semantic_engine）决定默认，
      // 前端只读它来初始化开关状态；这里如实回报"当前可用的引擎"与"模型是否已配置"。
      const d = llmqa ? llmqa.describe() : { enabled: false };
      return { data: {
        semanticEngine: llmConf.semanticEngine,
        available: llmConf.semanticEngine === "llm" && !!d.enabled,
        llm: { enabled: !!d.enabled, model: d.model || null, baseUrl: d.baseUrl || null, configFile: d.configFile || null, configError: d.configError || null },
        rule: { enabled: true, note: "规则引擎：意图与措辞都在本地，可测可复现" },
        llmNote: d.enabled ? "大模型只改措辞 · 事实来自本体函数"
          : `模型未配置（${d.configFile ? "配置文件 " + d.configFile : "config/llm.config.json"} 的 api_key / base_url / model_name），问答按纯规则运行`
      } };
    }
    if (r1 === "qa" && r2 === "ask" && r3 === "stream" && method === "POST") {
      // 流式问答：与 /qa/ask 同一个问句、同一个规则引擎，只是把回答按 SSE 逐段送出。
      // 事件：meta（引擎／阶段）→ refs（回答依据的本体资源）→ delta（增量文本）→ done（完整回答）
      if (!qa) throw new OsdkError("NOT_IMPLEMENTED", "本服务未启用问答");
      if (!body.question) throw new OsdkError("INVALID_PARAMETER", "question 必填");
      const role = (ctx.roles || [])[0] || null;
      if (typeof body.ticketNo === "string" && body.ticketNo) qa.sess.ticketNo = body.ticketNo;
      if (typeof body.cellKey === "string" && body.cellKey) qa.sess.cellKey = body.cellKey;
      const readOnly = body.readOnly === true;
      qa.sess.readOnly = readOnly;
      const cellName = qa.sess.cellKey ? qa.nameOf(qa.sess.cellKey) : "";
      const opt = {
        role, readOnly,
        history: Array.isArray(body.history) ? body.history : [],
        clock: now(),
        ticketNo: body.ticketNo || qa.sess.ticketNo || "",
        cellName: body.cellName || cellName || "",
        mode: body.mode || llmConf.semanticEngine,
      };
      return {
        stream: true, status: 200,
        contentType: "text/event-stream; charset=utf-8",
        headers: { "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
        events: (async function* () {
          try {
            for await (const ev of qastream.run(body.question, opt)) yield ev;
          } catch (e) {
            const r = E.envelopeError(e);
            yield { type: "error", body: r.body };
          }
        })(),
      };
    }
    if (r1 === "qa" && r2 === "ask" && method === "POST") {
      if (!qa) throw new OsdkError("NOT_IMPLEMENTED", "本服务未启用问答");
      if (!body.question) throw new OsdkError("INVALID_PARAMETER", "question 必填");
      const role = (ctx.roles || [])[0] || null;
      if (typeof body.ticketNo === "string" && body.ticketNo) qa.sess.ticketNo = body.ticketNo;
      // 当前小区（问答上下文）：问句里的“它／这个小区”指向它
      if (typeof body.cellKey === "string" && body.cellKey) qa.sess.cellKey = body.cellKey;
      // 只读模式：问答面板不代为执行写动作，只提示到小区决策流程页执行
      const readOnly = body.readOnly === true;
      qa.sess.readOnly = readOnly;
      const cellName = qa.sess.cellKey ? qa.nameOf(qa.sess.cellKey) : "";
      const pack = out => ({ data: { result: out, intent: out.intent, refs: out.refs, grounded: out.grounded,
        pending: out.pending || [], writes: out.writes || [], text: out.text,
        by: out.by || "rule", llm: out.llm || null,
        // 本体外补充：本体答不了时大模型补的通用参考；不写库、不并入事实
        supplement: out.supplement || null, gap: out.gap || null } });
      // 大模型模式：语义理解与措辞交给模型，事实仍由本体函数给出；数值未落地回退规则原文。
      // 未配置 Key 时 llmqa 自己退回规则并在 llm.enabled=false 里如实标注——不假装在用大模型。
      // mode 缺省时按配置文件的 semantic_engine 走（rule＝默认）；前端显式传 mode 时以它为准。
      const mode = body.mode || llmConf.semanticEngine;
      if (mode === "llm" && llmqa) {
        return Promise.resolve(llmqa.ask(body.question, {
          role, history: Array.isArray(body.history) ? body.history : [],
          clock: now(), ticketNo: body.ticketNo || qa.sess.ticketNo || "",
          cellName: body.cellName || cellName || "", readOnly,
        })).then(pack);
      }
      return pack(qa.ask(body.question, { role, readOnly }));
    }
    if (r1 === "where" && r2 === "ops") return { data: { items: OPS, totalCount: OPS.length } };
    return null;
  }

  function dispatch(req) {
    const method = String(req.method || "GET").toUpperCase();
    let path = String(req.path || "/");
    if (path.startsWith(BASE)) path = path.slice(BASE.length) || "/";
    const seg = path.split("/").filter(Boolean).map(decode);
    const headers = req.headers || {}, rawQ = req.query;
    const query = rawQ instanceof Map ? rawQ
      : rawQ && typeof rawQ.entries === "function" ? new Map([...rawQ.entries()])
        : new Map(Object.entries(rawQ || {}));
    try {
      if (!headers["currentnetuserid"] || !headers["x-sys-code"])
        throw new OsdkError("UNAUTHENTICATED", "缺认证头：currentnetuserid 与 x-sys-code 必填（OSDK 规范 1.2）");
      const ctx = { user: String(headers["currentnetuserid"]), sys: String(headers["x-sys-code"]), roles: rolesOf(headers) };
      if (seg[0] === "api" && seg[1] === "ontology" && seg[2] === "execute-groovy")
        throw new OsdkError("NOT_IMPLEMENTED", "本实现不含 Groovy 引擎：函数与动作请走 /api/v1/osdk/{ontology}/functions|actions/{code}/execute");
      const r = route(method, seg, query, req.body || {}, ctx);
      if (!r) throw new OsdkError("METHOD_NOT_FOUND", `没有这个接口：${method} ${path}`);
      // 流式问答：返回事件流而不是信封（响应头与帧格式由 HTTP 层写）
      if (r && r.stream) return { status: r.status || 200, stream: r.events, contentType: r.contentType, headers: r.headers || {}, traceId: E.traceId() };
      const envelope = v => { const body = E.envelopeOk(v.data); return { status: v.status || 200, body, traceId: body.traceId, data: v.data }; };
      // 大模型问答是异步路由：此时返回 Promise，调用方 await 即可；其余路由仍同步返回。
      if (r && typeof r.then === "function") {
        return r.then(envelope).catch(e => { const rr = E.envelopeError(e); return { status: rr.status, body: rr.body, traceId: rr.body.traceId }; });
      }
      return envelope(r);
    } catch (e) {
      const r = E.envelopeError(e);
      return { status: r.status, body: r.body, traceId: r.body.traceId };
    }
  }
  return { dispatch, meta, obj, qa, app, BASE, rolesOf };
}
module.exports = { createService, BASE, ROLE_KEYS }
