// 事实读取：沿本体对象与关系取函数所需的输入（按判断时点 as-of 读回当时有效的版本）。
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const day = iso => iso.slice(0, 10);
const idOf = s => s.slice(s.indexOf(":") + 1);   // "OT_CELL:LTE:xxx" → "LTE:xxx"（小区标识本身含冒号）

class Facts {
  constructor(store, ont, F, tracker, seed) { this.s = store; this.ont = ont; this.F = F; this.t = tracker; this.seed = seed; }
  addDays(d, n) { return addDays(d, n); }
  // 窗口＝判断时点所在日之前的 N 个自然日（RULE_F01）
  windowOf(refTime, days = 7) { const to = addDays(day(refTime), -1), dates = [...Array(days).keys()].map(i => addDays(to, i - days + 1)); return { from: dates[0], to, days, dates }; }
  cell(cellKey, asOf) { return this.s.doc("OT_CELL", cellKey, asOf ? { asOf } : undefined); }
  siteOf(cellKey, asOf) { const l = this.s.links({ rt: "RT_01", from: "OT_CELL:" + cellKey, asOf })[0]; return l ? this.s.doc("OT_SITE", l.to.split(":")[1]) : null; }
  ruleFor(cellKey, asOf) {   // 按“制式×站点类型×场景等级”选规则；缺 → 规则缺口
    const cell = this.cell(cellKey, asOf), site = cell && this.siteOf(cellKey, asOf);
    if (!cell) return { cell: null, site: null, rule: null, gap: "小区不存在" };
    if (!site || !site.siteType) return { cell, site, rule: null, gap: "站点类型未知" };
    const rule = cell.sceneLevel ? this.ont.dispatchRule(cell.rat, site.siteType, cell.sceneLevel) : null;
    return { cell, site, rule, gap: rule ? null : (cell.sceneLevel ? `[派单规则]无 ${cell.rat}×${site.siteType}×${cell.sceneLevel} 的规则（规则缺口）` : "场景等级缺失（规则缺口）") };
  }
  mr(cellKey, date, ver) { return this.s.getObject("OT_CELL_MR", `${cellKey}@${date}`, ver ? { ver } : undefined); }
  // 逐日 F_05；pinned＝[{mrKey,version}] 时按指定版本读（效果前窗取发现快照所引用的版本，INV_17）
  daily(cellKey, dates, rule, pinned) {
    return dates.map(d => {
      const pin = pinned && pinned.find(p => p.mrKey === `${cellKey}@${d}`), o = this.mr(cellKey, d, pin && pin.version);
      return this.F.F05(d, o && { ...o.doc, mrKey: `${cellKey}@${d}`, version: o.ver }, rule);
    });
  }
  neighbors(cellKey) { const c = this.cell(cellKey); if (this.t) this.t.hit("RT", "RT_03"); return c ? (c.neighbors || []) : []; }
  antennaLink(cellKey, asOf) { const l = this.s.links({ rt: "RT_02", from: "OT_CELL:" + cellKey, asOf })[0]; return l ? { antennaId: l.to.split(":")[1], ...l.props, validFrom: l.validFrom } : null; }
  cellsOnAntenna(antennaId, asOf) { return this.s.links({ rt: "RT_02", to: "OT_ANTENNA:" + antennaId, asOf }).map(l => ({ cellKey: idOf(l.from), ...l.props })); }
  // 天线状态：取判断时点最新生效日的版本；同生效日有不同来源且取值不同、又无裁定 → 冲突（INV_15）；有已派单未回填的方案 → 待回填（INV_07、INV_08）
  antennaState(antennaId, asOf) {
    const hs = this.s.history("OT_ANTENNA", antennaId).filter(h => !asOf || h.eff <= asOf);
    if (!hs.length) return null;
    const eff = hs.reduce((m, h) => h.eff > m ? h.eff : m, ""), grp = hs.filter(h => h.eff === eff), ruling = grp.find(h => h.source === "ruling");
    const pick = ruling || grp[grp.length - 1], srcs = [...new Set(grp.map(g => g.source))], vals = [...new Set(grp.map(g => g.doc.mechTilt))];
    const conflict = !ruling && srcs.length > 1 && vals.length > 1;
    const pending = this.s.list("OT_PLAN").some(p => p.status === "已派单" && (p.actions || []).some(a => a.targetKey === antennaId));
    return { antenna: pick.doc, eff, ver: pick.ver, status: conflict ? "conflict" : pending ? "pending_backfill" : "ok", sources: grp.map(g => ({ source: g.source, mechTilt: g.doc.mechTilt, ver: g.ver })) };
  }
  tiltFacts(cellKey, asOf) {
    const cell = this.cell(cellKey, asOf), site = cell && this.siteOf(cellKey, asOf), al = cell && this.antennaLink(cellKey, asOf), st = al && this.antennaState(al.antennaId, asOf);
    return { cellKey, rat: cell && cell.rat, siteType: site && site.siteType, antennaId: al && al.antennaId, h: st ? st.antenna.height : undefined, mechTilt: st ? st.antenna.mechTilt : undefined,
      elecTilt: al ? al.elecTilt : undefined, vBeam: al ? al.vBeam : undefined, Rt: cell ? cell.targetRadius : undefined, rsPower: cell && cell.rsPower, rsPowerPlan: cell && cell.rsPowerPlan,
      azimuthDeviationDeg: cell && cell.azimuthDeviationDeg, obstructionEvidence: cell && cell.obstructionEvidence, supportsRET: st ? st.antenna.supportsRET : undefined, status: st ? st.status : "ok" };
  }
  geom(cellKey, asOf) { const f = this.tiltFacts(cellKey, asOf), tot = this.F.F03(f.mechTilt, f.elecTilt)._total; return { cellKey, h: f.h, total: tot, beta: f.vBeam, Rt: f.Rt, f }; }
  // 影响范围：机械下倾→天线承载的所有小区；电子下倾→仅目标阵列小区（INV_12、RT_10）
  scope(cellKey, adjustType, asOf) {
    const al = this.antennaLink(cellKey, asOf);
    const keys = adjustType === "机械" ? this.cellsOnAntenna(al.antennaId, asOf).map(c => c.cellKey) : [cellKey];
    return keys.map(k => this.geom(k, asOf));
  }
  overlapNeighbors(cellKey, asOf) {   // 重叠邻区：neighbors 中 overlapWeight＞0；缺工参 → missing（未评估）
    const tS = this.siteOf(cellKey, asOf), cc = this.cell(cellKey, asOf);
    if (cc && !Array.isArray(cc.neighbors)) return [{ cellKey: "(邻区未提供)", overlapWeight: null, distance: null, missing: ["neighbors"] }];
    return this.neighbors(cellKey).filter(n => n.overlapWeight > 0).map(n => {
      const g = this.geom(n.targetCellKey, asOf), site = this.siteOf(n.targetCellKey, asOf), d = this.F.F01(tS, site)._distance;
      const missing = [["antenna.height", g.h], ["totalTilt", g.total], ["RT_02.vBeam", g.beta], ["distance", d]].filter(([, v]) => typeof v !== "number" || !Number.isFinite(v)).map(([k]) => k);
      return { cellKey: n.targetCellKey, overlapWeight: n.overlapWeight, distance: d, h: g.h, total: g.total, beta: g.beta, missing };
    });
  }
  // RULE_G01：目标半径默认＝TH14×最近站间距（可人工覆盖；样例直接给定时以给定值为准）
  defaultTargetRadius(cellKey) {
    if (this.t) { this.t.hit("RULE", "RULE_G01"); this.t.hit("TH", "TH14"); }
    const me = this.siteOf(cellKey), ds = this.s.list("OT_SITE").filter(s => s.siteId !== me.siteId).map(s => this.F.F01(me, s)._distance).filter(Number.isFinite);
    const nearest = Math.min(...ds); return { nearest: this.F.round.r1(nearest), radius: this.F.round.r1(nearest * this.ont.param("targetRadiusK")), k: this.ont.param("targetRadiusK") };
  }
  involved(cellKey, asOf) {   // RT_06：同天线小区（RT_02 派生）＋重叠邻区（RT_03 派生）
    const al = this.antennaLink(cellKey, asOf), same = al ? this.cellsOnAntenna(al.antennaId, asOf).map(c => c.cellKey).filter(k => k !== cellKey) : [];
    return [...same.map(k => ({ cellKey: k, role: "同天线小区" })), ...this.neighbors(cellKey).filter(n => n.overlapWeight > 0).map(n => ({ cellKey: n.targetCellKey, role: "重叠邻区" }))];
  }
  alarmIntervals(cells) { return cells.flatMap(c => this.s.alarms(c).map(a => ({ id: a.id, cell: c, type: a.type, start: a.startDate, end: a.endDate }))); }
  metricMean(cellKey, name, from, to) {
    const c = this.cell(cellKey); if (!c || !c.metrics) return null;
    const xs = c.metrics.filter(m => m.name === name && m.date >= from && m.date <= to).map(m => m.value);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }
  // 现场回填记录（来源事实，不入本体）：按收到时刻到达，receivedAt 不晚于判断时点才算已回报。
  // 未到达的记录单独报 pending，让界面说清"现场还没回话"，而不是拿计划值冒充实际值（INV_07）。
  fieldExecutions(cellKey, asOf) {
    const now = asOf || this.s.peekNow();
    const rows = (this.seed?.fieldExecutions || []).filter(f => f.cellKey === cellKey);
    const items = rows.filter(f => !f.receivedAt || f.receivedAt <= now);
    return { items, pending: rows.filter(f => !items.includes(f)), totalCount: items.length };
  }
  // 方案/效果等业务对象的小工具
  ticketsOf(cellKey) { return this.s.list("OT_TICKET").filter(t => this.s.links({ rt: "RT_05", from: "OT_TICKET:" + t.id }).some(l => l.to === "OT_CELL:" + cellKey)); }
  cellOfTicket(ticketNo) { const l = this.s.links({ rt: "RT_05", from: "OT_TICKET:" + ticketNo })[0]; return l ? idOf(l.to) : null; }
}
module.exports = { Facts, addDays, day, idOf };
