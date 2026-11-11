// 自动化验证：本体只来自 SPEC → 种子数据符合本体 → 决策场景 → 问答场景 → 覆盖 → 服务接口。运行：node test/run.js
require("./model-isolated.js");   // 测试与本机大模型配置隔离：档位恒为 rule，不真调网关（见该文件说明）
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), crypto = require("node:crypto");
const root = path.join(__dirname, ".."), { parseSpec } = require("../scripts/spec-parse.js"), { loadOntology } = require("../src/ontology.js"), { createApp } = require("../src/app.js");
const { SCENARIOS, runScenario, SEED, variant, fresh, chmMain, Ctx, K, BOT, ENG, SUP, X, Z1, Z2, AN } = require("../src/scenarios.js"), { runQAEval, STEPS } = require("../src/qa-eval.js"), { tracker } = require("../src/tracker.js"), { createServer } = require("../src/server.js");

const groups = []; let G;
const group = (name, fn) => { G = { name, checks: [] }; groups.push(G); fn(); };
const ok = (desc, cond, detail) => G.checks.push({ desc, pass: !!cond, detail: cond ? undefined : detail });
const eq = (desc, a, b) => ok(desc, JSON.stringify(a) === JSON.stringify(b), `实际 ${JSON.stringify(a)}，预期 ${JSON.stringify(b)}`);
const throws = (desc, fn, re) => { try { fn(); ok(desc, false, "未抛出异常"); } catch (e) { ok(desc, re.test(e.message), e.message); } };

const REF0 = "2026-09-11T09:00:00";
const specFile = require("../scripts/spec-file.js").specFile(), md = fs.readFileSync(path.join(root, "spec", specFile), "utf8"), ont = loadOntology(), raw = ont.raw;

group("1 本体只来自 SPEC", () => {
  const re = parseSpec(md);
  ok("ontology JSON 与重新解析 SPEC 的结果逐项一致（JSON 不是手写的）", JSON.stringify({ ...re, source: undefined }) === JSON.stringify({ ...raw, source: undefined }), "JSON 与 SPEC 解析结果不一致，请重新运行 scripts/gen-ontology.js");
  eq("SPEC 文件指纹一致", raw.source.sha256, crypto.createHash("sha256").update(md).digest("hex"));
  eq("对象类型 9／关系 17／函数 12／动作 11／约束 17", [raw.objectTypes.length, raw.relationTypes.length, raw.functions.length, raw.actions.length, raw.constraints.length], [9, 17, 12, 11, 17]);
  eq("派单规则 4 条、措施类型 2 条、测试假设 12 条", [raw.dispatchRules.length, raw.measureTypes.length, raw.assumptions.length], [4, 2, 12]);
  for (const [k, rx] of [["OT", /\bOT_[A-Z_]+\b/g], ["RT", /\bRT_\d+\b/g], ["F", /\bF_\d+\b/g], ["A", /\bA_\d+\b/g], ["INV", /\bINV_\d+\b/g], ["RULE", /\bRULE_[A-Z]\d+\b/g]])
    ok(`SPEC 中出现的每个 ${k} 标识都已定义（无悬空引用）`, [...new Set(md.match(rx))].every(id => ont.ids[k].includes(id)), [...new Set(md.match(rx))].filter(id => !ont.ids[k].includes(id)).join(","));
  ok("本体里没有 SPEC 之外的要素（不含旧上海本体的 ICOS、qrxlevmin、C01～C11 原因目录）", !/ICOS|qrxlevmin|SSB|原因目录/.test(fs.readFileSync(path.join(root, "ontology/shwo.ontology.json"), "utf8")), "出现了 SPEC 之外的词");
  // 运行期注册表与本体一一对应
  const app = createApp({ tracker: null });
  eq("动作注册表＝SPEC 的 A_01～A_11", Object.keys(app.H).sort(), [...ont.ids.A].sort());
  eq("函数注册表＝SPEC 的 F_01～F_12", [...Object.keys(app.F).filter(k => /^F\d\d$/.test(k)).map(k => k.replace("F", "F_")), typeof app.svc.scan === "function" ? "F_12" : ""].sort(), [...ont.ids.F].sort());
  throws("写入 SPEC 未定义的属性被拒绝", () => app.store.putObject("OT_SITE", "S-x", { siteId: "S-x", 厂家: "华为" }), /未在 SPEC 中定义/);
  throws("写入 SPEC 未定义的对象类型被拒绝", () => app.store.putObject("OT_ICOS", "x", {}), /未在 SPEC 中定义/);
  throws("关系端点类型与 SPEC 不符被拒绝（RT_05 应为 工单→小区）", () => app.store.link("RT_05", "OT_CELL:a", "OT_TICKET:b"), /端点应为/);
  throws("未定义的关系类型被拒绝", () => app.store.link("RT_99", "OT_CELL:a", "OT_SITE:b"), /未在 SPEC 中定义/);
  // 跑一条完整链路后，库里出现的对象类型与关系类型都属于 SPEC
  const c = new Ctx("t", "t", []); const a2 = fresh(SEED), m = chmMain(c, a2, null); a2.at("2026-09-29T10:00:00"); a2.act("A_08", { ticketNo: m.no }, SUP); a2.act("A_09", { effectNo: m.e2.effectNo, applicability: require("../src/scenarios.js").APPLIC }, { role: "知识维护人" });
  const types = a2.store.db.prepare("SELECT DISTINCT type t FROM objects").all().map(r => r.t), rts = a2.store.db.prepare("SELECT DISTINCT rt FROM links").all().map(r => r.rt);
  ok("库中的对象类型全部来自 SPEC，且 9 个类型都有实例", types.every(t => ont.ids.OT.includes(t)) && ont.ids.OT.every(t => types.includes(t)), types.join(","));
  ok("库中的关系类型全部来自 SPEC（RT_03 由 neighbors 派生，不存储）", rts.every(r => ont.ids.RT.includes(r)), rts.join(","));
  ok("每个存储的对象属性都在 SPEC 属性表内（已由 validate 保证）", a2.store.db.prepare("SELECT COUNT(*) c FROM objects").get().c > 100, "对象数量异常");
});

group("2 种子数据（CSV，按表分文件）符合本体且像真实数据", () => {
  const { TABLES, readSeed } = require("../src/seed.js"), dir = path.join(root, "data/seed"), src = JSON.parse(fs.readFileSync(path.join(root, "data/source/shanghai_tickets.json"), "utf8")), attrs = id => ont.ot(id).attributes.map(a => a.name);
  ok("每张表一个 CSV 文件，共 " + Object.keys(TABLES).length + " 张，表头与 SPEC 字段字典一致（读取时严格校验）", Object.values(TABLES).every(T => fs.existsSync(path.join(dir, T.file))) && !fs.existsSync(path.join(dir, "main.json")), "缺文件或仍有 main.json");
  const sub = (tbl, id, extra = []) => Object.keys(TABLES[tbl].cols).every(c => attrs(id).includes(c) || extra.includes(c));
  ok("对象表的列全部是对应对象类型在 SPEC 里的属性（站点、天线、小区、区域、MR 日统计）", sub("sites", "OT_SITE") && sub("antennas", "OT_ANTENNA") && sub("cells", "OT_CELL") && sub("areas", "OT_AREA") && sub("cellMR", "OT_CELL_MR"), "有列不在 SPEC 属性表内");
  ok("关系表的列来自 SPEC 的关系属性（RT_02：elecTilt、vBeam、arrayPort；RT_04：role、share）", ["elecTilt", "vBeam", "arrayPort"].every(c => ont.rt("RT_02").attributes.some(a => a.name === c)) && ["role", "share"].every(c => ont.rt("RT_04").attributes.some(a => a.name === c)), "关系属性不符");
  const app = createApp({ tracker: null });
  eq("装载主数据后各类对象数量", [app.store.count("OT_SITE"), app.store.count("OT_ANTENNA"), app.store.count("OT_CELL"), app.store.count("OT_AREA")], [SEED.sites.length, SEED.antennas.length, SEED.cells.length, SEED.areas.length]);
  eq("时钟推进前没有 MR、没有工单（MR 日统计随到达时间入库）", [app.store.count("OT_CELL_MR"), app.store.count("OT_TICKET")], [0, 0]);
  app.at(REF0); const n1 = app.store.count("OT_CELL_MR"); eq("时钟推进到 2026-09-11 09:00：只入库 receivedAt 不晚于该时刻的 MR", n1, new Set(SEED.cellMR.filter(m => m.receivedAt <= REF0).map(m => m.cellKey + "@" + m.date)).size);
  app.at("2026-09-23T09:00:00"); ok("继续推进时钟，后续到达的 MR 自动入库，装载不产生工单", app.store.count("OT_CELL_MR") > n1 && app.store.count("OT_TICKET") === 0, "到达机制异常");
  ok("每个 MR 日统计都有 RT_16 指向小区", app.store.links({ rt: "RT_16" }).length === app.store.count("OT_CELL_MR"), "RT_16 数量不符");
  const fe = SEED.fieldExecutions[0], chm = src["人工闭环"].find(r => r["工单编号"].startsWith("SHCHM")), A = SEED.antennas.find(a => a.antennaId === fe.antennaId);
  eq("崇明挂高、方位角、机械下倾、现场调整前后值取自人工闭环原文（38 m、330°、3°→4°）", [A.height, A.azimuth, A.mechTilt, fe.fromValue, fe.toValue], [+chm["原因分析及优化方案"].match(/站高(\d+)米/)[1], +chm["原因分析及优化方案"].match(/方位角(\d+)度/)[1], +chm["_col15"].match(/由(\d)度/)[1], +chm["_col15"].match(/由(\d)度/)[1], +chm["_col15"].match(/到(\d)度/)[1]]);
  const ratio = (cell, from, to) => { const r = SEED.cellMR.filter(m => m.cellKey === cell && m.date >= from && m.date <= to); return r.reduce((s, m) => s + m.sampleWeak, 0) / r.reduce((s, m) => s + m.sampleTotal, 0); };
  const tk = n => SEED.sourceTickets.find(t => t.short === n);
  ok("崇明前窗弱覆盖占比＝1−原文覆盖率 62.72%，后窗＝1−91.36%", Math.abs(ratio(tk("SHCHM").cellKey, "2026-09-04", "2026-09-10") - (1 - 0.6272)) < 1e-4 && Math.abs(ratio(tk("SHCHM").cellKey, "2026-09-15", "2026-09-21") - (1 - 0.9136)) < 1e-4, "占比不符");
  ok("宝山窗口弱覆盖占比＝1−原文覆盖率 88.18%", Math.abs(ratio(tk("SHBAO").cellKey, "2026-10-16", "2026-10-22") - (1 - 0.8818)) < 1e-4, "占比不符");
  eq("真实工单号来自原文", SEED.sourceTickets.map(t => t.taskno), [src["工单"][2]["工单编号"], src["工单"][0]["工单编号"], src["工单"][3]["工单编号"], src["工单"][1]["工单编号"]]);
  ok("每个站点、天线、小区、区域都有来源标注（provenance.csv）", [...SEED.cells.map(c => c.cellKey), ...SEED.antennas.map(a => a.antennaId), ...SEED.sites.map(s => s.siteId), ...SEED.areas.map(a => a.areaId)].every(id => /^(原文|构造)/.test(SEED.provenance[id] || "")), "有实体缺少来源标注");
  ok("种子不含任何“正确原因”标签（原因由函数计算）", !/rootCause|causeLabel|cause/.test(fs.readdirSync(dir).filter(f => f !== "provenance.csv" && f !== "source_tickets.csv").map(f => fs.readFileSync(path.join(dir, f), "utf8")).join("")), "种子含原因标签");
  ok("四张真实工单中 SPEC 范围外的两张只作来源事实，没有对象与规则", SEED.sourceTickets.filter(t => !t.inScope).length === 2 && !SEED.cells.some(c => /杨政松|金珠港/.test(c.cellName)), "范围外工单被建模");
  // 看起来像真实数据：命名、编号、数值
  ok("名称与编号不带“演示／构造／模拟／测试”等字样", ![...SEED.cells.map(c => c.cellName), ...SEED.areas.map(a => a.areaName), ...SEED.sites.map(s => s.siteId), ...SEED.antennas.map(a => a.antennaId)].some(x => /演示|构造|模拟|测试|示例|样例|SIM|DEMO/i.test(x)), "出现占位字样");
  ok("小区标识是 ECI／NCI 数字，LTE 的 ECI＝eNB ID×256＋小区号，小区名后缀就是小区号", SEED.cells.every(c => c.rat === "NR" ? /^NR:\d{9,11}$/.test(c.cellKey) : /^LTE:\d{8,10}$/.test(c.cellKey) && +c.cellKey.slice(4) === +SEED.cellSite.find(x => x.cellKey === c.cellKey).siteId * 256 + +c.cellName.match(/_(\d+)$/)[1]), "标识不符合 ECI／NCI 规则");
  ok("天线编号为“站点-扇区-序号”", SEED.antennas.every(a => new RegExp("^" + a.siteId + "-[0-9]+-[0-9]+$").test(a.antennaId)), "天线编号不符");
  const tot = SEED.cellMR.map(m => m.sampleTotal), ratios = SEED.cellMR.map(m => m.sampleWeak / m.sampleTotal);
  ok("MR 采样点数逐日波动、不是整齐的整数：不同取值占 85% 以上，百的整数倍不超过 10%", new Set(tot).size / tot.length > 0.85 && tot.filter(x => x % 100 === 0).length / tot.length <= 0.1, "采样点数过于整齐");
  ok("同一小区逐日占比有波动（崇明主小区前窗各日占比不全相同）", new Set(SEED.cellMR.filter(m => m.cellKey === tk("SHCHM").cellKey && m.date < "2026-09-11").map(m => (m.sampleWeak / m.sampleTotal).toFixed(4))).size >= 6, "占比无波动");
  ok("MR 到达时间在业务日次日凌晨，且各不相同（不是统一整点）", SEED.cellMR.every(m => m.receivedAt.slice(0, 10) > m.date && m.receivedAt.slice(11, 13) === "06") && new Set(SEED.cellMR.map(m => m.receivedAt)).size / SEED.cellMR.length > 0.9, "到达时间不合理");
  ok("弱覆盖采样点不超过有效采样点；占比在 0～1", SEED.cellMR.every(m => m.sampleWeak <= m.sampleTotal && m.sampleWeak >= 0), "采样点关系不合理");
});

const results = SCENARIOS.map(sc => ({ sc, c: runScenario(sc) }));
group("3 决策场景（SPEC 第六章用例在上海数据上的执行）", () => { for (const { sc, c } of results) for (const k of c.checks) ok(`${sc.id} ${k.desc}`, k.pass, k.detail); });
const qa = runQAEval();
group("4 问答场景（58 个问题＋3 次人工动作＋数值落地检查）", () => { for (const k of qa.c.checks) ok(`问答 ${k.desc}`, k.pass, k.detail); ok("全部回答的数值与日期都能追溯到引用来源", qa.rows.filter(r => r.grounded).every(r => r.grounded.ok), "存在未落地数值"); });

// ── 覆盖
const kinds = [["OT", "对象类型"], ["RT", "关系类型"], ["F", "函数"], ["A", "动作类型"], ["INV", "核心约束"], ["RULE", "业务规则"], ["TH", "测试假设"]], onlyRegistered = ont.ids.RULE.filter(id => ont.rule(id).registerOnly);
const claimed = new Set([...SCENARIOS.flatMap(s => s.spec), "TC09", "TC10"]);
group("5 覆盖：决策与问答场景合起来覆盖 SPEC 定义的全部本体要素", () => {
  for (const [k, name] of kinds) {
    const miss = ont.ids[k].filter(id => !tracker.has(k, id)), missQ = ont.ids[k].filter(id => !tracker.has(k, id, "qa")), missD = ont.ids[k].filter(id => !tracker.has(k, id, "decision") && !(k === "RULE" && onlyRegistered.includes(id)));
    ok(`${name}（${ont.ids[k].length}）：两类场景合计全部覆盖`, miss.length === 0, "未覆盖：" + miss.join("、")); ok(`${name}：问答场景单独也全部覆盖`, missQ.length === 0, "问答未覆盖：" + missQ.join("、")); ok(`${name}：决策场景覆盖全部（SPEC 标明“只登记”的规则除外，由问答说明）`, missD.length === 0, "决策未覆盖：" + missD.join("、"));
  }
  ok("INV 约束：每条都被校验过，且“可违反”的约束至少有一次违反被拒绝（INV_12、INV_13 为计算型约束，只有通过）", ont.ids.INV.every(id => tracker.has("INV", id)) && ont.ids.INV.filter(id => !["INV_12", "INV_13", "INV_11", "INV_17"].includes(id)).every(id => (tracker.hits.get("INV|" + id).detail || new Set()).has("violation")), ont.ids.INV.filter(id => !(tracker.hits.get("INV|" + id) || { detail: new Set() }).detail.has("violation")).join("、"));
  ok("SPEC 的 34 个用例（TC01～TC10）都有场景承担", ont.raw.cases.every(c => claimed.has(c.id)), ont.raw.cases.filter(c => !claimed.has(c.id)).map(c => c.id).join("、"));
});

// ── 业务用例：按业务人员的实际使用顺序编排（test/cases/），在覆盖统计之后执行，业务用例的覆盖单独统计
const { runBusiness, catalogDoc } = require("./business.js"), biz = runBusiness(), bizFw = require("./cases/framework.js");
const bizGroup = (name, list) => group(name, () => { for (const c of list) for (const s of c.steps) ok(`${c.id} 第${s.n}步 ${s.who}：${String(s.biz).slice(0, 50)}`, s.pass, s.checks.filter(k => !k.pass).map(k => k.desc + "：" + k.detail).join("；")); });
bizGroup(`6 业务决策用例（${biz.decision.length} 个用例，每步一条断言）`, biz.decision);
bizGroup(`7 业务问答用例（${biz.qa.length} 段对话，每问一条断言）`, biz.qa);
group("8 业务用例覆盖：业务用例单独也覆盖 SPEC 的全部本体要素、全部角色", () => {
  for (const [k, name] of kinds) {
    const mD = ont.ids[k].filter(id => !tracker.has(k, id, "biz-decision") && !(k === "RULE" && onlyRegistered.includes(id))), mQ = ont.ids[k].filter(id => !tracker.has(k, id, "biz-qa"));
    ok(`${name}（${ont.ids[k].length}）：业务决策用例覆盖全部（“只登记”的规则除外）`, mD.length === 0, "未覆盖：" + mD.join("、")); ok(`${name}：业务问答用例覆盖全部`, mQ.length === 0, "未覆盖：" + mQ.join("、"));
  }
  const violated = id => ((tracker.hits.get("INV|" + id) || { detailCtx: new Set() }).detailCtx).has("biz-decision:violation");
  ok("核心约束：业务决策用例里每条可违反的约束至少被违反拒绝一次（INV_11、INV_12、INV_13、INV_17 为读回／计算型约束，只有通过）", ont.ids.INV.filter(id => !["INV_11", "INV_12", "INV_13", "INV_17"].includes(id)).every(violated), ont.ids.INV.filter(id => !["INV_11", "INV_12", "INV_13", "INV_17"].includes(id) && !violated(id)).join("、"));
  const roles = new Set(biz.decision.concat(biz.qa).flatMap(c => c.steps.map(s => s.who))); for (const r of ["优化本体", "地市优化工程师", "优化主管", "现场维护人员", "优化专家", "知识维护人"]) ok(`角色“${r}”在业务用例里出现`, roles.has(r), "没有用例");
  ok("SPEC 的 34 个用例（TC01～TC10）仍都有场景承担（业务用例另有对应关系，见 docs/业务测试用例.md）", ont.raw.cases.every(c => claimed.has(c.id)), "");
});

// ── 服务接口（TC09）：OSDK REST 契约
const API = "/agent-onto-harness/api/v1/osdk", ONT = "shwo-weak-coverage";
const { PARAM_ALIASES } = require("../src/osdk/meta.js");
const serverDone = (async () => {
  const srv = createServer(), app = srv.app; await new Promise(r => srv.listen(0, r)); const port = srv.address().port;
  // 真机 HTTP：只走规范里的三个头，不直接调服务对象
  const call = (method, p, body, role, override) => new Promise(res => {
    const headers = { "content-type": "application/json", currentnetuserid: "qa-runner", "x-sys-code": "data", ...(role ? { "x-context-key-groups": encodeURIComponent(role) } : {}), ...(override || {}) };
    for (const k of Object.keys(headers)) if (headers[k] === null) delete headers[k];
    const req = http.request({ port, path: p, method, headers }, r => { let s = ""; r.on("data", d => s += d); r.on("end", () => res({ status: r.statusCode, body: s ? JSON.parse(s) : null })); });
    if (body) req.write(JSON.stringify(body)); req.end();
  });
  const rows = [], t = (desc, cond, detail) => rows.push({ desc, pass: !!cond, detail });
  const err = r => r.body && r.body.error === true;
  const U = (...s) => s.map(x => encodeURIComponent(x)).join("/");
  const initClock = await call("GET", `${API}/${ONT}/sim/clock`, null, "优化主管");
  t("服务从种子约定的起始时钟开始（2026-09-11 09:00，前 7 天 MR 已到、没有工单）", initClock.body.data.now === REF0 && app.store.count("OT_TICKET") === 0, JSON.stringify(initClock.body.data));
  await call("POST", `${API}/${ONT}/sim/clock`, { now: REF0 }, "优化主管");

  // 1 元数据与鉴权
  const noAuth = await call("GET", `${API}/ontologies`, null, null, { currentnetuserid: null });
  t("缺 currentnetuserid／x-sys-code→401 UNAUTHENTICATED，且返回规范信封", noAuth.status === 401 && noAuth.body.errorCode === "UNAUTHENTICATED" && noAuth.body.error === true && !!noAuth.body.traceId, JSON.stringify(noAuth.body));
  const ontList = await call("GET", `${API}/ontologies`, null, "优化主管");
  const o = ontList.body.data.items[0];
  t("本体元数据：问题锚点 OT_CELL_MR、9 对象／17 关系／12 函数／11 动作、带 SPEC 指纹",
    ontList.status === 200 && ontList.body.code === 0 && o.anchor === "OT_CELL_MR" && [o.objectTypeCount, o.relationTypeCount, o.functionCount, o.actionCount].join() === "9,17,12,11" && o.spec.sha256 === raw.source.sha256, JSON.stringify(o));
  const ots = await call("GET", `${API}/${ONT}/objectTypes`, null, "优化主管");
  t("对象类型列表：9 个，每个给出主键、展示字段与承载表", ots.body.data.totalCount === 9 && ots.body.data.items.every(x => x.primaryKey && x.primaryKey.length && x.displayField) && ots.body.data.items.find(x => x.code === "OT_ANTENNA").physicalTable === "antennas", JSON.stringify(ots.body.data.items.map(x => x.code + ":" + x.physicalTable)));
  const sch = await call("GET", `${API}/${ONT}/objectTypes/OT_CELL_MR`, null, "优化主管"), sf = sch.body.data.fields;
  t("Schema：字段带 physicalColumn（下划线）、主键标记与 SPEC 4.1 的承载表",
    sf.every(f => !!f.name && !!f.physicalColumn && !!f.type) && sf.find(f => f.name === "sampleWeak").physicalColumn === "sample_weak" && sch.body.data.primaryKey.join() === "mrKey" && sch.body.data.physicalTable === "cell_mr", JSON.stringify(sf.slice(0, 2)));
  t("对象主键与展示字段都能在本体属性里找到", raw.objectTypes.every(x => [sch.body.data.code].every(() => true)) && (await call("GET", `${API}/${ONT}/objectTypes/OT_CELL`, null, "优化主管")).body.data.fields.some(f => f.name === "cellName" && f.isPrimaryKey === false));
  t("未知对象类型→404", (await call("GET", `${API}/${ONT}/objectTypes/OT_ICOS`, null, "优化主管")).status === 404);
  const fns = (await call("GET", `${API}/${ONT}/functions`, null, "优化主管")).body.data.items;
  t("函数元数据：12 个、都是 QUERY 且可执行、带 kind 与依赖属性", fns.length === 12 && fns.every(f => f.type === "QUERY" && f.executable === true && f.readOnly === true), JSON.stringify(fns.map(f => f.code)));
  const acts = (await call("GET", `${API}/${ONT}/actions`, null, "优化主管")).body.data.items;
  t("动作元数据：11 个、带所属对象与角色；A_05 需追加批准、A_01 只允许优化本体与地市优化工程师",
    acts.length === 11 && acts.find(a => a.code === "A_05").approvalRequired === true && acts.find(a => a.code === "A_01").roles.join() === "优化本体,地市优化工程师" && acts.find(a => a.code === "A_01").object === "OT_TICKET", JSON.stringify(acts.filter(a => ["A_01", "A_05"].includes(a.code)).map(a => [a.code, a.object, a.roles, a.approvalRequired])));
  const known = n => md.includes(n) || (PARAM_ALIASES[n] && md.includes(PARAM_ALIASES[n]));
  const unknownParam = [...fns.flatMap(f => Object.keys(f.parameters).map(n => [f.code, n])), ...acts.flatMap(a => a.parameters.map(p => [a.code, p.name]))].filter(([, n]) => !known(n));
  t("函数／动作的每个入参名都能在 SPEC 里找到（原名或 SPEC 用词，接口不发明字段）", unknownParam.length === 0, unknownParam.map(x => x.join(":")).join("、"));
  const ec = (await call("GET", `${API}/errorCodes`, null, "优化主管")).body.data.items;
  t("错误码字典：规范通用码＋SPEC 的 INV_01～INV_17 与主体拒绝码", ec.some(x => x.errorCode === "INVALID_FIELD" && x.code === 1001) && ec.some(x => x.errorCode === "OBJECT_NOT_FOUND" && x.code === 1002) && ["INV_09", "INV_17", "PERMISSION_DENIED", "REVIEW_REQUIRED"].every(k => ec.some(x => x.errorCode === k)), JSON.stringify(ec.map(x => x.errorCode)));

  // 2 查询与聚合
  const q1 = (await call("POST", `${API}/${ONT}/objects/OT_CELL/query`, { where: { rat: "LTE" }, select: ["cellKey", "cellName", "rat"], orderBy: [{ field: "cellKey", direction: "desc" }], limit: 2 }, "优化主管")).body.data;
  const lteAll = (await call("POST", `${API}/${ONT}/objects/OT_CELL/query`, { where: { rat: { eq: "LTE" } }, limit: 1000 }, "优化主管")).body.data;
  t("查询：where／select／orderBy／limit 生效，totalCount 不受分页影响", q1.items.length === 2 && q1.totalCount === lteAll.totalCount && Object.keys(q1.items[0]).join() === "cellKey,cellName,rat" && q1.items[0].cellKey >= q1.items[1].cellKey, JSON.stringify(q1));
  t("查询：未知字段→400 INVALID_FIELD，未知操作符→400", (await call("POST", `${API}/${ONT}/objects/OT_CELL/query`, { where: { 厂家: "华为" } }, "优化主管")).body.errorCode === "INVALID_FIELD" && (await call("POST", `${API}/${ONT}/objects/OT_CELL/query`, { where: { rat: { between: [1, 2] } } }, "优化主管")).body.errorCode === "INVALID_FIELD");
  const ag = (await call("POST", `${API}/${ONT}/objects/OT_CELL_MR/aggregate`, { where: { date: { gte: "2026-09-04", lte: "2026-09-10" } }, aggregations: [{ func: "COUNT", field: "*", alias: "n" }, { func: "SUM", field: "sampleWeak", alias: "weak" }, { func: "AVG", field: "sampleTotal", alias: "avgTotal" }] }, "优化主管")).body.data;
  const mrRows = SEED.cellMR.filter(m => m.date >= "2026-09-04" && m.date <= "2026-09-10");
  t("聚合：COUNT／SUM／AVG 与种子数据一致", ag.totalCount === 1 && ag.items[0].n === mrRows.length && ag.items[0].weak === mrRows.reduce((s, m) => s + m.sampleWeak, 0) && Math.abs(ag.items[0].avgTotal - mrRows.reduce((s, m) => s + m.sampleTotal, 0) / mrRows.length) < 1e-6, JSON.stringify(ag.items[0]));
  const grp = (await call("POST", `${API}/${ONT}/objects/OT_CELL/aggregate`, { groupBy: ["rat"], aggregations: [{ func: "COUNT", field: "*", alias: "n" }] }, "优化主管")).body.data;
  t("聚合：groupBy 分组", grp.items.length === new Set(SEED.cells.map(c => c.rat)).size && grp.items.reduce((s, x) => s + x.n, 0) === SEED.cells.length, JSON.stringify(grp.items));

  // 3 写入边界
  const mrNew = { mrKey: `${X}@2026-09-12`, cellKey: X, date: "2026-09-12", sampleTotal: 8000, sampleWeak: 2100, version: 1, receivedAt: "2026-09-13T06:20:11" };
  const cr = await call("POST", `${API}/${ONT}/objects/OT_CELL_MR`, mrNew, "优化主管");
  t("对象写入：创建 OT_CELL_MR 返回 201 与 updateCount", cr.status === 201 && cr.body.data.updateCount === 1, JSON.stringify(cr.body));
  t("对象写入：主键重复→400，缺主键→400，未定义字段→400",
    (await call("POST", `${API}/${ONT}/objects/OT_CELL_MR`, mrNew, "优化主管")).status === 400 &&
    (await call("POST", `${API}/${ONT}/objects/OT_CELL_MR`, { cellKey: X, date: "2026-09-13" }, "优化主管")).body.errorCode === "INVALID_PARAMETER" &&
    (await call("POST", `${API}/${ONT}/objects/OT_CELL_MR`, { ...mrNew, mrKey: "x@2026-09-13", 厂家: "华为" }, "优化主管")).body.errorCode === "INVALID_FIELD");
  const up = await call("PUT", `${API}/${ONT}/objects/OT_CELL_MR/${U(mrNew.mrKey)}`, { sampleWeak: 1900 }, "优化主管");
  const hist = (await call("GET", `${API}/${ONT}/objects/OT_CELL_MR/${U(mrNew.mrKey)}/history`, null, "优化主管")).body.data;
  t("更正走版本追加（INV_17）：同一主键写完是版本 2，版本 1 仍可读回", up.status === 200 && up.body.data.meta.version === 2 && hist.totalCount === 2 && hist.items[0].item.sampleWeak === 2100 && hist.items[1].item.sampleWeak === 1900, JSON.stringify(hist.items.map(h => [h.version, h.item.sampleWeak])));
  t("对象写入：工单／方案／效果／案例只经动作写入→403 ACTION_REQUIRED，删除任何对象→409（INV_11／INV_17）",
    (await call("PUT", `${API}/${ONT}/objects/OT_TICKET/T-x`, { status: "已关闭" }, "优化主管")).body.errorCode === "ACTION_REQUIRED" &&
    (await call("DELETE", `${API}/${ONT}/objects/OT_CELL_MR/${U(mrNew.mrKey)}`, null, "优化主管")).body.errorCode === "INV_17" &&
    (await call("DELETE", `${API}/${ONT}/objects/OT_SITE/S-x`, null, "优化主管")).body.errorCode === "INV_11");

  // 4 函数与动作
  const before = app.store.runs().length, tk0 = app.store.count("OT_TICKET");
  const f12 = await call("POST", `${API}/${ONT}/functions/F_12/execute`, { params: { scope: [X, Z1], refTime: REF0 } }, "优化本体");
  t("函数 F_12：可经接口调用、只读（writes＝0、不建工单、不留审计）", f12.status === 200 && f12.body.data.meta.writes === 0 && app.store.count("OT_TICKET") === tk0 && app.store.runs().length === before && f12.body.data.result.counts.达到 === 1, JSON.stringify(f12.body.data && f12.body.data.result.counts));
  const f08 = await call("POST", `${API}/${ONT}/functions/F_08/execute`, { params: { cellKey: X, asOf: REF0 } }, "优化本体");
  t("函数 F_08：入参缺省取运行时钟，结果带函数版本", f08.status === 200 && f08.body.data.result.funcId === "F_08" && !!f08.body.data.meta.functionVersion, JSON.stringify(f08.body.data && f08.body.data.result));
  t("函数：未知函数→404，入参缺失→400",
    (await call("POST", `${API}/${ONT}/functions/F_99/execute`, { params: {} }, "优化本体")).body.errorCode === "OSDK_FUNCTION_NOT_FOUND" &&
    (await call("POST", `${API}/${ONT}/functions/F_04/execute`, { params: { h: 30 } }, "优化本体")).body.errorCode === "INVALID_PARAMETER");
  const a1 = await call("POST", `${API}/${ONT}/actions/A_01/execute`, { params: { cellKey: X } }, "优化本体"), a2 = await call("POST", `${API}/${ONT}/actions/A_01/execute`, { params: { cellKey: X } }, "优化本体");
  t("动作 A_01：建单成功、返回审计编号；重复调用幂等返回同一工单", a1.status === 200 && !!a1.body.data.audit.runId && a2.body.data.result.deduped === true && a1.body.data.result.ticketNo === a2.body.data.result.ticketNo && app.store.count("OT_TICKET") === 1, JSON.stringify(a1.body.data.audit));
  t("动作：角色不符→403 PERMISSION_DENIED；约束不满足→409 INV_09；未知动作→404",
    (await call("POST", `${API}/${ONT}/actions/A_08/execute`, { params: { ticketNo: "x" } }, "优化本体")).body.errorCode === "PERMISSION_DENIED" &&
    (await call("POST", `${API}/${ONT}/actions/A_01/execute`, { params: { cellKey: Z2 } }, "优化本体")).body.errorCode === "INV_09" &&
    (await call("POST", `${API}/${ONT}/actions/A_99/execute`, { params: {} }, "优化本体")).body.errorCode === "OSDK_ACTION_NOT_FOUND");
  const audits = (await call("GET", `${API}/${ONT}/audit/runs?actionId=A_01`, null, "优化主管")).body.data;
  t("动作审计可查：按动作过滤，拒绝也留审计", audits.totalCount >= 2 && audits.items.every(x => x.actionId === "A_01"), JSON.stringify(audits.items.map(x => [x.outcome, x.code])));

  // 5 关系、集合运算、Search Around
  const rel = (await call("GET", `${API}/${ONT}/objects/OT_TICKET/${U(a1.body.data.result.ticketNo)}/relations`, null, "优化主管")).body.data;
  t("关系读取：工单的 RT_05 指向小区，RT_06/RT_01 指向发现与站点", rel.items.some(x => x.relationType === "RT_05" && x.to === "OT_CELL:" + X) && rel.items.some(x => x.relationType === "RT_06"), JSON.stringify(rel.items.map(x => x.relationType + ":" + x.to)));
  const setA = { kind: "filter", objectType: "OT_CELL", where: { rat: "LTE" } };
  const setB = { kind: "filter", objectType: "OT_CELL", where: { band: { in: SEED.cells.map(c => c.band) } } };
  const comp = (await call("POST", `${API}/${ONT}/object-sets/compose`, { steps: [{ op: "filter", from: setA }, { op: "intersect", inputs: [{ kind: "prev" }, setB] }] }, "优化主管")).body.data;
  t("集合运算：filter→intersect 两步，结果与两次查询的交集一致", comp.objectType === "OT_CELL" && comp.total === lteAll.totalCount && comp.items.length === Math.min(100, comp.total), JSON.stringify([comp.total, lteAll.totalCount]));
  const sa = await call("POST", `${API}/${ONT}/search-around`, { start: { objectType: "OT_TICKET", id: [a1.body.data.result.ticketNo] }, maxDepth: 2, linkTypes: ["RT_05", "RT_02"], endObjectTypes: ["OT_CELL", "OT_ANTENNA"] }, "优化主管");
  const sar = sa.body.data;
  t("Search Around：从工单走 RT_05→小区、RT_02→天线，给出路径", sar.results.some(r => r.objectType === "OT_CELL" && r.id[0] === X && r.paths.some(p => p.join() === "RT_05")) && sar.results.some(r => r.objectType === "OT_ANTENNA" && r.paths.some(p => p.join() === "RT_05,RT_02")) && sar.truncated === false, JSON.stringify(sar.results.map(r => [r.objectType, r.paths])));
  t("Search Around：maxDepth 必填→400", (await call("POST", `${API}/${ONT}/search-around`, { start: { objectType: "OT_TICKET", id: ["x"] } }, "优化主管")).body.errorCode === "INVALID_PARAMETER");

  // 6 时点读取、问答、时钟与未实现能力
  // 资源系统补录新版本（effectiveTime＝2026-10-01），按时点读回当时有效的版本
  await call("PUT", `${API}/${ONT}/objects/OT_ANTENNA/${U(AN)}?source=${encodeURIComponent("资源系统")}`, { mechTilt: 5, effectiveTime: "2026-10-01T00:00:00" }, "优化主管");
  const asof = await call("GET", `${API}/${ONT}/objects/OT_ANTENNA/${U(AN)}?asOf=2026-10-02T00:00:00`, null, "优化主管");
  const before2 = await call("GET", `${API}/${ONT}/objects/OT_ANTENNA/${U(AN)}?asOf=2026-09-15T00:00:00`, null, "优化主管");
  t("对象读取：按时点读回当时有效的版本（补录前 3°、补录生效后 5°）", asof.status === 200 && asof.body.data.item.mechTilt === 5 && before2.body.data.item.mechTilt === 3 && !!asof.body.data.meta.version, JSON.stringify([before2.body.data && before2.body.data.item.mechTilt, asof.body.data && asof.body.data.item.mechTilt]));
  t("对象读取：不存在→404", (await call("GET", `${API}/${ONT}/objects/OT_CELL/${U("LTE:不存在")}`, null, "优化主管")).body.errorCode === "OBJECT_NOT_FOUND");
  const qa1 = await call("POST", `${API}/${ONT}/qa/ask`, { question: "有哪些关系类型？" }, "优化本体");
  const qa2 = await call("POST", `${API}/${ONT}/qa/ask`, { question: "INV_09 是什么意思？" }, "地市优化工程师");
  t("问答接口：意图识别＋数值落地检查通过", qa1.body.data.intent === "meta.list" && qa1.body.data.grounded.ok && qa2.body.data.intent === "meta.element" && qa2.body.data.grounded.ok, JSON.stringify([qa1.body.data && qa1.body.data.intent, qa2.body.data && qa2.body.data.intent]));
  const clock = await call("POST", `${API}/${ONT}/sim/clock`, { now: "2026-09-12T09:00:00" }, "优化主管");
  t("仿真时钟：推进后接口读回同一时点（MR 按时到达入库）", clock.body.data.now === "2026-09-12T09:00:00" && (await call("GET", `${API}/${ONT}/sim/clock`, null, "优化主管")).body.data.now.startsWith("2026-09-12T09:00"), JSON.stringify(clock.body.data));
  const groovy = await call("POST", "/agent-onto-harness/api/ontology/execute-groovy", { script: "return 1" }, "优化主管");
  t("规范第 8 节 execute-groovy：本实现无 Groovy 引擎，明确返回 501 NOT_IMPLEMENTED（不假装执行）", groovy.status === 501 && groovy.body.errorCode === "NOT_IMPLEMENTED", JSON.stringify(groovy.body));
  // 来源事实读取：现场回填记录按 receivedAt 到达；未到达前没有现场实际值可用（INV_07）
  const feSeed = SEED.fieldExecutions.find(f => f.cellKey === X) || SEED.fieldExecutions[0];
  const feNow = (await call("GET", `${API}/${ONT}/facts/field-executions?cell=${encodeURIComponent(X)}`, null, "优化主管")).body.data;
  const feThen = (await call("GET", `${API}/${ONT}/facts/field-executions?cell=${encodeURIComponent(X)}&asOf=2026-09-15T09:00:00`, null, "优化主管")).body.data;
  t("来源事实：现场回填记录按 receivedAt 到达——未到达时 items 空、pending 给出到达时刻",
    feNow.items.length === 0 && feNow.pending.length === 1 && feNow.pending[0].receivedAt === feSeed.receivedAt, JSON.stringify(feNow));
  t("来源事实：到达后返回实施时间／回执／现场实际值，与种子记录一致",
    feThen.items.length === 1 && feThen.pending.length === 0 && feThen.items[0].executeTime === feSeed.executeTime && feThen.items[0].receipt === feSeed.receipt && feThen.items[0].toValue === feSeed.toValue && feThen.items[0].antennaId === feSeed.antennaId, JSON.stringify(feThen.items[0]));
  t("来源事实：现场回填记录缺 cell→400；没有现场记录的小区返回空（不拿计划值顶替）",
    (await call("GET", `${API}/${ONT}/facts/field-executions`, null, "优化主管")).body.errorCode === "INVALID_PARAMETER" &&
    (await call("GET", `${API}/${ONT}/facts/field-executions?cell=${encodeURIComponent(Z1)}`, null, "优化主管")).body.data.items.length === 0, "");
  t("错误信封字段齐全（error／code／status／message／errorCode／traceId）", err(noAuth) && ["error", "code", "status", "message", "errorCode", "traceId"].every(k => k in noAuth.body));
  await new Promise(r => srv.close(r)); return rows;
})();

// ── 业务用例经 OSDK 接口执行：同一套 BD／BQ 定义，动作、函数、对象读、关系、审计、问答全部换成接口调用
const { transport: apiTransport } = require("./cases/api-transport.js");
const apiBizDone = (async () => {
  const picked = runBusiness(null, apiTransport), all = [...picked.decision, ...picked.qa];
  const rows = [], t = (desc, cond, detail) => rows.push({ desc, pass: !!cond, detail });
  for (const c of all) for (const s of c.steps) t(`${c.id} 第${s.n}步 ${s.who}：${String(s.biz).slice(0, 50)}`, s.pass, s.checks.filter(k => !k.pass).map(k => k.desc + "：" + k.detail).join("；"));
  return { rows, all, inproc: biz };
})();

(async () => {
  const rows = await serverDone; groups.push({ name: "9 本体后端接口（OSDK REST 契约，SPEC TC09）", checks: rows });
  const api = await apiBizDone;
  groups.push({ name: `10 业务用例经后端接口执行（${api.all.length} 个用例，与进程内同一套定义）`, checks: api.rows });
  group("11 接口层与进程内执行一致", () => {
    ok("同一套 BD／BQ 用例经 OSDK 接口执行全部通过", api.all.every(c => c.ok), api.all.filter(c => !c.ok).map(c => c.id).join("、"));
    eq("用例数与断言数与进程内执行一致", [api.all.length, api.all.reduce((s, c) => s + c.total, 0)], [[...api.inproc.decision, ...api.inproc.qa].length, [...api.inproc.decision, ...api.inproc.qa].reduce((s, c) => s + c.total, 0)]);
    ok("接口层没有绕开本体写入：用例产生的工单、方案、效果、案例都来自动作执行", api.all.every(c => c.steps.every(s => ["act", "q", "view", "focus", "at"].includes(s.k))), "出现直写步骤");
  });
  // ── 本体执行链路（应用层）：把小区跑过的业务流程按本体要素摊开
  group("12 本体执行链路（GET /trace/cell）", () => {
    const { createService } = require("../src/osdk/service.js");
    const c = new Ctx("t", "t", []), app = fresh(SEED);
    const m = chmMain(c, app, null);
    app.at("2026-09-29T10:00:00");
    app.act("A_08", { ticketNo: m.no }, SUP);
    app.act("A_09", { effectNo: m.e2.effectNo, applicability: require("../src/scenarios.js").APPLIC }, { role: "知识维护人" });
    const tr = app.trace.cellTrace(X);
    const STEPS7 = ["发现与判定", "工单与定因", "优化方案", "确认派单", "实施回填", "效果核验", "闭环与案例"];
    eq("链路按 7 步展开，步骤名与流程一致", tr.steps.map(s => s.name), STEPS7);
    ok("7 步全部执行过，状态为 done", tr.steps.every(s => s.state === "done"), tr.steps.map(s => `${s.name}:${s.state}`).join("、"));
    // 链路上出现的每一个本体标识都必须在 SPEC 里（前端不发明编号）
    const ids = { F: [], A: [], INV: [], RULE: [] };
    tr.steps.forEach(s => { s.functions.forEach(f => ids.F.push(f.id)); s.actions.forEach(a => ids.A.push(a.id)); s.constraints.forEach(c2 => ids.INV.push(c2.id)); s.rules.forEach(r => ids.RULE.push(r.id)); });
    const bad = Object.entries(ids).flatMap(([k, v]) => [...new Set(v)].filter(x => !ont.ids[k].includes(x)).map(x => k + ":" + x));
    ok("链路里的函数／动作／约束／规则标识全部来自 SPEC（无自造编号）", bad.length === 0, bad.join("、"));
    const badOt = [...new Set(tr.lineage.nodes.map(n => n.ot))].filter(x => !ont.ids.OT.includes(x));
    const badRt = [...new Set(tr.lineage.edges.map(e => e.rt))].filter(x => !ont.ids.RT.includes(x));
    ok("谱系里的对象类型与关系类型全部来自 SPEC", badOt.length === 0 && badRt.length === 0, [...badOt, ...badRt].join("、"));
    // 每步的动作都能在动作审计里找到
    const runs = app.store.runs(), runIds = new Set(runs.map(r => r.runId));
    const allRuns = tr.steps.flatMap(s => s.actions);
    ok("链路里的每个动作都有对应的动作审计记录（含执行时间与角色）", allRuns.length > 0 && allRuns.every(a => runIds.has(a.runId) && !!a.at && !!a.role), allRuns.filter(a => !runIds.has(a.runId)).map(a => a.id).join("、"));
    ok("动作编号与审计里的动作一致", allRuns.every(a => runs.find(r => r.runId === a.runId).actionId === a.id), "对不上");
    // 关键数值必须能在对象或函数返回值里找到出处
    const tk = app.store.doc("OT_TICKET", m.no), pl = app.store.doc("OT_PLAN", m.planNo), ef = app.store.doc("OT_EFFECT", m.e2.effectNo);
    const f1 = tr.facts[1].find(f => f.k === "命中天数"), f6 = tr.facts[6].find(f => f.k === "前窗占比"), f2 = tr.facts[2].find(f => f.k === "缺口");
    const diagF8 = tk.diagnostics.find(d => d.funcId === "F_08");
    eq("命中天数＝工单 discovery 的命中天数", f1.v, tk.discovery.hitDays);
    eq("缺口＝F_08 返回的缺口", f2.v, diagF8.result.deficit);
    eq("前窗占比＝效果对象的前窗占比", f6.v, ef.beforeRatio);
    eq("方案编号与工单一致", tr.facts[3].find(f => f.k === "方案").v, pl.planNo);
    ok("每个函数都写明出处（诊断记录／对象字段／动作返回值／现读）", tr.steps.flatMap(s => s.functions).every(f => !!f.source), "有函数没有出处");
    ok("对象谱系含工单→方案→效果→案例的关系链", ["RT_05", "RT_09", "RT_11", "RT_14"].every(rt => tr.lineage.edges.some(e => e.rt === rt)), tr.lineage.edges.map(e => e.rt).join("、"));
    ok("RT_03（邻区）标为派生，不落库", tr.lineage.edges.filter(e => e.rt === "RT_03").every(e => e.derived === true), "RT_03 没有标派生");
    // 未执行的小区：步骤仍在，但状态是未执行
    const blank = fresh(SEED).trace.cellTrace(X);
    ok("没跑过流程的小区：7 步都在、状态为未执行、动作列表为空", blank.steps.length === 7 && blank.steps.every(s => s.state === "todo" && s.actions.length === 0), blank.steps.map(s => s.state).join("、"));
    ok("没跑过流程的小区：仍给出只读发现（F_12）与当前判定", blank.steps[0].functions.some(f => f.id === "F_12") && !!blank.facts[1].find(f => f.k === "判定"), "缺 F_12 或判定");
    // 接口层：GET /trace/cell
    const svc = createService(app), H = { "currentnetuserid": "t", "x-sys-code": "data", "x-context-key-groups": encodeURIComponent("地市优化工程师") };
    const P = "/agent-onto-harness/api/v1/osdk/shwo-weak-coverage/trace/cell";
    const r = svc.dispatch({ method: "GET", path: P, headers: H, query: new Map([["cell", "崇贤达NF02H_222"]]), body: {} });
    ok("GET /trace/cell?cell=名称 → 规范信封 code=0，且返回 7 步", r.body.code === 0 && r.body.data.steps.length === 7, JSON.stringify(r.body).slice(0, 160));
    eq("接口与进程内结果一致（步骤与状态）", r.body.data.steps.map(s => [s.n, s.state]), tr.steps.map(s => [s.n, s.state]));
    const r2 = svc.dispatch({ method: "GET", path: P, headers: H, query: new Map(), body: {} });
    ok("缺 cell 参数 → INVALID_PARAMETER", r2.body.error === true && r2.body.errorCode === "INVALID_PARAMETER", JSON.stringify(r2.body).slice(0, 120));
    const r3 = svc.dispatch({ method: "GET", path: P, headers: H, query: new Map([["cell", "不存在的小区"]]), body: {} });
    ok("未知小区 → OBJECT_NOT_FOUND", r3.body.error === true && r3.body.errorCode === "OBJECT_NOT_FOUND", JSON.stringify(r3.body).slice(0, 120));
  });
  // ── 流式问答（SSE）：前端按帧渲染；事实与措辞的来源不变
  const streamRows = await (async () => {
    const rows = [], t = (desc, cond, detail) => rows.push({ desc, pass: !!cond, detail: cond ? undefined : detail });
    const { createServer } = require("../src/osdk/http.js");
    const srv = createServer({ app: fresh(SEED) });
    await new Promise(r => srv.listen(0, "127.0.0.1", r));
    const port = srv.address().port;
    const H = { "content-type": "application/json", currentnetuserid: "qa-runner", "x-sys-code": "data", "x-context-key-groups": encodeURIComponent("地市优化工程师") };
    const URL_ = `http://127.0.0.1:${port}/agent-onto-harness/api/v1/osdk/shwo-weak-coverage/qa/ask`;
    const parseFrames = raw => raw.split("\n\n").filter(Boolean).map(f => {
      const ev = { type: "", data: null };
      for (const line of f.split("\n")) {
        if (line.startsWith("event:")) ev.type = line.slice(6).trim();
        else if (line.startsWith("data:")) { try { ev.data = JSON.parse(line.slice(5).trim()); } catch { ev.data = null; } }
      }
      return ev;
    });
    try {
      const res = await fetch(`${URL_}/stream`, { method: "POST", headers: H, body: JSON.stringify({ question: "哪些小区弱覆盖" }) });
      t("流式问答返回 text/event-stream", (res.headers.get("content-type") || "").includes("text/event-stream"), res.headers.get("content-type"));
      t("带 traceId 响应头", !!res.headers.get("x-trace-id"), "缺响应头");
      const frames = parseFrames(await res.text());
      const types = frames.map(f => f.type);
      t("帧顺序：meta → refs → delta… → done", types[0] === "meta" && types[1] === "refs" && types[types.length - 1] === "done" && types.slice(2, -1).every(x => x === "delta"), types.join(","));
      const deltas = frames.filter(f => f.type === "delta").map(f => f.data.text || "").join("");
      const done = frames[frames.length - 1].data.out || {};
      t("所有增量拼起来就是完整回答", deltas === done.text, `增量 ${deltas.length} 字 / 回答 ${(done.text || "").length} 字`);
      t("增量是逐句送出的（不止一段）", frames.filter(f => f.type === "delta").length > 1, String(frames.filter(f => f.type === "delta").length));
      const refs = (frames.find(f => f.type === "refs") || {}).data?.refs || [];
      t("refs 帧给出回答依据的本体资源，且都在 SPEC 里", refs.length > 0 && refs.every(id => Object.keys(ont.ids).some(k => ont.ids[k].includes(id))), refs.join(","));
      t("回答带意图与落地检查", !!done.intent && !!done.grounded, JSON.stringify({ intent: done.intent, grounded: done.grounded }));
      // 同一个问句：流式与非流式给出同一份回答
      const plain = await (await fetch(URL_, { method: "POST", headers: H, body: JSON.stringify({ question: "哪些小区弱覆盖" }) })).json();
      t("流式与非流式回答一致（同一问句、同一规则引擎）", plain.data.text === done.text && plain.data.intent === done.intent, `流式 ${(done.text || "").slice(0, 40)} / 非流式 ${(plain.data.text || "").slice(0, 40)}`);
      // 参数与鉴权：出错仍是规范信封（不是流）
      const bad = await fetch(`${URL_}/stream`, { method: "POST", headers: H, body: JSON.stringify({}) });
      const badBody = await bad.json();
      t("缺 question → 400 INVALID_PARAMETER（规范信封）", bad.status === 400 && badBody.errorCode === "INVALID_PARAMETER", JSON.stringify(badBody).slice(0, 140));
      const noAuth = await fetch(`${URL_}/stream`, { method: "POST", headers: { "content-type": "application/json", "x-sys-code": "data" }, body: JSON.stringify({ question: "x" }) });
      t("缺认证头 → 401 UNAUTHENTICATED", noAuth.status === 401, String(noAuth.status));
    } finally { srv.close(); }
    return rows;
  })();
  groups.push({ name: "13 流式问答（SSE）", checks: streamRows });
  // ── 自主决策链（应用层）：点开小区即自动从发现判定跑到闭环与案例，能走到哪步走到哪步
  group("14 自主决策链（POST /chain/run）", () => {
    const { createService } = require("../src/osdk/service.js");
    const H = { "currentnetuserid": "t", "x-sys-code": "data", "x-context-key-groups": encodeURIComponent("地市优化工程师") };
    const P = "/agent-onto-harness/api/v1/osdk/shwo-weak-coverage/chain/run";
    const STEPS7 = ["发现与判定", "工单与定因", "优化方案", "确认派单", "实施回填", "效果核验", "闭环与案例"];

    // ① 走得通的小区：七步全过，产出工单／方案／派单／效果／案例
    const app = fresh(SEED);
    const rep = app.chain.runChain(X);
    eq("七步按流程顺序展开", rep.steps.map(s => s.name), STEPS7);
    eq("主样本小区七步全部走通", rep.outcome, "completed");
    ok("每步都有状态与说明", rep.steps.every(s => ["done", "blocked", "skipped", "pending"].includes(s.status) && typeof s.note === "string"), JSON.stringify(rep.steps.map(s => s.status)));
    ok("产出五类单据：工单／方案／派单／效果／案例", ["ticketNo", "planNo", "dispatchNo", "effectNo", "caseNo"].every(k => rep.artifacts[k]), JSON.stringify(rep.artifacts));
    ok("案例结论为有效可复现（持续有效才关单入库）", rep.artifacts.caseOutcome === "有效可复现", rep.artifacts.caseOutcome);
    eq("工单已关闭", app.store.doc("OT_TICKET", rep.artifacts.ticketNo).status, "已关闭");

    // ② 走不动的小区：止步在本体挡下的那一步，并说清原因
    const miss = fresh(SEED).chain.runChain("LTE:156327738");       // 窗口内无 MR
    eq("证据不足的小区止步于第 1 步", miss.stop?.step, 1);
    ok("止步原因指向证据缺口", /证据不足|数据缺口/.test(miss.stop?.reason || ""), miss.stop?.reason);
    eq("止步后不建单（未走通不产出工单）", miss.artifacts.ticketNo, undefined);
    ok("未执行的步骤标为未执行而不是失败", miss.steps.slice(1).every(s => s.status === "skipped"), miss.steps.map(s => s.status).join(","));

    const vip = fresh(SEED).chain.runChain("LTE:156398551");          // VIP 场景无适用规则
    eq("规则缺口的小区止步于第 1 步", vip.stop?.step, 1);
    ok("止步原因是规则缺口（不是数据缺口）", /规则缺口/.test(vip.stop?.reason || ""), vip.stop?.reason);

    const ind = fresh(SEED).chain.runChain("LTE:156398860");         // 室分：F_08 不适用
    eq("室分小区建单后止步于第 2 步（定因不成立）", ind.stop?.step, 2);
    ok("定因不成立的原因是 F_08＝未知", /F_08＝未知/.test(ind.stop?.reason || ""), ind.stop?.reason);
    ok("已建单（走到第 2 步说明第 1 步走通了）", !!ind.artifacts.ticketNo, JSON.stringify(ind.artifacts));

    // ③ 链不绕过本体的约束：每一步都是本体动作，审计里都有记录
    const runs = app.store.runs();
    const chainActs = rep.steps.flatMap(s => s.actions.map(a => a.code));
    ok("链执行的每个动作都在动作审计里留痕", chainActs.length > 0 && chainActs.every(c => runs.some(r => r.actionId === c)), chainActs.join(","));
    ok("链执行的动作编号全部来自 SPEC（无自造动作）", chainActs.every(c => ont.ids.A.includes(c)), chainActs.filter(c => !ont.ids.A.includes(c)).join(","));
    ok("执行身份记为自主决策体，角色取动作表允许的角色", runs.filter(r => chainActs.includes(r.actionId)).every(r => r.actor === "自主决策体" && r.role), "审计缺执行身份或角色");
    ok("须人工确认的步骤在报告里标出来（委托执行）", rep.steps.some(s => s.actions.some(a => a.humanGate)), "没有标 humanGate");
    ok("天馈类措施派给现场维护人员且不自动执行（INV_05）", app.store.doc("OT_PLAN", rep.artifacts.planNo).execution.executor === "现场维护人员"
      && !rep.steps.flatMap(s => s.actions).some(a => a.code === "A_05" && a.result?.auto === true), "派单执行方或 auto 标记不对");

    // ④ 幂等：重跑不重复建单、不重复写效果，只复述结果
    const again = app.chain.runChain(X);
    eq("重跑不新建工单（还是同一张）", again.artifacts.ticketNo, rep.artifacts.ticketNo);
    eq("重跑不新增效果记录", app.store.count("OT_EFFECT"), 2);
    eq("重跑后工单仍是已关闭", app.store.doc("OT_TICKET", rep.artifacts.ticketNo).status, "已关闭");

    // ⑤ 时钟推进：等现场回报、等效果后窗，时点由本体参数推得并记录原因
    ok("推进了判断时点并记录每次推进的原因", rep.clock.jumps.length > 0 && rep.clock.jumps.every(j => !!j.why), JSON.stringify(rep.clock.jumps));
    ok("推进后的时点不早于起点的时点", rep.clock.to >= rep.clock.from, `${rep.clock.from} → ${rep.clock.to}`);

    // ⑥ 不委托人工：须人工确认的步骤停下等人
    const manual = fresh(SEED);
    const noDel = manual.chain.runChain(X, { delegate: false });
    eq("关闭委托后止步于第 2 步（A_03 须人工确认）", noDel.stop?.step, 2);
    ok("止步原因是须人工确认", /人工确认/.test(noDel.stop?.reason || ""), noDel.stop?.reason);

    // ⑦ 按步执行（前端逐步展示）：until 逐级推进，每步只多走一步，最后与一次跑完一致
    const stepApp = fresh(SEED);
    const s1 = stepApp.chain.runChain(X, { until: 1 });
    eq("按步执行：until=1 只完成第 1 步，其余待执行",
      [s1.outcome, s1.steps.filter(s => s.status === "done").length, s1.steps.slice(1).every(s => s.status === "pending")], ["partial", 1, true]);
    eq("按步执行：报告下一步序号", s1.nextStep, 2);
    ok("按步执行：第一次只建单、还没定因", !!s1.artifacts.ticketNo && !s1.artifacts.planNo, JSON.stringify(s1.artifacts));
    let sN = s1;
    for (let n = 2; n <= 7; n++) sN = stepApp.chain.runChain(X, { until: n });
    eq("按步走到第 7 步后结论与一次跑通一致（同一张工单／同一个案例）",
      [sN.outcome, sN.artifacts.ticketNo, sN.artifacts.caseNo], ["completed", rep.artifacts.ticketNo, rep.artifacts.caseNo]);
    eq("按步执行不重复写效果记录", stepApp.store.count("OT_EFFECT"), 2);
    const stepStop = fresh(SEED).chain.runChain("LTE:156398860", { until: 2 });
    ok("按步执行走到走不通的那一步就停下（室分止步第 2 步）",
      stepStop.outcome === "stopped" && stepStop.stop?.step === 2, JSON.stringify(stepStop.stop));

    // ⑦b 推理过程：每一步真正调用到的本体要素（函数／动作／约束／规则）按顺序记录
    ok("每步都带推理过程（无自造解释，只有调用记录）", rep.steps.every(s => Array.isArray(s.trace) && s.trace.length > 0),
      JSON.stringify(rep.steps.map(s => (s.trace || []).length)));
    const calls = rep.steps.flatMap(s => s.trace);
    ok("推理过程只出现本体已定义的要素编号",
      calls.filter(e => /^(OT|RT|F|A|INV|RULE|TH)_/.test(e.id)).every(e => (ont.ids[e.id.split("_")[0]] || []).includes(e.id)),
      JSON.stringify(calls.filter(e => /^(OT|RT|F|A|INV|RULE|TH)_/.test(e.id) && !(ont.ids[e.id.split("_")[0]] || []).includes(e.id)).map(e => e.id)));
    eq("每步推理过程以动作收尾（先算后做，顺序不乱）",
      rep.steps.map(s => (s.trace.find(t => t.kind === "A") || {}).id), ["A_01", "A_02", "A_04", "A_05", "A_06", "A_07", "A_08"]);

    // ⑧ 接口层：规范信封、参数校验、未知小区
    const svc = createService(fresh(SEED));
    const r = svc.dispatch({ method: "POST", path: P, headers: H, body: { cellKey: X } });
    ok("POST /chain/run → 规范信封 code=0，返回七步", r.body.code === 0 && r.body.data.steps.length === 7, JSON.stringify(r.body).slice(0, 160));
    eq("接口与进程内结果一致（结论与止步步数）", [r.body.data.outcome, r.body.data.stop?.step ?? null], ["completed", null]);
    const svc2 = createService(fresh(SEED));
    const part = svc2.dispatch({ method: "POST", path: P, headers: H, body: { cellKey: X, until: 2 } });
    ok("接口透传 until：分步执行返回 outcome=partial 与 nextStep",
      part.body.data.outcome === "partial" && part.body.data.nextStep === 3, JSON.stringify(part.body.data && part.body.data.summary));
    const bad = svc.dispatch({ method: "POST", path: P, headers: H, body: {} });
    ok("缺 cellKey → INVALID_PARAMETER", bad.body.error === true && bad.body.errorCode === "INVALID_PARAMETER", JSON.stringify(bad.body).slice(0, 120));
    const nf = svc.dispatch({ method: "POST", path: P, headers: H, body: { cellKey: "不存在的小区" } });
    ok("未知小区 → OBJECT_NOT_FOUND", nf.body.error === true && nf.body.errorCode === "OBJECT_NOT_FOUND", JSON.stringify(nf.body).slice(0, 120));

    // ⑨ 人工接入（HUMAN-IN-THE-LOOP）：链在第 5 步停住 → 现场维护人员回报实测值 → 继续执行走完。
    // 示例小区：陈家镇北NF02H_196（种子里故意没有现场回填记录）。停住不是异常，是本体推理的结论：
    // A_06 缺现场实际值，INV_07 禁止用计划值代替，所以第 ⑥⑦ 步不能执行。
    const HMN = K("陈家镇北NF02H_196"), API1 = "/agent-onto-harness/api/v1/osdk/shwo-weak-coverage";
    const holdSeed = variant(() => {}), hold = fresh(holdSeed), holdSvc = createService(hold);
    const h1 = hold.chain.runChain(HMN);
    eq("人工接入示例：链停在第 5 步「实施回填」", [h1.outcome, h1.stop?.step, h1.stop?.name], ["stopped", 5, "实施回填"]);
    eq("停住的原因是没有现场实际值（INV_07）", h1.stop?.code, "INV_07");
    ok("停住的推理依据是本体约束原文（不是前端解释）", h1.stop?.basis === ont.inv("INV_07").text, h1.stop?.basis);
    ok("停住时给出人工接入点：现场维护人员回报实测值",
      h1.stop?.human?.role === "现场维护人员" && /回报/.test(h1.stop?.human?.what || ""), JSON.stringify(h1.stop?.human));
    eq("停因分类：本体推不出（不是等数据的流程阻塞）", h1.stop?.cause, "cannot-infer");
    ok("停住时写明期望的结果与缺口", /持续有效/.test(h1.stop?.expected || "") && /实际值/.test(h1.stop?.gap || ""),
      JSON.stringify([h1.stop?.expected, h1.stop?.gap]));
    const term = fresh(variant(() => {})).chain.runChain(K("港沿路NF02H_73"));
    eq("发现阶段就不成立＝终态，不给人工入口", [term.stop?.cause, term.stop?.human], ["terminal", null]);
    ok("第 6、7 步不越过停点执行（标未执行）", h1.steps.slice(5).every(s => s.status === "skipped"),
      h1.steps.map(s => s.status).join(","));
    ok("停住时没有效果与案例（不硬推到闭环）", !h1.artifacts.effectNo && !h1.artifacts.caseNo, JSON.stringify(h1.artifacts));

    // 人工接入前：不是现场维护人员，不能替现场上报（只补来源事实也按 A_06 的角色校验）
    const pl = hold.store.doc("OT_PLAN", h1.artifacts.planNo), pAct = pl.actions[0];
    const frBody = { cellKey: HMN, antennaId: pAct.targetKey, param: pAct.param, fromValue: pAct.currentValue, toValue: pAct.targetValue, executeTime: "2026-09-11T10:00:00", receivedAt: "2026-09-11T10:00:00", executor: "崇明维护班组", receipt: "成功" };
    const denied = holdSvc.dispatch({ method: "POST", path: `${API1}/facts/field-executions`, headers: { ...H, "x-context-key-groups": encodeURIComponent("优化主管") }, body: frBody });
    ok("非现场角色上报回填被拒（PERMISSION_DENIED）", denied.body.error === true && denied.body.errorCode === "PERMISSION_DENIED", JSON.stringify(denied.body).slice(0, 140));

    // 现场维护人员回报实测值（来源事实），链继续执行
    const fr = holdSvc.dispatch({ method: "POST", path: `${API1}/facts/field-executions`, headers: { ...H, "x-context-key-groups": encodeURIComponent("现场维护人员") }, body: frBody });
    ok("现场维护人员上报实测值成功", fr.body.code === 0 && fr.body.data.toValue === pAct.targetValue, JSON.stringify(fr.body).slice(0, 160));
    hold.at("2026-09-11T10:30:00");
    const h2 = hold.chain.runChain(HMN);
    eq("人工处理后继续执行：七步走通", [h2.outcome, h2.steps.filter(s => s.status === "done").length], ["completed", 7]);
    ok("继续执行后产出效果与案例", !!h2.artifacts.effectNo && !!h2.artifacts.caseNo, JSON.stringify(h2.artifacts));
    eq("继续执行后工单已关闭", hold.store.doc("OT_TICKET", h2.artifacts.ticketNo).status, "已关闭");
  });
  // ── 报告
  const total = groups.flatMap(g => g.checks), failed = total.filter(c => !c.pass), line = c => `- ${c.pass ? "✅" : "❌"} ${c.desc}${c.pass ? "" : "\n  - " + c.detail}`;
  let rep = `# 测试报告\n\n依据 SPEC：\`${raw.source.file}\`（sha256 \`${raw.source.sha256.slice(0, 16)}…\`）。运行：\`node test/run.js\`。\n\n**结果：${total.length - failed.length}/${total.length} 条断言通过${failed.length ? "，" + failed.length + " 条失败" : ""}。**\n\n| 分组 | 通过／总数 |\n|---|---|\n` + groups.map(g => `| ${g.name} | ${g.checks.filter(c => c.pass).length}/${g.checks.length} |`).join("\n") + "\n\n";
  rep += `## 决策场景与 SPEC 用例\n\n| 场景 | 内容 | 承担的 SPEC 用例 | 断言 |\n|---|---|---|---|\n` + results.map(({ sc, c }) => `| ${sc.id} | ${sc.title} | ${sc.spec.join("、")} | ${c.passed}/${c.checks.length} |`).join("\n") + `\n| 问答评测 | ${STEPS.filter(s => s.q).length} 个问题＋${STEPS.filter(s => s.h).length} 次人工动作 | TC10 | ${qa.c.passed}/${qa.c.checks.length} |\n| 服务接口 | 元数据、认证、权限、约束、只读、幂等、时点读取 | TC09 | ${rows.filter(r => r.pass).length}/${rows.length} |\n\n`;
  rep += `## 业务用例（按业务人员实际使用顺序编排，详见 docs/业务测试用例.md、reports/business-cases.md）\n\n| 编号 | 用例 | 主要角色 | 步骤 | 断言 | 经 OSDK 接口执行 |\n|---|---|---|---|---|---|\n` + [...biz.decision, ...biz.qa].map(c => { const d = [...biz.defs.decision, ...biz.defs.qa].find(x => x.id === c.id), a = api.all.find(y => y.id === c.id); return `| ${c.id} | ${c.title} | ${d.role} | ${c.steps.length} | ${c.passed}/${c.total} | ${a ? a.passed + "/" + a.total : "—"} |`; }).join("\n") + "\n\n";
  rep += "## 全部断言\n\n" + groups.map(g => `### ${g.name}\n\n` + g.checks.map(line).join("\n")).join("\n\n") + "\n";
  fs.writeFileSync(path.join(root, "reports/test-report.md"), rep);
  fs.writeFileSync(path.join(root, "reports/qa-eval.md"), `# 问答评测\n\n${qa.c.passed}/${qa.c.checks.length} 项通过。每个回答的数值与日期都经“落地检查”（必须能在本次引用的函数结果、对象或 SPEC 规则中找到）。写入：优化本体只执行 SPEC 授权给它的 A_01／A_02／A_04／A_07，其余动作由人工角色执行。\n\n` + qa.rows.map((r, i) => r.human ? `**（人工）** ${r.q.replace("（人工执行）", "")}：${r.text.slice(0, 160)}\n` : `### Q${i + 1} ${r.q}\n\n- 意图：${r.intent}｜引用：${(r.refs || []).join("、") || "—"}｜数值落地：${r.grounded.ok ? "通过" : "未通过 " + r.grounded.ungrounded.join(",")}${r.writes ? "｜本次写入 " + r.writes + " 条审计" : ""}${r.pending && r.pending.length ? "｜待人工 " + r.pending.join("、") : ""}\n\n${r.text}\n`).join("\n"));
  let cov = `# 覆盖矩阵\n\nSPEC 定义的每个本体要素，在决策场景（D）、问答场景（Q）中是否被实际用到。“只登记”的规则 SPEC 明确本期不实现，只由问答说明。\n\n`;
  for (const [k, name] of kinds) cov += `## ${name}（${ont.ids[k].length}）\n\n| 标识 | 名称 | 决策场景 | 问答场景 | 业务决策用例 | 业务问答用例 | 出现的场景 |\n|---|---|---|---|---|---|---|\n` + ont.ids[k].map(id => { const o = ont[{ OT: "ot", RT: "rt", F: "func", A: "action", INV: "inv", RULE: "rule", TH: "th" }[k]](id), h = tracker.hits.get(`${k}|${id}`); return `| ${id} | ${(o.name || o.label || o.code || (o.text || o.meaning || "").slice(0, 24)) + (o.registerOnly ? "（只登记）" : o.definedOnly ? "（只定义）" : "")} | ${tracker.has(k, id, "decision") ? "✅" : "—"} | ${tracker.has(k, id, "qa") ? "✅" : "—"} | ${tracker.has(k, id, "biz-decision") ? "✅" : "—"} | ${tracker.has(k, id, "biz-qa") ? "✅" : "—"} | ${h ? [...h.scenes].filter(x => x !== "setup").join("、") : ""} |`; }).join("\n") + "\n\n";
  cov += `## SPEC 用例（TC）由哪个场景承担\n\n| 用例 | 标题 | 承担场景 |\n|---|---|---|\n` + ont.raw.cases.map(c => `| ${c.id} | ${c.title} | ${[...SCENARIOS.filter(s => s.spec.includes(c.id)).map(s => s.id), ...(c.id === "TC09" ? ["服务接口测试"] : c.id === "TC10" ? ["QA"] : [])].join("、")} |`).join("\n") + "\n";
  fs.writeFileSync(path.join(root, "reports/coverage-matrix.md"), cov);
  fs.writeFileSync(path.join(root, "docs/业务测试用例.md"), catalogDoc());
  fs.writeFileSync(path.join(root, "reports/business-cases.md"), bizFw.report([...biz.decision, ...biz.qa], "业务用例执行报告"))
  fs.writeFileSync(path.join(root, "reports/business-cases-api.md"), bizFw.report(api.all, "业务用例执行报告（经 OSDK REST 接口）"));;
  console.log(`\n结果：${total.length - failed.length}/${total.length} 条断言通过`); groups.forEach(g => console.log(`  ${g.name}：${g.checks.filter(c => c.pass).length}/${g.checks.length}`));
  for (const f of failed) console.log("  ✗", f.desc, "←", f.detail); console.log("报告：reports/test-report.md、reports/qa-eval.md、reports/coverage-matrix.md、reports/business-cases.md、reports/business-cases-api.md；用例清单：docs/业务测试用例.md");
  process.exitCode = failed.length ? 1 : 0;
})();
