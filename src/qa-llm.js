// 语义问答层：大模型负责“听懂问题”（意图 + 实体）与“说人话”（自然语言表述），
// 事实一律来自规则引擎 src/qa.js（函数结果、对象、关系、SPEC 定义）——保证每个数值与编号仍可追溯到来源。
// 关闭方式：不配置 LLM_API_KEY 时本层自动退化为纯规则问答（与接入前完全一致）。
//
// 延迟策略（每问 20 秒 → 首字 1 秒级的三个动作）：
//   1. 规则优先路由：规则引擎在本进程里认得出意图，就不再等一次整轮的语义解析调用；
//   2. 真流式：网关吐一句就校验一句、送出一句，不等整段生成完；
//   3. 并列取回：本体外补充段与正文改写并发，谁都不挡正文第一个字。
const { LLMError } = require("./llm.js");
const { buildSupplement } = require("./qa-supplement.js");

// 意图 → 标准问句模板（占位符：{cell} 小区名、{date} 日期、{ids} 本体要素编号、{subject} 工单短名）
// 模板只用于“把理解结果落成规则引擎能识别的问句”，不承担业务判断。
const CANON = {
  "meta.element": { say: "{ids} 是什么", desc: "问某个本体要素（OT_／RT_／F_／A_／INV_／RULE_／TH）的定义" },
  "meta.list": { say: "SPEC 定义了哪些对象类型", desc: "问某一类本体要素的清单（对象类型／关系／函数／动作／约束／规则／测试假设）" },
  "meta.states": { say: "工单有哪些状态", desc: "问某类对象的状态与允许的转移" },
  "scope.out": { say: "SHYAP 的重叠覆盖怎么处理", desc: "问 SPEC 范围外的问题（重叠覆盖、切换差、过覆盖）" },
  "rule.dispatch": { say: "弱覆盖怎么定义，派单规则是什么", desc: "问弱覆盖定义与派单门限（RULE_D01～D04）" },
  "th.params": { say: "测试假设里的容差和单次上限是多少", desc: "问测试假设与参数（容差、单次上限、分辨率等）" },
  radius: { say: "{cell} 的目标覆盖半径默认怎么取", desc: "问目标覆盖半径的取值与缺失时的默认规则（RULE_G01）" },
  provenance: { say: "数据来源清单里哪些是真实数据", desc: "问哪些数据取自工单原文、哪些是构造的" },
  reconcile: { say: "上海真实工单和本体发现结果对账", desc: "把 4 张上海真实工单与本体发现结果对账" },
  scan: { say: "哪些小区弱覆盖", desc: "批量发现：哪些小区达到弱覆盖派单条件（只读）" },
  "discover.cell": { say: "{cell} 为什么判为弱覆盖", desc: "问某个小区的逐日判定过程与命中情况（F_05／F_06）" },
  "mr.day": { say: "{cell} {date} 的 MR 数据", desc: "问某小区某一天的 MR 采样与占比" },
  "cell.info": { say: "{cell} 的基本信息", desc: "问小区的站点、天线、邻区、覆盖区域等静态信息" },
  asof: { say: "{cell} {date} 当时的下倾角", desc: "按某个时点读回当时的工参（历史版本）" },
  "ticket.overview": { say: "{cell} 的工单状态怎么样", desc: "问当前工单的状态、发现依据与进展" },
  "ticket.evidence": { say: "{cell} 工单的发现依据是哪些 MR", desc: "问建单时引用的 MR 证据快照" },
  cause: { say: "{cell} 的根因是哪一类问题", desc: "问根因判定（F_07 假性排除、F_08 下倾角命中）" },
  falseweak: { say: "{cell} 有没有告警造成的假性弱覆盖", desc: "问假性弱覆盖排除（F_07）" },
  plan: { say: "{cell} 的处置方案是什么", desc: "问方案的措施、幅度、轮次与回退条件（F_09／A_04）" },
  impact: { say: "{cell} 方案的周边影响怎么样", desc: "问周边影响评估（F_10）与涉及小区" },
  approval: { say: "{cell} 方案谁来审批", desc: "问审批、派单与角色要求（A_05／INV_05／INV_06）" },
  execution: { say: "{cell} 的执行回填结果怎么样", desc: "问现场执行与回填、实际值与计划值的偏差（A_06）" },
  effect: { say: "{cell} 的效果怎么样", desc: "问效果评估（F_11）：前后窗占比、达标、持续有效" },
  close: { say: "{cell} 能不能关单", desc: "问能否关单与关单条件（A_08／INV_10）" },
  case: { say: "案例库里有哪些案例", desc: "问案例库内容与引用情况" },
  timeline: { say: "{cell} 的动作审计时间线", desc: "问该工单的动作审计与历史记录" },
  flow: { say: "{cell} 已经完成的决策全流程", desc: "问该小区已经走过的决策全流程（按本体要素逐步讲）" },
  todo: { say: "{cell} 下一步该做什么", desc: "问下一步动作与由谁执行" },
  conflict: { say: "有没有工参冲突需要裁定", desc: "问工参来源冲突与裁定（A_11／INV_15）" },
  whatif: { say: "如果{cell}改用电子下倾会怎样", desc: "假设演算（只读，不写库）" },
  stats: { say: "本体里一共有多少工单和小区", desc: "问本体与工单的统计汇总" },
  human: { say: "请帮我确认根因", desc: "用户请求执行只能人工完成的动作（确认／审批／回填／关单／入库／裁定）" },
  "act.bot": { say: "请对{cell}建单", desc: "用户请求优化本体执行自动动作（建单／定因／生成方案／写入效果）" },
  unsupported: { say: "能不能预测{cell}下个月的话务趋势", desc: "SPEC 未定义的措施（功率／方位／挂高／加站）与预测类请求" },
  can: { say: "能不能直接建单", desc: "问某动作此刻能否执行、前提是否满足" },
  compare: { say: "机械下倾和电子下倾有什么区别", desc: "比较机械下倾与电子下倾的适用与影响范围" },
  queue: { say: "有哪些工单要我处理", desc: "按当前角色列出待办工单／方案" },
  arrival: { say: "MR 数据到齐了吗", desc: "问 MR 数据到齐情况与缺哪些日期" },
  "why.rejected": { say: "为什么刚才的动作被拒绝了", desc: "问最近一次动作被拒绝的原因与对应约束" },
  "cause.other": { say: "{cell} 的发射功率有没有问题", desc: "问功率／方位／遮挡等次因线索" },
  confidence: { say: "这个判断有多大把握", desc: "问判断的置信度（SPEC 未定义置信度，需如实说明）" },
  "label.rule": { say: "根因怎么写才算症状级", desc: "问根因症状级标签的写法与规则" },
  "ticket.list": { say: "{cell} 以前出过几次工单", desc: "问该小区历史工单与复发情况" },
  "measure.list": { say: "措施字典里有哪些措施", desc: "问措施类型字典" },
  "case.match": { say: "{cell} 能参考崇明的案例吗", desc: "问某小区能否引用某个案例（适用条件是否匹配）" },
  "reconcile.one": { say: "SHCHM 为什么和本体发现不一致", desc: "单张真实工单与本体发现的差异说明" },
  rollback: { say: "调坏了怎么回退", desc: "问回退条件与回退值" },
  "explain.calc": { say: "推荐下倾是怎么算的", desc: "问计算过程与公式（F_08／F_09）" },
  "antenna.now": { say: "{cell} 现在的下倾角是多少", desc: "问当前生效的机械／电子／总下倾角" },
};

// 会写库的意图：这类只允许执行一次，且问句必须来自模板或用户原句
const WRITE_INTENTS = new Set(["act.bot"]);
// 原句里出现这些词就不再拿原句兜底，避免读意图被误解后误触发写动作
const WRITE_HINT = /建(个|一个|张)?单|定因|生成.{0,6}方案|出.{0,6}方案|评估效果|写入效果|回填|批准|审批|关单|入库|裁定/;

const UNDERSTAND_SYS = `你是通信网络优化（弱覆盖处置）本体工作台的“语义解析器”。任务：把工程师的口语问题解析成结构化指令，只做理解，不做业务判断。
要求：
1. intent 只能从下面清单里选一个；确实无法归类时用 "fallback"。宁可 fallback，也不要硬塞。
2. cell 填清单里最匹配的小区名，原样照抄，不要改写；没有提到就留空。用户说“它／这个小区／刚才那个”时，依据对话上下文判断。
3. dates 只填问题里明确出现或可从“昨天／前天”结合当前时点推算出的日期，格式 YYYY-MM-DD；没有就留空。
4. ids 只填问题里出现在的本体要素编号（OT_／RT_／F_／A_／INV_／RULE_／TH）。
5. 只输出 JSON，不要解释，不要 Markdown：
{"intent":"...","cell":"","dates":[],"ids":[],"reason":"一句话说明你如何理解这个问题"}`;

const NATURAL_SYS = `你是通信网络优化工程师的问答助手，坐在弱覆盖处置本体工作台旁边。用户会给你【问题】【理解】【事实】，你要把事实讲成人话。
硬性规则：
1. 只依据【事实】作答。事实里没有的数字、编号、日期、小区名、工单号一律不得出现；不要估算、不要补常识、不要给趋势预测。
2. 第一句直接回答用户的问题（能答“是／否／具体值”就先给），随后最多 3 句给依据，保留事实里的规则号、函数号、约束号。
3. 用工程师日常说话的口吻，纯文本：不用 Markdown、不用标题和列表符号、不用加粗、不用括号注释；总长不超过 6 句、约 200 字。
4. 事实里如果写了“待人工”的动作，结尾用一句话点明由谁来做；优化本体只能执行建单、规则定因、生成方案、写入效果这几类自动动作。
5. 如果事实表示超出 SPEC 范围、未识别意图或数据缺失（未知≠0），就如实说明边界，并给出 1～2 个可以接着问的方向。
6. 不要复述问题原句，不要写“根据事实”“以上”“希望对你有帮助”这类套话。`;

function clean(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 把整段答案切成"逐句可读"的增量：先按句读断，过长的句子再按次级标点断开。
// 拼回全部增量就是原文本身（不丢字、不改字）。
function chunkText(text, max = 34) {
  const s = String(text || "");
  if (!s) return [];
  const out = [];
  let buf = "";
  const flush = () => { if (buf) out.push(buf); buf = ""; };
  for (const ch of s) {
    buf += ch;
    if ("。！？；\n".includes(ch)) flush();
    else if (buf.length >= max && "，、：,;）)".includes(ch)) flush();
    else if (buf.length >= max * 2) flush();
  }
  flush();
  return out;
}

// 数值与编号落地检查：回答里的每个数字、编号都要能在本次事实来源里找到
function checkGrounded(text, out) {
  let src = String(out.text || "") + " " + (out.refs || []).join(" ");
  try { src += " " + JSON.stringify(out.src === undefined ? null : out.src); } catch { /* 序列化失败就只用文本 */ }
  const nums = [...new Set((String(text).match(/\d+(?:\.\d+)?/g) || []))];
  const ungrounded = nums.filter(n => !src.includes(n));
  // 关键实体：小区名、工单号、计划号、案例号——这些编错了最危险
  const names = [...new Set((String(text).match(/[\u4e00-\u9fa5]{2,}(?:NF|ND|HR)\d{2}H_\d+|\bTK-[A-Z]+-[^\s，。；？、]+?\d{3}\b|\b(?:DP|CL|AR|PL)-[A-Za-z0-9-]+/g) || []))];
  const badNames = names.filter(x => !src.includes(x));
  // 只要出现来源里没有的实体（小区名／单号）就判严重；数字则有 1 处以上、且占比不低时判严重
  const severe = badNames.length > 0 || (ungrounded.length > 0 && ungrounded.length >= Math.max(1, Math.ceil(nums.length * 0.25)));
  return { ok: !ungrounded.length && !badNames.length, ungrounded, badNames, severe };
}

function createLLMQA({ qa, app, llm, opts = {} }) {
  const intents = Array.isArray(qa.H) ? qa.H.map(h => h.name) : Object.keys(CANON);
  const known = new Set(intents);
  const defaultCell = opts.defaultCell || "";
  const defaultDate = opts.defaultDate || "";
  const cells = () => {
    try { return (app && app.store ? app.store.list("OT_CELL") : []).map(c => c.cellName); } catch { return []; }
  };
  const mem = { cell: "", dates: [], ids: [] };   // 会话内上下文：补全“它／刚才那个”

  function describeIntent(name) {
    const c = CANON[name];
    return `${name}：${c ? c.desc : "（无说明）"}`;
  }

  // 意图清单与小区清单在会话内不变，缓存起来，避免每轮重复拼装
  let intentText = "", cellsText = "";
  function understandPrompt(ctx) {
    if (!intentText) intentText = intents.map(describeIntent).join("\n");
    if (!cellsText) cellsText = cells().join("、") || "（未知）";
    const recent = (ctx.history || []).slice(-6).map(h => `${h.role === "user" ? "工程师" : "助手"}：${String(h.content || "").slice(0, 120)}`).join("\n");
    return `${UNDERSTAND_SYS}\n\n【可选意图】\n${intentText}\n\n【可识别的小区】\n${cellsText}\n\n【当前上下文】\n当前时点：${ctx.clock || "未知"}\n当前角色：${ctx.role || "未知"}\n当前工单：${ctx.ticketNo || "无"}\n当前小区：${ctx.cellName || mem.cell || "无"}\n${recent ? "最近对话：\n" + recent : ""}`;
  }

  function normalize(data) {
    const d = data && typeof data === "object" ? data : {};
    const intent = known.has(d.intent) ? d.intent : "fallback";
    const cell = typeof d.cell === "string" ? d.cell.trim().slice(0, 60) : "";
    const dates = (Array.isArray(d.dates) ? d.dates : []).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(String(x))).slice(0, 3);
    const ids = (Array.isArray(d.ids) ? d.ids : []).filter(x => /^(OT_|RT_|F_\d|A_\d|INV_\d|RULE_[A-Z]\d|TH\d)/.test(String(x))).slice(0, 4);
    return { intent, cell, dates, ids, reason: typeof d.reason === "string" ? d.reason.slice(0, 160) : "" };
  }

  function canonical(plan, ctx) {
    const c = CANON[plan.intent];
    if (!c) return "";
    const cell = plan.cell || ctx.cellName || mem.cell || defaultCell;
    const date = (plan.dates && plan.dates[0]) || mem.dates[0] || defaultDate;
    const ids = (plan.ids && plan.ids.length ? plan.ids : mem.ids.length ? mem.ids : []).join(" ");
    let s = c.say;
    if (s.includes("{cell}") && !cell) return "";
    if (s.includes("{date}") && !date) return "";
    if (s.includes("{ids}") && !ids) return "";
    return s.replace(/\{cell\}/g, cell).replace(/\{date\}/g, date).replace(/\{ids\}/g, ids).replace(/\{subject\}/g, plan.subject || "SHCHM");
  }

  function factBlock(out, plan) {
    const lines = [`意图：${out.intent}`, `事实：${out.text}`];
    if (out.refs && out.refs.length) lines.push(`涉及要素：${out.refs.join("、")}`);
    if (out.writes && out.writes.length) lines.push(`本次写入：${out.writes.join("；")}`);
    if (out.pending && out.pending.length) lines.push(`待人工动作：${out.pending.join("、")}`);
    if (out.gap) lines.push(`本体缺口：${out.gap.kind}——${out.gap.boundary || ""}`);
    if (plan) lines.push(`语义理解：${plan.reason || `${plan.intent}`}`);
    if (out.intent === "fallback") lines.push("注意：本次没有识别出明确意图，事实是“超出范围或未识别”的兜底说明。");
    return lines.join("\n");
  }

  function naturalizeMessages(question, out, plan, opts2 = {}) {
    const extra = opts2.retryHint ? `\n\n上一版回答出现了事实里没有的内容：${opts2.retryHint}。请严格只用【事实】里出现过的数字与编号重写。` : "";
    return [
      { role: "system", content: NATURAL_SYS },
      { role: "user", content: `【问题】${question}\n\n【理解】${plan ? plan.reason || plan.intent : "（未解析）"}\n\n【事实】\n${factBlock(out, plan)}${extra}` },
    ];
  }
  // 边收边切句：模型往外吐一点，我们就凑够一句交出去，不等整段生成完。
  // 切点优先句读（。！？；换行），长句再退到次级标点（，、：）；返回已完整的句子与未完成的尾巴。
  const SENT_END = "。！？；\n", CLAUSE_END = "，、：,;）)";
  function splitReady(buf, max = 48) {
    const ready = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i];
      if (SENT_END.includes(ch)) { ready.push(buf.slice(start, i + 1)); start = i + 1; }
      else if (i - start + 1 >= max && CLAUSE_END.includes(ch)) { ready.push(buf.slice(start, i + 1)); start = i + 1; }
    }
    return { ready, rest: buf.slice(start) };
  }

  // 自然化（真流式）：网关的增量一到达就按句切、逐句做落地检查，通过即送出。
  // 安全边界不变——未经检查的句子一个都不往外送；某句出现事实里没有的数值／单号时立刻停手，
  // 由调用方整段重写或回退规则原文（见 askStream）。st 用来在生成器外拿到最终文本与失败原因。
  async function* naturalizeLive(question, out, plan, opts2, st) {
    const msgs = naturalizeMessages(question, out, plan, opts2);
    // 事实已经算好、系统提示也要求 6 句内，够用即可：更小的 max_tokens 直接缩短生成时间
    const opt = { maxTokens: 360, temperature: opts2.retryHint ? 0 : 0.3 };
    async function* raw() {
      if (typeof llm.chatStream === "function") { for await (const d of llm.chatStream(msgs, opt)) yield d; }
      else { const r = await llm.chat(msgs, opt); yield r.content; }
    }
    const take = piece => {
      const t = clean(piece);
      if (!t) return null;
      const g = checkGrounded(t, out);
      return g.ungrounded.length || g.badNames.length ? { bad: g } : { text: t };
    };
    let buf = "";
    for await (const d of raw()) {
      buf += d;
      const cut = splitReady(buf); buf = cut.rest;
      for (const s of cut.ready) {
        const r = take(s);
        if (r && r.bad) { st.bad = r.bad; return; }
        if (r && r.text) { st.text += r.text; st.got = true; if (!st.firstAt) st.firstAt = Date.now(); yield { type: "delta", text: r.text }; }
      }
    }
    if (buf.trim()) {
      const r = take(buf);
      if (r && r.bad) { st.bad = r.bad; return; }
      if (r && r.text) { st.text += r.text; st.got = true; if (!st.firstAt) st.firstAt = Date.now(); yield { type: "delta", text: r.text }; }
    }
  }

  // 主入口（同步版）：把流式结果收成一份完整回答
  async function ask(question, opt = {}) {
    let out = null;
    for await (const ev of askStream(question, opt)) if (ev.type === "done") out = ev.out;
    return out;
  }

  // 流式主入口：产出 meta（阶段／引擎）／refs（依据的本体资源）／delta（增量文本）／done（完整回答）
  async function* askStream(question, opt = {}) {
    const role = opt.role || "", ro = !!opt.readOnly;
    const ctx = { role, history: opt.history || [], clock: opt.clock || "", ticketNo: opt.ticketNo || "", cellName: opt.cellName || "" };
    const t0 = Date.now();
    if (!llm || !llm.enabled) {
      const out = qa.ask(question, { role, readOnly: ro });
      yield { type: "meta", engine: "rule", stage: "answer", intent: out.intent };
      yield { type: "refs", intent: out.intent, refs: out.refs || [] };
      for (const c of chunkText(out.text)) yield { type: "delta", text: c };
      yield { type: "done", out: { ...out, by: "rule", llm: { enabled: false }, ms: Date.now() - t0 } };
      return;
    }

    // ① 先让规则引擎试一次：意图识别就在本进程里（毫秒级），命中就不必再等一次整轮语义解析。
    //    带写操作提示的问句不预跑，避免把还没解析清楚的原句直接执行成动作。
    let plan = null, planError = null, out = null, matched = false, usedQuery = question;
    if (!WRITE_HINT.test(question)) {
      const probe = qa.ask(question, { role, readOnly: ro });
      if (probe.intent !== "fallback") {
        out = probe; matched = true;
        plan = { intent: probe.intent, cell: "", dates: [], ids: [], reason: "规则引擎直接识别（未调语义解析）", routed: "rule" };
        yield { type: "meta", engine: "llm", stage: "facts", intent: probe.intent };
      }
    }

    // ② 规则没接住的口语问法，才交给大模型解析成结构化指令
    if (!out) {
      yield { type: "meta", engine: "llm", stage: "understanding" };
      try {
        const r = await llm.json([
          { role: "system", content: understandPrompt(ctx) },
          { role: "user", content: question },
        ], { maxTokens: 320, temperature: 0 });
        plan = normalize(r.data);
        plan.usage = r.usage; plan.model = r.model; plan.routed = "llm";
      } catch (e) {
        planError = { code: e.code || "ERROR", msg: e.message };
      }

      // ②′ 取事实：问句由模板生成，规则引擎只跑一次
      yield { type: "meta", engine: "llm", stage: "facts", intent: plan ? plan.intent : "fallback" };
      if (plan && plan.intent !== "fallback") {
        const q = canonical(plan, ctx);
        if (q) { out = qa.ask(q, { role, readOnly: ro }); usedQuery = q; matched = out.intent === plan.intent; }
      }
      if (!out) {
        // 模板不可用（缺实体）时的兜底：原句直通规则引擎
        out = qa.ask(question, { role, readOnly: ro });
        usedQuery = question;
      } else if (!matched && plan && !WRITE_INTENTS.has(plan.intent) && !WRITE_HINT.test(question)) {
        // 模板问句没落到期望意图：只在原句明显不含写操作时，再用原句试一次，避免误触发写库
        const r2 = qa.ask(question, { role, readOnly: ro });
        if (r2.intent === plan.intent) { out = r2; usedQuery = question; matched = true; }
      }

      if (plan) {
        if (plan.cell) mem.cell = plan.cell;
        if (plan.dates && plan.dates.length) mem.dates = plan.dates;
        if (plan.ids && plan.ids.length) mem.ids = plan.ids;
      }
    }

    // by 反映"最终这段文字由谁生成"：模型改写成功就是 llm，回退规则原文就是 rule
    const base = {
      ...out,
      by: "rule",
      ms: Date.now() - t0,
      llm: {
        enabled: true, model: (plan && plan.model) || llm.conf.model,
        understood: plan ? { intent: plan.intent, cell: plan.cell, dates: plan.dates, ids: plan.ids, reason: plan.reason, routed: plan.routed } : null,
        planError, query: usedQuery, matched,
      },
    };
    // 依据的本体资源（回答由哪些对象／函数／动作／规则得出）
    yield { type: "refs", intent: out.intent, refs: out.refs || [] };

    // ③ 本体外知识补充：本体自己答不了时（规则层声明了 gap），由大模型补一段通用参考。
    // 补的是独立事件、独立文本，不写库、不并入事实、不参与本体的数值落地检查。
    // 它与正文改写并发取回：谁先好谁先到，谁都不挡第一个字出去。
    let supplement = null;
    const suppPromise = out.gap ? (async () => {
      try {
        const s1 = await buildSupplement({ question, out, ctx, llm, app });
        if (s1 && !s1.ok) {
          // 第一次没过检查：把问题点回给模型重写一次，仍不过就不补
          const again = await buildSupplement({ question, out, ctx, llm, app, opt: { retryHint: s1.issues.join("；") } });
          return again && again.ok ? again : { ...(again || s1), ok: false, text: "" };
        }
        return s1;
      } catch (e) {
        return { ok: false, kind: out.gap.kind, text: "", issues: [], error: { code: e.code || "ERROR", msg: e.message } };
      }
    })() : null;

    // ④ 自然化：模型吐出一点、我们校验一句、送出一句（首字不再等整段生成完）
    yield { type: "meta", engine: "llm", stage: "naturalizing" };
    const st = { text: "", bad: null, got: false };
    try {
      for await (const ev of naturalizeLive(question, out, plan, {}, st)) yield ev;
      if (!st.got && !st.bad) throw new LLMError("EMPTY", "大模型没有返回可用内容");

      if (st.bad) {
        // 某句出现事实里没有的数值／单号：立刻停手。整段重写一次；仍不过就回退规则原文。
        // 重写结果先收齐再以 replace 帧整段替换，避免把两版文字拼在一起。
        const hint = [...st.bad.badNames, ...st.bad.ungrounded].slice(0, 6).join("、");
        const st2 = { text: "", bad: null, got: false };
        for await (const _ of naturalizeLive(question, out, plan, { retryHint: hint }, st2)) { /* 只收不送 */ }
        supplement = suppPromise ? await suppPromise : null;
        if (st2.bad || !st2.got) {
          yield { type: "replace", text: base.text };
          yield { type: "done", out: { ...base, by: "rule", supplement, llm: { ...base.llm, groundedRetry: true, ungrounded: st.bad.ungrounded, badNames: st.bad.badNames } } };
          return;
        }
        yield { type: "replace", text: st2.text };
        const sup2 = supplement && supplement.ok ? supplement : null;
        if (sup2) yield { type: "supplement", supplement: sup2 };
        yield { type: "done", out: { ...base, text: st2.text, by: "llm", grounded: { ok: true, ungrounded: [] }, supplement: supplement || null, llm: { ...base.llm, naturalized: true, revised: true, ttftMs: st.firstAt ? st.firstAt - t0 : null } } };
        return;
      }

      supplement = suppPromise ? await suppPromise : null;
      const sup = supplement && supplement.ok ? supplement : null;
      if (sup) yield { type: "supplement", supplement: sup };
      yield {
        type: "done",
        out: {
          ...base,
          text: st.text,
          by: "llm",
          grounded: { ok: true, ungrounded: [] },
          supplement: supplement || null,
          llm: { ...base.llm, naturalized: true, ttftMs: st.firstAt ? st.firstAt - t0 : null },
        },
      };
    } catch (e) {
      // 自然化失败：仍返回规则原文，前端标注"模型不可用"
      supplement = suppPromise ? await suppPromise : null;
      if (st.got) yield { type: "replace", text: base.text };
      else for (const c of chunkText(base.text)) yield { type: "delta", text: c };
      yield { type: "done", out: { ...base, by: "rule", supplement, llm: { ...base.llm, error: { code: e.code || "ERROR", msg: e.message } } } };
    }
  }

  return { ask, askStream, enabled: !!llm && llm.enabled, describe: () => (llm ? llm.describe() : { enabled: false }), CANON, intents };
}

module.exports = { createLLMQA, CANON, checkGrounded, clean, chunkText };
