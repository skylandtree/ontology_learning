// 本体执行链路（应用层，规范外）：把某个小区"实际跑过"的业务流程，按本体要素摊开。
//
// 原则与问答层一致——这里不产生新的业务判断，只把本体里已有的事实摆出来：
//   · 动作审计（runs）      → 哪些动作真的执行了、成功还是被哪条约束拒绝、谁在什么时点做的
//   · 诊断记录（diagnostics）→ 哪些函数真的被调用了、返回值是什么、引用了哪些规则与版本
//   · 对象与关系（objects/links）→ 写了哪些对象、建立了哪些关系
//   · 函数返回值（F_12 现读）  → 只读发现这一项的当前判定
// 界面上的每个数值都能在这里指到它的出处（source 字段写明出处）；前端只排版、不复算。
//
// 步骤与动作的对应来自 SPEC 5.3 的视图↔接口对照表（①～⑦）；
// 每步涉及哪些函数／对象／关系，从本体里动作自身的说明文字（purpose/input/changes）解析出来，不手写。
const { idOf } = require("./facts.js");

// 决策流程的 7 步（SPEC 5.3 视图↔接口对照表的①～⑦）：每步对应哪些动作。
// 名称与前端 cellflow.js 的 STEPS 一致。
const STEP_DEFS = [
  { n: 1, name: "发现与判定", en: "DISCOVERY", actions: ["A_01"] },
  { n: 2, name: "工单与定因", en: "DIAGNOSIS", actions: ["A_02", "A_03"] },
  { n: 3, name: "优化方案", en: "PLAN", actions: ["A_04"] },
  { n: 4, name: "确认派单", en: "APPROVAL", actions: ["A_05"] },
  { n: 5, name: "实施回填", en: "EXECUTION", actions: ["A_06"] },
  { n: 6, name: "效果核验", en: "EFFECT", actions: ["A_07"] },
  { n: 7, name: "闭环与案例", en: "CLOSURE", actions: ["A_08", "A_09"] },
];

// F_05 是 F_06 的逐日判定内核（动作说明里没单列它），单独标注出来。
const EXTRA_FNS = { 1: [{ id: "F_05", note: "F_06 的逐日判定内核：每天一次" }] };

const ID_RX = /\b(?:OT_[A-Z_]+|RT_\d+|F_\d+|A_\d+|INV_\d+|RULE_[A-Z]\d+|TH\d+)\b/g;
const idsIn = s => [...new Set(String(s || "").match(ID_RX) || [])];

function createTrace(app) {
  const { ont, store: S, facts, svc } = app;

  const invAll = ont.raw.constraints, ruleAll = ont.raw.rules, actAll = ont.raw.actions, fnAll = ont.raw.functions;
  const rtAll = ont.raw.relationTypes;
  const ruleOf = id => ruleAll.find(r => r.id === id) || null;
  const actOf = id => actAll.find(a => a.id === id) || null;
  const fnOf = id => fnAll.find(f => f.id === id) || null;
  const rtName = id => { const r = rtAll.find(x => x.id === id); return r ? r.name : id; };
  const otName = id => { const o = ont.raw.objectTypes.find(x => x.id === id); return o ? o.name : id; };

  // 动作自己的说明文字里点了哪些函数／对象／关系——本体怎么写，链路就怎么摆
  const actRefs = id => {
    const a = actOf(id); if (!a) return { fns: [], ots: [], rts: [] };
    const txt = [a.purpose, a.input, a.changes, a.failure].join(" ");
    const ids = idsIn(txt);
    return {
      fns: ids.filter(x => /^F_/.test(x)),
      ots: ids.filter(x => /^OT_/.test(x)),
      rts: ids.filter(x => /^RT_/.test(x)),
    };
  };

  // 该小区牵出的对象链：工单→方案→效果→案例
  function chainOf(cellKey) {
    const tkIds = S.links({ rt: "RT_05", to: "OT_CELL:" + cellKey }).map(l => idOf(l.from));
    const tickets = tkIds.map(id => S.doc("OT_TICKET", id)).filter(Boolean)
      .sort((a, b) => String(a.ticketNo).localeCompare(String(b.ticketNo)));
    const ticket = tickets.find(t => t.status !== "已关闭") || tickets[tickets.length - 1] || null;
    const plans = ticket ? S.links({ rt: "RT_09", to: "OT_TICKET:" + ticket.ticketNo }).map(l => idOf(l.from))
      .map(id => S.doc("OT_PLAN", id)).filter(Boolean).sort((a, b) => a.round - b.round) : [];
    const plan = plans[plans.length - 1] || null;
    const effects = plan ? S.links({ rt: "RT_11", to: "OT_PLAN:" + plan.planNo }).map(l => idOf(l.from))
      .map(id => S.doc("OT_EFFECT", id)).filter(Boolean).sort((a, b) => String(a.effectNo).localeCompare(String(b.effectNo))) : [];
    const effect = effects[effects.length - 1] || null;
    const cases = effect ? S.links({ rt: "RT_14", from: "OT_EFFECT:" + effect.effectNo }).map(l => idOf(l.to))
      .map(id => S.doc("OT_CASE", id)).filter(Boolean) : [];
    return { tickets, ticket, plans, plan, effects, effect, cases };
  }

  // 只读发现：F_12（全量发现里这一项）与 F_06（该小区逐日判定）——都是真函数返回值
  function discoveryOf(cellKey, at) {
    const scan = svc.scan([cellKey], at), item = scan.items.find(i => i.cellKey === cellKey) || null;
    return { funcId: "F_12", funcVersion: ont.func("F_12").version, window: scan.window, counts: scan.counts, item };
  }

  function buildSteps(cellKey, at) {
    const { ticket, plan, effect, cases } = chainOf(cellKey);
    const runs = S.runs();
    const targets = new Set([cellKey, ...(ticket ? [ticket.ticketNo] : []), ...(plan ? [plan.planNo] : []), ...(effect ? [effect.effectNo] : [])]);
    const diag = (ticket && ticket.diagnostics) || [];
    const disc = discoveryOf(cellKey, at);
    const runOf = aid => runs.filter(r => r.actionId === aid && targets.has(r.target));

    return STEP_DEFS.map(def => {
      const acts = def.actions.flatMap(runOf);
      // 本步的函数集合：动作说明里点到的 + F_05 这类内核函数
      const refs = def.actions.flatMap(actRefs);
      const fnIds = [...new Set([...refs.flatMap(r => r.fns), ...(EXTRA_FNS[def.n] || []).map(x => x.id)])];
      const fns = fnIds.map(id => {
        const base = { id, label: (fnOf(id) || {}).question || id, version: (fnOf(id) || {}).version || null };
        const d = diag.find(x => x.funcId === id);
        if (d) return { ...base, kind: d.kind, source: `诊断记录 ${d.callId}`, at: d.calledAt, by: d.calledBy, ruleVersions: d.ruleVersions, inputRefs: d.inputRefs, result: d.result, recorded: true };
        if (id === "F_12") return { ...base, kind: "只读发现（全量清单）", source: "F_12 现读（当前时点）", at, by: "本体服务", ruleVersions: [], inputRefs: [], result: { window: disc.window, counts: disc.counts, item: disc.item }, recorded: false };
        if (id === "F_05" && d === undefined) {
          const f06 = diag.find(x => x.funcId === "F_06");
          const daily = f06 && f06.result && f06.result.daily ? f06.result.daily : [];
          return { ...base, kind: "逐日判定", source: f06 ? `F_06 返回值 ${f06.callId} 的逐日结果` : "未留痕", ruleVersions: [], inputRefs: [], result: { days: daily.length, hit: daily.filter(x => x.hit === "是").map(x => x.date), miss: daily.filter(x => x.hit === "否").map(x => x.date), unknown: daily.filter(x => x.hit === "未知").map(x => x.date) }, recorded: !!f06 };
        }
        if (id === "F_09") {
          const r4run = acts.find(r => r.result && r.result.delta !== undefined);
          return { ...base, kind: "单次幅度与轮次", source: r4run ? `动作 ${r4run.actionId} 返回值 ${r4run.runId}` : "未留痕", ruleVersions: [], inputRefs: [], result: r4run ? { gap: r4run.result.gap, delta: r4run.result.delta, rounds: r4run.result.rounds } : null, recorded: !!r4run };
        }
        if (id === "F_10" && plan) return { ...base, kind: "周边影响", source: `对象 ${plan.planNo}.impact（${plan.impact.callId}）`, ruleVersions: [], inputRefs: [], result: plan.impact, recorded: true };
        if (id === "F_11" && effect) return { ...base, kind: "优化效果", source: `对象 ${effect.effectNo}（${effect.callRef}）`, ruleVersions: [], inputRefs: [], result: effect, recorded: true };
        return null;
      }).filter(Boolean);

      // 约束：本体里校验点命中本步动作的，都是本步的约束；审计里的拒绝码说明哪条真的被触发
      const invs = invAll.filter(c => c.checkpoints.some(p => def.actions.includes(p))).map(c => {
        const hitRun = acts.find(r => r.outcome === "rejected" && r.code === c.id);
        return { id: c.id, text: c.text, checkpoints: c.checkpoints, violated: !!hitRun, message: hitRun ? hitRun.msg : null, runId: hitRun ? hitRun.runId : null };
      });
      // 规则：本体里 uses 提到本步函数或动作的规则，加上诊断记录里引用过的规则
      const ruleIds = new Set();
      ruleAll.forEach(r => { const used = idsIn(r.uses); if (used.some(u => def.actions.includes(u) || fnIds.includes(u))) ruleIds.add(r.id); });
      diag.forEach(d => { if (fnIds.includes(d.funcId)) (d.ruleVersions || []).forEach(v => ruleIds.add(String(v).split("@")[0])); });
      if (def.n === 1 && ticket && ticket.discovery && ticket.discovery.ruleId) ruleIds.add(ticket.discovery.ruleId);
      const rules = [...ruleIds].map(id => { const r = ruleOf(id); return r ? { id, version: r.version, meaning: r.meaning, uses: r.uses } : null; }).filter(Boolean);

      // 本步真实触碰的对象实例与建立的关系
      const objs = [], rels = [];
      const addObj = (ot, id, label, note) => { if (id && !objs.some(o => o.ot === ot && o.id === id)) objs.push({ ot, id, label: label || id, note: note || null }); };
      const addRel = (rt, from, to, note, derived) => { if (!rels.some(r => r.rt === rt && r.from === from && r.to === to)) rels.push({ rt, name: rtName(rt), from, to, note: note || null, derived: !!derived }); };
      const cellDoc = S.doc("OT_CELL", cellKey) || {};
      if (def.n === 1) {
        const mr = S.links({ rt: "RT_16", to: "OT_CELL:" + cellKey });
        addObj("OT_CELL", cellKey, cellDoc.cellName || cellKey);
        if (ticket) (ticket.discovery.evidenceRefs || []).forEach(r => addObj("OT_CELL_MR", r.mrKey, String(r.mrKey).split("@")[1] || r.mrKey, "v" + r.version));
        addRel("RT_16", "OT_CELL_MR:*", "OT_CELL:" + cellKey, `${mr.length} 条日统计`, false);
        if (ticket) {
          addObj("OT_TICKET", ticket.ticketNo, ticket.ticketNo, ticket.status);
          addRel("RT_17", "OT_TICKET:" + ticket.ticketNo, "OT_CELL_MR:*", `${(ticket.discovery.evidenceRefs || []).length} 条发现依据`, false);
          addRel("RT_05", "OT_TICKET:" + ticket.ticketNo, "OT_CELL:" + cellKey, "针对该小区", false);
          S.links({ rt: "RT_06", from: "OT_TICKET:" + ticket.ticketNo }).forEach(l => addRel("RT_06", "OT_TICKET:" + ticket.ticketNo, l.to, l.props.role || "", false));
        }
      }
      if (def.n === 2 && ticket) {
        addObj("OT_TICKET", ticket.ticketNo, ticket.ticketNo, ticket.status);
        (ticket.rootCauses || []).forEach(r => (r.evidenceRefs || []).forEach(e => { if (e.antennaId) addObj("OT_ANTENNA", e.antennaId, e.antennaId, "根因证据·工参"); }));
        S.links({ rt: "RT_08", from: "OT_TICKET:" + ticket.ticketNo }).forEach(l => addRel("RT_08", "OT_TICKET:" + ticket.ticketNo, l.to, l.props.evidenceKind || "", false));
      }
      if (def.n === 3 && plan) {
        addObj("OT_PLAN", plan.planNo, plan.planNo, plan.status);
        addRel("RT_09", "OT_PLAN:" + plan.planNo, "OT_TICKET:" + (ticket ? ticket.ticketNo : ""), "针对该工单", false);
        S.links({ rt: "RT_10", from: "OT_PLAN:" + plan.planNo }).forEach(l => addRel("RT_10", "OT_PLAN:" + plan.planNo, l.to, l.props.role || "", false));
      }
      if (def.n === 4 && plan) addObj("OT_PLAN", plan.planNo, plan.planNo, plan.status);
      if (def.n === 5 && plan) {
        addObj("OT_PLAN", plan.planNo, plan.planNo, plan.status);
        const a = (plan.actions || [])[0];
        if (a && a.targetKind === "天线") addObj("OT_ANTENNA", a.targetKey, a.targetKey, "工参版本");
        S.links({ rt: "RT_02", from: "OT_CELL:" + cellKey }).forEach(l => addRel("RT_02", "OT_CELL:" + cellKey, l.to, "工参关系", false));
      }
      if (def.n === 6 && effect) {
        addObj("OT_EFFECT", effect.effectNo, effect.effectNo, effect.status);
        addRel("RT_11", "OT_EFFECT:" + effect.effectNo, "OT_PLAN:" + (plan ? plan.planNo : ""), "检验该方案", false);
        addRel("RT_12", "OT_EFFECT:" + effect.effectNo, "OT_CELL:" + cellKey, "目标小区", false);
        S.links({ rt: "RT_13", from: "OT_EFFECT:" + effect.effectNo }).forEach(l => addRel("RT_13", "OT_EFFECT:" + effect.effectNo, l.to, l.props.role || "保护指标", false));
      }
      if (def.n === 7) {
        if (ticket) addObj("OT_TICKET", ticket.ticketNo, ticket.ticketNo, ticket.status);
        cases.forEach(c => { addObj("OT_CASE", c.caseNo, c.caseNo, c.outcome); addRel("RT_14", "OT_EFFECT:" + (effect ? effect.effectNo : ""), "OT_CASE:" + c.caseNo, "沉淀为案例", false); });
      }
      const state = acts.some(r => r.outcome === "ok") ? "done" : acts.length ? "rejected" : "todo";
      return {
        n: def.n, name: def.name, en: def.en, state,
        actions: acts.map(r => {
          const a = actOf(r.actionId);
          return { id: r.actionId, label: a ? a.label : r.actionId, role: r.role, actor: r.actor, outcome: r.outcome, code: r.code, message: r.msg, at: r.t, target: r.target, runId: r.runId, result: r.result };
        }),
        functions: fns, constraints: invs, rules, objects: objs, relations: rels,
      };
    });
  }

  // 关键数值：每一步"这一眼要看的数"——全部取自对象或函数返回值，前端只负责排版
  function buildFacts(cellKey, at) {
    const { ticket, plan, effect, cases } = chainOf(cellKey);
    const disc = discoveryOf(cellKey, at);
    const d = ticket && ticket.discovery ? ticket.discovery : null;
    const diag = (ticket && ticket.diagnostics) || [];
    const f7 = diag.find(x => x.funcId === "F_07"), f8 = diag.find(x => x.funcId === "F_08");
    const rc = ticket && ticket.rootCauses ? ticket.rootCauses.find(r => r.role === "主因") : null;
    const pa = plan && plan.actions ? plan.actions[0] : null;
    const av = plan && plan.execution && plan.execution.actualValues ? plan.execution.actualValues[0] : null;
    const p7 = f7 && f7.result ? f7.result : null, p8 = f8 && f8.result ? f8.result : null;
    return {
      1: d ? [
        { k: "判定", v: d.verdict }, { k: "命中天数", v: d.hitDays, unit: "天" },
        { k: "未知天数", v: (d.unknownDates || []).length, unit: "天" },
        { k: "派单规则", v: d.ruleId ? `${d.ruleId} v${d.ruleVersion}` : "无适用规则" },
        { k: "窗口", v: `${d.window.from} ~ ${d.window.to}` },
        { k: "发现依据", v: (d.evidenceRefs || []).length, unit: "条 OT_CELL_MR" },
      ] : [
        { k: "判定", v: disc.item ? disc.item.verdict : "证据不足" }, { k: "命中天数", v: disc.item ? disc.item.hitDays : 0, unit: "天" },
        { k: "未知天数", v: disc.item ? (disc.item.unknownDates || []).length : 0, unit: "天" },
        { k: "派单规则", v: disc.item && disc.item.ruleId ? disc.item.ruleId : "无适用规则" },
        { k: "窗口", v: `${disc.window.from} ~ ${disc.window.to}` },
      ],
      2: [
        { k: "F_07 假性弱覆盖", v: p7 ? p7.verdict : "未执行" },
        { k: "F_08 下倾角命中", v: p8 ? p8.match : "未执行" },
        { k: "总下倾", v: p8 ? p8.totalTilt : null, unit: "°" },
        { k: "推荐下倾", v: p8 ? p8.thetaTarget : null, unit: "°" },
        { k: "缺口", v: p8 ? p8.deficit : null, unit: "°" },
        { k: "主因", v: rc ? rc.causeLabel : "未写入" }, { k: "工单状态", v: ticket ? ticket.status : "无工单" },
      ],
      3: [
        { k: "方案", v: plan ? plan.planNo : "未生成" }, { k: "措施", v: plan ? plan.measureType.name : "—" },
        { k: "幅度 Δ", v: pa ? pa.deltaValue : null, unit: "°" }, { k: "轮次", v: plan ? plan.round : null },
        { k: "周边影响", v: plan ? plan.impact.result : "—" },
        { k: "影响范围", v: plan ? S.links({ rt: "RT_10", from: "OT_PLAN:" + plan.planNo }).filter(l => l.to.startsWith("OT_CELL:")).length : 0, unit: "个小区" },
      ],
      4: [
        { k: "方案状态", v: plan ? plan.status : "—" },
        { k: "审批角色", v: plan && plan.approval ? plan.approval.approverRoles.join(" ＋ ") : "尚未审批" },
        { k: "派单号", v: plan && plan.execution ? plan.execution.dispatchNo : "—" },
        { k: "执行方", v: plan && plan.execution ? plan.execution.executor : "—" },
      ],
      5: [
        { k: "回执", v: plan && plan.execution ? plan.execution.receipt : "—" },
        { k: "实施时间", v: plan && plan.execution ? plan.execution.executeTime : "—" },
        { k: "计划值", v: pa ? pa.targetValue : null, unit: "°" },
        { k: "现场实际值", v: av ? av.value : null, unit: "°" },
        { k: "工参版本", v: plan && pa && pa.targetKind === "天线" ? S.history("OT_ANTENNA", pa.targetKey).length : null, unit: "版" },
      ],
      6: [
        { k: "前窗占比", v: effect ? effect.beforeRatio : null, ratio: true },
        { k: "后窗占比", v: effect ? effect.afterRatio : null, ratio: true },
        { k: "改善", v: effect ? (effect.improved === null || effect.improved === undefined ? "未知" : effect.improved ? "是" : "否") : "未评估" },
        { k: "达标", v: effect ? (effect.achieved === null || effect.achieved === undefined ? "未知" : effect.achieved ? "是" : "否") : "未评估" },
        { k: "持续有效", v: effect ? (effect.sustained === null || effect.sustained === undefined ? "空" : effect.sustained ? "是" : "否") : "未评估" },
        { k: "保护指标", v: effect ? (effect.protectionOk === null || effect.protectionOk === undefined ? "未评定" : effect.protectionOk ? "均未恶化" : "有恶化") : "—" },
      ],
      7: [
        { k: "工单状态", v: ticket ? ticket.status : "—" },
        { k: "案例号", v: cases.length ? cases.map(c => c.caseNo).join("、") : "未入库" },
        { k: "案例结论", v: cases.length ? cases.map(c => c.outcome).join("、") : "—" },
        { k: "验证状态", v: cases.length ? cases.map(c => c.validation).join("、") : "—" },
      ],
    };
  }

  // 对象谱系：小区牵出的对象实例与它们之间的本体关系（RT_03 邻区是派生，不落库）
  function buildLineage(cellKey) {
    const { ticket, plan, effect, cases } = chainOf(cellKey);
    const nodes = [], edges = [];
    const addNode = (ot, id, role, label, note) => { if (id && !nodes.some(n => n.ot === ot && n.id === id)) nodes.push({ ot, id, role, label: label || id, note: note || null }); };
    const addEdge = (rt, from, to, note, derived) => { if (!edges.some(e => e.rt === rt && e.from === from && e.to === to)) edges.push({ rt, name: rtName(rt), from, to, note: note || null, derived: !!derived }); };
    const cell = S.doc("OT_CELL", cellKey) || {};
    const cellLabel = cell.cellName || cellKey;
    addNode("OT_CELL", cellKey, "cell", cellLabel, cell.rat ? `${cell.rat}${cell.band ? " / " + cell.band : ""}` : null);
    S.links({ rt: "RT_01", from: "OT_CELL:" + cellKey }).forEach(l => { addNode("OT_SITE", idOf(l.to), "site", idOf(l.to)); addEdge("RT_01", "OT_CELL:" + cellKey, l.to, "小区→站点"); });
    S.links({ rt: "RT_02", from: "OT_CELL:" + cellKey }).forEach(l => {
      addNode("OT_ANTENNA", idOf(l.to), "antenna", idOf(l.to), l.props.elecTilt !== undefined ? `电子下倾 ${l.props.elecTilt}°` : null);
      addEdge("RT_02", "OT_CELL:" + cellKey, l.to, "小区→天线");
    });
    S.links({ rt: "RT_04", from: "OT_CELL:" + cellKey }).forEach(l => {
      const a = S.doc("OT_AREA", idOf(l.to)) || {};
      addNode("OT_AREA", idOf(l.to), "area", a.areaName || idOf(l.to), l.props.role ? `${l.props.role}${l.props.share !== undefined ? ` ${l.props.share}` : ""}` : null);
      addEdge("RT_04", "OT_CELL:" + cellKey, l.to, "小区→区域");
    });
    (cell.neighbors || []).filter(n => n && n.targetCellKey).forEach(n => {
      addNode("OT_CELL", n.targetCellKey, "neighbor", (S.doc("OT_CELL", n.targetCellKey) || {}).cellName || n.targetCellKey, n.overlapWeight ? `重叠权重 ${n.overlapWeight}` : null);
      addEdge("RT_03", "OT_CELL:" + cellKey, "OT_CELL:" + n.targetCellKey, "邻区／重叠覆盖（派生）", true);
    });
    if (ticket) {
      addNode("OT_TICKET", ticket.ticketNo, "ticket", ticket.ticketNo, ticket.status);
      addEdge("RT_05", "OT_TICKET:" + ticket.ticketNo, "OT_CELL:" + cellKey, "工单→小区（针对）");
      (ticket.discovery.evidenceRefs || []).forEach(r => {
        addNode("OT_CELL_MR", r.mrKey, "mr", String(r.mrKey).split("@")[1] || r.mrKey, "v" + r.version);
        addEdge("RT_17", "OT_TICKET:" + ticket.ticketNo, "OT_CELL_MR:" + r.mrKey, "发现依据");
      });
      S.links({ rt: "RT_08", from: "OT_TICKET:" + ticket.ticketNo }).forEach(l => {
        const t = l.to.split(":")[0], k = idOf(l.to);
        addNode(t, k, "evidence", k, l.props.evidenceKind || null);
        addEdge("RT_08", "OT_TICKET:" + ticket.ticketNo, l.to, "根因依据");
      });
      S.links({ rt: "RT_06", from: "OT_TICKET:" + ticket.ticketNo }).forEach(l => addEdge("RT_06", "OT_TICKET:" + ticket.ticketNo, l.to, l.props.role || "涉及小区"));
    }
    if (plan) {
      addNode("OT_PLAN", plan.planNo, "plan", plan.planNo, plan.status);
      addEdge("RT_09", "OT_PLAN:" + plan.planNo, "OT_TICKET:" + (ticket ? ticket.ticketNo : ""), "方案→工单（针对）");
      S.links({ rt: "RT_10", from: "OT_PLAN:" + plan.planNo }).forEach(l => {
        const t = l.to.split(":")[0], k = idOf(l.to);
        const label = t === "OT_CELL" ? ((S.doc("OT_CELL", k) || {}).cellName || k) : k;
        addNode(t, k, l.props.role === "主作用" ? "target" : "scope", label, l.props.role || null);
        addEdge("RT_10", "OT_PLAN:" + plan.planNo, l.to, l.props.role === "主作用" ? "主作用" : "受影响");
      });
    }
    if (effect) {
      addNode("OT_EFFECT", effect.effectNo, "effect", effect.effectNo, effect.status);
      addEdge("RT_11", "OT_EFFECT:" + effect.effectNo, "OT_PLAN:" + (plan ? plan.planNo : ""), "效果→方案（检验）");
      addEdge("RT_12", "OT_EFFECT:" + effect.effectNo, "OT_CELL:" + cellKey, "效果→目标小区");
      S.links({ rt: "RT_13", from: "OT_EFFECT:" + effect.effectNo }).forEach(l => {
        const k = idOf(l.to);
        addNode("OT_CELL", k, "protect", (S.doc("OT_CELL", k) || {}).cellName || k, l.props.role || null);
        addEdge("RT_13", "OT_EFFECT:" + effect.effectNo, l.to, "保护指标小区");
      });
    }
    cases.forEach(c => {
      addNode("OT_CASE", c.caseNo, "case", c.caseNo, c.outcome);
      addEdge("RT_14", "OT_EFFECT:" + (effect ? effect.effectNo : ""), "OT_CASE:" + c.caseNo, "效果→案例（沉淀）");
    });
    return { nodes, edges };
  }

  /** 某个小区的执行链路：步骤 + 关键数值 + 对象谱系 */
  function cellTrace(cellKey, opt = {}) {
    const at = opt.at || S.peekNow();
    const cell = S.doc("OT_CELL", cellKey);
    if (!cell) return null;
    const steps = buildSteps(cellKey, at), facts = buildFacts(cellKey, at), lineage = buildLineage(cellKey);
    // 本次执行实际用到的本体要素（去重汇总）
    const used = { OT: new Set(), RT: new Set(), F: new Set(), A: new Set(), INV: new Set(), RULE: new Set() };
    steps.forEach(s => {
      s.actions.forEach(a => used.A.add(a.id));
      s.functions.forEach(f => used.F.add(f.id));
      s.constraints.forEach(c => used.INV.add(c.id));
      s.rules.forEach(r => used.RULE.add(r.id));
      s.objects.forEach(o => used.OT.add(o.ot));
      s.relations.forEach(r => used.RT.add(r.rt));
    });
    lineage.nodes.forEach(n => used.OT.add(n.ot));
    lineage.edges.forEach(e => used.RT.add(e.rt));
    const usedOut = Object.fromEntries(Object.entries(used).map(([k, v]) => [k, [...v].sort()]));
    return {
      cellKey, cellName: cell.cellName || cellKey, at,
      rat: cell.rat, band: cell.band, sceneLevel: cell.sceneLevel,
      steps, facts, lineage,
      used: usedOut,
      counts: Object.fromEntries(Object.entries(usedOut).map(([k, v]) => [k, v.length])),
      executed: steps.filter(s => s.state === "done").length,
      totalSteps: steps.length,
      typeNames: Object.fromEntries(ont.raw.objectTypes.map(o => [o.id, o.name])),
    };
  }

  return { cellTrace, chainOf, STEP_DEFS };
}

module.exports = { createTrace, STEP_DEFS };
