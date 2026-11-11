// 业务决策用例：地市优化工程师、优化主管、现场维护人员、优化专家、知识维护人和优化本体在日常工作中的各个场景。
// 每个用例写明谁、在什么状态下、做什么、预期看到什么；数值预期来自独立构建器生成的 data/expected/expected.json 或种子 CSV。
const { at, A, Q, V, F, ok, rej, ingestMR, BOT, ENG, SUP, FLD, KNW, EXPERT, S } = require("./framework.js");
const { EXP, SEED, FE, EXEC, X, Y, Z1, Z2, SIM, N1, C2, C3, C4, C5, C8, C10, AN, ASIM, NAME, SEP_SCOPE, OCT, APPLIC } = S;
const { addDays } = require("../../src/facts.js");
const e = EXP.chm, nX = NAME(X), nY = NAME(Y), nS = NAME(SIM);
const ENGR = "地市优化工程师";
const approve2 = [{ role: ENGR }, { role: "优化主管" }];
const exec1 = (value = FE.toValue, extra = {}) => x => ({ planNo: x.planNo, dispatchNo: x.dispatchNo, executeTime: EXEC, receipt: "成功", actualValues: [{ targetKey: AN, param: FE.param, value }], ...extra });
const burst = (cell, dates, ratio, base = 7000) => dates.map((date, i) => { const total = base + ((i * 211 + 97) % 530), r = ratio + (((i * 7) % 5) - 2) * 0.006; return { cellKey: cell, date, sampleTotal: total, sampleWeak: Math.round(total * r), receivedAt: addDays(date, 1) + "T06:20:11" }; });
const patchAntenna = (w, mut, eff, source = "资源系统") => w.app.store.putObject("OT_ANTENNA", AN, { ...w.app.store.doc("OT_ANTENNA", AN), ...mut, effectiveTime: eff }, { eff, source });

const CASES = [];
const def = (id, title, role, scene, world, steps, o = {}) => CASES.push({ id, kind: "decision", title, role, scene, world, steps, ...o });

def("BD-01", "问题发现与建单：看发现清单，对“达到”的小区建单", `${ENGR}／优化本体`, "每天晨会前，优化本体对重点小区做批量发现；对“达到”的小区建单，未达到或证据不足的不建。工程师也可以对某个小区发起建单，系统都会按当时的数据重新判断一遍。", "清晨", [
  V(ENGR, "打开发现清单：对 13 个重点小区做批量发现（F_12，只读、不建单）", (x, w, t) => {
    const r = w.app.svc.scan(SEP_SCOPE, w.app.store.peekNow()), by = Object.fromEntries(r.items.map(i => [i.cellKey, i]));
    t.eq("达到／未达到／证据不足的小区数与独立预期一致", r.counts, EXP.scanSepCounts); t.eq("发现只读：此时没有任何工单", w.app.store.count("OT_TICKET"), 0);
    t.ok(`${NAME(Z2)} 窗口内没有 MR：列为证据不足（数据缺口），不被静默跳过`, by[Z2].verdict === "证据不足" && /数据缺口/.test(by[Z2].note), by[Z2].note);
    t.ok(`${NAME(C8)} 是 VIP 场景，SPEC 没有对应规则：证据不足（规则缺口）`, by[C8].verdict === "证据不足" && /规则缺口/.test(by[C8].note), by[C8].note);
  }),
  A(BOT, "A_01", `对“达到”的 ${nX} 建单`, { cellKey: X }, ok("新建工单：待核验，发现依据 7 条 MR 日统计", (r, x, w, t) => { x.no = r.result.ticketNo; t.eq("状态、命中天数、依据条数", [r.result.status, r.result.discovery.hitDays, r.result.discovery.evidenceRefs.length], ["待核验", 7, 7]); t.eq("问题键＝小区@问题类型@窗口末日", r.result.discovery.problemKey, `${X}@MR弱覆盖小区@2026-09-10`); })),
  A(BOT, "A_01", `又点了一次对 ${nX} 建单`, { cellKey: X }, ok("返回原工单，不重复建单（INV_14）", (r, x, w, t) => { t.eq("deduped 且工单数仍为 1", [r.result.deduped, r.result.ticketNo === x.no, w.app.store.count("OT_TICKET")], [true, true, 1]); })),
  A(ENG, "A_01", `工程师自己对门限边界小区 ${NAME(C2)} 建单`, { cellKey: C2 }, ok("建单成功（SPEC 允许地市优化工程师发起），工单数 2", (r, x, w, t) => t.eq("工单数", w.app.store.count("OT_TICKET"), 2))),
  A(BOT, "A_01", `${nY} 同站但没达到门限`, { cellKey: Y }, rej("INV_16", "未达到派单条件，不建单")),
  A(BOT, "A_01", `${NAME(C3)} 7 天只命中 2 天`, { cellKey: C3 }, rej("INV_16", "差 1 天，不建单")),
  A(BOT, "A_01", `${NAME(C4)} 有两天 MR 没到`, { cellKey: C4 }, rej("INV_09", "证据不足：缺天太多，不建单")),
  A(BOT, "A_01", `${NAME(Z2)} 窗口内一天 MR 都没有`, { cellKey: Z2 }, rej("INV_09", "证据不足：数据缺口")),
  A(BOT, "A_01", `${NAME(C8)} 是 VIP 场景`, { cellKey: C8 }, rej("INV_09", "规则缺口，不套用一般场景门限")),
  A(FLD, "A_01", `现场维护人员试图建单`, { cellKey: X }, rej("PERMISSION_DENIED", "SPEC 只允许优化本体和地市优化工程师建单")),
  V(ENGR, "核对：被拒绝的 6 次都没有产生工单，并且都留有审计记录", (x, w, t) => { t.eq("工单仍是 2 张", w.app.store.count("OT_TICKET"), 2); t.ok("被拒绝的动作留有审计", w.app.store.runs().filter(r => r.outcome === "rejected").length >= 6, "审计记录不足"); }),
], { spec: ["TC01a", "TC08"] });

def("BD-02", "清晨 5 点就看清单：MR 还没到齐时的发现", `${ENGR}`, "MR 日统计在次日凌晨陆续到达。工程师 5 点就打开清单，前一天的数据还没到：缺的那天记“未知”，不当作 0，也不静默跳过；数据到齐后结论会变。", "清晨", [
  V(ENGR, "05:00 打开发现清单：崇贤达NF02H_222 昨天（9月10日）的 MR 还没到", (x, w, t) => {
    const r = w.app.svc.scan([X, C3], w.app.store.peekNow()), a = r.items.find(i => i.cellKey === X), b = r.items.find(i => i.cellKey === C3);
    t.eq(`${nX} 命中 6 天、未知 1 天，仍达到（6 天已够 3 天）`, [a.verdict, a.hitDays, a.unknownDates], ["达到派单条件", 6, ["2026-09-10"]]);
    t.eq(`${NAME(C3)} 命中 2 天＋未知 1 天：命中加未知刚好凑得够却不确定 → 证据不足`, [b.verdict, b.hitDays, b.unknownDates.length], ["证据不足", 2, 1]);
  }),
  Q(ENGR, `${nX} 的 MR 到齐了吗`, { intent: "arrival", has: ["已到 6 天", "缺 9月10日", "INV_09"] }),
  A(BOT, "A_01", `对 ${nX} 建单（昨天的数据还没到）`, { cellKey: X }, ok("建单成功：发现依据 6 条，快照里记着缺 9 月 10 日", (r, x, w, t) => { x.no = r.result.ticketNo; t.eq("命中天数、依据条数、缺天", [r.result.discovery.hitDays, r.result.discovery.evidenceRefs.length, r.result.discovery.unknownDates], [6, 6, ["2026-09-10"]]); })),
  A(BOT, "A_01", `对 ${NAME(C3)} 建单`, { cellKey: C3 }, rej("INV_09", "证据不足，数据到齐前不建单")),
  at("2026-09-11T09:00:00", "上午 9 点：9 月 10 日的 MR 日统计到达"),
  Q(ENGR, `${nX} 的 MR 到齐了吗`, { intent: "arrival", has: ["已到 7 天", "缺 无"] }),
  V(ENGR, "重新发现：崇贤达NF02H_222 命中 7 天；已建工单的快照不改（仍是 6 天、缺 1 天）", (x, w, t) => {
    const r = w.app.svc.scan([X], w.app.store.peekNow()).items[0], tk = w.app.store.doc("OT_TICKET", x.no);
    t.eq("重新发现命中天数", r.hitDays, 7); t.eq("已建工单发现快照不变", [tk.discovery.hitDays, tk.discovery.unknownDates], [6, ["2026-09-10"]]);
  }),
  A(BOT, "A_01", `对 ${NAME(C3)} 再试：数据到齐后变成“未达到”`, { cellKey: C3 }, rej("INV_16", "命中只有 2 天，不建单")),
], { spec: ["TC03b", "TC01a"], start: "2026-09-11T05:00:00" });

def("BD-03", "5G 宏站：能发现、能建单，原因判断转人工", `${ENGR}／优化专家`, "5G 小区按 5G 宏站规则发现并建单；SPEC 没有定义 NR 的理论半径与推荐下倾公式，系统不套用 4G 公式，原因判断和方案都转人工。", "清晨", [
  A(BOT, "A_01", `对 5G 小区 ${NAME(N1)} 建单`, { cellKey: N1 }, ok("按 RULE_D03 建单，派单问题“宏站弱覆盖小区”", (r, x, w, t) => { x.no = r.result.ticketNo; t.eq("规则与派单问题", [r.result.discovery.ruleId, w.app.store.doc("OT_TICKET", x.no).dispatchProblem], ["RULE_D03", "宏站弱覆盖小区"]); })),
  A(BOT, "A_02", "优化本体按规则定因", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_08＝未知，不写根因", (r, x, w, t) => t.eq("F_08、是否写根因", [r.result.f08, r.result.written], ["未知", false]))),
  Q(ENGR, "它的根因是什么？", { intent: "cause", has: ["F_08＝未知", "NR", "转人工"] }),
  Q(ENGR, "5G 小区也能自动出下倾方案吗？", { intent: "unsupported", has: ["NR", "未知", "不生成下倾方案"] }),
  A(ENG, "A_03", "工程师想直接确认", x => ({ ticketNo: x.no, decision: "确认", reason: "先确认再说" }), rej("INV_03", "没有带证据的主因不能确认")),
  A(EXPERT, "A_02", "优化专家现场勘察后手工写入主因（附勘察记录）", x => ({ ticketNo: x.no, mode: "manual", role: "主因", causeFamily: "天馈", causeLabel: "弱覆盖小区天线下倾角过小", evidenceRefs: [{ kind: "勘察", ref: "现场勘察记录#NR-海剑-01" }] }), ok("根因第 1 轮写入，来源“人工”", (r, x, w, t) => t.eq("轮次", r.result.round, 1))),
  A(ENG, "A_03", "工程师确认", x => ({ ticketNo: x.no, decision: "确认" }), ok("工单已确认", (r, x, w, t) => t.eq("状态", r.result.status, "已确认"))),
  A(BOT, "A_04", "优化本体想生成下倾方案", x => ({ ticketNo: x.no, adjustType: "机械" }), rej("INV_09", "F_08＝未知（NR 公式未定义），不生成方案，转人工处理")),
], { spec: ["TC06c"], start: OCT });

def("BD-04", "4G 室分小区：按室分规则发现，不套用宏站下倾模型", ENGR, "室分小区同样能被发现和建单，但宏站的天线下倾模型不适用，原因判断转人工。", "清晨", [
  A(BOT, "A_01", `对室分小区 ${NAME(C10)} 建单`, { cellKey: C10 }, ok("按 RULE_D02 建单，派单问题“室分弱覆盖小区”", (r, x, w, t) => { x.no = r.result.ticketNo; t.eq("规则与派单问题", [r.result.discovery.ruleId, w.app.store.doc("OT_TICKET", x.no).dispatchProblem], ["RULE_D02", "室分弱覆盖小区"]); })),
  A(BOT, "A_02", "优化本体按规则定因", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_08＝未知（室分不适用宏站模型）", (r, x, w, t) => t.eq("F_08、是否写根因", [r.result.f08, r.result.written], ["未知", false]))),
  Q(ENGR, "它的根因是什么？", { intent: "cause", has: ["F_08＝未知", "室分", "转人工"] }),
  A(BOT, "A_04", "优化本体想生成下倾方案", x => ({ ticketNo: x.no, adjustType: "机械" }), rej("INV_04", "待核验的工单不得生成方案")),
]);

def("BD-05", "接单核验：看依据、看告警、写复核意见后确认", ENGR, "工程师今天的待办里有一张待核验工单：先看发现依据，再看定因结果，告警与命中日部分重合时必须写明复核判断才能确认。", "工单待核验", [
  Q(ENGR, "我今天有哪些待办？", { intent: "queue", has: ["待核验", "确认或排除"], pending: ["A_03"] }),
  Q(ENGR, `${nX} 这张工单的发现依据有哪些MR？`, { intent: "ticket.evidence", has: ["7 条 OT_CELL_MR"] }),
  A(BOT, "A_02", "优化本体按规则定因（F_07 排除假性弱覆盖，F_08 判下倾角）", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_07 部分重合、F_08 命中，主因写入", (r, x, w, t) => t.eq("F_07、F_08、是否写根因", [r.result.f07, r.result.f08, r.result.written], ["部分重合", "命中", true]))),
  Q(ENGR, "有告警吗，会不会是假性弱覆盖？", { intent: "falseweak", has: ["部分重合", "14.29%", "BASE STATION INFORMATION"] }),
  Q(ENGR, "功率和方位角有没有问题？", { intent: "cause.other", has: ["发射功率", "覆盖方向", "周边遮挡", "没有次因与主因并列"] }),
  Q(ENGR, "能直接确认吗？", { intent: "can", has: ["须在确认时写明复核判断"], pending: ["A_03"] }),
  A(ENG, "A_03", "工程师没写复核意见就点确认", x => ({ ticketNo: x.no, decision: "确认" }), rej("REVIEW_REQUIRED", "告警部分重合，必须写明复核判断")),
  Q(ENGR, "为什么刚才确认没成功？", { intent: "why.rejected", has: ["REVIEW_REQUIRED", "复核判断", "补写复核判断"] }),
  A(ENG, "A_03", "工程师写明复核意见后确认", x => ({ ticketNo: x.no, decision: "确认", reason: "复核：告警只覆盖 1 个命中日，不影响主因" }), ok("工单已确认", (r, x, w, t) => t.eq("状态", r.result.status, "已确认"))),
  V(ENGR, "核对：根因第 1 轮的证据是小区 MR 窗口和天线工参；诊断记录 3 条", (x, w, t) => { const tk = w.app.store.doc("OT_TICKET", x.no); t.eq("证据种类", tk.rootCauses[0].evidenceRefs.map(r => r.kind), ["小区MR", "工参"]); t.eq("诊断记录", tk.diagnostics.map(d => d.funcId), ["F_06", "F_07", "F_08"]); }),
  A(ENG, "A_03", "有人又点了一次确认", x => ({ ticketNo: x.no, decision: "确认", reason: "重复" }), rej("STATE", "只能对待核验的工单确认或排除")),
  A(FLD, "A_03", "现场维护人员误点了确认", x => ({ ticketNo: x.no, decision: "确认" }), rej("PERMISSION_DENIED")),
], { spec: ["TC03d", "TC04a"] });

def("BD-06", "假性弱覆盖：告警盖住大部分命中日，工单排除", ENGR, "小区命中弱覆盖的那几天正好在退服告警期内，是假性弱覆盖，不应调参，工程师排除工单。", "工单待核验", [
  A(BOT, "A_02", "优化本体按规则定因", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_07＝排除，不写根因", (r, x, w, t) => t.eq("F_07、是否写根因", [r.result.f07, r.result.written], ["排除", false]))),
  Q(ENGR, "有告警吗，会不会是假性弱覆盖？", { intent: "falseweak", has: ["排除", "假性弱覆盖，工单应排除"] }),
  Q(ENGR, "能直接确认吗？", { intent: "can", has: ["不该确认", "应当排除"], pending: ["A_03"] }),
  A(ENG, "A_03", "工程师想确认", x => ({ ticketNo: x.no, decision: "确认", reason: "试试" }), rej("INV_03", "没有主因证据不能确认")),
  A(ENG, "A_03", "工程师排除工单", x => ({ ticketNo: x.no, decision: "排除" }), ok("工单已排除", (r, x, w, t) => t.eq("状态", r.result.status, "已排除"))),
  A(BOT, "A_04", "优化本体想生成方案", x => ({ ticketNo: x.no, adjustType: "机械" }), rej("INV_04", "已排除的工单不得生成方案")),
], { spec: ["TC03c"], data: "增加一条告警：崇贤达NF02H_222 小区退服，9 月 4 日～9 日", seed: s => { s.alarms.push({ cell: X, type: "小区退服", startDate: "2026-09-04", endDate: "2026-09-09" }); } });

def("BD-07", "次因并列：发射功率偏低，须工程师写明复核判断", ENGR, "主因是下倾角过小，同时现网发射功率低于规划值。次因只作线索，工程师确认时要说明本方案只针对下倾，措施字典里没有调功率。", "工单待核验", [
  A(BOT, "A_02", "优化本体按规则定因", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_08 命中，次因“发射功率”并列", (r, x, w, t) => t.eq("F_08、次因、根因角色", [r.result.f08, r.result.otherCauses, w.app.store.doc("OT_TICKET", x.no).rootCauses.map(c => c.role)], ["命中", ["发射功率"], ["主因", "次因"]]))),
  Q(ENGR, "功率和方位角有没有问题？", { intent: "cause.other", has: ["低于规划", "记次因“发射功率”", "与主因并列"] }),
  A(ENG, "A_03", "工程师没写复核意见", x => ({ ticketNo: x.no, decision: "确认" }), rej("REVIEW_REQUIRED", "次因同时命中，须写明复核判断")),
  A(ENG, "A_03", "工程师写明：功率偏低另行处理，本方案只针对下倾", x => ({ ticketNo: x.no, decision: "确认", reason: "功率偏低另行处理，本方案只针对下倾" }), ok("工单已确认")),
  Q(ENGR, "帮我把功率调高两个dB", { intent: "unsupported", has: ["措施字典", "不会生成这类方案"] }),
  A(BOT, "A_04", "优化本体生成方案（只针对主因）", x => ({ ticketNo: x.no, adjustType: "机械" }), ok("方案与主线一致：缺口、Δ＝1°、周边影响通过", (r, x, w, t) => t.eq("缺口、Δ、周边影响", [r.result.gap, r.result.delta, r.result.impact], [e.tilt.gap, 1, "通过"]))),
], { spec: ["TC03f"], data: "崇贤达NF02H_222 现网发射功率 10.8 dBm（低于规划值），去掉原有告警", seed: s => { s.alarms = []; s.cells.find(c => c.cellKey === X).rsPower = 10.8; } });

def("BD-08", "工参缺失：补录挂高后重新定因", ENGR, "天线挂高在资源系统里是空的，系统不判“不命中”，也不编一个原因；资源系统补录后重新定因即可往下走。", "工单待核验", [
  A(BOT, "A_02", "优化本体按规则定因", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_08＝未知，缺项 antenna.height，不写根因", (r, x, w, t) => { t.eq("F_08、是否写根因", [r.result.f08, r.result.written], ["未知", false]); t.eq("缺项", w.app.store.doc("OT_TICKET", x.no).diagnostics.find(d => d.kind === "下倾角命中").result.missing, ["antenna.height"]); })),
  Q(ENGR, "它的根因是什么？", { intent: "cause", has: ["F_08＝未知", "antenna.height", "转人工"] }),
  Q(ENGR, "推荐下倾角是怎么算出来的？", { intent: "explain.calc", has: ["缺必需输入", "不判“不命中”"] }),
  A(ENG, "A_03", "工程师想确认", x => ({ ticketNo: x.no, decision: "确认", reason: "先确认" }), rej("INV_03", "没有主因证据")),
  A(BOT, "A_04", "优化本体想生成方案", x => ({ ticketNo: x.no, adjustType: "机械" }), rej("INV_04", "待核验不得生成方案")),
  V("资源系统", "资源系统补录挂高 38 m（9 月 11 日 08:00 生效）", (x, w, t) => { patchAntenna(w, { height: 38 }, "2026-09-11T08:00:00"); t.eq("天线挂高", w.app.facts.antennaState(AN, w.app.store.peekNow()).antenna.height, 38); }),
  A(BOT, "A_02", "优化本体重新定因", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_08 命中，根因第 1 轮写入", (r, x, w, t) => t.eq("F_08、是否写根因", [r.result.f08, r.result.written], ["命中", true]))),
  Q(ENGR, "推荐下倾角是怎么算出来的？", { intent: "explain.calc", has: ["arctan(38", "θ_t", String(e.tilt.thetaT), String(e.tilt.gap), "TH01"] }),
], { spec: ["TC03a"], data: "崇贤达NF02H_222 的天线挂高为空", seed: s => { delete s.antennas.find(a => a.antennaId === AN).height; } });

def("BD-09", "专家复核改因：症状级标签与无证据主因被拒，改因追加新一轮", `${ENGR}／优化专家`, "规则定的主因被专家否定时，专家可以手工写入新的主因：不能写“弱覆盖”这类症状，主因必须有真实证据；改因是追加一轮，第 1 轮保留。", "已定因", [
  A(EXPERT, "A_02", "专家把主因写成“弱覆盖”", x => ({ ticketNo: x.no, mode: "manual", role: "主因", causeFamily: "覆盖", causeLabel: "弱覆盖", evidenceRefs: [{ kind: "小区MR", cellKey: X, from: "2026-09-04", to: "2026-09-10" }] }), rej("INV_02", "症状级标签不得作主因")),
  A(EXPERT, "A_02", "专家写了主因但没附证据", x => ({ ticketNo: x.no, mode: "manual", role: "主因", causeFamily: "天馈", causeLabel: "天线接反", evidenceRefs: [] }), rej("INV_03", "主因至少要有一条真实证据")),
  A(EXPERT, "A_02", "专家附上勘察记录，改判为“天线接反”", x => ({ ticketNo: x.no, mode: "manual", role: "主因", causeFamily: "天馈", causeLabel: "天线接反", evidenceRefs: [{ kind: "勘察", ref: "现场勘察记录#崇贤达-07" }] }), ok("追加第 2 轮根因", (r, x, w, t) => { t.eq("轮次", r.result.round, 2); t.eq("第 1 轮保留，两轮并存", w.app.store.doc("OT_TICKET", x.no).rootCauses.filter(c => c.role === "主因").map(c => [c.round, c.source]), [[1, "规则"], [2, "人工"]]); })),
  A(FLD, "A_02", "现场维护人员想改根因", x => ({ ticketNo: x.no, mode: "manual", role: "主因", causeFamily: "天馈", causeLabel: "x", evidenceRefs: [] }), rej("PERMISSION_DENIED")),
  Q(ENGR, `${nX} 这张工单的根因是什么？`, { intent: "cause", has: ["天线接反", "命中"] }),
], { spec: ["TC07d"] });

def("BD-10", "主管审批：方案作用于 2 个小区，必须追加优化主管批准", `优化主管／${ENGR}`, "机械下倾作用于整副天线，同天线的两个小区都受影响，所以工程师确认后还要优化主管追加批准；任何情况下天馈类措施都不能自动执行。", "方案待确认", [
  Q("优化主管", "有什么要我批的？", { intent: "queue", has: ["追加优化主管批准", "作用于 2 个小区"], pending: ["A_05"] }),
  Q("优化主管", "为什么要我批？", { intent: "approval", has: ["优化主管批准（RULE_W14）", "不得自动执行"] }),
  Q("优化主管", "这个方案涉及几个小区？", { intent: "impact", has: ["涉及 2 个小区", `${nX}（受影响）`, `${nY}（受影响）`] }),
  Q("优化主管", "这个方案能自动下发到现场吗？", { intent: "approval", has: ["不得自动执行", "INV_05"] }),
  A(ENG, "A_05", "工程师只带自己的意见提交", x => ({ planNo: x.planNo, decision: "批准", approvals: [{ role: ENGR }] }), rej("SUPERVISOR_REQUIRED", "作用于 2 个小区，须追加优化主管批准")),
  A(ENG, "A_05", "有人尝试让系统自动执行", x => ({ planNo: x.planNo, decision: "批准", auto: true, approvals: approve2 }), rej("INV_05", "天馈类措施不得自动执行")),
  A(BOT, "A_05", "优化本体想自己确认派单", x => ({ planNo: x.planNo, decision: "批准", approvals: [] }), rej("PERMISSION_DENIED")),
  A(ENG, "A_05", "工程师与优化主管共同批准，派给现场维护人员", x => ({ planNo: x.planNo, decision: "批准", approvals: approve2, executor: { role: "现场维护人员", name: FE.executor } }), ok("派单成功，工单进入处置中", (r, x, w, t) => { t.eq("派单号、是否含主管批准", [r.result.dispatchNo, r.result.supervisor], ["DP-" + x.planNo, true]); t.eq("工单状态", w.app.store.doc("OT_TICKET", x.no).status, "处置中"); })),
  A(ENG, "A_05", "重复提交同一方案", x => ({ planNo: x.planNo, decision: "批准", approvals: approve2 }), ok("幂等：返回同一派单号，不重复派单", (r, x, w, t) => t.eq("deduped", r.result.deduped, true))),
  Q("优化主管", "有什么要我批的？", { intent: "queue", has: ["没有待办"] }),
], { spec: ["TC01", "TC07b"] });

def("BD-11", "同天线小区受限：机械方案停在草案，工程师不批准，改电子下倾后派单、回填", ENGR, `${nY} 的目标覆盖半径较大（560 m），机械下倾会让同天线的 ${nY} 远端覆盖不够，周边影响不通过；工程师否决草案，改用只作用于本小区的电子下倾。`, "已确认", [
  Q(ENGR, "机械下倾和电子下倾哪个合适？", { intent: "compare", has: ["机械下倾：", "周边影响“不通过”", "电子下倾：", "周边影响“通过”", `${EXP.chmVariants.yTightElec.delta}°`, "SPEC 没有规定两者的优先顺序"] }),
  A(BOT, "A_04", "优化本体生成机械下倾方案", x => ({ ticketNo: x.no, adjustType: "机械" }), ok("方案停在草案：周边影响不通过，转人工", (r, x, w, t) => { x.plan1 = r.result.planNo; t.eq("状态、周边影响、转人工", [r.result.status, r.result.impact, r.result.toHuman], ["草案", EXP.chmVariants.yTightMech.result, true]); })),
  Q(ENGR, "这个方案能派单吗？", { intent: "can", has: ["不能", "周边影响“不通过”", "INV_06"] }),
  A(ENG, "A_05", "工程师想硬批", x => ({ planNo: x.plan1, decision: "批准", approvals: approve2 }), rej("INV_06", "不通过的方案不得批准")),
  A(BOT, "A_04", "优化本体想再出一轮机械方案", x => ({ ticketNo: x.no, adjustType: "机械" }), rej("ROUND_IN_PROGRESS", "上一轮方案还没结束")),
  Q(ENGR, "我今天有哪些待办？", { intent: "queue", has: ["停在草案", "不得批准"] }),
  A(ENG, "A_05", "工程师不批准机械方案，写明理由", x => ({ planNo: x.plan1, decision: "不批准", reason: `${nY} 目标半径 560 m，机械下倾会使其远端覆盖不足` }), ok("方案“未批准”", (r, x, w, t) => t.eq("状态", r.result.status, "未批准"))),
  A(BOT, "A_04", "优化本体改出电子下倾方案（第 2 轮）", x => ({ ticketNo: x.no, adjustType: "电子" }), ok("方案 R2 待确认：只作用于本小区阵列，Δ＝1.3°，周边影响通过", (r, x, w, t) => { x.planNo = r.result.planNo; const p = w.app.store.doc("OT_PLAN", x.planNo); t.eq("状态、周边影响、Δ、调整参数", [p.status, p.impact.result, p.actions[0].deltaValue, p.actions[0].param], ["待确认", EXP.chmVariants.yTightElec.result, EXP.chmVariants.yTightElec.deltaFinal, "elecTilt"]); t.eq("RT_10 只有目标小区（不含天线与同天线小区）", w.app.store.links({ rt: "RT_10", from: "OT_PLAN:" + x.planNo }).map(l => l.to), ["OT_CELL:" + X]); })),
  Q(ENGR, "对周边有什么影响？", { intent: "impact", has: ["涉及 1 个小区", "电子下倾只影响对应阵列小区"] }),
  A(ENG, "A_05", "工程师确认派单（只涉及 1 个小区，无须主管追加批准）", x => ({ planNo: x.planNo, decision: "批准", approvals: [{ role: ENGR }], executor: { role: "现场维护人员", name: FE.executor } }), ok("派单成功，不要求主管批准", (r, x, w, t) => { x.dispatchNo = r.result.dispatchNo; t.eq("是否追加主管批准", r.result.supervisor, false); })),
  at(FE.receivedAt, "现场回填时间"),
  A(FLD, "A_06", "现场维护人员回填：电子下倾已调到方案值", (x, w) => ({ planNo: x.planNo, dispatchNo: x.dispatchNo, executeTime: EXEC, receipt: "成功", actualValues: [{ targetKey: X, param: "elecTilt", value: w.app.store.doc("OT_PLAN", x.planNo).actions[0].targetValue }] }), ok("已实施，小区阵列的电子下倾更新", (r, x, w, t) => { const tv = w.app.store.doc("OT_PLAN", x.planNo).actions[0].targetValue; t.eq("RT_02 的 elecTilt 变为方案值，机械下倾不变", [w.app.facts.antennaLink(X).elecTilt, w.app.facts.antennaState(AN, w.app.store.peekNow()).antenna.mechTilt], [tv, FE.fromValue]); })),
], { spec: ["TC02b", "TC02c"], data: "崇贤达NF08H_223 的目标覆盖半径改为 560 m", seed: s => { s.cells.find(c => c.cellKey === Y).targetRadius = 560; } });

def("BD-12", "派单前别的部门已调整了天线：方案过期，退回草案", ENGR, "方案生成后、派单前，资源系统里该天线的机械下倾被别的部门改了。工程师派单时系统发现方案依据的工参版本已变，不能照旧执行。", "方案待确认", [
  V("资源系统", "资源系统记录：该天线机械下倾已被改为 4°（9 月 12 日 08:00 生效）", (x, w, t) => { patchAntenna(w, { mechTilt: 4 }, "2026-09-12T08:00:00"); t.ok("新版本写入", w.app.store.history("OT_ANTENNA", AN).length >= 2, "没有新版本"); }),
  at("2026-09-12T09:00:00", "9 月 12 日上午 9 点，工程师准备派单"),
  A(ENG, "A_05", "工程师与主管批准派单", x => ({ planNo: x.planNo, decision: "批准", approvals: approve2 }), rej("STALE_FACTS", "方案所依据的工参版本已变，退回草案", (r, x, w, t) => t.eq("方案状态", w.app.store.doc("OT_PLAN", x.planNo).status, "草案"))),
  Q(ENGR, `${nX} 现在的下倾角是多少？`, { intent: "antenna.now", has: ["机械下倾 4°", "总下倾 7°", "资源系统"] }),
  A(ENG, "A_05", "工程师不批准这个过期方案", x => ({ planNo: x.planNo, decision: "不批准", reason: "天线已被调整，方案作废" }), ok("方案“未批准”")),
  A(BOT, "A_04", "优化本体重新生成方案", x => ({ ticketNo: x.no, adjustType: "机械" }), rej("NOT_MATCHED", "F_08 不命中（总下倾 7° 已够），转其他原因族")),
  V(ENGR, "核对：按新工参重算 F_08＝不命中，总下倾 7°", (x, w, t) => { const f = w.app.svc.matchTilt(X, w.app.store.peekNow()); t.eq("F_08、总下倾", [f.match, f.totalTilt], ["不命中", e.afterAt4.total]); }),
], { spec: ["TC07b"] });

def("BD-13", "现场回填：实际值、重复提交与冲突", `现场维护人员／${ENGR}`, "现场维护人员按派单调完天线后回填实际值：缺实际值不能记为已实施，重复提交同值幂等，同一派单号回填不同值按冲突转人工。回填后工参新版本的生效时间是实施时间，不是回填接收时间。", "已派单", [
  Q("现场维护人员", "我有哪些单子要回填？", { intent: "queue", has: ["已派单", "待现场回填", "DP-"], pending: ["A_06"] }),
  at(FE.receivedAt, "现场回填时间"),
  A(FLD, "A_06", "现场维护人员没填实际值就提交", exec1(FE.toValue, { actualValues: [] }), rej("INV_07", "缺现场实际值，不得记为已实施")),
  A(FLD, "A_06", "现场维护人员回填：机械下倾由 3° 调到 4°", exec1(), ok("已实施，工单待评估", (r, x, w, t) => t.eq("方案、工单状态", [r.result.status, r.result.ticketStatus], ["已实施", "待评估"]))),
  A(FLD, "A_06", "网络不好，又提交了一次同样的值", exec1(), ok("幂等：不重复记录", (r, x, w, t) => t.eq("deduped", r.result.deduped, true))),
  A(FLD, "A_06", "另一位同事又回填成 5°", exec1(5), rej("INV_15", "同一派单号取值不同，按冲突转人工，不覆盖")),
  Q(ENGR, "调完了吗？现场实际调到多少？", { intent: "execution", has: [`${FE.toValue}°`, "一致", "已实施"].slice(0, 2) }),
  Q(ENGR, "天线现在的下倾角是多少？", { intent: "antenna.now", has: [`机械下倾 ${FE.toValue}°`, "总下倾 7°", "回填"] }),
  Q(ENGR, "9月13日那天的天线下倾角是多少", { intent: "asof", has: [`${FE.fromValue}°`, AN] }),
  Q(ENGR, "回填时间和实施时间为什么不一样？", { intent: "execution", has: [`生效时间＝实施时间 ${EXEC}`, "不是回填接收时间"] }),
], { spec: ["TC05a", "TC07c"] });

def("BD-14", "现场实际值与方案不一致：事后复核，回退只定义、不运行", `现场维护人员／${ENGR}`, "现场多调了 3°，实际值与方案不一致。系统以实际值事后复核周边影响，发现不通过；方案里保留计划值，回退动作本期只定义、不运行。", "已派单", [
  at(FE.receivedAt, "现场回填时间"),
  A(FLD, "A_06", "现场维护人员回填：实际调到 6°（方案是 4°）", exec1(FE.fromValue + 3), ok("已实施，事后复核周边影响不通过", (r, x, w, t) => { t.eq("复核结果与失败小区（独立预期）", [r.result.recheck, r.result.failed.map(f => f.cell).sort()], [EXP.chmVariants.actualPlus3.result, EXP.chmVariants.actualPlus3.failed.sort()]); t.eq("方案计划值保留、实际值另记", [w.app.store.doc("OT_PLAN", x.planNo).actions[0].deltaValue, w.app.store.doc("OT_PLAN", x.planNo).execution.actualValues[0].value], [1, FE.fromValue + 3]); })),
  Q(ENGR, "和方案一致吗？", { intent: "execution", has: ["不一致", "事后复核", "6°"] }),
  Q(ENGR, "如果调坏了怎么办？", { intent: "rollback", has: ["回退值 3°", "A_10", "本期只定义、不运行"] }),
  A(ENG, "A_10", "工程师想执行回退", x => ({ planNo: x.planNo }), rej("DEFINED_ONLY", "回退动作本期只定义、不运行")),
  A(BOT, "A_10", "优化本体想执行回退", x => ({ planNo: x.planNo }), rej("PERMISSION_DENIED", "SPEC 只允许地市优化工程师发起")),
], { spec: ["TC02e"] });

def("BD-15", "回执缺失：催办后补回执，期间不得评估", `现场维护人员／${ENGR}`, "现场没有回执：系统记“未知”，工单留在处置中，不能评估也不能关；先核对原派单记录，不直接重发。补回执后才继续往下走。", "已派单", [
  at(FE.receivedAt, "现场回填时间"),
  A(FLD, "A_06", "现场只回了一句“已处理”，没有回执", x => ({ planNo: x.planNo, dispatchNo: x.dispatchNo }), ok("回执记“未知”，工单仍处置中", (r, x, w, t) => t.eq("回执、方案状态、工单状态", [r.result.receipt, w.app.store.doc("OT_PLAN", x.planNo).status, w.app.store.doc("OT_TICKET", x.no).status], ["未知", "未知", "处置中"]))),
  Q(ENGR, "我今天有哪些待办？", { intent: "queue", has: ["回执缺失", "先核对原派单记录"] }),
  Q(ENGR, "现场实际执行了什么？", { intent: "execution", has: ["回执“未知”", "不得评估或关闭"] }),
  at("2026-09-22T09:00:00", "一周后"),
  A(BOT, "A_07", "优化本体想评估效果", x => ({ planNo: x.planNo }), rej("INV_08", "回执未知，不得评估")),
  Q(ENGR, "能关单吗？", { intent: "close", has: ["暂不能关闭", "尚无效果评估"] }),
  A(FLD, "A_06", "工程师催办后，现场补上回执和实际值", exec1(), ok("已实施，工单待评估", (r, x, w, t) => t.eq("工单状态", r.result.ticketStatus, "待评估"))),
  A(BOT, "A_07", "优化本体评估效果", x => ({ planNo: x.planNo }), ok("效果“改善”", (r, x, w, t) => t.eq("状态", r.result.status, "改善"))),
], { spec: ["TC07c"] });

def("BD-16", "工参来源冲突：回填与资源系统不一致，裁定前不评估", `${ENGR}／现场维护人员`, "现场回填的下倾角与资源系统同期记录不一致，系统保留两个来源并置“冲突”，不自动取其中一个；裁定前不判定、不评估，裁定后才继续。", "已派单", [
  at(FE.receivedAt, "现场回填时间"),
  A(FLD, "A_06", "现场回填 4°，资源系统同期记录仍是 3°", exec1(FE.toValue, { resourceValue: FE.fromValue }), ok("工参状态“冲突”，转人工裁定", (r, x, w, t) => { t.eq("冲突标记", r.result.conflict, true); t.eq("两来源取值都保留", w.app.facts.antennaState(AN, "2026-09-15T00:00:00").sources.map(s => [s.source, s.mechTilt]).sort(), [["回填", FE.toValue], ["资源系统", FE.fromValue]]); })),
  Q(ENGR, "现在有工参冲突吗？", { intent: "conflict", has: [AN, `回填 ${FE.toValue}°`, `资源系统 ${FE.fromValue}°`, "A_11"] }),
  Q(ENGR, "我今天有哪些待办？", { intent: "queue", has: ["工参来源冲突", "待裁定"], pending: ["A_11"] }),
  at("2026-09-22T09:00:00", "一周后"),
  A(BOT, "A_07", "优化本体想评估效果", x => ({ planNo: x.planNo }), rej("INV_15", "裁定前不评估")),
  A(BOT, "A_11", "优化本体想自己裁定", x => ({ antennaId: AN, chosenSource: "回填", reason: "自动" }), rej("PERMISSION_DENIED", "优化本体无权裁定")),
  A(ENG, "A_11", "工程师没写理由就裁定", x => ({ antennaId: AN, chosenSource: "回填" }), rej("INV_15", "裁定须写明理由")),
  A(ENG, "A_11", "工程师裁定：以现场回填为准（实测 4°）", x => ({ antennaId: AN, chosenSource: "回填", reason: "现场实测确认为 4°" }), ok("裁定成功，因冲突停在处置中的工单转待评估", (r, x, w, t) => t.eq("机械下倾、工单状态", [r.result.mechTilt, w.app.store.doc("OT_TICKET", x.no).status], [FE.toValue, "待评估"]))),
  A(BOT, "A_07", "优化本体评估效果", x => ({ planNo: x.planNo }), ok("效果“改善”", (r, x, w, t) => t.eq("状态", r.result.status, "改善"))),
  A(ENG, "A_11", "有人又来裁定一次", x => ({ antennaId: AN, chosenSource: "回填", reason: "重复" }), rej("INV_15", "没有未裁定的冲突")),
], { spec: ["TC05b"] });

def("BD-17", "完整闭环：发现→建单→定因→确认→方案→派单→回填→评估→关单→入库→复发", "各角色接力", "崇明崇贤达NF02H_222 从前置数据被发现开始，经过 4 个角色接力走完整个闭环，关单入库后一周该小区弱覆盖复发，系统新建工单并关联原单。", "清晨", [
  A(BOT, "A_01", "优化本体依发现结果建单", { cellKey: X }, ok("工单待核验", (r, x) => { x.no = r.result.ticketNo; })),
  A(BOT, "A_02", "优化本体按规则定因", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_08 命中，缺口 " + e.tilt.gap + "°", (r, x, w, t) => t.eq("F_07、F_08", [r.result.f07, r.result.f08], ["部分重合", "命中"]))),
  A(ENG, "A_03", "工程师写明复核意见后确认", x => ({ ticketNo: x.no, decision: "确认", reason: "复核：告警与命中日仅部分重合，不影响主因" }), ok("工单已确认")),
  A(BOT, "A_04", "优化本体生成机械下倾方案", x => ({ ticketNo: x.no, adjustType: "机械" }), ok("Δ＝1°，周边影响通过", (r, x, w, t) => { x.planNo = r.result.planNo; t.eq("Δ、周边影响", [r.result.delta, r.result.impact], [1, "通过"]); })),
  at("2026-09-12T09:00:00", "9 月 12 日"),
  A(ENG, "A_05", "工程师与优化主管批准，派给现场维护人员", x => ({ planNo: x.planNo, decision: "批准", approvals: approve2, executor: { role: "现场维护人员", name: FE.executor } }), ok("派单成功", (r, x) => { x.dispatchNo = r.result.dispatchNo; })),
  at(FE.receivedAt, "现场回填时间"),
  A(FLD, "A_06", "现场维护人员回填：机械下倾 3°→4°", exec1(), ok("已实施，工单待评估")),
  at("2026-09-22T09:00:00", "实施后一周"),
  A(BOT, "A_07", "优化本体写入第 1 周效果", x => ({ planNo: x.planNo }), ok("改善，持续有效为空，保护指标通过", (r, x, w, t) => { x.e1 = r.result; t.near("前窗占比", r.result.beforeRatio, e.beforeRatio, 0.0001); t.near("后窗占比", r.result.afterRatio, e.afterRatio1, 0.0001); t.eq("状态、持续有效、保护指标", [r.result.status, r.result.sustained, r.result.protectionOk], ["改善", null, true]); })),
  A(SUP, "A_08", "优化主管想现在关单", x => ({ ticketNo: x.no }), rej("INV_10", "持续有效为空，不得关单")),
  at("2026-09-29T09:00:00", "实施后两周"),
  A(BOT, "A_07", "优化本体写入第 2 周效果", x => ({ planNo: x.planNo }), ok("持续有效", (r, x, w, t) => { x.e2 = r.result; t.eq("状态、持续有效、后窗天数", [r.result.status, r.result.sustained, r.result.daysAfter], ["持续有效", true, 14]); })),
  at("2026-09-29T10:00:00"),
  A(BOT, "A_08", "优化本体想关单", x => ({ ticketNo: x.no }), rej("PERMISSION_DENIED", "优化本体无权关闭")),
  A(SUP, "A_08", "优化主管关闭工单", x => ({ ticketNo: x.no }), ok("工单已关闭", (r, x, w, t) => t.eq("状态", r.result.status, "已关闭"))),
  A(KNW, "A_09", "知识维护人入库，但没填适用条件", x => ({ effectNo: x.e2.effectNo, applicability: { rat: "LTE" } }), rej("APPLICABILITY_REQUIRED", "缺适用条件，拒绝入库")),
  A(KNW, "A_09", "知识维护人填写适用条件后入库", x => ({ effectNo: x.e2.effectNo, applicability: APPLIC }), ok("案例入库：有效可复现、未验证", (r, x, w, t) => t.eq("结论、验证状态", [r.result.outcome, r.result.validation], ["有效可复现", "未验证"]))),
  V(ENGR, "重开系统后读回：工单、方案、效果、案例一致；天线工参 as-of 读回回填前后", (x, w, t) => {
    const tk = w.app.store.doc("OT_TICKET", x.no);
    t.eq("工单、周边影响、效果状态", [tk.status, w.app.store.doc("OT_PLAN", x.planNo).impact.result, w.app.store.doc("OT_EFFECT", x.e2.effectNo).status], ["已关闭", "通过", "持续有效"]);
    t.eq("天线 as-of：回填前 3°，回填后 4°", [w.app.facts.antennaState(AN, "2026-09-13T00:00:00").antenna.mechTilt, w.app.facts.antennaState(AN, FE.receivedAt).antenna.mechTilt], [FE.fromValue, FE.toValue]);
    t.eq("第 1 轮根因保持不变（历史不覆盖）", tk.rootCauses.length, 1);
  }),
  V("MR 平台", "9 月 29 日起该小区弱覆盖复发：新到达一周 MR 日统计", (x, w, t) => { ingestMR(w, burst(X, ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"], 0.35)); t.ok("新 MR 入库", w.app.store.getObject("OT_CELL_MR", `${X}@2026-10-05`) !== null, "未入库"); }),
  at("2026-10-06T09:00:00", "10 月 6 日"),
  A(BOT, "A_01", "优化本体对复发的小区建单", { cellKey: X }, ok("新建 -002 号工单并关联原单，原单保持已关闭", (r, x, w, t) => t.eq("编号尾号、关联原单、原单状态、RT_07", [r.result.ticketNo.endsWith("-002"), r.result.relatedTicketNo, w.app.store.doc("OT_TICKET", x.no).status, w.app.store.links({ rt: "RT_07", from: "OT_TICKET:" + r.result.ticketNo }).length], [true, x.no, "已关闭", 1]))),
], { spec: ["TC01", "TC04a", "TC05a", "TC07a", "TC07f"] });

def("BD-18", "未达标：占比降下来但仍有 3 天命中，进入下一轮", `${ENGR}／优化本体`, `${nS} 缺口较大，一轮调整后弱覆盖占比降够了，但后窗仍有 3 天命中，状态“未达标”，工单转“改善未解决”，进入下一轮。`, "清晨", [
  A(BOT, "A_01", `对 ${nS} 建单`, { cellKey: SIM }, ok("建单成功", (r, x) => { x.no = r.result.ticketNo; })),
  A(BOT, "A_02", "优化本体按规则定因", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_08 命中", (r, x, w, t) => t.eq("F_08", r.result.f08, "命中"))),
  A(ENG, "A_03", "工程师确认", x => ({ ticketNo: x.no, decision: "确认" }), ok("已确认")),
  A(BOT, "A_04", "优化本体生成机械下倾方案（第 1 轮）", x => ({ ticketNo: x.no, adjustType: "机械" }), ok("方案待确认", (r, x) => { x.planNo = r.result.planNo; })),
  at("2026-10-24T09:00:00", "10 月 24 日"),
  A(ENG, "A_05", "工程师批准并派单（只涉及 1 个小区，无须主管追加批准）", x => ({ planNo: x.planNo, decision: "批准", approvals: [{ role: ENGR }], executor: { role: "现场维护人员", name: FE.executor } }), ok("派单成功", (r, x) => { x.dispatchNo = r.result.dispatchNo; })),
  at("2026-10-26T10:00:00", "10 月 26 日回填"),
  A(FLD, "A_06", "现场回填：机械下倾调到 4°", x => ({ planNo: x.planNo, dispatchNo: x.dispatchNo, executeTime: "2026-10-26T09:30:00", receipt: "成功", actualValues: [{ targetKey: ASIM, param: "mechTilt", value: 4 }] }), ok("已实施")),
  V("MR 平台", "实施后一周的 MR 日统计到达：占比降下来，但有 3 天仍然很高", (x, w, t) => { const days = ["2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"], pairs = [[2143, 7216], [2087, 7088], [2121, 7302], [713, 7154], [689, 6932], [731, 7240], [702, 7011]]; ingestMR(w, days.map((d, i) => ({ cellKey: SIM, date: d, sampleWeak: pairs[i][0], sampleTotal: pairs[i][1], receivedAt: addDays(d, 1) + "T06:20:11" }))); t.ok("后窗 7 天入库", w.app.store.getObject("OT_CELL_MR", `${SIM}@2026-11-02`) !== null, "未入库"); }),
  at("2026-11-03T09:00:00", "11 月 3 日"),
  A(BOT, "A_07", "优化本体写入效果", x => ({ planNo: x.planNo }), ok("“未达标”：占比改善但后窗仍命中 3 天；工单改善未解决", (r, x, w, t) => t.eq("状态、改善、达标、后窗命中天数、工单状态", [r.result.status, r.result.improved, r.result.achieved, r.result.afterHitDays, w.app.store.doc("OT_TICKET", x.no).status], ["未达标", true, false, 3, "改善未解决"]))),
  Q(ENGR, `${nS} 下一步该做什么？`, { intent: "todo", has: ["A_04", "改善未解决", "优化本体"] }),
  A(BOT, "A_04", "优化本体生成下一轮方案", x => ({ ticketNo: x.no, adjustType: "机械" }), ok("R2 方案生成，R1 保留", (r, x, w, t) => t.ok("方案号以 -R2 结尾且 R1 仍在", r.result.planNo.endsWith("-R2") && !!w.app.store.doc("OT_PLAN", x.planNo), r.result.planNo))),
  A(BOT, "A_04", "优化本体又想出一轮", x => ({ ticketNo: x.no, adjustType: "机械" }), rej("ROUND_IN_PROGRESS", "R2 还没结束")),
], { spec: ["TC07e"], start: OCT, data: "庙镇新村NF02H_126 的目标覆盖半径改为 300 m", seed: s => { s.cells.find(c => c.cellKey === SIM).targetRadius = 300; } });

def("BD-19", "劣化：目标改善但同天线小区变差，不能当成功案例", `${ENGR}／优化专家／优化主管`, `调整后 ${nX} 弱覆盖改善，但同天线的 ${nY} 弱覆盖占比上升，保护指标不通过：状态“劣化”，不能关单，案例仍要入库并记“无效”。`, "已回填", [
  at("2026-09-22T09:00:00", "实施后一周"),
  A(BOT, "A_07", "优化本体写入效果", x => ({ planNo: x.planNo }), ok("“劣化”：目标改善且达标，保护指标不通过", (r, x, w, t) => { x.e1 = r.result; t.eq("状态、保护指标、改善、达标、工单状态", [r.result.status, r.result.protectionOk, r.result.improved, r.result.achieved, w.app.store.doc("OT_TICKET", x.no).status], ["劣化", false, true, true, "改善未解决"]); })),
  Q(ENGR, "邻区有没有变差？", { intent: "effect", has: ["劣化", "有恶化", `MR弱覆盖占比(${nY})`] }),
  Q(ENGR, "能关单吗？", { intent: "close", has: ["暂不能关闭", "INV_10"] }),
  A(SUP, "A_08", "优化主管想关单", x => ({ ticketNo: x.no }), rej("INV_10", "效果不是持续有效，不得关单")),
  Q(ENGR, "如果调坏了怎么办？", { intent: "rollback", has: ["回退值 3°", "劣化", "A_10"] }),
  A(ENG, "A_10", "工程师想执行回退", x => ({ planNo: x.planNo }), rej("DEFINED_ONLY", "回退动作本期只定义、不运行")),
  A(KNW, "A_09", "知识维护人入库但缺适用条件", x => ({ effectNo: x.e1.effectNo, applicability: { rat: "LTE" } }), rej("APPLICABILITY_REQUIRED")),
  A(EXPERT, "A_09", "优化专家补全适用条件后入库", x => ({ effectNo: x.e1.effectNo, applicability: APPLIC }), ok("案例入库：结论“无效”", (r, x, w, t) => t.eq("结论", r.result.outcome, "无效"))),
], { spec: ["TC02d"], data: "崇贤达NF08H_223 在 9 月 15 日～21 日的弱覆盖占比调为 15%", seed: s => { s.cellMR.filter(m => m.cellKey === Y && m.date >= "2026-09-15" && m.date <= "2026-09-21").forEach(m => { m.sampleWeak = Math.round(m.sampleTotal * 0.15); }); } });

def("BD-20", "后窗 MR 不足 7 天：效果待评估，不得关单", `${ENGR}／优化主管`, "实施后才过了 4 天，只到了 3 天 MR：系统不勉强给结论，效果“待评估”，各判定为空，工单不动。", "已回填", [
  at("2026-09-18T09:00:00", "实施后第 4 天"),
  Q(ENGR, "效果怎么样？", { intent: "effect", has: ["尚无效果评估", "后窗至少 7 天"] }),
  A(BOT, "A_07", "优化本体尝试写入效果", x => ({ planNo: x.planNo }), ok("效果“待评估”：后窗只有 3 天，各判定为空", (r, x, w, t) => t.eq("状态、后窗天数、改善、达标、持续有效", [r.result.status, r.result.daysAfter, r.result.improved, r.result.achieved, r.result.sustained], ["待评估", 3, null, null, null]))),
  Q(ENGR, "效果怎么样？", { intent: "effect", has: ["待评估", "后窗"] }),
  A(SUP, "A_08", "优化主管想关单", x => ({ ticketNo: x.no }), rej("INV_10")),
], { spec: ["TC03e"] });

def("BD-21", "保护指标缺数据：效果待评估", ENGR, `${NAME(Z2)} 后窗没有实测重叠覆盖度，保护指标没法判断：系统不当作“通过”，效果“待评估”。`, "已回填", [
  at("2026-09-22T09:00:00", "实施后一周"),
  A(BOT, "A_07", "优化本体写入效果", x => ({ planNo: x.planNo }), ok("“待评估”：保护指标缺数据，protectionOk 为空", (r, x, w, t) => t.eq("状态、保护指标", [r.result.status, r.result.protectionOk], ["待评估", null]))),
  A(SUP, "A_08", "优化主管想关单", x => ({ ticketNo: x.no }), rej("INV_10")),
], { spec: ["TC03e"], data: "陈家镇东NF02H_87 在 9 月 15 日～21 日没有实测重叠覆盖度", seed: s => { s.cellMetrics = s.cellMetrics.filter(m => !(m.cellKey === Z2 && m.date >= "2026-09-15" && m.date <= "2026-09-21")); } });

def("BD-22", "第二周又有 3 天命中：不是持续有效，不得关单", `${ENGR}／优化主管`, "第 1 周效果不错，但第二周又有 3 天弱覆盖占比高，系统判“改善”而不是“持续有效”，不能关单。", "第1周已评估", [
  at("2026-09-29T09:00:00", "实施后两周"),
  A(BOT, "A_07", "优化本体写入第 2 周效果", x => ({ planNo: x.planNo }), ok("“改善”：达标但持续有效为否", (r, x, w, t) => t.eq("达标、持续有效、状态", [r.result.achieved, r.result.sustained, r.result.status], [true, false, "改善"]))),
  Q(ENGR, "第二周有复发吗？", { intent: "effect", has: ["持续有效否", "改善"] }),
  A(SUP, "A_08", "优化主管想关单", x => ({ ticketNo: x.no }), rej("INV_10", "持续有效为否，不得关单")),
  Q(ENGR, "能关单吗？", { intent: "close", has: ["暂不能关闭", "持续有效为false"] }),
], { spec: ["TC07f"], data: "崇贤达NF02H_222 在 9 月 23、25、27 日的弱覆盖占比为 31%", seed: s => { s.cellMR.filter(m => m.cellKey === X && ["2026-09-23", "2026-09-25", "2026-09-27"].includes(m.date)).forEach(m => { m.sampleWeak = Math.round(m.sampleTotal * 0.31); }); } });

def("BD-23", "案例复用：新小区引用崇明案例，只作参考不照搬", `${ENGR}／知识维护人`, "崇明案例入库后，庙镇新村出现同类问题：适用条件一致的案例作为参考挂到方案上，幅度仍由函数按本小区缺口计算；条件不一致（5G）的不得复用。", "已关单入库", [
  at(OCT, "10 月 23 日"),
  F(ENGR, "打开崇明崇贤达NF02H_222 的已关闭工单", "no"),
  Q(ENGR, `${nS} 能参考崇明的案例吗？`, { intent: "case.match", has: ["条件一致", "只作参考，不照搬幅度", "有效可复现"] }),
  Q(ENGR, `${NAME(N1)} 也能参考吗？`, { intent: "case.match", has: ["不匹配", "制式：本小区 NR，案例 LTE", "不得复用"] }),
  A(BOT, "A_01", `对 ${nS} 建单`, { cellKey: SIM }, ok("建单成功", (r, x) => { x.sim = r.result.ticketNo; })),
  A(BOT, "A_02", "优化本体按规则定因", x => ({ ticketNo: x.sim, mode: "rule" }), ok("F_08 命中")),
  A(ENG, "A_03", "工程师确认", x => ({ ticketNo: x.sim, decision: "确认" }), ok("已确认")),
  F(ENGR, `打开 ${nS} 的工单`, "sim"),
  Q(ENGR, "一次调多少？要分几轮？", { intent: "plan", has: ["若生成方案", "机械下倾 Δ＝", "共 2 轮"] }),
  A(BOT, "A_04", "优化本体生成方案", x => ({ ticketNo: x.sim, adjustType: "机械" }), ok("引用 1 个案例；Δ＝2°，共 2 轮，周边影响通过", (r, x, w, t) => { x.simPlan = r.result.planNo; t.eq("缺口、Δ、轮数、周边影响", [r.result.gap, r.result.delta, r.result.rounds, r.result.impact], [EXP.sim.tilt.gap, 2, EXP.sim.tilt.rounds, "通过"]); t.eq("引用的案例（RT_15）", [r.result.caseRefs.map(c => c.caseNo), w.app.store.links({ rt: "RT_15", to: "OT_PLAN:" + x.simPlan }).length], [[x.caseNo || r.result.caseRefs[0].caseNo], 1]); t.eq("幅度不照搬案例（案例 +1°，本方案 +2°）", [w.app.store.doc("OT_PLAN", x.simPlan).actions[0].deltaValue, r.result.caseRefs[0].outcome], [2, "有效可复现"]); })),
  Q(ENGR, `${nS} 的方案引用了案例吗？`, { intent: "case", has: ["引用了 1 个案例", "RT_15"] }),
  Q(ENGR, "这个方案是第几轮？一次调多少？", { intent: "plan", has: ["共需 2 轮", "本方案是第 1 轮"] }),
], { spec: ["TC06a"] });

const DENY = [["现场维护人员", ["A_01", "A_03", "A_04", "A_05", "A_07", "A_08", "A_09", "A_11"]], ["优化本体", ["A_03", "A_05", "A_06", "A_08", "A_09", "A_10", "A_11"]], ["优化主管", ["A_01", "A_04", "A_05", "A_09"]], [ENGR, ["A_04", "A_08", "A_09"]], ["知识维护人", ["A_01", "A_03", "A_08"]], ["优化专家", ["A_01", "A_04", "A_05", "A_08"]]];
def("BD-24", "权限矩阵：每个角色只能做 SPEC 允许的动作", "全部角色", "SPEC 为每个动作规定了允许的角色，越权一律拒绝并留痕。这里逐个角色逐个动作验证：不在允许范围内的组合全部被拒绝，被拒绝的动作不改变任何记录。", "已关单入库", [
  ...DENY.flatMap(([role, acts]) => acts.map(a => A({ role }, a, `${role} 越权执行 ${a}`, x => ({ ticketNo: x.no, planNo: x.planNo, effectNo: x.e2 && x.e2.effectNo, cellKey: X, antennaId: AN, decision: "确认", applicability: APPLIC, chosenSource: "回填", reason: "越权测试", approvals: [] }), rej("PERMISSION_DENIED")))),
  V("系统", "矩阵核对：SPEC 11 个动作 × 6 个角色，凡不在允许范围内的组合都被拒绝，且没有改变任何业务记录", (x, w, t) => {
    const roles = ["优化本体", ENGR, "优化主管", "现场维护人员", "优化专家", "知识维护人"], before = ["OT_TICKET", "OT_PLAN", "OT_EFFECT", "OT_CASE"].map(k => w.app.store.count(k)); let n = 0, bad = [];
    for (const a of w.app.ont.raw.actions) for (const r of roles) if (!a.roles.includes(r)) { n++; const res = w.app.act(a.id, {}, { role: r }); if (res.ok || res.code !== "PERMISSION_DENIED") bad.push(r + "/" + a.id); }
    t.ok(`${n} 个越权组合全部被拒绝`, n > 0 && bad.length === 0, bad.join("、")); t.eq("工单、方案、效果、案例数量不变", ["OT_TICKET", "OT_PLAN", "OT_EFFECT", "OT_CASE"].map(k => w.app.store.count(k)), before);
  }),
], { spec: ["TC07b"] });

def("BD-25", "上游数据更正：已建工单的发现快照不变", `${ENGR}／优化本体`, "MR 平台事后更正了某一天的数据。已建工单仍按当时引用的版本读回；重新发现用新数据，结论可能变化；MR 日统计只追加版本，不就地改写。", "工单待核验", [
  Q(ENGR, `${nX} 9月6日的MR是多少`, { intent: "mr.day", has: ["1 个版本"] }),
  V("MR 平台", "MR 平台更正 9 月 6 日的数据：弱覆盖采样点降到 1900（低于门限 2000）", (x, w, t) => { const o = w.app.store.doc("OT_CELL_MR", `${X}@2026-09-06`); ingestMR(w, [{ cellKey: X, date: "2026-09-06", sampleTotal: o.sampleTotal, sampleWeak: 1900, receivedAt: "2026-09-11T10:00:00" }]); t.eq("版本 1、2 都在", w.app.store.history("OT_CELL_MR", `${X}@2026-09-06`).map(h => h.ver), [1, 2]); }),
  Q(ENGR, `${nX} 9月6日的MR是多少`, { intent: "mr.day", has: ["1900", "2 个版本"] }),
  V(ENGR, "重新发现：崇贤达NF02H_222 命中变成 6 天（仍达到）；已建工单快照不变（7 天、引用版本 1）", (x, w, t) => {
    const r = w.app.svc.scan([X], w.app.store.peekNow()).items[0], tk = w.app.store.doc("OT_TICKET", x.no);
    t.eq("重新发现", [r.verdict, r.hitDays], ["达到派单条件", 6]); t.eq("已建工单快照", [tk.discovery.hitDays, tk.discovery.evidenceRefs.find(m => m.mrKey === `${X}@2026-09-06`).version], [7, 1]);
  }),
  Q(ENGR, `${nX} 这张工单的发现依据有哪些MR？`, { intent: "ticket.evidence", has: ["7 条 OT_CELL_MR", "只产生新版本"] }),
  V("系统", "MR 日统计不允许就地改写（INV_17）", (x, w, t) => { let code; try { w.app.store.overwrite("OT_CELL_MR", `${X}@2026-09-06`); } catch (er) { code = er.code; } t.eq("拒绝码", code, "INV_17"); }),
], { spec: ["TC01a", "TC08"] });

def("BD-26", "关系变了判断跟着变：同天线小区改挂别的天线", ENGR, `${nY} 改挂另一副天线后，机械下倾只影响 ${nX} 一个小区，同样的方案变成“通过”，新建工单里它也不再是同天线小区。`, "已确认", [
  A(BOT, "A_04", "优化本体生成机械下倾方案", x => ({ ticketNo: x.no, adjustType: "机械" }), ok("周边影响通过，范围只含 1 个小区", (r, x, w, t) => { x.planNo = r.result.planNo; t.eq("周边影响", r.result.impact, "通过"); })),
  Q(ENGR, "这个方案涉及几个小区？", { intent: "impact", has: ["涉及 1 个小区"] }),
  V(ENGR, "核对：工单里 RT_06 没有“同天线小区”", (x, w, t) => t.eq("同天线小区数", w.app.store.links({ rt: "RT_06", from: "OT_TICKET:" + x.no }).filter(l => l.props.role === "同天线小区").length, 0)),
], { spec: ["TC02f"], data: "崇贤达NF08H_223 的目标覆盖半径改为 560 m，并改挂另一副天线", seed: s => { s.cells.find(c => c.cellKey === Y).targetRadius = 560; s.cellAntenna.find(c => c.cellKey === Y).antennaId = S.AZ2 || s.cellAntenna.find(c => c.cellKey === Z2).antennaId; } });

def("BD-27", "改名不改写历史：小区更名后工单仍指向同一小区", "网管维护", "小区名称被网管改了，cellKey 不变：已建工单仍指向同一个小区，对象历史版本里仍是旧名称。", "工单待核验", [
  V("网管", "小区名称改为“崇贤达NF02H_222（改名）”", (x, w, t) => { const c = w.app.store.doc("OT_CELL", X); x.old = c.cellName; w.app.store.putObject("OT_CELL", X, { ...c, cellName: c.cellName + "（改名）" }); t.eq("历史第 1 版仍是旧名称", [w.app.store.history("OT_CELL", X)[0].doc.cellName, w.app.store.doc("OT_CELL", X).cellName], [nX, nX + "（改名）"]); }),
  V(ENGR, "核对：工单仍指向同一个 cellKey，工单内容没有被改写", (x, w, t) => t.eq("工单对应的小区", w.app.facts.cellOfTicket(x.no), X)),
  V("系统", "对象版本不允许就地改写（INV_11）", (x, w, t) => { let code; try { w.app.store.overwrite("OT_PLAN", "PL-不存在"); } catch (er) { code = er.code; } t.ok("拒绝就地改写", code === "INV_11", String(code)); }),
], { spec: ["TC04c"] });

def("BD-28", "目标覆盖半径缺失：不静默套用默认值，补录留痕后重新定因", `${ENGR}／优化专家`, "小区的目标覆盖半径没有填：F_08、F_10 返回“未知”，不会悄悄用默认值；工程师参照 RULE_G01 的默认取法确认并补录（人工覆盖须留痕），再重新定因。", "工单待核验", [
  A(BOT, "A_02", "优化本体按规则定因", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_08＝未知，缺项 cell.targetRadius，不写根因", (r, x, w, t) => { t.eq("F_08、是否写根因", [r.result.f08, r.result.written], ["未知", false]); t.eq("缺项", w.app.store.doc("OT_TICKET", x.no).diagnostics.find(d => d.kind === "下倾角命中").result.missing, ["cell.targetRadius"]); })),
  Q(ENGR, "目标覆盖半径默认怎么取？", { intent: "radius", has: ["目标覆盖半径缺失", "返回“未知”", "不会静默套用默认值", "RULE_G01", "TH14"] }),
  V(ENGR, "工程师确认按 500 m 补录目标覆盖半径（人工覆盖，留下新版本）", (x, w, t) => { w.app.store.putObject("OT_CELL", X, { ...w.app.store.doc("OT_CELL", X), targetRadius: 500 }); t.eq("小区对象有 2 个版本，最新版目标半径 500", [w.app.store.history("OT_CELL", X).length, w.app.store.doc("OT_CELL", X).targetRadius], [2, 500]); }),
  A(BOT, "A_02", "优化本体重新定因", x => ({ ticketNo: x.no, mode: "rule" }), ok("F_08 命中，根因第 1 轮写入", (r, x, w, t) => t.eq("F_08、是否写根因", [r.result.f08, r.result.written], ["命中", true]))),
], { spec: ["TC03a"], data: "崇贤达NF02H_222 的目标覆盖半径为空", seed: s => { delete s.cells.find(c => c.cellKey === X).targetRadius; } });

def("BD-29", "基础数据不全：小区没有关联站点或根本不存在，不建单", ENGR, "小区在资源数据里没有关联站点（站点类型未知）时无法选规则，不建单；对不存在的小区更是直接拒绝。", "清晨", [
  A(BOT, "A_01", `对没有关联站点的 ${nX} 建单`, { cellKey: X }, rej("INV_01", "站点类型未知，不建单")),
  A(ENG, "A_01", "工程师对一个不存在的小区标识建单", { cellKey: "LTE:99999999" }, rej("NOT_FOUND", "小区不存在")),
  V(ENGR, "核对：没有产生任何工单，两次拒绝都留有审计", (x, w, t) => { t.eq("工单数", w.app.store.count("OT_TICKET"), 0); t.ok("审计里有 2 条拒绝", w.app.store.runs().filter(r => r.outcome === "rejected").length === 2, "审计数量不符"); }),
], { spec: ["TC07a"], data: "崇贤达NF02H_222 没有关联站点", seed: s => { s.cellSite = s.cellSite.filter(c => c.cellKey !== X); } });

module.exports = { CASES };
