// 应用装配：本体（来自 SPEC）→ 存储 → 函数 → 事实 → 函数服务 → 动作。
const fs = require("node:fs"), path = require("node:path");
const { loadOntology } = require("./ontology.js"), { Store } = require("./store.js"), { makeFuncs } = require("./funcs.js"), { Facts } = require("./facts.js");
const { FuncService } = require("./funcservice.js"), { makeActions, makeAct } = require("./actions.js"), { loadSeed, Arrivals } = require("./loader.js"), { tracker: shared } = require("./tracker.js");
const { readSeed } = require("./seed.js");
const { createTrace } = require("./trace.js");
const { createChain } = require("./chain.js");

function createApp(opt = {}) {
  const ont = loadOntology(), tracker = opt.tracker === undefined ? shared : opt.tracker, seed = opt.seed || readSeed();
  const store = new Store(ont, tracker), F = makeFuncs(ont, tracker), facts = new Facts(store, ont, F, tracker, seed), svc = new FuncService(store, ont, F, facts, tracker);
  const app = { ont, store, F, facts, svc, tracker, seed };
  app.H = makeActions(app); app.act = makeAct(app, app.H);
  app.trace = createTrace(app);
  // 自主决策链（应用层）：把一个小区从发现判定一路推进到闭环与案例，能走到哪一步走到哪一步
  app.chain = createChain(app);
  if (opt.load !== false) loadSeed(store, seed);
  app.arrivals = new Arrivals(seed);
  // 推进时钟：到达时刻不晚于 iso 的 MR 日统计与小区指标自动入库
  app.at = iso => { app.arrivals.release(store, iso); store.setNow(iso); return app; };
  if (opt.at) app.at(opt.at);
  return app;
}
module.exports = { createApp };
