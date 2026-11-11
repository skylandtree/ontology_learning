// 自主决策链（应用层，规范外）：把一个小区从「发现与判定」推进到「闭环与案例」。
// 默认一次跑满七步；传 opt.until＝1～7 时只执行到第 until 步（outcome=partial、nextStep），
// 供前端一步一调、一步一显。按步执行不改变任何判定：续跑走的是同一套幂等路径，最终结果与一次跑满一致。
//
// 链的规矩（与本体其它部分一致）：
//   · 每一步都走本体自己的动作入口（app.act）：角色校验、INV 约束、审计留痕一律照旧，链不绕过任何一条；
//   · 必填参数从本体事实里推导（工单的诊断记录、方案的影响范围、现场回填记录、区域属性），链不自己发明数值；
//   · 走到本体走不动的地方就停在那一步：规则缺口、证据不足、缺人工回报、周边影响不通过、持续有效不成立……
//     停下来时写清是哪一步、哪条约束、缺什么；不硬推、不编数据。
//   · 链是幂等的：已建单的不重复建单，已走通的链路重跑只复述结果，不重复写记录。
//
// 治理边界（SPEC §"自动与人工边界"）：
//   可自动：F_12 发现、A_01 建单、A_02 规则命中的根因写入、A_07 写入优化效果；
//   须人工确认：A_03 确认／排除、A_05 确认并派单、A_08 关闭、A_09 入库；
//   天馈类措施（含机械下倾）一律派给现场维护人员执行，不由本链自动执行（INV_05）。
// 本链以「委托执行」的方式走完须人工确认的步骤：动作仍按本体动作表校验角色与参数，
// 审计里记录执行身份与委托角色，报告里标 humanGate——复核者一眼能看出哪几步是委托来的。
const { addDays, day, idOf } = require("./facts.js");

// 七步与前端 cellflow.js 的 STEPS 一致（SPEC 5.3 视图↔接口对照表）
const STEP_DEFS = [
  { n: 1, id: "s1", name: "发现与判定", en: "DISCOVERY" },
  { n: 2, id: "s2", name: "工单与定因", en: "DIAGNOSIS" },
  { n: 3, id: "s3", name: "优化方案", en: "PLAN" },
  { n: 4, id: "s4", name: "确认派单", en: "APPROVAL" },
  { n: 5, id: "s5", name: "实施回填", en: "EXECUTION" },
  { n: 6, id: "s6", name: "效果核验", en: "EFFECT" },
  { n: 7, id: "s7", name: "闭环与案例", en: "CLOSURE" },
];

// 本链在每一步用的身份：角色取本体动作表的允许角色，humanGate 标出 SPEC 要求人工确认的步骤。
const PLAN = {
  A_01: { role: "优化本体", humanGate: false, why: "SPEC 自动边界：可自动建单" },
  A_02: { role: "优化本体", humanGate: false, why: "SPEC 自动边界：规则命中的根因写入可自动（须有证据）" },
  A_03: { role: "地市优化工程师", humanGate: true, why: "SPEC：须人工确认确认／排除；本链委托该角色执行" },
  A_04: { role: "优化本体", humanGate: false, why: "本体动作表：只有优化本体可生成方案" },
  A_05: { role: "地市优化工程师", humanGate: true, why: "SPEC：须人工确认并派单；天馈类派给现场维护人员（INV_05）" },
  A_06: { role: "现场维护人员", humanGate: false, why: "现场执行并回报实际值（INV_07 不得用计划值代替）" },
  A_07: { role: "优化本体", humanGate: false, why: "SPEC 自动边界：可自动写入优化效果" },
  A_08: { role: "优化主管", humanGate: true, why: "SPEC：须人工确认关闭" },
  A_09: { role: "优化专家", humanGate: true, why: "SPEC：须人工确认案例入库" },
};

const ACTOR_NAME = "自主决策体";
// 停因只有两类（其余是终态）：
//   · cannot-infer     本体推不出结论——缺一条本体事实、证据不足、两来源冲突不能裁决、模型不成立；
//   · expectation-unmet 本体推出来了，但结论不满足期望——周边影响不通过、持续有效不成立。
// 每个执行中的停点都要答得出：期望的是什么、缺口是什么（推不出时）、谁去补。
const STOP_CAUSE = {
  INV_07: { cause: "cannot-infer", expected: "F_11 能判定效果「达标且持续有效」", gap: "F_11 的前提：现场实际值" },
  INV_08: { cause: "cannot-infer", expected: "能确认现场已实施（回执）", gap: "现场回执" },
  INV_09: { cause: "cannot-infer", expected: "证据足够判定（F_06）", gap: "必要的 MR 日统计／适用规则" },
  INV_15: { cause: "cannot-infer", expected: "同一生效区间只有一个可信的工参取值", gap: "工参来源冲突的裁定" },
  NOT_MATCHED: { cause: "cannot-infer", expected: "F_08 命中可执行的下倾模型", gap: "适用的原因模型／模型输入" },
  INV_06: { cause: "expectation-unmet", expected: "F_10 周边影响为「通过／调减」", gap: null },
  INV_10: { cause: "expectation-unmet", expected: "F_11 持续有效为「是」", gap: null },
  REVIEW_REQUIRED: { cause: "human-gate", expected: "人工确认这一动作", gap: null },
  INV_04: { cause: "terminal", expected: null, gap: null },
  INV_16: { cause: "terminal", expected: null, gap: null },
  STATE: { cause: "terminal", expected: null, gap: null }
};
// 走到本体走不动、但人工处理后可以接着走的停点：写清要谁、补什么、补完从哪继续。
// 只登记“缺的是人手里的那一条事实／那一个决定”的情形；规则缺口、未达条件、已排除等终态不在此列，
// 链不会暗示“再等等就能过”。
const HUMAN_STOPS = {
  INV_07: {
    role: "现场维护人员",
    what: "回报现场实测值（现场回填记录）",
    then: "回报后从第 5 步继续，进效果核验与闭环",
    action: "field-report"
  },
  INV_15: {
    role: "地市优化工程师",
    what: "裁定天线工参冲突（A_11 裁定工参冲突）",
    then: "裁定后重新执行，从冲突所在步骤继续",
    action: "resolve-fact-conflict"
  },
  REVIEW_REQUIRED: {
    role: "动作表允许的角色",
    what: "在本页人工确认",
    then: "确认后重新执行，从该步继续",
    action: null
  }
};
const pct = v => (v === null || v === undefined ? "—" : (v * 100).toFixed(2) + "%");
const n2 = v => (typeof v === "number" ? v.toFixed(2) : "—");

function createChain(app) {
  const { store: S, facts, svc, F, ont } = app;

  /* ── 读当前状态：这个小区已经走到哪儿了 ───────────────────────────── */
  const ticketsOf = cellKey => S.links({ rt: "RT_05", to: "OT_CELL:" + cellKey })
    .map(l => S.doc("OT_TICKET", idOf(l.from))).filter(Boolean)
    .sort((a, b) => String(a.ticketNo).localeCompare(String(b.ticketNo)));
  const ticketOf = cellKey => {
    const ts = ticketsOf(cellKey);
    return ts.filter(t => t.status !== "已关闭").pop() || ts.pop() || null;
  };
  const planOf = t => {
    if (!t) return null;
    const ps = S.links({ rt: "RT_09", to: "OT_TICKET:" + t.ticketNo })
      .map(l => S.doc("OT_PLAN", idOf(l.from))).filter(Boolean).sort((a, b) => a.round - b.round);
    return ps.pop() || null;
  };
  const effectOf = p => {
    if (!p) return null;
    // RT_11 的方向是 效果→方案（effect→plan），所以按终点找方案的效果
    const es = S.links({ rt: "RT_11", to: "OT_PLAN:" + p.planNo })
      .map(l => S.doc("OT_EFFECT", idOf(l.from))).filter(Boolean)
      .sort((a, b) => String(a.effectNo).localeCompare(String(b.effectNo)));
    return es.pop() || null;
  };
  const caseOf = e => {
    if (!e) return null;
    const cs = S.links({ rt: "RT_14", from: "OT_EFFECT:" + e.effectNo }).map(l => S.doc("OT_CASE", idOf(l.to))).filter(Boolean);
    return cs[0] || null;
  };
  const areaOf = cellKey => {
    const ls = S.links({ rt: "RT_04", from: "OT_CELL:" + cellKey });
    const l = ls.find(x => x.props.role === "主服务") || ls[0];
    return l ? S.doc("OT_AREA", idOf(l.to)) : null;
  };

  /* ── A_03 的复核判断：从工单自己的诊断记录里推出来 ─────────────────── */
  function deriveReason(t) {
    const d = t.diagnostics || [];
    const last = kind => [...d].reverse().find(x => x.kind === kind)?.result;
    const fw = last("假性弱覆盖"), f8 = last("下倾角命中");
    const cause = (t.rootCauses || []).find(r => r.role === "主因");
    const sub = (t.rootCauses || []).find(r => r.role === "次因");
    const parts = [];
    if (fw?.verdict === "部分重合") parts.push(`F_07＝部分重合（重合 ${fw.overlap}/${fw.weakCount} 天，占比 ${pct(fw.share)}）`);
    if (f8?.match) parts.push(`F_08＝${f8.match}${typeof f8.deficit === "number" ? `（缺口 ${n2(f8.deficit)}°）` : ""}`);
    if (sub) parts.push(`次因同时命中：${sub.causeLabel}`);
    if (!parts.length) return cause ? `主因：${cause.causeLabel}` : "";
    return parts.join("；") + (cause ? `；裁决主因：${cause.causeLabel}` : "；裁决：主因成立");
  }

  /* ── 选型策略：两种方式各算一遍本体函数，先通过者优先；都通过时选机械 ──
     机械下倾是天馈类主线（执行方＝现场维护人员，现场回填记录记的就是机械下倾）；
     电子下倾本次不对接参数平台（SPEC §实现范围）。都不通过时仍用机械——
     让方案按本体规定停在草案并转人工，而不是换一个方式硬凑一个"通过"。 */
  function chooseAdjustType(cellKey, asOf) {
    const f8 = svc.matchTilt(cellKey, asOf);
    if (f8.match !== "命中") return { adj: "机械", f8, candidates: [], reason: `F_08＝${f8.match}：${f8.reason || f8.role || "不生成下倾方案"}` };
    const cands = [];
    for (const adj of ["机械", "电子"]) {
      if (adj === "电子" && !f8.inputs.supportsRET) continue;                 // A_04：电子下倾要求天线支持电调
      const f9 = F.F09(f8._deficit, adj);
      if (!f9.executable) continue;
      const f10 = svc.impact(cellKey, adj, f9.delta, asOf);
      cands.push({ adj, delta: f9.delta, rounds: f9.rounds, impact: f10.result, deltaFinal: f10.deltaFinal, ok: ["通过", "调减"].includes(f10.result) });
    }
    const pass = cands.filter(c => c.ok);
    const pick = pass.find(c => c.adj === "机械") || pass[0] || cands.find(c => c.adj === "机械") || cands[0];
    return { adj: pick ? pick.adj : "机械", f8, candidates: cands, reason: pick ? `F_09／F_10 比选：${cands.map(c => `${c.adj}＝${c.impact}`).join("，")}，选 ${pick.adj}` : "无候选方式" };
  }

  /* ── 效果评估时点：后窗要满 max(派单规则窗口天数, effectMinDaysAfter) 天；
     持续有效还要满 effectSustainDays 天；MR 次日凌晨才入库，所以再留一天。 ── */
  function evalTimes(ticket, plan) {
    const ex = plan?.execution?.executeTime;
    if (!ex) return null;
    const rule = ont.raw.dispatchRules.find(r => r.ruleId === ticket.discovery?.ruleId);
    const winDays = Math.max(Number(ont.param("effectMinDaysAfter")), Number(rule?.windowDays || 0));
    const susDays = Number(ont.param("effectSustainDays"));
    const base = Date.parse(day(ex) + "T00:00:00Z");
    if (!Number.isFinite(base)) return null;
    const at = n => new Date(base + (n + 1) * 86400000).toISOString().slice(0, 10) + "T09:00:00";
    return { evalAt: at(winDays), sustainAt: at(susDays), winDays, susDays };
  }

  /* ── 主流程 ────────────────────────────────────────────────────────── */
  // 入口：跑链的全程挂一个旁听钩子（tracker.tap），把这一次真正调用到的函数／动作／约束／规则
  // 按顺序记进对应步骤的 trace；无论从哪条路径退出，钩子都在这里摘掉。
  function runChain(cellKey, opt = {}) {
    try { return runChainInner(cellKey, opt); }
    finally { if (app.tracker) app.tracker.tap = null; }
  }

  function runChainInner(cellKey, opt = {}) {
    const cell = facts.cell(cellKey);
    if (!cell) { const e = new Error(`小区 ${cellKey} 不存在`); e.code = "OBJECT_NOT_FOUND"; throw e; }
    // 委托执行：SPEC 要求人工确认的步骤（A_03／A_05／A_08／A_09），本链默认以本体动作表允许的
    // 角色代为执行，报告里标 humanGate、审计里记录委托角色；opt.delegate=false 时停在该步等人。
    const delegate = opt.delegate !== false;
    // 按步执行：opt.until＝本次最多执行到第几步（1～7）。前端据此一步一调、一步一显，
    // 每步的结果就是这一次调用的真实结果；不传则一次跑满七步（原行为不变）。
    const until = Math.min(7, Math.max(1, Number(opt.until) || 7));
    const now0 = S.peekNow();
    const report = {
      cellKey, cellName: cell.cellName || cellKey, rat: cell.rat, band: cell.band, sceneLevel: cell.sceneLevel,
      startedAt: now0, finishedAt: now0,
      delegate, until,
      clock: { from: now0, to: now0, jumps: [] },
      outcome: "stopped", stop: null, partial: false, nextStep: null, summary: "",
      artifacts: {}, steps: []
    };
    const st = STEP_DEFS.map(d => ({ ...d, status: "pending", actions: [], detail: {}, note: "", trace: [] }));
    const step = n => st[n - 1];
    // 推理过程：按顺序记下每一步真正调用到的本体要素（函数／动作／约束／规则／测试假设），
    // 以及判断时点推进这类事实。前端只按顺序摆出来，不解释、不补写。
    let curStep = 1;
    // 同一步里同一个要素通过一次就只记一行（否则一次写对象会把 INV_11／INV_17 刷几十遍）；
    // 校验被拒（violation）每次都记，动作与计算（A／F／CLOCK／SRC）也不合并（同一动作可能执行多轮）。
    const DEDUPE = { INV: 1, RULE: 1, TH: 1, OT: 1, RT: 1 };
    const seen = new Map();
    const pushTrace = (n, e) => {
      const s = step(n); if (!s) return;
      if (s.trace.length >= 80) return;
      const st0 = e.status || "ok", key = `${n}|${e.kind}|${e.id}|${st0}`;
      if (DEDUPE[e.kind] && st0 !== "violation") {
        if (seen.has(key)) return;
        seen.set(key, 1);
      }
      s.trace.push({ seq: s.trace.length + 1, kind: e.kind, id: e.id, status: st0, note: e.note || null, at: S.peekNow() });
    };
    // 动作调用的结果摘要（只取返回值里的事实，不做推断）
    const actNote = (code, r) => {
      if (!r.ok) return null;
      const v = r.result || {};
      switch (code) {
        case "A_01": return v.deduped ? `已有工单 ${v.ticketNo}，已关联（INV_14）` : `建单 ${v.ticketNo}`;
        case "A_02": return v.written ? `第 ${v.round} 轮写入根因` : `未写根因（F_07＝${v.f07 || "—"}，F_08＝${v.f08 || "—"}）`;
        case "A_03": return `工单 ${v.status || ""}`;
        case "A_04": return `方案 ${v.planNo}（Δ=${v.delta}°，${v.rounds} 轮，周边影响 ${v.impact}）`;
        case "A_05": return `派单 ${v.dispatchNo || ""}`;
        case "A_06": {
          const av = (v.actualValues || [])[0];
          if (v.receipt === "未知" || v.receipt === "失败") return `回执 ${v.receipt}`;
          return `${v.status || "已实施"}${av ? `：${av.param} ${av.value}°（计划 ${av.planValue}°）` : ""}${v.recheck ? `，事后复核 ${v.recheck}` : ""}`;
        }
        case "A_07": return `效果 ${v.effectNo || ""}（${v.status || ""}）`;
        case "A_08": return `工单 ${v.status || ""}`;
        case "A_09": return `案例 ${v.caseNo || ""}（${v.outcome || ""}）`;
        default: return null;
      }
    };
    const act = (code, input, n) => {
      const p = PLAN[code];
      if (p.humanGate && !delegate) {
        step(n).actions.push({ code, role: p.role, humanGate: true, why: p.why, outcome: "awaiting", errorCode: "REVIEW_REQUIRED", msg: `${code} 须人工确认` });
        pushTrace(n, { kind: "A", id: code, status: "awaiting", note: "须人工确认，链不代为执行" });
        stop(n, "REVIEW_REQUIRED", `${code} 须人工确认（SPEC 自动与人工边界）：本链不代为执行，等人工在本页确认`);
        return { ok: false, code: "REVIEW_REQUIRED", msg: `${code} 须人工确认` };
      }
      const r = app.act(code, input, { role: p.role, name: ACTOR_NAME });
      step(n).actions.push({
        code, role: p.role, humanGate: p.humanGate, why: p.why,
        outcome: r.ok ? "ok" : "rejected", errorCode: r.ok ? null : r.code, msg: r.ok ? null : r.msg,
        result: r.ok ? r.result : null
      });
      pushTrace(n, { kind: "A", id: code, status: r.ok ? "ok" : "violation", note: r.ok ? actNote(code, r) : `${r.code}：${r.msg}` });
      return r;
    };
    const advance = (iso, why) => {
      if (!iso) return;
      const cur = S.peekNow();
      if (iso <= cur) return;
      app.at(iso);
      report.clock.jumps.push({ from: cur, to: iso, why });
      report.clock.to = iso;
      pushTrace(curStep, { kind: "CLOCK", id: iso, note: why });
    };
    // 旁听钩子：只收校验（INV，带通过／违反）、规则（RULE）与测试假设（TH）；
    // 函数与动作由链自己记（带结果），对象与关系的每一次读写太碎，不摊到推理过程里。
    if (app.tracker) {
      app.tracker.tap = (kind, id, detail) => {
        if (kind !== "INV" && kind !== "RULE" && kind !== "TH") return;
        pushTrace(curStep, { kind, id, status: detail === "violation" ? "violation" : "ok", note: detail === "violation" ? "约束拒绝" : null });
      };
    }
    const stop = (n, code, reason) => {
      const s = step(n);
      if (s.status === "blocked") {                       // 已被更具体的理由挡下：不覆盖
        if (code && !s.code) s.code = code;
        return;
      }
      s.status = "blocked";
      s.note = reason;
      s.code = code || null;
      // basis＝这条约束在本体里的原文（为什么停）；expected＝这一步期望得到什么；
      // gap＝推不出时缺的是哪条事实；human＝人工接入的点（要谁、补什么、补完怎么继续）。
      // 前端只照这几项摆出来，不自己解释，也不替链把“缺什么”翻译成别的话。
      const invDef = code && String(code).startsWith("INV_") ? ont.inv(code) : null;
      const cc = (code && STOP_CAUSE[code]) || { cause: "terminal", expected: null, gap: null };
      // INV_06 有两种停法：周边影响“不通过”＝推出来了但不满足期望；“未评估”＝干脆推不出来。
      const unevaluated = code === "INV_06" && /未评估/.test(reason);
      report.stop = {
        step: n, id: s.id, name: s.name, code: code || null, reason,
        cause: code === "INV_06" ? (unevaluated ? "cannot-infer" : "expectation-unmet") : cc.cause,
        expected: unevaluated ? "F_10 能算出周边影响（通过／调减）" : cc.expected,
        gap: unevaluated ? "F_10 的评估输入（邻区工参／距离）" : cc.gap,
        basis: invDef ? invDef.text : null,
        human: (code && HUMAN_STOPS[code]) || null
      };
      for (let i = n + 1; i <= 7; i++) if (st[i - 1].status === "pending") { st[i - 1].status = "skipped"; st[i - 1].note = "上游未走通，本步未执行"; }
    };
    const skip = (n, note) => { step(n).status = "skipped"; step(n).note = note; };
    // 按步执行的边界：本次只执行到 until，剩下的留 pending（"未开始"），由下一次调用接着走。
    const partial = next => {
      report.partial = true;
      report.nextStep = next;
      for (let i = next; i <= 7; i++) if (st[i - 1].status === "pending") st[i - 1].note = "尚未执行（按步执行）";
      finish();
    };
    const gate = n => { if (n <= until) return false; partial(n); return true; };

    /* ① 发现与判定 -------------------------------------------------- */
    curStep = 1;
    const scanRes = svc.scan([cellKey], S.peekNow()), scan = scanRes.items[0] || {}, win = scanRes.window || {};
    let ticket = ticketOf(cellKey);
    step(1).detail = {
      verdict: scan.verdict, hitDays: scan.hitDays, ruleId: scan.ruleId || null,
      window: win.from ? win : null, note: scan.note || scan.reason || null
    };
    pushTrace(1, { kind: "F", id: "F_12", note: `批量发现：判定「${scan.verdict || "证据不足"}」${scan.ruleId ? ` · ${scan.ruleId}` : " · 无适用规则"}${scan.hitDays !== undefined ? ` · 命中 ${scan.hitDays}/${win.days ?? "?"} 天` : ""}${scan.note ? ` · ${scan.note}` : ""}` });
    pushTrace(1, { kind: "OT", id: "OT_CELL_MR", note: `窗口 ${win.from || "—"}~${win.to || "—"} 的 ${(scan.evidenceRefs || []).length} 条 MR 日统计作为证据（RT_17）` });
    if (ticket) {
      step(1).note = `该小区已有工单 ${ticket.ticketNo}（${ticket.status}），不再重复建单（INV_14）`;
    } else if (scan.verdict !== "达到派单条件") {
      stop(1, scan.verdict === "证据不足" ? "INV_09" : "INV_16",
        `判定「${scan.verdict}」：${scan.note || scan.reason || "不满足建单条件"}，不建单`);
    } else {
      const r = act("A_01", { cellKey, refTime: S.peekNow() }, 1);
      if (!r.ok) stop(1, r.code, `A_01 建单被拒：${r.msg}`);
      else {
        ticket = S.doc("OT_TICKET", r.result.ticketNo);
        step(1).note = `按 ${scan.ruleId} 建单 ${ticket.ticketNo}（${ticket.status}）`;
      }
    }
    if (!ticket) { finish(); return report; }
    step(1).status = "done";
    report.artifacts.ticketNo = ticket.ticketNo;

    /* 幂等：这条链此前已跑完（工单已关闭）——复述结果，不重复写记录 */
    if (ticket.status === "已关闭") {
      const pl = planOf(ticket), ef = effectOf(pl), cs = caseOf(ef);
      step(2).status = "done";
      step(2).note = `工单 ${ticket.ticketNo} 已闭环（${ticket.status}），本次不重复执行`;
      step(2).detail = { ticketStatus: ticket.status };
      if (pl) {
        step(3).status = "done";
        step(3).note = `方案 ${pl.planNo}（${pl.status}）`;
        step(3).detail = { planNo: pl.planNo, status: pl.status, impact: pl.impact?.result || null, delta: pl.actions?.[0]?.deltaValue ?? null };
        step(4).status = "done";
        step(4).note = `已派单 ${pl.execution?.dispatchNo || "—"}（执行方 ${pl.execution?.executor || "—"}）`;
        step(4).detail = { dispatchNo: pl.execution?.dispatchNo || null, executor: pl.execution?.executor || null };
        step(5).status = "done";
        step(5).note = `已实施（回执 ${pl.execution?.receipt || "—"}）`;
        step(5).detail = { receipt: pl.execution?.receipt || null, executeTime: pl.execution?.executeTime || null };
      } else {
        for (const n of [3, 4, 5]) skip(n, "该工单没有方案记录");
      }
      if (ef) {
        step(6).status = "done";
        step(6).note = `${ef.status}（改善 ${ef.improved ? "是" : "否"}／持续有效 ${ef.sustained ? "是" : "否"}）`;
        step(6).detail = { effectNo: ef.effectNo, status: ef.status, beforeRatio: ef.beforeRatio, afterRatio: ef.afterRatio, sustained: ef.sustained, daysAfter: ef.afterWindow?.days ?? null };
        report.artifacts.effectNo = ef.effectNo;
      } else {
        skip(6, "该工单没有效果记录");
      }
      step(7).status = "done";
      step(7).note = cs ? `工单已关闭；案例 ${cs.caseNo} 已入库（${cs.outcome}）` : "工单已关闭";
      step(7).detail = { ticketStatus: ticket.status, caseNo: cs?.caseNo || null, outcome: cs?.outcome || null };
      report.artifacts.planNo = pl?.planNo || null;
      report.artifacts.dispatchNo = pl?.execution?.dispatchNo || null;
      report.artifacts.caseNo = cs?.caseNo || null;
      report.artifacts.caseOutcome = cs?.outcome || null;
      report.summary = `该小区的决策链已执行完毕（工单 ${ticket.ticketNo} 已关闭${cs ? "，案例 " + cs.caseNo + " 已入库" : ""}），本次只复述结果`;
      finish(); return report;
    }

    if (gate(2)) return report;

    /* ② 工单与定因 -------------------------------------------------- */
    curStep = 2;
    if (ticket.status === "已排除") {
      step(2).status = "done";
      step(2).note = "假性弱覆盖（F_07＝排除），工单已排除，不再进入处置";
      step(2).detail = { ticketStatus: ticket.status };
      for (let i = 3; i <= 7; i++) skip(i, "工单已排除，无处置链路");
      report.stop = { step: 2, id: "s2", name: "工单与定因", code: null, reason: "假性弱覆盖（F_07＝排除），工单已排除，无处置链路" };
      finish(); return report;
    }
    if (ticket.status === "待核验") {
      // 续跑语义：主因已写就只确认；F_08 已判过就按已有诊断复述——重跑不重复写记录
      const diagOf = kind => [...(ticket.diagnostics || [])].reverse().find(x => x.kind === kind)?.result;
      const hasCause = (ticket.rootCauses || []).length > 0;
      const fw0 = diagOf("假性弱覆盖"), f80 = diagOf("下倾角命中");
      if (fw0) pushTrace(2, { kind: "F", id: "F_07", note: `假性弱覆盖：${fw0.verdict}${typeof fw0.share === "number" ? `（重合占比 ${pct(fw0.share)}）` : ""}` });
      if (f80) pushTrace(2, { kind: "F", id: "F_08", note: `下倾角：${f80.match}${typeof f80.deficit === "number" ? `（缺口 ${n2(f80.deficit)}°）` : ""}` });
      if (hasCause) {
        const rc0 = (ticket.rootCauses || []).find(r => r.role === "主因");
        const a3 = act("A_03", { ticketNo: ticket.ticketNo, decision: "确认", reason: deriveReason(ticket) }, 2);
        ticket = S.doc("OT_TICKET", ticket.ticketNo);
        if (!a3.ok) stop(2, a3.code, `A_03 确认被拒：${a3.msg}`);
        else {
          step(2).note = `主因「${rc0?.causeLabel || "—"}」已写入并确认（本次不重复写根因）`;
          step(2).detail = { f07: fw0?.verdict || null, f08: f80?.match || null, rootCause: rc0?.causeLabel || null, causeFamily: rc0?.causeFamily || null, ticketStatus: ticket.status };
        }
      } else if (f80 || fw0?.verdict === "排除") {
        // 已经判过 F_07／F_08 却没有主因：按已有诊断给出同一个结论，不再追加一条诊断记录
        step(2).detail = { f07: fw0?.verdict || null, f08: f80?.match || null };
        if (fw0?.verdict === "排除") {
          const a3 = act("A_03", { ticketNo: ticket.ticketNo, decision: "排除", reason: deriveReason(ticket) }, 2);
          ticket = S.doc("OT_TICKET", ticket.ticketNo);
          step(2).status = "done";
          step(2).note = a3.ok ? "假性弱覆盖（F_07＝排除），已排除该工单" : `A_03 排除被拒：${a3.msg}`;
          for (let i = 3; i <= 7; i++) skip(i, "工单已排除，无处置链路");
          report.stop = { step: 2, id: "s2", name: "工单与定因", code: null, reason: "假性弱覆盖（F_07＝排除），工单已排除，无处置链路" };
          finish(); return report;
        }
        stop(2, "NOT_MATCHED", `规则定因不成立（F_08＝${f80?.match || "未知"}）：${f80?.reason || "转其他原因族，转人工"}`);
      } else {
        const a2 = act("A_02", { ticketNo: ticket.ticketNo, mode: "rule" }, 2);
        ticket = S.doc("OT_TICKET", ticket.ticketNo);
        const d = ticket.diagnostics || [];
        const fw = [...d].reverse().find(x => x.kind === "假性弱覆盖")?.result;
        const f8 = [...d].reverse().find(x => x.kind === "下倾角命中")?.result;
        step(2).detail = { f07: fw?.verdict || null, f08: f8?.match || null };
        if (fw) pushTrace(2, { kind: "F", id: "F_07", note: `假性弱覆盖：${fw.verdict}${typeof fw.share === "number" ? `（重合占比 ${pct(fw.share)}）` : ""}（A_02 内部计算）` });
        if (f8) pushTrace(2, { kind: "F", id: "F_08", note: `下倾角：${f8.match}${typeof f8.deficit === "number" ? `（缺口 ${n2(f8.deficit)}°）` : ""}（A_02 内部计算）` });
        if (!a2.ok) stop(2, a2.code, `A_02 定因被拒：${a2.msg}`);
        else if (!a2.result.written && a2.result.f07 === "排除") {
          const a3 = act("A_03", { ticketNo: ticket.ticketNo, decision: "排除", reason: deriveReason(ticket) }, 2);
          ticket = S.doc("OT_TICKET", ticket.ticketNo);
          step(2).status = "done";
          step(2).detail = { ...step(2).detail, ticketStatus: ticket.status };
          step(2).note = a3.ok ? "假性弱覆盖（F_07＝排除），已排除该工单" : `A_03 排除被拒：${a3.msg}`;
          for (let i = 3; i <= 7; i++) skip(i, "工单已排除，无处置链路");
          report.stop = { step: 2, id: "s2", name: "工单与定因", code: null, reason: "假性弱覆盖（F_07＝排除），工单已排除，无处置链路" };
          finish(); return report;
        } else if (!a2.result.written) {
          stop(2, "NOT_MATCHED", `规则定因不成立（F_08＝${a2.result.f08 || "未知"}）：${a2.result.reason || "转其他原因族，转人工"}`);
        } else {
          const reason = deriveReason(ticket);
          const a3 = act("A_03", { ticketNo: ticket.ticketNo, decision: "确认", reason }, 2);
          ticket = S.doc("OT_TICKET", ticket.ticketNo);
          if (!a3.ok) stop(2, a3.code, `A_03 确认被拒：${a3.msg}`);
          else {
            const rc = (ticket.rootCauses || []).find(r => r.role === "主因");
            step(2).note = `主因「${rc?.causeLabel || "—"}」已写入并确认`;
            step(2).detail = { ...step(2).detail, rootCause: rc?.causeLabel || null, causeFamily: rc?.causeFamily || null, ticketStatus: ticket.status };
          }
        }
      }
    } else {
      step(2).status = "done";
      step(2).note = `工单已定因（${ticket.status}），本次不重复定因`;
      const rc = (ticket.rootCauses || []).find(r => r.role === "主因");
      step(2).detail = { ticketStatus: ticket.status, rootCause: rc?.causeLabel || null, causeFamily: rc?.causeFamily || null };
    }
    if (report.stop) { finish(); return report; }
    step(2).status = "done";
    if (gate(3)) return report;

    /* ③ 优化方案 -------------------------------------------------- */
    curStep = 3;
    let plan = planOf(ticket);
    if (plan) {
      step(3).status = "done";
      step(3).note = `已有方案 ${plan.planNo}（${plan.status}），本次不重复生成`;
      step(3).detail = { planNo: plan.planNo, status: plan.status, impact: plan.impact?.result || null, delta: plan.actions?.[0]?.deltaValue ?? null };
    } else if (!["已确认", "改善未解决"].includes(ticket.status)) {
      stop(3, "INV_04", `工单状态「${ticket.status}」，不能生成方案（INV_04）`);
    } else {
      const pick = chooseAdjustType(cellKey, S.peekNow());
      const pc = pick.candidates.find(c => c.adj === pick.adj) || {};
      step(3).detail = { candidates: pick.candidates, reason: pick.reason };
      pushTrace(3, { kind: "F", id: "F_09", note: `下倾幅度：Δ=${pc.delta ?? "—"}°（${pc.rounds ?? "—"} 轮，方式 ${pick.adj}）` });
      pushTrace(3, { kind: "F", id: "F_10", note: `周边影响：${pick.candidates.length ? pick.candidates.map(c => `${c.adj}＝${c.impact}`).join("，") : pick.reason}；选定 ${pick.adj}` });
      if (pick.f8.match !== "命中") {
        stop(3, "NOT_MATCHED", `${pick.reason}`);
      } else {
        const r = act("A_04", { ticketNo: ticket.ticketNo, adjustType: pick.adj }, 3);
        if (!r.ok) stop(3, r.code, `A_04 生成方案被拒：${r.msg}`);
        else {
          plan = S.doc("OT_PLAN", r.result.planNo);
          const dv = plan.actions?.[0]?.deltaValue;
          step(3).note = `${pick.adj}下倾 Δ=${dv}°（${r.result.rounds} 轮）→ ${plan.planNo}（${plan.status}）`;
          step(3).detail = { ...step(3).detail, planNo: plan.planNo, status: plan.status, adjustType: pick.adj, delta: dv, rounds: r.result.rounds, impact: r.result.impact, deltaFinal: r.result.deltaFinal };
        }
      }
    }
    if (report.stop) { finish(); return report; }
    step(3).status = "done";
    report.artifacts.planNo = plan?.planNo || null;
    if (gate(4)) return report;

    /* ④ 确认派单 -------------------------------------------------- */
    curStep = 4;
    const involved = S.links({ rt: "RT_10", from: "OT_PLAN:" + plan.planNo }).filter(l => l.to.startsWith("OT_CELL:")).length;
    const vip = ["VIP", "VVIP"].includes(ticket.sceneLevel);
    const approvals = [{ role: "地市优化工程师" }, ...(involved >= 2 || vip ? [{ role: "优化主管" }] : [])];
    const reason = `周边影响 F_10＝${plan.impact?.result || "—"}；影响 ${involved} 个小区${involved >= 2 || vip ? "（须追加优化主管批准）" : ""}；按 RULE_W14 审批`;
    step(4).detail = { involved, vip, approvals: approvals.map(a => a.role), reason };
    pushTrace(4, { kind: "RULE", id: "RULE_W14", note: `审批链：${approvals.map(a => a.role).join(" ＋ ")}（影响 ${involved} 个小区${vip ? "；VIP／VVIP 场景" : ""}）` });
    if (plan.status === "待确认") {
      const r = act("A_05", {
        planNo: plan.planNo, decision: "批准", approvals,
        executor: { name: "现场维护人员", role: "现场维护人员" }, auto: false, reason
      }, 4);
      if (!r.ok) stop(4, r.code, `A_05 派单被拒：${r.msg}`);
      else {
        plan = S.doc("OT_PLAN", plan.planNo);
        step(4).note = `已批准并派单 ${plan.execution.dispatchNo}（执行方 ${plan.execution.executor}）`;
        step(4).detail = { ...step(4).detail, dispatchNo: plan.execution.dispatchNo, executor: plan.execution.executor };
      }
    } else if (plan.status === "草案") {
      const imp = plan.impact?.result || "未评估";
      stop(4, "INV_06", `F_10 周边影响「${imp}」：${imp === "未评估" ? "推不出评估结论" : "不满足期望的「通过／调减」"}，方案停在草案，不得批准（INV_06）`);
    } else if (plan.status === "已派单" || plan.status === "已实施") {
      step(4).status = "done";
      step(4).note = `方案已派单（${plan.status}），本次不重复派单`;
      step(4).detail = { ...step(4).detail, dispatchNo: plan.execution?.dispatchNo || null, executor: plan.execution?.executor || null };
    } else {
      stop(4, "STATE", `方案状态「${plan.status}」，无法进入派单`);
    }
    if (report.stop) { finish(); return report; }
    step(4).status = "done";
    report.artifacts.dispatchNo = plan.execution?.dispatchNo || null;
    if (gate(5)) return report;

    /* ⑤ 实施回填 -------------------------------------------------- */
    curStep = 5;
    const action = plan.actions?.[0] || {};
    if (plan.status === "已实施") {
      step(5).status = "done";
      step(5).note = `方案已实施（回执 ${plan.execution?.receipt || "—"}），本次不重复回填`;
      step(5).detail = { receipt: plan.execution?.receipt || null, executeTime: plan.execution?.executeTime || null, actualValue: plan.execution?.actualValues?.[0]?.value ?? null };
    } else if (plan.status === "未知") {
      stop(5, "INV_08", "回执未知，工单留在处置中，不得评估或关闭（INV_08）");
    } else if (plan.status !== "已派单") {
      stop(5, "STATE", `方案状态「${plan.status}」，尚未派单，不能回填`);
    } else {
      let fe = facts.fieldExecutions(cellKey, S.peekNow());
      if (!fe.items.length && fe.pending.length) {
        const arrive = fe.pending[0].receivedAt;
        advance(arrive, `等待现场回填记录到达（${arrive}）`);
        fe = facts.fieldExecutions(cellKey, S.peekNow());
        step(5).note = `现场回填记录尚未到达，判断时点已推进到 ${arrive}`;
      }
      const rec = fe.items[0];
      pushTrace(5, { kind: "SRC", id: "现场回填记录", note: rec
        ? `${rec.taskno || ""} 已到达：${rec.param} ${rec.fromValue}°→${rec.toValue}°（回执 ${rec.receipt}，${rec.executor || "执行方未知"}）`
        : "现场未回报：没有可用的实际值，不得用计划值代替（INV_07）" });
      if (!rec) {
        stop(5, "INV_07", "本体推不出效果：F_11 的前提（现场实际值）缺失，无法判定是否「达标且持续有效」；现场未回报，不得用计划值代替（INV_07）");
      } else if (rec.param !== action.param || (action.targetKind === "天线" && rec.antennaId !== action.targetKey)) {
        stop(5, "STATE", `现场回填记录（${rec.param}／${rec.antennaId}）与方案措施（${action.param}／${action.targetKey}）不一致，转人工核对`);
      } else {
        const r = act("A_06", {
          planNo: plan.planNo, dispatchNo: plan.execution.dispatchNo,
          executeTime: rec.executeTime, receipt: rec.receipt,
          actualValues: [{ targetKey: action.targetKey, param: action.param, value: rec.toValue }]
        }, 5);
        plan = S.doc("OT_PLAN", plan.planNo);
        ticket = S.doc("OT_TICKET", ticket.ticketNo);
        if (!r.ok) stop(5, r.code, `A_06 回填被拒：${r.msg}`);
        else if (r.result?.conflict) {
          stop(5, "INV_15", "天线工参两来源冲突，转人工裁定（INV_15），裁定前不评估");
        } else if (r.result?.receipt === "未知" || plan.status === "未知") {
          stop(5, "INV_08", "回执缺失记「未知」，工单留在处置中，不得评估或关闭（INV_08）");
        } else {
          step(5).note = `现场回报 ${action.param} ${rec.fromValue}°→${rec.toValue}°（回执 ${rec.receipt}）`;
          step(5).detail = { receipt: rec.receipt, executeTime: rec.executeTime, actualValue: rec.toValue, planValue: action.targetValue, fromValue: rec.fromValue, executor: rec.executor, ticketStatus: ticket.status };
        }
      }
    }
    if (report.stop) { finish(); return report; }
    step(5).status = "done";
    if (gate(6)) return report;

    /* ⑥ 效果核验 -------------------------------------------------- */
    curStep = 6;
    let effect = effectOf(plan);
    if (!["待评估", "已改善"].includes(ticket.status)) {
      stop(6, "STATE", `工单状态「${ticket.status}」，不能写入效果`);
    } else {
      const tm = evalTimes(ticket, plan);
      if (!tm) stop(6, "STATE", "方案尚无实施时间，不能评估（F_11 前提：方案已实施）");
      else {
        // 评到"持续有效"为止：先够窗口天数评一次，持续有效还空就再推进一步评一次。
        // 后窗没有新数据时复用已有评估，不重复写效果记录（重跑链不产生重复记录）。
        for (; ;) {
          if (effect && effect.sustained !== null) break;              // 已有结论（持续有效／否）
          advance(effect ? tm.sustainAt : tm.evalAt,
            effect ? `持续有效需满 ${tm.susDays} 天，推进判断时点再评一次`
                    : `推进判断时点到最早可评估时点 ${tm.evalAt}（后窗需满 ${tm.winDays} 天）`);
          const probe = svc.effect(ticket, plan, plan.execution.executeTime, S.peekNow());
          const cur = effectOf(plan);
          if (cur && probe.daysAfter <= (cur.afterWindow?.days ?? 0)) {   // 没有新数据：复用
            effect = cur;
            break;
          }
          const r = act("A_07", { planNo: plan.planNo }, 6);
          if (!r.ok) { stop(6, r.code, `A_07 写入效果被拒：${r.msg}`); break; }
          effect = S.doc("OT_EFFECT", r.result.effectNo);
          ticket = S.doc("OT_TICKET", ticket.ticketNo);
          if (effect.status === "待评估") { stop(6, "INV_09", `效果待评估：${r.result.reason || "后窗数据不足"}`); break; }
        }
        if (!report.stop) {
          step(6).note = `${effect.status}（改善 ${effect.improved ? "是" : "否"}／持续有效 ${effect.sustained ? "是" : "否"}）`;
          step(6).detail = {
            effectNo: effect.effectNo, status: effect.status, beforeRatio: effect.beforeRatio, afterRatio: effect.afterRatio,
            improved: effect.improved, achieved: effect.achieved, sustained: effect.sustained, protectionOk: effect.protectionOk,
            daysAfter: effect.afterWindow?.days ?? null, ticketStatus: ticket.status
          };
          pushTrace(6, { kind: "F", id: "F_11", note: `前窗 ${pct(effect.beforeRatio)} → 后窗 ${pct(effect.afterRatio)}（${effect.afterWindow?.days ?? 0} 天）；改善 ${effect.improved === null ? "未知" : effect.improved ? "是" : "否"}／达标 ${effect.achieved === null ? "未知" : effect.achieved ? "是" : "否"}／持续有效 ${effect.sustained === null ? "空" : effect.sustained ? "是" : "否"}` });
        }
      }
    }
    if (report.stop) { finish(); return report; }
    step(6).status = "done";
    report.artifacts.effectNo = effect?.effectNo || null;
    if (gate(7)) return report;

    /* ⑦ 闭环与案例 ------------------------------------------------ */
    curStep = 7;
    if (!effect || effect.sustained !== true) {
      stop(7, "INV_10", `F_11 持续有效为${effect ? (effect.sustained === null ? "空" : "否") : "空"}：期望的「持续有效」不成立，工单不得关闭（INV_10）`);
    } else if (ticket.status !== "已改善") {
      stop(7, "STATE", `工单状态「${ticket.status}」，不能关闭`);
    } else {
      const r8 = act("A_08", { ticketNo: ticket.ticketNo }, 7);
      ticket = S.doc("OT_TICKET", ticket.ticketNo);
      if (!r8.ok) stop(7, r8.code, `A_08 关闭被拒：${r8.msg}`);
      else {
        step(7).note = `工单已关闭（${ticket.status}）`;
        const rc = (ticket.rootCauses || []).find(x => x.role === "主因");
        const ar = areaOf(cellKey) || {};
        const existing = caseOf(effect);
        let cs = existing;
        if (!existing) {
          const r9 = act("A_09", {
            effectNo: effect.effectNo,
            applicability: {
              rat: ticket.rat, siteType: facts.siteOf(cellKey)?.siteType || "宏站", sceneLevel: ticket.sceneLevel,
              causeFamily: rc?.causeFamily || "天馈",
              areaScene: ar.areaScene || undefined, urbanRural: ar.urbanRural || undefined, indoorOutdoor: ar.indoorOutdoor || undefined
            }
          }, 7);
          if (!r9.ok) stop(7, r9.code, `A_09 入库被拒：${r9.msg}`);
          else {
            cs = S.doc("OT_CASE", r9.result.caseNo);
            step(7).note += `；案例 ${cs.caseNo} 已入库（${cs.outcome}）`;
          }
        } else {
          step(7).note += `；案例 ${existing.caseNo} 已存在（${existing.outcome}）`;
        }
        step(7).detail = { ticketStatus: ticket.status, caseNo: cs?.caseNo || null, outcome: cs?.outcome || null, validation: cs?.validation || null };
        report.artifacts.caseNo = cs?.caseNo || null;
        report.artifacts.caseOutcome = cs?.outcome || null;
      }
    }
    if (report.stop) { finish(); return report; }
    step(7).status = "done";

    function finish() {
      report.finishedAt = S.peekNow();
      report.clock.to = report.clock.to || report.finishedAt;
      const done = st.filter(s => s.status === "done").length;
      if (report.stop) {
        report.outcome = "stopped";
        report.summary = `止步于第 ${report.stop.step} 步「${report.stop.name}」：${report.stop.reason}`;
      } else if (report.partial) {
        report.outcome = "partial";
        report.summary = `已执行到第 ${report.nextStep - 1} 步「${st[report.nextStep - 2]?.name || ""}」（${done}/7）；第 ${report.nextStep} 步待执行`;
      } else {
        report.outcome = "completed";
        if (!report.summary) report.summary = `七步走通（${done}/7）：发现→定因→方案→派单→回填→效果→闭环入库`;
      }
      report.steps = st;
      report.counts = { done, skipped: st.filter(s => s.status === "skipped").length, blocked: st.filter(s => s.status === "blocked").length };
    }
    finish();
    return report;
  }

  return { runChain, STEP_DEFS };
}

module.exports = { createChain, STEP_DEFS, PLAN };
