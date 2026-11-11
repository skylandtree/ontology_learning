// 动作 A_01～A_11：写入对象与关系，执行 SPEC 的核心约束 INV_01～INV_17。每次调用（成功或拒绝）都留审计记录。
// 角色权限取自 SPEC 动作表“发起角色”；“优化本体无权关闭／裁定”由此自然成立。
const { addDays, day } = require("./facts.js");

class ActionError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

function makeActions(app) {
  const { ont, store: S, facts, svc, F, tracker: T } = app, P = k => ont.param(k);
  const hit = (k, id, d) => T && T.hit(k, id, d);
  const inv = (id, ok, msg) => { hit("INV", id, ok ? "pass" : "violation"); if (!ok) throw new ActionError(id, msg); };
  const st = (ok, msg) => { if (!ok) throw new ActionError("STATE", msg); };
  const nf = (what, id) => { throw new ActionError("NOT_FOUND", `${what} ${id} 不存在`); };
  const ticket = no => S.doc("OT_TICKET", no) || nf("工单", no);
  const plan = no => S.doc("OT_PLAN", no) || nf("方案", no);
  const saveT = t => S.putObject("OT_TICKET", t.ticketNo, t);
  const saveP = p => S.putObject("OT_PLAN", p.planNo, p);
  const callId = (t, n) => `CL-${t.ticketNo}-${String(n).padStart(3, "0")}`;
  const diag = (t, kind, res, inputRefs, ruleIds, by) => {
    const rec = { callId: callId(t, (t.diagnostics || []).length + 1), kind, funcId: res.funcId, funcVersion: res.funcVersion, inputRefs, ruleVersions: ruleIds.map(r => `${r}@${ont.rule(r).version}`), result: res, evidenceRefs: res.evidenceRefs || [], calledAt: S.peekNow(), calledBy: by };
    t.diagnostics = [...(t.diagnostics || []), rec]; ruleIds.forEach(r => hit("RULE", r)); return rec;
  };
  const cellOf = t => facts.cellOfTicket(t.ticketNo);
  const lastDiag = (t, kind) => [...(t.diagnostics || [])].reverse().find(d => d.kind === kind);
  const ticketPlans = no => S.list("OT_PLAN").filter(p => p.ticketNo === no).sort((a, b) => a.round - b.round);
  const effects = no => S.list("OT_EFFECT").filter(e => e.planNo.startsWith(`PL-${no}-`)).sort((a, b) => a.effectNo.localeCompare(b.effectNo));
  const measureSnap = adj => {
    const m = ont.measure(adj === "机械" ? "TILT_UP_MECH" : "TILT_UP_ELEC"), mech = ont.measure("TILT_UP_MECH").smallClass.split("／");
    return { measureCode: m.measureCode, name: m.name, bigClass: mech[0], midClass: mech[1], smallClass: mech[2], level: m.level, executorRole: m.executorRole, remote: m.remote, direction: m.direction, maxStep: m.maxStep, resolution: m.resolution };
  };
  // 案例检索（RT_15）：适用条件须一致，不一致不得复用；只作参考，不照搬幅度
  const applicabilityOf = (cellKey, cause) => {
    const c = facts.cell(cellKey), site = facts.siteOf(cellKey), al = S.links({ rt: "RT_04", from: "OT_CELL:" + cellKey }).find(l => l.props.role === "主服务"), area = al && S.doc("OT_AREA", al.to.split(":")[1]);
    return { rat: c.rat, siteType: site.siteType, sceneLevel: c.sceneLevel, areaScene: area && area.areaScene, urbanRural: area && area.urbanRural, indoorOutdoor: area && area.indoorOutdoor, causeFamily: cause, vendor: null, tiltRange: null };
  };
  const matchCases = ap => S.list("OT_CASE").filter(c => ["rat", "siteType", "sceneLevel", "areaScene", "urbanRural", "indoorOutdoor", "causeFamily"].every(k => !ap[k] || !c.applicability[k] || ap[k] === c.applicability[k]));

  app.applicabilityOf = applicabilityOf; app.matchCases = matchCases;   // 问答用：判断案例是否适用
  const H = {};

  // ── A_01 依发现结果建单：重算 F_06，不采信 F_12 清单里的旧结果
  H.A_01 = (i, actor) => {
    const cellKey = i.cellKey, cell = facts.cell(cellKey) || nf("小区", cellKey), refTime = i.refTime || S.peekNow(), g = facts.ruleFor(cellKey, refTime);
    inv("INV_01", !!(g.site && g.site.siteType), `小区 ${cellKey} 无法确定站点类型，不建单`);
    const d = svc.discover(cellKey, refTime);
    inv("INV_09", d.verdict !== "证据不足", `证据不足，不建单：${d.reason || "规则缺口"}；缺天 ${d.unknownDates.join("、") || "—"}`);
    inv("INV_16", d.verdict === "达到派单条件" && d.evidenceRefs.length > 0, `未达到派单条件（命中 ${d.hitDays} 天，需 ${d.minHitDays} 天），不建单`);
    const rule = ont.raw.dispatchRules.find(r => r.ruleId === d.ruleId); hit("RULE", rule.ruleId); hit("RULE", "RULE_T01");
    const mine = facts.ticketsOf(cellKey).filter(t => t.problemType === rule.problemType), open = mine.filter(t => t.status !== "已关闭");
    if (open.length) { hit("INV", "INV_14", "violation"); return { ticketNo: open[0].ticketNo, deduped: true, status: open[0].status }; }
    hit("INV", "INV_14", "pass");
    const seq = mine.length + 1, closed = [...mine].sort((a, b) => a.ticketNo.localeCompare(b.ticketNo)).pop();
    const ticketNo = `TK-${cell.rat}-${cellKey.slice(cellKey.indexOf(":") + 1)}-${String(seq).padStart(3, "0")}`;
    const t = { ticketNo, problemCategory: rule.category, problemType: rule.problemType, dispatchProblem: rule.dispatchProblem, rat: cell.rat, sceneLevel: cell.sceneLevel, status: "待核验", rootCauses: [], diagnostics: [],
      discovery: { problemKey: d.problemKey, ruleId: d.ruleId, ruleVersion: d.ruleVersion, window: { from: d.window.from, to: d.window.to, days: d.window.days, dates: d.window.dates }, hitDates: d.hitDates, hitDays: d.hitDays, unknownDates: d.unknownDates, minHitDays: d.minHitDays, verdict: d.verdict, evidenceRefs: d.evidenceRefs } };
    if (closed) t.relatedTicketNo = closed.ticketNo;
    diag(t, "发现判定", d, d.evidenceRefs.map(r => `${r.mrKey}#v${r.version}`), [rule.ruleId, "RULE_F01"], actor.name || actor.role);
    S.putObject("OT_TICKET", ticketNo, t);
    S.link("RT_05", "OT_TICKET:" + ticketNo, "OT_CELL:" + cellKey);
    for (const v of facts.involved(cellKey, refTime)) S.link("RT_06", "OT_TICKET:" + ticketNo, "OT_CELL:" + v.cellKey, { role: v.role });
    for (const r of d.evidenceRefs) S.link("RT_17", "OT_TICKET:" + ticketNo, "OT_CELL_MR:" + r.mrKey, { version: r.version });
    if (closed) { S.link("RT_07", "OT_TICKET:" + ticketNo, "OT_TICKET:" + closed.ticketNo); hit("INV", "INV_11", "pass"); }
    return { ticketNo, status: t.status, discovery: t.discovery, relatedTicketNo: t.relatedTicketNo, deduped: false };
  };

  // ── A_02 写入根因：规则命中（优化本体）或人工（工程师／专家）；每次追加诊断记录，根因只追加轮次
  H.A_02 = (i, actor) => {
    const t = ticket(i.ticketNo), cellKey = cellOf(t), asOf = S.peekNow();
    inv("INV_04", ["待核验", "已确认"].includes(t.status), `工单状态“${t.status}”，不能写入根因`);
    const fw = svc.falseWeak(cellKey, t.discovery.hitDates, asOf); diag(t, "假性弱覆盖", fw, [`window:${t.discovery.window.from}~${t.discovery.window.to}`], ["RULE_W04"], actor.name || actor.role); hit("RULE", "RULE_W04"); hit("RULE", "RULE_W04"); hit("TH", "TH07");
    if (fw.verdict === "排除") { saveT(t); if (i.mode === "manual") throw new ActionError("STATE", "F_07＝排除（假性弱覆盖），不写根因，应由 A_03 排除"); return { written: false, f07: fw.verdict, reason: "假性弱覆盖，不写根因" }; }
    const f8 = svc.matchTilt(cellKey, asOf), rec8 = diag(t, "下倾角命中", f8, [`tilt:${f8.inputs.antennaId}`], ["RULE_W06", "RULE_M01"], actor.name || actor.role);
    hit("TH", "TH01"); hit("TH", "TH15");
    if (f8.inputs.rsPower !== undefined) hit("RULE", "RULE_W05"); if (f8.inputs.azimuthDeviationDeg !== undefined) { hit("RULE", "RULE_W08"); hit("TH", "TH08"); } if (f8.inputs.obstructionEvidence !== undefined) hit("RULE", "RULE_W09");
    let round = null;
    if (i.mode === "manual") {   // 人工：症状级标签不得作主因，主因须有直接证据（INV_02、INV_03）
      inv("INV_02", !(i.role === "主因" && ont.symptom(i.causeLabel)), `“${i.causeLabel}”是症状级标签，不得作主因，须先下钻原因`);
      const refs = i.evidenceRefs || [];
      inv("INV_03", i.role !== "主因" || (refs.length > 0 && refs.every(r => evidenceExists(r))), "主因至少要有一条真实存在的直接证据（小区MR、工参、告警、勘察）");
      round = { round: t.rootCauses.length + 1, role: i.role, causeFamily: i.causeFamily, causeLabel: i.causeLabel, evidenceRefs: refs, diagCallId: i.diagCallId || rec8.callId, source: actor.role === "优化专家" ? "人工" : "人工" };
    } else if (f8.match === "命中") {
      const mr = { kind: "小区MR", cellKey, from: t.discovery.window.from, to: t.discovery.window.to }, gc = { kind: "工参", antennaId: f8.inputs.antennaId };
      inv("INV_03", evidenceExists(mr) && evidenceExists(gc), "主因证据缺失");
      round = { round: t.rootCauses.length + 1, role: "主因", causeFamily: "天馈", causeLabel: "弱覆盖小区天线下倾角过小", evidenceRefs: [mr, gc], diagCallId: rec8.callId, source: "规则" };
      S.link("RT_08", "OT_TICKET:" + t.ticketNo, "OT_CELL:" + cellKey, { evidenceKind: "小区MR" }); S.link("RT_08", "OT_TICKET:" + t.ticketNo, "OT_ANTENNA:" + f8.inputs.antennaId, { evidenceKind: "工参" });
    }
    if (!round) { saveT(t); return { written: false, f07: fw.verdict, f08: f8.match, reason: f8.reason || f8.role }; }
    t.rootCauses = [...t.rootCauses, round];
    const rounds = [round, ...(i.mode === "manual" ? [] : f8.otherCauses.map(c => ({ round: round.round, role: "次因", causeFamily: "其他", causeLabel: c, evidenceRefs: [], diagCallId: rec8.callId, source: "规则" })))];
    t.rootCauses = [...t.rootCauses.slice(0, -1), ...rounds]; hit("INV", "INV_11", "pass");
    saveT(t); return { written: true, round: round.round, f07: fw.verdict, f08: f8.match, otherCauses: f8.otherCauses };
  };
  function evidenceExists(r) {
    if (r.kind === "小区MR") { if (!facts.cell(r.cellKey)) return false; let n = 0; for (let d = r.from; d <= r.to; d = addDays(d, 1)) if (facts.mr(r.cellKey, d)) n++; return n > 0; }
    if (r.kind === "工参") return !!S.doc("OT_ANTENNA", r.antennaId);
    return !!r.ref;   // 告警、勘察等来源事实：须给出引用
  }

  // ── A_03 确认或排除
  H.A_03 = (i, actor) => {
    const t = ticket(i.ticketNo); st(t.status === "待核验", `工单状态“${t.status}”，只能对待核验工单确认或排除`);
    const fw = lastDiag(t, "假性弱覆盖"), v = fw && fw.result.verdict, last = t.rootCauses.filter(r => r.round === Math.max(0, ...t.rootCauses.map(x => x.round)));
    if (i.decision === "排除") { inv("INV_04", v === "排除", "已排除须 F_07＝排除"); t.status = "已排除"; saveT(t); return { status: t.status }; }
    inv("INV_03", last.some(r => r.role === "主因" && r.evidenceRefs.length > 0), "无主因证据，不得确认");
    if (v === "排除") throw new ActionError("STATE", "F_07＝排除（假性弱覆盖），应排除而不是确认");
    if (v === "部分重合" && !i.reason) throw new ActionError("REVIEW_REQUIRED", "告警与命中日部分重合，须人工写明复核判断");
    if (last.some(r => r.role === "次因") && !i.reason) throw new ActionError("REVIEW_REQUIRED", "次因同时命中，须工程师写明复核判断（是否转专家）");
    t.status = "已确认"; saveT(t); return { status: t.status };
  };

  // ── A_04 生成方案：F_08 命中 → F_09 幅度与轮次 → F_10 周边影响
  H.A_04 = (i, actor) => {
    const t = ticket(i.ticketNo), cellKey = cellOf(t), adj = i.adjustType || "机械";
    inv("INV_04", ["已确认", "改善未解决"].includes(t.status), `工单状态“${t.status}”，不得生成方案`);
    const prev = ticketPlans(t.ticketNo), openP = prev.find(p => !["已实施", "未批准", "失败", "已回退"].includes(p.status) || (p.status === "已实施" && t.status !== "改善未解决"));
    if (openP) throw new ActionError("ROUND_IN_PROGRESS", `方案 ${openP.planNo} 尚未结束（${openP.status}），不能再生成新一轮`);
    const asOf = S.peekNow(), f8 = svc.matchTilt(cellKey, asOf);
    inv("INV_15", f8.match !== "冲突", "工参来源冲突，须先裁定（A_11）");
    inv("INV_09", f8.match !== "未知", `F_08＝未知（证据不足）：${f8.reason || f8.missing.join("、")}，不生成方案`);
    if (f8.match !== "命中") throw new ActionError("NOT_MATCHED", "F_08 不命中，转其他原因族，不生成下倾方案");
    if (adj === "电子" && !f8.inputs.supportsRET) throw new ActionError("NOT_SUPPORTED", "天线不支持电调，不能选电子下倾");
    const f9 = F.F09(f8._deficit, adj); hit("F", "F_09"); hit("RULE", "RULE_W14"); hit("TH", "TH02"); hit("TH", "TH03");
    inv("INV_13", f9.executable && f9.delta <= P("maxStep") + 1e-9 && Math.abs(f9.delta / f9.resolution - Math.round(f9.delta / f9.resolution)) < 1e-9, "单次幅度须≤单次上限且为调节分辨率整数倍");
    const f10 = svc.impact(cellKey, adj, f9.delta, asOf); hit("RULE", "RULE_W13"); hit("TH", "TH16"); hit("INV", "INV_12", "pass"); hit("RULE", "RULE_M01");
    const round = prev.length + 1, planNo = `PL-${t.ticketNo}-R${round}`, ok = ["通过", "调减"].includes(f10.result), dFinal = ok ? f10.deltaFinal : f9.delta;
    const targetKey = adj === "机械" ? f8.inputs.antennaId : cellKey, param = adj === "机械" ? "mechTilt" : "elecTilt", cur = adj === "机械" ? f8.inputs.mechTilt : f8.inputs.elecTilt;
    const p = { planNo, ticketNo: t.ticketNo, round, measureType: measureSnap(adj), status: ok ? "待确认" : "草案", rollbackCondition: "保护指标恶化或超门限",
      actions: [{ targetKind: adj === "机械" ? "天线" : "小区阵列", targetKey, param, currentValue: cur, targetValue: +(cur + dFinal).toFixed(1), deltaValue: dFinal, rollbackValue: cur }],
      impact: { callId: `${planNo}-F10`, result: f10.result, deltaPlan: f10.deltaPlan, deltaFinal: f10.deltaFinal, checks: f10.checks } };
    S.putObject("OT_PLAN", planNo, p); S.link("RT_09", "OT_PLAN:" + planNo, "OT_TICKET:" + t.ticketNo);
    if (adj === "机械") { S.link("RT_10", "OT_PLAN:" + planNo, "OT_ANTENNA:" + targetKey, { role: "主作用" }); for (const c of f10.scope) S.link("RT_10", "OT_PLAN:" + planNo, "OT_CELL:" + c, { role: "受影响" }); }
    else S.link("RT_10", "OT_PLAN:" + planNo, "OT_CELL:" + cellKey, { role: "主作用" });
    const ref = matchCases(applicabilityOf(cellKey, "下倾角过小"));
    for (const c of ref) S.link("RT_15", "OT_CASE:" + c.caseNo, "OT_PLAN:" + planNo);
    return { planNo, status: p.status, gap: f8.deficit, delta: f9.delta, rounds: f9.rounds, impact: f10.result, deltaFinal: f10.deltaFinal, caseRefs: ref.map(c => ({ caseNo: c.caseNo, outcome: c.outcome })), toHuman: !ok };
  };

  // ── A_05 确认并派单：天馈类不得自动执行；周边影响不通过／未评估不得批准；多小区或 VIP／VVIP 追加优化主管批准
  H.A_05 = (i, actor) => {
    const p = plan(i.planNo), t = ticket(p.ticketNo);
    if (p.status === "已派单" && p.execution && p.execution.dispatchNo) return { dispatchNo: p.execution.dispatchNo, deduped: true, status: p.status };
    // 不批准：待确认或停在草案（周边影响不通过／未评估）的方案都可以被工程师否决；INV_06 只禁止“批准”这类方案
    if (i.decision === "不批准") { st(["待确认", "草案"].includes(p.status), `方案状态“${p.status}”，不能否决`); p.status = "未批准"; p.approval = { approverRoles: (i.approvals || []).map(x => x.role), decision: "不批准", time: S.peekNow(), reason: i.reason || "" }; saveP(p); return { status: p.status }; }
    inv("INV_05", !(p.measureType.executorRole === "现场维护" && (i.auto || (i.executor && i.executor.role === "优化本体"))), "天馈类措施不得自动执行：须人工确认并派给现场维护人员");
    inv("INV_06", ["通过", "调减"].includes(p.impact.result), `周边影响为“${p.impact.result}”的方案不得批准`);
    st(p.status === "待确认", `方案状态“${p.status}”，不能确认派单`);
    const a = p.actions[0], cur = a.param === "mechTilt" ? (facts.antennaState(a.targetKey, S.peekNow()) || {}).antenna : null;
    if (cur && cur.mechTilt !== a.currentValue) { p.status = "草案"; saveP(p); return { rejected: "STALE_FACTS", msg: `方案所依据的天线工参已变化（${a.currentValue}°→${cur.mechTilt}°），退回草案重算`, status: p.status }; }
    const cellKey = cellOf(t), involved = S.links({ rt: "RT_10", from: "OT_PLAN:" + p.planNo }).filter(l => l.to.startsWith("OT_CELL:")).length, vip = ["VIP", "VVIP"].includes(t.sceneLevel);
    const needSup = involved >= 2 || vip, approvals = i.approvals || [];
    hit("RULE", "RULE_W14");
    if (i.decision === "不批准") { p.status = "未批准"; p.approval = { approverRoles: approvals.map(x => x.role), decision: "不批准", time: S.peekNow(), reason: i.reason || "" }; saveP(p); return { status: p.status }; }
    if (needSup && !approvals.some(x => x.role === "优化主管")) return { rejected: "SUPERVISOR_REQUIRED", msg: `作用于 ${involved} 个小区${vip ? "（VIP／VVIP场景）" : ""}，须追加优化主管批准`, status: p.status };
    const dispatchNo = `DP-${p.planNo}`;
    p.approval = { approverRoles: ["地市优化工程师", ...(needSup ? ["优化主管"] : [])], decision: "批准", time: S.peekNow(), reason: i.reason || "" };
    p.status = "已派单"; p.execution = { dispatchNo, executor: (i.executor && i.executor.name) || "现场维护人员", receipt: "未知" }; saveP(p);
    t.status = "处置中"; saveT(t); return { dispatchNo, status: p.status, supervisor: needSup };
  };

  // ── A_06 回填执行信息：实际值入天线新版本（生效时间＝实施时间，不是接收时间）；回执缺失记“未知”；来源冲突转人工
  H.A_06 = (i, actor) => {
    const p = plan(i.planNo), t = ticket(p.ticketNo), a = p.actions[0];
    st(["已派单", "未知", "已实施"].includes(p.status) && p.execution && p.execution.dispatchNo === i.dispatchNo, `方案状态“${p.status}”或派单号不符，不能回填`);
    // 重复提交：同值幂等；同一派单号同一目标取值不同按冲突转人工，不覆盖
    if (p.status === "已实施") { const old = p.execution.actualValues && p.execution.actualValues[0], nw = i.actualValues && i.actualValues[0]; if (old && nw && old.value === nw.value) return { deduped: true, status: p.status }; hit("INV", "INV_15", "violation"); throw new ActionError("INV_15", "同一派单号同一目标已回填且取值不同，按冲突转人工，不覆盖"); }
    if (!i.receipt) { p.status = "未知"; p.execution = { ...p.execution, receipt: "未知" }; saveP(p); hit("INV", "INV_08", "violation"); return { receipt: "未知", ticketStatus: t.status, note: "回执缺失：工单留在处置中，不得评估或关闭；先核对原派单记录，不直接重发" }; }
    if (i.receipt === "失败") { p.status = "失败"; p.execution = { ...p.execution, executeTime: i.executeTime, receipt: "失败", actualValues: [] }; saveP(p); return { receipt: "失败", status: p.status }; }
    inv("INV_07", Array.isArray(i.actualValues) && i.actualValues.length > 0 && i.actualValues.every(v => typeof v.value === "number"), "缺现场实际值，不得记为已实施（不得用计划值代替）");
    const av = i.actualValues[0];
    let conflict = false;
    if (a.param === "mechTilt") {
      const base = S.doc("OT_ANTENNA", a.targetKey), eff = i.executeTime;
      S.putObject("OT_ANTENNA", a.targetKey, { ...base, mechTilt: av.value, effectiveTime: eff }, { eff, source: "回填" });
      if (typeof i.resourceValue === "number" && i.resourceValue !== av.value) { S.putObject("OT_ANTENNA", a.targetKey, { ...base, mechTilt: i.resourceValue, effectiveTime: eff }, { eff, source: "资源系统" }); conflict = true; hit("INV", "INV_15", "violation"); }
    } else {
      const old = S.links({ rt: "RT_02", from: "OT_CELL:" + a.targetKey })[0];
      S.link("RT_02", "OT_CELL:" + a.targetKey, old.to, { elecTilt: av.value, vBeam: old.props.vBeam, arrayPort: old.props.arrayPort }, { validFrom: i.executeTime, replace: true });
    }
    p.status = "已实施"; p.execution = { dispatchNo: i.dispatchNo, executor: p.execution.executor, executeTime: i.executeTime, receipt: "成功", actualValues: [{ targetKey: a.targetKey, param: a.param, planValue: a.targetValue, value: av.value }] };
    let recheck = null;
    if (av.value !== a.targetValue && !conflict) {   // 实际≠计划：以实际值调 F_10 事后复核
      const delta = +(av.value - a.currentValue).toFixed(1); const pre = new Date(Date.parse(i.executeTime + "Z") - 1000).toISOString().slice(0, 19); recheck = svc.impact(cellOf(t), a.param === "mechTilt" ? "机械" : "电子", delta, pre, delta);
      p.impact = { ...p.impact, checks: [...p.impact.checks, { kind: "事后复核", result: recheck.result, delta, failed: recheck.failed }] };
    }
    saveP(p);
    if (conflict) return { status: p.status, conflict: true, note: "天线工参两来源冲突，状态“冲突”，转人工裁定；裁定前不评估（INV_15）" };
    t.status = "待评估"; saveT(t); return { status: p.status, ticketStatus: t.status, recheck: recheck && recheck.result, failed: recheck && recheck.failed };
  };

  // ── A_07 写入优化效果
  H.A_07 = (i, actor) => {
    const p = plan(i.planNo), t = ticket(p.ticketNo);
    inv("INV_08", p.status === "已实施" && p.execution && p.execution.receipt === "成功", `方案状态“${p.status}”（回执未知或未实施），不得评估`);
    const a = p.actions[0], ast = a.param === "mechTilt" ? facts.antennaState(a.targetKey, S.peekNow()) : { status: "ok" };
    inv("INV_15", ast.status !== "conflict", "天线工参来源冲突，裁定前不评估");
    st(["待评估", "已改善"].includes(t.status), `工单状态“${t.status}”，不能写入效果`);
    const r = svc.effect(t, p, p.execution.executeTime, S.peekNow()); hit("RULE", "RULE_W16"); ["TH09", "TH11", "TH12", "TH13"].forEach(x => hit("TH", x));
    hit("INV", "INV_09", r.status === "待评估" ? "violation" : "pass");
    const n = effects(t.ticketNo).filter(e => e.planNo === p.planNo).length + 1, effectNo = `EF-${t.ticketNo}-R${p.round}-E${n}`;
    const dates = r.daysAfter ? svc.dateRange(addDays(day(p.execution.executeTime), 1), addDays(day(p.execution.executeTime), r.daysAfter)) : [];
    const e = { effectNo, planNo: p.planNo, round: p.round, beforeWindow: { from: t.discovery.window.from, to: t.discovery.window.to, days: t.discovery.window.days }, afterWindow: { from: dates[0] || null, to: dates[dates.length - 1] || null, days: r.daysAfter },
      beforeRatio: r.beforeRatio ?? null, afterRatio: r.afterRatio ?? null, afterHitDays: r.afterHitDays ?? null, improved: r.improved, achieved: r.achieved, sustained: r.sustained, protectionOk: r.protectionOk, protection: r.protection || [], status: r.status, callRef: `F_11@${r.funcVersion}` };
    S.putObject("OT_EFFECT", effectNo, e); S.link("RT_11", "OT_EFFECT:" + effectNo, "OT_PLAN:" + p.planNo); S.link("RT_12", "OT_EFFECT:" + effectNo, "OT_CELL:" + cellOf(t));
    for (const pr of r.protection || []) S.link("RT_13", "OT_EFFECT:" + effectNo, "OT_CELL:" + pr.cell, { role: pr.name.startsWith("MR") ? "同天线小区" : "重叠邻区" });
    if (["改善", "持续有效"].includes(r.status)) { t.status = "已改善"; saveT(t); } else if (["未达标", "未改善", "劣化"].includes(r.status)) { t.status = "改善未解决"; saveT(t); }
    return { effectNo, status: r.status, beforeRatio: r.beforeRatio, afterRatio: r.afterRatio, afterHitDays: r.afterHitDays, improved: r.improved, achieved: r.achieved, sustained: r.sustained, protectionOk: r.protectionOk, daysAfter: r.daysAfter, reason: r.reason, ticketStatus: t.status, protection: r.protection };
  };

  // ── A_08 关闭工单：只有“持续有效”才能关，优化本体无权关闭
  H.A_08 = (i, actor) => {
    const t = ticket(i.ticketNo), es = effects(t.ticketNo), last = es[es.length - 1];
    inv("INV_10", !!last && last.status === "持续有效" && last.sustained === true, `持续有效为${last ? (last.sustained === null ? "空" : last.sustained) : "空"}，工单不得关闭`);
    st(t.status === "已改善", `工单状态“${t.status}”，不能关闭`);
    t.status = "已关闭"; saveT(t); return { status: t.status };
  };

  // ── A_09 历史案例入库：失败与证据不足同样入库
  H.A_09 = (i, actor) => {
    const e = S.doc("OT_EFFECT", i.effectNo) || nf("优化效果", i.effectNo), ap = i.applicability || {};
    if (e.status === "待评估") throw new ActionError("STATE", "效果尚未评定，不入库");
    if (!["rat", "siteType", "sceneLevel", "causeFamily"].every(k => ap[k])) throw new ActionError("APPLICABILITY_REQUIRED", "缺适用条件（制式、站点类型、场景等级、原因族），拒绝入库");
    const p = plan(e.planNo), outcome = e.status === "持续有效" ? "有效可复现" : e.status === "改善" ? "证据不足" : "无效", caseNo = `CS-${p.ticketNo}-R${p.round}`;
    hit("INV", "INV_11", "pass");
    S.putObject("OT_CASE", caseNo, { caseNo, sourceTicketNo: p.ticketNo, planNo: p.planNo, effectNo: e.effectNo, applicability: ap, measureType: p.measureType, deltaValue: p.actions[0].deltaValue, outcome, validation: "未验证" });
    S.link("RT_14", "OT_EFFECT:" + e.effectNo, "OT_CASE:" + caseNo); return { caseNo, outcome, validation: "未验证" };
  };

  // ── A_10 只定义、不运行（SPEC：本期只定义，不测）
  H.A_10 = () => { throw new ActionError("DEFINED_ONLY", "A_10 回退方案本期只定义、不运行（SPEC 3.5）"); };

  // ── A_11 裁定工参冲突
  H.A_11 = (i, actor) => {
    const st = facts.antennaState(i.antennaId, S.peekNow());
    inv("INV_15", !!st && st.status === "conflict", "无未裁定的工参冲突");
    inv("INV_15", !!i.reason, "裁定须写明理由");
    const ch = st.sources.find(s => s.source === i.chosenSource); inv("INV_15", !!ch, "所选来源不在冲突的两个来源之内");
    const base = S.doc("OT_ANTENNA", i.antennaId);
    S.putObject("OT_ANTENNA", i.antennaId, { ...base, mechTilt: ch.mechTilt, effectiveTime: st.eff }, { eff: st.eff, source: "ruling" });
    for (const p of S.list("OT_PLAN").filter(x => x.status === "已实施" && x.actions[0].targetKey === i.antennaId)) { const t = ticket(p.ticketNo); if (t.status === "处置中") { t.status = "待评估"; saveT(t); } }
    return { antennaId: i.antennaId, ruling: i.chosenSource, mechTilt: ch.mechTilt, by: actor.name || actor.role, reason: i.reason };
  };

  return H;
}

// 动作入口：角色校验→（事务内）执行→审计。拒绝与成功都留痕；返回 {ok, code, msg, result}
function makeAct(app, H) {
  const { ont, store: S, tracker: T } = app;
  return function act(actionId, input = {}, actor = { role: "优化本体" }) {
    if (!H[actionId]) throw new Error("未定义的动作：" + actionId);
    const def = ont.action(actionId); if (T) T.hit("A", actionId);
    const target = input.ticketNo || input.planNo || input.effectNo || input.cellKey || input.antennaId || null, t0 = S.peekNow();
    const log = (outcome, code, msg, result) => S.addRun({ actionId, actor: actor.name || actor.role, role: actor.role, target, input, outcome, code, msg, result, t: t0 });
    try {
      if (!def.roles.includes(actor.role)) throw new ActionError("PERMISSION_DENIED", `角色“${actor.role}”无权执行 ${actionId}（SPEC 允许：${def.roles.join("／")}）`);
      const res = S.tx(() => H[actionId](input, actor));
      if (res && res.rejected) { log("rejected", res.rejected, res.msg, res); return { ok: false, code: res.rejected, msg: res.msg, result: res }; }
      log("ok", null, null, res); return { ok: true, result: res };
    } catch (e) {
      if (!(e instanceof ActionError)) throw e;
      log("rejected", e.code, e.message, null); return { ok: false, code: e.code, msg: e.message };
    }
  };
}
module.exports = { makeActions, makeAct, ActionError };
