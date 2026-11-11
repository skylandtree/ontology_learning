// 业务问答用例：业务人员在日常工作中怎么问，系统怎么答。每个用例是一段多轮对话，带提问者的角色，口语化提问，
// 中间穿插该角色在系统里的操作（确认、批准、回填……）；回答必须来自本体里的对象、关系、函数结果和 SPEC 定义，数值与日期都经落地检查。
const { at, A, Q, V, F, ok, rej, ingestMR, BOT, ENG, SUP, FLD, KNW, S } = require("./framework.js");
const { addDays } = require("../../src/facts.js");
const burst = (cell, dates, ratio, base = 7000) => dates.map((date, i) => { const total = base + ((i * 211 + 97) % 530), r = ratio + (((i * 7) % 5) - 2) * 0.006; return { cellKey: cell, date, sampleTotal: total, sampleWeak: Math.round(total * r), receivedAt: addDays(date, 1) + "T06:20:11" }; });
const { EXP, FE, EXEC, X, Y, SIM, N1, C3, C4, C8, Z2, AN, NAME, OCT, APPLIC } = S;
const e = EXP.chm, nX = NAME(X), nY = NAME(Y), nS = NAME(SIM), nZ2 = NAME(Z2), sepC = EXP.scanSepCounts, octC = EXP.scanOctCounts, ck = e.impact.checks, pct = v => (v * 100).toFixed(2) + "%";
const ENGR = "地市优化工程师", MGR = "优化主管", FIELD = "现场维护人员";
const approve2 = [{ role: ENGR }, { role: MGR }];

const CASES = [];
const def = (id, title, role, scene, world, steps, o = {}) => CASES.push({ id, kind: "qa", title, role, scene, world, steps, ...o });

def("BQ-01", "问题发现：今天哪些小区弱覆盖、为什么没出来、建个单", ENGR, "工程师晨会前翻看当天的发现结果：哪些小区弱覆盖，某个小区为什么算（或为什么没出现在清单里），对达到的小区让系统建单，再追问建单后的状态。", "清晨", [
  Q(ENGR, "今天哪些小区弱覆盖？", { intent: "scan", has: [`达到 ${sepC.达到}`, `未达到 ${sepC.未达到}`, `证据不足 ${sepC.证据不足}`, "只读、不建单"] }),
  Q(ENGR, `${nX} 为什么算弱覆盖？`, { intent: "discover.cell", has: ["RULE_D01", "命中 7 天", "达到派单条件", "9月4日"] }),
  Q(ENGR, `${NAME(C8)} 怎么没出来？`, { intent: "discover.cell", has: ["无适用规则", "规则缺口", "证据不足"] }),
  Q(ENGR, `${nZ2} 为什么没算上`, { intent: "discover.cell", has: ["无数据", "未知 7 天", "证据不足"] }),
  Q(ENGR, `${nZ2} 的MR到齐了吗`, { intent: "arrival", has: ["已到 0 天", "没有任何 MR 日统计", "INV_09"] }),
  Q(ENGR, `帮我给${nX}建个单`, { intent: "act.bot", has: ["A_01", "新建工单", "待核验"], writes: 1 }),
  Q(ENGR, "它现在什么状态？", { intent: "ticket.overview", has: ["待核验", "RULE_D01", "命中 7 天"] }),
  Q(ENGR, "再给它建个单", { intent: "act.bot", has: ["该小区已有未关闭工单"], writes: 1 }),
  Q(ENGR, `${nY} 能建单吗？`, { intent: "can", has: ["不能", "命中 0 天", "INV_16"] }),
  Q(ENGR, `${NAME(C8)} 能建单吗？`, { intent: "can", has: ["不能", "规则缺口", "INV_09"] }),
  Q(ENGR, `请对${nY}建单`, { intent: "act.bot", has: ["被拒绝：INV_16"], writes: 1 }),
  Q(ENGR, "为什么建不了单？", { intent: "why.rejected", has: ["INV_16", "未达到派单条件", "下一步：继续观察"] }),
], { spec: ["TC10"] });

def("BQ-02", "接单核验：这张工单怎么回事、依据、根因、告警，能不能确认", ENGR, "工程师接到优化本体建好的工单：先问是什么情况和依据，让系统定因，再追问根因、告警和次因，最后问能不能直接确认并按提示自己确认。", "工单待核验", [
  Q(ENGR, "我今天有哪些待办？", { intent: "queue", has: ["待核验", "确认或排除"], pending: ["A_03"] }),
  Q(ENGR, "这张工单是什么情况？", { intent: "ticket.overview", has: ["待核验", "RULE_D01", "7 条 MR 日统计", "问题键"] }),
  Q(ENGR, "它的依据是哪些MR？", { intent: "ticket.evidence", has: ["7 条 OT_CELL_MR", "每条可展开到有效采样点"] }),
  Q(ENGR, "请对它定因", { intent: "act.bot", has: ["A_02", "根因第 1 轮"], writes: 1 }),
  Q(ENGR, "它的根因是什么？", { intent: "cause", has: [String(e.tilt.gap), String(e.tilt.thetaT), String(e.tilt.rFar), "命中", "RULE_W06"] }),
  Q(ENGR, "有告警吗，会不会是假性弱覆盖？", { intent: "falseweak", has: ["部分重合", "14.29%", "BASE STATION INFORMATION"] }),
  Q(ENGR, "功率和方位角有没有问题？", { intent: "cause.other", has: ["发射功率：现网", "覆盖方向：方位偏差", "周边遮挡：", "没有次因与主因并列"] }),
  Q(ENGR, "能直接确认吗？", { intent: "can", has: ["须在确认时写明复核判断"], pending: ["A_03"] }),
  Q(ENGR, "帮我确认", { intent: "human", has: ["A_03", "须人工执行", `你的角色“${ENGR}”在 SPEC 允许范围内`], pending: ["A_03"] }),
  A(ENG, "A_03", "工程师在工单页面写明复核意见后确认", x => ({ ticketNo: x.no, decision: "确认", reason: "复核：告警只覆盖 1 个命中日，不影响主因" }), ok("工单已确认")),
  Q(ENGR, "它现在什么状态？", { intent: "ticket.overview", has: ["已确认"] }),
  Q(ENGR, "下一步该做什么？", { intent: "todo", has: ["A_04", "优化本体"] }),
]);

def("BQ-03", "定因追问：为什么是下倾角、怎么算的、有几成把握", ENGR, "工程师对系统给出的根因不放心，追问推理过程：推荐下倾角怎么算的、缺口多大、有几成把握、功率方位遮挡排除了吗、目标半径怎么定的、5G 能不能这样判。", "已定因", [
  Q(ENGR, "为什么判断是下倾角过小？", { intent: "cause", has: ["命中", String(e.tilt.gap), "RULE_W06", "证据"] }),
  Q(ENGR, "推荐下倾角是怎么算出来的？", { intent: "explain.calc", has: ["θ_t", "arctan(38／500)", String(e.tilt.thetaT), String(e.tilt.gap), "TH01"] }),
  Q(ENGR, "这个判断有几成把握？", { intent: "confidence", has: ["没有定义“置信度”", "不给百分比", String(e.tilt.gap), "TH01"] }),
  Q(ENGR, "那功率、方位和遮挡呢？", { intent: "cause.other", has: ["发射功率", "覆盖方向", "周边遮挡"] }),
  Q(ENGR, `${nX} 的理论覆盖半径是多少？`, { intent: "explain.calc", has: ["近端", "远端", "TH15"] }),
  Q(ENGR, "目标覆盖半径是怎么定的？", { intent: "radius", has: ["500 m", "RULE_G01", "TH14"] }),
  Q(ENGR, "5G 小区能用这个方法判断吗？", { intent: "unsupported", has: ["NR", "未知", "不套用 LTE 公式"] }),
]);

def("BQ-04", "方案怎么出：机械还是电子、一次调多少、分几轮、对周边的影响", ENGR, "工程师确认根因后，在让系统出方案之前先比较各种做法：机械还是电子、一次调多少分几轮、如果同天线小区的目标半径更大会怎样；再让系统出方案并追问周边影响。", "已确认", [
  Q(ENGR, "现在该做什么？", { intent: "todo", has: ["A_04", "优化本体"] }),
  Q(ENGR, "一次调多少？要分几轮？", { intent: "plan", has: ["暂无方案", "机械下倾 Δ＝1°（共 1 轮）", "电子下倾 Δ＝1.3°（共 1 轮）", "单次上限"] }),
  Q(ENGR, "机械下倾和电子下倾哪个合适？", { intent: "compare", has: ["机械下倾：作用于整副天线", "电子下倾：只作用于", "周边影响“通过”", "SPEC 没有规定两者的优先顺序"] }),
  Q(ENGR, "如果同天线小区目标半径改成560米，机械下倾会怎样？", { intent: "whatif", has: ["不通过", "只读"] }),
  Q(ENGR, "如果改电子下倾呢？", { intent: "whatif", has: ["通过", `${EXP.chmVariants.yTightElec.delta}°`] }),
  Q(ENGR, "请对它生成电子下倾方案", { intent: "act.bot", has: ["A_04", "方案 PL-", "待确认"], writes: 1 }),
  Q(ENGR, "请对它再生成一次方案", { intent: "act.bot", has: ["被拒绝：ROUND_IN_PROGRESS"], writes: 1 }),
  Q(ENGR, "对周边有什么影响？", { intent: "impact", has: ["涉及 1 个小区", "电子下倾只影响对应阵列小区", "通过"] }),
  Q(ENGR, `会不会影响${nY}？`, { intent: "impact", has: [`${nY}不在本方案的作用范围内`, "电子下倾只作用于目标小区的阵列", "电子下倾只影响对应阵列小区", nX + "（主作用）"] }),
]);

def("BQ-05", "主管审批前：要我批什么、为什么、风险与回退、能不能自动下发", MGR, "优化主管打开待办，核对方案涉及几个小区、周边影响、回退条件，问清为什么要自己批；让系统代批只会得到提示，工程师提交后再回头看派单号。", "方案待确认", [
  Q(MGR, "有什么要我批的？", { intent: "queue", has: ["追加优化主管批准", "作用于 2 个小区"], pending: ["A_05"] }),
  Q(MGR, "这个方案涉及几个小区？", { intent: "impact", has: ["涉及 2 个小区", `${nX}（受影响）`, `${nY}（受影响）`] }),
  Q(MGR, "周边影响怎么样？", { intent: "impact", has: ["通过", `${ck[0].before}→${ck[0].after}`, `${ck[2].before}→${ck[2].after}`] }),
  Q(MGR, "为什么要我批？", { intent: "approval", has: ["作用于 2 个及以上小区", "优化主管批准（RULE_W14）"] }),
  Q(MGR, "回退条件是什么？如果调坏了怎么办？", { intent: "rollback", has: ["回退值 3°", "回退条件", "A_10", "本期只定义、不运行"] }),
  Q(MGR, "这个方案能自动下发到现场吗？", { intent: "approval", has: ["不得自动执行", "INV_05", "现场维护人员"] }),
  Q(MGR, "帮我批了吧", { intent: "human", has: ["A_05", "须人工执行", `你的角色“${MGR}”不在 SPEC 允许的角色内`], pending: ["A_05"] }),
  A(ENG, "A_05", "工程师提交，并附优化主管的追加批准", x => ({ planNo: x.planNo, decision: "批准", approvals: approve2, executor: { role: FIELD, name: FE.executor } }), ok("派单成功", (r, x, w, t) => t.eq("含主管批准", r.result.supervisor, true))),
  Q(MGR, "派单号是多少？", { intent: "approval", has: ["派单号 DP-", "优化主管", "已派单"] }),
  Q(MGR, "有什么要我批的？", { intent: "queue", has: ["没有待办"] }),
]);

def("BQ-06", "现场回填后核对：调完没有、和方案一致吗、下倾角现在多少", `${FIELD}／${ENGR}`, "现场维护人员先在待办里看到派单，调完回填；工程师随后核对：现场实际调到多少、是否与方案一致、天线现在的下倾角、回填前某天的值、什么时候能评估效果。", "已派单", [
  Q(FIELD, "我有哪些单子要回填？", { intent: "queue", has: ["待现场回填", "DP-"], pending: ["A_06"] }),
  at(FE.receivedAt, "现场回填时间"),
  A(FLD, "A_06", "现场维护人员回填：机械下倾 3°→4°", x => ({ planNo: x.planNo, dispatchNo: x.dispatchNo, executeTime: EXEC, receipt: "成功", actualValues: [{ targetKey: AN, param: FE.param, value: FE.toValue }] }), ok("已实施")),
  Q(ENGR, "调完了吗？现场实际调到多少？", { intent: "execution", has: [`${FE.toValue}°`, "一致", `实施时间 ${EXEC}`] }),
  Q(ENGR, "和方案一致吗？", { intent: "execution", has: ["一致", "已实施"].slice(0, 1) }),
  Q(ENGR, "天线现在的下倾角是多少？", { intent: "antenna.now", has: [`机械下倾 ${FE.toValue}°`, "总下倾 7°", "回填"] }),
  Q(ENGR, "9月13日那天的天线下倾角是多少", { intent: "asof", has: [`${FE.fromValue}°`, AN] }),
  Q(ENGR, "现在能评估效果吗？", { intent: "effect", has: ["尚无效果评估", "后窗至少 7 天", "持续有效看 14 天"] }),
], { spec: ["TC05a"] });

def("BQ-07", "效果跟踪：效果怎么样、邻区变差没有、能不能关单、第二周复发没有", ENGR, "实施后一周和两周，工程师分别问效果：前后窗占比、邻区有没有变差、还差什么才能关单、第二周有没有复发；第二周评估由优化本体执行。", "第1周已评估", [
  Q(ENGR, "效果怎么样？", { intent: "effect", has: [pct(e.beforeRatio), pct(e.afterRatio1), "改善", "持续有效为空", "均未恶化"] }),
  Q(ENGR, "邻区有没有变差？", { intent: "effect", has: ["均未恶化", `MR弱覆盖占比(${nY})`] }),
  Q(ENGR, "能关单吗？还差什么？", { intent: "close", has: ["暂不能关闭", "INV_10", "后窗满 14 天后再次评估"] }),
  at("2026-09-29T09:00:00", "实施后两周"),
  Q(ENGR, `请对${nX}评估效果`, { intent: "act.bot", has: ["A_07", "持续有效"], writes: 1 }),
  Q(ENGR, "第二周有复发吗？", { intent: "effect", has: ["持续有效是", "共 2 次评估"] }),
  Q(ENGR, "现在能关单吗", { intent: "close", has: ["可由优化主管关闭", "优化本体无权关闭"] }),
  Q(MGR, "有哪些工单可以关？", { intent: "queue", has: ["效果“持续有效”", "可以关闭"], pending: ["A_08"] }),
]);

def("BQ-08", "关单入库与案例复用：谁来关、谁来入库、新小区能不能参考", `${MGR}／知识维护人／${ENGR}`, "优化主管关单，知识维护人入库案例；之后庙镇新村出现类似问题，工程师问能不能参考崇明案例、5G 小区能不能、当时是怎么处理的。", "持续有效", [
  Q(MGR, "有哪些工单可以关？", { intent: "queue", has: ["持续有效", "可以关闭"], pending: ["A_08"] }),
  A(SUP, "A_08", "优化主管关闭工单", x => ({ ticketNo: x.no }), ok("工单已关闭")),
  Q("知识维护人", "现在还有待办吗？", { intent: "queue", has: ["已关闭", "案例待入库"], pending: ["A_09"] }),
  A(KNW, "A_09", "知识维护人填写适用条件后入库", x => ({ effectNo: x.e2.effectNo, applicability: APPLIC }), ok("案例入库", (r, x, w, t) => t.eq("结论", r.result.outcome, "有效可复现"))),
  Q("知识维护人", "案例库里有什么？", { intent: "case", has: ["案例库共 1 条", "有效可复现", "未验证", "下倾角过小"] }),
  at(OCT, "10 月 23 日"),
  Q(ENGR, `${nS} 能参考崇明的案例吗？`, { intent: "case.match", has: ["条件一致", "可以参考", "只作参考，不照搬幅度"] }),
  Q(ENGR, `${NAME(N1)} 也能参考吗？`, { intent: "case.match", has: ["不匹配", "制式：本小区 NR，案例 LTE", "不得复用"] }),
  Q(ENGR, "当时崇明那个案例是怎么处理的？", { intent: "case", has: ["增大机械下倾角", "Δ 1°", "有效可复现"] }),
]);

def("BQ-09", "为什么被拒绝：建不了单时怎么问、怎么看原因", ENGR, "工程师让系统建单被拒绝了，不知道为什么：追问原因，系统引用被拒绝的动作、约束原文和下一步；再看几个典型情形（命中天数不够、缺天、VIP 规则缺口）。", "清晨", [
  Q(ENGR, `请对${nY}建单`, { intent: "act.bot", has: ["被拒绝：INV_16"], writes: 1 }),
  Q(ENGR, "为什么建不了单？", { intent: "why.rejected", has: ["INV_16", "未达到派单条件", "问题须由前置数据发现", "下一步：继续观察"] }),
  Q(ENGR, `${NAME(C3)} 的发现判定`, { intent: "discover.cell", has: ["命中 2 天", "未达到派单条件"] }),
  Q(ENGR, `请对${NAME(C3)}建单`, { intent: "act.bot", has: ["被拒绝：INV_16"], writes: 1 }),
  Q(ENGR, `${NAME(C4)} 为什么没发现`, { intent: "discover.cell", has: ["证据不足", "未知 2 天", "无数据"] }),
  Q(ENGR, `请对${NAME(C4)}建单`, { intent: "act.bot", has: ["被拒绝：INV_09"], writes: 1 }),
  Q(ENGR, "怎么又拒绝了？", { intent: "why.rejected", has: ["INV_09", "证据不足", "补齐缺失的 MR"] }),
  Q(ENGR, `${NAME(C8)} 能建单吗？`, { intent: "can", has: ["不能", "规则缺口"] }),
]);

def("BQ-10", "越界请求：自动下发、调功率、加站、预测、范围外工单、5G", ENGR, "业务人员有时会提出 SPEC 之外的要求：自动下发调整、调功率、新建站点、预测趋势、处理杨浦的重叠覆盖工单、让系统直接关单。系统要明确说不能、说清依据，不乱答。", "方案待确认", [
  Q(ENGR, `请自动下发调整${nX} 的下倾角`, { intent: "approval", has: ["不得自动执行", "INV_05", "地市优化工程师确认并派单"] }),
  Q(ENGR, "帮我把功率调高两个dB", { intent: "unsupported", has: ["措施字典", "不会生成这类方案"] }),
  Q(ENGR, "新建一个站点解决吧", { intent: "unsupported", has: ["措施字典", "增大机械下倾角"] }),
  Q(ENGR, "预测下个月会不会继续恶化", { intent: "unsupported", has: ["没有预测模型", "假设演算"] }),
  Q(ENGR, "杨浦那张重叠覆盖的工单怎么处理", { intent: "scope.out", has: ["重叠覆盖", "不在本 SPEC 范围内"] }),
  Q(ENGR, "5G 小区也能自动出下倾方案吗？", { intent: "unsupported", has: ["NR", "不生成下倾方案"] }),
  Q(ENGR, "帮我直接关单", { intent: "human", has: ["A_08", "须人工执行", "优化主管"], pending: ["A_08"] }),
  Q(ENGR, "哪些措施可以用？", { intent: "measure.list", has: ["增大机械下倾角", "TILT_UP_MECH", "TILT_UP_ELEC", "现场维护"] }),
  Q(ENGR, "今天天气怎么样？", { intent: "fallback", has: ["超出了本体与 SPEC 的范围"] }),
]);

def("BQ-11", "规则咨询（新人培训）：弱覆盖怎么定义、门限、VIP、工单状态、容差", ENGR, "新来的工程师向系统请教规则：弱覆盖怎么定义、7 天出现 3 天、采样点和占比要不要同时满足、室分和宏站是否一样、VIP 怎么办、工单有哪些状态、容差和单次上限、目标半径怎么取、A_10 能不能用。", "清晨", [
  Q(ENGR, "弱覆盖是怎么定义的？门限是多少？", { intent: "rule.dispatch", has: ["RULE_D01", "2000", "20.00%", "500", "15.00%", "7天出现3天"] }),
  Q(ENGR, "7天出现3天是怎么回事", { intent: "rule.dispatch", has: ["7天出现3天"] }),
  Q(ENGR, "采样点和占比两个条件要同时满足吗？", { intent: "rule.dispatch", has: ["弱覆盖采样点≥", "占比≥"] }),
  Q(ENGR, "室分和宏站门限一样吗？", { intent: "rule.dispatch", has: ["室分", "宏站", "RULE_D02"] }),
  Q(ENGR, "VIP 小区怎么处理？", { intent: "rule.dispatch", has: ["VIP／VVIP", "规则缺口", "证据不足"] }),
  Q(ENGR, "工单有哪些状态，怎么转移？", { intent: "meta.states", has: ["待核验", "已关闭", "A_08"] }),
  Q(ENGR, "容差和单次上限、分辨率是多少？", { intent: "th.params", has: ["TH01", "0.5°", "TH02", "2°", "TH03"] }),
  Q(ENGR, "目标覆盖半径默认怎么取？", { intent: "radius", has: ["500 m", "0.5"] }),
  Q(ENGR, "哪些措施可以用？", { intent: "measure.list", has: ["增大机械下倾角", "单次上限 2°"] }),
  Q(ENGR, "A_10 能执行吗？", { intent: "meta.element", has: ["本期只定义"] }),
  Q(ENGR, "主因能不能直接写成“弱覆盖”？", { intent: "label.rule", has: ["症状级标签", "INV_02", "INV_03", "远端弱覆盖"] }),
]);

def("BQ-12", "数据核对：与上海真实工单对账、哪些数据是真实的", `${MGR}／${ENGR}`, "管理者想知道本体是不是靠谱：对账上海的 4 张真实工单，宝山那张为什么没被发现，崇明那张是否一致，杨浦为什么不在范围内，数据哪些是真实的、哪些是构造的。", "清晨", [
  Q(MGR, "上海那4张真实工单和你发现的对得上吗？", { intent: "reconcile", has: ["SHCHM", "与真实派单一致", "SHBAO", pct(EXP.bao.weakRatio), "口径与上海原工单不同"] }),
  Q(MGR, "宝山那张为什么没被发现？", { intent: "reconcile.one", has: [pct(EXP.bao.weakRatio), "门限", "假设 A-S1", "不会为了对上真实工单去改规则"] }),
  Q(MGR, "崇明那张真实工单和系统里的结果一致吗？", { intent: "reconcile.one", has: ["与真实派单一致", "命中 7 天"] }),
  Q(MGR, "杨浦那张呢", { intent: "scope.out", has: ["重叠覆盖", "不在本 SPEC 范围内"] }),
  Q(MGR, "这些数据是真实的吗？", { intent: "provenance", has: ["provenance.csv", "取自原文的关键事实"] }),
  Q(MGR, "10月份有哪些小区弱覆盖？", { intent: "scan", has: [`达到 ${octC.达到}`, `未达到 ${octC.未达到}`, `证据不足 ${octC.证据不足}`, `${NAME(S.BAO)}：未达到派单条件`] }),
], { start: OCT });

def("BQ-13", "主管全局：多少工单、哪些可以关、崇明那张到哪一步、有没有冲突", MGR, "优化主管不看细节，看全局：一共多少工单、各什么状态；哪些可以关；某张工单走到哪一步、做过什么；今天有哪些小区弱覆盖；有没有工参冲突。", "持续有效", [
  Q(MGR, "现在一共多少张工单？各什么状态？", { intent: "stats", has: ["工单 1 张", "已改善 1"] }),
  Q(MGR, "有哪些工单可以关？", { intent: "queue", has: ["可以关闭"], pending: ["A_08"] }),
  Q(MGR, "崇明那张现在到哪一步了？", { intent: "ticket.overview", has: ["已改善", "命中 7 天"] }),
  Q(MGR, "崇明那张的审计记录和时间线", { intent: "timeline", has: ["A_01", "A_02", "A_05", "A_07"] }),
  Q(MGR, "今天哪些小区弱覆盖？", { intent: "scan", has: ["判断时点 2026-09-29", "只读、不建单"] }),
  Q(MGR, "有没有工参冲突？", { intent: "conflict", has: ["当前没有未裁定的工参冲突", "INV_15"] }),
]);

def("BQ-14", "复发：关单后又出现，这个小区以前出过几次工单", ENGR, "工单关闭后一周该小区弱覆盖复发，系统新建工单并关联原单；工程师追问这个小区的工单历史、现在能不能再建单。", "已关单入库", [
  V("MR 平台", "9 月 29 日起新到达一周 MR 日统计：弱覆盖占比回升", (x, w, t) => { ingestMR(w, burst(X, ["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"], 0.35)); t.ok("新 MR 入库", w.app.store.getObject("OT_CELL_MR", `${X}@2026-10-05`) !== null, "未入库"); }),
  at("2026-10-06T09:00:00", "10 月 6 日"),
  Q(ENGR, "今天哪些小区弱覆盖？", { intent: "scan", has: ["判断时点 2026-10-06", nX + "：达到派单条件"] }),
  Q(ENGR, `帮我给${nX}建个单`, { intent: "act.bot", has: ["A_01", "新建工单", "-002"], writes: 1 }),
  Q(ENGR, "它现在什么状态？", { intent: "ticket.overview", has: ["复发工单，关联原单 TK-", "待核验"] }),
  Q(ENGR, "这个小区以前出过几次工单？", { intent: "ticket.list", has: ["共有 2 张", "已关闭", "复发，关联原单", "RT_07"] }),
  Q(ENGR, "能建单吗？", { intent: "can", has: ["已有未关闭工单", "INV_14"] }),
]);

def("BQ-15", "小区视角问答：当前小区上下文、相对指代、只读不写库", ENGR, "工程师在小区详情页里对着当前小区提问：先问这个小区为什么弱覆盖，再直接用“它”追问命中天数、天线与邻区、工单状态；最后想让它建单——问答面板只解释不写库，写操作到决策流程页做。", "工单待核验", [
  Q(ENGR, "这个小区为什么判为弱覆盖？", { cell: X, intent: "discover.cell", has: ["RULE_D01", "命中 7 天", "达到派单条件", "9月4日"] }),
  Q(ENGR, "它命中几天？", { cell: X, intent: "discover.cell", has: ["命中 7 天", "达到派单条件"] }),
  Q(ENGR, "它的天线和邻区是什么", { cell: X, intent: "cell.info", has: [AN, "挂高 38 m", nY, nZ2, "RT_04"] }),
  Q(ENGR, "它现在什么状态？", { cell: X, intent: "ticket.overview", has: ["待核验", "RULE_D01", "命中 7 天"] }),
  Q(ENGR, "帮我给它建个单", { cell: X, readOnly: true, intent: "act.bot", has: ["A_01", "只回答不做", "① 发现与判定"], pending: ["A_01"], writes: 0 }),
], { spec: ["TC10"] });

// 缺口声明：本体答不了时，必须**先声明缺哪一类知识、边界在哪**——这是大模型补充段的挂载点。
// ex.gap＝缺口类型（framework 自动核对 gap.kind 与 boundary）；ex.gap＝null 表示本体能答、不得声明缺口。
// 补充正文由大模型层（src/qa-supplement.js）在本体事实之外单列；业务用例走规则档（model-isolated），
// 所以这里核对“业务人员能看到的本体边界与缺口类型”，补充正文的落点与守卫由 test/supplement.js 覆盖。
def("BQ-16", "本体管不到的那一问：缺哪一块知识、谁补、补到哪为止", ENGR, "崇明那张工单已关单入库后，现场又打来电话，问的都是本体没建模的那部分：下倾调过一次还能动什么、功率能不能加、5G 为什么不出方案、某天没数据算什么、杨浦的重叠覆盖能不能顺手处理。系统先按本体说清边界与缺口类型（依据哪个编号、哪条公式没定义），这类通用工程知识与排查思路才由大模型补在本体事实之外，不并入事实、不写库，也不代替人工确认。", "已关单入库", [
  Q(ENGR, `${nX} 下倾已经调过一次了，要是还不行还能动什么？`, { cell: X, intent: "fallback", has: ["超出了本体与 SPEC 的范围", "没有识别出意图"], gap: "unrecognized", writes: 0 }),
  Q(ENGR, "帮我把功率调高两个dB", { intent: "unsupported", has: ["措施字典", "不会生成这类方案", "TILT_UP_MECH"], gap: "capability", writes: 0 }),
  Q(ENGR, "5G 小区也能自动出下倾方案吗？", { intent: "unsupported", has: ["NR", "规则缺口", "不生成下倾方案"], gap: "rule", writes: 0 }),
  Q(ENGR, `${nZ2} 9月10日的 MR 有多少`, { intent: "mr.day", has: ["没有 OT_CELL_MR 实例", "不是 0"], gap: "data", writes: 0 }),
  Q(ENGR, "杨浦那张重叠覆盖的工单怎么处理", { intent: "scope.out", has: ["重叠覆盖", "不在本 SPEC 范围内"], gap: "scope", writes: 0 }),
  Q(ENGR, "它的根因是什么？", { cell: X, intent: "cause", has: ["命中", "缺口", "F_08"], gap: null, writes: 0 }),
  Q(ENGR, "哪些措施可以用？", { intent: "measure.list", has: ["TILT_UP_MECH", "TILT_UP_ELEC", "单次上限 2°"], gap: null, writes: 0 }),
], { spec: ["TC10"] });

module.exports = { CASES };
