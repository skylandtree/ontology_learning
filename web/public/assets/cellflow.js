/* ============================================================================
   cellflow.js —— 小区详情：以小区为起点的决策流程（7 步）
   每一步＝一次后端调用编排 ＋ 一块界面；界面上的每个判定值都能在某次
   函数／动作返回值里找到出处。前端不复算、不发明编号、不替后端下结论。
   ========================================================================== */
import { state, esc, pct, n1, n2, d2, dayTxt, clockTxt, badge, kindOf, actBtn, canAct, actRoles, lastDiag, DEMO_CELL } from "./core.js";
import { panel, panelTight, empty, kv, vchip } from "./ui.js";

// 停因：链只会因为两类原因停在执行中——本体推不出结论，或推出来了但不满足期望；
// 其余（发现阶段就不成立、状态不允许）是终态，不暗示“再等等就能过”。
export const CAUSE_TEXT = {
  "cannot-infer": "本体推不出",
  "expectation-unmet": "结果不满足期望",
  "human-gate": "待人工确认",
  terminal: "终态"
};
export const CAUSE_TAG = { "cannot-infer": "th", "expectation-unmet": "inv", "human-gate": "a", terminal: "" };

export const STEPS = [
  { id: "s1", n: 1, name: "发现与判定", en: "DISCOVERY" },
  { id: "s2", n: 2, name: "工单与定因", en: "DIAGNOSIS" },
  { id: "s3", n: 3, name: "优化方案", en: "PLAN" },
  { id: "s4", n: 4, name: "确认派单", en: "APPROVAL" },
  { id: "s5", n: 5, name: "实施回填", en: "EXECUTION" },
  { id: "s6", n: 6, name: "效果核验", en: "EFFECT" },
  { id: "s7", n: 7, name: "闭环与案例", en: "CLOSURE" }
];

/* ── 每一步的状态标记：done 已完成／active 该做这一步／idle 未开始／blocked 有阻塞 ── */
export function stepState(ctx, n) {
  const t = ctx?.ticket, p = ctx?.plan, e = ctx?.effect;
  switch (n) {
    case 1:
      // ① 含 A_01 建单：判定出来但还没建单时，"该做这一步"仍停在 ①（建单按钮就在 ① 里）
      if (!ctx?.scanItem) return { mark: "idle", text: "未发现" };
      if (ctx?.ticket) return { mark: "done", text: "已判定" };
      if (ctx.scanItem.verdict !== "达到派单条件") return { mark: "done", text: "已判定·不派单" };
      return { mark: "active", text: "待建单" };
    case 2:
      if (!t) return { mark: "idle", text: "—" };
      if (t.status === "待核验") return { mark: "active", text: "待定因" };
      if (t.status === "已排除") return { mark: "blocked", text: t.status };
      return { mark: "done", text: t.status };
    case 3:
      if (!p) return { mark: t && ["已确认", "改善未解决"].includes(t.status) ? "active" : "idle", text: "未生成" };
      return { mark: p.status === "草案" ? "blocked" : "done", text: p.status };
    case 4:
      if (!p) return { mark: "idle", text: "—" };
      if (p.status === "待确认") return { mark: "active", text: "待派单" };
      if (p.status === "草案") return { mark: "blocked", text: "草案" };
      return { mark: "done", text: p.status };
    case 5:
      if (!p) return { mark: "idle", text: "—" };
      if (p.execution) return { mark: "done", text: p.execution.receipt || "已回填" };
      if (["已派单", "未知"].includes(p.status)) return { mark: "active", text: "待回填" };
      return { mark: "idle", text: "—" };
    case 6:
      if (!e) return { mark: t && t.status === "待评估" ? "active" : "idle", text: t?.status === "处置中" ? "待回填" : "待评估" };
      return { mark: e.status === "持续有效" ? "done" : "active", text: e.status };
    case 7:
      if (t && t.status === "已关闭") return { mark: "done", text: "已关单" };
      if (e && e.sustained === true) return { mark: "active", text: "可关单" };
      return { mark: "idle", text: "—" };
  }
  return { mark: "idle", text: "—" };
}

const ruleOf = id => (state.def?.dispatchRules || []).find(r => r.ruleId === id) || null;

/* ============================================================================
   必填参数的自动推导 —— 决策流程只靠点击推进
   动作的必填参数不要求用户手填：一律从界面上已有的证据推出来——F_07／F_08
   的判定与诊断、方案的影响范围与场景等级、现场回填记录。推导结果同时显示
   在界面上（可改可不改，改过的以用户为准，见 state.overrides）。
   ========================================================================== */

/* 用户改过的值优先，没改的用推导值 */
export const pick = (key, derived) => (state.overrides?.[key] !== undefined ? state.overrides[key] : (derived ?? ""));

/* ② 复核判断：F_07＝部分重合或并列次因时，A_03 需要一句人写的复核判断。
   依据取工单自己的诊断记录（A_02 写入的权威结果），没有预览结果也能推出来；
   预览结果（state.diag）只作补充，用户不必先点"执行 F_07"。 */
export function reviewReason(ctx) {
  const t = ctx?.ticket; if (!t) return "";
  const d = t.diagnostics || [];
  const last = kind => [...d].reverse().find(x => x.kind === kind)?.result;
  const fw = last("假性弱覆盖") || state.diag.F_07?.result;
  const f8 = last("下倾角命中") || state.diag.F_08?.result;
  const cause = (t.rootCauses || []).find(r => r.role === "主因");
  const sub = (t.rootCauses || []).find(r => r.role === "次因");
  const parts = [];
  if (fw?.verdict === "部分重合") parts.push(`F_07＝部分重合（重合 ${fw.overlap}/${fw.weakCount} 天，占比 ${pct(fw.share)}）`);
  if (f8?.match) parts.push(`F_08＝${f8.match}${typeof f8.deficit === "number" ? `（缺口 ${n2(f8.deficit)}°）` : ""}`);
  if (sub) parts.push(`次因同时命中：${sub.causeLabel}`);
  if (!parts.length) return cause ? `主因：${cause.causeLabel}` : "";
  if (!cause && !sub) return parts.join("；");   // 还没写主因时只摆证据
  return parts.join("；") + (cause ? `；裁决主因：${cause.causeLabel}` : "；裁决：主因成立");
}

/* ④ 审批链：多小区（≥2）或 VIP／VVIP 须追加优化主管——与 A_05 的判定同口径 */
export function approvalChain(ctx) {
  const chain = [{ role: "地市优化工程师", name: state.role }];
  const n = (ctx?.planScope || []).length, vip = ["VIP", "VVIP"].includes(ctx?.ticket?.sceneLevel);
  if (n >= 2 || vip) chain.push({ role: "优化主管", name: "优化主管" });
  return chain;
}

/* ④ 批准理由：把可批准性结论与影响范围写成一句可审计的理由 */
export function approvalReason(ctx) {
  const p = ctx?.plan; if (!p) return "";
  const n = (ctx?.planScope || []).length;
  const scope = n >= 2 ? `影响 ${n} 个小区（须追加优化主管批准）` : `影响 ${n} 个小区`;
  return `周边影响 F_10＝${p.impact?.result || "—"}；${scope}；按 RULE_W14 审批`;
}

/* ⑤ 回填参数：取自现场回填记录（来源事实）；没有记录就不用计划值冒充实际值（INV_07） */
export function execParams(ctx) {
  const p = ctx?.plan, act = p?.actions?.[0] || {};
  const fe = (ctx?.fieldExec?.items || [])[0] || null;
  const ex = p?.execution || {};
  return {
    field: fe, pending: ctx?.fieldExec?.pending || [],
    dispatchNo: ex.dispatchNo || "",
    executeTime: fe?.executeTime || "",
    receipt: fe?.receipt || "",
    actualValue: fe?.toValue ?? "",
    planValue: act.targetValue ?? "",
    param: fe?.param || act.param || "",
    fromValue: fe?.fromValue ?? ""
  };
}

/* 下一次可评估的最早时点：后窗要满 max(派单规则窗口天数, effectMinDaysAfter) 天的 MR，
   持续有效还要满 effectSustainDays 天；MR 次日凌晨才入库，所以再留一天。
   天数取自本体参数（GET /definition），日期只是把时点指出来——判定仍由后端 F_11 给。 */
function nextEvalClock(ctx, sustained) {
  const ex = ctx?.plan?.execution?.executeTime;
  if (!ex) return null;
  const rule = ruleOf(ctx?.ticket?.discovery?.ruleId);
  const winDays = Math.max(Number(state.params?.effectMinDaysAfter || 0), Number(rule?.windowDays || 0));
  const need = sustained ? Number(state.params?.effectSustainDays || 0) : winDays;
  const base = Date.parse(String(ex).slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(base)) return null;
  return new Date(base + (need + 1) * 86400000).toISOString().slice(0, 10) + "T09:00:00";
}

/* 一键把判断时点指到某个可执行时刻（时点由后端事实或本体参数推得，不是判定） */
function clockBtn(iso, label, why) {
  if (!iso) return "";
  return `<button class="btn ghost tiny" data-act="set-clock" data-iso="${esc(iso)}" title="${esc(why || "")}">${esc(label)}</button>`;
}

/* ── 决策链执行状态（小区详情页首部）─────────────────────────────────────
   点开小区后链按七步执行：一步出一次结果，满足下一步的条件才继续走；
   走不动就停在那一步，后面几步标"未执行"。这里只摆后端 /chain/run 的返回值
   （按步执行时每次多走一步），前端不重算、不预判、不替后端下结论。 */
const CHAIN_CLASS = { done: "done", blocked: "blocked", skipped: "skipped", pending: "pending", running: "running" };
const CHAIN_TEXT = { done: "已完成", blocked: "受阻", skipped: "未执行", pending: "未开始", running: "执行中" };

/** 每一步的结果摘要：取后端给的 note/detail，压成一行 */
function chainStepBrief(s) {
  if (s.note) return s.note;
  const d = s.detail || {};
  if (s.n === 1) return d.verdict ? `判定「${d.verdict}」${d.hitDays !== undefined ? `· 命中 ${d.hitDays} 天` : ""}` : "—";
  if (s.n === 2) return d.rootCause ? `主因「${d.rootCause}」` : (d.f08 ? `F_08＝${d.f08}` : "—");
  if (s.n === 3) return d.planNo ? `${d.planNo}（${d.status}）` : "—";
  if (s.n === 4) return d.dispatchNo ? `派单 ${d.dispatchNo}` : "—";
  if (s.n === 5) return d.receipt ? `回执 ${d.receipt}` : "—";
  if (s.n === 6) return d.status ? `${d.status}` : "—";
  if (s.n === 7) return d.caseNo ? `${d.caseNo}（${d.outcome || ""}）` : (d.ticketStatus || "—");
  return "—";
}

/** 执行过的动作：卡片上只留编号（角色／委托／结果放在 title 与弹窗里，卡片要保持一行高） */
function chainActions(s) {
  if (!s.actions?.length) return "";
  return `<div class="ca-line">${s.actions.map(a => {
    const st = a.outcome === "ok" ? "成功" : a.outcome === "awaiting" ? "待人工" : (a.errorCode || "拒绝");
    return `<span class="chip a static" title="${esc(`${a.code} · ${a.role}${a.humanGate ? " · 委托执行" : ""} · ${st}`)}">${esc(a.code)}</span>`;
  }).join("")}</div>`;
}

/* ── 推理过程：这一步真正调用了哪些本体要素（后端逐步记录，前端按顺序摆出来）── */
const DEF_ARR = { F: "functions", A: "actions", INV: "constraints", RULE: "rules", TH: "assumptions", OT: "objectTypes", RT: "relationTypes" };

/** 要素名取本体定义（不自己写解释）；找不到就只显示标识 */
function defLabel(kind, id) {
  const it = ((state.def || {})[DEF_ARR[kind]] || []).find(x => x.id === id || x.code === id);
  if (!it) return "";
  return String(it.name || it.label || it.meaning || it.text || it.code || "").slice(0, 24);
}

function traceRow(e) {
  const kindLabel = { CLOCK: "时点", SRC: "来源事实", NOTE: "说明" }[e.kind] || e.kind;
  const isOnt = !!kindOf(e.id);
  const head = e.kind === "CLOCK"
    ? `<span class="chip static">时点</span><span class="ct-nm mono">${esc(clockTxt(e.id))}</span>`
    : isOnt
      ? `${badge(e.id)}<span class="ct-nm">${esc(defLabel(e.kind, e.id))}</span>`
      : `<span class="chip static">${esc(kindLabel)}</span><span class="ct-nm">${esc(e.id)}</span>`;
  const mark = e.status === "violation" ? `<span class="verdict v-bad">拒</span>`
    : e.status === "awaiting" ? `<span class="verdict v-unk">待人工</span>`
      : isOnt ? `<span class="verdict v-hit">✓</span>` : "";
  return `<div class="ct-row ${esc(e.status || "ok")}"${e.note ? ` title="${esc(e.note)}"` : ""}>
    <span class="ct-n">${esc(e.step)}</span>${head}
    ${e.note ? `<span class="ct-nt">${esc(e.note)}</span>` : ""}${mark}</div>`;
}

/** 推理过程在主视图里只留一行"最近一次本体调用"（执行时逐条滚动替换）；
    完整过程折叠在步骤卡片里：点开那张卡片、在弹窗里看该步的全量记录。 */
function traceStrip(running) {
  const rows = state.chainTrace || [];
  const last = rows[rows.length - 1];
  return `<div class="cb-trace">
    <div class="ct-hd"><span class="k">本体推理过程</span><span class="eyebrow">ONTOLOGY CALLS</span>
      <span class="spacer"></span>
      <span class="tiny dim">${rows.length ? `已记录 ${rows.length} 条 · 点步骤卡片看完整过程` : "点步骤卡片看完整过程"}</span></div>
    ${last ? `<div class="ct-log">${traceRow(last)}</div>`
      : `<div class="ct-empty">${running ? "正在调用本体：点任意步骤卡片可看该步的完整推理过程。" : "还没有调用记录。点开小区后，每一步调用了哪些要素，点那张步骤卡片就能看到。"}</div>`}
  </div>`;
}

/* ── 人工接入：链停在“人手里的那条事实／那个决定”时，给出处理入口 ─────────
   内容全部来自后端 stop（code／reason／basis／human）与本体定义：
   basis 是这条约束在本体里的原文，human 由链给出“要谁、补什么、补完怎么继续”。
   前端不另写判定，也不暗示“再等等就能过”：只有 human 非空的停点才显示这块。 */
function humanBlock(rep, ctx) {
  const st = rep?.stop, h = st?.human;
  if (!h) return "";
  const a = ctx?.plan?.actions?.[0] || {};
  const isField = h.action === "field-report";
  const paramName = a.param === "elecTilt" ? "电下倾" : "机械下倾";
  return `<div class="cb-human">
    <div class="ch-hd"><span class="k">人工接入处理</span><span class="eyebrow">HUMAN-IN-THE-LOOP</span>
      <span class="spacer"></span><span class="tiny dim">第 ${st.step} 步停住 · 处理后才能继续</span></div>
    <div class="ch-tx">
      <div><b>本体依据</b>：${esc(st.basis ? `${st.code}｜${st.basis}` : st.code || "—")}</div>
      ${st.expected ? `<div><b>期望</b>：${esc(st.expected)}${st.gap ? `；<b>缺口</b>：${esc(st.gap)}` : ""}</div>` : ""}
      <div><b>推理结论</b>：${esc(st.reason)}。第 ${st.step + 1} 步及之后不执行。</div>
      <div><b>需要人工</b>：${esc(h.role)} · ${esc(h.what)}；${esc(h.then)}。</div>
    </div>
    ${isField ? `<div class="row wrap ch-form">
      <label class="tiny dim">${esc(paramName)}实际值（°）
        <input id="inFieldValue" type="number" step="0.1" value="${a.targetValue === undefined || a.targetValue === null ? "" : esc(a.targetValue)}" style="width:76px"></label>
      <label class="tiny dim">实施时间
        <input id="inFieldTime" type="text" value="${esc(state.clock || "")}" style="width:168px"></label>
      <label class="tiny dim">回执
        <select id="inFieldReceipt"><option value="成功">成功</option><option value="失败">失败</option></select></label>
      <label class="tiny dim">执行方
        <input id="inFieldExecutor" type="text" value="崇明维护班组" style="width:118px"></label>
      <button class="btn primary tiny" data-act="report-field">现场回报并继续执行</button>
      <span class="tiny dim">以<b>现场维护人员</b>身份上报（A_06 允许的角色）；只补“现场实测值”这条来源事实，回填仍由 A_06 校验后写入（INV_07／INV_08）</span>
    </div>` : ""}
    <div class="row wrap" style="margin-top:8px">
      <button class="btn ${isField ? "ghost" : "primary"} tiny" data-act="chain-resume">处理后继续执行</button>
      <span class="tiny dim">继续执行重跑同一条决策链：停点之前的步骤静默重放，从第 ${st.step} 步接着往下走。</span>
    </div>
  </div>`;
}

/** 按"已显示到第几步（reveal）＋正在执行第几步（running）"摊开七格。
    已走到的格用后端状态；正在走的格标执行中；后面还没到的格保持未开始（上游停下的标未执行）。 */
function visualSteps(rep, reveal, running) {
  const steps = rep?.steps?.length ? rep.steps
    : STEPS.map(s => ({ n: s.n, name: s.name, status: "pending", actions: [], detail: {}, note: "" }));
  const stopN = rep?.outcome === "stopped" ? (rep.stop?.step || 0) : 0;
  return steps.map((s, i) => {
    const n = i + 1;
    if (running && n === running) return { ...s, status: "running", note: "正在执行，结果马上出来…", actions: [] };
    if (n <= reveal) return s;
    if (stopN && n > stopN) return { ...s, status: "skipped", note: "上游未走通，本步未执行", actions: [] };
    return { ...s, status: "pending", note: "未开始", actions: [] };
  });
}

export function chainBar(ctx) {
  const rep = state.chain && state.chain.cellKey === ctx?.cellKey ? state.chain : null;
  const busy = !!state.chainBusy;
  const pulse = Number(state.chainPulse) || 0;
  const reveal = Math.min(Number(state.chainReveal) || 0, 7);
  // 正在执行的那一步：链在跑、且这一步还没出结果时占位在已显示步数的下一格。
  // 两步之间（上一步结果已到、下一步请求还没回）也保持"执行中"，不要退回"未执行"。
  const running = !busy ? 0
    : !rep ? Math.max(pulse, 1)
      : rep.outcome === "partial" ? Math.min(Math.max(pulse, reveal + 1), 7)
        : 0;
  const steps = visualSteps(rep, rep ? reveal : 0, running);
  const a = rep?.artifacts || {};
  const items = [
    ["工单", a.ticketNo], ["方案", a.planNo], ["派单", a.dispatchNo],
    ["效果", a.effectNo], ["案例", a.caseNo]
  ].filter(x => x[1]);
  const done = steps.filter(s => s.status === "done").length;
  const ok = rep?.outcome === "completed";
  const stopped = rep?.outcome === "stopped";
  const jumps = rep?.clock?.jumps || [];
  const head = running
    ? `<span class="verdict v-unk"><span class="cb-spin"></span>执行中 ${done}/7 · 第 ${running} 步「${esc(steps[running - 1]?.name || "")}」</span>`
    : ok ? `<span class="verdict v-hit">已走通 ${done}/7</span>`
      : stopped ? `<span class="verdict v-bad">止步于第 ${rep.stop?.step ?? "—"} 步</span>`
        : rep?.outcome === "partial" ? `<span class="verdict v-unk">已执行 ${done}/7 · 停在第 ${reveal} 步</span>`
          : `<span class="verdict v-unk">未执行</span>`;
  const cls = !rep ? "idle" : ok ? "ok" : stopped ? "stop" : "idle";
  const note = running
    ? `决策链按七步顺序执行：每步出一结果，满足下一步的条件再继续；第 ${running} 步正在执行。`
    : (rep?.summary || "尚未执行决策链。点右侧按钮，从发现判定一路跑到闭环与案例——能走到哪一步由本体说了算。");
  return `<div class="chainbar ${cls}${busy ? " busy" : ""}">
    <div class="cb-hd">
      <span class="k">决策链执行状态</span><span class="eyebrow">AUTONOMOUS CHAIN</span>
      ${head}
      <span class="spacer"></span>
      ${rep ? `<span class="tiny dim mono">${esc(clockTxt(state.chainStart || rep.clock?.from))} → ${esc(clockTxt(rep.clock?.to))}</span>` : ""}
      ${busy && running ? `<button class="btn ghost tiny" data-act="chain-skip">跳至结果</button>` : ""}
      <button class="btn ${rep ? "ghost" : "primary"} tiny" data-act="run-chain"${busy ? " disabled" : ""}>${busy ? "执行中…" : rep ? "重跑" : "执行决策链"}</button>
    </div>
    ${traceStrip(!!running)}
    <div class="cb-steps">${steps.map(s => `
      <div class="cb-step ${CHAIN_CLASS[s.status] || "pending"}" data-act="open-step" data-step="${s.n}"
        title="第 ${s.n} 步「${esc(s.name)}」· ${esc(CHAIN_TEXT[s.status] || s.status)}｜${esc(chainStepBrief(s))}（点击看推理过程与结果）">
        <div class="cs-hd"><span class="cs-n">${s.n}</span><span class="cs-nm">${esc(s.name)}</span>
          <span class="cs-st">${esc(CHAIN_TEXT[s.status] || s.status)}</span></div>
        <div class="cs-note tiny">${esc(chainStepBrief(s))}</div>
        ${chainActions(s)}
      </div>`).join("")}</div>
    ${stopped && !busy && rep.stop ? `<div class="cb-stop"><span class="chip inv static">${esc(rep.stop.code || "STOP")}</span>
      <span class="chip ${CAUSE_TAG[rep.stop.cause] || ""} static">${esc(CAUSE_TEXT[rep.stop.cause] || "停止")}</span>
      <span>第 ${rep.stop.step} 步「${esc(rep.stop.name)}」：${esc(rep.stop.reason)}</span></div>` : ""}
    ${stopped && !busy && rep.cellKey === DEMO_CELL && rep.stop?.step === 1 ? `<div class="cb-note tiny">
      演示小区的 MR 故事固定在 2026-09-04～09-28、起点判断时点 2026-09-11 09:00；当前判断时点 ${esc(clockTxt(state.clock))} 的发现窗口已越过故事期。
      <button class="btn ghost tiny" data-act="demo-start" data-key="${esc(DEMO_CELL)}">从 2026-09-11 09:00 重演</button>
      （重建运行时与种子数据，再打开该小区）</div>` : ""}
    ${stopped && !busy ? humanBlock(rep, ctx) : ""}
    ${items.length ? `<div class="cb-art">${items.map(([k, v]) => `<span class="ca-art"><span class="k">${esc(k)}</span><span class="mono">${esc(v)}</span></span>`).join("")}</div>` : ""}
    ${jumps.length ? `<div class="cb-note tiny">判断时点推进 ${jumps.length} 次：${jumps.map(j => `${esc(clockTxt(j.from))} → ${esc(clockTxt(j.to))}（${esc(j.why)}）`).join("；")}</div>` : ""}
    <div class="cb-note tiny">${esc(note)}</div>
  </div>`;
}

/* ── 小区身份条（每一步顶部常驻）────────────────────────────────────────── */
export function cellHeader(ctx) {
  const c = ctx?.cell || {}, s = ctx?.scanItem || {}, a = ctx?.antenna?.antenna, site = ctx?.site;
  const nb = (c.neighbors || []).filter(n => n.overlapWeight > 0);
  return `<div class="cellid">
    <div class="ci-main">
      <div class="ci-nm">${esc(c.cellName || "")}</div>
      <div class="ci-key mono">${esc(c.cellKey || "")}</div>
    </div>
    <div class="ci-tags">
      ${badge("OT_CELL")}
      <span class="chip static">${esc(c.rat || "")} ${esc(c.band || "")}</span>
      <span class="chip static">${esc(s.siteType || "站点类型未知")}</span>
      <span class="chip static">${esc(c.sceneLevel || "场景等级缺失")}</span>
      ${site ? `<span class="chip rt" title="RT_01 归属站点">${esc(site.siteId)}</span>` : ""}
      ${a ? `<span class="chip rt" title="RT_02 天线">${esc(a.antennaId)}</span>` : ""}
      ${ctx?.area ? `<span class="chip rt" title="RT_04 覆盖区域">${esc(ctx.area.areaName)}</span>` : ""}
      ${nb.length ? `<span class="chip rt" title="RT_03 重叠邻区">重叠邻区 ${nb.length}</span>` : ""}
    </div>
    <div class="ci-right">${vchip(s.verdict || "证据不足")}</div>
  </div>`;
}

/* ── ① 发现与判定 ──────────────────────────────────────────────────────── */
function step1(ctx) {
  const s = ctx.scanItem || {}, rule = ruleOf(s.ruleId), d = ctx.discover;
  const daily = d?.daily || ctx.daily || [];
  const t = ctx.ticket;
  const canCreate = s.verdict === "达到派单条件" && !t;
  const why = t ? `该小区已有工单 ${t.ticketNo}（${t.status}），不重复建单（INV_14）`
    : s.verdict !== "达到派单条件" ? `当前判定“${s.verdict}”，不满足建单条件（INV_09／INV_16）` : "";
  return `
  ${panel("发现判定", `F_12 / F_06 · 只读，不建单`, `
    ${ctx.snapshot ? `<div class="note" style="margin-bottom:9px">已有工单：以下为<b>建单时</b>的发现快照（判断时点 ${esc(clockTxt(ctx.scanRef))}）。
      效果核验推进判断时点后，不再按当前窗口重算（INV_17）——所以这里不会出现“未达到派单条件”。</div>` : ""}
    <div class="row wrap" style="gap:6px;margin-bottom:9px">
      ${vchip(s.verdict || "证据不足")}
      <span class="chip static">命中 ${s.hitDays ?? 0} 天</span>
      <span class="chip static">未知 ${(s.unknownDates || []).length} 天</span>
      ${s.ruleId ? `<span class="chip rule">${esc(s.ruleId)}</span>` : `<span class="chip th">规则缺口</span>`}
      ${badge("F_12")}${badge("OT_CELL_MR")}
    </div>
    ${kv([
      ["判定", vchip(s.verdict || "证据不足")],
      ["适用规则", s.ruleId ? `${badge(s.ruleId)} <span class="mono">${esc(s.ruleVersion || "")}</span>` : `<span class="verdict v-unk">无适用规则</span>`],
      ["派单门限", rule ? `弱覆盖采样点 ≥ ${rule.minWeakSamples} 且占比 ≥ ${pct(rule.minWeakRatio, 0)}` : "—"],
      ["最少命中", rule ? `${rule.minHitDays} 天 / ${rule.windowDays} 天窗口` : "—"],
      ["窗口", `${esc(s.window?.from || ctx.scanWindow?.from || "")} ~ ${esc(s.window?.to || ctx.scanWindow?.to || "")}`],
      ["命中日", (s.hitDates || []).map(d0 => esc(dayTxt(d0).slice(5))).join("、") || "—"],
      ["未知日", (s.unknownDates || []).map(d0 => esc(dayTxt(d0).slice(5))).join("、") || "—"],
      ["缺口说明", esc(s.note || s.reason || "—")]
    ])}
    <div class="hr"></div>
    <div class="row wrap" style="gap:6px">
      ${actBtn("create-ticket", "A_01", "A_01 建单", "primary", canCreate, why)}
      <span class="tiny dim">A_01 会<b>重算 F_06</b>，要求判定＝达到派单条件且窗口内存在 OT_CELL_MR 证据（INV_16）</span>
    </div>
    ${t ? `<div class="note ok" style="margin-top:9px">该小区已有工单 <b class="mono">${esc(t.ticketNo)}</b>（${esc(t.status)}）——到「② 工单与定因」继续。</div>` : ""}`)}
  ${daily.length ? panel("逐日 MR 与判定", `OT_CELL_MR · ${esc(ctx.cell?.cellName || "")}`,
    `<div id="mrChartHost"></div>
     <div class="hr"></div>
     <div class="row wrap" style="gap:5px">${daily.map(x => `<span class="chip ${x.hit === "是" ? "" : x.hit === "未知" ? "th" : "static"}">${esc(dayTxt(x.date).slice(5))} ${esc(x.hit)}</span>`).join("")}</div>
     <div class="note" style="margin-top:9px">判定来自后端 <span class="mono">F_05／F_06</span>；柱高为实测弱覆盖占比，琥珀虚线＝派单规则门限。
       斜纹柱＝当日无 MR 实例（未知，不是 0，也不是“未命中”）。</div>`) : ""}
  ${panel("发现依据", `evidenceRefs → RT_17 → OT_CELL_MR`, (s.evidenceRefs || []).length
    ? `<table class="tbl"><thead><tr><th>MR 日统计</th><th>版本</th></tr></thead><tbody>
       ${s.evidenceRefs.map(r => `<tr><td class="mono tiny">${esc(r.mrKey)}</td><td class="n">v${esc(r.version)}</td></tr>`).join("")}
       </tbody></table>`
    : empty("没有可引用的 MR 证据。", "证据不足不建单（INV_09）：缺天不是 0，也不是“未命中”。"))}`;
}

/* ── ② 工单与定因 ──────────────────────────────────────────────────────── */
function step2(ctx) {
  const t = ctx.ticket;
  if (!t) return panel("工单与定因", "A_01 → F_07 → F_08 → A_02 → A_03",
    empty("该小区还没有工单。", "工单是发现之后的处置载体：先在「① 发现与判定」建单，再定因。"));
  const d = t.discovery || {}, rel = ctx.ticketRel?.items || [];
  const relRows = rel.map(r => `<tr>
      <td class="k">${badge(r.relationType)}</td>
      <td class="mono tiny">${esc(r.direction === "outbound" ? r.from : r.to)}</td>
      <td class="mono tiny dim">→ ${esc(r.direction === "outbound" ? r.to : r.from)}</td>
      <td class="tiny dim">${esc(JSON.stringify(r.props || {}))}</td>
      <td class="tiny dim">${r.derived ? "派生" : esc(r.validFrom || "")}</td></tr>`).join("");
  const tl = (t.diagnostics || []).slice().reverse().map(x => `
    <div class="tl-item ${x.kind === "假性弱覆盖" && x.result?.verdict === "排除" ? "bad" : ""}">
      <div class="tl-t"><span>${esc(clockTxt(x.calledAt))}</span>${badge(x.funcId || "")}<span>${esc(x.kind || "")}</span>
        <span class="dim">${esc(x.calledBy || "")}</span></div>
      <div class="tl-b">${esc(x.result?.verdict || x.result?.match || x.result?.result || "")}
        ${x.result?.deficit !== undefined ? `<span class="mono tiny dim"> 缺口 ${n2(x.result.deficit)}°</span>` : ""}
        ${x.result?.share !== undefined ? `<span class="mono tiny dim"> 重合占比 ${pct(x.result.share)}</span>` : ""}</div>
      <div class="tl-m">${esc((x.inputRefs || []).join(" · "))} ｜ 规则 ${esc((x.ruleVersions || []).join(" "))}</div>
    </div>`).join("");
  const rc = (t.rootCauses || []).map(r => `<tr>
      <td class="n">${r.round}</td><td>${esc(r.role)}</td><td>${esc(r.causeLabel)}</td>
      <td class="tiny">${esc(r.causeFamily || "")}</td>
      <td class="tiny dim">${esc((r.evidenceRefs || []).map(x => x.kind || x.ref || JSON.stringify(x)).join("；"))}</td>
      <td class="tiny dim">${esc(r.source || "")}</td></tr>`).join("");

  // 诊断结果优先取工单自己的诊断记录（A_02 写入的权威结果），没有才用预览结果
  const tDiag = t?.diagnostics || [];
  const lastRes = kind => [...tDiag].reverse().find(x => x.kind === kind)?.result;
  const fw = lastRes("假性弱覆盖") ? { result: lastRes("假性弱覆盖") } : state.diag.F_07;
  const f8 = lastRes("下倾角命中") ? { result: lastRes("下倾角命中") } : state.diag.F_08;
  const rr = pick("reviewReason", reviewReason(ctx));   // 复核判断：按证据自动生成，用户可改
  const fwBody = fw ? `
    <div class="row wrap" style="gap:6px;margin-bottom:8px">${vchip(fw.result.verdict)}
      <span class="chip static">重合 ${fw.result.overlap ?? 0} / ${fw.result.weakCount ?? 0} 天</span>
      <span class="chip static">占比 ${pct(fw.result.share)}</span>
      <span class="chip static">门限 ${pct(state.params?.falseWeakShare ?? .5, 0)}</span>${badge("F_07")}</div>
    ${fw.result.alarmRefs?.length ? `<div class="tiny dim mono">告警：${esc(fw.result.alarmRefs.join("　"))}</div>` : `<div class="tiny dim">窗口内无告警</div>`}
    ${fw.result.verdict === "排除" ? `<div class="note bad" style="margin-top:9px">假性弱覆盖：不写根因，应由 A_03 排除。</div>` :
      fw.result.verdict === "部分重合" ? `<div class="note warn" style="margin-top:9px">部分重合：告警盖住了部分命中日，确认前要写明复核判断——下方"裁决依据"已按证据自动写好，直接点"写主因并确认"即可。</div>` : ""}`
    : empty("尚未执行 F_07。", "假性弱覆盖：命中日与告警区间是否重合（TH07）。");
  const f8Body = f8 ? `
    <div class="row wrap" style="gap:6px;margin-bottom:8px">
      ${vchip(f8.result.match)}<span class="chip static">缺口 ${n2(f8.result.deficit)}°</span>
      <span class="chip static">总下倾 ${n2(f8.result.totalTilt)}°</span>
      <span class="chip static">推荐 ${n2(f8.result.thetaTarget)}°</span>
      <span class="chip static">rFar ${n1(f8.result.rFar)} m</span>
      ${badge("F_08")}<span class="chip static">v${esc(f8.result.funcVersion)}</span></div>
    <div id="tiltHost" style="margin-bottom:10px"></div>
    <div class="grid2" style="gap:14px">
      <div>${kv([
        ["命中/缺失", `${esc(f8.result.match)}${f8.result.missing?.length ? "（缺 " + esc(f8.result.missing.join("、")) + "）" : ""}`],
        ["原因", esc(f8.result.reason || f8.result.role || "—")],
        ["次因", f8.result.otherCauses?.length ? f8.result.otherCauses.map(esc).join("、") : "无"],
        ["输入引用", esc((f8.result.inputs?.antennaId || "—"))]
      ])}</div>
      <div>${kv([
        ["挂高 / 波束宽", `${n1(f8.result.inputs?.h)} m ／ ${n1(f8.result.inputs?.vBeam)}°`],
        ["目标半径", f8.result.inputs?.Rt === undefined ? "缺失" : Math.round(f8.result.inputs.Rt) + " m"],
        ["容差 eps", `${n2(state.params?.eps)}°（缺口≤容差判不命中）`],
        ["理论半径", `近端 ${n1(f8.result.rNear)} m ／ 远端 ${n1(f8.result.rFar)} m`]
      ])}</div>
    </div>
    ${f8.result.otherCauses?.length ? `<div class="note warn" style="margin-top:9px">次因同时命中：确认（A_03）前须由工程师写明复核判断，是否转专家由工程师决定。</div>` : ""}`
    : empty("尚未执行 F_08。", "F_08 判“天线下倾角过小”是否命中；缺输入时返回“未知”，不判“不命中”。");

  return `
  ${panel("状态轨道", null, `<div class="track-wrap">${stateTrackHtml(t.status)}</div>`)}
  <div class="row wrap">
    <span class="tiny dim">F_07／F_08 的结果自动取回（只计算、不写记录；写根因由 A_02 完成，写入工单的诊断记录）</span>
    <button class="btn ghost tiny" data-act="recalc-diag">重新计算</button>
  </div>
  <div class="grid2">
    ${panel("发现快照", "A_01 固定，不因数据更正而改写（INV_17）", kv([
      ["工单号", `<span class="mono">${esc(t.ticketNo)}</span>`],
      ["问题键", `<span class="mono">${esc(d.problemKey || "—")}</span>`],
      ["派单规则", `${badge(d.ruleId || "")} <span class="mono">${esc(d.ruleVersion || "")}</span>`],
      ["窗口", `${esc(d.window?.from || "")} ~ ${esc(d.window?.to || "")}（${d.window?.days ?? 0} 天）`],
      ["命中 / 未知", `${d.hitDays ?? 0} 天命中 · ${(d.unknownDates || []).length} 天未知`],
      ["判定", vchip(d.verdict)],
      ["证据引用", `<span class="mono">${(d.evidenceRefs || []).length}</span> 条 OT_CELL_MR（RT_17）`],
      ["复发关联", d.relatedTicketNo ? `<span class="mono">${esc(d.relatedTicketNo)}</span>（RT_07）` : "—"]
    ]))}
    ${panel("根因轮次", "只追加，不覆盖（INV_11）", rc
      ? `<table class="tbl"><thead><tr><th>轮</th><th>角色</th><th>原因</th><th>族</th><th>证据</th><th>来源</th></tr></thead><tbody>${rc}</tbody></table>`
      : empty("尚未写入根因。", "A_02 由规则命中写入主因，或由工程师／专家人工写入并附直接证据（INV_03）。"))}
  </div>
  <div class="gridDiag">
    ${panel("假性弱覆盖", "F_07 · RULE_W04", fwBody)}
    ${panel("下倾角命中", "F_08 · RULE_W06 / RULE_M01", f8Body)}
  </div>
  ${panel("写入根因与确认", "A_02 → A_03", `
    <div class="note">规则定因：优化本体按 F_08 命中写入主因"弱覆盖小区天线下倾角过小"，并附 MR 与工参两条直接证据（INV_03）；工程师点一下即完成"写主因＋确认"。
      只有 F_07＝排除（假性弱覆盖）或 F_08 未命中时才需要人工处置：A_03 确认／排除只能由地市优化工程师或优化专家执行。</div>
    <div class="reviewbox">
      <div class="rb-hd"><span class="k">裁决依据</span><span class="eyebrow">AUTO · 可改</span></div>
      <div class="rb-tx" id="rbTx">${esc(rr || "（写主因后按 F_07／F_08 证据自动生成）")}</div>
      <div class="rb-edit"><button class="btn ghost tiny" data-act="toggle-review">改写</button>
        <input id="inReviewReason" data-override="reviewReason" type="text" value="${esc(rr)}" placeholder="部分重合／并列次因时必填（A_03 会以 REVIEW_REQUIRED 拒绝）" style="display:none;width:100%"></div>
    </div>
    <div class="row wrap" style="margin-top:10px">
      ${actBtn("a02-a03", "A_02", "写主因并确认（A_02 → A_03）", "primary", t.status === "待核验")}
      ${actBtn("a03-exclude", "A_03", "A_03 排除（假性弱覆盖）", "danger", t.status === "待核验")}
      <span class="tiny dim">当前角色：${esc(state.role)}</span>
    </div>
    <div class="tiny dim mono" style="margin-top:8px">本步提交：A_02 写主因 → A_03 确认 · 理由「${esc(rr || "（无）")}」</div>
    ${t.status === "待核验" && fw?.verdict === "部分重合" ? `<div class="note warn" style="margin-top:9px">F_07＝部分重合：告警盖住了部分命中日，确认前要写明复核判断——上面的裁决依据已按证据自动写好，直接点"写主因并确认"即可。</div>` : ""}`)}
  ${panel("诊断记录", "每条含函数版本、输入引用与规则版本", tl ? `<div class="tl">${tl}</div>` : empty("尚无诊断记录。"))}
  ${panelTight("关系", "RT_05 派单对象 / RT_06 涉及 / RT_17 发现依据 / RT_08 根因依据",
    relRows ? `<table class="tbl"><thead><tr><th>关系</th><th>起点</th><th>终点</th><th>属性</th><th>生效</th></tr></thead><tbody>${relRows}</tbody></table>` : empty("无关系。"))}`;
}

/* ── ③ 优化方案 ────────────────────────────────────────────────────────── */
function step3(ctx) {
  const t = ctx.ticket, p = ctx.plan;
  if (!t) return panel("优化方案", "F_09 / F_10 / A_04", empty("尚无工单。"));
  const canGen = ["已确认", "改善未解决"].includes(t.status);
  const body = p ? `
    <div class="row wrap" style="gap:6px;margin-bottom:10px">
      ${vchip(p.status)}<span class="chip static">${esc(p.planNo)}</span>
      <span class="chip static">第 ${p.round} 轮</span>
      <span class="chip static">${esc(p.measureType?.name || "")}</span>
      <span class="chip static">执行方 ${esc(p.measureType?.executorRole || "")}</span>
      <span class="chip static">${p.measureType?.remote ? "可远程" : "不可远程"}</span>
      <span class="chip static">单次上限 ${p.measureType?.maxStep ?? 2}°</span>
      <span class="chip static">分辨率 ${p.measureType?.resolution ?? 1}°</span>
      ${badge("OT_PLAN")}</div>
    <div class="grid2">
      ${panel("措施动作", "actions", kv([
        ["目标", `<span class="mono">${esc(p.actions?.[0]?.targetKey || "")}</span>`],
        ["参数", esc(p.actions?.[0]?.param || "")],
        ["现值 → 目标", `${n1(p.actions?.[0]?.currentValue)}° → <b style="color:var(--cyan)">${n1(p.actions?.[0]?.targetValue)}°</b>`],
        ["Δ", `<b style="color:var(--cyan)">${n1(p.actions?.[0]?.deltaValue)}°</b>`],
        ["回退值", n1(p.actions?.[0]?.rollbackValue) + "°"],
        ["回退条件", esc(p.rollbackCondition || "—")]
      ]))}
      ${panel("影响范围摘要", "RT_10", kv([
        ["影响小区", `${(ctx.planScope || []).length} 个`],
        ["调整方式", esc(p.actions?.[0]?.param === "mechTilt" ? "机械下倾（作用于整副天线）" : "电子下倾（只作用于本阵列）")],
        ["周边影响", vchip(p.impact?.result)],
        ["案例引用", (p.caseRefs || []).length ? p.caseRefs.map(x => esc(x.caseNo)).join("、") : "—"]
      ]))}
    </div>
    ${panel("周边影响逐项检查", "F_10 · RULE_W13", `
        <div class="row wrap" style="gap:6px;margin-bottom:8px">${vchip(p.impact?.result)}
          <span class="chip static">Δ计划 ${n1(p.impact?.deltaPlan)}°</span>
          <span class="chip static">Δ最终 ${p.impact?.deltaFinal === null || p.impact?.deltaFinal === undefined ? "无可行值" : n1(p.impact.deltaFinal) + "°"}</span>
          ${badge("F_10")}</div>
        <table class="tbl impact"><thead><tr><th>检查</th><th>前 → 后</th><th style="width:30%"></th><th>目标</th><th>结论</th></tr></thead>
          <tbody>${impactChecksHtml(p.impact?.checks || [])}</tbody></table>`)}
    ${panel("影响范围（俯视）", "同天线小区与重叠邻区", `<div id="sectorHost"></div>
      <div class="note" style="margin-top:9px">影响范围由调整方式决定（INV_12）：机械下倾作用于整副天线承载的所有小区；电子下倾只作用于对应阵列小区。</div>`)}`
    : empty("尚未生成方案。", canGen ? "A_04 只生成建议、不执行；幅度与轮次由 F_09 给出，周边影响由 F_10 给出。" : `工单当前“${t.status}”，须先由 A_03 确认（INV_04）。`);
  return `
  ${panel("优化方案", "F_09 / F_10 / A_04", body, "flowhead")}
  <div class="row wrap">
    ${actBtn("a04-mech", "A_04", "A_04 机械下倾", "", !p && canGen)}
    ${actBtn("a04-elec", "A_04", "A_04 电子下倾", "", !p && canGen)}
    <span class="tiny dim">当前角色：${esc(state.role)}（A_04 允许：${esc(actRoles("A_04"))}）</span>
  </div>`;
}

/* ── ④ 确认派单 ────────────────────────────────────────────────────────── */
function step4(ctx) {
  const t = ctx.ticket, p = ctx.plan;
  if (!p) return panel("确认与派单", "A_05", empty("尚无方案。"));
  const scope = ctx.planScope || [];
  const ap = p.approval;
  const needSup = scope.length >= 2 || ["VIP", "VVIP"].includes(t?.sceneLevel);
  const chain = approvalChain(ctx);          // 审批链：按影响范围与场景等级自动带出
  const ar = pick("approvalReason", approvalReason(ctx));   // 批准理由：自动生成，可改
  return `
  ${panel("可批准性", null, `
    <div class="note ${p.impact?.result === "通过" || p.impact?.result === "调减" ? "ok" : "bad"}">
      ${p.impact?.result === "通过" || p.impact?.result === "调减"
        ? "周边影响“" + esc(p.impact.result) + "”，可进入确认（INV_06 通过）。"
        : "周边影响“" + esc(p.impact?.result || "—") + "”，<b>不得批准</b>（INV_06）；方案停在草案并转人工。"}
      ${p.measureType?.executorRole === "现场维护" ? "<br>天馈类措施<b>不得自动执行</b>：须人工确认并派给现场维护人员（INV_05）。" : ""}
    </div>
    ${kv([
      ["措施", `${esc(p.measureType?.name || "")}（${esc(p.measureType?.executorRole || "")}）`],
      ["幅度", `${n1(p.actions?.[0]?.deltaValue)}°（计划 ${n1(p.actions?.[0]?.currentValue)}° → ${n1(p.actions?.[0]?.targetValue)}°）`],
      ["影响范围", `${scope.length} 个小区${scope.length >= 2 ? " · 须追加优化主管批准" : ""}`],
      ["审批要求", needSup ? "地市优化工程师 ＋ <b>优化主管</b>" : "地市优化工程师"],
      ["既有审批", ap ? `${esc((ap.approverRoles || []).join(" ＋ "))} · ${esc(ap.decision)} · ${esc(clockTxt(ap.time))}` : "尚未审批"]
    ])}`)}
  ${panel("执行动作", "A_05", `
    <div class="row wrap">
      ${actBtn("a05-approve", "A_05", "A_05 批准并派单", "primary", p.status === "待确认")}
      ${actBtn("a05-reject", "A_05", "A_05 不批准", "danger", ["待确认", "草案"].includes(p.status))}
      <span class="tiny dim">当前角色：${esc(state.role)}（A_05 允许：地市优化工程师）</span>
    </div>
    <div class="row wrap" style="margin-top:9px">
      <span class="tiny dim">审批链
        ${chain.map((c, i) => `${i ? " → " : ""}<b style="color:var(--cyan)">${esc(c.role)}</b>`).join("")}
        ${chain.length > 1 ? `<span class="dim">（${esc(scope.length)} 个小区／${esc(ctx?.ticket?.sceneLevel || "一般")} 场景，按 RULE_W14 追加主管，本次一并提交）</span>` : ""}</span>
      <label class="tiny dim" style="flex:1;min-width:220px">批准／否决理由<span class="dim">（已按可批准性结论自动生成，可改）</span>
        <input id="inReason" data-override="approvalReason" type="text" value="${esc(ar)}" placeholder="批准意见或否决理由" style="width:100%"></label>
    </div>
    <div class="tiny dim mono" style="margin-top:8px">本步提交：A_05 批准并派单 · approvals=[${chain.map(c => esc(c.role)).join("，")}] · 理由「${esc(ar || "（无）")}」</div>
    ${p.execution ? `<div class="hr"></div>${kv([["派单号", `<span class="mono">${esc(p.execution.dispatchNo)}</span>`], ["执行方", esc(p.execution.executor || "")], ["回执", vchip(p.execution.receipt || "未知")]])}` : ""}`)}`;
}

/* ── ⑤ 实施回填 ────────────────────────────────────────────────────────── */
function step5(ctx) {
  const p = ctx.plan, t = ctx.ticket;
  if (!p) return panel("实施与回填", "A_06", empty("尚无方案。"));
  const ex = p.execution || {}, act = p.actions?.[0] || {}, av = ex.actualValues?.[0];
  const ep = execParams(ctx);                       // 回填参数：取自现场回填记录
  const fe = ep.field;
  const feCard = fe ? panel("现场回填记录", "来源事实 · 实施方回报", kv([
    ["任务号", `<span class="mono">${esc(fe.taskno || "—")}</span>`],
    ["实施时间", `<span class="mono">${esc(fe.executeTime || "—")}</span>`],
    ["收到时间", `<span class="mono">${esc(fe.receivedAt || "—")}</span>`],
    ["执行方", esc(fe.executor || "—")],
    ["回执", vchip(fe.receipt || "未知")],
    ["实际值", `${n1(ep.fromValue)}° → <b style="color:var(--green)">${n1(fe.toValue)}°</b>（${esc(fe.param || act.param || "")}）`]
  ])) : panel("现场回填记录", "来源事实 · 实施方回报",
    ep.pending.length
      ? `<div class="note warn">现场回填记录将于 <span class="mono">${esc(ep.pending[0].receivedAt || "—")}</span> 到达；当前判断时点还没有现场回报。
          在此之前只能“记回执缺失”，不得用计划值代替实际值（INV_07）。<br>
          ${clockBtn(ep.pending[0].receivedAt, `推进到 ${clockTxt(ep.pending[0].receivedAt)}`, "把判断时点推到现场回填记录到达的时刻")}</div>`
      : `<div class="note warn">该小区没有现场回填记录：现场未回报，实施结果未知，不得用计划值代替实际值（INV_07）。
          决策链会停在这一步，等现场维护人员在首部「人工接入处理」里回报实测值后再继续。</div>`);
  return `
  ${panel("实施与回填", "A_06", `
    <div class="grid2">
      ${panel("派单信息", null, kv([
        ["派单号", `<span class="mono">${esc(ex.dispatchNo || "—")}</span>`],
        ["执行方", esc(ex.executor || "—")],
        ["实施时间", esc(clockTxt(ex.executeTime) || "—")],
        ["回执", vchip(ex.receipt || "未知")],
        ["工单状态", vchip(t?.status || "—")]
      ]))}
      ${panel("计划值与现场实际值", "INV_07：不得用计划值代替实际值", kv([
        ["目标", `<span class="mono">${esc(act.targetKey || "")}</span> · ${esc(act.param || "")}`],
        ["计划值", n1(act.targetValue) + "°"],
        ["实际值", av ? `<b style="color:${av.value === act.targetValue ? "var(--green)" : "var(--amber)"}">${n1(av.value)}°</b>` : "—"],
        ["偏差", av ? n1(av.value - act.targetValue) + "°" : "—"],
        ["事后复核", p.impact?.checks?.find(c => c.kind === "事后复核") ? vchip(p.impact.checks.find(c => c.kind === "事后复核").result) : "—"]
      ]))}
    </div>
    <div class="hr"></div>
    ${feCard}
    <div class="note" style="margin-top:10px">回填必须带派单号、实施时间、回执与现场实际值——下面四个字段已按现场回填记录填好，<b>不用手填</b>，要改才改。
      <b>回执缺失记“未知”</b>，工单留在处置中，不得评估或关闭（INV_08）；同一派单号同一目标取值不同按冲突转人工（INV_15）。</div>
    <div class="row wrap" style="margin-top:10px">
      <label class="tiny dim">派单号 <input id="inDispatch" data-override="dispatchNo" type="text" value="${esc(ep.dispatchNo)}" style="width:150px"></label>
      <label class="tiny dim">实施时间 <input id="inExecTime" data-override="executeTime" type="text" value="${esc(ep.executeTime)}" style="width:170px"></label>
      <label class="tiny dim">回执
        <select id="inReceipt" data-override="receipt">
          <option value="成功"${ep.receipt === "成功" ? " selected" : ""}>成功</option>
          <option value="失败"${ep.receipt === "失败" ? " selected" : ""}>失败</option>
          <option value=""${!ep.receipt ? " selected" : ""}>缺失（记未知）</option>
        </select></label>
      <label class="tiny dim">实际值° <input id="inActual" data-override="actualValue" type="number" step="0.1" value="${ep.actualValue === "" ? "" : esc(ep.actualValue)}" style="width:80px"></label>
      ${actBtn("a06-fill", "A_06", "A_06 回填", "primary", !!fe,
        fe ? "" : (ep.pending.length ? `尚无现场回填记录（将于 ${esc(ep.pending[0].receivedAt || "—")} 到达），不得用计划值代替实际值（INV_07）` : "尚无现场回填记录，不得用计划值代替实际值（INV_07）"))}
      ${actBtn("a06-missing", "A_06", "A_06 记回执缺失（未知）", "", ["已派单", "未知"].includes(p.status))}
      <span class="tiny dim">当前角色：${esc(state.role)}</span>
    </div>
    <div class="tiny dim mono" style="margin-top:8px">本步提交：A_06 回填 · 派单号 ${esc(ep.dispatchNo || "（无）")} · 实施时间 ${esc(ep.executeTime || "（无）")} · 回执 ${esc(ep.receipt || "缺失（记未知）")} · 实际值 ${ep.actualValue === "" ? "（无）" : n1(ep.actualValue) + "°"}</div>`)}
  ${ctx.antennaHist?.length ? panelTight("天线工参版本链", "按版本追加；生效时间＝实施时间，不是回填接收时间",
    `<table class="tbl"><thead><tr><th>版本</th><th>生效时间</th><th>写入时间</th><th>来源</th><th>机械下倾</th></tr></thead>
       <tbody>${ctx.antennaHist.map(h => `<tr><td class="n">v${h.version}</td><td class="mono tiny">${esc(h.effectiveTime || "")}</td>
        <td class="mono tiny dim">${esc(h.systemTime || "")}</td><td class="tiny">${esc(h.source || "")}</td><td class="n">${n1(h.item?.mechTilt)}°</td></tr>`).join("")}</tbody></table>`) : ""}`;
}

/* ── ⑥ 效果核验 ────────────────────────────────────────────────────────── */
function step6(ctx) {
  const t = ctx.ticket, e = ctx.effect;
  if (!t) return panel("效果核验", "F_11 / A_07", empty("尚无工单。"));
  if (!e) return `
    ${panel("效果核验", "F_11 / A_07", empty("尚无效果记录。", "方案实施且回执成功后方可评估（A_07）；后窗连续有数据不足 7 天时判“待评估”，不是“未改善”。"))}
    <div class="row">${actBtn("a07-effect", "A_07", "A_07 写入优化效果", "primary", ["待评估", "已改善"].includes(t.status), `工单状态“${t.status}”不能写入效果`)}
      ${["待评估", "已改善"].includes(t.status) ? clockBtn(nextEvalClock(ctx, false), `推进到最早可评估时点 ${clockTxt(nextEvalClock(ctx, false))}`, "后窗要满窗口天数的 MR（次日凌晨入库），才评得出改善与否") : ""}
      <span class="tiny dim">当前工单状态：${esc(t.status)}</span></div>`;
  const prot = e.protection || [];
  const evals = (ctx.effects || []).map(x => `<span class="chip ${x.effectNo === e.effectNo ? "" : "static"}" data-act="pick-effect" data-effect="${esc(x.effectNo)}">${esc(x.effectNo.replace(/^EF-/, ""))} · ${esc(x.status)}</span>`).join(" ");
  return `
  ${panel("效果核验", `F_11 · ${esc(e.callRef || "")}`, `
    <div class="row wrap" style="gap:6px;margin-bottom:9px">${vchip(e.status)}
      <span class="chip static">${esc(e.effectNo)}</span>${badge("OT_EFFECT")}${badge("F_11")}</div>
    <div class="grid3">
      ${[["改善", e.improved === null ? "未知" : e.improved ? "是" : "否", e.improved ? "var(--green)" : "var(--red)"],
         ["达标", e.achieved === null ? "未知" : e.achieved ? "是" : "否", e.achieved ? "var(--green)" : "var(--amber)"],
         ["持续有效", e.sustained === null ? "为空" : e.sustained ? "是" : "否", e.sustained ? "var(--green)" : "var(--amber)"]]
        .map(([k, v, c]) => `<div class="kpi" style="--k:${c}"><div class="k">${esc(k)}</div><div class="v" style="color:${c}">${esc(v)}</div></div>`).join("")}
    </div>
    <div class="hr"></div>
    ${(ctx.effects || []).length > 1 ? `<div class="row wrap" style="gap:5px;margin-bottom:9px"><span class="eyebrow">评估次数 ${ctx.effects.length}</span>${evals}</div>` : ""}
    <div class="grid2">
      ${panel("前后窗", `前窗 ${esc(e.beforeWindow?.from || "")}~${esc(e.beforeWindow?.to || "")} · 后窗 ${esc(e.afterWindow?.from || "—")}~${esc(e.afterWindow?.to || "—")}`,
        `<div id="winHost"></div>
         <div class="hr"></div>${kv([
          ["前窗占比", pct(e.beforeRatio)], ["后窗占比", pct(e.afterRatio)],
          ["差值", e.beforeRatio !== null && e.afterRatio !== null ? n2(e.beforeRatio - e.afterRatio) + "（门限 0.05）" : "—"],
          ["后窗命中天数", e.afterHitDays ?? "—"],
          ["后窗天数", e.afterWindow?.days ?? "—"]
        ])}`)}
      ${panel("保护指标", `容差 0.02 · ${prot.length ? "已评定" : "未评定"}`, prot.length ? `
        <table class="tbl"><thead><tr><th>指标</th><th>前</th><th>后</th><th>结论</th></tr></thead><tbody>
        ${prot.map(p => `<tr><td class="tiny">${esc(p.name)}</td><td class="n">${p.before}</td><td class="n">${p.after}</td>
          <td>${p.pass ? `<span class="verdict v-hit">未恶化</span>` : `<span class="verdict v-bad">恶化</span>`}</td></tr>`).join("")}
        </tbody></table>` : empty("保护指标缺数据", "缺数据时效果判“待评估”，protectionOk 为空，不得写“通过”。"))}
    </div>`)}
  ${panel("写入效果", "A_07", `
    <div class="row wrap">${actBtn("a07-effect", "A_07", "A_07 写入优化效果", "primary", ["待评估", "已改善"].includes(t.status), `工单状态“${t.status}”不能写入效果`)}
      ${e.sustained === null ? clockBtn(nextEvalClock(ctx, true), `推进到最早可判定持续有效的时点 ${clockTxt(nextEvalClock(ctx, true))}`, `后窗要满 ${state.params?.effectSustainDays ?? 14} 天，才谈得上“持续有效”`) : ""}
      <span class="tiny dim">后窗每多一天可再评估一次（第 ${(ctx.effects || []).length} 次）；当前工单状态：${esc(t.status)}</span></div>`)}`;
}

/* ── ⑦ 闭环与案例 ──────────────────────────────────────────────────────── */
function step7(ctx) {
  const t = ctx.ticket, e = ctx.effect;
  const cs = ctx.cases || [];
  const related = cs.filter(c => c.sourceTicketNo === t?.ticketNo);
  return `
  ${panel("关单与入库", "A_08 / A_09", `
    <div class="note ${e?.sustained ? "ok" : "warn"}">
      ${e?.sustained ? "效果“持续有效”，可由优化主管关闭工单（A_08）。"
        : `最近一次效果“${esc(e?.status || "—")}”，持续有效为${e?.sustained === null ? "空" : "否"}，<b>不得关闭</b>（INV_10）。`}
      ${e?.sustained === null ? `还差：后窗满 ${state.params?.effectSustainDays ?? 14} 天后再次评估，其间不能再次达到派单条件。` : ""}</div>
    <div class="row wrap" style="margin-top:10px">
      ${actBtn("a08-close", "A_08", "A_08 关闭工单", "primary", !!e?.sustained)}
      ${actBtn("a09-case", "A_09", "A_09 案例入库", "", t?.status !== "待评估")}
      <span class="tiny dim">当前角色：${esc(state.role)}（A_08 允许：优化主管；A_09 允许：优化专家／知识维护人）</span>
    </div>`)}
  ${panelTight("本小区相关案例", "适用条件不一致不得复用；只作参考，不照搬幅度（RT_15）",
    related.length ? `<table class="tbl"><thead><tr><th>案例号</th><th>来源工单</th><th>结论</th><th>验证</th><th>幅度</th><th>适用条件</th></tr></thead><tbody>
        ${related.map(c => `<tr><td class="k mono">${esc(c.caseNo)}</td><td class="mono tiny">${esc(c.sourceTicketNo || "")}</td>
          <td>${vchip(c.outcome || "")}</td><td class="tiny">${esc(c.validation || "")}</td><td class="n">${n1(c.deltaValue)}°</td>
          <td class="tiny dim mono">${esc(JSON.stringify(c.applicability || {}))}</td></tr>`).join("")}
      </tbody></table>`
      : empty("该小区还没有入库案例。", "A_09 允许把失败与证据不足的案例同样入库（不删除）。"))}
  ${panelTight("案例库", `${cs.length} 条 · 全库（不限于本小区）`,
    cs.length ? `<table class="tbl"><thead><tr><th>案例号</th><th>来源工单</th><th>结论</th><th>验证</th><th>幅度</th><th>适用条件</th></tr></thead><tbody>
        ${cs.map(c => `<tr><td class="k mono">${esc(c.caseNo)}</td><td class="mono tiny">${esc(c.sourceTicketNo || "")}</td>
          <td>${vchip(c.outcome || "")}</td><td class="tiny">${esc(c.validation || "")}</td><td class="n">${n1(c.deltaValue)}°</td>
          <td class="tiny dim mono">${esc(JSON.stringify(c.applicability || {}))}</td></tr>`).join("")}
      </tbody></table>` : empty("案例库为空。"))}`;
}

/* ── 状态轨道（工单）────────────────────────────────────────────────────── */
function stateTrackHtml(status) {
  const order = ["待核验", "已确认", "处置中", "待评估", "已改善", "已关闭"];
  const i = order.indexOf(status);
  return `<div class="track">${order.map((s, k) => {
    const cls = k < i ? "done" : k === i ? "cur" : "";
    return `<div class="track-node ${cls}"><span class="track-dot"></span><span class="track-l">${esc(s)}</span></div>` +
      (k < order.length - 1 ? `<div class="track-link"></div>` : "");
  }).join("")}</div>`;
}

/* ── 周边影响逐项检查（复用 viz 的 bullet 条）──────────────────────────── */
function impactChecksHtml(checks = []) {
  if (!checks.length) return `<tr><td colspan="5" class="dim">无周边影响检查项</td></tr>`;
  return checks.map(c => {
    if (c.kind === "事后复核") return `<tr class="dim"><td>事后复核</td><td class="n">—</td><td colspan="3" class="tiny">实际Δ ${n1(c.delta)} m → ${esc(c.result)}</td></tr>`;
    if (c.kind === "远端覆盖") {
      const max = Math.max(c.before || 0, c.after || 0, c.targetRadius || 0) * 1.15;
      const w = v => `${Math.min(100, (v / max) * 100)}%`;
      const ok = c.pass;
      return `<tr>
        <td>远端覆盖 <span class="mono tiny dim">${esc(c.cell || "")}</span></td>
        <td class="n">${n1(c.before)} → <b style="color:${ok ? "var(--green)" : "var(--red)"}">${n1(c.after)}</b> m</td>
        <td style="width:34%"><div style="position:relative;height:16px">
            <div style="position:absolute;left:0;top:6px;height:4px;width:${w(c.before)};background:rgba(93,112,143,.6);border-radius:2px"></div>
            <div style="position:absolute;left:0;top:2px;height:4px;width:${w(c.after)};background:${ok ? "var(--green)" : "var(--red)"};border-radius:2px;box-shadow:0 0 8px ${ok ? "var(--green)" : "var(--red)"}"></div>
            <div style="position:absolute;left:${w(c.targetRadius)};top:0;width:2px;height:16px;background:var(--amber)"></div>
          </div></td>
        <td class="n tiny">目标 ${Math.round(c.targetRadius)} m</td>
        <td>${ok ? `<span class="verdict v-hit">通过</span>` : `<span class="verdict v-bad">不满足</span>`}</td>
      </tr>`;
    }
    const ok = c.pass;
    return `<tr>
      <td>重叠指数 <span class="mono tiny dim">${esc(c.neighbor || "")}</span></td>
      <td class="n">${n1(c.before)} → <b style="color:${ok ? "var(--green)" : "var(--red)"}">${n1(c.after)}</b></td>
      <td class="tiny dim">站间距 ${n1(c.distance)} m${c.result ? " · " + esc(c.result) : ""}</td>
      <td colspan="2">${c.result ? `<span class="verdict v-unk">未评估</span>` : ok ? `<span class="verdict v-hit">不增大</span>` : `<span class="verdict v-bad">增大</span>`}</td>
    </tr>`;
  }).join("");
}

/* ── 入口：小区详情＝决策链过程状态 + 执行结果本体图谱 ───────────────────
   七步不再作为左侧固定入口；每一步的推理过程与结果在点开卡片后弹窗看（见 stepBody／stepTrace）。 */
export function renderChain(ctx) {
  if (!ctx) return empty("尚未载入小区。", "请先在小区大屏点一个小区。");
  return `
  <div class="viewhd">
    <h2>决策链执行</h2>
    <span class="sub">AUTONOMOUS CHAIN · ${esc(ctx.cell?.cellName || "")}</span>
    <span class="right"><span class="tiny dim">点任意步骤卡片，看那一步的推理过程与结果</span></span>
  </div>
  ${cellHeader(ctx)}
  <div id="chainHost">${chainBar(ctx)}</div>
  ${panel("执行结果本体图谱", "这次决策链牵出的对象实例与它们之间的本体关系", `
    <div id="lineageHost"></div>
    <div class="note" style="margin-top:9px">实例与关系全部来自后端 <span class="mono">GET /trace/cell</span>；连线标注本体关系号 RT_xx，
      方向写在关系说明里。RT_03（邻区／重叠覆盖）由小区邻区派生、不落库，图中以虚线表示。</div>`)}`;
}

/* 某一步的详情页正文（弹窗里用；不在主视图平铺） */
export function stepBody(n) {
  const ctx = state.ctx;
  if (!ctx) return "";
  return [step1, step2, step3, step4, step5, step6, step7][n - 1](ctx);
}

/* 某一步的推理过程：只在这里（弹窗）完整展示。
   优先用那一步真正执行时记下的全量记录（续跑不会把它冲掉），
   正在执行的那一步则用现场累积的调用记录（边跑边看）。 */
export function stepTrace(n) {
  const st = (state.chain?.steps || []).find(s => s.n === n);
  const live = (state.chainTrace || []).filter(e => e.step === n);
  const running = !!state.chainBusy && Number(state.chainPulse) === n;   // 这一步正在跑：跟着现场记录长
  let rows;
  if (running) rows = live;
  else if (state.stepTraces?.[n]) rows = state.stepTraces[n];
  else if (live.length) rows = live;
  else rows = (st?.trace || []).map(e => ({ ...e, step: n }));
  if (!rows.length) {
    return `<div class="ct-empty">${running ? "正在调用本体……记录会一条条出现在这里。"
      : `这一步还没有调用记录${st?.status === "pending" ? "（尚未执行）" : ""}。`}</div>`;
  }
  return `<div class="ct-log ct-log-full">${rows.map(traceRow).join("")}</div>`;
}
