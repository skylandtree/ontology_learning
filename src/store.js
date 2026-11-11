// 存储层（node:sqlite）：对象按版本追加（历史不覆盖，可按生效时点读回）、关系带有效期、动作审计。
// 告警是 SPEC 规定的“来源事实，不入本体”，单独存表，只经诊断记录的 inputRefs／evidenceRefs 引用。
const { DatabaseSync } = require("node:sqlite");
const addSec = (s, n) => new Date(Date.parse(s + "Z") + n * 1000).toISOString().slice(0, 19);

class Store {
  constructor(ont, tracker) {
    this.ont = ont; this.tracker = tracker; this.db = new DatabaseSync(":memory:");
    this.db.exec(`
      CREATE TABLE objects(type TEXT, id TEXT, ver INTEGER, eff TEXT, sys TEXT, source TEXT, doc TEXT, PRIMARY KEY(type,id,ver));
      CREATE TABLE links(lid INTEGER PRIMARY KEY AUTOINCREMENT, rt TEXT, from_id TEXT, to_id TEXT, props TEXT, valid_from TEXT, valid_to TEXT, sys TEXT);
      CREATE INDEX ix_l ON links(rt, from_id); CREATE INDEX ix_lt ON links(rt, to_id);
      CREATE TABLE alarms(rid INTEGER PRIMARY KEY AUTOINCREMENT, cell TEXT, type TEXT, start_date TEXT, end_date TEXT, recv TEXT);
      CREATE TABLE runs(run_id TEXT PRIMARY KEY, action_id TEXT, actor TEXT, role TEXT, target TEXT, input TEXT, outcome TEXT, code TEXT, msg TEXT, result TEXT, t TEXT);`);
    this._base = null; this._tx = false;
  }
  close() { this.db.close(); }
  setNow(iso) { this._base = iso; }
  now() { if (!this._base) return new Date().toISOString().slice(0, 19); const t = this._base; this._base = addSec(this._base, 1); return t; }
  peekNow() { return this._base || new Date().toISOString().slice(0, 19); }
  tx(fn) {
    if (this._tx) return fn();
    this.db.exec("BEGIN"); this._tx = true;
    try { const r = fn(); this.db.exec("COMMIT"); this._tx = false; return r; } catch (e) { this.db.exec("ROLLBACK"); this._tx = false; throw e; }
  }

  // ── 对象
  putObject(type, id, doc, opt = {}) {
    this.ont.validate(type, doc); if (this.tracker) this.tracker.hit("OT", type);
    const last = this.db.prepare("SELECT MAX(ver) v FROM objects WHERE type=? AND id=?").get(type, id).v || 0, sys = this.now();
    this.db.prepare("INSERT INTO objects VALUES (?,?,?,?,?,?,?)").run(type, id, last + 1, opt.eff || sys, sys, opt.source || null, JSON.stringify(doc));
    return last + 1;
  }
  getObject(type, id, opt = {}) {
    const q = opt.asOf ? "SELECT * FROM objects WHERE type=? AND id=? AND eff<=? ORDER BY eff DESC, ver DESC LIMIT 1" : "SELECT * FROM objects WHERE type=? AND id=? ORDER BY ver DESC LIMIT 1";
    const r = opt.ver ? this.db.prepare("SELECT * FROM objects WHERE type=? AND id=? AND ver=?").get(type, id, opt.ver) : opt.asOf ? this.db.prepare(q).get(type, id, opt.asOf) : this.db.prepare(q).get(type, id);
    if (r && this.tracker) this.tracker.hit("OT", type);
    return r ? { doc: JSON.parse(r.doc), ver: r.ver, eff: r.eff, sys: r.sys, source: r.source } : null;
  }
  // 任何就地改写都被拒绝：OT_CELL_MR 只追加（INV_17），其余对象历史不覆盖（INV_11）
  overwrite(type, id) {
    const code = type === "OT_CELL_MR" ? "INV_17" : "INV_11";
    if (this.tracker) this.tracker.hit("INV", code, "violation");
    const e = new Error(`${code}：${type} 版本只追加，不允许就地改写 ${id}`); e.code = code; throw e;
  }
  doc(type, id, opt) { const o = this.getObject(type, id, opt); return o && o.doc; }
  history(type, id) { return this.db.prepare("SELECT * FROM objects WHERE type=? AND id=? ORDER BY ver").all(type, id).map(r => ({ ver: r.ver, eff: r.eff, sys: r.sys, source: r.source, doc: JSON.parse(r.doc) })); }
  list(type) {
    if (this.tracker) this.tracker.hit("OT", type);
    return this.db.prepare("SELECT o.* FROM objects o JOIN (SELECT id, MAX(ver) mv FROM objects WHERE type=? GROUP BY id) m ON o.id=m.id AND o.ver=m.mv WHERE o.type=? ORDER BY o.id").all(type, type).map(r => ({ id: r.id, ver: r.ver, source: r.source, ...JSON.parse(r.doc) }));
  }
  count(type) { return this.db.prepare("SELECT COUNT(DISTINCT id) c FROM objects WHERE type=?").get(type).c; }
  ids(type) { return this.db.prepare("SELECT DISTINCT id FROM objects WHERE type=? ORDER BY id").all(type).map(r => r.id); }
  // 按时点列出（每条取 eff≤asOf 的最新版本）；接口层的 as-of 查询用
  listAt(type, asOf) {
    if (this.tracker) this.tracker.hit("OT", type);
    return this.ids(type).map(id => this.getObject(type, id, { asOf })).filter(Boolean).map(o => ({ doc: o.doc, ver: o.ver, eff: o.eff, source: o.source }));
  }

  // ── 关系（端点写成 "OT_X:id"；类型由 SPEC 校验）
  link(rt, from, to, props = {}, opt = {}) {
    this.ont.checkLink(rt, from.split(":")[0], to.split(":")[0]); if (this.tracker) this.tracker.hit("RT", rt);
    const sys = this.now(), vf = opt.validFrom || sys;
    if (opt.replace) this.db.prepare("UPDATE links SET valid_to=? WHERE rt=? AND from_id=? AND to_id=? AND valid_to IS NULL").run(vf, rt, from, to);
    return Number(this.db.prepare("INSERT INTO links(rt,from_id,to_id,props,valid_from,valid_to,sys) VALUES (?,?,?,?,?,NULL,?)").run(rt, from, to, JSON.stringify(props), vf, sys).lastInsertRowid);
  }
  links({ rt, from, to, asOf }) {
    if (this.tracker && rt) this.tracker.hit("RT", rt);
    const w = [], a = [];
    if (rt !== undefined && rt !== null) { w.push("rt=?"); a.push(rt); }
    if (!w.length) w.push("1=1");
    if (from !== undefined) { w.push("from_id=?"); a.push(from); }
    if (to !== undefined) { w.push("to_id=?"); a.push(to); }
    if (asOf) { w.push("valid_from<=?"); a.push(asOf); w.push("(valid_to IS NULL OR valid_to>?)"); a.push(asOf); } else w.push("valid_to IS NULL");
    return this.db.prepare(`SELECT * FROM links WHERE ${w.join(" AND ")} ORDER BY lid`).all(...a).map(r => ({ lid: r.lid, rt: r.rt, from: r.from_id, to: r.to_id, props: JSON.parse(r.props), validFrom: r.valid_from, validTo: r.valid_to }));
  }

  // ── 告警（来源事实）
  addAlarm(a) { this.db.prepare("INSERT INTO alarms(cell,type,start_date,end_date,recv) VALUES (?,?,?,?,?)").run(a.cell, a.type, a.startDate, a.endDate, this.now()); }
  alarms(cell) { return this.db.prepare("SELECT * FROM alarms WHERE cell=? ORDER BY rid").all(cell).map(r => ({ id: r.rid, cell: r.cell, type: r.type, startDate: r.start_date, endDate: r.end_date })); }

  // ── 动作审计（成功、拒绝都留痕）
  addRun(r) {
    const id = `AR-${String(this.db.prepare("SELECT COUNT(*) c FROM runs").get().c + 1).padStart(5, "0")}`;
    this.db.prepare("INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(id, r.actionId, r.actor || null, r.role || null, r.target || null, JSON.stringify(r.input || {}), r.outcome, r.code || null, r.msg || null, JSON.stringify(r.result || null), r.t);
    return id;
  }
  runs(f = {}) {
    return this.db.prepare("SELECT * FROM runs ORDER BY run_id").all().filter(r => (!f.target || r.target === f.target) && (!f.actionId || r.action_id === f.actionId))
      .map(r => ({ runId: r.run_id, actionId: r.action_id, actor: r.actor, role: r.role, target: r.target, input: JSON.parse(r.input), outcome: r.outcome, code: r.code, msg: r.msg, result: JSON.parse(r.result), t: r.t }));
  }
}
module.exports = { Store, addSec };
