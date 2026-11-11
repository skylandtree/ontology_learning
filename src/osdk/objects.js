// 对象查询、写入、聚合、集合运算与关系遍历（OSDK 第 3～5、9、10 节）。
// 写入边界与 SPEC 一致：本体对象按版本追加（不就地覆盖），由动作产生的对象（工单、方案、效果、案例）只能经动作写入，
// 前置数据 OT_CELL_MR 只追加（INV_17），任何对象都不允许删除（INV_11）。
const { compile, checkFields } = require("./where.js"), { OsdkError } = require("./errors.js");

const ACTION_OWNED = { OT_TICKET: "A_01～A_08", OT_PLAN: "A_04～A_06", OT_EFFECT: "A_07", OT_CASE: "A_09" };
const AGG_FUNCS = ["COUNT", "SUM", "AVG", "MIN", "MAX"];

function createObjects(app, meta) {
  const { store } = app;
  const type = id => { if (!meta.hasType(id)) throw new OsdkError("OBJECT_NOT_FOUND", `对象类型 ${id} 不在本体中`); return id; };
  const fields = id => meta.fields(id).map(f => f.name);
  const pkOf = id => (meta.schema(id).primaryKey || [])[0];

  function listDocs(id, opt = {}) {
    const rows = opt.asOf ? store.listAt(id, opt.asOf) : store.list(id).map(d => ({ doc: d, ver: d.ver, eff: d.eff, source: d.source }));
    return rows.map(r => ({ doc: r.doc, ver: r.ver, eff: r.eff, source: r.source }));
  }
  const idOf = (id, doc) => doc[pkOf(id)];

  function select(doc, sel) { if (!sel || !sel.length) return { ...doc }; return Object.fromEntries(sel.map(k => [k, doc[k] === undefined ? null : doc[k]])); }

  function query(id, body = {}) {
    type(id); const F = fields(id);
    if (body.select !== undefined && !Array.isArray(body.select)) throw new OsdkError("INVALID_FIELD", "select 应为字段名数组");
    if (body.orderBy !== undefined && !Array.isArray(body.orderBy)) throw new OsdkError("INVALID_FIELD", "orderBy 应为数组");
    const where = compile(body.where, F, "where"), sel = checkFields(body.select, F, "select");
    for (const o of body.orderBy || []) if (!F.includes(o.field)) throw new OsdkError("INVALID_FIELD", `orderBy 含未知字段：${o.field}`);
    let rows = listDocs(id, { asOf: body.asOf }).map(r => ({ ...r, doc: select(r.doc, sel) }));
    rows = rows.filter(r => where(r.doc));
    for (const o of [...(body.orderBy || [])].reverse()) {
      const dir = o.direction === "desc" ? -1 : 1;
      rows.sort((a, b) => { const x = a.doc[o.field], y = b.doc[o.field]; return (x === y ? 0 : x === null || x === undefined ? 1 : y === null || y === undefined ? -1 : x < y ? -1 : 1) * dir; });
    }
    const totalCount = rows.length, offset = body.offset || 0, limit = body.limit === undefined ? 100 : body.limit;
    return { items: rows.slice(offset, offset + limit).map(r => r.doc), totalCount };
  }
  function get(id, key) {
    type(id);
    const o = store.getObject(id, key);
    if (!o) throw new OsdkError("OBJECT_NOT_FOUND", `对象不存在：${id}／${key}`);
    return { item: o.doc, meta: { version: o.ver, effectiveTime: o.eff, systemTime: o.sys, source: o.source } };
  }
  function getAt(id, key, asOf, ver) {
    type(id);
    const o = store.getObject(id, key, ver ? { ver: Number(ver) } : asOf ? { asOf } : {});
    if (!o) throw new OsdkError("OBJECT_NOT_FOUND", `对象不存在：${id}／${key}`);
    return { item: o.doc, meta: { version: o.ver, effectiveTime: o.eff, systemTime: o.sys, source: o.source, asOf: asOf || null } };
  }
  function history(id, key) {
    type(id);
    const rows = store.history(id, key);
    if (!rows.length) throw new OsdkError("OBJECT_NOT_FOUND", `对象不存在：${id}／${key}`);
    return { items: rows.map(r => ({ version: r.ver, effectiveTime: r.eff, systemTime: r.sys, source: r.source, item: r.doc })), totalCount: rows.length };
  }
  function create(id, body) {
    type(id);
    if (!body || typeof body !== "object" || !Object.keys(body).length) throw new OsdkError("INVALID_PARAMETER", "EmptyMutationPayload：请求体为空");
    const F = fields(id), pk = pkOf(id), key = body[pk];
    if (key === undefined || key === null || key === "") throw new OsdkError("INVALID_PARAMETER", `ObjectKeyMissing：缺主键字段 ${pk}`);
    const bad = Object.keys(body).filter(k => !F.includes(k));
    if (bad.length) throw new OsdkError("INVALID_FIELD", `ColumnNotInMetadataAllowlist：字段不在本体定义中：${bad.join("、")}`);
    if (store.getObject(id, String(key))) throw new OsdkError("INVALID_PARAMETER", `对象已存在：${id}／${key}（更新请用 PUT，历史按版本追加）`);
    const ver = store.putObject(id, String(key), body, { source: "OSDK", eff: id === "OT_ANTENNA" ? body.effectiveTime : undefined });
    return { status: 201, data: { updateCount: 1, item: body, meta: { version: ver } } };
  }
  function update(id, key, body, opt = {}) {
    type(id);
    if (ACTION_OWNED[id]) throw new OsdkError("ACTION_REQUIRED", `${id} 由 ${ACTION_OWNED[id]} 写入，不走对象写接口（约束由动作校验）`);
    const ex = store.getObject(id, key);
    if (!ex) throw new OsdkError("OBJECT_NOT_FOUND", `对象不存在：${id}／${key}`);
    const F = fields(id), bad = Object.keys(body || {}).filter(k => !F.includes(k));
    if (bad.length) throw new OsdkError("INVALID_FIELD", `ColumnNotInMetadataAllowlist：字段不在本体定义中：${bad.join("、")}`);
    const doc = { ...ex.doc, ...body };
    if (id === "OT_CELL_MR") { doc.mrKey = doc.mrKey || key; doc.version = ex.ver + 1; doc.receivedAt = doc.receivedAt || store.peekNow(); }
    const ver = store.putObject(id, key, doc, { source: opt.source || "OSDK", eff: doc.effectiveTime && id === "OT_ANTENNA" ? doc.effectiveTime : undefined });
    return { updateCount: 1, item: doc, meta: { version: ver } };
  }
  // 历史不覆盖：删除一律拒绝（不看对象是否存在，先按本体约束拒绝）
  function remove(id, key) {
    type(id);
    throw new OsdkError(id === "OT_CELL_MR" ? "INV_17" : "INV_11", `${id} 历史不覆盖、不删除（${id === "OT_CELL_MR" ? "前置数据只追加" : "历史不覆盖"}）`);
  }
  function aggregate(id, body = {}) {
    type(id); const F = fields(id);
    for (const g of body.groupBy || []) if (!F.includes(g)) throw new OsdkError("INVALID_FIELD", `groupBy 含未知字段：${g}`);
    const aggs = body.aggregations || [];
    if (!aggs.length) throw new OsdkError("INVALID_PARAMETER", "aggregations 必填");
    for (const a of aggs) {
      if (!AGG_FUNCS.includes(a.func)) throw new OsdkError("INVALID_PARAMETER", `不支持的聚合函数：${a.func}`);
      if (a.field !== "*" && !F.includes(a.field)) throw new OsdkError("INVALID_FIELD", `aggregations 含未知字段：${a.field}`);
      if (!a.alias) throw new OsdkError("INVALID_PARAMETER", "aggregations[].alias 必填");
    }
    const rows = listDocs(id, { asOf: body.asOf }).map(r => r.doc).filter(compile(body.where, F, "where"));
    const groups = new Map();
    for (const d of rows) { const k = JSON.stringify((body.groupBy || []).map(g => d[g] === undefined ? null : d[g])); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
    if (!body.groupBy || !body.groupBy.length) groups.set("[]", rows);
    let out = [...groups.entries()].map(([k, docs]) => {
      const rec = {}; (body.groupBy || []).forEach((g, i) => rec[g] = JSON.parse(k)[i]);
      for (const a of aggs) {
        const xs = a.field === "*" ? docs.map(() => 1) : docs.map(d => d[a.field]).filter(v => typeof v === "number");
        rec[a.alias] = a.func === "COUNT" ? (a.field === "*" ? docs.length : xs.length)
          : !xs.length ? null : a.func === "SUM" ? +xs.reduce((s, x) => s + x, 0).toFixed(6) : a.func === "AVG" ? +(xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(6)
            : a.func === "MIN" ? Math.min(...xs) : Math.max(...xs);
      }
      return rec;
    });
    if (body.having) { const hw = compile(body.having, Object.keys(out[0] || {}), "having"); out = out.filter(hw); }
    const offset = body.offset || 0, limit = body.limit === undefined ? 100 : body.limit;
    return { items: out.slice(offset, offset + limit), totalCount: out.length };
  }

  // ── ObjectSet 集合运算（filter／ids／prev；intersect／union／difference）
  function resolve(input, prev) {
    if (!input || typeof input !== "object") throw new OsdkError("INVALID_PARAMETER", "集合输入缺失");
    if (input.kind === "prev") { if (!prev) throw new OsdkError("INVALID_PARAMETER", "prev 之前没有结果"); return prev; }
    return resolveInput(input);
  }
  function resolveInput(input) {
    const id = type(input.objectType);
    if (input.kind === "filter") return { objectType: id, rows: query(id, { where: input.where, limit: 1e9, offset: 0 }).items };
    if (input.kind === "ids") {
      if (!Array.isArray(input.ids)) throw new OsdkError("INVALID_PARAMETER", "ids 应为数组");
      if (input.ids.length > 10000) throw new OsdkError("INVALID_PARAMETER", "ids 最多 10000 个");
      return { objectType: id, rows: input.ids.map(k => { const o = store.getObject(id, String(k)); if (!o) throw new OsdkError("OBJECT_NOT_FOUND", `对象不存在：${id}／${k}`); return o.doc; }) };
    }
    throw new OsdkError("INVALID_PARAMETER", `不支持的输入类型：${input.kind}`);
  }
  const keyOf = (objectType, doc) => { const p = (meta.schema(objectType).primaryKey || [])[0]; return p ? doc[p] : JSON.stringify(doc); };
  function compose(body = {}) {
    const steps = body.steps || [];
    if (!Array.isArray(steps) || !steps.length) throw new OsdkError("INVALID_PARAMETER", "steps 必填");
    if (steps.length > 20) throw new OsdkError("INVALID_PARAMETER", "steps 最多 20 步");
    let prev = null;
    for (const s of steps) {
      if (s.op === "filter") { prev = resolve(s.from, prev); }
      else if (["intersect", "union", "difference"].includes(s.op)) {
        const ins = (s.inputs || []).map(x => resolve(x, prev));
        if (ins.length < 2 || ins.length > 10) throw new OsdkError("INVALID_PARAMETER", `${s.op} 需要 2～10 个输入`);
        const ot = ins[0].objectType;
        if (ins.some(i => i.objectType !== ot)) throw new OsdkError("INVALID_PARAMETER", `${s.op} 的输入须为同一对象类型`);
        const maps = ins.map(i => new Map(i.rows.map(d => [keyOf(ot, d), d])));
        let keys = [...maps[0].keys()];
        if (s.op === "intersect") keys = keys.filter(k => maps.every(m => m.has(k)));
        if (s.op === "difference") keys = keys.filter(k => !maps.slice(1).some(m => m.has(k)));
        if (s.op === "union") keys = [...new Set(maps.flatMap(m => [...m.keys()]))];
        prev = { objectType: ot, rows: keys.map(k => maps.find(m => m.has(k)).get(k)) };
      } else throw new OsdkError("INVALID_PARAMETER", `不支持的算子：${s.op}`);
    }
    const rows = prev ? prev.rows : [], offset = body.offset || 0, limit = body.limit === undefined ? 100 : body.limit;
    return { objectType: prev && prev.objectType, items: rows.slice(offset, offset + limit), total: rows.length, totalCount: rows.length };
  }

  // ── 关系读取：已存储的关系 + RT_03（由小区 neighbors 派生，不落库）
  function derivedOut(otId, doc) {
    if (otId !== "OT_CELL" || !Array.isArray(doc.neighbors)) return [];
    return doc.neighbors.filter(n => n && n.targetCellKey).map(n => ({ rt: "RT_03", to: "OT_CELL:" + n.targetCellKey, props: { freqType: n.freqType, overlapWeight: n.overlapWeight } }));
  }
  function relations(otId, key, opt = {}) {
    type(otId);
    const self = `${otId}:${key}`, items = [];
    for (const l of store.links({ rt: opt.rt, from: self, asOf: opt.asOf }))
      items.push({ relationType: l.rt, direction: "outbound", from: l.from, to: l.to, props: l.props, validFrom: l.validFrom });
    for (const l of store.links({ rt: opt.rt, to: self, asOf: opt.asOf }))
      items.push({ relationType: l.rt, direction: "inbound", from: l.from, to: l.to, props: l.props, validFrom: l.validFrom });
    const doc = store.doc(otId, key);
    if (doc) for (const d of derivedOut(otId, doc)) if (!opt.rt || opt.rt === d.rt)
      items.push({ relationType: d.rt, direction: "outbound", from: self, to: d.to, props: d.props, derived: true });
    return { items, totalCount: items.length };
  }

  function allRelations(opt = {}) {
    if (opt.rt) meta.relationTypes.find(r => r.code === opt.rt) || (() => { throw new OsdkError("OBJECT_NOT_FOUND", `关系类型 ${opt.rt} 不在本体中`); })();
    const items = store.links({ rt: opt.rt, from: opt.from, to: opt.to, asOf: opt.asOf }).map(l => ({ relationType: l.rt, from: l.from, to: l.to, props: l.props, validFrom: l.validFrom, validTo: l.validTo }));
    return { items, totalCount: items.length };
  }

  // ── Search Around：沿关系做 BFS；endObjectTypes 过滤结果，leafTypes 停止扩展
  function searchAround(body = {}) {
    const start = body.start || {};
    const startType = type(start.objectType);
    const ids = Array.isArray(start.id) ? start.id : start.id ? [start.id] : [];
    if (!ids.length) throw new OsdkError("INVALID_PARAMETER", "start.id 必填");
    if (typeof body.maxDepth !== "number" || body.maxDepth < 1) throw new OsdkError("INVALID_PARAMETER", "maxDepth 必填且 ≥1");
    const maxFrontier = body.maxFrontierSize || 50000, maxPaths = body.maxPathsPerObject || 10;
    const linkTypes = body.linkTypes || null, leafTypes = body.leafTypes || [], endTypes = body.endObjectTypes || null;
    const found = new Map(), visited = new Set(ids.map(i => `${startType}:${i}`));
    let frontier = ids.map(i => ({ key: `${startType}:${i}`, path: [] })), truncated = false, truncatedAt = -1;
    const adj = key => { const [t, ...rest] = key.split(":"), k = rest.join(":"), out = [];
      for (const l of store.links({ from: key })) out.push({ rt: l.rt, to: l.to });
      for (const l of store.links({ to: key })) out.push({ rt: l.rt, to: l.from });
      const doc = store.doc(t, k);
      for (const d of doc ? derivedOut(t, doc) : []) out.push({ rt: d.rt, to: d.to });
      return out.filter(e => !linkTypes || linkTypes.includes(e.rt));
    };
    for (let depth = 1; depth <= body.maxDepth; depth++) {
      if (frontier.length > maxFrontier) { truncated = true; truncatedAt = depth - 1; break; }
      const next = [];
      for (const f of frontier) {
        if (leafTypes.includes(f.key.split(":")[0])) continue;
        for (const e of adj(f.key)) {
          const [t, ...rest] = e.to.split(":"), k = rest.join(":");
          if (!meta.hasType(t) || !store.doc(t, k)) continue;
          const path = [...f.path, e.rt];
          if (!found.has(e.to)) found.set(e.to, { objectType: t, id: k, paths: [] });
          const rec = found.get(e.to);
          if (!rec.paths.some(p => p.join() === path.join())) rec.paths.push(path);
          if (!visited.has(e.to)) { visited.add(e.to); next.push({ key: e.to, path }); }
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    let results = [...found.values()].filter(r => !endTypes || endTypes.includes(r.objectType));
    results = results.map(r => ({ objectType: r.objectType, id: [r.id], attributes: store.doc(r.objectType, r.id) || {},
      pathCount: r.paths.length || null, paths: body.returnPaths === false ? null : r.paths.slice(0, maxPaths) }));
    return { start: { objectType: startType, id: ids }, results, truncated, truncatedReason: truncated ? "frontier 超过 maxFrontierSize" : null, truncatedAtDepth: truncatedAt, stats: null };
  }
  return { query, get, getAt, history, create, update, remove, aggregate, compose, relations, allRelations, searchAround, fields };
}
module.exports = { createObjects, ACTION_OWNED }
