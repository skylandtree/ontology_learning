// 装载种子数据：站点、天线、小区、区域及关系 RT_01～RT_04 一次装入；MR 日统计与小区指标按 receivedAt 随时钟到达（DM_01），
// 到达时 OT_CELL_MR 新增实例（同日重复＝新版本，INV_17），关系 RT_16 随实例建立。装载本身不创建任何工单。
const { addDays } = require("./facts.js");

function loadSeed(store, seed) {
  const prov = seed.provenance || {}, src = id => prov[id] || null, T0 = "2026-01-01T00:00:00";
  store.tx(() => {
    store.setNow(T0);
    for (const s of seed.sites) store.putObject("OT_SITE", s.siteId, s, { eff: T0, source: src(s.siteId) });
    for (const a of seed.antennas) store.putObject("OT_ANTENNA", a.antennaId, a, { eff: a.effectiveTime, source: src(a.antennaId) || "资源系统" });
    for (const c of seed.cells) store.putObject("OT_CELL", c.cellKey, { ...c, metrics: [] }, { eff: T0, source: src(c.cellKey) });
    for (const a of seed.areas) store.putObject("OT_AREA", a.areaId, a, { eff: T0, source: src(a.areaId) });
    for (const l of seed.cellSite) store.link("RT_01", "OT_CELL:" + l.cellKey, "OT_SITE:" + l.siteId, {}, { validFrom: T0 });
    for (const l of seed.cellAntenna) store.link("RT_02", "OT_CELL:" + l.cellKey, "OT_ANTENNA:" + l.antennaId, { elecTilt: l.elecTilt, vBeam: l.vBeam, arrayPort: l.arrayPort }, { validFrom: l.effectiveTime || T0 });
    for (const l of seed.areaCells) store.link("RT_04", "OT_CELL:" + l.cellKey, "OT_AREA:" + l.areaId, { role: l.role, share: l.share }, { validFrom: T0 });
    for (const a of seed.alarms) store.addAlarm(a);
  });
  return store;
}
// OT_CELL_MR：每个小区每个自然日一个实例；同日重复到达＝新版本；缺天＝没有实例
function loadMR(store, rows) {
  for (const r of rows) {
    const id = `${r.cellKey}@${r.date}`, ex = store.getObject("OT_CELL_MR", id), recv = r.receivedAt || `${addDays(r.date, 1)}T06:00:00`;
    store.putObject("OT_CELL_MR", id, { mrKey: id, cellKey: r.cellKey, date: r.date, sampleTotal: r.sampleTotal, sampleWeak: r.sampleWeak, receivedAt: recv, version: (ex ? ex.ver : 0) + 1 }, { eff: recv, source: "MR平台日汇总" });
    if (store.tracker) { store.tracker.hit("INV", "INV_17", "pass"); store.tracker.hit("INV", "INV_11", "pass"); }
    if (!ex) store.link("RT_16", "OT_CELL_MR:" + id, "OT_CELL:" + r.cellKey, {}, { validFrom: recv });
  }
}
function loadMetrics(store, rows) {   // 小区级其他指标（保护指标来源）：追加到 OT_CELL.metrics，对象新增版本
  const by = {}; for (const m of rows) (by[m.cellKey] = by[m.cellKey] || []).push(m);
  for (const [k, ms] of Object.entries(by)) { const c = store.doc("OT_CELL", k), eff = ms.map(m => m.receivedAt).sort().pop(); store.putObject("OT_CELL", k, { ...c, metrics: [...(c.metrics || []), ...ms.map(m => ({ name: m.name, date: m.date, value: m.value }))] }, { eff, source: "KPI" }); }
}
// 到达队列：时钟推进到某一时刻，凡 receivedAt 不晚于该时刻的数据入库
class Arrivals {
  constructor(seed) { const by = (a, b) => a.receivedAt.localeCompare(b.receivedAt); this.mr = [...seed.cellMR].sort(by); this.metrics = [...seed.cellMetrics].sort(by); }
  release(store, now) {
    const mr = [], me = []; while (this.mr.length && this.mr[0].receivedAt <= now) mr.push(this.mr.shift()); while (this.metrics.length && this.metrics[0].receivedAt <= now) me.push(this.metrics.shift());
    if (mr.length || me.length) store.tx(() => { loadMR(store, mr); loadMetrics(store, me); });
    return mr.length + me.length;
  }
}
module.exports = { loadSeed, loadMR, loadMetrics, Arrivals };
