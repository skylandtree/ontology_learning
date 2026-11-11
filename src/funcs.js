// 函数 F_01～F_11：纯计算，不读写存储；公式与门限取自 SPEC（参数经 ontology.param 读取）。F_12 需要读取对象，见 funcservice.js。
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const r1 = x => (x === Infinity || x === null ? x : Math.round(x * 10) / 10);
const r2 = x => (x === null ? x : Math.round(x * 100) / 100);
const r4 = x => (x === null ? x : Math.round(x * 10000) / 10000);
const isNum = x => typeof x === "number" && Number.isFinite(x);

function makeFuncs(ont, tracker) {
  const P = k => ont.param(k), api = {};
  const wrap = (funcId, o) => ({ funcId, funcVersion: ont.func(funcId).version, ...o });

  function F01(a, b) {   // 站间距（haversine）
    if (!a || !b || ![a.lat, a.lon, b.lat, b.lon].every(isNum)) return wrap("F_01", { distance: null, reason: "坐标缺失" });
    const R = P("earthRadiusM"), dla = rad(b.lat - a.lat), dlo = rad(b.lon - a.lon);
    const h = Math.sin(dla / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlo / 2) ** 2, d = 2 * R * Math.asin(Math.sqrt(h));
    return wrap("F_01", { distance: r1(d), _distance: d });
  }
  function F02(h, theta, beta, rat = "LTE") {   // 理论覆盖半径（简化平地模型，TH15）
    if (rat !== "LTE") return wrap("F_02", { valid: false, reason: "NR 理论半径公式未定义（规则缺口，H6）" });
    if (![h, theta, beta].every(isNum) || h <= 0 || theta <= 0 || beta <= 0 || theta + beta / 2 >= 90) return wrap("F_02", { valid: false, reason: "输入缺失或无效" });
    const far = theta - beta / 2 <= 0 ? Infinity : h / Math.tan(rad(theta - beta / 2));
    return wrap("F_02", { valid: true, rNear: r1(h / Math.tan(rad(theta + beta / 2))), rFar: r1(far), _rFar: far });
  }
  function F03(mech, elec) { const ok = isNum(mech) && isNum(elec); return wrap("F_03", { total: ok ? r2(mech + elec) : null, _total: ok ? mech + elec : null }); }
  function F04(h, beta, Rt) {
    if (![h, beta, Rt].every(isNum) || h <= 0 || beta <= 0 || Rt <= 0) return wrap("F_04", { thetaT: null, reason: "输入缺失或无效" });
    const t = deg(Math.atan(h / Rt)) + beta / 2; return wrap("F_04", { thetaT: r2(t), _thetaT: t });
  }
  // F_05 单日命中：mr＝OT_CELL_MR 文档（含 mrKey、version）；当天无实例或无对应规则→未知，不是“否”
  function F05(date, mr, rule) {
    if (!rule) return wrap("F_05", { date, hit: "未知", ratio: null, reason: "无对应派单规则（规则缺口）" });
    if (!mr || !isNum(mr.sampleTotal) || !isNum(mr.sampleWeak)) return wrap("F_05", { date, hit: "未知", ratio: null, reason: "当天无OT_CELL_MR实例" });
    const ratio = mr.sampleTotal > 0 ? mr.sampleWeak / mr.sampleTotal : null;
    const weakOk = mr.sampleWeak >= rule.minWeakSamples, ratioOk = ratio !== null && ratio >= rule.minWeakRatio - 1e-12;
    const why = [!weakOk && `弱覆盖采样点 ${mr.sampleWeak}＜${rule.minWeakSamples}`, !ratioOk && "弱覆盖占比低于门限"].filter(Boolean).join("；");
    return wrap("F_05", { date, mrKey: mr.mrKey, version: mr.version, sampleTotal: mr.sampleTotal, sampleWeak: mr.sampleWeak, ratio: r4(ratio), weakOk, ratioOk, hit: weakOk && ratioOk ? "是" : "否", reason: why || undefined });
  }
  // F_06 发现判定：命中≥N天→达到；命中＋未知＜N天→未达到；其余→证据不足。窗口末日给出 problemKey（仅“达到”）
  function F06(cellKey, daily, rule, window) {
    const base = { cellKey, window, days: daily.length, ruleId: rule && rule.ruleId };
    if (!rule) return wrap("F_06", { ...base, verdict: "证据不足", reason: "无对应派单规则（规则缺口），不套用其他场景门限", hitDays: 0, hitDates: [], unknownDates: daily.map(d => d.date), missDates: [], evidenceRefs: [], daily });
    const pick = v => daily.filter(d => d.hit === v).map(d => d.date), hitDates = pick("是"), unknownDates = pick("未知"), need = rule.minHitDays;
    const verdict = hitDates.length >= need ? "达到派单条件" : hitDates.length + unknownDates.length < need ? "未达到派单条件" : "证据不足";
    return wrap("F_06", { ...base, verdict, ruleVersion: rule.ruleVersion, dispatchProblem: rule.dispatchProblem, problemType: rule.problemType, minHitDays: need, hitDays: hitDates.length, hitDates, unknownDates, missDates: pick("否"),
      problemKey: verdict === "达到派单条件" ? `${cellKey}@${rule.problemType}@${window.to}` : undefined,
      reason: verdict === "证据不足" ? `命中 ${hitDates.length} 天，另有 ${unknownDates.length} 天无MR数据，无法判定是否达到 ${need} 天` : undefined,
      evidenceRefs: daily.filter(d => d.mrKey).map(d => ({ mrKey: d.mrKey, version: d.version })), daily });
  }
  function F07(weakDates, alarms, alarmRefs = []) {   // 假性弱覆盖：告警区间与命中日重合（TH07）
    if (!weakDates.length) return wrap("F_07", { verdict: "不适用", overlap: 0, share: null, alarmRefs });
    const ov = weakDates.filter(d => alarms.some(a => d >= a.start && d <= a.end)).length, share = ov / weakDates.length;
    let verdict = "无重合"; if (share >= P("falseWeakShare") - 1e-12) verdict = "排除"; else if (share > 0) verdict = "部分重合";
    return wrap("F_07", { verdict, overlap: ov, weakCount: weakDates.length, share: r4(share), alarmRefs });
  }
  function F08(f) {   // 下倾角过小命中（顺序见 SPEC“函数填写要求”）
    const base = { cellKey: f.cellKey, rat: f.rat };
    if (f.status === "conflict") return wrap("F_08", { ...base, match: "冲突", missing: [], reason: "工参来源冲突，转人工裁定（INV_15）" });
    if (f.status === "pending_backfill") return wrap("F_08", { ...base, match: "未知", missing: [], reason: "天线机械下倾待现场回填，计划值不得代替实际值（INV_07）" });
    if (f.rat !== "LTE") return wrap("F_08", { ...base, match: "未知", missing: [], reason: "NR 理论半径与推荐下倾公式未定义（规则缺口），不套用 LTE 公式" });
    if (f.siteType === "室分") return wrap("F_08", { ...base, match: "未知", missing: [], reason: "室分小区不适用宏站天线下倾角模型" });
    const missing = [["antenna.height", f.h], ["antenna.mechTilt", f.mechTilt], ["RT_02.elecTilt", f.elecTilt], ["RT_02.vBeam", f.vBeam], ["cell.targetRadius", f.Rt]].filter(([, v]) => !isNum(v)).map(([k]) => k);
    if (missing.length) return wrap("F_08", { ...base, match: "未知", missing, reason: "缺必需输入，证据不足（不判不命中）" });
    const tot = F03(f.mechTilt, f.elecTilt)._total, geo = F02(f.h, tot, f.vBeam), tt = F04(f.h, f.vBeam, f.Rt), gap = tt._thetaT - tot, others = [];
    if (isNum(f.rsPower) && isNum(f.rsPowerPlan) && f.rsPower < f.rsPowerPlan) others.push("发射功率");
    if (isNum(f.azimuthDeviationDeg) && f.azimuthDeviationDeg > P("azimuthDevThreshold")) others.push("覆盖方向偏差");
    if (f.obstructionEvidence === "是") others.push("周边遮挡");
    const match = gap > P("eps") ? "命中" : "不命中";
    return wrap("F_08", { ...base, match, totalTilt: r2(tot), thetaTarget: tt.thetaT, deficit: r2(gap), _deficit: gap, rNear: geo.rNear, rFar: geo.rFar, otherCauses: others, missing: [],
      role: match === "命中" ? "主因：弱覆盖小区天线下倾角过小" + (others.length ? "；次因：" + others.join("、") : "") : "不命中，转其他原因族" });
  }
  function F09(gap, adjustType) {   // 单次幅度与轮次（RULE_W14，INV_13）
    const res = P("tiltResolution")[adjustType], max = P("maxStep");
    if (!isNum(gap) || gap <= 0) return wrap("F_09", { executable: false, delta: 0, rounds: 0, reason: "未命中，不生成方案" });
    const delta = +(Math.floor(Math.min(gap, max) / res + 1e-9) * res).toFixed(1);
    return wrap("F_09", { executable: delta > 0, delta, rounds: Math.ceil(gap / max - 1e-9), adjustType, resolution: res, reason: delta > 0 ? undefined : "缺口小于调节分辨率" });
  }
  function F10(inp) {   // 周边影响评估（RULE_W13；范围由调整方式决定，INV_12）
    const res = P("tiltResolution")[inp.adjustType], rf = (o, d) => { const g = F02(o.h, o.total + d, o.beta); return g.valid ? g._rFar : null; };
    const unevaluated = inp.neighbors.filter(n => n.missing && n.missing.length).map(n => n.cellKey);
    function evaluate(d) {
      const checks = []; let ok = true;
      for (const c of inp.scope) { const after = rf(c, d), before = rf(c, 0), pass = after !== null && after >= c.Rt; ok = ok && pass; checks.push({ kind: "远端覆盖", cell: c.cellKey, before: r1(before), after: r1(after), targetRadius: c.Rt, pass }); }
      const tB = rf(inp.target, 0), tA = rf(inp.target, d);
      for (const n of inp.neighbors) {
        if (n.missing && n.missing.length) { checks.push({ kind: "重叠指数", neighbor: n.cellKey, result: "未评估", missing: n.missing }); continue; }
        const rn = rf(n, 0), before = Math.max(0, tB + rn - n.distance), after = Math.max(0, tA + rn - n.distance), pass = after <= before + 1e-9; ok = ok && pass;
        checks.push({ kind: "重叠指数", neighbor: n.cellKey, distance: r1(n.distance), before: r1(before), after: r1(after), pass });
      }
      return { ok, checks };
    }
    const affectedCells = inp.scope.map(c => c.cellKey);
    if (inp.fixedDelta !== undefined) { const e = evaluate(inp.fixedDelta); return wrap("F_10", { result: unevaluated.length ? "未评估" : e.ok ? "通过" : "不通过", mode: "recheck", delta: inp.fixedDelta, affectedCells, checks: e.checks, failed: e.checks.filter(c => c.pass === false) }); }
    const steps = Math.round(inp.planDelta / res), attempts = [];
    for (let k = steps; k >= 1; k--) {
      const d = +(k * res).toFixed(1), e = evaluate(d); attempts.push({ delta: d, pass: e.ok });
      if (e.ok) return wrap("F_10", { result: unevaluated.length ? "未评估" : d === inp.planDelta ? "通过" : "调减", deltaPlan: inp.planDelta, deltaFinal: d, affectedCells, attempts, checks: e.checks, unevaluated });
    }
    return wrap("F_10", { result: "不通过", deltaPlan: inp.planDelta, deltaFinal: null, affectedCells, attempts, checks: evaluate(inp.planDelta).checks, unevaluated });
  }
  // F_11 效果：before＝{total[],weak[]}（取工单 discovery.evidenceRefs 所指版本）；after＝{dates[],total[],weak[]}（实施日次日起连续有数据的天）
  function F11(inp) {
    const sum = a => a.reduce((s, x) => s + x, 0), rule = inp.rule, n = rule ? rule.windowDays : 0, daysAfter = inp.after.dates.length;
    if (!rule || daysAfter < Math.max(P("effectMinDaysAfter"), n) || !inp.before.total.length)
      return wrap("F_11", { status: "待评估", daysAfter, improved: null, achieved: null, sustained: null, protectionOk: null, reason: !rule ? "无对应派单规则" : "后窗MR不足7天（或前窗无数据）" });
    const at = k => ({ sampleTotal: inp.after.total[k], sampleWeak: inp.after.weak[k] });
    const win = k => F06(inp.cellKey, [...Array(n).keys()].map(i => F05(inp.after.dates[k + i], at(k + i), rule)), rule, { from: inp.after.dates[k], to: inp.after.dates[k + n - 1], days: n });
    const b = sum(inp.before.weak) / sum(inp.before.total), a = sum(inp.after.weak.slice(0, n)) / sum(inp.after.total.slice(0, n)), first = win(0);
    const improved = b - a >= P("effectMinDelta") - 1e-12, achieved = first.verdict === "未达到派单条件";
    const prot = (inp.protection || []).map(p => ({ ...p, pass: (p.worseIfHigher ? p.after - p.before : p.before - p.after) <= P("protectionTolerance") + 1e-12 }));
    const protectionOk = !prot.length ? null : prot.every(p => p.pass), sus = P("effectSustainDays");
    let sustained = null; if (daysAfter >= sus) { sustained = true; for (let k = 0; k + n <= sus; k++) if (win(k).verdict !== "未达到派单条件") sustained = false; }
    const status = protectionOk === false ? "劣化" : improved && achieved ? (sustained === true ? "持续有效" : "改善") : improved ? "未达标" : "未改善";
    return wrap("F_11", { status, beforeRatio: r4(b), afterRatio: r4(a), afterHitDays: first.hitDays, afterHitDates: first.hitDates, improved, achieved, sustained, protectionOk, protection: prot, daysAfter });
  }
  const raw = { F01, F02, F03, F04, F05, F06, F07, F08, F09, F10, F11 };
  for (const [k, fn] of Object.entries(raw)) api[k] = (...a) => { const id = k.replace("F", "F_"); if (tracker) tracker.hit("F", id); return fn(...a); };
  api.round = { r1, r2, r4 };
  return api;
}
module.exports = { makeFuncs };
