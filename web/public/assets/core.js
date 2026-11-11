/* ============================================================================
   core.js —— 本体后端接口（OSDK REST）客户端 + 全局状态 + 格式化
   前端只做三件事：编排请求、渲染本体要素、保存会话状态（角色／判断时点／当前对象）。
   任何业务结论都必须来自后端返回值；本文件不产生判定。
   ========================================================================== */

export const ONT = "shwo-weak-coverage";
// 从模块所在位置取得入口路径，兼容本地根目录和云端 /ontology/ 反向代理。
export const APP_ROOT = new URL("../", import.meta.url).pathname;
export const BASE = `${APP_ROOT}agent-onto-harness/api/v1/osdk`;

/** 解析一帧 SSE：event 行给出事件名，data 行是 JSON 载荷 */
export function parseSSE(raw) {
  let type = "message", data = "";
  for (const line of String(raw || "").split("\n")) {
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return null;
  try { const j = JSON.parse(data); return { ...j, type: j.type || type }; }
  catch { return { type, text: data }; }
}

/* ── OSDK 客户端 ───────────────────────────────────────────────────────── */
export class Osdk {
  constructor() {
    this.user = "cmdi-ops";
    this.sys  = "data";
    this.role = "地市优化工程师";
    this.asOf = null;            // 判断时点；null＝读最新
    this.trace = null;           // 最近一次后端 traceId
    this.analysisId = null;
  }
  headers() {
    const h = { "currentnetuserid": this.user, "x-sys-code": this.sys };
    if (this.role) h["x-context-key-groups"] = encodeURIComponent(this.role);
    if (this.analysisId) h["x-analysis-id"] = this.analysisId;
    return h;
  }
  async appReq(path, { method = "GET", body, query, keepalive = false } = {}) {
    const url = new URL(`${APP_ROOT}${path}`, location.origin);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, value);
    const response = await fetch(url, { method, keepalive, headers: { ...this.headers(), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    if (!response.ok || data.error) {
      const error = new Error(data.message || `HTTP ${response.status}`);
      error.status = response.status; error.errorCode = data.errorCode; throw error;
    }
    return data;
  }
  newAnalysis(includeDefinition = true, cellKey) { return this.appReq("__analysis", { method: "POST", body: { includeDefinition, cellKey } }); }
  release(keepalive = false) { return this.analysisId ? this.appReq("__analysis", { method: "DELETE", keepalive }) : Promise.resolve(); }
  bootstrap(includeDefinition = false) { return this.appReq("__bootstrap", { query: { definition: includeDefinition } }); }
  summary() { return this.appReq("__summary"); }
  cellContext(cell, effectNo) { return this.appReq("__cell-context", { query: { cell, effectNo } }); }
  reset() { return this.appReq("__reset", { method: "POST" }); }
  async req(method, path, { query, body } = {}) {
    const u = new URL(BASE + path, location.origin);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) u.searchParams.set(k, v);
    const res = await fetch(u, {
      method,
      headers: { ...this.headers(), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let j = {};
    try { j = await res.json(); } catch { j = { error: true, message: "响应不是 JSON", status: res.status }; }
    this.trace = j.traceId || res.headers.get("x-trace-id") || null;
    if (j.error || res.status >= 400) {
      const e = new Error(j.message || j.errorCode || `HTTP ${res.status}`);
      e.errorCode = j.errorCode || "UNKNOWN";
      e.code = j.code; e.status = j.status; e.traceId = j.traceId; e.details = j.details;
      throw e;
    }
    return j.data;
  }
  get(p, q)  { return this.req("GET", p, { query: q }); }
  post(p, b, q) { return this.req("POST", p, { body: b, query: q }); }
  put(p, b, q) { return this.req("PUT", p, { body: b, query: q }); }

  /* 元数据 */
  ontologies()  { return this.get("/ontologies"); }
  definition()  { return this.get(`/${ONT}/definition`); }
  objectTypes() { return this.get(`/${ONT}/objectTypes`); }
  functions()   { return this.get(`/${ONT}/functions`); }
  actions()     { return this.get(`/${ONT}/actions`); }
  errorCodes()  { return this.get("/errorCodes"); }

  /* 对象 */
  query(type, body = {}) { return this.post(`/${ONT}/objects/${type}/query`, body); }
  getObject(type, id, q) { return this.get(`/${ONT}/objects/${type}/${encodeURIComponent(id)}`, q); }
  history(type, id)     { return this.get(`/${ONT}/objects/${type}/${encodeURIComponent(id)}/history`); }
  relations(type, id, q){ return this.get(`/${ONT}/objects/${type}/${encodeURIComponent(id)}/relations`, q); }
  allRelations(q)       { return this.get(`/${ONT}/relations`, q); }
  aggregate(type, body) { return this.post(`/${ONT}/objects/${type}/aggregate`, body); }
  compose(body)         { return this.post(`/${ONT}/object-sets/compose`, body); }
  searchAround(body)    { return this.post(`/${ONT}/search-around`, body); }

  /* 函数与动作 */
  execFn(code, params)    { return this.post(`/${ONT}/functions/${code}/execute`, { params }); }
  execAction(code, params){ return this.post(`/${ONT}/actions/${code}/execute`, { params }); }

  /* 应用层 */
  clock()          { return this.get(`/${ONT}/sim/clock`); }
  setClock(now)    { return this.post(`/${ONT}/sim/clock`, { now }); }
  audit(q)         { return this.get(`/${ONT}/audit/runs`, q); }
  // 本体执行链路：该小区跑过的业务流程，按本体要素摊开（步骤／函数／约束／规则／对象／关系／关键数值）
  // 方法名不叫 trace：实例上的 this.trace 存的是最近一次后端 traceId（同名会互相遮蔽）
  cellTrace(cell)  { return this.get(`/${ONT}/trace/cell`, { cell }); }
  // 自主决策链：一次调用把该小区从「发现与判定」推进到「闭环与案例」，
  // 能走到哪一步走到哪一步（走不动的地方就是本体约束挡住的地方）。
  // 返回：每步的状态／执行的动作／产出的工单·方案·派单·效果·案例／止步原因／时钟推进记录。
  // opt.until：只执行到第几步（1～7），返回 outcome=partial 与 nextStep——界面据此一步一显。
  runChain(cellKey, opt = {}) {
    const body = { cellKey };
    if (opt.until) body.until = opt.until;
    if (opt.delegate === false) body.delegate = false;
    return this.post(`/${ONT}/chain/run`, body);
  }
  // 问答：语义理解与措辞用哪种引擎由后端配置决定（config/llm.config.json 的 semantic_engine），
  // 前端不传 mode、不展示引擎差异；事实始终来自本体函数。
  // cellKey＝当前小区上下文（问句里的“它／这个小区”指向它）；readOnly＝只读问答，不代为执行写动作。
  ask(question, opt = {}) {
    const body = { question };
    if (opt.ticketNo) body.ticketNo = opt.ticketNo;
    if (opt.cellKey) body.cellKey = opt.cellKey;
    if (opt.mode) body.mode = opt.mode;
    if (opt.history) body.history = opt.history;
    if (opt.readOnly) body.readOnly = true;
    return this.post(`/${ONT}/qa/ask`, body);
  }
  // 流式问答（SSE）：同一个问句、同一套规则引擎，答案按 meta → refs → delta… → done 逐帧送达。
  // onEvent 每收到一帧回调一次（可 await，用于节流重绘）。
  async askStream(question, opt = {}, onEvent) {
    const body = { question };
    if (opt.ticketNo) body.ticketNo = opt.ticketNo;
    if (opt.cellKey) body.cellKey = opt.cellKey;
    if (opt.mode) body.mode = opt.mode;
    if (opt.history) body.history = opt.history;
    if (opt.readOnly) body.readOnly = true;
    const res = await fetch(`${BASE}/${ONT}/qa/ask/stream`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let j = {};
      try { j = await res.json(); } catch { /* 非 JSON 响应 */ }
      const e = new Error(j.message || j.errorCode || `HTTP ${res.status}`);
      e.errorCode = j.errorCode || "UNKNOWN"; e.status = res.status; e.traceId = j.traceId;
      throw e;
    }
    this.trace = res.headers.get("x-trace-id") || null;
    if (!res.body) return;
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = parseSSE(raw);
        if (ev && onEvent) await onEvent(ev);
      }
    }
  }
  antennaState(id, q) { return this.get(`/${ONT}/facts/antenna-state/${encodeURIComponent(id)}`, q); }
  alarms(cell)     { return this.get(`/${ONT}/facts/alarms`, { cell }); }
  // 现场回填记录（来源事实）：按 receivedAt 到达；未到达的在 pending 里，不冒充已回报
  fieldExecs(cell, q) { return this.get(`/${ONT}/facts/field-executions`, { ...(q || {}), cell }); }
  // 现场维护人员上报实测值（人工接入）：只补来源事实，不写本体对象；
  // 身份按 A_06 允许的角色给（现场维护人员／地市优化工程师），回填本身仍由 A_06 校验后写入。
  reportFieldExecution(body, role = "现场维护人员") {
    const old = this.role; this.role = role;
    return this.post(`/${ONT}/facts/field-executions`, body).finally(() => { this.role = old; });
  }
  ingestMr(rows)   { return this.post(`/${ONT}/ingest/cell-mr`, { rows }); }
}

/* 演示小区：决策链的人工接入示例。它的 MR 故事固定在 2026-09-04～09-28、起点判断时点
   2026-09-11 09:00——别的小区跑完后判断时点会推进，发现窗口就落到故事之外（第一步判“未达到”），
   所以它有一个“从 09-11 重演”的入口（重建运行时，不是把时钟偷偷拨回去）。 */
export const DEMO_CELL = "LTE:156574916";
export const DEMO_CELL_NAME = "陈家镇北NF02H_196";

/* ── 全局状态 ───────────────────────────────────────────────────────────── */
export const state = {
  osdk: new Osdk(),
  view: "board",                 // 当前主区视图：board｜s1～s7｜cockpit｜graph｜case
  role: "地市优化工程师",
  analysisMode: "independent",    // 独立分析从种子数据开始；连续分析保留本轮的案例与状态
  presentationMode: "fast",      // 快速查看真实结果；可选原来的逐步演示
  selectionToken: 0,
  loadingCell: false,
  summaryAt: 0,
  clock: null,                   // 服务端当前时钟（判断时点）
  def: null,                     // GET /definition 的完整本体
  meta: { objectTypes: [], functions: [], actions: [], errorCodes: [], ontology: null },
  params: {},                    // SPEC 参数（容差、轮次门限等）
  cells: [],                     // OT_CELL 清单（本体全量）
  board: {},                     // 小区基础属性：cellKey → {siteType, areaName, antennaId, elecTilt, ...}
  filters: { rat: "", scene: "", site: "", q: "" },
  cellKey: null,                 // 当前小区（流程起点）
  ctx: null,                     // 当前小区的聚合上下文（小区／站点／天线／区域／工单／方案／效果）
  chain: null,                   // 自主决策链的执行结果（后端 /chain/run 返回：逐步状态、产物、止步原因）
  chainBusy: false,              // 决策链执行中
  chainRun: false,               // 决策链按步执行的循环正在跑（防重入）
  chainToken: 0,                 // 按步执行的身份凭据：换小区后旧循环自动退出，不覆盖新界面
  chainReveal: 0,                // 决策链已显示到第几步（按步执行时逐步推进）
  chainPulse: 0,                 // 正在执行第几步（0＝没有进行中的步）
  chainStart: null,              // 本次按步执行的起始判断时点（后续每步的 from 都用它）
  chainSkip: false,              // 本次是否直接跑到结果（跳过逐步动画）
  chainTrace: [],                // 执行现场的调用记录（主视图只显示最后一条；完整过程在步骤弹窗里）
  stepTraces: {},                // 每步那次真正执行时记录的全量推理过程（弹窗回看用，键＝步号）
  modal: null,                   // 步骤详情弹窗：null＝关闭，1～7＝打开该步的推理过程与结果
  chainStale: 0,                 // 手动动作推进了流程后，待静默同步到第几步（0＝无需同步）
  chainTarget: 0,                // 下一次执行链只跑到第几步（0＝七步）
  chainFast: false,              // 下一次执行链静默跑（不放动画、不逐条播）
  overrides: {},                 // 用户改过的字段（键→文本）；未改的字段用界面推导出来的值
  diag: {},                      // 各次函数/动作的返回值缓存（供检查器下钻）
  chat: [],
  inspector: null,               // 当前查看的本体要素 {kind,id}
  trace: null,                   // 当前小区的本体执行链路（GET /trace/cell）
  busy: false,
  lastError: null,
  counts: {},
  auditRuns: []
};

export const ROLES = ["优化本体", "地市优化工程师", "优化主管", "现场维护人员", "优化专家", "知识维护人"];

/* ── 格式化 ─────────────────────────────────────────────────────────────── */
export const esc = s => String(s === undefined || s === null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const pct = (v, d = 2) => v === null || v === undefined ? "—" : (v * 100).toFixed(d) + "%";
export const n2 = v => v === null || v === undefined ? "—" : Number(v).toFixed(2);
export const n1 = v => v === null || v === undefined ? "—" : Number(v).toFixed(1);
export const d2 = v => v === null || v === undefined ? "—" : Number(v).toFixed(2);
export const clockTxt = t => !t ? "—" : String(t).replace("T", " ").slice(0, 19);
export const dayTxt = t => !t ? "—" : String(t).slice(0, 10);

/** 判定三态 → 样式类（命中／未命中／未知与其它语义） */
export function verdictClass(v) {
  const s = String(v || "");
  if (["是", "达到派单条件", "命中", "通过", "已确认", "持续有效", "改善", "成功", "排除", "已实施", "已关闭", "已派单"].includes(s)) return "v-hit";
  if (["否", "不命中", "未达到派单条件", "不通过", "未改善", "未达标", "劣化", "失败", "未批准"].includes(s)) return "v-bad";
  if (["未知", "证据不足", "未评估", "待评估", "部分重合", "冲突", "空", "无适用规则", "不适用"].includes(s)) return "v-unk";
  if (["调减", "改善未解决", "已排除", "未知（部分）"].includes(s)) return "v-mid";
  return "v-ok";
}

/** 本体要素类型 → 徽章样式与中文名 */
export const KIND = {
  OT: { cls: "ot",  label: "对象类型" }, RT: { cls: "rt", label: "关系类型" },
  F:  { cls: "f",   label: "函数" },     A: { cls: "a",  label: "动作" },
  INV:{ cls: "inv", label: "约束" },     RULE:{ cls: "rule", label: "规则" },
  TH: { cls: "th",  label: "测试假设" }
};
export const kindOf = id => {
  const m = String(id || "").match(/^(OT_[A-Z_]+|RT_\d+|F_\d+|A_\d+|INV_\d+|RULE_[A-Z]\d+|TH\d+)/);
  return m ? m[1].match(/^(OT|RT|F|A|INV|RULE|TH)/)[1] : null;
};
export const badge = id => {
  const k = kindOf(id); if (!k) return "";
  return `<span class="chip ${KIND[k].cls} static" data-el="${esc(id)}">${esc(id)}</span>`;
};

/* ── 便捷取值 ───────────────────────────────────────────────────────────── */
export const lastDiag = (t, kind) => [...(t?.diagnostics || [])].reverse().find(d => d.kind === kind);

/** 当前角色能否执行某动作（依据本体动作表的“允许角色”，来自 GET /actions） */
export function canAct(code) {
  const def = (state.meta.actions || []).find(a => a.code === code);
  return def ? (def.roles || []).includes(state.role) : false;
}
/** 不能执行时的说明：允许哪些角色 */
export function actRoles(code) {
  const def = (state.meta.actions || []).find(a => a.code === code);
  return def ? (def.roles || []).join(" / ") : "";
}
/** 动作按钮：按当前角色置灰并给出原因（前端不先试后错） */
export function actBtn(actKey, actionCode, label, cls = "", enabled = true, whyText = "") {
  const def = (state.meta.actions || []).find(a => a.code === actionCode);
  const roles = def ? (def.roles || []) : [];
  const roleOk = roles.includes(state.role), ok = roleOk && enabled;
  const why = !roleOk ? `当前角色「${state.role}」无权执行 ${actionCode}（允许：${roles.join(" / ")}）`
    : !enabled ? (whyText || "当前状态不满足该动作的前置条件") : "";
  // 只有"角色不够"才补一句角色提示；状态不满足的按钮靠悬停说明（动作编号已在按钮上，不重复）
  const hint = roleOk ? "" : `<span class="tiny dim" style="margin-left:4px">需 ${esc(roles.join(" / "))}</span>`;
  // 状态满足、只是角色不够时，给一个"换个角色执行"的按钮：
  // 流程不该卡在"先手动切角色再点回来"，一次点击就换身份继续走。
  const swap = (!roleOk && enabled && roles.length)
    ? `<button class="btn ghost tiny" data-act="act-as" data-role="${esc(roles[0])}" data-target="${esc(actKey)}"
         title="以「${esc(roles[0])}」身份执行这一步（本体里该动作允许的角色之一）">以 ${esc(roles[0])} 执行</button>` : "";
  return `<button class="btn ${cls}" data-act="${actKey}" ${ok ? "" : "disabled"}${why ? ` title="${esc(why)}"` : ""}>${esc(label)}</button>` + hint + swap;
}
export const plansOf = t => (state.def?.actions ? [] : []);
export function toast(text, kind = "") {
  let w = document.getElementById("toastWrap");
  if (!w) { w = document.createElement("div"); w.id = "toastWrap"; w.className = "toast-wrap"; document.body.appendChild(w); }
  const d = document.createElement("div");
  d.className = "toast " + kind; d.innerHTML = text;
  w.appendChild(d);
  setTimeout(() => { d.style.opacity = "0"; d.style.transition = ".4s"; setTimeout(() => d.remove(), 400); }, 4200);
}
/** 统一的错误呈现：错误码 + 文案 + traceId（前端按 errorCode 分支，不解析文案做逻辑） */
export function showError(e, ctx = "") {
  state.lastError = e;
  const code = e?.errorCode || "UNKNOWN";
  const hint = {
    UNAUTHENTICATED: "缺认证头：重新登录或切换角色",
    PERMISSION_DENIED: "当前角色无权执行该动作",
    ACTION_REQUIRED: "该对象只能经本体动作写入",
    REVIEW_REQUIRED: "须人工写明复核判断后才能继续",
    STALE_FACTS: "所依据的工参已变化，须退回草案重算",
    ROUND_IN_PROGRESS: "上一轮方案尚未结束，不能再生成新一轮",
    INV_01: "约束拒绝", INV_02: "约束拒绝", INV_03: "约束拒绝", INV_04: "约束拒绝",
    INV_05: "约束拒绝", INV_06: "约束拒绝", INV_07: "约束拒绝", INV_08: "约束拒绝",
    INV_09: "约束拒绝", INV_10: "约束拒绝", INV_11: "约束拒绝", INV_12: "约束拒绝",
    INV_13: "约束拒绝", INV_14: "约束拒绝", INV_15: "约束拒绝", INV_16: "约束拒绝", INV_17: "约束拒绝"
  }[code] || "";
  toast(`<b class="mono" style="color:var(--red)">${esc(code)}</b>${ctx ? " · " + esc(ctx) : ""}<br><span class="tiny dim">${esc(e?.message || "")}</span>${hint ? `<br><span class="tiny" style="color:var(--amber)">${esc(hint)}</span>` : ""}<br><span class="mono tiny" style="color:var(--ink-4)">trace ${esc(e?.traceId || "-")}</span>`, "bad");
}
