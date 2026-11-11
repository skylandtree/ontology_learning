// 决策场景：SPEC 第六章用例（TC01～TC10）在上海数据上的执行。每个场景新建一个空存储，装载 data/seed/ 下的 CSV，随时钟推进接收 MR 日统计，
// 通过动作入口走完业务链路（必要时只改一条事实），用 ctx.ok／eq／near／rej 记录断言。数值预期来自 data/expected/expected.json（独立构建器生成）。
const fs = require("node:fs"), path = require("node:path");
const { addDays } = require("./facts.js"), { createApp } = require("./app.js"), { tracker } = require("./tracker.js"), { loadMR } = require("./loader.js"), { readSeed } = require("./seed.js");
const root = path.join(__dirname, ".."), SEED = readSeed(), EXP = JSON.parse(fs.readFileSync(path.join(root, "data/expected/expected.json"), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o)), variant = mut => { const s = clone(SEED); mut(s); return s; };

// 小区按名称取标识：场景里一律用小区名称指代，不写死 ECI／NCI
const K = name => { const c = SEED.cells.find(x => x.cellName === name); if (!c) throw new Error("种子里没有小区 " + name); return c.cellKey; };
const NAME = key => (SEED.cells.find(x => x.cellKey === key) || {}).cellName || key, antOf = key => SEED.cellAntenna.find(x => x.cellKey === key).antennaId;
const X = K("崇贤达NF02H_222"), Y = K("崇贤达NF08H_223"), Z1 = K("崇贤北NF02H_141"), Z2 = K("陈家镇东NF02H_87"), SIM = K("庙镇新村NF02H_126"), BAO = K("宝泰支HR05H_112"), N1 = K("海剑HR03H_121");
const C2 = K("东滩公园NF02H_164"), C3 = K("港沿路NF02H_73"), C4 = K("新河镇政府NF02H_58"), C5 = K("堡镇中心NF02H_132"), C8 = K("崇明体育中心NF02H_215"), C10 = K("崇明医院门诊楼ND08H_12"), C11 = K("陈家镇HR05H_36"), C12 = K("长兴客运码头HR12H_9");
const HMN = K("陈家镇北NF02H_196");   // 人工接入演示小区（第 5 步停住等现场回报）
const AN = antOf(X), AZ1 = antOf(Z1), AZ2 = antOf(Z2), ASIM = antOf(SIM), FE = SEED.fieldExecutions[0], EXEC = FE.executeTime;
const nX = NAME(X), nY = NAME(Y), nZ1 = NAME(Z1), nZ2 = NAME(Z2), nS = NAME(SIM);
const BOT = { role: "优化本体" }, ENG = { role: "地市优化工程师", name: "崇明地市工程师" }, SUP = { role: "优化主管" }, FLD = { role: "现场维护人员", name: FE.executor }, KNW = { role: "知识维护人" }, EXPERT = { role: "优化专家" };
const REF = "2026-09-11T09:00:00", OCT = "2026-10-23T09:00:00";
const APPLIC = { rat: "LTE", siteType: "宏站", sceneLevel: "一般", areaScene: "乡镇道路", urbanRural: "农村", indoorOutdoor: "室外", causeFamily: "下倾角过小" };
const SEP_SCOPE = [X, Y, C2, C3, C4, C5, C8, C10, C11, C12, Z1, Z2, HMN];
const pairsRows = (cell, dates, pairs) => dates.map((date, i) => ({ cellKey: cell, date, sampleWeak: pairs[i][0], sampleTotal: pairs[i][1] }));

class Ctx {
  constructor(id, title, spec) { this.id = id; this.title = title; this.spec = spec; this.steps = []; this.checks = []; }
  step(t) { this.steps.push(t); }
  ok(desc, cond, detail) { this.checks.push({ desc, pass: !!cond, detail: cond ? undefined : detail }); }
  eq(desc, a, b) { this.ok(desc, JSON.stringify(a) === JSON.stringify(b), `实际 ${JSON.stringify(a)}，预期 ${JSON.stringify(b)}`); }
  near(desc, a, b, eps = 0.051) { this.ok(desc, typeof a === "number" && Math.abs(a - b) <= eps, `实际 ${a}，预期 ${b}`); }
  rej(desc, r, code) { this.ok(desc, r && r.ok === false && r.code === code, `实际 ${r && (r.ok ? "成功" : r.code)}，预期拒绝 ${code}`); }
  get passed() { return this.checks.filter(c => c.pass).length; }
}
const fresh = (seed, at = REF) => createApp({ seed, at });
const call = (c, app, id, input, actor, note) => { const r = app.act(id, input, actor); c.step(`${id} ${note || ""}→ ${r.ok ? "成功 " + JSON.stringify(r.result).slice(0, 120) : "拒绝 " + r.code + "：" + r.msg}`); return r; };
// 业务链路：建单→定因→确认→选措；再派单、回填、评估
function toPlan(c, app, cell = X, adj = "机械") {
  const no = call(c, app, "A_01", { cellKey: cell }, BOT).result.ticketNo;
  call(c, app, "A_02", { ticketNo: no, mode: "rule" }, BOT); call(c, app, "A_03", { ticketNo: no, decision: "确认", reason: "复核：告警与命中日仅部分重合，不影响主因" }, ENG);
  const r = call(c, app, "A_04", { ticketNo: no, adjustType: adj }, BOT); return { no, planNo: r.result && r.result.planNo, r };
}
const dispatch = (c, app, planNo, sup = true) => call(c, app, "A_05", { planNo, decision: "批准", approvals: [{ role: "地市优化工程师" }, ...(sup ? [{ role: "优化主管" }] : [])], executor: { role: "现场维护人员", name: FE.executor } }, ENG).result;
// 现场回填：默认取现场回填记录（field_executions.csv）里的实施时间与实际值
const execute = (c, app, planNo, dispatchNo, value = FE.toValue, extra = {}) => call(c, app, "A_06", { planNo, dispatchNo, executeTime: EXEC, receipt: "成功", actualValues: [{ targetKey: AN, param: FE.param, value }], ...extra }, FLD);
function chmMain(c, app, hook) {
  const { no, planNo } = toPlan(c, app); app.at("2026-09-12T09:00:00"); const d = dispatch(c, app, planNo).dispatchNo;
  app.at(FE.receivedAt); execute(c, app, planNo, d);
  app.at("2026-09-22T09:00:00"); const e1 = call(c, app, "A_07", { planNo }, BOT).result; if (hook) hook(app, no);
  app.at("2026-09-29T09:00:00"); const e2 = call(c, app, "A_07", { planNo }, BOT).result;
  return { no, planNo, dispatchNo: d, e1, e2 };
}
// 追加若干天的 MR（用于场景里临时发生的新数据，采样点逐日有波动）
const burst = (cell, dates, ratio, base = 7000) => dates.map((date, i) => { const total = base + ((i * 211 + 97) % 530), r = ratio + (((i * 7) % 5) - 2) * 0.006; return { cellKey: cell, date, sampleTotal: total, sampleWeak: Math.round(total * r) }; });
const inRange = (m, from, to) => m.date >= from && m.date <= to;

const SCENARIOS = [];
const def = (id, title, spec, run) => SCENARIOS.push({ id, title, spec, run });

def("DS01", `${nX}（SHCHM）主线：从前置数据发现到关单、案例入库`, ["TC01", "TC04a", "TC05a"], c => {
  const app = fresh(SEED); const e = EXP.chm;
  const scan = app.svc.scan([X, Y], REF); c.step("S0 F_12 发现：" + scan.items.map(i => `${NAME(i.cellKey)}＝${i.verdict}`).join("、"));
  c.eq(`S0 ${nX} 命中日与预期一致`, scan.items.find(i => i.cellKey === X).hitDates, e.discover.hitDates); c.eq(`S0 清单计数 达到1／未达到1／证据不足0`, scan.counts, { 达到: 1, 未达到: 1, 证据不足: 0 });
  c.eq("S0 此时没有任何工单", app.store.count("OT_TICKET"), 0);
  const { no, planNo, dispatchNo, e1, e2 } = chmMain(c, app, (a, n) => c.rej("第1周评估后（持续有效为空）关单被拒绝（INV_10）", a.act("A_08", { ticketNo: n }, SUP), "INV_10")), t = app.store.doc("OT_TICKET", no), p = app.store.doc("OT_PLAN", planNo);
  c.eq("S1 工单 discovery 依据＝窗口内7条 MR（RT_17）", [t.discovery.evidenceRefs.length, app.store.links({ rt: "RT_17", from: "OT_TICKET:" + no }).length], [7, 7]);
  c.eq("S1 problemKey", t.discovery.problemKey, `${X}@MR弱覆盖小区@2026-09-10`); c.eq("S1 类别／问题类型／派单问题", [t.problemCategory, t.problemType, t.dispatchProblem], ["覆盖结构", "MR弱覆盖小区", "宏站弱覆盖小区"]);
  c.eq("S2 F_07 部分重合（告警 1/7）", t.diagnostics.find(d => d.kind === "假性弱覆盖").result.verdict, "部分重合"); c.near("S2 重合占比", t.diagnostics.find(d => d.kind === "假性弱覆盖").result.share, e.alarm.share, 0.0001);
  const f8 = t.diagnostics.find(d => d.kind === "下倾角命中").result; c.eq("S3 F_08 命中、总下倾、缺口、近端／远端半径", [f8.match, f8.totalTilt, f8.deficit, f8.rNear, f8.rFar], ["命中", e.tilt.total, e.tilt.gap, e.tilt.rNear, e.tilt.rFar]);
  c.eq("S4 Δ与目标值", [p.actions[0].deltaValue, p.actions[0].targetValue], [e.tilt.deltaMech, FE.toValue]); c.eq("S5 周边影响“通过”，逐项检查与独立预期一致", [p.impact.result, p.impact.checks.map(k => [k.cell || k.neighbor, k.before, k.after])], [e.impact.result, e.impact.checks.map(k => [k.cell || k.neighbor, k.before, k.after])]);
  c.eq("S6 审批含优化主管（2个小区）", p.approval.approverRoles, ["地市优化工程师", "优化主管"]); c.eq("S7 执行记录与现场回填记录一致", [p.execution.receipt, p.execution.actualValues[0].value, p.execution.executeTime, p.status], ["成功", FE.toValue, EXEC, "已实施"]);
  c.near("S8 前窗占比", e1.beforeRatio, e.beforeRatio, 0.0001); c.near("S8 后窗占比", e1.afterRatio, e.afterRatio1, 0.0001); c.eq("S8 第1周：改善、sustained 为空、保护通过", [e1.status, e1.improved, e1.achieved, e1.sustained, e1.protectionOk], ["改善", true, true, null, true]);
  c.eq(`S8 保护指标 ${nY}／${nZ1}／${nZ2}`, e1.protection.map(x => [x.before, x.after]), [[e.protection.Y.before, e.protection.Y.after], [e.protection.Z1.before, e.protection.Z1.after], [e.protection.Z2.before, e.protection.Z2.after]]);
  c.eq("S8 第2周：持续有效", [e2.status, e2.sustained, e2.daysAfter], ["持续有效", true, 14]);
  app.at("2026-09-29T10:00:00"); c.rej("优化本体无权关闭（角色校验）", call(c, app, "A_08", { ticketNo: no }, BOT), "PERMISSION_DENIED");
  c.eq("优化主管关闭成功", call(c, app, "A_08", { ticketNo: no }, SUP).result.status, "已关闭");
  const cs = call(c, app, "A_09", { effectNo: e2.effectNo, applicability: APPLIC }, KNW).result; c.eq("案例入库：有效可复现、未验证", [cs.outcome, cs.validation], ["有效可复现", "未验证"]);
  const t2 = app.store.doc("OT_TICKET", no); c.eq("TC04a 诊断记录3条（F_06、F_07、F_08）且带函数版本与输入引用", t2.diagnostics.map(d => [d.funcId, d.funcVersion, d.inputRefs.length > 0]), [["F_06", "0.3", true], ["F_07", "0.2", true], ["F_08", "0.2", true]]);
  c.eq("TC04a 根因第1轮证据回链 MR 窗口与工参", t2.rootCauses[0].evidenceRefs.map(r => r.kind), ["小区MR", "工参"]); c.eq("TC04a 重开后工单、方案、效果读回一致", [t2.status, app.store.doc("OT_PLAN", planNo).impact.result, app.store.doc("OT_EFFECT", e2.effectNo).status], ["已关闭", "通过", "持续有效"]);
  const h = app.store.history("OT_ANTENNA", AN); c.eq("TC05a 天线新工参版本生效时间＝实施时间", h[h.length - 1].eff, EXEC); c.eq("TC05a as-of 读回：回填前 3°，回填后 4°", [app.facts.antennaState(AN, "2026-09-13T00:00:00").antenna.mechTilt, app.facts.antennaState(AN, FE.receivedAt).antenna.mechTilt], [FE.fromValue, FE.toValue]);
  const f8b = app.svc.matchTilt(X, "2026-09-30T00:00:00"); c.eq("TC05a 实施后重算 F_08：总下倾7°、缺口0.35°≤容差→不命中", [f8b.match, f8b.totalTilt, f8b.deficit], ["不命中", e.afterAt4.total, e.afterAt4.gap]);
  c.eq("第1轮根因保持不变（历史不覆盖）", t2.rootCauses.length, 1);
  c.step(`前窗 ${e1.beforeRatio} → 后窗 ${e1.afterRatio}；两周后 sustained=${e2.sustained}`);
});

def("DS02", "前置数据是锚点：发现先于工单，数据更正不改写已建工单", ["TC01a", "TC08"], c => {
  const app = fresh(SEED), scan = app.svc.scan(SEP_SCOPE, REF), by = Object.fromEntries(scan.items.map(i => [i.cellKey, i]));
  for (const [k, v] of Object.entries(EXP.scanSep)) c.eq(`F_12 ${NAME(k)}：${v.verdict}（命中${v.hitDays}天）`, [by[k].verdict, by[k].hitDays], [v.verdict, v.hitDays]);
  c.eq("F_12 清单计数与独立预期一致", scan.counts, EXP.scanSepCounts); c.eq("发现只读：没有任何工单", app.store.count("OT_TICKET"), 0);
  c.ok(`窗口内无 MR 的小区（${NAME(Z2)}）列为证据不足（数据缺口），不静默跳过`, by[Z2].verdict === "证据不足" && /数据缺口/.test(by[Z2].note));
  c.ok(`VIP 小区（${NAME(C8)}）为规则缺口`, by[C8].verdict === "证据不足" && /规则缺口/.test(by[C8].note));
  const t1 = call(c, app, "A_01", { cellKey: X }, BOT).result, d6 = `${X}@2026-09-06`; c.eq("A_01 建单后 discovery 引用的 09-06 版本为 1", t1.discovery.evidenceRefs.find(r => r.mrKey === d6).version, 1);
  const orig = app.store.doc("OT_CELL_MR", d6); loadMR(app.store, [{ cellKey: X, date: "2026-09-06", sampleTotal: orig.sampleTotal, sampleWeak: 1900, receivedAt: "2026-09-12T06:11:42" }]);
  c.eq("数据更正：OT_CELL_MR 新增版本2，版本1保留", app.store.history("OT_CELL_MR", d6).map(h => h.ver), [1, 2]);
  const again = app.svc.scan([X], REF).items[0]; c.eq(`更正后再次发现：${nX} 命中 6 天（09-06 弱覆盖采样点 1900＜2000）`, [again.verdict, again.hitDays], ["达到派单条件", 6]);
  const t = app.store.doc("OT_TICKET", t1.ticketNo); c.eq("已建工单的 discovery 快照不变：仍命中7天、引用版本1", [t.discovery.hitDays, t.discovery.evidenceRefs.find(r => r.mrKey === d6).version], [7, 1]);
  c.eq("同小区同问题类型已有未关闭工单：不重复建单（INV_14），返回已有工单", [app.act("A_01", { cellKey: X }, BOT).result.deduped, app.store.count("OT_TICKET")], [true, 1]);
  c.rej(`${nY} 未达到派单条件：不建单（INV_16）`, call(c, app, "A_01", { cellKey: Y }, BOT), "INV_16"); c.rej(`${nZ2} 窗口无 MR：证据不足（INV_09）`, call(c, app, "A_01", { cellKey: Z2 }, BOT), "INV_09");
  c.rej(`${NAME(C4)} 缺天：证据不足（INV_09）`, call(c, app, "A_01", { cellKey: C4 }, BOT), "INV_09"); c.rej(`${NAME(C8)} VIP 规则缺口（INV_09）`, call(c, app, "A_01", { cellKey: C8 }, BOT), "INV_09");
  c.rej(`${NAME(C3)} 只命中 2 天（INV_16）`, call(c, app, "A_01", { cellKey: C3 }, BOT), "INV_16");
  for (const k of [C2, C10, C11, C12]) c.ok(`${NAME(k)} 达到→建单（${by[k].ruleId}）`, call(c, app, "A_01", { cellKey: k }, BOT).ok);
  c.rej("OT_CELL_MR 不允许就地改写（INV_17）", (() => { try { app.store.overwrite("OT_CELL_MR", d6); } catch (e) { return { ok: false, code: e.code }; } })(), "INV_17");
  const a2 = fresh(SEED, OCT); const oct = a2.svc.scan([SIM, BAO, N1], OCT);
  for (const [k, v] of Object.entries(EXP.scanOct)) c.eq(`十月窗口 ${NAME(k)}：${v.verdict}`, oct.items.find(i => i.cellKey === k).verdict, v.verdict);
  const tkB = SEED.sourceTickets.find(t => t.short === "SHBAO"); c.near("SHBAO 原文覆盖率 88.18% → 弱覆盖占比 0.1182，低于 20% 门限，规则不发现（与上海原口径不同）", EXP.bao.weakRatio, 1 - tkB.kpiValue, 0.0001);
});

def("DS03", "周边影响与调整方式：机械／电子、同天线小区、关系变更", ["TC02a", "TC02b", "TC02c", "TC02f"], c => {
  const yTight = variant(s => { s.cells.find(x => x.cellKey === Y).targetRadius = 560; });
  const a = fresh(yTight); const r = toPlan(c, a), p = a.store.doc("OT_PLAN", r.planNo);
  c.eq(`${nY} 目标半径 560：机械下倾周边影响不通过（${nY} 远端 543.4＜560）`, [p.impact.result, p.status], [EXP.chmVariants.yTightMech.result, "草案"]); c.eq("方案停在草案并转人工", r.r.result.toHuman, true);
  c.rej("不通过的方案不得批准（INV_06）", call(c, a, "A_05", { planNo: r.planNo, decision: "批准", approvals: [{ role: "地市优化工程师" }, { role: "优化主管" }] }, ENG), "INV_06");
  c.eq(`天线 ${AN} 机械下倾仍为 ${FE.fromValue}°（现网值保留）`, a.facts.antennaState(AN, REF).antenna.mechTilt, FE.fromValue);
  c.rej("上一轮方案未结束，不能再生成新一轮", call(c, a, "A_04", { ticketNo: r.no, adjustType: "机械" }, BOT), "ROUND_IN_PROGRESS");
  const b = fresh(yTight); const re = toPlan(c, b, X, "电子"), pe = b.store.doc("OT_PLAN", re.planNo), ex = EXP.chmVariants.yTightElec;
  c.eq("改电子下倾：范围只含目标阵列小区，Δ＝1.3°，通过", [pe.impact.result, pe.actions[0].deltaValue, pe.actions[0].param, pe.impact.checks.filter(k => k.cell).map(k => k.cell)], [ex.result, ex.deltaFinal, "elecTilt", [X]]);
  c.eq("电子下倾远端 725.1→505.4", [pe.impact.checks[0].before, pe.impact.checks[0].after], [ex.checks[0].before, ex.checks[0].after]);
  c.eq("RT_10：电子下倾只作用于目标小区阵列（主作用），不含天线与同天线小区", b.store.links({ rt: "RT_10", from: "OT_PLAN:" + re.planNo }).map(l => l.to), ["OT_CELL:" + X]);
  const rl = variant(s => { s.cells.find(x => x.cellKey === Y).targetRadius = 560; s.cellAntenna.find(x => x.cellKey === Y).antennaId = AZ2; });
  const d = fresh(rl), rr = toPlan(c, d), pr = d.store.doc("OT_PLAN", rr.planNo);
  c.eq(`${nY} 改挂另一副天线：机械下倾范围变为 {${nX}}，通过；此后新建工单中它不再是同天线小区`, [pr.impact.result, d.store.links({ rt: "RT_06", from: "OT_TICKET:" + rr.no }).filter(l => l.props.role === "同天线小区").length], ["通过", 0]);
  const rv = EXP.chmVariants.reduce, mkRed = rt => variant(s => { s.cellAntenna.find(x => x.cellKey === X).elecTilt = 2; s.cells.find(x => x.cellKey === Y).targetRadius = rt; });
  const s2 = fresh(mkRed(450)), rs = toPlan(c, s2), ps = s2.store.doc("OT_PLAN", rs.planNo);
  c.eq(`TC02a ${nX} 缺口 2.35°→Δ 计划 2°；${nY} 目标半径 450：Δ 调减到 1°`, [ps.impact.result, ps.impact.deltaPlan, ps.impact.deltaFinal, ps.actions[0].deltaValue, ps.actions[0].targetValue], [rv.y450.result, 2, rv.y450.deltaFinal, 1, FE.toValue]);
  const s3 = fresh(mkRed(600)), r3 = toPlan(c, s3); c.eq(`TC02b ${nY} 目标半径 600：Δ＝2°与 1° 均不满足 → 不通过，方案草案`, [s3.store.doc("OT_PLAN", r3.planNo).impact.result, s3.store.doc("OT_PLAN", r3.planNo).status], [rv.y600.result, "草案"]);
});

def("DS04", "异常与缺失：工参缺失、缺天、假性弱覆盖、次因、邻区工参缺失、规则缺口", ["TC03a", "TC03b", "TC03c", "TC03d", "TC03f", "TC03g", "TC03h", "TC06c"], c => {
  // 03a 缺挂高
  let a = fresh(variant(s => { delete s.antennas.find(x => x.antennaId === AN).height; })); let no = call(c, a, "A_01", { cellKey: X }, BOT).result.ticketNo; const r2 = call(c, a, "A_02", { ticketNo: no, mode: "rule" }, BOT).result;
  c.eq("TC03a 缺挂高：F_08＝未知，不判不命中，未写根因", [r2.f08, r2.written], ["未知", false]); c.eq("TC03a 缺项为 antenna.height", a.store.doc("OT_TICKET", no).diagnostics.find(d => d.kind === "下倾角命中").result.missing, ["antenna.height"]);
  c.rej("TC03a 无主因证据不得确认（INV_03）", call(c, a, "A_03", { ticketNo: no, decision: "确认", reason: "x" }, ENG), "INV_03"); c.rej("TC03a 待核验不得生成方案（INV_04）", call(c, a, "A_04", { ticketNo: no, adjustType: "机械" }, BOT), "INV_04");
  // 03b MR 缺天
  a = fresh(variant(s => { s.cellMR = s.cellMR.filter(m => !(m.cellKey === X && m.date === "2026-09-06")); })); let r = call(c, a, "A_01", { cellKey: X }, BOT);
  c.eq("TC03b① 缺 1 天仍命中 6 天：达到，快照 unknownDates＝[09-06]", [r.ok, r.result.discovery.hitDays, r.result.discovery.unknownDates], [true, 6, ["2026-09-06"]]);
  a = fresh(variant(s => { s.cellMR = s.cellMR.filter(m => !(m.cellKey === X && ["2026-09-04", "2026-09-05", "2026-09-07", "2026-09-08", "2026-09-09"].includes(m.date))); })); c.rej("TC03b② 命中2天＋缺5天：证据不足，不建单（INV_09）", call(c, a, "A_01", { cellKey: X }, BOT), "INV_09");
  a = fresh(variant(s => { s.cellMR = s.cellMR.filter(m => !(m.cellKey === X && ["2026-09-04", "2026-09-05"].includes(m.date))); s.cellMR.filter(m => m.cellKey === X).forEach(m => { m.sampleWeak = Math.round(m.sampleTotal * 0.07); }); })); c.rej("TC03b③ 命中0天＋缺2天＜3：未达到，不建单", call(c, a, "A_01", { cellKey: X }, BOT), "INV_16");
  // 03c 告警覆盖多数命中日 → 排除
  a = fresh(variant(s => { s.alarms.push({ cell: X, type: "小区退服", startDate: "2026-09-04", endDate: "2026-09-09" }); })); no = call(c, a, "A_01", { cellKey: X }, BOT).result.ticketNo; const f7 = call(c, a, "A_02", { ticketNo: no, mode: "rule" }, BOT).result;
  c.eq("TC03c F_07＝排除，不写根因", [f7.f07, f7.written], ["排除", false]); c.eq("TC03c 排除后工单“已排除”", call(c, a, "A_03", { ticketNo: no, decision: "排除" }, ENG).result.status, "已排除"); c.rej("TC03c 已排除不得生成方案（INV_04）", call(c, a, "A_04", { ticketNo: no, adjustType: "机械" }, BOT), "INV_04");
  // 03d 邻区告警部分重合 → 须人工复核
  a = fresh(variant(s => { s.alarms = s.alarms.filter(x => x.cell !== X); s.alarms.push({ cell: Z1, type: "RRU故障", startDate: "2026-09-05", endDate: "2026-09-06" }); })); no = call(c, a, "A_01", { cellKey: X }, BOT).result.ticketNo; call(c, a, "A_02", { ticketNo: no, mode: "rule" }, BOT);
  c.near("TC03d 重合 2/7＝0.2857", a.store.doc("OT_TICKET", no).diagnostics.find(d => d.kind === "假性弱覆盖").result.share, 0.2857, 0.0001); c.rej("TC03d 部分重合：未写复核判断不得确认", call(c, a, "A_03", { ticketNo: no, decision: "确认" }, ENG), "REVIEW_REQUIRED"); c.ok("TC03d 写明复核判断后可确认", call(c, a, "A_03", { ticketNo: no, decision: "确认", reason: "邻区故障与主因无关" }, ENG).ok);
  // 03f 次因同时命中（现网发射功率低于规划值）
  a = fresh(variant(s => { s.alarms = []; s.cells.find(x => x.cellKey === X).rsPower = 10.8; })); no = call(c, a, "A_01", { cellKey: X }, BOT).result.ticketNo; const r3 = call(c, a, "A_02", { ticketNo: no, mode: "rule" }, BOT).result;
  c.eq("TC03f 主因＋次因“发射功率”并列", [r3.f08, r3.otherCauses, a.store.doc("OT_TICKET", no).rootCauses.map(x => x.role)], ["命中", ["发射功率"], ["主因", "次因"]]); c.rej("TC03f 次因命中：不得自动确认", call(c, a, "A_03", { ticketNo: no, decision: "确认" }, ENG), "REVIEW_REQUIRED");
  const p3 = call(c, a, "A_03", { ticketNo: no, decision: "确认", reason: "功率偏低另行处理，本方案只针对下倾" }, ENG).ok && call(c, a, "A_04", { ticketNo: no, adjustType: "机械" }, BOT).result; c.eq("TC03f 方案只针对主因，数值同主线", [p3.gap, p3.delta, p3.impact], [EXP.chm.tilt.gap, 1, "通过"]);
  // 03g 邻区工参缺失 → 未评估
  a = fresh(variant(s => { delete s.antennas.find(x => x.antennaId === AZ1).height; })); const rg = toPlan(c, a), pg = a.store.doc("OT_PLAN", rg.planNo);
  c.eq(`TC03g ${nZ1} 挂高缺失：重叠指数“未评估”，整体“未评估”，方案草案`, [pg.impact.result, pg.status, pg.impact.checks.find(k => k.neighbor === Z1).result], ["未评估", "草案", "未评估"]);
  c.eq("TC03g 其余检查仍显示（目标小区与同天线小区远端通过、另一邻区照常）", pg.impact.checks.filter(k => k.pass === true).length, 3); c.rej("TC03g 未评估的方案不得批准（INV_06）", call(c, a, "A_05", { planNo: rg.planNo, decision: "批准", approvals: [{ role: "地市优化工程师" }, { role: "优化主管" }] }, ENG), "INV_06");
  // 03h 场景等级无对应规则
  a = fresh(variant(s => { s.cells.find(x => x.cellKey === X).sceneLevel = "VIP"; })); r = call(c, a, "A_01", { cellKey: X }, BOT); c.rej("TC03h VIP：规则缺口，证据不足，不建单（INV_09）", r, "INV_09");
  const dv = a.svc.discover(X, REF); c.eq("TC03h 7 天全部记未知、不引用任何规则", [dv.hitDays, dv.unknownDates.length, dv.ruleId], [0, 7, undefined]); c.eq(`TC03h 同站一般场景小区 ${nY} 照常判定（未达到）`, a.svc.discover(Y, REF).verdict, "未达到派单条件");
  a = fresh(variant(s => { delete s.cells.find(x => x.cellKey === X).sceneLevel; })); c.rej("TC03h 场景等级缺失：同样规则缺口，不默认一般场景", call(c, a, "A_01", { cellKey: X }, BOT), "INV_09");
  // 06c 5G：可发现、可建单，原因判断未知转人工
  a = fresh(SEED, OCT); no = call(c, a, "A_01", { cellKey: N1 }, BOT).result.ticketNo; const r5 = call(c, a, "A_02", { ticketNo: no, mode: "rule" }, BOT).result;
  c.eq("TC06c 5G 宏站按 RULE_D03 发现并建单，派单问题“宏站弱覆盖小区”", a.store.doc("OT_TICKET", no).discovery.ruleId, "RULE_D03"); c.eq("TC06c F_08＝未知（NR 公式未定义），不写根因，不套用 LTE 公式", [r5.f08, r5.written], ["未知", false]);
  c.rej("TC06c 不生成方案（INV_04）", call(c, a, "A_04", { ticketNo: no, adjustType: "机械" }, BOT), "INV_04");
  // 4G 室分：D02 命中，F_08 未知
  a = fresh(SEED); no = call(c, a, "A_01", { cellKey: C10 }, BOT).result.ticketNo; c.eq("4G 室分按 RULE_D02 建单，派单问题“室分弱覆盖小区”，F_08＝未知（不适用宏站下倾模型）", [a.store.doc("OT_TICKET", no).dispatchProblem, call(c, a, "A_02", { ticketNo: no, mode: "rule" }, BOT).result.f08], ["室分弱覆盖小区", "未知"]);
});

def("DS05", "记录引用与读回：错误引用被拒绝，改名不改写历史", ["TC04b", "TC04c"], c => {
  const app = fresh(SEED), { no, planNo } = toPlan(c, app); const n0 = ["OT_TICKET", "OT_PLAN", "OT_EFFECT", "OT_CASE"].map(t => app.store.count(t));
  c.rej("TC04b① A_05 引用不存在的方案", call(c, app, "A_05", { planNo: "PL-不存在", decision: "批准", approvals: [] }, ENG), "NOT_FOUND"); c.rej("TC04b② A_07 引用尚未实施的方案（INV_08）", call(c, app, "A_07", { planNo }, BOT), "INV_08");
  c.rej("TC04b③ A_02 的证据引用不存在的小区（INV_03）", call(c, app, "A_02", { ticketNo: no, mode: "manual", role: "主因", causeFamily: "天馈", causeLabel: "天线下倾角过小", evidenceRefs: [{ kind: "小区MR", cellKey: "LTE:99999999", from: "2026-09-04", to: "2026-09-10" }] }, ENG), "INV_03");
  c.rej("TC04b③b 引用该小区没有 MR 的日期窗口（INV_03）", call(c, app, "A_02", { ticketNo: no, mode: "manual", role: "主因", causeFamily: "天馈", causeLabel: "天线下倾角过小", evidenceRefs: [{ kind: "小区MR", cellKey: X, from: "2026-08-01", to: "2026-08-07" }] }, ENG), "INV_03"); c.rej("TC04b④ A_09 引用不存在的效果", call(c, app, "A_09", { effectNo: "EF-不存在", applicability: APPLIC }, KNW), "NOT_FOUND");
  c.eq("TC04b 拒绝不产生新记录（工单、方案、效果、案例数量不变）", ["OT_TICKET", "OT_PLAN", "OT_EFFECT", "OT_CASE"].map(t => app.store.count(t)), n0);
  const before = app.store.history("OT_TICKET", no).length; c.ok("TC04b 拒绝也留审计", app.store.runs().filter(r => r.outcome === "rejected").length >= 4);
  const cell = app.store.doc("OT_CELL", X); app.store.putObject("OT_CELL", X, { ...cell, cellName: nX + "（改名）" });
  c.eq("TC04c 改名：cellKey 不变，历史版本仍是旧名称", [app.store.history("OT_CELL", X)[0].doc.cellName, app.store.doc("OT_CELL", X).cellName], [nX, nX + "（改名）"]);
  c.eq("TC04c 工单仍指向同一 cellKey，内容不被改写", [app.facts.cellOfTicket(no), app.store.history("OT_TICKET", no).length], [X, before]);
  c.rej("对象版本不允许就地改写（INV_11）", (() => { try { app.store.overwrite("OT_PLAN", planNo); } catch (e) { return { ok: false, code: e.code }; } })(), "INV_11");
});

def("DS06", "执行异常与动态更新：实际≠计划、回执未知、来源冲突、方案过期、自动执行", ["TC02e", "TC05b", "TC07b", "TC07c"], c => {
  let a = fresh(SEED); let { no, planNo } = toPlan(c, a); a.at("2026-09-12T09:00:00");
  c.rej("TC07b① 自动执行天馈类措施被拒绝（INV_05）", call(c, a, "A_05", { planNo, decision: "批准", auto: true, approvals: [{ role: "地市优化工程师" }, { role: "优化主管" }] }, ENG), "INV_05"); c.rej("TC07b 优化本体无权确认派单（角色校验）", call(c, a, "A_05", { planNo, decision: "批准", approvals: [] }, BOT), "PERMISSION_DENIED");
  c.rej("多小区变更未附优化主管批准：保持待确认（RULE_W14）", call(c, a, "A_05", { planNo, decision: "批准", approvals: [{ role: "地市优化工程师" }] }, ENG), "SUPERVISOR_REQUIRED");
  a.store.putObject("OT_ANTENNA", AN, { ...a.store.doc("OT_ANTENNA", AN), mechTilt: 4, effectiveTime: "2026-09-12T08:00:00" }, { eff: "2026-09-12T08:00:00", source: "资源系统" });
  const st = call(c, a, "A_05", { planNo, decision: "批准", approvals: [{ role: "地市优化工程师" }, { role: "优化主管" }] }, ENG); c.rej("TC07b③ 方案所依据的工参版本已变：退回草案重算", st, "STALE_FACTS"); c.eq("方案退回草案", a.store.doc("OT_PLAN", planNo).status, "草案");
  // 回执未知
  a = fresh(SEED); ({ no, planNo } = toPlan(c, a)); a.at("2026-09-12T09:00:00"); let d = dispatch(c, a, planNo).dispatchNo; c.eq("TC07c 重复提交 A_05：返回同一派单号，不重复派单", dispatch(c, a, planNo).dispatchNo, d);
  c.eq("TC05b① 已派单未回填：F_08＝未知（计划值不得代替实际值）", a.svc.matchTilt(X, "2026-09-13T00:00:00").match, "未知");
  a.at(FE.receivedAt); const u = call(c, a, "A_06", { planNo, dispatchNo: d }, FLD).result; c.eq("TC07c 回执缺失：receipt＝未知，工单留处置中", [u.receipt, a.store.doc("OT_TICKET", no).status, a.store.doc("OT_PLAN", planNo).status], ["未知", "处置中", "未知"]);
  a.at("2026-09-22T09:00:00"); c.rej("TC07c 回执未知：A_07 不得评估（INV_08）", call(c, a, "A_07", { planNo }, BOT), "INV_08"); c.rej("缺现场实际值不得记为已实施（INV_07）", call(c, a, "A_06", { planNo, dispatchNo: d, executeTime: EXEC, receipt: "成功", actualValues: [] }, FLD), "INV_07");
  // 实际≠计划 +3°：事后复核不通过
  a = fresh(SEED); ({ no, planNo } = toPlan(c, a)); a.at("2026-09-12T09:00:00"); d = dispatch(c, a, planNo).dispatchNo; a.at(FE.receivedAt);
  const e3 = execute(c, a, planNo, d, FE.fromValue + 3).result, rc = a.store.doc("OT_PLAN", planNo);
  c.eq(`TC02e 实际 +3°：以实际值事后复核＝不通过，${nY}、${nX} 远端不满足（独立预期）`, [e3.recheck, e3.failed.map(f => f.cell).sort()], [EXP.chmVariants.actualPlus3.result, EXP.chmVariants.actualPlus3.failed.sort()]); c.eq("TC02e 计划值 deltaValue＝1° 的记录保留，不被实际值改写", [rc.actions[0].deltaValue, rc.execution.actualValues[0].value], [1, FE.fromValue + 3]);
  // 来源冲突
  a = fresh(SEED); ({ no, planNo } = toPlan(c, a)); a.at("2026-09-12T09:00:00"); d = dispatch(c, a, planNo).dispatchNo; a.at(FE.receivedAt);
  const cf = execute(c, a, planNo, d, FE.toValue, { resourceValue: FE.fromValue }).result; c.eq("TC05b② 现场回填 4° 与资源系统同期 3° 不一致：状态冲突，转人工", [cf.conflict, a.facts.antennaState(AN, "2026-09-15T00:00:00").status], [true, "conflict"]);
  c.eq("冲突时两来源取值与来源标识均保留", a.facts.antennaState(AN, "2026-09-15T00:00:00").sources.map(s => [s.source, s.mechTilt]).sort(), [["回填", FE.toValue], ["资源系统", FE.fromValue]]); c.eq("F_08 对该天线返回“冲突”，不自动取其中一个值", a.svc.matchTilt(X, "2026-09-15T00:00:00").match, "冲突");
  a.at("2026-09-22T09:00:00"); c.rej("裁定前不评估效果（INV_15）", call(c, a, "A_07", { planNo }, BOT), "INV_15");
  c.rej("优化本体无权裁定（角色校验）", call(c, a, "A_11", { antennaId: AN, chosenSource: "回填", reason: "现场测试" }, BOT), "PERMISSION_DENIED"); c.rej("裁定须写明理由（INV_15）", call(c, a, "A_11", { antennaId: AN, chosenSource: "回填" }, ENG), "INV_15");
  const rl = call(c, a, "A_11", { antennaId: AN, chosenSource: "回填", reason: "现场实测确认为 4°" }, ENG).result; c.eq("裁定后以 ruling 版本为准，因冲突停在处置中的工单转待评估", [rl.mechTilt, a.store.doc("OT_TICKET", no).status], [FE.toValue, "待评估"]);
  c.eq("裁定后可评估效果", call(c, a, "A_07", { planNo }, BOT).result.status, "改善"); c.rej("无未裁定冲突时再裁定被拒绝（INV_15）", call(c, a, "A_11", { antennaId: AN, chosenSource: "回填", reason: "重复" }, ENG), "INV_15");
});

def("DS07", "效果分支与案例：劣化、未达标进入下一轮、复发、不得关单", ["TC02d", "TC03e", "TC07e", "TC07f"], c => {
  // 劣化：同天线小区的 MR 弱覆盖占比 0.08→0.15
  let s = variant(v => { v.cellMR.filter(m => m.cellKey === Y && inRange(m, "2026-09-15", "2026-09-21")).forEach(m => { m.sampleWeak = Math.round(m.sampleTotal * 0.15); }); }), a = fresh(s); let { no, planNo } = toPlan(c, a); a.at("2026-09-12T09:00:00"); let d = dispatch(c, a, planNo).dispatchNo; a.at(FE.receivedAt); execute(c, a, planNo, d);
  a.at("2026-09-22T09:00:00"); let e = call(c, a, "A_07", { planNo }, BOT).result;
  c.eq("TC02d 目标改善但保护失败：状态劣化，protectionOk＝否，目标指标仍改善", [e.status, e.protectionOk, e.improved, e.achieved], ["劣化", false, true, true]); c.eq("TC02d 工单不判已改善，转改善未解决", a.store.doc("OT_TICKET", no).status, "改善未解决");
  const cs = call(c, a, "A_09", { effectNo: e.effectNo, applicability: APPLIC }, EXPERT).result; c.eq("TC02d 劣化案例照常入库：outcome＝无效", cs.outcome, "无效"); c.rej("缺适用条件拒绝入库", call(c, a, "A_09", { effectNo: e.effectNo, applicability: { rat: "LTE" } }, KNW), "APPLICABILITY_REQUIRED");
  // 03e 后窗不足 7 天：实施后第 4 天评估，只有 3 天 MR 已到达
  a = fresh(SEED); ({ no, planNo } = toPlan(c, a)); a.at("2026-09-12T09:00:00"); d = dispatch(c, a, planNo).dispatchNo; a.at(FE.receivedAt); execute(c, a, planNo, d);
  a.at("2026-09-18T09:00:00"); e = call(c, a, "A_07", { planNo }, BOT).result;
  c.eq("TC03e 后窗只有3天：效果待评估，各判定为空", [e.status, e.daysAfter, e.improved, e.achieved, e.sustained, e.protectionOk], ["待评估", 3, null, null, null, null]); c.rej("TC03e 工单保持待评估，A_08 拒绝（INV_10）", call(c, a, "A_08", { ticketNo: no }, SUP), "INV_10");
  // 保护指标缺数据 → 待评估
  s = variant(v => { v.cellMetrics = v.cellMetrics.filter(m => !(m.cellKey === Z2 && inRange(m, "2026-09-15", "2026-09-21"))); }); a = fresh(s); ({ no, planNo } = toPlan(c, a)); a.at("2026-09-12T09:00:00"); d = dispatch(c, a, planNo).dispatchNo; a.at(FE.receivedAt); execute(c, a, planNo, d);
  a.at("2026-09-22T09:00:00"); e = call(c, a, "A_07", { planNo }, BOT).result; c.eq(`保护指标缺数据（${nZ2} 后窗无实测重叠覆盖度）：待评估，protectionOk 为空`, [e.status, e.protectionOk], ["待评估", null]);
  // 未达标：占比降够但后窗仍 3 天命中；用目标半径 300 m 的庙镇小区（缺口大，需多轮）走下一轮
  s = variant(v => { v.cells.find(x => x.cellKey === SIM).targetRadius = 300; }); a = fresh(s, OCT); ({ no, planNo } = toPlan(c, a, SIM));
  a.at("2026-10-24T09:00:00"); d = dispatch(c, a, planNo, false).dispatchNo; a.at("2026-10-26T10:00:00"); call(c, a, "A_06", { planNo, dispatchNo: d, executeTime: "2026-10-26T09:30:00", receipt: "成功", actualValues: [{ targetKey: ASIM, param: "mechTilt", value: 4 }] }, FLD);
  const after = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]; loadMR(a.store, pairsRows(SIM, after, [[2143, 7216], [2087, 7088], [2121, 7302], [713, 7154], [689, 6932], [731, 7240], [702, 7011]]).map(r => ({ ...r, receivedAt: addDays(r.date, 1) + "T06:20:11" })));
  a.at("2026-11-03T09:00:00"); e = call(c, a, "A_07", { planNo }, BOT).result;
  c.eq("TC07e③ 占比降够但后窗仍有3天命中：未达标，工单改善未解决", [e.status, e.improved, e.achieved, e.afterHitDays, a.store.doc("OT_TICKET", no).status], ["未达标", true, false, 3, "改善未解决"]);
  const r2 = call(c, a, "A_04", { ticketNo: no, adjustType: "机械" }, BOT); c.ok("TC07e③ 进入下一轮：生成 R2 方案，R1 保留", r2.ok && r2.result.planNo.endsWith("-R2") && !!a.store.doc("OT_PLAN", planNo)); c.rej("R2 未结束不能再生成新一轮", call(c, a, "A_04", { ticketNo: no, adjustType: "机械" }, BOT), "ROUND_IN_PROGRESS");
  // TC07f 第二周复发：sustained＝否，不得关闭
  s = variant(v => { v.cellMR.filter(m => m.cellKey === X && ["2026-09-23", "2026-09-25", "2026-09-27"].includes(m.date)).forEach(m => { m.sampleWeak = Math.round(m.sampleTotal * 0.31); }); }); a = fresh(s); ({ no, planNo } = toPlan(c, a)); a.at("2026-09-12T09:00:00"); d = dispatch(c, a, planNo).dispatchNo; a.at(FE.receivedAt); execute(c, a, planNo, d);
  a.at("2026-09-22T09:00:00"); call(c, a, "A_07", { planNo }, BOT); a.at("2026-09-29T09:00:00"); e = call(c, a, "A_07", { planNo }, BOT).result;
  c.eq("TC07f② 第二周再次达到：achieved＝是、sustained＝否，状态改善", [e.achieved, e.sustained, e.status], [true, false, "改善"]); c.rej("TC07f② 不得关闭（INV_10）", call(c, a, "A_08", { ticketNo: no }, SUP), "INV_10");
});

def("DS08", "同类新实例与案例引用：引用崇明案例；下倾已合理不命中；退服小区排除；复发建单", ["TC06a", "TC06b", "TC06d", "TC07a"], c => {
  const app = fresh(SEED), m = chmMain(c, app); app.at("2026-09-29T10:00:00"); call(c, app, "A_08", { ticketNo: m.no }, SUP); call(c, app, "A_09", { effectNo: m.e2.effectNo, applicability: APPLIC }, KNW);
  // 复发：关单后该小区再次达到派单条件 → 新建并关联原单
  loadMR(app.store, burst(X, ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"], 0.35)); app.at("2026-10-06T09:00:00");
  const t2 = call(c, app, "A_01", { cellKey: X }, BOT).result; c.eq("TC07a① 复发：新建 -002 并关联原单，原单保持已关闭", [t2.ticketNo.endsWith("-002"), t2.relatedTicketNo, app.store.doc("OT_TICKET", m.no).status, app.store.links({ rt: "RT_07", from: "OT_TICKET:" + t2.ticketNo }).length], [true, m.no, "已关闭", 1]);
  // 同类新实例：引用案例（RT_15）
  app.at(OCT); const sno = call(c, app, "A_01", { cellKey: SIM }, BOT).result.ticketNo; call(c, app, "A_02", { ticketNo: sno, mode: "rule" }, BOT); call(c, app, "A_03", { ticketNo: sno, decision: "确认" }, ENG);
  const pr = call(c, app, "A_04", { ticketNo: sno, adjustType: "机械" }, BOT).result, ps = app.store.doc("OT_PLAN", pr.planNo), et = EXP.sim;
  c.eq(`TC06a ${nS}：缺口、Δ＝2°、共2轮、周边影响通过`, [pr.gap, pr.delta, pr.rounds, pr.impact], [et.tilt.gap, 2, et.tilt.rounds, "通过"]); c.eq("TC06a 同类新实例引用已入库案例（RT_15），只作参考", [pr.caseRefs.map(x => x.caseNo), app.store.links({ rt: "RT_15", to: "OT_PLAN:" + pr.planNo }).length], [[`CS-${m.no}-R1`], 1]);
  c.eq("TC06a 方案幅度由函数算出，不照搬案例（案例是 +1°，本方案 +2°）", [ps.actions[0].deltaValue, pr.caseRefs[0].outcome], [2, "有效可复现"]);
  // 06b 下倾已合理 → 不命中
  const a2 = fresh(variant(v => { v.cellAntenna.find(x => x.cellKey === SIM).elecTilt = 5.5; }), OCT), n2 = call(c, a2, "A_01", { cellKey: SIM }, BOT).result.ticketNo, w = call(c, a2, "A_02", { ticketNo: n2, mode: "rule" }, BOT).result;
  c.eq("TC06b 总下倾已合理：F_08 不命中，转其他原因族，不硬套下倾方案", [w.f08, w.written], ["不命中", false]); c.rej("TC06b 不生成方案（INV_04）", call(c, a2, "A_04", { ticketNo: n2, adjustType: "机械" }, BOT), "INV_04");
  // 06d：命中 7 天但退服告警覆盖全部命中日 → 排除；门限边界
  const a3 = fresh(SEED), n5 = call(c, a3, "A_01", { cellKey: C5 }, BOT).result.ticketNo, f = call(c, a3, "A_02", { ticketNo: n5, mode: "rule" }, BOT).result;
  c.eq(`TC06d ${NAME(C5)} 命中7天、退服覆盖全部命中日：排除`, [f.f07, a3.store.doc("OT_TICKET", n5).discovery.hitDays], ["排除", 7]); c.eq("TC06d 排除后工单已排除", call(c, a3, "A_03", { ticketNo: n5, decision: "排除" }, ENG).result.status, "已排除");
  const b = a3.svc.discover(C2, REF).daily; c.eq(`TC08 ${NAME(C2)} 门限边界：弱覆盖采样点＝2000 或占比恰为 20% 记命中，1999 采样点、占比 19.996% 均不命中`, b.map(x => x.hit), ["是", "是", "否", "否", "是", "否", "否"]);
});

def("DS09", "根因约束与修订、站点类型、权限：人工根因、症状级标签、证据、追加轮次", ["TC07a", "TC07d"], c => {
  const app = fresh(SEED), no = call(c, app, "A_01", { cellKey: X }, BOT).result.ticketNo, ev = [{ kind: "小区MR", cellKey: X, from: "2026-09-04", to: "2026-09-10" }];
  c.rej("TC07d① 症状级标签“弱覆盖”不得作主因（INV_02）", call(c, app, "A_02", { ticketNo: no, mode: "manual", role: "主因", causeFamily: "覆盖", causeLabel: "弱覆盖", evidenceRefs: ev }, ENG), "INV_02");
  c.rej("TC07d② 主因“下倾角过小”但证据为空（INV_03）", call(c, app, "A_02", { ticketNo: no, mode: "manual", role: "主因", causeFamily: "天馈", causeLabel: "弱覆盖小区天线下倾角过小", evidenceRefs: [] }, ENG), "INV_03");
  c.ok("人工写入主因第1轮（有证据）", call(c, app, "A_02", { ticketNo: no, mode: "manual", role: "主因", causeFamily: "天馈", causeLabel: "弱覆盖小区天线下倾角过小", evidenceRefs: ev }, ENG).ok);
  const r2 = call(c, app, "A_02", { ticketNo: no, mode: "manual", role: "主因", causeFamily: "天馈", causeLabel: "天线接反", evidenceRefs: [{ kind: "勘察", ref: "现场勘察记录#1" }] }, EXPERT).result;
  c.eq("TC07d③ 专家复核后改主因：追加第2轮，第1轮保留", [r2.round, app.store.doc("OT_TICKET", no).rootCauses.filter(r => r.source === "人工").length], [r2.round, 2]);
  c.rej("无权角色不能写根因（现场维护人员）", call(c, app, "A_02", { ticketNo: no, mode: "manual", role: "主因", causeFamily: "天馈", causeLabel: "x", evidenceRefs: ev }, FLD), "PERMISSION_DENIED");
  c.rej("A_10 回退方案本期只定义、不运行", call(c, app, "A_10", { planNo: "x" }, ENG), "DEFINED_ONLY");
  const a2 = fresh(variant(s => { s.cellSite = s.cellSite.filter(x => x.cellKey !== X); })); c.rej("TC07a② 小区未关联站点（站点类型未知）：拒绝建单（INV_01）", call(c, a2, "A_01", { cellKey: X }, BOT), "INV_01"); c.rej("小区不存在：拒绝", call(c, a2, "A_01", { cellKey: "LTE:99999999" }, BOT), "NOT_FOUND");
  const g = app.facts.defaultTargetRadius(X); c.eq("RULE_G01 默认目标半径＝TH14(0.5)×最近站间距（样例直接给定 500 m 时以给定值为准）", [g.k, Math.abs(g.radius - g.nearest * 0.5) <= 0.1], [0.5, true]);
});

function runScenario(sc) {
  const c = new Ctx(sc.id, sc.title, sc.spec);
  tracker.with("decision", sc.id, () => { try { sc.run(c); } catch (e) { c.ok("场景执行无异常", false, e.stack.split("\n").slice(0, 3).join(" | ")); } });
  return c;
}
module.exports = { SCENARIOS, runScenario, SEED, EXP, variant, fresh, Ctx, K, NAME, X, Y, Z1, Z2, SIM, BAO, N1, C2, C3, C4, C5, C8, C10, C11, C12, AN, ASIM, FE, EXEC, REF, OCT, SEP_SCOPE, BOT, ENG, SUP, FLD, KNW, EXPERT, chmMain, toPlan, dispatch, execute, APPLIC };
