// 函数服务：把 facts 读到的事实组装成各函数的输入，调用 F_01～F_12，返回带函数版本的结果（函数本身不写记录，写入由动作完成）。
const { addDays, day } = require("./facts.js");

class FuncService {
  constructor(store, ont, F, facts, tracker) { this.s = store; this.ont = ont; this.F = F; this.facts = facts; this.t = tracker; }
  hit(kind, id) { if (this.t) this.t.hit(kind, id); }

  // F_05＋F_06：某小区在窗口内是否达到派单条件
  discover(cellKey, refTime) {
    const win = this.facts.windowOf(refTime), { cell, site, rule, gap } = this.facts.ruleFor(cellKey, refTime);
    if (!cell) return { error: "小区不存在", cellKey };
    const daily = this.facts.daily(cellKey, win.dates, rule), f06 = this.F.F06(cellKey, daily, rule, win);
    return { ...f06, rat: cell.rat, siteType: site && site.siteType, sceneLevel: cell.sceneLevel, ruleGap: rule ? null : gap, cellName: cell.cellName };
  }
  // F_12：给定范围批量发现（只读，不读不写工单）
  scan(scope, refTime) {
    this.hit("F", "F_12"); this.hit("RULE", "RULE_F01");
    const win = this.facts.windowOf(refTime), items = scope.map(k => {
      const r = this.discover(k, refTime); if (r.error) return { cellKey: k, verdict: "证据不足", reason: r.error, hitDays: 0, unknownDates: win.dates, evidenceRefs: [] };
      const noData = r.daily.every(d => d.hit === "未知") && !r.ruleGap;
      return { cellKey: k, cellName: r.cellName, rat: r.rat, siteType: r.siteType, sceneLevel: r.sceneLevel, verdict: r.verdict, problemKey: r.problemKey, ruleId: r.ruleId, hitDays: r.hitDays, hitDates: r.hitDates, unknownDates: r.unknownDates,
        evidenceRefs: r.evidenceRefs, note: r.ruleGap ? `规则缺口：${r.ruleGap}` : noData ? "数据缺口：窗口内无任何OT_CELL_MR" : r.reason };
    });
    const order = { 达到派单条件: 0, 证据不足: 1, 未达到派单条件: 2 }, counts = { 达到: 0, 未达到: 0, 证据不足: 0 };
    for (const i of items) counts[i.verdict === "达到派单条件" ? "达到" : i.verdict === "未达到派单条件" ? "未达到" : "证据不足"]++;
    items.sort((a, b) => order[a.verdict] - order[b.verdict] || b.hitDays - a.hitDays || a.cellKey.localeCompare(b.cellKey));
    return { funcId: "F_12", funcVersion: this.ont.func("F_12").version, refTime, window: win, scope, items, counts };
  }
  falseWeak(cellKey, hitDates, asOf) {   // F_07：派单小区及 RT_06 涉及小区的告警
    const cells = [cellKey, ...this.facts.involved(cellKey, asOf).map(x => x.cellKey)], iv = this.facts.alarmIntervals(cells);
    return { ...this.F.F07(hitDates, iv, iv.map(a => `alarm#${a.id}:${a.cell}:${a.type}:${a.start}~${a.end}`)), cells };
  }
  matchTilt(cellKey, asOf) {   // F_08（内部用 F_02／F_03／F_04）
    const f = this.facts.tiltFacts(cellKey, asOf), r = this.F.F08(f);
    this.hit("RULE", "RULE_W06");
    if (r.match === "命中" || r.match === "不命中") { this.hit("F", "F_02"); this.hit("F", "F_03"); this.hit("F", "F_04"); ["TH01", "TH15"].forEach(x => this.hit("TH", x)); }
    return { ...r, inputs: f };
  }
  impact(cellKey, adjustType, planDelta, asOf, fixedDelta) {   // F_10
    const scope = this.facts.scope(cellKey, adjustType, asOf), target = this.facts.geom(cellKey, asOf), neighbors = this.facts.overlapNeighbors(cellKey, asOf);
    const r = this.F.F10({ scope, target, neighbors, adjustType, planDelta, fixedDelta });
    return { ...r, scope: scope.map(s => s.cellKey) };
  }
  // F_11：前窗取工单 discovery.evidenceRefs 所指版本；后窗＝实施日次日起连续有数据的天；保护指标取 RT_13 范围
  effect(ticket, plan, executeTime, refTime) {
    const cellKey = this.facts.cellOfTicket(ticket.ticketNo), d = ticket.discovery, rule = this.ont.raw.dispatchRules.find(r => r.ruleId === d.ruleId) || null;
    const bef = d.evidenceRefs.map(r => this.s.getObject("OT_CELL_MR", r.mrKey, { ver: r.version }).doc);
    const dates = []; for (let x = addDays(day(executeTime), 1), n = 0; n < this.ont.param("effectSustainDays"); x = addDays(x, 1), n++) { if (!this.facts.mr(cellKey, x) || x > day(refTime)) break; dates.push(x); }
    const after = { dates, total: dates.map(x => this.facts.mr(cellKey, x).doc.sampleTotal), weak: dates.map(x => this.facts.mr(cellKey, x).doc.sampleWeak) };
    const bFrom = d.window.from, bTo = d.window.to, aTo = dates[Math.min(dates.length, 7) - 1], protection = [], missing = [];
    for (const inv of this.facts.involved(cellKey, executeTime)) {
      if (inv.role === "同天线小区") {
        const ratio = (from, to, dts) => { let w = 0, t = 0; for (const x of dts) { const o = this.facts.mr(inv.cellKey, x); if (!o) return null; w += o.doc.sampleWeak; t += o.doc.sampleTotal; } return t ? w / t : null; };
        const before = ratio(bFrom, bTo, d.window.dates || this.dateRange(bFrom, bTo)), afterD = dates.slice(0, 7), a = afterD.length === 7 ? ratio(null, null, afterD) : null;
        if (before === null || a === null) missing.push(`${inv.cellKey}:MR弱覆盖占比`);
        else protection.push({ name: `MR弱覆盖占比(${this.facts.cell(inv.cellKey).cellName})`, cell: inv.cellKey, before: this.F.round.r4(before), after: this.F.round.r4(a), worseIfHigher: true });
      } else {
        const before = this.facts.metricMean(inv.cellKey, "实测重叠覆盖度", bFrom, bTo), a = aTo ? this.facts.metricMean(inv.cellKey, "实测重叠覆盖度", dates[0], aTo) : null;
        if (before === null || a === null) missing.push(`${inv.cellKey}:实测重叠覆盖度`);
        else protection.push({ name: `实测重叠覆盖度(${this.facts.cell(inv.cellKey).cellName})`, cell: inv.cellKey, before: this.F.round.r4(before), after: this.F.round.r4(a), worseIfHigher: true });
      }
    }
    let r = this.F.F11({ cellKey, before: { total: bef.map(x => x.sampleTotal), weak: bef.map(x => x.sampleWeak) }, after, rule, protection });
    if (missing.length && r.status !== "待评估") r = { ...r, status: "待评估", protectionOk: null, reason: `保护指标缺数据：${missing.join("、")}` };
    return { ...r, cellKey, protectionMissing: missing };
  }
  dateRange(from, to) { const out = []; for (let x = from; x <= to; x = addDays(x, 1)) out.push(x); return out; }
}
module.exports = { FuncService };
