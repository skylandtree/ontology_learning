// 应用层的只读视图聚合：每个读取仍经原 OSDK 鉴权与接口，不增加业务判定。
const { BASE } = require('../src/osdk/service.js');
const API = BASE + '/api/v1/osdk', ONT = API + '/shwo-weak-coverage';
function client(runtime, headers) {
  const request = async (method, path, body, query) => {
    const r = await runtime.service.dispatch({ method, path, headers, body: body || {}, query: new URLSearchParams(query || {}) });
    if (r.status >= 400) {
      const e = new Error(r.body.message); e.status = r.status; e.errorCode = r.body.errorCode; throw e;
    }
    return r.body.data;
  };
  const get = (path, query) => request('GET', path, null, query);
  const post = (path, body) => request('POST', path, body);
  return {
    definition: () => get(ONT + '/definition'),
    ontologies: () => get(API + '/ontologies'),
    objectTypes: () => get(ONT + '/objectTypes'),
    functions: () => get(ONT + '/functions'),
    actions: () => get(ONT + '/actions'),
    errorCodes: () => get(API + '/errorCodes'),
    clock: () => get(ONT + '/sim/clock'),
    query: (type, body) => post(ONT + '/objects/' + type + '/query', body),
    getObject: (type, id) => get(ONT + '/objects/' + type + '/' + encodeURIComponent(id)),
    history: (type, id) => get(ONT + '/objects/' + type + '/' + encodeURIComponent(id) + '/history'),
    relations: (type, id) => get(ONT + '/objects/' + type + '/' + encodeURIComponent(id) + '/relations'),
    allRelations: query => get(ONT + '/relations', query),
    execFn: (code, params) => post(ONT + '/functions/' + code + '/execute', { params }),
    antennaState: (id, query) => get(ONT + '/facts/antenna-state/' + encodeURIComponent(id), query),
    fieldExecs: cell => get(ONT + '/facts/field-executions', { cell }),
    cellTrace: cell => get(ONT + '/trace/cell', { cell }),
    audit: query => get(ONT + '/audit/runs', query),
  };
}
async function summary(runtime, headers) {
  const audit = await client(runtime, headers).audit({ limit: 60 });
  const counts = {};
  for (const type of ['OT_CELL', 'OT_TICKET', 'OT_PLAN', 'OT_EFFECT', 'OT_CASE', 'OT_CELL_MR']) counts[type] = runtime.app.store.count(type);
  return { counts, auditRuns: audit.items || [] };
}
async function bootstrap(runtime, headers, includeDefinition = true) {
  const o = client(runtime, headers);
  const [clock, cells, sites, areas, rt01, rt02, rt04, status, meta] = await Promise.all([
    o.clock(), o.query('OT_CELL', { limit: 500 }), o.query('OT_SITE', { limit: 200 }), o.query('OT_AREA', { limit: 200 }),
    o.allRelations({ rt: 'RT_01' }), o.allRelations({ rt: 'RT_02' }), o.allRelations({ rt: 'RT_04' }), summary(runtime, headers),
    includeDefinition ? Promise.all([o.definition(), o.ontologies(), o.objectTypes(), o.functions(), o.actions(), o.errorCodes()]) : null,
  ]);
  return { clock: clock.now, cells: cells.items, sites: sites.items, areas: areas.items,
    relations: { rt01: rt01.items, rt02: rt02.items, rt04: rt04.items }, ...status,
    ...(meta ? { definition: meta[0], meta: { ontology: meta[1].items[0], objectTypes: meta[2].items, functions: meta[3].items, actions: meta[4].items, errorCodes: meta[5].items } } : {}) };
}
async function cellContext(runtime, headers, key, effectNo) {
  const o = client(runtime, headers);
  const state = { clock: runtime.app.store.peekNow(), effectNo, diag: {}, diagKey: null,
    cells: (await o.query('OT_CELL', { limit: 500 })).items, planScope: [], sectorItems: [] };
  const idOf = s => String(s).split(':').slice(1).join(':');
async function loadCellCtx(key) {
  const rel = await o.relations("OT_CELL", key);
  const items = rel?.items || [];
  const out = t => items.find(r => r.relationType === t && r.direction === "outbound");
  const siteId = out("RT_01") ? idOf(out("RT_01").to) : null;
  const antId = out("RT_02") ? idOf(out("RT_02").to) : null;
  const areaId = out("RT_04") ? idOf(out("RT_04").to) : null;
  const cell = (await o.getObject("OT_CELL", key)).item;
  const site = siteId ? (await o.getObject("OT_SITE", siteId).catch(() => null))?.item || null : null;
  const antenna = antId ? await o.antennaState(antId, { asOf: state.clock }).catch(() => null) : null;
  const area = areaId ? (await o.getObject("OT_AREA", areaId).catch(() => null))?.item || null : null;
  // 工单：该小区的 RT_05 入向；优先未关闭的最新一张。工单对象按主键回读（不取大屏缓存，避免读到旧版本）
  const nos = items.filter(r => r.relationType === "RT_05").map(r => idOf(r.from));
  const tks = [];
  for (const no of nos) {
    const t = await o.getObject("OT_TICKET", no).catch(() => null);
    if (t?.item) tks.push(t.item);
  }
  tks.sort((a, b) => String(b.ticketNo).localeCompare(String(a.ticketNo)));
  const ticket = tks.find(t => t.status !== "已关闭") || tks[0] || null;
  let ticketRel = null, ticketHist = null, plan = null, planNo = null, effects = [], effect = null, effectNo = null, antennaHist = null;
  if (ticket) {
    ticketRel = await o.relations("OT_TICKET", ticket.ticketNo).catch(() => ({ items: [] }));
    ticketHist = await o.history("OT_TICKET", ticket.ticketNo).catch(() => ({ items: [] }));
    const rt9 = (ticketRel.items || []).find(r => r.relationType === "RT_09");
    planNo = rt9 ? idOf(rt9.direction === "outbound" ? rt9.to : rt9.from) : null;
    if (planNo) {
      plan = (await o.getObject("OT_PLAN", planNo).catch(() => null))?.item || null;
      const effs = await o.query("OT_EFFECT", { where: { planNo }, limit: 50 }).catch(() => ({ items: [] }));
      effects = (effs.items || []).sort((a, b) => String(a.effectNo).localeCompare(String(b.effectNo)));
      effectNo = state.effectNo && effects.some(e => e.effectNo === state.effectNo) ? state.effectNo : (effects.length ? effects[effects.length - 1].effectNo : null);
      effect = effects.find(e => e.effectNo === effectNo) || null;
      const act = plan?.actions?.[0];
      if (act?.targetKind === "天线" && act.targetKey) antennaHist = (await o.history("OT_ANTENNA", act.targetKey).catch(() => null))?.items || [];
    }
  }
  // 发现判定按「建单时」回放：已有工单就用它的 discovery 快照窗口（窗口末日的次日 09:00）。
  // 效果核验会把判断时点往前推，拿“现在”的窗口重算会得到“未达到派单条件”，与已建单／已闭环矛盾；
  // INV_17 也要求建单快照不因数据更正或时点推进而重算。
  const snapTo = ticket?.discovery?.window?.to;
  const scanRef = snapTo
    ? new Date(Date.parse(snapTo + "T00:00:00Z") + 86400000).toISOString().slice(0, 10) + "T09:00:00"
    : state.clock;
  const discover = await o.execFn("F_06", { cellKey: key, refTime: scanRef }).catch(() => null);
  // 发现结果只对当前小区取一次：判定三态、命中天数、适用规则、缺口说明都由后端 F_12 给
  const scan = await o.execFn("F_12", { scope: [key], refTime: scanRef }).catch(() => null);
  const scanItem = scan?.result?.items?.[0] || null;
  const scanWindow = scan?.result?.window || null;
  const cases = (await o.query("OT_CASE", { limit: 100 }).catch(() => ({ items: [] }))).items || [];
  // 现场回填记录（来源事实）：按 receivedAt 到达；没有它就不能用计划值冒充实际值（INV_07）
  const fieldExec = await o.fieldExecs(key).catch(() => ({ items: [], pending: [], totalCount: 0 }));
  // 定因证据自动算：F_07／F_08 的结果界面自己取，用户不必先点"执行 F_07"才看得到依据
  if (ticket) {
    const dk = `${ticket.ticketNo}@${state.clock}`;
    if (state.diagKey !== dk) {
      const [f7, f8] = await Promise.all([
        o.execFn("F_07", { cellKey: key, hitDates: ticket.discovery.hitDates, refTime: state.clock }).catch(() => null),
        o.execFn("F_08", { cellKey: key, asOf: state.clock }).catch(() => null)
      ]);
      state.diag = { F_07: f7, F_08: f8 };
      state.diagKey = dk;
    }
  }
  // 本体执行链路：这个小区实际跑过的业务流程（步骤／函数／约束／规则／对象／关系／关键数值）
  state.trace = await o.cellTrace(key).catch(() => null);
  state.ctx = {
    cellKey: key, cell, site, antenna, area, relations: items,
    scanItem, scanWindow, scanRef, snapshot: !!snapTo, discover: discover?.result || null,
    ticket, ticketRel, ticketHist, plan, planNo, effects, effect, effectNo, antennaHist, cases, fieldExec,
    planScope: state.planScope || [], sectorItems: state.sectorItems || []
  };
  state.cellKey = key;
  await loadPlanScope();   // 影响范围（RT_10）与俯视图数据随小区一起装载
}

async function loadPlanScope() {
  state.sectorItems = []; state.planScope = [];
  const ctx = state.ctx;
  if (!ctx?.planNo) return;
  try {
    const rel = await o.relations("OT_PLAN", ctx.planNo);
    // 影响范围＝方案 RT_10 的受影响小区（决定审批链）；重叠邻区只是校验对象，画在俯视图里，不计入影响范围
    const scopeCells = (rel.items || []).filter(r => r.relationType === "RT_10" && r.to.startsWith("OT_CELL:")).map(r => idOf(r.to));
    state.planScope = scopeCells;
    const mapCells = [...scopeCells];
    const checks = ctx.plan?.impact?.checks || [];
    const farOf = ck => { const c = checks.find(x => x.kind === "远端覆盖" && x.cell === ck); return c ? { before: c.before, after: c.after } : {}; };
    const cellsOf = new Set(scopeCells);
    if (ctx.cellKey) {
      const cr = await o.relations("OT_CELL", ctx.cellKey);
      for (const r of (cr.items || []).filter(x => x.relationType === "RT_03" && x.direction === "outbound")) {
        const k = idOf(r.to);
        if (!cellsOf.has(k)) { cellsOf.add(k); mapCells.push(k); }
      }
    }
    const bySite = new Map();
    for (const ck of mapCells) {
      const c = state.cells.find(x => x.cellKey === ck); if (!c) continue;
      const cr = await o.relations("OT_CELL", ck);
      const rt1 = (cr.items || []).find(r => r.relationType === "RT_01");
      const rt2 = (cr.items || []).find(r => r.relationType === "RT_02");
      if (!rt1) continue;
      const siteId = idOf(rt1.to);
      const s = await o.getObject("OT_SITE", siteId).catch(() => null);
      if (!s?.item) continue;
      const ant = rt2 ? await o.antennaState(idOf(rt2.to)).catch(() => null) : null;
      const far = farOf(ck);
      const e = bySite.get(siteId) || { siteId, lat: s.item.lat, lon: s.item.lon, azimuth: ant?.antenna?.azimuth, beta: rt2?.props?.vBeam, cells: [], rFarBefore: null, rFarAfter: null, role: "受影响", color: "var(--violet)" };
      e.cells.push({ cellKey: ck, cellName: c.cellName });
      if (far.before) e.rFarBefore = far.before;
      if (far.after) e.rFarAfter = far.after;
      if (ck === ctx.cellKey) { e.role = "目标"; e.color = "var(--cyan)"; }
      bySite.set(siteId, e);
    }
    const target = [...bySite.values()].find(x => x.role === "目标");
    if (target) {
      for (const e of bySite.values()) {
        if (e === target) continue;
        const chk = checks.find(x => x.kind === "重叠指数" && e.cells.some(c => c.cellKey === x.neighbor));
        e.dist = chk?.distance || null;
      }
    }
    state.sectorItems = [...bySite.values()];
    if (state.ctx) { state.ctx.sectorItems = state.sectorItems; state.ctx.planScope = state.planScope; }
  } catch (err) { console.warn("俯视图装载失败（不影响主流程）", err); }
}

  await loadCellCtx(key);
  return { ctx: state.ctx, trace: state.trace, diag: state.diag, diagKey: state.diagKey,
    planScope: state.planScope, sectorItems: state.sectorItems, clock: state.clock };
}
module.exports = { bootstrap, summary, cellContext };
