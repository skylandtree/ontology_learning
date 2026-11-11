// 业务用例的接口层传输：同一套用例定义（BD／BQ）不改业务语义，把“动作、函数、对象读、关系、审计、问答”
// 全部换成 OSDK REST 接口调用。进程内 dispatch 与 HTTP 走同一套鉴权、信封与错误码（真机 HTTP 契约由 test/api.js 验证）。
// 用例里访问 w.app.store／svc／facts 的地方，由本适配器换成语义相同的接口调用；不直接改库。
const { createService } = require("../../src/osdk/service.js");
const BASE = "/agent-onto-harness/api/v1/osdk", ONT = "shwo-weak-coverage";
const enc = s => encodeURIComponent(String(s));
const idOf = s => s.slice(s.indexOf(":") + 1);

function apiApp(app) {
  const svc = createService(app);
  const call = (method, path, o = {}) => {
    const headers = { currentnetuserid: o.user || "case-runner", "x-sys-code": "data" };
    if (o.role) headers["x-context-key-groups"] = enc(o.role);
    const r = svc.dispatch({ method, path: `${BASE}/${ONT}${path}`, headers, query: new Map(Object.entries(o.query || {})), body: o.body || {} });
    if (r.body.error) return { ok: false, status: r.status, code: r.body.errorCode, msg: r.body.message, details: r.body.details };
    return { ok: true, status: r.status, data: r.body.data };
  };
  const pkOf = t => (svc.meta.schema(t).primaryKey || [])[0];
  const q = o => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]));
  const wrapErr = r => Object.assign(new Error(r.msg), { code: r.code });

  const store = {
    doc(t, id, opt = {}) { const r = call("GET", `/objects/${t}/${enc(id)}`, { query: q(opt) }); return r.ok ? r.data.item : null; },
    getObject(t, id, opt = {}) {
      const r = call("GET", `/objects/${t}/${enc(id)}`, { query: q(opt) });
      return r.ok ? { doc: r.data.item, ver: r.data.meta.version, eff: r.data.meta.effectiveTime, sys: r.data.meta.systemTime, source: r.data.meta.source } : null;
    },
    list(t) { const r = call("GET", `/objects/${t}`, { query: { limit: 100000 } }); return r.ok ? r.data.items.map(d => ({ id: d[pkOf(t)], ...d })) : []; },
    count(t) { const r = call("GET", `/objects/${t}`, { query: { limit: 1 } }); return r.ok ? r.data.totalCount : 0; },
    history(t, id) {
      const r = call("GET", `/objects/${t}/${enc(id)}/history`);
      if (!r.ok) throw wrapErr(r);
      return r.data.items.map(h => ({ ver: h.version, eff: h.effectiveTime, sys: h.systemTime, source: h.source, doc: h.item }));
    },
    links(f = {}) {
      const r = call("GET", "/relations", { query: q({ rt: f.rt, from: f.from, to: f.to, asOf: f.asOf }) });
      return r.ok ? r.data.items.map(l => ({ rt: l.relationType, from: l.from, to: l.to, props: l.props, validFrom: l.validFrom, validTo: l.validTo })) : [];
    },
    runs(f = {}) {
      const r = call("GET", "/audit/runs", { query: q({ actionId: f.actionId, target: f.target, outcome: f.outcome }) });
      return r.ok ? r.data.items.map(x => ({ runId: x.runId, actionId: x.actionId, actor: x.actor, role: x.role, target: x.target, input: x.input, outcome: x.outcome, code: x.code, msg: x.msg, result: x.result, t: x.time })) : [];
    },
    putObject(t, id, doc, o = {}) { const r = call("PUT", `/objects/${t}/${enc(id)}`, { body: doc, query: q({ source: o.source }) }); if (!r.ok) throw wrapErr(r); return r.data.meta && r.data.meta.version; },
    overwrite(t, id) { const r = call("DELETE", `/objects/${t}/${enc(id)}`); throw wrapErr(r); },
    peekNow() { return call("GET", "/sim/clock").data.now; },
    alarms(cell) { const r = call("GET", "/facts/alarms", { query: { cell } }); return r.ok ? r.data.items : []; }
  };

  const svcFns = {
    scan: (scope, refTime) => call("POST", "/functions/F_12/execute", { body: { params: { scope, refTime } } }).data.result,
    discover: (cellKey, refTime) => call("POST", "/functions/F_06/execute", { body: { params: { cellKey, refTime } } }).data.result,
    matchTilt: (cellKey, asOf) => call("POST", "/functions/F_08/execute", { body: { params: { cellKey, asOf } } }).data.result,
    falseWeak: (cellKey, hitDates, refTime) => call("POST", "/functions/F_07/execute", { body: { params: { cellKey, hitDates, refTime } } }).data.result,
    impact: (cellKey, adjustType, planDelta, asOf, fixedDelta) => call("POST", "/functions/F_10/execute", { body: { params: { cellKey, adjustType, planDelta, asOf, fixedDelta } } }).data.result
  };

  const facts = {
    antennaState(antennaId, asOf) {
      const r = call("GET", `/facts/antenna-state/${enc(antennaId)}`, { query: q({ asOf }) });
      return r.ok ? r.data : null;
    },
    antennaLink(cellKey, asOf) {
      const r = call("GET", `/objects/OT_CELL/${enc(cellKey)}/relations`, { query: q({ rt: "RT_02", asOf }) });
      const l = r.ok ? r.data.items.find(x => x.direction === "outbound") : null;
      return l ? { antennaId: idOf(l.to), ...l.props, validFrom: l.validFrom } : null;
    },
    cellOfTicket(ticketNo) {
      const r = call("GET", `/objects/OT_TICKET/${enc(ticketNo)}/relations`, { query: { rt: "RT_05" } });
      const l = r.ok ? r.data.items.find(x => x.direction === "outbound") : null;
      return l ? idOf(l.to) : null;
    }
  };

  const api = {
    // 动作：成功返回 {ok:true, result}；拒绝按 SPEC 的拒绝码返回 {ok:false, code, msg}
    act(actionId, input = {}, actor = { role: "优化本体" }) {
      const r = call("POST", `/actions/${actionId}/execute`, { body: { params: input }, role: actor.role, user: actor.name || actor.role });
      return r.ok ? { ok: true, result: r.data.result, audit: r.data.audit } : { ok: false, code: r.code, msg: r.msg, result: (r.details || {}).result };
    },
    at(iso) { call("POST", "/sim/clock", { body: { now: iso } }); return api; },
    ingestMR(rows) { const r = call("POST", "/ingest/cell-mr", { body: { rows } }); if (!r.ok) throw wrapErr(r); return r.data.received; },
    store, svc: svcFns, facts,
    ont: { get raw() { return { ...svc.meta.ontology(), actions: svc.meta.actions.map(a => ({ ...a, id: a.code })) }; } },
    qa() {
      const sess = { ticketNo: null, cellKey: null, role: null };
      let lastFocus = null;
      return {
        sess,
        ask(question, opt = {}) {
          // 只在“焦点工单被显式切换”时随请求带 ticketNo；之后的会话状态由服务端问答自己维护
          const body = { question };
          if (sess.ticketNo && sess.ticketNo !== lastFocus) { body.ticketNo = sess.ticketNo; lastFocus = sess.ticketNo; }
          // 当前小区上下文与只读模式与进程内语义一致
          if (opt.cellKey) body.cellKey = opt.cellKey;
          if (opt.readOnly) body.readOnly = true;
          const r = call("POST", "/qa/ask", { body, role: opt.role });
          if (!r.ok) throw wrapErr(r);
          const o = r.data.result; return { ...o, intent: o.intent || r.data.intent, refs: o.refs || r.data.refs, grounded: o.grounded || r.data.grounded, pending: o.pending || r.data.pending };
        }
      };
    },
    _service: svc
  };
  return api;
}

// 用例框架用：wrap(freshApp) → 接口形态的 app
const transport = { name: "api", wrap: app => apiApp(app) };
module.exports = { transport, apiApp };
