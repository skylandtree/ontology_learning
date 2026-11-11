// 业务问答扩展：业务人员日常的追问方式——待办、MR 到齐了没有、能不能建单／确认／派单、机械还是电子、怎么算出来的、有几成把握、
// 回退、为什么被拒绝、范围外请求、案例能不能参考、与真实工单对账。
// 与 qa.js 一样只引用函数结果、对象、关系和 SPEC 本体元数据；SPEC 没有定义的东西（置信度、预测、下倾以外的措施、NR 公式）如实回答“没有定义”，不编造。
const { addDays, idOf } = require("./facts.js");

function install(c) {
  const { on, PRI, app, S, facts, svc, ont, sess, ticketOf, planOf, effOf, noTicket, nm, scopeAt, pct, fmtDate } = c;
  const P = k => ont.param(k), now = () => S.peekNow();
  const lastDiag = (t, kind) => [...(t.diagnostics || [])].reverse().find(d => d.kind === kind);
  // 方案已实施的，取实施前一秒的事实（与假设演算同口径）
  const planTime = t => { const p = t && planOf(t); return p && p.execution && p.execution.executeTime ? new Date(Date.parse(p.execution.executeTime + "Z") - 1000).toISOString().slice(0, 19) : now(); };
  // 下倾判断的结果：优先取工单里已写下的 F_08 诊断记录（当时的事实），否则按当前事实现算
  const f8Of = (t, cellKey) => { const d = t && lastDiag(t, "下倾角命中"); return d ? d.result : svc.matchTilt(cellKey, now()); };
  const cellOfCtx = (e, t) => t ? facts.cellOfTicket(t.ticketNo) : e.cell ? e.cell.cellKey : sess.cellKey;
  const reg = (name, pri, test, fn) => { PRI[name] = pri; on(name, test, fn); };

  // ── 范围外的请求：SPEC 没定义的措施、预测、NR 公式
  const MEASURE = /(调|改|提高|降低|增加|加)\s*(发射)?功率|功率.{0,4}(调|提高|降低|增加|加)|(调|改)\s*方位|(调|改)\s*挂高|加站|(新建|新增).{0,4}站|扩容|加载波|开新载波/, PREDICT = /(预测|预计|趋势|下个月|下周|未来|以后会不会|会不会.{0,4}(恶化|继续))/, NR = /(5G|NR)/;
  reg("unsupported", 7.4, q => MEASURE.test(q) || PREDICT.test(q) || (NR.test(q) && /(下倾|方案|原因|根因|判断)/.test(q)), q => {
    if (MEASURE.test(q)) {
      const ms = ont.raw.measureTypes;
      return { text: `SPEC 本期的措施字典只有 ${ms.length} 条：${ms.map(m => m.name + "（" + m.measureCode + "，单次上限 " + m.maxStep + "°）").join("、")}。你提到的调整不在措施字典里：本体没有对应的对象、规则和函数，不会生成这类方案。F_08 对发射功率、覆盖方向、周边遮挡只做次因线索（RULE_W05、RULE_W08、RULE_W09），提示工程师人工复核，不下措施。`, src: [ms], refs: ["RULE_W05", "RULE_W08", "RULE_W09", "F_08", "A_04"], out: true,
        gap: { kind: "capability", boundary: `SPEC 的措施字典只有 ${ms.map(m => m.name).join("、")} 两种，均为下倾角调整；发射功率、覆盖方向、周边遮挡只作次因线索（RULE_W05／W08／W09），本期不建模为措施。` } };
    }
    if (PREDICT.test(q)) return { text: "SPEC 没有预测模型：本体只对已经到达的 MR 日统计、工参和告警做发现、定因和效果评估，不预测未来，也不给趋势结论。能做的有两件：一是只读的假设演算（“如果……会怎样”，不改任何记录），二是对已实施方案按 F_11 跟踪效果，后窗每多一天就重新评估一次。", src: [], refs: ["F_11", "F_12", "A_07"], out: true,
      gap: { kind: "capability", boundary: "SPEC 只对已到达的 MR 日统计、工参和告警做发现、定因和效果评估（F_06／F_07／F_08／F_11／F_12），没有预测模型，不给未来趋势结论。" } };
    return { text: "5G（NR）小区可以按 RULE_D03／D04 发现并建单；但 NR 的理论覆盖半径与推荐下倾公式 SPEC 没有定义（规则缺口），F_08 对 NR 返回“未知”，不套用 LTE 公式，不生成下倾方案，转人工处理。", src: [], refs: ["RULE_D03", "RULE_D04", "F_08", "A_01", "INV_09"], out: true,
      gap: { kind: "rule", boundary: "NR（5G）的理论覆盖半径与推荐下倾公式（F_02／F_04／F_08）在 SPEC 里未定义；LTE 宏站的下倾角模型（RULE_W06）不适用于 NR。" } };
  });

  // ── 能不能建单／确认／派单／出方案：只读，按动作前提逐条核对
  reg("can", 8.9, q => /(能不能|能否|可不可以|行不行|可以|能)(直接|先|现在|马上)?(建单|建个单|确认|派单|批准|生成方案|出方案)/.test(q), (q, e) => {
    const kind = /建(个|一个|张)?单/.test(q) ? "A_01" : /派单|批准/.test(q) ? "A_05" : /方案/.test(q) ? "A_04" : "A_03";
    if (kind === "A_01") {
      const ck = e.cell ? e.cell.cellKey : sess.cellKey; if (!ck) return { text: "请指明是哪个小区。", src: [], refs: ["A_01"] };
      const d = svc.discover(ck, now()), open = facts.ticketsOf(ck).filter(t => t.problemType === d.problemType && t.status !== "已关闭");
      const body = d.verdict === "达到派单条件" ? (open.length ? `可以，但该小区已有未关闭工单 ${open[0].ticketNo}，再建只会返回原单，不会重复建单（INV_14）` : `可以：窗口 ${d.window.from}～${d.window.to} 命中 ${d.hitDays} 天（${d.ruleId} 要求 ${d.minHitDays} 天），建单由优化本体或地市优化工程师发起（A_01），建单时会按当时的数据重算一遍`)
        : d.verdict === "未达到派单条件" ? `不能：命中 ${d.hitDays} 天，达到条件需要 ${d.minHitDays} 天（INV_16），问题必须由前置数据发现，未达到不建单`
          : `不能：${d.ruleGap ? "规则缺口——" + d.ruleGap : d.reason}（INV_09，证据不足不建单）`;
      return { text: `${d.cellName}：${body}。`, src: [d, open.length], refs: ["A_01", "F_06", "INV_14", "INV_16", "INV_09", d.ruleId || "RULE_F01"] };
    }
    const t = ticketOf(e); if (!t) return noTicket("该小区"); sess.ticketNo = t.ticketNo;
    if (kind === "A_03") {
      const fw = lastDiag(t, "假性弱覆盖"), rs = t.rootCauses, last = rs.filter(r => r.round === Math.max(0, ...rs.map(x => x.round)));
      let body;
      if (t.status !== "待核验") body = `不能：只能对“待核验”的工单确认或排除，当前状态“${t.status}”`;
      else if (!fw) body = "不能：还没有定因，先由优化本体执行 A_02（F_07 排除假性弱覆盖、F_08 判下倾角）";
      else if (fw.result.verdict === "排除") body = "不该确认：F_07＝排除（假性弱覆盖），应当排除，不调参";
      else if (!last.some(r => r.role === "主因" && r.evidenceRefs.length)) body = "不能：没有带证据的主因（INV_03），F_08 未命中或信息不足时须转人工写主因";
      else if (fw.result.verdict === "部分重合") body = "可以，但须在确认时写明复核判断：告警与命中日部分重合，是否影响主因由你判断（A_03）";
      else if (last.some(r => r.role === "次因")) body = "可以，但须写明复核判断：次因同时命中，要说明本方案只针对下倾角、其余是否转专家";
      else body = "可以：主因有证据、F_07 无重合，由地市优化工程师或优化专家确认（A_03）";
      return { text: `${t.ticketNo}（状态“${t.status}”）${body}。`, src: [t.status, fw && fw.result, last], refs: ["A_03", "F_07", "INV_03", "INV_04"], pending: ["A_03"] };
    }
    if (kind === "A_04") {
      const body = t.status === "已确认" || t.status === "改善未解决" ? "可以：由优化本体按 F_08→F_09→F_10 生成（A_04），电子下倾还要求天线支持电调" : `不能：工单状态“${t.status}”，须先确认根因（INV_04）`;
      return { text: `${t.ticketNo}：${body}。`, src: [t.status], refs: ["A_04", "INV_04"] };
    }
    const p = planOf(t); let body;
    if (!p) body = "不能：还没有方案";
    else if (p.status === "待确认") { const n = S.links({ rt: "RT_10", from: "OT_PLAN:" + p.planNo }).filter(l => l.to.startsWith("OT_CELL:")).length, sup = n >= 2 || ["VIP", "VVIP"].includes(t.sceneLevel); body = `可以：周边影响“${p.impact.result}”；由地市优化工程师确认并派给现场维护人员（INV_05），作用于 ${n} 个小区${sup ? "，须追加优化主管批准（RULE_W14）" : ""}`; }
    else if (p.status === "草案") body = `不能：周边影响“${p.impact.result}”的方案不得批准（INV_06），可调整条件重算或不批准`;
    else body = `不能：方案状态“${p.status}”`;
    return { text: `${p.planNo || t.ticketNo}：${body}。`, src: [p && p.status, p && p.impact], refs: ["A_05", "INV_05", "INV_06", "RULE_W14"], pending: ["A_05"] };
  });

  // ── 比较机械下倾与电子下倾（只读，在内存里算，不写入）
  const calcAdj = (cellKey, adj, tm) => {
    const f = facts.tiltFacts(cellKey, tm), f8 = app.F.F08(f);
    if (f8.match !== "命中") return { adj, f8 };
    if (adj === "电子" && !f.supportsRET) return { adj, f8, unsupported: true };
    const f9 = app.F.F09(f8._deficit, adj), same = facts.cellsOnAntenna(f.antennaId), scope = (adj === "机械" ? same.map(x => x.cellKey) : [cellKey]).map(k => facts.geom(k, tm));
    const im = app.F.F10({ scope, target: facts.geom(cellKey, tm), neighbors: facts.overlapNeighbors(cellKey, tm), adjustType: adj, planDelta: f9.delta });
    return { adj, f8, f9, im, scope: scope.map(s => s.cellKey), antennaId: f.antennaId };
  };
  reg("compare", 7.8, (q, e) => /(机械|机下)/.test(q) && /(电子|电调)/.test(q) && /(还是|和|对比|区别|哪个|合适|选|比较)/.test(q) && !/(如果|假如)/.test(q), (q, e) => {
    const t = ticketOf(e), ck = cellOfCtx(e, t); if (!ck) return noTicket("该小区"); const tm = planTime(t), rows = ["机械", "电子"].map(a => calcAdj(ck, a, tm)), mm = { 机械: ont.measure("TILT_UP_MECH"), 电子: ont.measure("TILT_UP_ELEC") };
    if (rows[0].f8.match !== "命中") return { text: `${nm(ck)} 的 F_08＝${rows[0].f8.match}，不生成下倾方案，无须比较机械与电子（${rows[0].f8.reason || rows[0].f8.role}）。`, src: [rows[0].f8], refs: ["F_08", "A_04"] };
    const line = r => r.unsupported ? `电子下倾：天线不支持电调，不可选` : `${r.adj}下倾：${r.adj === "机械" ? "作用于整副天线 " + r.antennaId + "，承载的小区都受影响（" + r.scope.map(nm).join("、") + "）" : "只作用于 " + nm(ck) + " 的阵列"}；缺口 ${r.f8.deficit}° → 单次 Δ＝${r.f9.delta}°（分辨率 ${r.f9.resolution}°，共 ${r.f9.rounds} 轮）；周边影响“${r.im.result}”${r.im.deltaFinal !== null && r.im.deltaFinal !== undefined ? "，Δ最终 " + r.im.deltaFinal + "°" : ""}；执行方“${mm[r.adj].executorRole}”，${mm[r.adj].remote ? "可远程" : "不可远程"}`;
    return { text: `${nm(ck)} 两种措施的只读演算（${t && planOf(t) && planOf(t).execution ? "按实施前的事实" : "按当前事实"}，不写入任何记录）：` + rows.map(line).join("；") + "。SPEC 没有规定两者的优先顺序，哪种可行看周边影响是否通过，选哪种由工程师决定；确认后方案由优化本体生成。", src: rows.map(r => ({ f9: r.f9, im: r.im, f8: r.f8 })), refs: ["F_08", "F_09", "F_10", "INV_12", "RULE_W13", "RT_10", "TH02", "TH03"], whatif: true };
  });

  // ── 待办：按提问者角色，列出 SPEC 里该角色有权执行的下一步
  reg("queue", 11.2, (q, e) => !e.cell && !e.ticket && !/为什么/.test(q) && /(待办|待我|要我(批|处理|确认|审批|回填|看|关)|我.{0,4}(要|该|需要|有哪些).{0,6}(处理|批|确认|回填|关|入库)|有哪些(单子|工单|方案).{0,6}(要|可以|待)|(什么|哪些).{0,3}要我)/.test(q), () => {
    const items = [], add = (act, ticketNo, line, roles) => items.push({ act, ticketNo, line, roles: roles || ont.action(act).roles });
    const tickets = S.list("OT_TICKET"), plans = S.list("OT_PLAN"), sustain = P("effectSustainDays");
    for (const t of tickets) {
      const cn = nm(facts.cellOfTicket(t.ticketNo)), p = planOf(t), es = effOf(p), l = es[es.length - 1];
      if (t.status === "待核验") add("A_03", t.ticketNo, `${t.ticketNo}（${cn}）待核验：确认或排除`);
      if (t.status === "已确认" && !p) add("A_04", t.ticketNo, `${t.ticketNo}（${cn}）已确认：待优化本体生成方案`);
      if (t.status === "改善未解决") add("A_04", t.ticketNo, `${t.ticketNo}（${cn}）改善未解决：待优化本体生成下一轮方案`);
      if (t.status === "待评估") add("A_07", t.ticketNo, `${t.ticketNo}（${cn}）已实施：待写入效果评估`);
      if (t.status === "已改善") { if (l && l.sustained === true) add("A_08", t.ticketNo, `${t.ticketNo}（${cn}）效果“持续有效”：可以关闭`); else add("A_07", t.ticketNo, `${t.ticketNo}（${cn}）效果“${l ? l.status : "待评估"}”：后窗满 ${sustain} 天后再评估，才能判持续有效`); }
      if (t.status === "已关闭" && l && !S.list("OT_CASE").some(x => x.sourceTicketNo === t.ticketNo)) add("A_09", t.ticketNo, `${t.ticketNo}（${cn}）已关闭：案例待入库`);
    }
    for (const p of plans) {
      const t = S.doc("OT_TICKET", p.ticketNo), n = S.links({ rt: "RT_10", from: "OT_PLAN:" + p.planNo }).filter(l => l.to.startsWith("OT_CELL:")).length;
      if (p.status === "待确认") { add("A_05", p.ticketNo, `${p.planNo} 待确认派单`); if (n >= 2 || ["VIP", "VVIP"].includes(t.sceneLevel)) add("A_05", p.ticketNo, `${p.planNo} 作用于 ${n} 个小区，须追加优化主管批准（RULE_W14）`, ["优化主管"]); }
      if (p.status === "草案") add("A_05", p.ticketNo, `${p.planNo} 停在草案（周边影响“${p.impact.result}”，不得批准）：调整条件重算，或不批准`);
      if (["已派单", "未知"].includes(p.status)) add("A_06", p.ticketNo, `${p.planNo} 已派单（${p.execution.dispatchNo}）：待现场回填${p.status === "未知" ? "，回执缺失，先核对原派单记录" : ""}`);
    }
    for (const a of S.list("OT_ANTENNA")) { const st = facts.antennaState(a.antennaId, now()); if (st && st.status === "conflict") add("A_11", null, `天线 ${a.antennaId} 工参来源冲突：待裁定`); }
    const role = sess.role, mine = role ? items.filter(i => i.roles.includes(role)) : items, tks = [...new Set(mine.map(i => i.ticketNo).filter(Boolean))]; if (tks.length === 1) sess.ticketNo = tks[0];
    const text = mine.length ? `${role ? "“" + role + "”" : "各角色"}当前有 ${mine.length} 项待办：` + mine.map(i => (role ? "" : "【" + i.roles.join("／") + "】") + i.line).join("；") + "。优化本体只做建单、规则定因、生成方案、写入效果；确认、审批、回填、关单、入库、裁定都由人工角色执行。" : `${role ? "“" + role + "”" : "各角色"}当前没有待办（时钟 ${now()}）。`;
    return { text, src: [mine.length, tickets, plans, sustain, now()], refs: [...new Set(mine.map(i => i.act))].concat(["INV_05"]), pending: [...new Set(mine.map(i => i.act))].filter(a => !ont.action(a).roles.every(r => r === "优化本体")) };
  });

  // ── MR 到齐了没有
  reg("arrival", 11.4, q => /(MR|数据).{0,8}(到齐|到了吗|到哪|最新|齐了|缺)|到齐了/.test(q), (q, e) => {
    const tm = now(), win = facts.windowOf(tm), cells = e.cell ? [e.cell.cellKey] : scopeAt(tm);
    const row = k => { const have = win.dates.filter(d => facts.mr(k, d)), ds = S.list("OT_CELL_MR").filter(m => m.cellKey === k).sort((a, b) => a.date.localeCompare(b.date)); return { k, have: have.length, miss: win.dates.filter(d => !have.includes(d)), last: ds[ds.length - 1] || null }; };
    const rows = cells.map(row);
    if (e.cell) {
      const r = rows[0];
      return { text: `${nm(r.k)}：窗口 ${win.from}～${win.to}（${win.days} 天）内已到 ${r.have} 天的 MR 日统计，缺 ${r.miss.map(fmtDate).join("、") || "无"}；${r.last ? "最近一天是 " + fmtDate(r.last.date) + "（" + r.last.receivedAt + " 到达）" : "该小区没有任何 MR 日统计"}。缺的天不是 0，规则里记“未知”：命中加未知都凑不够天数才判“未达到”，凑得够却不确定时判“证据不足”（INV_09）。`, src: [win, rows, tm], refs: ["OT_CELL_MR", "F_05", "F_06", "INV_09", "INV_17"] };
    }
    const full = rows.filter(r => r.miss.length === 0), gap = rows.filter(r => r.miss.length > 0 && r.have > 0), none = rows.filter(r => r.have === 0);
    return { text: `截至 ${tm}，发现范围 ${rows.length} 个小区，窗口 ${win.from}～${win.to}：MR 日统计到齐的 ${full.length} 个；有缺天的 ${gap.length} 个${gap.length ? "（" + gap.map(r => nm(r.k) + "缺" + r.miss.length + "天").join("、") + "）" : ""}；窗口内一天都没有的 ${none.length} 个${none.length ? "（" + none.map(r => nm(r.k)).join("、") + "）" : ""}。缺天按“未知”处理，不当作 0，也不静默跳过（INV_09）。`, src: [win, rows.map(r => [r.have, r.miss.length]), tm], refs: ["OT_CELL_MR", "F_12", "INV_09"] };
  });

  // ── 为什么被拒绝：取最近一次被拒绝的动作，给出约束原文与下一步
  const NEXT = { INV_09: "补齐缺失的 MR 或补上规则后再判断", INV_16: "继续观察，窗口内命中天数达到要求后会出现在发现清单里", REVIEW_REQUIRED: "补写复核判断后重新确认", SUPERVISOR_REQUIRED: "追加优化主管批准后重新提交", PERMISSION_DENIED: "换 SPEC 允许的角色执行", ROUND_IN_PROGRESS: "先结束上一轮方案（派单并回填，或不批准）", INV_10: "等效果评定为持续有效", INV_08: "先核对回执并回填实际值", INV_06: "调整条件重算周边影响，或不批准", INV_05: "由地市优化工程师确认并派给现场维护人员", STALE_FACTS: "方案已退回草案，按新工参重新生成", INV_02: "先下钻到具体原因再写主因", INV_03: "补上真实存在的直接证据", INV_04: "先确认根因" };
  const rejections = e => S.runs().filter(r => r.outcome === "rejected" && (!(e.cell || e.ticket) || (e.cell && (r.target === e.cell.cellKey || r.target === (ticketOf(e) || {}).ticketNo)) || (e.ticket && r.target === e.ticket)));
  reg("why.rejected", 11.6, (q, e) => /(为什么|怎么|咋).{0,10}(拒绝|被拒|建不了|不让|没成功|失败|没建成|不成)|被拒绝/.test(q) && rejections(e).length > 0, (q, e) => {
    const r = rejections(e).pop(), def = ont.action(r.actionId), inv = /^INV_\d+$/.test(r.code) ? ont.inv(r.code) : null;
    return { text: `最近一次被拒绝的是 ${r.actionId} ${def.label}（${r.role}，对象 ${r.target}）：${r.code}——${r.msg}。${inv ? "对应核心约束 " + r.code + "：" + inv.text + "。" : ""}${NEXT[r.code] ? "下一步：" + NEXT[r.code] + "。" : ""}拒绝也会留审计记录，不产生任何业务记录。`, src: [r.msg, inv && inv.text], refs: [r.actionId, /^INV_\d+$/.test(r.code) ? r.code : "INV_05"] };
  });

  // ── 次因逐项：发射功率、覆盖方向、周边遮挡
  reg("cause.other", 11.8, (q, e) => /(发射功率|功率|方位角?|遮挡|天线方向|覆盖方向)/.test(q) && /(问题|正常|偏差|有没有|排除|是不是|吗|呢|多少)/.test(q), (q, e) => {
    const t = ticketOf(e), ck = cellOfCtx(e, t); if (!ck) return noTicket("该小区"); const f8 = f8Of(t, ck), i = f8.inputs || {};
    if (f8.match === "未知" || f8.match === "冲突") return { text: `${nm(ck)} 的 F_08＝${f8.match}：${f8.reason}，次因也无从逐项核查，转人工。`, src: [f8], refs: ["F_08", "INV_09"] };
    const pw = i.rsPower === undefined || i.rsPowerPlan === undefined ? "发射功率：缺现网值或规划值，未核查" : `发射功率：现网 ${i.rsPower} dBm，规划 ${i.rsPowerPlan} dBm，${i.rsPower < i.rsPowerPlan ? "低于规划，记次因“发射功率”" : "不低于规划，未命中"}`;
    const az = i.azimuthDeviationDeg === undefined ? "覆盖方向：缺方位偏差，未核查" : `覆盖方向：方位偏差 ${i.azimuthDeviationDeg}°，门限 ${P("azimuthDevThreshold")}°（TH08），${i.azimuthDeviationDeg > P("azimuthDevThreshold") ? "超过，记次因“覆盖方向偏差”" : "未超过"}`;
    const ob = i.obstructionEvidence === undefined ? "周边遮挡：没有勘察证据，未核查" : `周边遮挡：证据“${i.obstructionEvidence}”${i.obstructionEvidence === "是" ? "，记次因“周边遮挡”" : "，不记次因"}`;
    return { text: `${nm(ck)} 的次因逐项核查（F_08＝${f8.match}）：${pw}；${az}；${ob}。${f8.otherCauses && f8.otherCauses.length ? "次因 " + f8.otherCauses.join("、") + " 与主因并列，确认时须写明复核判断。" : "没有次因与主因并列。"}次因只作线索，本期措施字典里没有针对它们的措施，需要处理的由工程师人工安排。`, src: [f8, P("azimuthDevThreshold")], refs: ["F_08", "RULE_W05", "RULE_W08", "RULE_W09", "TH08"] };
  });

  // ── 有几成把握：SPEC 没有置信度
  reg("confidence", 12.5, q => /(把握|置信|概率|准确率|可信度|几成|靠谱)/.test(q), (q, e) => {
    const t = ticketOf(e), ck = cellOfCtx(e, t); const f8 = ck ? f8Of(t, ck) : null;
    const basis = !f8 ? "" : f8.match === "命中" ? `这次的依据是确定性规则：F_08 缺口 ${f8.deficit}°，大于容差 ${P("eps")}°（TH01），判“命中”；` : f8.match === "不命中" ? `这次 F_08 缺口 ${f8.deficit}°，不大于容差 ${P("eps")}°（TH01），判“不命中”；` : `这次 F_08＝${f8.match}（${f8.reason || ""}），本体不下结论；`;
    return { text: `SPEC 没有定义“置信度”或概率，本体不给百分比，也不会编一个。${basis}容差（TH01）和理论半径简化模型（TH15）都是测试假设，业务确认前判断保持“待确认”，所以每条根因都带证据回链（MR 窗口与工参），请以证据为准复核。`, src: [f8, P("eps")], refs: ["F_08", "TH01", "TH15", "RULE_W06"] };
  });


  // ── 主因标签规则：症状级标签不能作主因
  reg("label.rule", 12.4, q => /(症状级|症状标签|(主因|根因).{0,8}(写|填))/.test(q), () => {
    const inv2 = ont.inv("INV_02"), inv3 = ont.inv("INV_03"), labels = ont.raw.symptomLabels;
    return { text: `主因不能写症状级标签（INV_02）：${inv2.text}。SPEC 列出的症状级标签有：${labels.join("、")}；写主因要先下钻到具体原因，例如“弱覆盖小区天线下倾角过小”。主因还必须至少有一条真实存在的直接证据（INV_03）：小区 MR、工参、告警或勘察，没有证据的主因会被拒绝。`, src: [inv2, inv3, labels], refs: ["INV_02", "INV_03", "A_02"] };
  });

  // ── 这个小区以前出过几次工单（复发会关联原单）
  reg("ticket.list", 16.8, (q, e) => !!(e.cell || sess.cellKey) && /工单/.test(q) && /(出过|有过|几次|几张|历史|以前|之前|复发)/.test(q), (q, e) => {
    const ck = e.cell ? e.cell.cellKey : sess.cellKey, ts = facts.ticketsOf(ck).sort((a, b) => a.ticketNo.localeCompare(b.ticketNo));
    if (!ts.length) return { text: `${nm(ck)} 还没有弱覆盖工单。`, src: [0], refs: ["OT_TICKET", "RT_05"] };
    sess.ticketNo = ts[ts.length - 1].ticketNo;
    return { text: `${nm(ck)} 共有 ${ts.length} 张弱覆盖工单：` + ts.map(t => `${t.ticketNo}（${t.status}${t.relatedTicketNo ? "，复发，关联原单 " + t.relatedTicketNo + "（RT_07）" : ""}）`).join("；") + "。同一小区同一问题类型只允许有一张未关闭的工单（INV_14）；原单关闭后该小区再次达到派单条件，才会新建工单并关联原单，原单保持已关闭。", src: [ts.length, ts.map(t => [t.ticketNo, t.status, t.relatedTicketNo])], refs: ["OT_TICKET", "RT_05", "RT_07", "INV_14"] };
  });

  // ── 措施字典
  reg("measure.list", 12.8, q => /(哪些|什么|有几种|几种).{0,4}措施|措施.{0,4}(有哪些|字典|清单|类型)/.test(q), () => {
    const ms = ont.raw.measureTypes;
    return { text: `SPEC 措施字典共 ${ms.length} 条：` + ms.map(m => `${m.name}（${m.measureCode}，${m.smallClass}，执行方“${m.executorRole}”，${m.remote ? "可远程" : "不可远程"}，${m.direction}，单次上限 ${m.maxStep}°，调节分辨率 ${m.resolution}°）`).join("；") + "。本期的措施只有下倾调整，其他措施不在本体里。", src: [ms], refs: ["RULE_M01", "TH02", "TH03", "F_09"] };
  });

  // ── 案例能不能参考：逐项比对适用条件（RT_15）
  const KEYS = { rat: "制式", siteType: "站点类型", sceneLevel: "场景等级", areaScene: "区域场景", urbanRural: "城乡", indoorOutdoor: "室内外", causeFamily: "原因族" };
  reg("case.match", 14.5, (q, e) => !!e.cell && !/方案/.test(q) && /(参考|复用|引用|借鉴|套用).{0,10}(案例|崇明)|案例.{0,8}(适用|能不能|可以|匹配)|能.{0,3}参考/.test(q), (q, e) => {
    const cs = S.list("OT_CASE"); if (!cs.length) return { text: "案例库目前 0 条，没有可参考的案例：无案例时依已确认规则继续判断，不记为“无可用措施”。", src: [0], refs: ["OT_CASE", "A_09", "INV_11"] };
    const ap = app.applicabilityOf(e.cell.cellKey, "下倾角过小"), rows = cs.map(k => ({ k, diff: Object.keys(KEYS).filter(x => ap[x] && k.applicability[x] && ap[x] !== k.applicability[x]) }));
    return { text: `${e.cell.cellName} 的适用条件：${Object.keys(KEYS).filter(x => ap[x]).map(x => KEYS[x] + "＝" + ap[x]).join("、")}。` + rows.map(r => r.diff.length ? `案例 ${r.k.caseNo} 不匹配（${r.diff.map(x => KEYS[x] + "：本小区 " + ap[x] + "，案例 " + r.k.applicability[x]).join("；")}），不得复用` : `案例 ${r.k.caseNo}（结论“${r.k.outcome}”，验证状态“${r.k.validation}”）条件一致，可以参考；只作参考，不照搬幅度——案例 Δ＝${r.k.deltaValue}°，本小区的 Δ 仍由 F_09 按缺口计算`).join("；") + "。", src: [ap, rows.map(r => [r.k.applicability, r.k.deltaValue, r.diff])], refs: ["OT_CASE", "RT_14", "RT_15", "INV_11", "F_09", "A_09"] };
  });

  // ── 与某一张真实工单对账
  reg("reconcile.one", 14.8, (q, e) => !!e.src && e.src.inScope && /(为什么|没|对得上|一致|发现|对账|差异)/.test(q), (q, e) => {
    const t = e.src, at = addDays(t.windowEnd, 1) + "T09:00:00", d = svc.discover(t.cellKey, at), rule = ont.raw.dispatchRules.find(r => r.ruleId === d.ruleId), ms = S.list("OT_CELL_MR").filter(m => m.cellKey === t.cellKey && m.date >= d.window.from && m.date <= d.window.to);
    if (!ms.length) return { text: `${t.short}（${t.taskno}）窗口 ${d.window.from}～${d.window.to} 的 MR 日统计还没有到达本体（当前时钟 ${now()}），对不了账。`, src: [d, now()], refs: ["OT_CELL_MR", "F_06"] };
    const wr = ms.reduce((s, m) => s + m.sampleWeak, 0) / ms.reduce((s, m) => s + m.sampleTotal, 0), head = `${t.short}（${t.taskno}，${t.district}）真实工单：${t.issue}，${t.kpiName} ${pct(t.kpiValue)}。本体在前置数据上按 ${d.ruleId} 发现：“${d.verdict}”，命中 ${d.hitDays} 天，窗口弱覆盖占比 ${pct(wr)}（＝1−原文覆盖率）。`;
    return { text: head + (d.verdict === "达到派单条件" ? "与真实派单一致。" : `没有被发现：单日弱覆盖占比低于 ${d.ruleId} 的门限 ${pct(rule.minWeakRatio)}。这是口径差异——上海原工单的覆盖率口径与 SPEC 的“RSRP＜-110 采样点占比”不同，是否调整门限需业务确认（假设 A-S1）；本体不会为了对上真实工单去改规则。`) + "真实工单只用于对账，不作为发现的输入。", src: [d, wr, rule, t.kpiValue], refs: ["F_06", "F_12", d.ruleId, "OT_CELL_MR"], derived: true };
  });

  // ── 回退：A_10 本期只定义
  reg("rollback", 7.9, q => /(回退|恢复原|撤销|调坏|调错|回滚|调回去)/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const p = planOf(t); sess.ticketNo = t.ticketNo;
    if (!p) return { text: `${t.ticketNo} 还没有方案，也就没有回退值。回退方案 A_10 本期只定义、不运行。`, src: [], refs: ["A_10"] };
    const a = p.actions[0];
    return { text: `${p.planNo} 记录了回退值 ${a.rollbackValue}°（${a.targetKey} 的 ${a.param} 调整前的值）和回退条件“${p.rollbackCondition}”。回退动作 A_10 本期只定义、不运行：系统不会自动回退，也没有回退的执行记录，回退怎么做 SPEC 没有定义。效果评估若判“劣化”（目标改善但保护指标恶化），工单转“改善未解决”，案例入库时记“无效”（A_09）。`, src: [p.actions, p.rollbackCondition], refs: ["A_10", "OT_PLAN", "F_11", "A_09"] };
  });

  // ── 怎么算出来的
  reg("explain.calc", 16.5, q => /(怎么算|怎么得出|怎么得到|怎么计算|计算过程|公式|理论覆盖半径|推荐下倾)/.test(q), (q, e) => {
    const t = ticketOf(e), ck = cellOfCtx(e, t); if (!ck) return noTicket("该小区"); const f8 = f8Of(t, ck), i = f8.inputs || {};
    if (f8.match === "未知" || f8.match === "冲突") return { text: `${nm(ck)} 的 F_08＝${f8.match}：${f8.reason}${f8.missing && f8.missing.length ? "（缺项：" + f8.missing.join("、") + "）" : ""}，缺必需输入时不计算、也不判“不命中”。`, src: [f8], refs: ["F_08", "INV_09"] };
    return { text: `${nm(ck)}（F_08，v${f8.funcVersion}）：推荐总下倾 θ_t＝arctan(h／Rt)＋β／2＝arctan(${i.h}／${i.Rt})＋${i.vBeam}／2＝${f8.thetaTarget}°（挂高 h＝${i.h} m，目标覆盖半径 Rt＝${i.Rt} m，垂直波束宽 β＝${i.vBeam}°）；现网总下倾＝机械 ${i.mechTilt}°＋电子 ${i.elecTilt}°＝${f8.totalTilt}°；缺口＝${f8.thetaTarget}°−${f8.totalTilt}°＝${f8.deficit}°，大于容差 ${P("eps")}°（TH01）才判“命中”。理论覆盖半径（F_02，简化平地模型，TH15）：近端 ${f8.rNear} m、远端 ${f8.rFar} m，与目标半径 ${i.Rt} m 对照。`, src: [f8, P("eps")], refs: ["F_08", "F_02", "F_03", "F_04", "TH01", "TH15", "RT_02"] };
  });

  // ── 天线现在的下倾
  reg("antenna.now", 18.5, (q, e) => /(现在|目前|当前).{0,8}(下倾|倾角)|下倾.{0,6}(现在|目前|当前)/.test(q) && !/(如果|假如)/.test(q), (q, e) => {
    const t = ticketOf(e), ck = cellOfCtx(e, t); if (!ck) return noTicket("该小区"); const al = facts.antennaLink(ck); if (!al) return { text: `${nm(ck)} 没有天线关系（工参缺失＝未知）。`, src: [], refs: ["RT_02"] };
    const st = facts.antennaState(al.antennaId, now()), h = S.history("OT_ANTENNA", al.antennaId), last = h[h.length - 1];
    return { text: `${nm(ck)} 由天线 ${al.antennaId} 覆盖，当前机械下倾 ${st.antenna.mechTilt}°（状态${st.status === "ok" ? "正常" : st.status}，生效 ${st.eff}）＋电子下倾 ${al.elecTilt}°＝总下倾 ${+(st.antenna.mechTilt + al.elecTilt).toFixed(2)}°。该天线共 ${h.length} 个工参版本，最近一个版本的来源“${last.source || "初始导入"}”；历史判断按判断时点读回当时有效的版本（INV_11、INV_15）。`, src: [st, al, h.length, last], refs: ["OT_ANTENNA", "RT_02", "F_03", "INV_11", "INV_15"] };
  });
}
module.exports = { install };
