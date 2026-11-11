// 独立预期构建器：只读 data/seed/*.csv 与 SPEC 生成的参数/规则（ontology JSON 的 params、dispatchRules），按 SPEC 公式自行计算，不引用 src/。
// 运行时测试拿它的输出作基准；构建器与被测应用由同一团队编写，独立性有限（见 docs/测试说明.md）。
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, ".."), ont = JSON.parse(fs.readFileSync(path.join(root, "ontology/shwo.ontology.json"), "utf8")), P = ont.params;
// 极简 CSV 读取（与应用里的读取层分开写，保持独立）
function csv(name) {
  let t = fs.readFileSync(path.join(root, "data/seed", name), "utf8"); if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; } else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(x => x)) rows.push(row); row = []; } else cur += c; }
  const h = rows[0]; return rows.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const num = v => v === "" || v === undefined ? undefined : Number(v);
const sites = csv("sites.csv").map(s => ({ ...s, lat: +s.lat, lon: +s.lon })), ants = csv("antennas.csv").map(a => ({ ...a, height: num(a.height), mechTilt: num(a.mechTilt) })), cells = csv("cells.csv").map(c => ({ ...c, targetRadius: num(c.targetRadius) }));
const nbRows = csv("cell_neighbors.csv"), cellSite = csv("cell_site.csv"), cellAnt = csv("cell_antenna.csv").map(a => ({ ...a, elecTilt: +a.elecTilt, vBeam: +a.vBeam })), mr = csv("cell_mr.csv").map(m => ({ ...m, sampleTotal: +m.sampleTotal, sampleWeak: +m.sampleWeak })), metrics = csv("cell_metrics.csv").map(m => ({ ...m, value: +m.value }));
const src = csv("source_tickets.csv");
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI, r1 = x => Math.round(x * 10) / 10, r2 = x => Math.round(x * 100) / 100, r4 = x => Math.round(x * 10000) / 10000;
const site = id => sites.find(s => s.siteId === id), cell = k => cells.find(c => c.cellKey === k), keyOf = name => { const c = cells.find(x => x.cellName === name); if (!c) throw new Error("无小区 " + name); return c.cellKey; };
const cs = k => cellSite.find(x => x.cellKey === k).siteId, ca = k => cellAnt.find(x => x.cellKey === k), ant = id => ants.find(a => a.antennaId === id);
const dist = (a, b) => { const R = P.earthRadiusM, dla = rad(b.lat - a.lat), dlo = rad(b.lon - a.lon), h = Math.sin(dla / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const rFar = (h, th, b) => th - b / 2 <= 0 ? Infinity : h / Math.tan(rad(th - b / 2)), rNear = (h, th, b) => h / Math.tan(rad(th + b / 2)), thetaT = (h, b, Rt) => deg(Math.atan(h / Rt)) + b / 2;
const G = (k, over = {}) => { const a = ca(k), an = ant(a.antennaId); return { cellKey: k, h: an.height, mech: an.mechTilt, elec: a.elecTilt, beta: a.vBeam, Rt: cell(k).targetRadius, ...over }; };
const tot = g => g.mech + g.elec;
const range = (from, n) => [...Array(n).keys()].map(i => new Date(Date.parse(from + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10));
const sumMR = (k, dates, f) => dates.reduce((s, d) => s + f(mr.find(x => x.cellKey === k && x.date === d)), 0);
const ratio = (k, dates) => sumMR(k, dates, m => m.sampleWeak) / sumMR(k, dates, m => m.sampleTotal);
const meanMetric = (k, dates) => { const v = dates.map(d => metrics.find(m => m.cellKey === k && m.date === d && m.name === "实测重叠覆盖度").value); return v.reduce((a, b) => a + b, 0) / v.length; };

// ── 发现：逐日命中与“7天出现3天”
function discover(cellKey, from) {
  const sc = cell(cellKey), st = site(cs(cellKey)), r = ont.dispatchRules.find(x => x.rat === sc.rat && x.siteType === st.siteType && x.sceneLevel === sc.sceneLevel), dates = range(from, 7);
  if (!r) return { verdict: "证据不足", ruleGap: true, hitDays: 0, unknownDates: dates, hitDates: [] };
  const daily = dates.map(d => { const m = mr.find(x => x.cellKey === cellKey && x.date === d); if (!m) return { date: d, hit: "未知" }; const q = m.sampleWeak / m.sampleTotal; return { date: d, hit: m.sampleWeak >= r.minWeakSamples && q >= r.minWeakRatio - 1e-12 ? "是" : "否" }; });
  const hit = daily.filter(d => d.hit === "是").length, unk = daily.filter(d => d.hit === "未知").length;
  return { rule: r.ruleId, verdict: hit >= r.minHitDays ? "达到派单条件" : hit + unk < r.minHitDays ? "未达到派单条件" : "证据不足", hitDays: hit, hitDates: daily.filter(d => d.hit === "是").map(d => d.date), unknownDates: daily.filter(d => d.hit === "未知").map(d => d.date) };
}
// ── 周边影响（SPEC RULE_W13）
function impact(target, scope, nbs, adjust, planDelta) {
  const res = P.tiltResolution[adjust], steps = Math.round(planDelta / res), ev = d => {
    const checks = []; let ok = true;
    for (const c of scope) { const a = rFar(c.h, tot(c) + d, c.beta), b = rFar(c.h, tot(c), c.beta), pass = a >= c.Rt; ok = ok && pass; checks.push({ cell: c.cellKey, before: r1(b), after: r1(a), pass }); }
    for (const n of nbs) { const rn = rFar(n.h, tot(n), n.beta), b = Math.max(0, rFar(target.h, tot(target), target.beta) + rn - n.distance), a = Math.max(0, rFar(target.h, tot(target) + d, target.beta) + rn - n.distance), pass = a <= b + 1e-9; ok = ok && pass; checks.push({ neighbor: n.cellKey, distance: r1(n.distance), before: r1(b), after: r1(a), pass }); }
    return { ok, checks };
  };
  for (let k = steps; k >= 1; k--) { const d = +(k * res).toFixed(1), e = ev(d); if (e.ok) return { result: d === planDelta ? "通过" : "调减", deltaFinal: d, checks: e.checks }; }
  return { result: "不通过", deltaFinal: null, checks: ev(planDelta).checks };
}
function tilt(g) {
  const t = tot(g), tt = thetaT(g.h, g.beta, g.Rt), gap = tt - t, delta = +(Math.floor(Math.min(gap, P.maxStep) / P.tiltResolution.机械 + 1e-9) * P.tiltResolution.机械).toFixed(1);
  return { total: t, rNear: r1(rNear(g.h, t, g.beta)), rFar: r1(rFar(g.h, t, g.beta)), thetaT: r2(tt), gap: r2(gap), _gap: gap, match: gap > P.eps, deltaMech: delta, rounds: Math.ceil(gap / P.maxStep - 1e-9) };
}
const nbOf = k => nbRows.filter(n => n.cellKey === k && +n.overlapWeight > 0).map(n => ({ ...G(n.targetCellKey), distance: dist(site(cs(k)), site(cs(n.targetCellKey))), cellKey: n.targetCellKey }));

const X = keyOf("崇贤达NF02H_222"), Y = keyOf("崇贤达NF08H_223"), Z1 = keyOf("崇贤北NF02H_141"), Z2 = keyOf("陈家镇东NF02H_87"), SIM = keyOf("庙镇新村NF02H_126"), BAO = keyOf("宝泰支HR05H_112"), N1 = keyOf("海剑HR03H_121");
const S1 = range("2026-09-04", 7), S2 = range("2026-09-15", 7);
const out = { _meta: { generatedBy: "scripts/build-expected.js", independentOf: "src/*", note: "读取种子 CSV 与 SPEC 生成的参数，按 SPEC 公式独立计算" }, rules: ont.dispatchRules.map(r => ({ id: r.ruleId, rat: r.rat, siteType: r.siteType, minWeakSamples: r.minWeakSamples, minWeakRatio: r.minWeakRatio })) };

// 崇明主线
const gX = G(X), tX = tilt(gX), scopeXY = [G(X), G(Y)], nbX = nbOf(X), im = impact(gX, scopeXY, nbX, "机械", tX.deltaMech);
out.chm = {
  discover: discover(X, "2026-09-04"), distances: Object.fromEntries(nbX.map(n => [n.cellKey, r1(n.distance)])),
  beforeRatio: r4(ratio(X, S1)), alarm: { share: r4(1 / 7), verdict: "部分重合" }, tilt: tX, impact: im, afterRatio1: r4(ratio(X, S2)),
  protection: { Y: { before: r4(ratio(Y, S1)), after: r4(ratio(Y, S2)) }, Z1: { before: r4(meanMetric(Z1, S1)), after: r4(meanMetric(Z1, S2)) }, Z2: { before: r4(meanMetric(Z2, S1)), after: r4(meanMetric(Z2, S2)) } },
  afterAt4: tilt(G(X, { mech: gX.mech + 1 })),
};
// 变体：同天线小区目标半径收紧 → 机械下倾不通过、电子下倾通过（INV_12）；改挂另一副天线 → 范围只含目标小区；实际 +3° 复核
const imMech = impact(gX, [G(X), G(Y, { Rt: 560 })], nbX, "机械", tX.deltaMech);
const deltaElec = +(Math.floor(Math.min(tX._gap, P.maxStep) / P.tiltResolution.电子 + 1e-9) * P.tiltResolution.电子).toFixed(1);
out.chmVariants = {
  yTightMech: { result: imMech.result, checks: imMech.checks }, yTightElec: { delta: deltaElec, ...impact(gX, [G(X)], nbX, "电子", deltaElec) }, yRelinked: impact(gX, [G(X)], nbX, "机械", tX.deltaMech),
  actualPlus3: (() => { const fx = [G(X), G(Y)].map(c => ({ cell: c.cellKey, after: r1(rFar(c.h, tot(c) + 3, c.beta)), Rt: c.Rt })); return { result: fx.every(f => f.after >= f.Rt) ? "通过" : "不通过", failed: fx.filter(f => f.after < f.Rt).map(f => f.cell) }; })(),
};
// 调减变体：目标小区电下倾 2°（缺口 2.35°→Δ＝2°），同天线小区目标半径 450 → 调减到 1°；600 → 不通过
const gX2 = G(X, { elec: 2 }), tX2 = tilt(gX2);
out.chmVariants.reduce = { tilt: tX2, y450: impact(gX2, [gX2, G(Y, { Rt: 450 })], nbX, "机械", tX2.deltaMech), y600: impact(gX2, [gX2, G(Y, { Rt: 600 })], nbX, "机械", tX2.deltaMech) };
// 同类新实例
const gS = G(SIM), tS = tilt(gS);
out.sim = { discover: discover(SIM, "2026-10-16"), tilt: tS, impact: impact(gS, [gS], nbOf(SIM), "机械", tS.deltaMech) };
// 发现清单：九月窗口 13 个小区、十月窗口 3 个小区
const sc = (list, from) => Object.fromEntries(list.map(k => { const d = discover(k, from); return [k, { verdict: d.verdict, hitDays: d.hitDays, unknown: d.unknownDates.length }]; }));
const SEP = ["崇贤达NF02H_222", "崇贤达NF08H_223", "东滩公园NF02H_164", "港沿路NF02H_73", "新河镇政府NF02H_58", "堡镇中心NF02H_132", "崇明体育中心NF02H_215", "崇明医院门诊楼ND08H_12", "陈家镇HR05H_36", "长兴客运码头HR12H_9", "崇贤北NF02H_141", "陈家镇东NF02H_87", "陈家镇北NF02H_196"].map(keyOf);
out.scanSep = sc(SEP, "2026-09-04"); out.scanSepCounts = { 达到: 0, 未达到: 0, 证据不足: 0 };
for (const v of Object.values(out.scanSep)) out.scanSepCounts[v.verdict === "达到派单条件" ? "达到" : v.verdict === "未达到派单条件" ? "未达到" : "证据不足"]++;
out.scanOct = sc([SIM, BAO, N1], "2026-10-16");
// 十月窗口的发现范围（近三周有 MR 上报的小区＋它们的邻区）：庙镇新村、庙镇东、宝泰支、海剑，加庙镇新村的邻区庙镇南（无 MR，数据缺口）
// 九月的 11 个上报小区在十月窗口已无 MR 上报（最近一天 09-28），不进十月的发现范围
const OCT = [SIM, keyOf("庙镇东NF02H_77"), BAO, N1, keyOf("庙镇南NF02H_203")];
out.scanOctAll = sc(OCT, "2026-10-16"); out.scanOctCounts = { 达到: 0, 未达到: 0, 证据不足: 0 };
for (const v of Object.values(out.scanOctAll)) out.scanOctCounts[v.verdict === "达到派单条件" ? "达到" : v.verdict === "未达到派单条件" ? "未达到" : "证据不足"]++;
out.bao = { weakRatio: r4(ratio(BAO, range("2026-10-16", 7))) };
fs.writeFileSync(path.join(root, "data/expected/expected.json"), JSON.stringify(out, null, 1) + "\n");
console.log("expected 已生成：", JSON.stringify({ chmTilt: out.chm.tilt, impact: out.chm.impact.result, yTightMech: out.chmVariants.yTightMech.result, yTightElec: out.chmVariants.yTightElec.result, sim: out.sim.tilt.deltaMech, scanSepCounts: out.scanSepCounts, bao: out.bao }));
