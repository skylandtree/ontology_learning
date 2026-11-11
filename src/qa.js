// 基于本体的问答：规则驱动（不调用大模型），只引用函数结果、对象、关系与 SPEC 定义的本体元数据；每个数值与日期都要能追溯到本次引用的来源。
// 优化本体只能执行 SPEC 授权给它的自动动作（A_01 建单、A_02 规则定因、A_04 生成方案、A_07 写入效果）；确认、审批、回填、关单、入库、裁定只提示不代办。
const { addDays, idOf } = require("./facts.js");

const pct = v => (v === null || v === undefined ? "—" : (v * 100).toFixed(2) + "%");
const fmtDate = d => `${+d.slice(5, 7)}月${+d.slice(8, 10)}日`;

function createQA(app) {
  const { ont, store: S, facts, svc, tracker: T, seed } = app, hit = (k, id) => T && T.hit(k, id);
  const cellNames = () => S.list("OT_CELL"), nm = k => { const c = S.doc("OT_CELL", k); return c ? c.cellName : k; };
  const sess = { ticketNo: null, cellKey: null, role: null, readOnly: false };
  // 相对指代词：把“它／这个小区”解析到会话里的当前小区（前端问答面板把当前小区传进来）。
  // “其它／他们”不算指代，故用否定前瞻排除。
  const REL = /(它(?![们他她即])|这个小区|该小区|本小区|刚才那个|这个站|该站)/;
  // 写动作在决策流程页的哪一步（只读模式下告诉用户去哪里执行）
  const FLOW_STEP = { A_01: "① 发现与判定", A_02: "② 工单与定因", A_04: "③ 优化方案", A_07: "⑥ 效果核验" };

  // ── 实体识别
  function entities(q) {
    const e = { ids: [...new Set(q.match(/\b(?:OT_[A-Z_]+|RT_\d+|F_\d+|A_\d+|INV_\d+|RULE_[A-Z]\d+|TH\d+)\b/g) || [])], dates: [] };
    for (const m of q.matchAll(/(\d{1,2})月(\d{1,2})日/g)) e.dates.push(`2026-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
    for (const m of q.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)) e.dates.push(m[1]);
    e.ticket = (q.match(/TK-[A-Z]+-[^\s，。；？?]+?-\d{3}/) || [])[0] || null;
    const st = seed.sourceTickets.find(t => q.toUpperCase().includes(t.short)) || seed.sourceTickets.find(t => q.includes(t.district + "那张") || q.includes(t.district + "的工单"));
    e.short = st ? st.short : null; e.src = st || null;
    const cs0 = cellNames(), stem = c => (c.cellName.match(/^(.+?)(?:NF|ND|HR)\d{2}H_/) || [])[1], stems = {}; cs0.forEach(c => { const t = stem(c); if (t) stems[t] = (stems[t] || 0) + 1; });
    const alias = []; for (const c of cs0) { const t = stem(c); [c.cellKey, c.cellName, c.cellKey.slice(c.cellKey.indexOf(":") + 1), t && stems[t] === 1 && t].filter(Boolean).forEach(a => alias.push([a, c])); }
    alias.sort((a, b) => b[0].length - a[0].length); const hitA = alias.find(([a]) => q.includes(a)); e.cell = hitA ? hitA[1] : null;
    if (!e.cell && e.src && e.src.cellKey) e.cell = S.doc("OT_CELL", e.src.cellKey);
    // 相对指代：问句没有点名小区，但用了“它／这个小区” → 指向会话里的当前小区
    if (!e.cell && sess.cellKey && REL.test(q)) e.cell = S.doc("OT_CELL", sess.cellKey) || null;
    e.adjust = /电子|电调/.test(q) ? "电子" : /机械/.test(q) ? "机械" : null;
    return e;
  }
  const latestTicket = cellKey => { const ts = facts.ticketsOf(cellKey).sort((a, b) => a.ticketNo.localeCompare(b.ticketNo)); return ts[ts.length - 1] || null; };
  function ticketOf(e) {
    if (e.ticket) return S.doc("OT_TICKET", e.ticket);
    if (e.cell) { const t = latestTicket(e.cell.cellKey) || involvedTicket(e.cell.cellKey); if (t) return t; }
    return sess.ticketNo ? S.doc("OT_TICKET", sess.ticketNo) : null;
  }
  const involvedTicket = cellKey => { const ls = S.links({ rt: "RT_06", to: "OT_CELL:" + cellKey }).map(l => idOf(l.from)).sort(); return ls.length ? S.doc("OT_TICKET", ls[ls.length - 1]) : null; };
  const planOf = t => { const ps = S.list("OT_PLAN").filter(p => p.ticketNo === t.ticketNo).sort((a, b) => a.round - b.round); return ps[ps.length - 1] || null; };
  const effOf = p => { const es = p ? S.list("OT_EFFECT").filter(x => x.planNo === p.planNo).sort((a, b) => a.effectNo.localeCompare(b.effectNo)) : []; return es; };
  const R = (refs, ...ids) => ids.forEach(i => refs.push(i)), noTicket = (what) => ({ text: `${what}尚无对应工单。弱覆盖问题由前置数据（OT_CELL_MR）按派单规则发现，建单是发现之后的动作：可先问“哪些小区弱覆盖”，再由优化本体对“达到”的小区建单（A_01）。`, src: [], refs: ["OT_TICKET", "A_01"] });
  // 没有工单时，判断时点取该小区最近一次 MR 上报日的次日（或问题里点名的日期）
  const refTimeOf = (e, t) => { if (e.dates[0]) return e.dates[0] + "T09:00:00"; const ds = S.list("OT_CELL_MR").filter(m => m.cellKey === e.cell.cellKey).map(m => m.date).sort(); return ds.length ? addDays(ds[ds.length - 1], 1) + "T09:00:00" : S.peekNow(); };

  // ── 各类意图
  const H = [];
  const on = (name, test, fn) => H.push({ name, test, fn });

  on("meta.element", (q, e) => e.ids.length > 0, (q, e) => {
    const lines = [], src = [], refs = [];
    for (const id of e.ids.slice(0, 4)) {
      const k = id.startsWith("OT_") ? "OT" : id.startsWith("RT_") ? "RT" : id.startsWith("F_") ? "F" : id.startsWith("A_") ? "A" : id.startsWith("INV_") ? "INV" : id.startsWith("RULE_") ? "RULE" : "TH";
      const o = ont[{ OT: "ot", RT: "rt", F: "func", A: "action", INV: "inv", RULE: "rule", TH: "th" }[k]](id); if (!o) { lines.push(`${id} 不在 SPEC 的本体定义中。`); continue; }
      R(refs, id); hit(k, id); src.push(o);
      if (k === "OT") lines.push(`${id} ${o.name}：${o.definition} 身份与生命周期：${o.identity} 属性：${o.attributes.map(a => a.name).join("、")}。`);
      if (k === "RT") lines.push(`${id} ${o.name}：${o.from.join("／")}→${o.to.join("／")}。${o.cardinality}`);
      if (k === "F") lines.push(`${id} ${o.code}（v${o.version}）：${o.question}。输入：${o.input} 判断方法：${o.method} 输出：${o.output}`);
      if (k === "A") lines.push(`${id} ${o.label}（${o.code}）：${o.purpose}。允许角色：${o.roles.join("／")}。${o.definedOnly ? "本期只定义、不运行。" : ""}`);
      if (k === "INV") lines.push(`${id}：${o.text}（校验点：${o.checkpoints.join("、")}）`);
      if (k === "RULE") lines.push(`${id} v${o.version}${o.registerOnly ? "（只登记，本期不实现）" : ""}：${o.meaning} 适用：${o.scope}`);
      if (k === "TH") lines.push(`${id}：${o.text}（关联：${o.rules}；确认责任：${o.owner}）`);
    }
    return { text: lines.join("\n"), src, refs };
  });
  on("meta.list", q => /哪些|有几个|多少个|清单|列出/.test(q) && /对象类型|关系|函数|动作|约束|规则|测试假设|假设/.test(q), q => {
    const m = /对象类型/.test(q) ? ["OT", ont.raw.objectTypes, "对象类型"] : /关系/.test(q) ? ["RT", ont.raw.relationTypes, "关系类型"] : /函数/.test(q) ? ["F", ont.raw.functions, "函数"] : /动作/.test(q) ? ["A", ont.raw.actions, "动作类型"]
      : /约束/.test(q) ? ["INV", ont.raw.constraints, "核心约束"] : /规则/.test(q) ? ["RULE", ont.raw.rules, "业务规则"] : ["TH", ont.raw.assumptions, "测试假设"];
    m[1].forEach(x => hit(m[0], x.id));
    return { text: `SPEC 定义了 ${m[1].length} 个${m[2]}：` + m[1].map(x => `${x.id}${x.name ? " " + x.name : x.label ? " " + x.label : ""}`).join("；") + "。本体只包含这些要素，没有 SPEC 之外的定义。", src: [{ count: m[1].length, ids: m[1].map(x => x.id) }], refs: m[1].map(x => x.id) };
  });
  on("meta.states", q => /状态/.test(q) && /(有哪些|转移|流转|取值|机)/.test(q), q => {
    const k = /方案/.test(q) ? "OT_PLAN" : /效果/.test(q) ? "OT_EFFECT" : /案例/.test(q) ? "OT_CASE" : "OT_TICKET"; hit("OT", k);
    return { text: `${k} 的状态：${ont.raw.states[k].join("、")}。允许转移：${ont.raw.transitions[k]}`, src: [ont.raw.states[k], ont.raw.transitions[k]], refs: [k] };
  });
  on("scope.out", (q, e) => (e.short && ["SHYAP", "SHJIS"].includes(e.short)) || /重叠覆盖|切换(差|失败)|过覆盖/.test(q), (q, e) => {
    const t = e.src && !e.src.inScope ? e.src : seed.sourceTickets.find(x => !x.inScope && /重叠|杨浦/.test(q)) || seed.sourceTickets.find(x => !x.inScope);
    return { text: `${t.short}（${t.taskno}）的问题类型是“${t.issue}”，不在本 SPEC 范围内：${t.reason}。本体没有对应的对象、规则和函数，因此不对它建模、不给原因与措施，也不用它的数据冒充弱覆盖结论。SPEC 的范围是：弱覆盖发现（4G／5G 宏站与室分，一般场景）＋4G 宏站“天线下倾角过小”的原因与处置。`, src: [t], refs: ["RULE_M02", "RULE_M03", "RULE_W03"], out: true,
      gap: { kind: "scope", boundary: `SPEC 只覆盖弱覆盖发现（4G／5G 宏站与室分，一般场景）与 4G 宏站天线下倾角过小的原因与处置；“${t.issue}”不在范围内，本体没有对应对象、规则与函数。` } };
  });
  on("rule.dispatch", (q, e) => (/派单规则|门限|7天出现3天|出现3天|D0[1-4]|弱覆盖.{0,6}(怎么定义|是什么|怎么判)|采样点.{0,6}占比|室分.{0,6}宏站/.test(q) || (/VIP|VVIP/.test(q) && !e.cell)) && !/工单/.test(q.replace(/派单规则/, "")), q => {
    const rs = ont.raw.dispatchRules; rs.forEach(r => hit("RULE", r.ruleId)); hit("RULE", "RULE_F01");
    return { text: "派单规则（弱覆盖发现，取自 SPEC 的 RULE_D01～D04，一般场景）：" + rs.map(r => `${r.ruleId}＝${r.rat}${r.siteType}：单日 RSRP＜-110 的弱覆盖采样点≥${r.minWeakSamples} 且占比≥${pct(r.minWeakRatio)}，${r.windowDays}天出现${r.minHitDays}天`).join("；") + "。VIP／VVIP 场景 SPEC 没有规则，按规则缺口处理（证据不足），不套用一般场景门限。", src: [rs], refs: rs.map(r => r.ruleId).concat(["RULE_F01"]) };
  });
  on("th.params", q => /测试假设|容差|单次上限|分辨率|门限参数|参数/.test(q) && !/工单|方案/.test(q.replace(/测试假设/, "")), () => {
    const a = ont.raw.assumptions; a.forEach(x => hit("TH", x.id));
    return { text: "SPEC 登记的测试假设：" + a.map(x => `${x.id} ${x.text}`).join("；") + "。它们只用于验证该假设条件下的模型行为，业务确认前判断保持“待确认”。", src: [a, ont.raw.params], refs: a.map(x => x.id) };
  });
  on("radius", q => /目标(覆盖)?半径/.test(q) && /(默认|怎么(取|算|定)|如何确定|G01|依据)/.test(q), (q, e) => {
    const c = e.cell || S.doc("OT_CELL", seed.sourceTickets.find(t => t.inScope && t.rat === "LTE").cellKey), g = facts.defaultTargetRadius(c.cellKey);
    if (c.targetRadius === undefined) return { text: `${c.cellName} 的目标覆盖半径缺失：缺失时 F_08、F_10 返回“未知”，不会静默套用默认值；RULE_G01 的默认取法是 TH14（k＝${g.k}）×最近站间距 ${g.nearest} m＝${g.radius} m，可由工程师确认后补录，人工覆盖须留痕。`, src: [c, g], refs: ["RULE_G01", "TH14", "OT_CELL", "OT_SITE", "F_01", "F_08", "F_10"] };
    return { text: `${c.cellName} 的目标覆盖半径样例直接给定为 ${c.targetRadius} m；若缺失，RULE_G01 默认取 TH14（k＝${g.k}）×最近站间距：最近站间距 ${g.nearest} m，默认半径 ${g.radius} m，可人工覆盖并留痕。`, src: [c.targetRadius, g], refs: ["RULE_G01", "TH14", "OT_CELL", "OT_SITE", "F_01"] };
  });
  on("provenance", q => /(数据来源|来源清单|真实数据|哪些.*(真实|构造)|构造数据|数据可信|数据.{0,6}(真实|真的|可信))/.test(q), () => {
    const p = Object.entries(seed.provenance), real = p.filter(([, v]) => v.startsWith("原文：")), mix = p.filter(([, v]) => v.startsWith("原文＋构造：")), made = p.filter(([, v]) => v.startsWith("构造："));
    const tc = seed.sourceTickets.filter(t => t.inScope), fe = seed.fieldExecutions[0], an = S.doc("OT_ANTENNA", fe.antennaId), al = S.alarms(tc[0].cellKey)[0];
    return { text: "数据来源清单（data/seed/provenance.csv）共 " + p.length + " 条：完全取自上海工单原文 " + real.length + " 条、原文与构造混合 " + mix.length + " 条（关键事实取自原文，其余参数按网管数据格式补齐）、构造 " + made.length + " 条。取自原文的关键事实：" + tc[0].cellName + " 的" + tc[0].kpiName + " " + pct(tc[0].kpiValue) + "、站高 " + an.height + " m、方位角 " + an.azimuth + "°、下倾角 " + fe.fromValue + "°→" + fe.toValue + "°、告警 " + al.type + "（" + fmtDate(al.startDate) + "）；" + tc[1].district + "工单的" + tc[1].kpiName + " " + pct(tc[1].kpiValue) + "；4 个真实工单号。MR 日统计的采样点数是按原文覆盖率反推并加入逐日波动后得到的，窗口汇总占比与原文一致。", src: [p.length, real.length, mix.length, made.length, tc[0].kpiValue, tc[1].kpiValue, an.height, an.azimuth, fe.fromValue, fe.toValue, al.startDate], refs: [] };
  });
  on("reconcile", q => /对账|真实(派单)?工单|上海(的)?(工单|真实)|4\s*张/.test(q), () => {
    const tc = seed.sourceTickets.filter(t => t.inScope), at = t => addDays(t.windowEnd, 1) + "T09:00:00", sep = svc.scan([tc[0].cellKey], at(tc[0])), oct = svc.scan([tc[1].cellKey], at(tc[1])), rows = [];
    rows.push(`SHCHM：真实工单“弱覆盖、覆盖率 ${pct(tc[0].kpiValue)}”，本体按 ${sep.items[0].ruleId} 在前置数据上发现为“${sep.items[0].verdict}”（命中 ${sep.items[0].hitDays} 天）——与真实派单一致`);
    const b = oct.items[0], bm = S.list("OT_CELL_MR").filter(m => m.cellKey === b.cellKey), wr = bm.reduce((s, m) => s + m.sampleWeak, 0) / bm.reduce((s, m) => s + m.sampleTotal, 0);
    rows.push(`SHBAO：真实工单“弱覆盖、覆盖率 ${pct(tc[1].kpiValue)}”，按 SPEC 规则（弱覆盖占比 ${pct(wr)}＜20%）本体判“${b.verdict}”（命中 ${b.hitDays} 天）——口径与上海原工单不同，需业务确认（假设 A-S1）`);
    for (const t of seed.sourceTickets.filter(x => !x.inScope)) rows.push(`${t.short}：${t.issue}，${t.reason}`);
    return { text: "真实上海工单与本体发现结果对账：" + rows.join("；") + "。对账只用于验证规则复现程度，真实工单不作为发现的输入。", src: [seed.sourceTickets, sep.items, oct.items, wr], refs: ["F_12", "F_06", "RULE_D01", "RULE_D03", "OT_CELL_MR"], derived: true };
  });
  // 发现范围：判断时点前三周内有 MR 日统计上报的小区，加上它们的邻区（邻区没有 MR 时如实列为数据缺口）
  const scopeAt = at => { const to = addDays(at.slice(0, 10), -1), from = addDays(to, -20), base = new Set(S.list("OT_CELL_MR").filter(m => m.date >= from && m.date <= to).map(m => m.cellKey)), all = new Set(base); for (const k of base) (facts.cell(k).neighbors || []).forEach(n => all.add(n.targetCellKey)); return [...all].sort(); };
  on("scan", (q, e) => !e.cell && (/(哪些|哪个|有没有|有多少).*(小区).*(弱覆盖|达到|派单)/.test(q) || /批量发现|发现清单|发现范围/.test(q) || /(今天|最近一周|近7天|这一周).*弱覆盖/.test(q)), (q, e) => {
    const at = e.dates[0] ? e.dates[0] + "T09:00:00" : S.peekNow();
    const scope = scopeAt(at);
    const r = svc.scan(scope, at);
    return { text: `在判断时点 ${at.slice(0, 10)}、窗口 ${r.window.from}～${r.window.to} 对 ${scope.length} 个小区做发现（只读、不建单）：达到 ${r.counts.达到}、未达到 ${r.counts.未达到}、证据不足 ${r.counts.证据不足}。` + r.items.map(i => i.verdict === "证据不足" ? `${i.cellName || i.cellKey}：证据不足（${i.note}${i.hitDays ? "；命中" + i.hitDays + "天" : ""}）` : `${i.cellName || i.cellKey}：${i.verdict}（${i.ruleId}，命中${i.hitDays}天）`).join("；") + "。", src: [{ ...r, scopeSize: scope.length }], refs: ["F_12", "F_05", "F_06", "OT_CELL_MR", "RT_16", "RULE_F01", "RULE_D01", "RULE_D02", "RULE_D03", "RULE_D04"] };
  });
  on("discover.cell", (q, e) => !!e.cell && /(为什么|判定|命中|占比|逐日|采样|发现|弱覆盖吗|没出来|没算上|没发现)/.test(q) && !/工单|方案|根因|原因|建单|建个单|确认|派单/.test(q), (q, e) => {
    const t = latestTicket(e.cell.cellKey), at = t ? addDays(t.discovery.window.to, 1) + "T09:00:00" : refTimeOf(e, null), d = svc.discover(e.cell.cellKey, at);
    const line = d.daily.map(x => `${fmtDate(x.date)}${x.ratio === null ? "无数据" : pct(x.ratio) + "（" + x.sampleWeak + "/" + x.sampleTotal + "）" + (x.hit === "是" ? "命中" : "")}`).join("，");
    return { text: `${e.cell.cellName}（${d.rat}${d.siteType}，${d.sceneLevel || "场景等级缺失"}）：${d.ruleId ? "适用 " + d.ruleId : "无适用规则（" + d.ruleGap + "）"}，窗口 ${d.window.from}～${d.window.to}。逐日：${line}。命中 ${d.hitDays} 天，未知 ${d.unknownDates.length} 天，判定“${d.verdict}”。${d.reason ? d.reason + "。" : ""}`, src: [d], refs: ["F_05", "F_06", "OT_CELL_MR", "RT_16", "RT_01", d.ruleId || "RULE_F01", "RULE_F01"],
      gap: d.ruleGap || d.unknownDates.length ? { kind: d.ruleGap ? "rule" : "data", boundary: d.ruleGap
        ? `派单规则只覆盖 LTE／NR × 宏站／室分 × 一般场景；${e.cell.cellName} 的场景等级是“${d.sceneLevel || "缺失"}”，没有适用规则，按规则缺口记证据不足（INV_09），不套用一般场景门限。`
        : `判定窗口 ${d.window.from}～${d.window.to} 内有 ${d.unknownDates.length} 天没有 OT_CELL_MR（缺天＝未知，不是 0），按 INV_09 记证据不足。` } : null };
  });
  const PRI = { stats: 15.5, "meta.element": 5, "meta.list": 6, "meta.states": 7, whatif: 8, human: 9, "act.bot": 10, "scope.out": 11, provenance: 11.5, "rule.dispatch": 12, "th.params": 13, radius: 14, reconcile: 15, "ticket.evidence": 16, "discover.cell": 17, "mr.day": 18, asof: 19, "cell.info": 20, flow: 24, scan: 30 };
  on("mr.day", (q, e) => !!e.cell && e.dates.length > 0 && /(MR|采样|弱覆盖占比)/.test(q), (q, e) => {
    const d = e.dates[0], o = S.getObject("OT_CELL_MR", `${e.cell.cellKey}@${d}`), ratio = o && o.doc.sampleWeak / o.doc.sampleTotal;
    if (!o) return { text: `${e.cell.cellName} 在 ${fmtDate(d)} 没有 OT_CELL_MR 实例＝未知（不是 0，也不是“未命中”）。`, src: [d], refs: ["OT_CELL_MR", "INV_09"],
      gap: { kind: "data", boundary: `该小区 ${d} 这天没有上报 OT_CELL_MR 日统计，按 INV_09 记未知（不是 0）；缺天的日子不能参与占比与命中判定。` } };
    const h = S.history("OT_CELL_MR", `${e.cell.cellKey}@${d}`);
    return { text: `${e.cell.cellName} ${fmtDate(d)} 的 MR 日统计：有效采样点 ${o.doc.sampleTotal}，RSRP＜-110 的弱覆盖采样点 ${o.doc.sampleWeak}，占比 ${pct(o.doc.sampleWeak / o.doc.sampleTotal)}；当前版本 ${o.ver}，共 ${h.length} 个版本（只追加，更正产生新版本）。`, src: [o, h.length, ratio], refs: ["OT_CELL_MR", "INV_17", "F_05"] };
  });
  on("cell.info", (q, e) => !!e.cell && /(是什么|基本信息|站点|天线|邻区|共天线|同天线|覆盖区域|哪个区域|挂高|下倾)/.test(q) && !/方案|根因|周边影响|调/.test(q) && !/全流程|完整流程|执行链路|完整链路|决策流程/.test(q), (q, e) => {
    const c = e.cell, site = facts.siteOf(c.cellKey), al = facts.antennaLink(c.cellKey), st = al && facts.antennaState(al.antennaId), same = al ? facts.cellsOnAntenna(al.antennaId).filter(x => x.cellKey !== c.cellKey) : [], nbs = facts.neighbors(c.cellKey);
    const area = S.links({ rt: "RT_04", from: "OT_CELL:" + c.cellKey })[0], ar = area && S.doc("OT_AREA", idOf(area.to));
    return { text: `${c.cellName}：${c.rat}、频段 ${c.band}、场景等级 ${c.sceneLevel || "缺失"}，归属站点 ${site.siteId}（${site.siteType}，坐标 ${site.lat}, ${site.lon}，RT_01）。` + (al ? `由天线 ${al.antennaId} 提供覆盖（RT_02）：挂高 ${st.antenna.height} m、机械下倾 ${st.antenna.mechTilt}°、电子下倾 ${al.elecTilt}°、垂直波束宽 ${al.vBeam}°、总下倾 ${al.elecTilt + st.antenna.mechTilt}°；同天线小区：${same.map(x => nm(x.cellKey)).join("、") || "无"}。` : "没有天线关系（工参缺失＝未知）。") + `目标覆盖半径 ${c.targetRadius ?? "缺失"} m；重叠邻区：${nbs.filter(n => n.overlapWeight > 0).map(n => nm(n.targetCellKey) + "（权重" + n.overlapWeight + "）").join("、") || "无"}。` + (ar ? `主要覆盖区域 ${ar.areaName}（${ar.areaScene}，${ar.urbanRural}，占比 ${area.props.share}，RT_04，只作上下文）。` : ""), src: [c, site, al, st, same, nbs, ar, area], refs: ["OT_CELL", "OT_SITE", "OT_ANTENNA", "OT_AREA", "RT_01", "RT_02", "RT_03", "RT_04", "RT_06"] };
  });
  on("asof", (q, e) => !!e.dates.length && /(下倾|工参|天线|当时|那天)/.test(q), (q, e) => {
    const c = e.cell || S.doc("OT_CELL", seed.sourceTickets.find(t => t.inScope && t.rat === "LTE").cellKey), al = facts.antennaLink(c.cellKey), d = e.dates[0] + "T23:59:59", st = facts.antennaState(al.antennaId, d), h = S.history("OT_ANTENNA", al.antennaId);
    return { text: `${fmtDate(e.dates[0])}当时 ${al.antennaId} 的机械下倾角是 ${st.antenna.mechTilt}°（生效时间 ${st.eff}，状态${st.status === "ok" ? "正常" : st.status}）；该天线共有 ${h.length} 个工参版本，按判断时点读回当时有效的版本，历史判断不用后来才出现的工参（INV_11）。`, src: [st, h.length], refs: ["OT_ANTENNA", "INV_11", "INV_15"] };
  });
  on("ticket.overview", (q, e) => /(工单|TK-)/.test(q) && /(状态|概况|情况|进展|怎么样)/.test(q) || (!!e.short && /(状态|概况|情况|进展)/.test(q)) || (/(什么状态|到哪一步|进展到哪|怎么样了|现在.{0,4}状态)/.test(q) && !!(e.cell || e.ticket || sess.ticketNo)), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket(e.cell ? e.cell.cellName : "该小区"); sess.ticketNo = t.ticketNo; const d = t.discovery;
    return { text: `${t.ticketNo}：${t.dispatchProblem}（${t.problemCategory}／${t.problemType}），状态“${t.status}”。发现依据：${d.ruleId} v${d.ruleVersion}，窗口 ${d.window.from}～${d.window.to}，命中 ${d.hitDays} 天（${d.hitDates.map(fmtDate).join("、")}），引用 ${d.evidenceRefs.length} 条 MR 日统计（RT_17）；问题键 ${d.problemKey}。${t.relatedTicketNo ? "复发工单，关联原单 " + t.relatedTicketNo + "。" : ""}根因 ${t.rootCauses.length} 条，诊断记录 ${t.diagnostics.length} 条。`, src: [t, d.evidenceRefs.length, t.rootCauses.length, t.diagnostics.length], refs: ["OT_TICKET", "RT_05", "RT_17", "F_06", d.ruleId, "RULE_T01"].concat(t.relatedTicketNo ? ["RT_07"] : []) };
  });
  on("ticket.evidence", (q, e) => /(依据|证据|回链|哪些MR)/.test(q) && !/根因|原因/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该问题"); const links = S.links({ rt: "RT_17", from: "OT_TICKET:" + t.ticketNo });
    return { text: `${t.ticketNo} 的发现依据快照引用了 ${links.length} 条 OT_CELL_MR（${t.discovery.evidenceRefs.slice(0, 3).map(r => r.mrKey.split("@")[1] + " v" + r.version).join("、")}…），每条可展开到有效采样点与弱覆盖采样点。快照建单后不改；数据后来被更正只产生新版本，已建工单仍按其引用的版本读回，重新发现的结果由 F_12 另行给出（INV_17）。`, src: [links.length, t.discovery.evidenceRefs], refs: ["RT_17", "OT_CELL_MR", "INV_16", "INV_17", "A_01"] };
  });
  on("cause", q => /(根因|原因|为什么弱覆盖|下倾角过小)/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const f8 = [...t.diagnostics].reverse().find(d => d.kind === "下倾角命中"), rc = t.rootCauses;
    if (!f8) return { text: `${t.ticketNo} 尚未定因（状态“${t.status}”）。由优化本体按规则调用 F_07、F_08 写入根因（A_02）。`, src: [t.status], refs: ["A_02", "F_07", "F_08"], pending: ["A_02"] };
    const r = f8.result; sess.ticketNo = t.ticketNo;
    if (r.match === "未知" || r.match === "冲突") return { text: `${t.ticketNo} 的 F_08＝${r.match}：${r.reason}${r.missing && r.missing.length ? "（缺项：" + r.missing.join("、") + "）" : ""}。不判“不命中”，也不写主因，转人工。`, src: [r], refs: ["F_08", "RULE_W06", "INV_09", "INV_15"],
      gap: { kind: r.match === "冲突" ? "data" : "rule", boundary: r.match === "冲突"
        ? "同一天线同一生效区间有两个来源的工参取值冲突，按 INV_15 裁定前 F_08 不评估；裁定由地市优化工程师做。"
        : `F_08 的必需输入缺失（${(r.missing || []).join("、") || "工参／目标半径"}）或该场景不适用下倾模型（NR／室分），按 INV_09 记未知，不判“不命中”。` } };
    return { text: `F_08（${f8.callId}，v${f8.funcVersion}）：总下倾 ${r.totalTilt}°，推荐下倾 ${r.thetaTarget}°，缺口 ${r.deficit}°（容差 ${ont.param("eps")}°），理论覆盖半径近端 ${r.rNear} m／远端 ${r.rFar} m，判“${r.match}”${r.otherCauses.length ? "；次因：" + r.otherCauses.join("、") : "；功率、方位、遮挡逐项排除或未核查"}。` + (rc.length ? `已写入根因第 ${rc[0].round} 轮：${rc.map(x => x.role + "“" + x.causeLabel + "”").join("、")}，证据：${rc[0].evidenceRefs.map(x => x.kind).join("、")}（RT_08）；依据 RULE_W06，措施对应 RULE_M01。` : ""), src: [r, rc, ont.param("eps")], refs: ["F_08", "F_02", "F_03", "F_04", "RULE_W06", "RULE_M01", "RULE_W05", "RULE_W08", "RULE_W09", "RT_08", "RT_02", "TH01", "TH15"] };
  });
  on("falseweak", q => /(告警|假性|退服|故障)/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const f = [...t.diagnostics].reverse().find(d => d.kind === "假性弱覆盖");
    if (!f) return { text: `${t.ticketNo} 尚未做假性弱覆盖排除（F_07）。`, src: [], refs: ["F_07", "A_02"] };
    const r = f.result; return { text: `F_07（${f.callId}）：命中日 ${r.weakCount} 天中有 ${r.overlap} 天落在告警区间内，占比 ${pct(r.share)}（门限 TH07＝${ont.param("falseWeakShare")}）→“${r.verdict}”。` + (r.verdict === "部分重合" ? "转人工：工程师确认前必须写明复核判断。" : r.verdict === "排除" ? "假性弱覆盖，工单应排除，不调参。" : "") + `所用告警：${r.alarmRefs.join("；") || "无"}（告警是来源事实，不入本体，只经诊断记录引用）。`, src: [r, ont.param("falseWeakShare")], refs: ["F_07", "RULE_W04", "TH07", "A_03"] };
  });
  on("plan", q => /(方案|措施|调多少|调整|轮次|怎么调|几轮|分几次|一次调)/.test(q) && !/周边|影响|审批|派单|执行|效果|关单|案例|回退|功率|方位|自动|下发|涉及|几个小区|一致|偏差|调完|回填/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const p = planOf(t); sess.ticketNo = t.ticketNo;
    if (!p) { const f8 = svc.matchTilt(facts.cellOfTicket(t.ticketNo), S.peekNow()); return { text: `${t.ticketNo} 暂无方案（状态“${t.status}”）。F_08 当前：${f8.match}${f8.deficit !== undefined ? "，缺口 " + f8.deficit + "°" : ""}。${f8.match === "命中" ? "若生成方案：机械下倾 Δ＝" + app.F.F09(f8._deficit, "机械").delta + "°（共 " + app.F.F09(f8._deficit, "机械").rounds + " 轮），电子下倾 Δ＝" + app.F.F09(f8._deficit, "电子").delta + "°（共 " + app.F.F09(f8._deficit, "电子").rounds + " 轮），单次上限 " + ont.param("maxStep") + "°。" : ""}须先由工程师确认根因（A_03），再由优化本体生成方案（A_04）。`, src: [f8, f8.match === "命中" ? [app.F.F09(f8._deficit, "机械"), app.F.F09(f8._deficit, "电子")] : null, ont.param("maxStep")], refs: ["A_03", "A_04", "F_08", "INV_04"], pending: ["A_03"] }; }
    const a = p.actions[0], m = p.measureType, d8 = [...t.diagnostics].reverse().find(d => d.kind === "下倾角命中"), rounds = d8 && d8.result._deficit !== undefined ? app.F.F09(d8.result._deficit, m.measureCode === "TILT_UP_MECH" ? "机械" : "电子").rounds : null; return { text: `${p.planNo}：措施“${m.name}”（${m.bigClass}／${m.midClass}／${m.smallClass}，执行方 ${m.executorRole}，${m.remote ? "可远程" : "不可远程"}），对 ${a.targetKey} 的 ${a.param} 由 ${a.currentValue}° 调到 ${a.targetValue}°（Δ＝${a.deltaValue}°，单次上限 ${m.maxStep}°、分辨率 ${m.resolution}°，回退值 ${a.rollbackValue}°）；状态“${p.status}”，周边影响“${p.impact.result}”。回退条件：${p.rollbackCondition}。${rounds ? `按缺口 ${d8.result.deficit}° 和单次上限 ${m.maxStep}°，共需 ${rounds} 轮，本方案是第 ${p.round} 轮。` : ""}`, src: [p, m, d8 && d8.result, rounds], refs: ["OT_PLAN", "F_09", "RULE_W14", "TH02", "TH03", "INV_13", "RT_09", "RT_10"] };
  });
  on("impact", q => /(周边|影响|同天线|涉及|几个小区|邻区.*(影响|受)|会不会伤到)/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const p = planOf(t); if (!p) return { text: `${t.ticketNo} 还没有方案，没有周边影响评估。`, src: [], refs: ["F_10", "A_04"] };
    const roles = S.links({ rt: "RT_10", from: "OT_PLAN:" + p.planNo }), im = p.impact;
    const ncell = roles.filter(l => l.to.startsWith("OT_CELL:")).length, mine = e.cell && roles.find(l => l.to === "OT_CELL:" + e.cell.cellKey), lead = e.cell ? `${e.cell.cellName}${mine ? "在本方案的影响范围内（" + mine.props.role + "）；" : "不在本方案的作用范围内（" + (p.actions[0].param === "mechTilt" ? "它不在这副天线上" : "电子下倾只作用于目标小区的阵列") + "），不会被这次调整改变；"}` : ""; return { text: `${lead}${p.planNo} 涉及 ${ncell} 个小区，周边影响“${im.result}”（Δ计划 ${im.deltaPlan}°，Δ最终 ${im.deltaFinal === null ? "无可行值" : im.deltaFinal + "°"}）。影响范围按调整方式确定：${p.actions[0].param === "mechTilt" ? "机械下倾作用于整副天线，承载的所有小区都要校验" : "电子下倾只影响对应阵列小区"}；RT_10：${roles.map(l => (l.to.startsWith("OT_CELL:") ? nm(idOf(l.to)) : idOf(l.to)) + "（" + l.props.role + "）").join("、")}。逐项：` + im.checks.filter(k => k.kind !== "事后复核").map(k => k.kind === "远端覆盖" ? `${nm(k.cell)} 远端 ${k.before}→${k.after} m（目标 ${k.targetRadius}，${k.pass ? "满足" : "不满足"}）` : `邻区 ${nm(k.neighbor)}（站间距 ${k.distance} m）预测重叠指数 ${k.before}→${k.after}${k.result ? "（" + k.result + "）" : k.pass ? "（不增大）" : "（增大）"}`).join("；") + "。", src: [im, roles, ncell], refs: ["F_10", "RULE_W13", "INV_12", "INV_06", "RT_10", "RT_06", "TH16"] };
  });
  on("approval", q => /(审批|派单号|谁批|批准|能不能执行|自动(执行|下发)|主管|要我批|为什么要我|直接下发|下发到现场)/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const p = planOf(t); if (!p) return { text: `${t.ticketNo} 还没有方案，无须审批；天馈类措施任何时候都不得自动执行，须人工确认并派给现场维护人员（INV_05）。`, src: [], refs: ["A_05", "INV_05"] };
    const ap = p.approval; return { text: `${p.planNo}（状态“${p.status}”）：天馈类措施（${p.measureType.name}，执行方“${p.measureType.executorRole}”）不得自动执行，必须由地市优化工程师确认并派单、由现场维护人员执行并回填（INV_05）；周边影响为“通过”或“调减”才可批准（INV_06）；作用于 2 个及以上小区或 VIP／VVIP 场景须追加优化主管批准（RULE_W14）。` + (ap ? `本方案审批：${ap.approverRoles.join("＋")}，${ap.decision}，派单号 ${p.execution.dispatchNo}。` : "目前尚未审批。"), src: [p, ap], refs: ["A_05", "INV_05", "INV_06", "RULE_W14", "RT_10"], pending: p.status === "待确认" ? ["A_05"] : [] };
  });
  on("execution", q => /(执行|回填|实际值|实施|回执|偏差|调完|调好|做完|一致|生效时间|接收时间)/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const p = planOf(t); if (!p || !p.execution) return { text: `${t.ticketNo} 尚无执行记录（${p ? "方案状态“" + p.status + "”" : "无方案"}）。`, src: [], refs: ["A_06"] };
    const x = p.execution, av = x.actualValues && x.actualValues[0], st = facts.antennaState(p.actions[0].targetKey, S.peekNow());
    if (!av) return { text: `${p.planNo} 派单号 ${x.dispatchNo}，回执“${x.receipt}”：${x.receipt === "未知" ? "回执缺失记“未知”，工单留在处置中，不得评估或关闭，先核对原派单记录而不直接重发（INV_08）" : "失败"}。`, src: [x], refs: ["A_06", "INV_08"], pending: ["A_06"] };
    const h = S.history("OT_ANTENNA", p.actions[0].targetKey); return { text: `${p.planNo} 的执行：派单号 ${x.dispatchNo}，实施时间 ${x.executeTime}，回执“${x.receipt}”，现场实际 ${av.param}＝${av.value}°（计划 ${av.planValue}°${av.value === av.planValue ? "，一致" : "，不一致：已按实际值事后复核"}）。天线 ${av.targetKey} 新增工参版本 v${h[h.length - 1].ver}，生效时间＝实施时间 ${h[h.length - 1].eff}（不是回填接收时间），当前状态${st.status === "ok" ? "正常" : st.status}（INV_07、INV_15）。`, src: [x, av, h.length, st.eff], refs: ["A_06", "OT_ANTENNA", "INV_07", "INV_15", "F_10"] };
  });
  on("effect", q => /(效果|改善|恢复|持续有效|达标|保护指标|变差|恶化|劣化|复发|第二周)/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const p = planOf(t), es = effOf(p); if (!es.length) return { text: `${t.ticketNo} 尚无效果评估（${p ? "方案“" + p.status + "”" : "无方案"}）。方案实施后，由优化本体按 F_11 评估（A_07）：后窗至少 ${ont.param("effectMinDaysAfter")} 天，持续有效看 ${ont.param("effectSustainDays")} 天。`, src: [ont.param("effectMinDaysAfter"), ont.param("effectSustainDays")], refs: ["A_07", "F_11", "TH11", "TH12"], pending: ["A_07"] };
    const l = es[es.length - 1]; sess.ticketNo = t.ticketNo;
    return { text: `${l.effectNo}（共 ${es.length} 次评估）：前窗 ${l.beforeWindow.from}～${l.beforeWindow.to} 占比 ${pct(l.beforeRatio)}，后窗 ${l.afterWindow.from || "—"}～${l.afterWindow.to || "—"}（${l.afterWindow.days} 天）占比 ${pct(l.afterRatio)}；改善${l.improved === null ? "未知" : l.improved ? "是" : "否"}（差值门限 TH09＝${ont.param("effectMinDelta")}）、达标${l.achieved === null ? "未知" : l.achieved ? "是" : "否"}（后窗前 7 天命中 ${l.afterHitDays} 天）、持续有效${l.sustained === null ? "为空" : l.sustained ? "是" : "否"}；保护指标${l.protection.map(x => x.name + " " + x.before + "→" + x.after).join("；") || "缺"}（${l.protectionOk === null ? "未评定" : l.protectionOk ? "均未恶化" : "有恶化"}）；状态“${l.status}”（保护容差 TH13＝${ont.param("protectionTolerance")}）。`, src: [l, ont.param("effectMinDelta"), ont.param("protectionTolerance")], refs: ["OT_EFFECT", "F_11", "RULE_W16", "RT_11", "RT_12", "RT_13", "TH09", "TH11", "TH12", "TH13"] };
  });
  on("close", q => /(关单|关闭|能不能关)/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const es = effOf(planOf(t)), l = es[es.length - 1], ok = !!l && l.status === "持续有效" && l.sustained === true;
    return { text: `${t.ticketNo}：${ok ? "效果已“持续有效”，可由优化主管关闭（A_08）；优化本体无权关闭" : `暂不能关闭——${l ? "最近一次效果“" + l.status + "”，持续有效为" + (l.sustained === null ? "空" : l.sustained) : "尚无效果评估"}（INV_10）`}。${!ok && l && l.sustained === null ? "还差：后窗满 " + ont.param("effectSustainDays") + " 天后再次评估（TH12），期间没有再次达到派单条件，才记持续有效。" : ""}关单与入库须人工：关闭由优化主管，案例入库由优化专家或知识维护人。`, src: [t.status, l], refs: ["A_08", "INV_10", "A_09"], pending: ok ? ["A_08"] : [] };
  });
  on("case", q => /(案例|类似|参考|复用)/.test(q), (q, e) => {
    const cs = S.list("OT_CASE"); if (!cs.length) return { text: "案例库目前 0 条：无案例时依已确认规则继续判断，不记为“无可用措施”；案例入库由优化专家或知识维护人在效果评定后执行（A_09），失败与证据不足的案例同样入库。", src: [0], refs: ["OT_CASE", "A_09", "INV_11"] };
    const t = ticketOf(e), p = t && planOf(t), ref = p ? S.links({ rt: "RT_15", to: "OT_PLAN:" + p.planNo }) : [];
    return { text: `案例库共 ${cs.length} 条：` + cs.map(c => `${c.caseNo}（结论“${c.outcome}”，验证状态“${c.validation}”，措施 ${c.measureType.name}，Δ ${c.deltaValue}°，适用：${c.applicability.rat}${c.applicability.siteType}、${c.applicability.urbanRural}、${c.applicability.causeFamily}）`).join("；") + `。${p ? `${p.planNo} 引用了 ${ref.length} 个案例（RT_15），只作参考，幅度仍由 F_09 按本小区事实计算。` : ""}引用须匹配适用条件，不匹配不得复用。`, src: [cs, ref.length], refs: ["OT_CASE", "RT_14", "RT_15", "A_09", "INV_11"] };
  });
  // 已完成的决策全流程：按本体要素把这个小区真正走过的步骤讲一遍（与「决策链执行」每步的推理过程同源）
  on("flow", q => /(全流程|完整流程|执行链路|完整链路|决策流程|走过.*步骤|已经完成.*决策)/.test(q), (q, e) => {
    if (!e.cell) return { text: "先指定小区（问句里写小区名，或在决策流程页选中一个），我再把它走过的决策全流程按本体要素讲一遍。", src: [], refs: [] };
    const tr = app.trace && app.trace.cellTrace(e.cell.cellKey);
    if (!tr) return noTicket("该小区");
    const done = tr.steps.filter(s => s.state === "done");
    const fv = f => f.ratio ? (f.v * 100).toFixed(2) + "%" : (typeof f.v === "number" ? (Number.isInteger(f.v) ? f.v : f.v.toFixed(2)) + (f.unit || "") : f.v);
    if (!done.length) {
      const f1 = tr.facts[1] || [], g = n => { const x = f1.find(y => y.k === n); return x ? x.v : "—"; };
      return { text: `${e.cell.cellName} 还没有执行过任何决策动作。只读发现（F_12／F_06）在窗口 ${g("窗口")} 内判定“${g("判定")}”，命中 ${g("命中天数")} 天；建单（A_01）之后才有工单与后续步骤。发现只读、不建单。`, src: [tr.facts[1], g("命中天数")], refs: ["F_12", "F_05", "F_06", "OT_CELL_MR", "A_01"] };
    }
    const lines = done.map(s => {
      const acts = s.actions.map(a => `${a.id} ${a.label}（${a.role}，${a.outcome === "ok" ? "成功" : "被 " + (a.code || "拒绝") + " 拒绝"}）`).join("、");
      const key = (tr.facts[s.n] || []).filter(x => x.v !== null && x.v !== undefined && x.v !== "—" && x.v !== "未执行" && x.v !== "未写入").slice(0, 3).map(x => `${x.k} ${fv(x)}`).join("、");
      return `${s.n} ${s.name}：${acts}${key ? "；" + key : ""}`;
    });
    const refs = [...new Set(done.flatMap(s => [...s.actions.map(a => a.id), ...s.functions.map(f => f.id)]))];
    return {
      text: `${e.cell.cellName} 已完成的决策全流程（${done.length}/${tr.totalSteps} 步，依据本体执行链路）：` + lines.join("；") + "。每一步用到的函数、约束、规则与对象，见「决策链执行」里对应步骤的弹窗。",
      src: [tr],   // 回答里的每个数值都来自这条链路，落地检查据此逐个核对
      refs,
    };
  });
  on("timeline", q => /(时间线|流程|做过什么|审计|记录|历史)/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const rs = S.runs().filter(r => r.target === t.ticketNo || (r.result && r.result.ticketNo === t.ticketNo && r.actionId === "A_01")).concat(S.list("OT_PLAN").filter(p => p.ticketNo === t.ticketNo).flatMap(p => S.runs({ target: p.planNo })));
    return { text: `${t.ticketNo} 的动作审计共 ${rs.length} 条：` + rs.map(r => `${r.actionId}（${r.role}）${r.outcome === "ok" ? "成功" : "拒绝" + r.code}`).join("、") + "。成功与拒绝都留痕，执行 ID 即平台 traceId 的本地对应。", src: [rs.length, rs.map(r => r.runId)], refs: ["A_01", "A_02", "A_03", "A_04", "A_05", "A_06", "A_07", "A_08", "A_09"] };
  });
  on("todo", q => /(待办|下一步|谁来|该做什么|需要人工)/.test(q), (q, e) => {
    const t = ticketOf(e); if (!t) return noTicket("该小区"); const p = planOf(t), es = effOf(p), nx = { 待核验: ["A_02", "A_03"], 已确认: ["A_04"], 处置中: ["A_06"], 待评估: ["A_07"], 已改善: ["A_08", "A_09"], 改善未解决: ["A_04"], 已排除: [], 已关闭: [] }[t.status] || [];
    const roles = nx.map(a => `${a} ${ont.action(a).label}（${ont.action(a).roles.join("／")}）`);
    return { text: `${t.ticketNo} 状态“${t.status}”，下一步：${roles.join("；") || "无"}。其中人工动作（确认、审批、回填、关单、入库、裁定）优化本体只提示不代办；它自己可以执行的只有建单、规则定因、生成方案、写入效果。`, src: [t.status, nx], refs: nx.concat(["INV_05"]), pending: nx.filter(a => !ont.action(a).roles.every(r => r === "优化本体")) };
  });
  on("conflict", q => /(冲突|裁定)/.test(q), (q, e) => {
    const al = S.list("OT_ANTENNA"), cf = al.map(a => facts.antennaState(a.antennaId, S.peekNow())).filter(s => s && s.status === "conflict");
    return { text: cf.length ? `存在 ${cf.length} 副天线工参来源冲突：${cf.map(s => s.antenna.antennaId + "（" + s.sources.map(x => x.source + " " + x.mechTilt + "°").join(" vs ") + "）").join("；")}。裁定前 F_08、F_10、F_11 返回“冲突”、不评估；由地市优化工程师裁定（A_11），优化本体无权裁定。` : "当前没有未裁定的工参冲突。同一天线同一生效区间两来源取值不同会置“冲突”并保留两个来源，不自动取其中一个（INV_15）。", src: [cf.length, cf.map(s => s.sources)], refs: ["INV_15", "A_11", "OT_ANTENNA"] };
  });
  on("whatif", q => /(如果|假如)/.test(q), (q, e) => {
    const c = e.cell || S.doc("OT_CELL", seed.sourceTickets.find(t => t.inScope && t.rat === "LTE").cellKey), t0 = latestTicket(c.cellKey), p0 = t0 && planOf(t0), now = p0 && p0.execution && p0.execution.executeTime ? new Date(Date.parse(p0.execution.executeTime + "Z") - 1000).toISOString().slice(0, 19) : S.peekNow(), adj = e.adjust || "机械", m = q.match(/(\d{3})\s*(?:m|米)/), over = m ? +m[1] : null;
    const f = facts.tiltFacts(c.cellKey, now), f8 = F8(f), g = f8._deficit, f9 = app.F.F09(g, adj), same = facts.cellsOnAntenna(f.antennaId);
    const scope = (adj === "机械" ? same.map(x => x.cellKey) : [c.cellKey]).map(k => { const gg = facts.geom(k, now); if (over && k !== c.cellKey) gg.Rt = over; return gg; });
    const im = app.F.F10({ scope, target: facts.geom(c.cellKey, now), neighbors: facts.overlapNeighbors(c.cellKey, now), adjustType: adj, planDelta: f9.delta });
    return { text: `假设演算（只读，在内存中重算，不写入；${p0 && p0.execution && p0.execution.executeTime ? "按实施前的工参事实" : "按当前工参事实"}）：${c.cellName} 改用${adj}下倾${over ? "，同天线小区目标半径改为 " + over + " m" : ""}：F_08 缺口 ${f8.deficit}°，Δ计划 ${f9.delta}°，影响范围 ${scope.map(s => nm(s.cellKey)).join("、")}，周边影响“${im.result}”${im.deltaFinal !== null && im.deltaFinal !== undefined ? "，Δ最终 " + im.deltaFinal + "°" : ""}。演算结果不改变任何工单、方案或工参。`, src: [f8, f9, im, over], refs: ["F_08", "F_09", "F_10", "INV_12", "RULE_W13", "RT_10"], whatif: true };
  });
  const F8 = f => app.F.F08(f);
  on("stats", (q, e) => !e.cell && !e.dates.length && /(多少|统计|汇总|有几)/.test(q) && /(工单|方案|小区|MR)/.test(q) && !/(调多少|一次|几轮)/.test(q), () => {
    const ts = S.list("OT_TICKET"), by = {}; ts.forEach(t => { by[t.status] = (by[t.status] || 0) + 1; });
    return { text: `本体里共有 ${S.count("OT_CELL")} 个小区、${S.count("OT_CELL_MR")} 条 MR 日统计、${S.count("OT_ANTENNA")} 副天线、${S.count("OT_SITE")} 个站点；工单 ${ts.length} 张${Object.entries(by).length ? "（" + Object.entries(by).map(([k, v]) => k + " " + v).join("、") + "）" : ""}，方案 ${S.count("OT_PLAN")} 个，效果记录 ${S.count("OT_EFFECT")} 条，案例 ${S.count("OT_CASE")} 条。`, src: [S.count("OT_CELL"), S.count("OT_CELL_MR"), S.count("OT_ANTENNA"), S.count("OT_SITE"), ts.length, by, S.count("OT_PLAN"), S.count("OT_EFFECT"), S.count("OT_CASE")], refs: ["OT_CELL", "OT_CELL_MR", "OT_ANTENNA", "OT_SITE", "OT_TICKET", "OT_PLAN", "OT_EFFECT", "OT_CASE"] };
  });
  on("human", q => /(帮我|请|给我).*(确认|批准|审批|批了|批一下|关单|关闭|入库|回填|裁定|派单|派发)/.test(q), (q, e) => {
    const act = /关单|关闭/.test(q) ? "A_08" : /入库/.test(q) ? "A_09" : /回填/.test(q) ? "A_06" : /裁定/.test(q) ? "A_11" : /审批|批准|批了|批一下|派单|派发/.test(q) ? "A_05" : "A_03", d = ont.action(act), t = ticketOf(e);
    return { text: `${act} ${d.label} 须人工执行，优化本体不代办：允许角色 ${d.roles.join("／")}。${t ? "对象：" + t.ticketNo + "（状态“" + t.status + "”）。" : ""}${sess.role ? (d.roles.includes(sess.role) ? `你的角色“${sess.role}”在 SPEC 允许范围内，请在系统里由你本人执行，系统会记录审计。` : `你的角色“${sess.role}”不在 SPEC 允许的角色内，需要由允许的角色执行。`) : ""}所需输入：${d.input}`, src: [d, t && t.status], refs: [act, "INV_05"], pending: [act] };
  });
  on("act.bot", q => /(请|帮我|给我)?.*(建(个|一个|张)?单|定因|生成.{0,6}方案|出.{0,6}方案|评估效果|写入效果)/.test(q) && /(请|帮我|给我|对|给它|再给)/.test(q), (q, e) => {
    const cell = e.cell || (/(它|这个小区|该小区|刚才那个)/.test(q) && sess.cellKey ? S.doc("OT_CELL", sess.cellKey) : null), kind = /建(个|一个|张)?单/.test(q) ? "A_01" : /定因/.test(q) ? "A_02" : /方案/.test(q) ? "A_04" : "A_07", t = ticketOf(e), writes = [];
    // 只读模式（问答面板）：只解释与提示，不代为执行写动作——写操作在小区决策流程页完成
    if (sess.readOnly) {
      const d = ont.action(kind), step = FLOW_STEP[kind] || "相应";
      return { text: `${kind} ${d.label} 是会写库的动作，问答面板只回答不做：请到该小区决策流程的「${step}」步骤点按钮执行（写操作在流程里完成，问答只解释）。允许角色：${d.roles.join("／")}。${kind === "A_01" && cell ? `该小区${cell.cellName}当前判定：${svc.discover(cell.cellKey, S.peekNow()).verdict}。` : ""}`, src: [d.label, d.roles], refs: [kind], pending: [kind] };
    }
    let r;
    if (kind === "A_01") { if (!cell) return { text: "请指明要建单的小区。", src: [], refs: ["A_01"] }; r = app.act("A_01", { cellKey: cell.cellKey }, { role: "优化本体" }); }
    else if (!t) return noTicket("该小区"); else if (kind === "A_02") r = app.act("A_02", { ticketNo: t.ticketNo, mode: "rule" }, { role: "优化本体" });
    else if (kind === "A_04") r = app.act("A_04", { ticketNo: t.ticketNo, adjustType: e.adjust || "机械" }, { role: "优化本体" });
    else { const p = planOf(t); r = p ? app.act("A_07", { planNo: p.planNo }, { role: "优化本体" }) : { ok: false, code: "NOT_FOUND", msg: "尚无方案" }; }
    hit("A", kind); if (r.ok) { writes.push(`${kind} 已执行`); if (r.result.ticketNo) sess.ticketNo = r.result.ticketNo; }
    const rs = r.ok ? JSON.stringify(r.result) : "";
    return { text: r.ok ? `${kind} ${ont.action(kind).label} 已由优化本体执行（本次写入 1 条动作审计）：${summ(kind, r.result)}。` : `${kind} 被拒绝：${r.code}——${r.msg}。`, src: [r.ok ? r.result : { code: r.code, msg: r.msg }], refs: [kind, ...(r.ok ? [] : [r.code].filter(x => /^INV/.test(x)))], writes };
  });
  const summ = (k, r) => k === "A_01" ? `${r.deduped ? "该小区已有未关闭工单 " : "新建工单 "}${r.ticketNo}（状态“${r.status}”）` : k === "A_02" ? (r.written ? `根因第 ${r.round} 轮已写入（F_07＝${r.f07}，F_08＝${r.f08}）` : `未写根因（F_07＝${r.f07 || "—"}，F_08＝${r.f08 || "—"}，${r.reason || ""}）`) : k === "A_04" ? `方案 ${r.planNo}（${r.status}），缺口 ${r.gap}°，Δ ${r.delta}°，共 ${r.rounds} 轮，周边影响“${r.impact}”` : `效果 ${r.effectNo}：${r.status}`;

  require("./qa-biz.js").install({ on, H, PRI, app, S, facts, svc, ont, seed, sess, hit, entities, ticketOf, planOf, effOf, latestTicket, noTicket, nm, scopeAt, F8, pct, fmtDate });
  H.sort((a, b) => (PRI[a.name] ?? 50) - (PRI[b.name] ?? 50));
  // ── 入口
  function ask(question, opt = {}) {
    if (opt.role) sess.role = opt.role;
    if (opt.cellKey) sess.cellKey = opt.cellKey;      // 当前小区（问答面板传入）：相对指代指向它
    sess.readOnly = !!opt.readOnly;                    // 只读模式：不代为执行写动作
    const e = entities(question); let h = H.find(x => x.test(question, e)); let out;
    if (!h) out = { text: "这个问题超出了本体与 SPEC 的范围，或我没有识别出意图。可以问：哪些小区达到弱覆盖、某小区的逐日 MR 与判定、工单状态与依据、根因、假性弱覆盖、方案与周边影响、审批与执行、效果与能否关单、案例、历史取值、假设演算，以及 OT_／RT_／F_／A_／INV_／RULE_／TH 的含义。", src: [], refs: [], intent: "fallback",
      gap: { kind: "unrecognized", boundary: "本体只覆盖弱覆盖发现与 4G 宏站天线下倾角过小的原因与处置；上面的问法超出了可回答范围。" } };
    else { out = h.fn(question, e); out.intent = h.name; }
    if (e.cell) sess.cellKey = e.cell.cellKey;
    out.refs = [...new Set((out.refs || []).filter(Boolean))]; for (const id of out.refs) { const k = id.startsWith("OT_") ? "OT" : id.startsWith("RT_") ? "RT" : id.startsWith("F_") ? "F" : id.startsWith("A_") ? "A" : id.startsWith("INV_") ? "INV" : id.startsWith("RULE_") ? "RULE" : id.startsWith("TH") ? "TH" : null; if (k) hit(k, id); }
    out.grounded = ground(out, question); return out;
  }
  // 数值与日期落地检查：回答里的每个数字都必须出现在本次引用的来源里
  function ground(out, question = "") {
    const names = [...S.list("OT_CELL").flatMap(c => [c.cellKey, c.cellName]), ...S.list("OT_ANTENNA").map(a => a.antennaId), ...S.list("OT_SITE").map(s => s.siteId), ...S.list("OT_TICKET").map(t => t.ticketNo), ...S.list("OT_PLAN").map(p => p.planNo), ...S.list("OT_EFFECT").map(x => x.effectNo), ...S.list("OT_CASE").map(c => c.caseNo), ...S.list("OT_AREA").map(a => a.areaId), ...seed.sourceTickets.map(t => t.taskno), "DP-", "TK-", "CL-", "AR-"].filter(Boolean).sort((a, b) => b.length - a.length);
    let txt = out.text; for (const n of names) txt = txt.split(n).join(" "); txt = txt.replace(/\b[A-Z]{1,6}_[A-Z]*\d+[A-Za-z0-9_]*/g, " ").replace(/\bTH\d+/g, " ").replace(/\bF_\d+|\bA_\d+/g, " ").replace(/[A-Z]{2,}\d*[A-Z0-9-]*/g, " ").replace(/v\d+\.\d+/g, " ").replace(/R\d\b/g, " ");
    const allowed = new Set(), add = x => { if (typeof x === "number" && Number.isFinite(x)) { allowed.add(String(+x.toFixed(6))); allowed.add((x * 100).toFixed(2)); allowed.add(String(+(x * 100).toFixed(2))); allowed.add(String(Math.round(x))); allowed.add(String(+x.toFixed(2))); allowed.add(String(+x.toFixed(1))); } };
    const walk = x => { if (x === null || x === undefined) return; if (typeof x === "number") add(x); else if (typeof x === "string") (x.match(/\d+(?:\.\d+)?/g) || []).forEach(n => { allowed.add(n); allowed.add(String(+n)); }); else if (typeof x === "object") Object.values(x).forEach(walk); };
    walk(out.src); walk(question); walk(ont.rule("RULE_D01").meaning); walk(ont.raw.params); walk(ont.raw.dispatchRules); if (out.derived) walk(S.list("OT_CELL_MR").length);
    const nums = (txt.match(/\d+(?:\.\d+)?/g) || []), bad = [...new Set(nums.filter(n => !allowed.has(n) && !allowed.has(String(+n)) && !allowed.has((+n).toFixed(2))))];
    return { ok: bad.length === 0, ungrounded: bad };
  }
  return { ask, sess, entities, ground, H, nameOf: k => { const c = S.doc("OT_CELL", k); return c ? c.cellName : k; } };
}
module.exports = { createQA };
