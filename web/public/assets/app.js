/* ============================================================================
   app.js —— 外壳与编排
   职责：引导（读元数据）→ 大屏装载 → 小区装载 → 视图路由 → 动作编排 → 重绘。
   任何业务判定都不在这里产生；这里只发请求、读返回值、把它们摆到界面上。
   ========================================================================== */
import { state, Osdk, ONT, APP_ROOT, ROLES, esc, pct, n1, n2, clockTxt, dayTxt, badge, toast, showError, verdictClass, DEMO_CELL } from "./core.js";
import { mrChart, tiltDiagram, sectorMap, windowCompare, ontologyLineage, ontologyMap } from "./viz.js";
import * as V from "./views.js";
import * as B from "./board.js";
import * as F from "./cellflow.js";

const O = () => state.osdk;
const $ = s => document.querySelector(s);
const main = () => $("#main");
const idOf = s => String(s).split(":").slice(1).join(":");
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 按步执行决策链时每一步的展示节奏：2～5 秒（随机）。
   这段时间里，这一步真正调用到的本体函数／动作／约束／规则逐条出现，快慢看得见。 */
const CHAIN_STEP_MIN = 2000, CHAIN_STEP_MAX = 5000;
const chainStepBudget = () => CHAIN_STEP_MIN + Math.round(Math.random() * (CHAIN_STEP_MAX - CHAIN_STEP_MIN));

/* ── 引导与独立分析 ─────────────────────────────────────────────────── */
const summaryRequests = new WeakMap();
function applyBootstrap(data) {
  if (data.definition) { state.def = data.definition; state.params = state.def.params || {}; state.meta = data.meta; }
  state.clock = data.clock; O().asOf = data.clock;
  state.cells = data.cells; state.counts = data.counts; state.auditRuns = data.auditRuns; state.summaryAt = performance.now();
  const siteBy = Object.fromEntries(data.sites.map(site => [site.siteId, site]));
  const areaBy = Object.fromEntries(data.areas.map(area => [area.areaId, area]));
  const board = {}, put = (key, field, value) => { (board[key] = board[key] || {})[field] = value; };
  for (const link of data.relations.rt01) {
    const site = siteBy[idOf(link.to)];
    if (site) { const key = idOf(link.from); put(key, 'siteType', site.siteType); put(key, 'siteId', site.siteId); put(key, 'lifecycle', site.lifecycle); }
  }
  for (const link of data.relations.rt02) put(idOf(link.from), 'antennaId', idOf(link.to));
  for (const link of data.relations.rt04) {
    const area = areaBy[idOf(link.to)];
    if (area) { put(idOf(link.from), 'areaName', area.areaName); put(idOf(link.from), 'areaScene', area.areaScene); }
  }
  state.board = board;
}
async function beginAnalysis(token, cellKey) {
  const previous = O(), next = new Osdk(); next.role = state.role; next.user = previous.user; next.sys = previous.sys;
  const created = await next.newAnalysis(!state.def, cellKey); next.analysisId = created.id;
  if (token !== state.selectionToken) { await next.release(); return null; }
  state.osdk = next; state.summaryAt = 0;
  previous.release().catch(() => {});
  return created;
}
async function boot(initialData) {
  state.chainToken++;
  const token = ++state.selectionToken;
  const created = !O().analysisId ? await beginAnalysis(token) : null;
  if (token !== state.selectionToken) return;
  const data = created ? created.bootstrap : initialData || await O().bootstrap(!state.def);
  if (token !== state.selectionToken) return;
  applyBootstrap(data);
  state.cellKey = null; state.ctx = null; state.diag = {}; state.diagKey = null; state.chat = [];
  state.cases = { items: [], totalCount: 0 };
  state.trace = null; state.planScope = []; state.sectorItems = []; state.effectNo = null; state.overrides = {};
  state.chain = null; state.chainTrace = []; state.stepTraces = {}; state.chainBusy = false; state.chainRun = false; state.loadingCell = false;
  await renderAll();
  toast(`本体已载入 · ${state.cells.length} 个小区 · ${esc(clockTxt(state.clock))}`, 'ok');
}
async function loadBoard() { applyBootstrap(await O().bootstrap(false)); }
function applyContext(data) {
  state.ctx = data.ctx; state.cellKey = data.ctx.cellKey; state.trace = data.trace; state.diag = data.diag; state.diagKey = data.diagKey;
  state.cases = { items: data.ctx.cases || [], totalCount: (data.ctx.cases || []).length };
  state.planScope = data.planScope; state.sectorItems = data.sectorItems; state.clock = data.clock; O().asOf = data.clock;
}
async function loadCellCtx(key, token = state.selectionToken) {
  const client = O(), data = await client.cellContext(key, state.effectNo);
  if (token !== state.selectionToken || client !== O()) return false;
  applyContext(data); return true;
}
async function refreshSummary(force = false) {
  const client = O();
  if (!client.analysisId || state.loadingCell || (!force && performance.now() - state.summaryAt < 1500)) return;
  if (summaryRequests.has(client)) {
    const pending = summaryRequests.get(client); if (force) pending.repeat = true; return pending;
  }
  const request = client.summary().then(data => {
    if (client !== O()) return;
    state.counts = data.counts; state.auditRuns = data.auditRuns; state.summaryAt = performance.now();
    if ($('#status')) $('#status').innerHTML = statusHtml();
  }).catch(error => { if (client === O()) console.warn('状态栏更新失败', error.message); }).finally(() => {
    summaryRequests.delete(client); if (request.repeat && client === O()) void refreshSummary(true);
  });
  summaryRequests.set(client, request); return request;
}

/* ── 渲染 ─────────────────────────────────────────────────────────────── */
const GLOBAL_VIEWS = [
  { id: "cockpit", n: "本体驾驶舱", en: "COCKPIT" },
  { id: "graph", n: "本体图谱", en: "GRAPH" },
  { id: "case", n: "案例库", en: "CASE" }
];
const MARK = { done: "●", active: "◐", idle: "○", blocked: "◆" };
const STEP_TEXT = { done: "已完成", blocked: "受阻", skipped: "未执行", pending: "未开始" };

/* 决策链在跑或已跑过时，左轨标记取链的步骤状态（与首部状态条同一份事实）；
   链没跑过时仍按当前对象状态推导。 */
function chainMark(n) {
  const rep = state.chain && state.chain.cellKey === state.cellKey ? state.chain : null;
  const busy = !!state.chainBusy;
  if (!rep && !busy) return null;
  const reveal = Math.min(Number(state.chainReveal) || 0, 7);
  const pulse = Number(state.chainPulse) || 0;
  // 正在执行的那一步（含"上一步结果已到、下一步请求还没回"的空隙）
  const cur = !busy ? 0
    : !rep ? Math.max(pulse, 1)
      : rep.outcome === "partial" ? Math.min(Math.max(pulse, reveal + 1), 7) : 0;
  if (cur && n === cur) return { mark: "active", text: "执行中" };
  if (n > reveal) {
    const st = (rep?.steps || []).find(s => s.n === n);
    return { mark: "idle", text: rep?.outcome === "stopped" && st?.status === "skipped" ? "未执行" : "未开始" };
  }
  const st = (rep?.steps || []).find(s => s.n === n);
  if (!st) return null;
  const mark = { done: "done", blocked: "blocked", skipped: "idle", pending: "idle" }[st.status] || "idle";
  return { mark, text: st.note || st.status };
}

function railHtml() {
  const ctx = state.ctx;
  let g = `<div class="rail-sep">小区</div>
    <div class="nav ${state.view === "board" ? "on" : ""}" data-view="board">
      <span class="idx">00</span><span class="nm">小区大屏</span><span class="navbadge">${B.scopeCells().length}</span></div>`;
  // 当前小区只留一个"决策链执行"入口：七步不在这里平铺，点开小区后看决策链，步骤在链里点开看
  g += `<div class="rail-sep">当前小区</div>`;
  if (!ctx) {
    g += `<div class="rail-empty">先在小区大屏点一个小区，<br>这里显示它的决策链与执行结果图谱</div>`;
  } else {
    g += `<div class="rail-cell ${state.view === "chain" ? "on" : ""}" data-view="chain">
      <div class="rc-nm">${esc(ctx.cell?.cellName || "")}</div>
      <div class="rc-key mono">${esc(ctx.cellKey)}</div></div>`;
    const done = (state.chain?.steps || []).filter(s => s.status === "done").length;
    const mk = state.chainBusy ? "active" : done === 7 ? "done" : state.chain?.outcome === "stopped" ? "blocked" : "idle";
    g += `<div class="nav ${state.view === "chain" ? "on" : ""}" data-view="chain" title="决策链执行状态与结果图谱">
      <span class="idx">01</span><span class="nm">决策链执行</span>
      <span class="navmark ${mk}">${MARK[mk]}</span></div>`;
  }
  g += `<div class="rail-sep">本体</div>`;
  for (const v of GLOBAL_VIEWS) {
    g += `<div class="nav ${state.view === v.id ? "on" : ""}" data-view="${v.id}">
      <span class="idx">${v.en[0]}</span><span class="nm">${esc(v.n)}</span></div>`;
  }
  return `<div class="rail-hd"><span class="rail-title">导航</span><span class="eyebrow">CELL-FIRST</span></div>
    <div class="rail-group">${g}</div>`;
}

function crumbHtml() {
  const c = state.ctx?.cell;
  return `<span class="crumb-item" data-view="board">小区大屏</span>` +
    (c ? `<span class="crumb-sep">/</span><span class="crumb-item on">${esc(c.cellName || state.cellKey)}</span>` : "");
}

function mainHtml() {
  if (state.loadingCell) return `<div class="loading">正在准备本次分析 …</div>`;
  if (state.view === "board") return B.renderBoard();
  if (state.view === "cockpit") return V.renderCockpit();
  if (state.view === "case") return V.renderCase();
  if (state.view === "graph") return V.renderGraph();
  if (state.view === "chain" && state.ctx) return F.renderChain(state.ctx);
  return B.renderBoard();
}

/* 步骤详情弹窗：点决策链上的步骤卡片才出现，只展示那一步的推理过程与结果 */
function renderModal() {
  const host = $("#modal"); if (!host) return;
  const n = Number(state.modal) || 0;
  if (!n || !state.ctx) { host.hidden = true; host.innerHTML = ""; return; }
  const st = F.STEPS.find(s => s.n === n) || F.STEPS[0];
  const ss = chainMark(n) || F.stepState(state.ctx, n);
  const cst = (state.chain?.steps || []).find(s => s.n === n);
  const runningNow = !!state.chainBusy && Number(state.chainPulse) === n;
  const liveRows = (state.chainTrace || []).filter(e => e.step === n);
  const rows = runningNow ? liveRows.length : (state.stepTraces?.[n]?.length ?? (cst?.trace || []).length);
  host.hidden = false;
  host.innerHTML = `
    <div class="modal-mask" data-act="close-step"></div>
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(st.name)}">
      <div class="modal-hd">
        <span class="eyebrow">STEP ${String(st.n).padStart(2, "0")}/07 · ${esc(st.en)}</span>
        <h2>${esc(st.name)}</h2>
        <span class="stepmark ${ss.mark}">${esc(ss.text)}</span>
        <span class="spacer"></span>
        <span class="tiny dim">${runningNow ? "执行中" : cst ? `状态 ${esc(STEP_TEXT[cst.status] || cst.status)}` : "未执行"}</span>
        <button class="btn ghost tiny" data-act="close-step">关闭 ✕</button>
      </div>
      <div class="modal-bd">
        <div class="cb-trace">
          <div class="ct-hd"><span class="k">本体推理过程</span><span class="eyebrow">ONTOLOGY CALLS</span>
            <span class="spacer"></span><span class="tiny dim">按调用顺序 · ${rows} 条</span></div>
          ${F.stepTrace(n)}
        </div>
        <div class="modal-step">${F.stepBody(n)}</div>
      </div>
    </div>`;
}

function inspHtml() {
  const id = state.inspector;
  if (!id) return `<div class="empty">点击任意本体要素徽章<br>查看它在本体的定义、校验点与依据</div>`;
  const d = state.def || {};
  const find = (arr, k) => (arr || []).find(x => x.id === k);
  let item = null, kind = "";
  const m = String(id).match(/^(OT_[A-Z_]+|RT_\d+|F_\d+|A_\d+|INV_\d+|RULE_[A-Z]\d+|TH\d+)/);
  const key = m ? m[1] : id;
  if (key.startsWith("OT_")) { item = find(d.objectTypes, key); kind = "对象类型"; }
  else if (key.startsWith("RT_")) { item = find(d.relationTypes, key); kind = "关系类型"; }
  else if (key.startsWith("F_")) { item = find(d.functions, key); kind = "函数"; }
  else if (key.startsWith("A_")) { item = find(d.actions, key); kind = "动作"; }
  else if (key.startsWith("INV_")) { item = find(d.constraints, key); kind = "约束"; }
  else if (key.startsWith("RULE_")) { item = find(d.rules, key); kind = "规则"; }
  else if (key.startsWith("TH")) { item = find(d.assumptions, key); kind = "测试假设"; }
  if (!item) return `<div class="empty">本体中未定义 ${esc(id)}</div>`;
  const rows = [];
  if (item.definition) rows.push(["定义", esc(item.definition)]);
  if (item.identity) rows.push(["身份", esc(item.identity)]);
  if (item.question) rows.push(["回答的问题", esc(item.question)]);
  if (item.input) rows.push(["输入契约", esc(item.input)]);
  if (item.method) rows.push(["计算方法", esc(item.method)]);
  if (item.text) rows.push(["条文", esc(item.text)]);
  if (item.purpose) rows.push(["用途", esc(item.purpose)]);
  if (item.changes) rows.push(["写入", esc(item.changes)]);
  if (item.failure) rows.push(["失败约定", esc(item.failure)]);
  if (item.roles) rows.push(["允许角色", esc(item.roles.join(" / "))]);
  if (item.checkpoints) rows.push(["校验点", item.checkpoints.map(c => badge(c)).join(" ")]);
  if (item.from) rows.push(["起点", esc(item.from.join(" / "))]);
  if (item.to) rows.push(["终点", esc(item.to.join(" / "))]);
  if (item.cardinality) rows.push(["基数", esc(item.cardinality)]);
  if (item.version) rows.push(["版本", "v" + esc(item.version)]);
  if (item.rules) rows.push(["关联规则", esc(item.rules.join(" "))]);
  if (item.owner) rows.push(["确认责任", esc(item.owner)]);
  if (item.attributes?.length) rows.push(["属性", item.attributes.map(a => `<span class="chip static">${esc(a.name)}</span>`).join(" ")]);
  if (item.definedOnly) rows.push(["状态", `<span class="verdict v-unk">只定义不运行</span>`]);
  return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      ${badge(key)}<span class="mono" style="font-size:12px;color:var(--ink-1)">${esc(item.name || item.code || item.label || "")}</span>
      <span class="eyebrow">${esc(kind)}</span></div>
    <dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>
    ${item.parameters ? `<div class="hr"></div><div class="eyebrow">入参</div><dl class="kv">${item.parameters.map(p =>
      `<dt>${esc(p.name)}</dt><dd>${esc(p.type)}${p.required ? " <span style='color:var(--amber)'>必填</span>" : " <span class='dim'>可选</span>"}<br><span class='tiny dim'>${esc(p.description || "")}</span></dd>`).join("")}</dl>` : ""}`;
}

/* 回答的落地状态：数值是否都能追溯到本次引用的来源（不展示"这一段文字由谁生成"） */
function groundedTag(m) {
  if (!m.grounded) return `<span>落地 —</span>`;
  return m.grounded.ok === false ? `<span>落地 ✗</span>` : `<span>落地 ✓</span>`;
}

// 回答依据的本体资源：按要素类型分色，点了进右栏检查器
const refKind = r => r.startsWith("INV") ? "inv" : r.startsWith("RULE") ? "rule" : r.startsWith("F_") ? "f"
  : r.startsWith("A_") ? "a" : r.startsWith("RT_") ? "rt" : r.startsWith("TH") ? "th" : "ot";
const refChips = refs => (refs || []).map(r => `<span class="chip static ${refKind(r)}" data-el="${esc(r)}">${esc(r)}</span>`).join("");

// 问答助手的引子：一句话说明"我是谁、能问什么、回答依据什么"
const CHAT_INTRO = "我是当前小区的问答助手：可以问我这个小区有哪些属性、它已经走完的决策全流程是什么、某个结论依据本体里的哪些对象与函数——回答只引用本体里的事实，每个数值都能追溯到出处。";

function chatHtml() {
  const cell = state.ctx?.cell;
  // 推荐提问：点了填进输入框（回车或点发送即可提问）
  const nm = cell ? (cell.cellName || "") : "";
  const quick = cell
    ? [`${nm} 的基本信息`, `${nm} 已经完成的决策全流程`, `${nm} 的根因是哪一类问题`, `${nm} 的工单状态怎么样`, `${nm} 的效果怎么样`, "哪些小区弱覆盖"]
    : ["哪些小区弱覆盖", "派单规则是什么", "工单有哪些状态", "F_08 是什么", "INV_16 约束什么"];
  const ctxRow = `<div class="chat-ctx">
      <span class="eyebrow">当前小区</span>
      ${cell ? `<span class="cx-nm">${esc(cell.cellName || "")}</span><span class="cx-key mono">${esc(state.cellKey)}</span>`
        : `<span class="cx-none">未选小区（全局问答）</span>`}
      <span class="cx-note">只读问答：不代为执行写动作</span>
    </div>`;
  return `${ctxRow}
    <div class="chat-intro">${esc(CHAT_INTRO)}</div>
    <div class="chat-log" id="chatLog">${chatMessagesHtml(cell)}</div>
    <div class="chat-quick"><span class="eyebrow">推荐提问</span>${quick.map(q => `<span class="chip" data-quick="${esc(q)}">${esc(q)}</span>`).join("")}</div>
    <div class="chat-in">
      <textarea id="chatInput" placeholder="${cell ? `例如：${cell.cellName || ""} 为什么命中下倾角过小？` : "例如：哪些小区达到弱覆盖派单条件？"}"></textarea>
      <button class="btn primary" data-act="ask">发送</button>
    </div>`;
}

/** 阶段提示：第一字出来之前让用户知道卡在哪一步，而不是干等 */
const STAGE_LABEL = {
  understanding: "正在理解问题…", facts: "正在读取本体事实…",
  naturalizing: "正在组织语言…", supplement: "正在补充通用参考…", answer: "正在生成回答…"
};

/** 对话区（流式时只重画这一块，输入框与推荐提问不受影响） */
function chatMessagesHtml(cell = state.ctx?.cell) {
  const msgs = state.chat.map(m => m.role === "me"
    ? `<div class="msg me">${esc(m.text)}</div>`
    : `<div class="msg">${esc(m.text)}${m.streaming ? `<span class="caret"></span>` : ""}
        ${m.streaming && m.stageLabel ? `<div class="tiny dim">${esc(m.stageLabel)}</div>` : ""}
        ${m.supplement?.ok ? `<div class="msup"><span class="eyebrow">${esc(m.supplement.kindLabel || "本体缺口")}·通用参考</span><div class="msup-t">${esc(m.supplement.text)}</div><span class="tiny dim">非本体结论 · 不写入任何记录 · 需业务或人工确认</span></div>` : ""}
        ${m.refs?.length ? `<div class="mrefs"><span class="eyebrow">依据本体资源</span>${refChips(m.refs)}</div>` : ""}
        ${m.pending?.length ? `<div class="mfoot"><span style="color:var(--amber)">待人工：${esc(m.pending.join(" "))}</span></div>` : ""}
        ${m.writes?.length ? `<div class="mfoot"><span style="color:var(--green)">本次写入 ${m.writes.length} 条</span></div>` : ""}
        <div class="mfoot">${groundedTag(m)}${m.intent ? `<span>意图 ${esc(m.intent)}</span>` : ""}<span>${esc(m.ms || "")}ms</span></div>
      </div>`).join("");
  return msgs || `<div class="empty">${cell ? "问题里的“它／这个小区”指向当前小区；也可以直接点下面的推荐提问。" : "先在小区大屏选一个小区，问答会围绕它展开；也可以直接点下面的推荐提问。"}</div>`;
}

/** 只重画对话区（流式输出时用，不动输入框、不重画整页） */
function renderChat() {
  const log = $("#chatLog"); if (!log) return;
  log.innerHTML = chatMessagesHtml();
  log.scrollTop = log.scrollHeight;
}

function statusHtml() {
  const c = state.counts || {};
  const last = (state.auditRuns || []).slice(-3).reverse().map(r =>
    `<span class="sb"><span class="lamp ${r.outcome === "ok" ? "" : "warn"}"></span>${esc(r.actionId)} · ${esc(r.outcome)}</span>`).join("");
  return `<span class="sb"><span class="lamp"></span>本体服务 <b>${esc(state.meta.ontology?.code || "")}</b></span>
    <span class="sb">小区 <b>${c.OT_CELL ?? state.cells.length}</b></span>
    <span class="sb">工单 <b>${c.OT_TICKET ?? 0}</b></span>
    <span class="sb">方案 <b>${c.OT_PLAN ?? 0}</b></span>
    <span class="sb">效果 <b>${c.OT_EFFECT ?? 0}</b></span>
    <span class="sb">案例 <b>${c.OT_CASE ?? 0}</b></span>
    <span class="sb">MR <b>${c.OT_CELL_MR ?? 0}</b></span>
    <span class="spacer"></span>${last}
    <span class="sb">trace <b>${esc(O().trace || "-")}</b></span>`;
}

async function renderAll() {
  // 七步不再作为主视图：动作把 state.view 设成 sN 时，回到决策链并打开那一步的弹窗
  const sm = /^s([1-7])$/.exec(state.view);
  if (sm) {
    state.view = "chain";
    if (!state.chainBusy) { state.modal = Number(sm[1]); state.chainStale = Number(sm[1]) - 1; }
  }
  const draft = $("#chatInput")?.value || "";
  $("#rail").innerHTML = railHtml();
  main().innerHTML = mainHtml();
  $("#inspBody").innerHTML = inspHtml();
  $("#chatBox").innerHTML = chatHtml();
  $("#status").innerHTML = statusHtml();
  const cr = $("#crumb"); if (cr) cr.innerHTML = crumbHtml();
  const ci = $("#chatInput"); if (ci && draft) ci.value = draft;
  const o = state.meta.ontology || {};
  const t1 = $("#telOnt"), t2 = $("#telSpec"), t3 = $("#clockInput");
  if (t1) t1.textContent = `${o.code || "—"} · ${o.objectTypeCount ?? 0}OT/${o.relationTypeCount ?? 0}RT/${o.functionCount ?? 0}F/${o.actionCount ?? 0}A`;
  if (t2) t2.textContent = (o.spec?.sha256 || "—").slice(0, 12);
  if (t3 && document.activeElement !== t3) t3.value = clockTxt(state.clock);
  renderModal();
  mountCharts();
  const log = $("#chatLog"); if (log) log.scrollTop = log.scrollHeight;
  void refreshSummary();
}

/* 只重画决策链状态条与左轨（按步执行时每步都调用；不动下方内容，避免整页闪） */
function paintChain() {
  const host = $("#chainHost");
  if (host && state.ctx) host.innerHTML = F.chainBar(state.ctx);
  const rail = $("#rail");
  if (rail) rail.innerHTML = railHtml();
  // 弹窗正开着、这一步还在跑：把新到的调用记录续进弹窗（滚到最新一条）
  if (state.modal && state.chainBusy) {
    renderModal();
    const log = document.querySelector(".modal-bd .ct-log-full");
    if (log) log.scrollTop = log.scrollHeight;
  }
}

/* 把一步的推理过程逐条摆出来，并把这一步的展示节奏补满 budget（2～5 秒）。
   条目本身是后端这次调用真实记录的，间隔只是展示节奏。 */
async function revealTrace(rep, n, t0, budget, fast) {
  // 这一步（真正执行的那次调用）的全量记录：弹窗回看用，后续续跑只读不覆盖
  const all = ((rep.steps || []).find(s => s.n === n) || {}).trace || [];
  state.stepTraces[n] = all.map(e => ({ ...e, step: n }));
  if (fast) {                          // 跳过展示：一次补齐，不逐条、不等节奏
    state.chainTrace.push(...state.stepTraces[n]);
    paintChain();
    return;
  }
  const token = state.chainToken, key = state.cellKey;
  const alive = () => state.chainToken === token && state.cellKey === key;
  const gap = Math.min(650, Math.max(240, Math.floor((budget - 500) / Math.max(all.length, 1))));
  for (const e of all) {
    if (!alive()) return;
    state.chainTrace.push({ ...e, step: n });
    paintChain();
    await sleep(gap);
  }
  const rest = budget - (performance.now() - t0);
  if (rest > 0) await sleep(rest);
}

function mountCharts() {
  const put = (sel, node) => { const h = $(sel); if (h && node) { h.innerHTML = ""; h.appendChild(node); } };
  const ctx = state.ctx;
  if (state.view === "board") return;   // 大屏只有基础属性，没有图表
  const d = ctx?.discover?.daily;
  if (d?.length) {
    const rule = (state.def?.dispatchRules || []).find(r => r.ruleId === ctx.discover.ruleId) || {};
    put("#mrChartHost", mrChart(d, rule, { w: 620, h: 190 }));
  }
  if (state.diag.F_08) put("#tiltHost", tiltDiagram(state.diag.F_08.result, state.afterTilt));
  if (ctx?.sectorItems?.length) put("#sectorHost", sectorMap(ctx.sectorItems, { w: 900, h: 380 }));
  if (ctx?.effect) {
    put("#winHost", windowCompare(ctx.effect.beforeRatio, ctx.effect.afterRatio,
      { w: 520, h: 150, note: `差值 ${n2((ctx.effect.beforeRatio ?? 0) - (ctx.effect.afterRatio ?? 0))}` }));
  }
  // 本体图谱画的是全量本体（类型与关系），与当前小区无关：直接取 GET /definition
  if (state.view === "graph" && state.def) put("#omapHost", ontologyMap(state.def, { anchor: state.meta.ontology?.anchor }));
  if (state.trace) put("#lineageHost", ontologyLineage(state.trace));
}

/* ── 动作编排 ─────────────────────────────────────────────────────────── */
const ACT = {
  // 点开小区＝自动触发决策链：从发现判定一路跑到闭环与案例，能走到哪步走到哪步
  async "open-cell"(el) {
    const key = el.dataset.cell, token = ++state.selectionToken;
    $('#toastWrap')?.replaceChildren();
    state.chainToken++;
    state.chainRun = false; state.chainBusy = false; state.chain = null;
    state.chainReveal = 0; state.chainPulse = 0; state.chainStart = null; state.chainTrace = []; state.stepTraces = {};
    state.overrides = {}; state.diag = {}; state.diagKey = null; state.effectNo = null;
    state.ctx = null; state.trace = null; state.chat = []; state.inspector = null;
    state.cases = { items: [], totalCount: 0 };
    state.cellKey = key; state.loadingCell = true; state.view = 'chain'; state.modal = null;
    await renderAll();
    try {
      const fresh = state.analysisMode === 'independent' || el.dataset.fresh === 'true';
      const created = fresh ? await beginAnalysis(token, key) : null;
      if (token !== state.selectionToken) return;
      if (created) { applyBootstrap(created.bootstrap); applyContext(created.context); }
      else if (!await loadCellCtx(key, token)) return;
      if (token !== state.selectionToken) return;
      state.loadingCell = false;
      await renderAll();
      await ACT['run-chain']();
    } catch (error) {
      if (token === state.selectionToken) { state.loadingCell = false; showError(error, '打开小区'); await renderAll(); }
    }
  },
  // 演示入口也创建自己的新分析，不重置其他小区或访问者。
  async "demo-start"(element) {
    await ACT['open-cell']({ dataset: { cell: element?.dataset?.key || DEMO_CELL, fresh: 'true' } });
  },
  // 执行（或重跑）决策链：按步调后端（until=1..7），一步一显示；走不通就停在那一步。
  // 每一步都是后端真跑（动作、约束、审计照旧），前端只是把结果一层层摆出来。
  async "run-chain"() {
    const key = state.cellKey, client = O(); if (!key) return;
    if (state.chainRun) { state.chainTarget = 0; state.chainFast = false; state.chainQuietUntil = 0; return; }
    // 手动动作改动了流程时静默刷新（不放动画、只同步到做完的那一步）；否则跑满七步
    const target = Math.min(7, Math.max(1, Number(state.chainTarget) || 7));
    const sync = !!state.chainFast;
    const quick = sync || state.presentationMode === "fast";
    // 人工接入后续跑：停点之前的步骤已经成立，静默重放（不占 2～5 秒、不逐条播），
    // 从停下的那一步开始照常展示——用户看到的“继续”是从第 5 步接上的。
    const quiet = Math.min(7, Math.max(0, Number(state.chainQuietUntil) || 0));
    state.chainTarget = 0; state.chainFast = false; state.chainQuietUntil = 0;
    const token = ++state.chainToken;   // 本次执行的凭据：换小区后旧循环自己退出，不覆盖新小区的界面
    state.chainRun = true; state.chainBusy = true; state.chainSkip = false;
    state.chain = null; state.chainReveal = 0; state.chainStart = null; state.chainPulse = 1;
    state.chainTrace = []; state.stepTraces = {};
    const stale = () => state.chainToken !== token || state.cellKey !== key;
    let rep = null;
    try {
      paintChain();                    // 先摆出"第 1 步执行中"
      for (const n of (quick ? [target] : Array.from({ length: target }, (_, i) => i + 1))) {
        if (stale()) return;
        const fast = quick || state.chainSkip || n <= quiet;  // 跳过动画：仍逐步真跑，只是不停顿、不逐条播
        const t0 = performance.now(), budget = fast ? 0 : chainStepBudget();
        state.chainPulse = quick ? 1 : n;
        paintChain();                  // 第 n 步执行中（上一步的结果留在条上）
        if (!fast) await sleep(240);   // 让"执行中"先露个面，再去调后端
        if (stale()) return;
        rep = await client.runChain(key, { until: n });
        if (stale()) return;           // 中途换了小区：这次的结果与本页无关，丢弃
        if (!state.chainStart) state.chainStart = rep.clock?.from || null;
        else if (rep.clock) rep.clock.from = state.chainStart;      // 分步调用的起点仍按本次第一次算
        state.chain = rep;
        state.chainReveal = rep.outcome === "completed" ? 7
          : rep.outcome === "stopped" ? (rep.stop?.step || n) : n;
        // chainPulse 保持到这一步的记录播完：弹窗打开时能跟着现场记录一条条长
        // 链可能推进了判断时点（等现场回报、凑效果后窗），时点以服务端为准
        const clock = quick ? { now: rep.clock.to } : await client.clock();
        if (stale()) return;
        state.clock = clock.now; O().asOf = clock.now;
        // 本步的推理过程逐条出现；这一步的节奏（2～5 秒）在这里补满
        if (quick) {
          for (const step of rep.steps || []) {
            const trace = (step.trace || []).map(event => ({ ...event, step: step.n }));
            state.stepTraces[step.n] = trace; state.chainTrace.push(...trace);
          }
        } else await revealTrace(rep, n, t0, budget, fast);
        if (stale()) return;
        await loadCellCtx(key);        // 这一步的产物要立刻出现在下方各步里
        if (stale()) return;
        paintChain();
        await renderAll();
        void refreshSummary(true);
        state.chainPulse = 0;
        if (rep.outcome !== "partial") break;
      }
      if (sync) toast(`决策链状态已按刚才的结果刷新（到第 ${target} 步）`, "");
      else toast(rep.outcome === "completed"
        ? `决策链已走通（${rep.counts.done}/7）：${esc(rep.cellName)} · 案例 <b class="mono">${esc(rep.artifacts.caseNo || "—")}</b>`
        : `决策链止步于第 <b>${rep.stop?.step ?? "—"}</b> 步「${esc(rep.stop?.name || "")}」：${esc(rep.stop?.reason || "")}`,
        rep.outcome === "completed" ? "ok" : "warn");
    } catch (e) {
      if (!stale()) { showError(e, "决策链"); await reloadCurrent(); await renderAll(); }
    } finally {
      if (state.chainToken === token) {
        state.chainBusy = false; state.chainPulse = 0; state.chainRun = false;
        paintChain();
      }
    }
  },
  // 打开某一步的弹窗：推理过程＋这一步的结果（动作按钮照常可用）
  async "open-step"(el) {
    const n = Number(el.dataset.step) || 0; if (!n) return;
    state.modal = n;
    renderModal();
  },
  async "close-step"() {
    state.modal = null;
    renderModal();
  },
  // 跳过逐步展示，直接跑到结果（链本身照旧按本体推进）
  async "chain-skip"() {
    state.chainSkip = true;
    toast("本次直接跑到结果", "");
  },
  // 静默同步：手动动作改了流程后，只把状态条与各步记录刷到"刚做完的那一步"，不再往下自动推进
  async "sync-chain"(t) {
    const to = Number(t?.dataset?.to || t) || 0; if (to < 1) return;
    state.chainTarget = to; state.chainFast = true;
    await ACT["run-chain"]();
  },
  // 人工接入①：现场维护人员回报实测值（来源事实），然后从停下的那一步继续执行决策链。
  // 只补"现场实际值"这一条事实；回填仍由 A_06 按 INV_07／INV_08 校验后写入，链不代填、不拿计划值冒充。
  async "report-field"() {
    const ctx = state.ctx; if (!ctx?.cellKey) return;
    const a = ctx.plan?.actions?.[0] || {};
    const value = Number($("#inFieldValue")?.value);
    if (!Number.isFinite(value)) { toast("实际值必填，且须是数值", "warn"); return; }
    const time = String($("#inFieldTime")?.value || state.clock || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(time)) { toast("实施时间格式应为 YYYY-MM-DDTHH:mm", "warn"); return; }
    const rec = await O().reportFieldExecution({
      cellKey: ctx.cellKey, antennaId: a.targetKey, param: a.param,
      fromValue: a.currentValue, toValue: value,
      executeTime: time, receivedAt: time,
      executor: $("#inFieldExecutor")?.value || "现场维护班组",
      receipt: $("#inFieldReceipt")?.value || "成功"
    }, "现场维护人员");
    await loadCellCtx(ctx.cellKey);
    toast(`现场回填记录已上报（${esc(rec.executor || "现场")}：${esc(a.param || "")} ${rec.fromValue ?? "—"}°→${rec.toValue}°），继续执行决策链`, "ok");
    state.chainStale = 0;
    state.chainQuietUntil = Math.max(0, Number(state.chain?.stop?.step || 1) - 1);
    state.chainTarget = 7; state.chainFast = false;
    await ACT["run-chain"]();
  },
  // 人工接入②：处理完（在现场回填记录、工参裁定等里补上人手里的那条事实）后继续执行。
  // 链是幂等的：停点之前的步骤静默重放，从停下的那一步接着往下走；没处理完会再次停在同一处。
  async "chain-resume"() {
    if (state.chainRun) return;
    state.chainStale = 0;
    state.chainQuietUntil = Math.max(0, Number(state.chain?.stop?.step || 1) - 1);
    state.chainTarget = 7; state.chainFast = false;
    await ACT["run-chain"]();
  },
  // 换角色执行：状态满足、只是当前角色无权时，一步到位（不用先切角色再点回来）
  async "act-as"(el) {
    const role = el.dataset.role, target = el.dataset.target;
    if (!role || !target) return;
    state.role = role; O().role = role;
    const sel = $("#roleSel"); if (sel) sel.value = role;
    await reloadCurrent();
    toast(`已切换为 <b>${esc(role)}</b>，继续执行这一步`, "ok");
    const fn = ACT[target];
    if (fn) await fn(el);
  },
  // 推进判断时点（界面给出可执行时点，一键跳过去）
  async "set-clock"(el) {
    const iso = el.dataset.iso;
    if (!iso) return;
    await O().setClock(iso);
    state.clock = iso; O().asOf = iso;
    const ci = $("#clockInput"); if (ci) ci.value = String(iso).replace("T", " ").slice(0, 16);
    await reloadCurrent(); await renderAll();
    toast(`判断时点推进到 <b class="mono">${esc(clockTxt(iso))}</b>（MR 数据按到达时刻陆续入库）`, "ok");
  },
  async "create-ticket"() {
    const ctx = state.ctx; if (!ctx) return;
    const r = await O().execAction("A_01", { cellKey: ctx.cellKey, refTime: state.clock });
    await loadBoard(); await loadCellCtx(ctx.cellKey);
    state.view = "s2";
    await renderAll();
    toast(r.result.deduped ? `已有未关闭工单 ${esc(r.result.ticketNo)}，已关联（INV_14）` : `A_01 建单 ${esc(r.result.ticketNo)}`, "ok");
  },
  async "run-f07"() {
    const ctx = state.ctx; if (!ctx?.ticket) return;
    const r = await O().execFn("F_07", { cellKey: ctx.cellKey, hitDates: ctx.ticket.discovery.hitDates, refTime: state.clock });
    state.diag.F_07 = r; await renderAll();
  },
  async "run-f08"() {
    const ctx = state.ctx; if (!ctx) return;
    const r = await O().execFn("F_08", { cellKey: ctx.cellKey, asOf: state.clock });
    state.diag.F_08 = r; await renderAll();
  },
  // 重新取回 F_07／F_08（时点或工参变了要重算时用）
  async "recalc-diag"() {
    const ctx = state.ctx; if (!ctx?.ticket) return;
    state.diagKey = null;
    await loadCellCtx(ctx.cellKey); await renderAll();
    toast("F_07／F_08 已按当前判断时点重新取回", "ok");
  },
  async "a02-rule"() {
    const ctx = state.ctx; if (!ctx?.ticket) return;
    const r = await O().execAction("A_02", { ticketNo: ctx.ticket.ticketNo, mode: "rule" });
    await loadCellCtx(ctx.cellKey); await renderAll();
    toast(`A_02 已写入根因（第 ${r.result.round} 轮）${r.result.f08 ? " · F_08 " + esc(r.result.f08) : ""}`, "ok");
  },
  // 定因确认一步到位：先写主因（A_02），再确认（A_03）；确认成功直接跳到下一步"优化方案"
  async "a02-a03"() {
    const ctx = state.ctx; if (!ctx?.ticket) return;
    const tn = ctx.ticket.ticketNo;
    const a2 = await O().execAction("A_02", { ticketNo: tn, mode: "rule" });
    await loadCellCtx(ctx.cellKey);          // 读回工单：主因与诊断记录已写入，裁决依据才拿得到
    if (!a2.result?.written) {
      const why = a2.result?.f07 === "排除" ? "F_07＝排除（假性弱覆盖）：本小区不写根因，应排除而不是确认"
        : (a2.result?.reason || `F_08＝${a2.result?.f08 || "未知"}：规则定因不成立，需人工定因或转专家`);
      await renderAll();
      toast(why, "warn");
      return;
    }
    const reason = F.pick("reviewReason", F.reviewReason(state.ctx));
    const a3 = await O().execAction("A_03", { ticketNo: tn, decision: "确认", reason });
    await loadCellCtx(ctx.cellKey);
    state.view = "s3";                    // 定因确认后到下一步：生成优化方案
    await renderAll();
    toast(`A_02 已写入主因（第 ${a2.result.round} 轮）· A_03 已确认 → 下一步：优化方案`, "ok");
  },
  async "toggle-review"() {
    const i = $("#inReviewReason"), box = $("#rbTx");
    if (!i) return;
    const show = i.style.display === "none";
    i.style.display = show ? "" : "none";
    if (box) box.style.display = show ? "none" : "";
    if (show) i.focus();
  },
  async "a03-confirm"() {
    const ctx = state.ctx; if (!ctx?.ticket) return;
    const reason = F.pick("reviewReason", F.reviewReason(ctx));
    const r = await O().execAction("A_03", { ticketNo: ctx.ticket.ticketNo, decision: "确认", reason });
    await loadCellCtx(ctx.cellKey); await renderAll();
    toast("A_03 已确认：" + esc(r.result.status), "ok");
  },
  async "a03-exclude"() {
    const ctx = state.ctx; if (!ctx?.ticket) return;
    const reason = F.pick("reviewReason", F.reviewReason(ctx));
    const r = await O().execAction("A_03", { ticketNo: ctx.ticket.ticketNo, decision: "排除", reason });
    await loadCellCtx(ctx.cellKey); await renderAll();
    toast("A_03 已排除：" + esc(r.result.status), "ok");
  },
  async "a04-mech"() { return ACT["a04"]("机械"); },
  async "a04-elec"() { return ACT["a04"]("电子"); },
  async "a04"(adj) {
    const ctx = state.ctx; if (!ctx?.ticket) return;
    const r = await O().execAction("A_04", { ticketNo: ctx.ticket.ticketNo, adjustType: adj });
    await loadCellCtx(ctx.cellKey);
    state.view = "s4";                    // 方案生成后到下一步：确认派单
    await renderAll();
    toast(`A_04 生成 ${esc(r.result.planNo)}：Δ=${n1(r.result.delta)}° · ${r.result.rounds} 轮 · 周边影响 ${esc(r.result.impact)} → 下一步：确认派单`, "ok");
  },
  async "a05-approve"() {
    const ctx = state.ctx; if (!ctx?.plan) return;
    // 审批链自动带出：多小区（≥2）或 VIP／VVIP 追加优化主管（与 A_05 的判定同口径）
    const approvals = F.approvalChain(ctx);
    const reason = F.pick("approvalReason", F.approvalReason(ctx));
    const r = await O().execAction("A_05", {
      planNo: ctx.plan.planNo, decision: "批准", executor: { name: "现场维护人员", role: "现场维护人员" },
      approvals, auto: false, reason
    });
    await loadCellCtx(ctx.cellKey);
    state.view = "s5";                    // 派单后到下一步：实施回填
    await renderAll();
    toast(`A_05 已派单 ${esc(r.result.dispatchNo)}${r.result.supervisor ? "（追加优化主管批准）" : ""} → 下一步：实施回填`, "ok");
  },
  async "a05-reject"() {
    const ctx = state.ctx; if (!ctx?.plan) return;
    const reason = F.pick("approvalReason", F.approvalReason(ctx));
    const r = await O().execAction("A_05", { planNo: ctx.plan.planNo, decision: "不批准", reason });
    await loadCellCtx(ctx.cellKey); await renderAll();
    toast("A_05 已否决：" + esc(r.result.status), "ok");
  },
  async "a06-fill"() {
    const ctx = state.ctx; if (!ctx?.plan) return;
    const p = ctx.plan, act = p.actions?.[0];
    const ep = F.execParams(ctx);
    // 表单里的值（已按现场回填记录填好）优先；字段不存在时用推导值
    const val = (id, key, derived) => { const el = $("#" + id); return el ? el.value.trim() : (derived ?? ""); };
    const receipt = val("inReceipt", "receipt", ep.receipt);
    const actual = val("inActual", "actualValue", ep.actualValue);
    const params = {
      planNo: p.planNo, dispatchNo: val("inDispatch", "dispatchNo", ep.dispatchNo),
      executeTime: val("inExecTime", "executeTime", ep.executeTime), receipt
    };
    if (receipt === "成功" && actual !== "") params.actualValues = [{ targetKey: act.targetKey, param: act.param, value: Number(actual) }];
    const r = await O().execAction("A_06", params);
    await loadCellCtx(ctx.cellKey);
    state.view = "s6";                    // 回填后到下一步：效果核验
    await renderAll();
    toast(r.result?.conflict ? "工参两来源冲突，转人工裁定（INV_15）" : `A_06 已回填：${esc(r.result?.status || "")}${r.result?.recheck ? " · 事后复核 " + esc(r.result.recheck) : ""} → 下一步：效果核验`,
      r.result?.conflict ? "bad" : "ok");
  },
  async "a06-missing"() {
    const ctx = state.ctx; if (!ctx?.plan) return;
    const p = ctx.plan, ep = F.execParams(ctx);
    // 回执缺失：不带 receipt，后端按 INV_08 记“未知”，工单留在处置中
    const r = await O().execAction("A_06", { planNo: p.planNo, dispatchNo: ep.dispatchNo, executeTime: ep.executeTime, receipt: "" });
    await loadCellCtx(ctx.cellKey); await renderAll();
    toast("A_06 已记回执缺失（未知）：" + esc(r.result?.note || "工单留在处置中，不得评估或关闭（INV_08）"), "warn");
  },
  async "a07-effect"() {
    const ctx = state.ctx; if (!ctx?.planNo) return;
    const r = await O().execAction("A_07", { planNo: ctx.planNo });
    await loadCellCtx(ctx.cellKey); await renderAll();
    toast(`A_07 效果：${esc(r.result.status)} · ${pct(r.result.beforeRatio)} → ${pct(r.result.afterRatio)}`, "ok");
  },
  async "a08-close"() {
    const ctx = state.ctx; if (!ctx?.ticket) return;
    const r = await O().execAction("A_08", { ticketNo: ctx.ticket.ticketNo });
    await loadCellCtx(ctx.cellKey);
    state.view = "s7";                    // 关单后到下一步：闭环与案例
    await renderAll();
    toast("A_08 已关闭：" + esc(r.result.status) + " → 下一步：闭环与案例", "ok");
  },
  async "a09-case"() {
    const ctx = state.ctx; if (!ctx?.ticket) return;
    // 适用条件取本体里已写下的事实：主因族来自 A_02 写入的根因轮次，区域属性来自 RT_04 关联的区域
    const causeFamily = (ctx.ticket.rootCauses || []).find(r => r.role === "主因")?.causeFamily || "天馈";
    const a = ctx.area || {};
    const r = await O().execAction("A_09", {
      effectNo: ctx.effectNo,
      applicability: {
        rat: ctx.ticket.rat, siteType: ctx.site?.siteType || "宏站", sceneLevel: ctx.ticket.sceneLevel, causeFamily,
        areaScene: a.areaScene || undefined, urbanRural: a.urbanRural || undefined, indoorOutdoor: a.indoorOutdoor || undefined
      }
    });
    await loadCellCtx(ctx.cellKey); await renderAll();
    toast(`A_09 已入库 ${esc(r.result.caseNo)}（${esc(r.result.outcome)}）`, "ok");
  },
  async "pick-effect"(el) {
    state.effectNo = el.dataset.effect;
    if (state.ctx) state.ctx.effect = (state.ctx.effects || []).find(x => x.effectNo === state.effectNo) || null;
    await renderAll();
  },
  async "reload-cases"() {
    const client = O(), data = await client.query('OT_CASE', { limit: 100 });
    if (client !== O()) return;
    state.cases = data; if (state.ctx) state.ctx.cases = data.items || [];
    await renderAll();
  },
  async ask() {
    const ta = $("#chatInput"); const q = ta.value.trim(); if (!q) return;
    const client = O(), token = state.selectionToken;
    const current = () => client === O() && token === state.selectionToken;
    state.chat.push({ role: "me", text: q }); ta.value = "";
    await renderAll();
    const t0 = performance.now();
    // 最近 8 条对话交给后端做指代消解（“它”“刚才那个小区”）；当前这句不重复进历史
    const history = state.chat.slice(0, -1)
      .map(m => ({ role: m.role === "me" ? "user" : "assistant", content: m.text })).slice(-8);
    // 流式问答：回答按 SSE 逐段到达，边收边显示；先放一条空的助手消息
    const msg = { role: "bot", text: "", refs: [], streaming: true, by: "rule", grounded: null, llm: null, intent: "" };
    state.chat.push(msg);
    await renderAll();
    let last = 0;
    const paint = async force => {
      if (!current()) return;
      const now = performance.now();
      if (!force && now - last < 70) return;      // 节流：流式时不重画整页
      last = now;
      renderChat();
    };
    try {
      await client.askStream(q, {
        cellKey: state.cellKey || undefined,
        ticketNo: state.ctx?.ticket?.ticketNo || undefined,
        history, readOnly: true
      }, async ev => {
        if (!current()) return;
        if (ev.type === "refs") { msg.refs = ev.refs || []; msg.intent = ev.intent || msg.intent; await paint(true); }
        else if (ev.type === "delta") { msg.text += ev.text || ""; await paint(); }
        // 整段替换：模型改写的内容没通过落地检查时，后端改用规则原文（不在界面上留下半句错话）
        else if (ev.type === "replace") { msg.text = ev.text || ""; await paint(true); }
        else if (ev.type === "meta") {
          msg.engine = ev.engine; msg.stage = ev.stage;
          msg.stageLabel = STAGE_LABEL[ev.stage] || "";
          if (!msg.text) await paint(true);
        }
        else if (ev.type === "supplement") { msg.supplement = ev.supplement || null; await paint(true); }
        else if (ev.type === "done") {
          const o = ev.out || {};
          msg.text = o.text || msg.text; msg.refs = o.refs || msg.refs; msg.pending = o.pending || [];
          msg.writes = o.writes || []; msg.grounded = o.grounded || null; msg.by = o.by || "rule";
          msg.llm = o.llm || null; msg.intent = o.intent || msg.intent; msg.streaming = false;
          msg.stageLabel = "";
          msg.supplement = o.supplement || null;
        } else if (ev.type === "error") {
          msg.streaming = false;
          msg.text = `（${ev.body?.errorCode || "ERROR"}）${ev.body?.message || "问答出错"}`;
        }
      });
    } catch (e) {
      if (current()) showError(e, "问答");
      msg.streaming = false;
      msg.text = `（${e.errorCode || "ERROR"}）${e.message}`;
    }
    msg.streaming = false;
    msg.ms = Math.round(performance.now() - t0);
    if (current()) await renderAll();
  }
};

/* ── 事件绑定 ─────────────────────────────────────────────────────────── */
function bind() {
  window.addEventListener('pagehide', event => { if (!event.persisted) O().release(true).catch(() => {}); });
  document.addEventListener("click", async ev => {
    const card = ev.target.closest(".ccard");
    if (card) { await ACT["open-cell"](card); return; }
    const nav = ev.target.closest("[data-view]");
    if (nav) {
      if (state.loadingCell) {
        state.selectionToken++; state.chainToken++; state.loadingCell = false;
        state.chainBusy = false; state.chainRun = false;
      }
      state.view = nav.dataset.view; state.modal = null;   // 换视图＝收起步骤弹窗
      await renderAll();
      if (state.view === "case") await ACT["reload-cases"]();
      return;
    }
    const chip = ev.target.closest("[data-el]");
    if (chip) {
      state.inspector = chip.dataset.el;
      // 本体图谱里点中的节点留一个选中态，便于对照右栏检查器
      for (const n of document.querySelectorAll(".om-node.on")) n.classList.remove("on");
      const node = chip.closest(".om-node"); if (node) node.classList.add("on");
      $("#inspBody").innerHTML = inspHtml(); return;
    }
    const quick = ev.target.closest("[data-quick]");
    if (quick) {
      // 推荐提问：点了填进输入框，由用户回车或点发送发起提问（不自动提交，避免误发）
      const box = $("#chatInput");
      if (box) { box.value = quick.dataset.quick || ""; box.focus(); box.setSelectionRange(box.value.length, box.value.length); }
      return;
    }
    const btn = ev.target.closest("[data-act]");
    if (btn) {
      if (btn.disabled) return;
      const act = ACT[btn.dataset.act]; if (!act) return;
      state.busy = true; btn.classList.add("busy");
      try { await act(btn); } catch (e) { showError(e, btn.dataset.act); await reloadCurrent(); await renderAll(); }
      finally { state.busy = false; void refreshSummary(true); }
      // 动作把流程往前推了一步：静默刷新决策链状态，别让状态条停在旧结论上
      if (state.chainStale) { const t = state.chainStale; state.chainStale = 0; await ACT["sync-chain"](t); }
    }
  });
  // 大屏筛选：只刷新卡片区，不重建整页（避免搜索框丢焦点）
  document.addEventListener("change", async ev => {
    const f = ev.target.closest("[data-f]");
    if (f) { state.filters[f.dataset.f] = f.value; B.refreshBoardGrid(); return; }
    // 下拉框类字段改了就重画，让"本步提交"那行与字段保持一致
    const ov = ev.target.closest("[data-override]");
    if (ov) { state.overrides[ov.dataset.override] = ov.value; await renderAll(); }
  });
  document.addEventListener("input", ev => {
    if (ev.target.id === "fQ") { state.filters.q = ev.target.value; B.refreshBoardGrid(); }
    // 用户改过的字段优先于界面推导出来的值（不改也能推进）
    const ov = ev.target.closest("[data-override]");
    if (ov) state.overrides[ov.dataset.override] = ov.value;
  });
  document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && state.modal) { state.modal = null; renderModal(); return; }
    if (ev.target.id === "chatInput" && ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); ACT.ask(); }
    if (ev.target.classList?.contains("ccard") && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); ACT["open-cell"](ev.target); }
    if (ev.target.dataset?.act === "open-step" && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); ACT["open-step"](ev.target); }
  });
  $("#roleSel").addEventListener("change", async ev => {
    state.role = ev.target.value; O().role = ev.target.value;
    await reloadCurrent(); await renderAll();
    toast(`角色已切换为 <b>${esc(state.role)}</b>，界面按该角色可用动作重新渲染`, "ok");
  });
  $("#clockBtn").addEventListener("click", async () => {
    const next = new Date(Date.parse(state.clock + "Z") + 86400 * 1000).toISOString().slice(0, 19);
    await O().setClock(next); state.clock = next; await reloadCurrent(); await renderAll();
    toast(`判断时点推进到 <b class="mono">${esc(clockTxt(next))}</b>（MR 数据按到达时刻陆续入库）`, "ok");
  });
  $("#clockInput").addEventListener("keydown", async ev => {
    if (ev.key !== "Enter") return;
    const raw = ev.target.value.trim().replace(" ", "T");
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw + "T09:00:00" : raw;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(iso)) { toast("判断时点格式应为 <b class='mono'>YYYY-MM-DDTHH:MM:SS</b>", "bad"); return; }
    await O().setClock(iso); state.clock = iso; await reloadCurrent(); await renderAll();
    toast(`判断时点已设为 <b class="mono">${esc(iso)}</b>`, "ok");
  });
  $('#analysisModeSel').addEventListener('change', event => {
    state.analysisMode = event.target.value;
    toast(state.analysisMode === 'independent' ? '每次点击小区都会从初始数据开始独立分析' : '后续小区沿用本轮时点、工单与案例', '');
  });
  $('#paceSel').addEventListener('change', event => { state.presentationMode = event.target.value; });
  $('#resetBtn').addEventListener('click', async () => {
    state.chainToken++; const token = ++state.selectionToken;
    const created = await beginAnalysis(token);
    if (!created || token !== state.selectionToken) return;
    state.view = 'board'; state.modal = null;
    await boot(created.bootstrap);
    toast('本次分析已回到初始数据，其他分析保持原状态', 'ok');
  });
}

/** 重载当前上下文（大屏或小区），不改变视图 */
async function reloadCurrent() {
  await loadBoard();
  if (state.cellKey) { await loadCellCtx(state.cellKey); }
  void refreshSummary(true);
}

/* ── 启动 ─────────────────────────────────────────────────────────────── */
(async function start() {
  window.__wb = { state, O };        // 调试出口：控制台可查前端持有的状态
  $("#roleSel").innerHTML = ROLES.map(r => `<option value="${esc(r)}"${r === state.role ? " selected" : ""}>${esc(r)}</option>`).join("");
  bind();
  try { await boot(); }
  catch (e) {
    document.body.innerHTML = `<div style="padding:40px;font-family:monospace;color:#fb7185">本体服务启动失败：${esc(e.message)}<br><span style="color:#93a9c6">请先运行 <b>node web/server.js --port 27080</b></span></div>`;
  }
})();
