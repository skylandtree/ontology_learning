// 问答场景：一组按业务顺序提出的问题，在“崇明崇贤达 NF02H_222 已走到第 1 周效果评估”的状态上作答，中途由人工角色执行需要人工的动作。
// 每条问题给出预期意图、答案必须包含的事实（数值取自独立预期 expected.json 或种子数据）与数值落地检查；各要素是否被问答覆盖由追踪器统计。
const { createQA } = require("./qa.js"), { tracker } = require("./tracker.js");
const S = require("./scenarios.js"), { EXP, SEED, fresh, Ctx, NAME, X, Y, Z1, SIM, N1, BAO, C4, SUP, KNW, APPLIC, FE } = S;
const e = EXP.chm, nX = NAME(X), nY = NAME(Y), nZ1 = NAME(Z1), nS = NAME(SIM), nN1 = NAME(N1), nB = NAME(BAO), nC4 = NAME(C4);
const sepC = EXP.scanSepCounts, octC = EXP.scanOctCounts, ck = e.impact.checks, pct = v => (v * 100).toFixed(2) + "%";
const cell = SEED.cells.find(c => c.cellKey === X), ant = SEED.antennas.find(a => a.antennaId === S.AN), mrX = SEED.cellMR.find(m => m.cellKey === X && m.date === "2026-09-05");

// h＝人工角色执行动作；at＝推进时钟（MR 日统计随时钟自动到达）
const STEPS = [
  { q: "SPEC 定义了哪些对象类型？", intent: "meta.list", has: ["9 个对象类型", "OT_CELL_MR", "OT_TICKET"] },
  { q: "有哪些关系类型？", intent: "meta.list", has: ["17 个关系类型", "RT_17"] },
  { q: "有哪些函数？", intent: "meta.list", has: ["12 个函数", "F_12"] },
  { q: "动作有哪些？", intent: "meta.list", has: ["11 个动作类型", "A_11"] },
  { q: "核心约束有哪些？", intent: "meta.list", has: ["17 个核心约束", "INV_17"] },
  { q: "业务规则有哪些？", intent: "meta.list", has: ["RULE_F01", "RULE_M03"] },
  { q: "测试假设有哪些？", intent: "meta.list", has: ["12 个测试假设", "TH16"] },
  { q: "OT_CELL_MR 是什么？", intent: "meta.element", has: ["小区日MR统计", "mrKey"] },
  { q: "RT_17 是什么关系？", intent: "meta.element", has: ["发现依据", "OT_TICKET→OT_CELL_MR"] },
  { q: "F_12 做什么？", intent: "meta.element", has: ["scanWeakCells", "只读"] },
  { q: "A_10 能执行吗？", intent: "meta.element", has: ["本期只定义"] },
  { q: "INV_16 说什么？", intent: "meta.element", has: ["问题须由前置数据发现"] },
  { q: "RULE_M02 是什么规则？", intent: "meta.element", has: ["只登记"] },
  { q: "RULE_W03 呢？", intent: "meta.element", has: ["只登记", "用户数"] },
  { q: "TH14 是什么假设？", intent: "meta.element", has: ["目标半径系数"] },
  { q: "工单有哪些状态，怎么转移？", intent: "meta.states", has: ["待核验", "已关闭", "A_08"] },
  { q: "派单规则的门限是多少？", intent: "rule.dispatch", has: ["RULE_D01", "2000", "20.00%", "500", "15.00%", "规则缺口"] },
  { q: "容差和单次上限、分辨率是多少？", intent: "th.params", has: ["TH01", "0.5°", "TH02", "2°", "TH03"] },
  { q: "9月11日哪些小区弱覆盖？", intent: "scan", has: [`达到 ${sepC.达到}`, `未达到 ${sepC.未达到}`, `证据不足 ${sepC.证据不足}`, "数据缺口", "规则缺口"] },
  { q: `${nX} 为什么被判定弱覆盖？逐日占比多少？`, intent: "discover.cell", has: ["RULE_D01", "命中 7 天", "达到派单条件", "9月4日"] },
  { q: `${nX} 9月5日的MR是多少`, intent: "mr.day", has: [String(mrX.sampleWeak), String(mrX.sampleTotal), "1 个版本"] },
  { q: `${nC4} 的发现判定`, intent: "discover.cell", has: ["证据不足", "未知 2 天", "无数据"] },
  { q: `${nX} 是什么小区？天线和邻区是什么`, intent: "cell.info", has: [S.AN, String(ant.height), nY, nZ1, "RT_04"] },
  { q: "崇明那张工单现在什么状态", intent: "ticket.overview", has: ["已改善", "命中 7 天", "7 条 MR 日统计"] },
  { q: "这张工单的发现依据有哪些MR？", intent: "ticket.evidence", has: ["7 条 OT_CELL_MR", "只产生新版本"] },
  { q: "它的根因是什么？", intent: "cause", has: [String(e.tilt.gap), String(e.tilt.thetaT), String(e.tilt.rFar), "命中", "RULE_W06"] },
  { q: "有告警吗，会不会是假性弱覆盖？", intent: "falseweak", has: ["部分重合", "14.29%", "BASE STATION INFORMATION"] },
  { q: "方案是什么？", intent: "plan", has: ["机械", `${FE.fromValue}° 调到 ${FE.toValue}°`, "Δ＝1°", "通过"] },
  { q: "周边影响怎么样？", intent: "impact", has: ["通过", `${ck[0].before}→${ck[0].after}`, `${ck[2].before}→${ck[2].after}`, `${S.AN}（主作用）`, `${nY}（受影响）`] },
  { q: "审批和派单情况？", intent: "approval", has: ["不得自动执行", "优化主管", "DP-PL"] },
  { q: "现场实际执行了什么？", intent: "execution", has: [`${FE.toValue}°`, "一致", `生效时间＝实施时间 ${FE.executeTime}`] },
  { q: "效果怎么样？", intent: "effect", has: [pct(e.beforeRatio), pct(e.afterRatio1), "改善", "持续有效为空"] },
  { q: "能关单吗？", intent: "close", has: ["暂不能关闭", "INV_10"] },
  { q: "下一步该做什么？", intent: "todo", has: ["A_08", "A_09"] },
  { q: "9月13日那天的天线下倾角是多少", intent: "asof", has: [`${FE.fromValue}°`, S.AN] },
  { q: "如果同天线小区目标半径改成560米，机械下倾会怎样？", intent: "whatif", has: ["不通过", "只读"] },
  { q: "如果改电子下倾呢？", intent: "whatif", has: ["通过", `${EXP.chmVariants.yTightElec.delta}°`] },
  { q: "目标覆盖半径默认怎么取？", intent: "radius", has: [`${cell.targetRadius} m`, "0.5"] },
  { q: "帮我把这张工单关单", intent: "human", has: ["须人工执行", "优化主管"], pending: ["A_08"] },
  { q: "请帮我审批这个方案", intent: "human", has: ["须人工执行", "地市优化工程师"], pending: ["A_05"] },
  { q: "这些数据哪些是真实的？", intent: "provenance", has: ["provenance.csv", "取自原文的关键事实"] },
  { at: "2026-09-29T09:00:00" },
  { q: `请对${nX}评估效果`, intent: "act.bot", has: ["A_07", "持续有效"], writes: 1 },
  { q: "现在能关单吗？", intent: "close", has: ["可由优化主管关闭"] },
  { h: ["A_08", c => ({ ticketNo: c.no }), SUP] }, { h: ["A_09", c => ({ effectNo: c.e2, applicability: APPLIC }), KNW] },
  { q: "案例库有哪些案例？", intent: "case", has: ["有效可复现", "未验证", "下倾角过小"] },
  { at: "2026-10-23T09:00:00" },
  { q: "10月份有哪些小区弱覆盖？", intent: "scan", has: [`达到 ${octC.达到}`, `未达到 ${octC.未达到}`, `证据不足 ${octC.证据不足}`, `${nB}：未达到派单条件`] },
  { q: `请对${nN1}建单`, intent: "act.bot", has: ["A_01", "新建工单"], writes: 1 },
  { q: "请对它定因", intent: "act.bot", has: ["A_02", "未写根因", "未知"], writes: 1 },
  { q: "它的根因是什么？", intent: "cause", has: ["F_08＝未知", "NR", "转人工"] },
  { q: `请对${nS}建单`, intent: "act.bot", has: ["A_01"], writes: 1 }, { q: "请对它定因", intent: "act.bot", has: ["A_02", "根因第 1 轮"], writes: 1 },
  { h: ["A_03", c => ({ ticketNo: c.sim, decision: "确认" }), { role: "地市优化工程师" }] },
  { q: "请对它生成方案", intent: "act.bot", has: ["A_04", "Δ 2°", "共 2 轮"], writes: 1 },
  { q: `${nS} 的方案引用了案例吗？`, intent: "case", has: ["引用了 1 个案例", "RT_15"] },
  { q: "杨浦那张工单是什么情况", intent: "scope.out", has: ["重叠覆盖", "不在本 SPEC 范围内"] },
  { q: "SHJIS 呢？", intent: "scope.out", has: ["切换", "不在本 SPEC 范围内"] },
  { q: "上海4张真实工单和本体发现的结果对账一下", intent: "reconcile", has: ["SHCHM", "与真实派单一致", "SHBAO", pct(EXP.bao.weakRatio), "口径与上海原工单不同"] },
  { q: "本体里有多少工单？", intent: "stats", has: ["工单 3 张"] },
  { q: "现在有工参冲突吗？", intent: "conflict", has: ["当前没有未裁定的工参冲突", "INV_15"] },
  { q: "崇明那张工单的审计记录和时间线", intent: "timeline", has: ["A_01", "A_08"] },
  { q: "今天天气怎么样？", intent: "fallback", has: ["超出了本体与 SPEC 的范围"] },
];

// 问答世界：崇明崇贤达 NF02H_222 已走到第 1 周效果评估（工单已改善、持续有效为空），其余小区只有前置数据
function qaWorld() {
  const w = fresh(SEED), cc = new Ctx("w", "w", []), { no, planNo } = S.toPlan(cc, w);
  w.at("2026-09-12T09:00:00"); const d = S.dispatch(cc, w, planNo).dispatchNo; w.at(FE.receivedAt); S.execute(cc, w, planNo, d);
  w.at("2026-09-22T09:00:00"); w.act("A_07", { planNo }, { role: "优化本体" });
  return { app: w, no, planNo };
}
function runQAEval() {
  const rows = [], c = new Ctx("QA", "问答评测", []);
  tracker.with("qa", "QA", () => {
    const { app: w, no, planNo } = qaWorld(), qa = createQA(w), cx = { no, planNo, e2: null, sim: null };
    for (const s of STEPS) {
      if (s.at) { w.at(s.at); continue; }
      if (s.h) { const r = w.act(s.h[0], s.h[1](cx), s.h[2]); rows.push({ q: "（人工执行）" + s.h[0], intent: "—", text: r.ok ? "成功 " + JSON.stringify(r.result) : "拒绝 " + r.code, human: true }); c.ok("人工执行 " + s.h[0], r.ok, r.msg); continue; }
      const before = w.store.runs().length, r = qa.ask(s.q);
      if (r.intent === "act.bot" && /评估效果/.test(s.q)) cx.e2 = w.store.list("OT_EFFECT").pop().effectNo;
      const t = w.store.list("OT_TICKET").find(x => x.ticketNo.includes(SIM.slice(SIM.indexOf(":") + 1))); if (t) cx.sim = t.ticketNo;
      const miss = (s.has || []).filter(x => !r.text.includes(x)), writes = w.store.runs().length - before;
      c.ok("[" + s.intent + "] " + s.q, r.intent === s.intent && miss.length === 0 && r.grounded.ok && (s.writes === undefined ? writes === 0 : writes === s.writes) && (!s.pending || s.pending.every(a => (r.pending || []).includes(a))),
        "意图 " + r.intent + "（预期 " + s.intent + "）；缺少 " + JSON.stringify(miss) + "；未落地数值 " + JSON.stringify(r.grounded.ungrounded) + "；写入 " + writes + "；答案：" + r.text.slice(0, 220));
      rows.push({ q: s.q, intent: r.intent, text: r.text, grounded: r.grounded, pending: r.pending, writes, refs: r.refs });
    }
  });
  return { c, rows };
}
module.exports = { STEPS, runQAEval, qaWorld };
