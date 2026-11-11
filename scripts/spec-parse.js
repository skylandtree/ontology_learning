// 从 SPEC（Markdown）解析本体定义。本体的全部要素（对象类型、属性、关系、函数、动作、约束、规则、测试假设、
// 措施类型字典、状态、用例清单）只来自 SPEC 的表格，不引用任何其他文件。解析不到的要素直接报错，不做兜底。
const crypto = require("node:crypto");

const cells = line => line.split("|").slice(1, -1).map(s => s.trim());

function tables(md) {
  const L = md.split("\n"), out = [];
  for (let i = 0; i < L.length; i++) {
    if (!L[i].startsWith("|") || !(L[i + 1] || "").startsWith("|---")) continue;
    const header = cells(L[i]), rows = [];
    let j = i + 2;
    while (j < L.length && L[j].startsWith("|")) rows.push(cells(L[j++]));
    out.push({ line: i + 1, header, rows });
    i = j - 1;
  }
  return out;
}
const find = (ts, pred) => ts.filter(pred);
const strip = s => s.replace(/\*\*/g, "").replace(/【[^】]*】/g, "").trim();
const names = cell => {   // 按“、”切段，凡以 `名称` 开头的段即一个属性名（描述段不以反引号开头）
  const out = [];
  for (const seg of cell.replace(/^关系属性：/, "").replace(/【[^】]*】/g, "").split("、")) {
    const m = seg.trim().match(/^`([^`]+)`/); if (m) out.push(m[1].replace(/\[\]$/, ""));
    else if (out.length && !/^[`]/.test(seg.trim())) continue;
  }
  return out;
};
const num = (s, re, what) => { const m = s.match(re); if (!m) throw new Error(`SPEC 解析失败：${what}`); return Number(m[1]); };
// 驼峰属性名 → 下划线物理列名（OSDK 元数据 physicalColumn；样例 CSV 表头用驼峰，真实系统按 U24 替换）
const snake = s => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();
const idents = cell => (cell.match(/`([A-Za-z][A-Za-z0-9_]*(?:\[\])?)`/g) || []).map(x => x.slice(1, -1));
const snakeTbl = cell => (cell.match(/`([a-z][a-z0-9_]*)`/g) || []).map(x => x.slice(1, -1));

function parseSpec(md) {
  const ts = tables(md), spec = { source: { sha256: crypto.createHash("sha256").update(md).digest("hex") } };

  // ── 对象类型（3.1）
  const ot = find(ts, t => t.header[0] === "对象类型标识与名称")[0];
  spec.objectTypes = ot.rows.map(r => {
    const m = strip(r[0]).match(/^(OT_[A-Z_]+)\s+(.+)$/);
    return { id: m[1], name: m[2].trim(), definition: strip(r[1]), identity: strip(r[2]), attributes: [] };
  });
  const OT = Object.fromEntries(spec.objectTypes.map(o => [o.id, o]));

  // ── 关系类型（3.3）
  const rt = find(ts, t => t.header[0] === "关系类型标识与名称")[0];
  spec.relationTypes = rt.rows.map(r => {
    const m = strip(r[0]).match(/^(RT_\d+)\s+(.+)$/), [from, to] = r[1].split("→");
    return { id: m[1], name: m[2].trim(), from: from.split("／"), to: to.split("／"), cardinality: strip(r[2]), source: strip(r[3]), usedBy: strip(r[4]), attributes: [] };
  });
  const RT = Object.fromEntries(spec.relationTypes.map(o => [o.id, o]));

  // ── 属性（3.2）
  const at = find(ts, t => t.header[0] === "所属对象类型或关系类型")[0];
  for (const r of at.rows) {
    const owners = r[0].replace(/（[^）]*）/g, "").split("／").map(s => s.trim()), ns = names(r[1]);
    if (!ns.length) throw new Error("属性行无法解析：" + r[1].slice(0, 40));
    for (const o of owners) {
      const tgt = OT[o] || RT[o]; if (!tgt) throw new Error("属性所属未定义：" + o);
      for (const n of ns) if (!tgt.attributes.find(a => a.name === n))
        tgt.attributes.push({ name: n, meaning: strip(r[1]).replace(/^关系属性：/, ""), type: strip(r[2]), rule: strip(r[3]), basis: strip(r[4]) });
    }
  }
  // 字段字典（4.1）补充：cells[]／sites[]／antennas[]／cellMR[] 的字段属于对应对象类型
  const dict = find(ts, t => t.header[0] === "字段路径")[0], dmap = { "cells[]": "OT_CELL", "sites[]": "OT_SITE", "antennas[]": "OT_ANTENNA", "cellMR[]": "OT_CELL_MR" };
  for (const r of dict.rows) {
    const m = r[0].replace(/`/g, "").match(/^(\w+\[\])\.(.+?)(?:（.*)?$/); if (!m || !dmap[m[1]]) continue;
    for (const n of m[2].split("／")) { const o = OT[dmap[m[1]]], nn = n.replace(/\[\]$/, "").trim(); if (nn && !o.attributes.find(a => a.name === nn)) o.attributes.push({ name: nn, meaning: "字段字典", type: strip(r[1]), rule: strip(r[4]), basis: "字段字典" }); }
  }

  // ── 对象、属性、关系与实际表字段的对应关系（4.1 表1～表4）
  // 只保留结构化信息：表名（下划线）、主键、字段、方向；不抄录说明文字，避免把真实系统专有名带进本体。
  const dirOf = cell => (cell.match(/^(读|写|派生)(＋(读|写|派生))?/) || [, ""])[1] || null;
  const t1 = find(ts, t => t.header[0] === "对象类型" && /承载表/.test(t.header[1] || ""))[0];
  const t3 = find(ts, t => t.header[0] === "对象类型／关系类型")[0];
  const t4 = find(ts, t => t.header[0] === "关系类型" && /关联表/.test(t.header[1] || ""))[0];
  if (!t1 || !t3 || !t4) throw new Error("SPEC 解析失败：4.1 对象、属性与实际表字段的对应关系（表1／表3／表4）");
  spec.mapping = { objectTables: [], attributeColumns: [], relationTables: [] };
  for (const r of t1.rows) {
    const id = strip(r[0]).match(/^(OT_[A-Z_]+)/); if (!id) continue;
    // 承载表只取该列开头那一个下划线表名（单元格后段是对账/补充说明）；平台存储类无表名→null
    const tbl = /^\s*`[a-z][a-z0-9_]*`/.test(r[1]) ? (snakeTbl(r[1])[0] || null) : null;
    spec.mapping.objectTables.push({ objectType: id[1], table: tbl, physicalKey: idents(r[3]), direction: dirOf(strip(r[4])) });
  }
  for (const r of t3.rows) {
    const owner = strip(r[0]).replace(/（[^）]*）/g, "").trim(), ns = idents(r[1]).filter(n => /^[a-z]/.test(n));
    if (!ns.length) throw new Error("SPEC 解析失败：4.1 表3 属性列无法解析：" + r[1].slice(0, 30));
    const colNames = (r[2].match(/`?[a-z][a-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*`?/g) || []).map(x => x.replace(/`/g, ""));
    const sameName = /同名列/.test(r[2]), noField = /无对应字段/.test(r[2]), derived = /^派生/.test(strip(r[3]));
    const ownerTable = (spec.mapping.objectTables.find(o => o.objectType === owner) || {}).table || null;
    for (const n of ns) {
      const hit = colNames.find(c => c.split(".")[1] === n);
      const table = hit ? hit.split(".")[0] : sameName ? ownerTable : null;
      const column = hit ? hit.split(".")[1] : sameName ? n : null;
      spec.mapping.attributeColumns.push({ owner, attribute: n, table: table && /^[a-z][a-z0-9_]*$/.test(table) ? table : null, column,
        direction: noField || derived ? "派生" : dirOf(strip(r[3])), mapped: !!(table && column) });
    }
  }
  const knownAttrs = new Set(spec.objectTypes.flatMap(o => o.attributes.map(a => a.name)).concat(["version"]));
  for (const r of t4.rows) {
    const id = strip(r[0]).match(/^(RT_\d+)/); if (!id) continue;
    // 只有“表名（连接键）”或“表名”这种单一连接表才算；并列多表（“a、b”）或字段路径（“a.b”）不指定表
    const one = r[1].match(/^\s*`([a-z][a-z0-9_]*)`(?=[（；]|$)/), table = one ? one[1] : null;
    spec.mapping.relationTables.push({ relationType: id[1], table, joinKeys: idents(r[1]).filter(k => knownAttrs.has(k)), direction: dirOf(strip(r[3])) });
  }

  // ── 状态约束（3.2）
  const st = find(ts, t => t.header[0] === "对象" && t.header[1] === "状态取值")[0];
  spec.states = {}; spec.transitions = {};
  for (const r of st.rows) { spec.states[r[0].replace(/（.*）/, "")] = r[1].split("、").map(s => s.trim()); spec.transitions[r[0].replace(/（.*）/, "")] = r[2]; }

  // ── 约束
  const inv = find(ts, t => t.header[0] === "编号" && t.header[1] === "约束")[0];
  spec.constraints = inv.rows.map(r => ({ id: r[0], text: strip(r[1]), checkpoints: strip(r[2]).split("、").map(s => s.trim()) }));
  const i02 = spec.constraints.find(c => c.id === "INV_02").text.match(/K族\d+个：([^）]+)）/);
  if (!i02) throw new Error("INV_02 症状级标签清单解析失败");
  spec.symptomLabels = i02[1].split("、").map(s => s.trim());

  // ── 函数（3.4）
  const ft = find(ts, t => t.header[0] === "函数标识、名称及版本")[0];
  spec.functions = ft.rows.map(r => {
    const m = strip(r[0]).match(/^(F_\d+)\s+(\w+)\s+v([\d.]+)/);
    return { id: m[1], code: m[2], version: m[3], question: strip(r[1]), input: strip(r[2]), method: strip(r[3]), output: strip(r[4]) };
  });

  // ── 动作（3.5）
  const roleNames = ["优化本体", "地市优化工程师", "优化工程师", "现场维护人员", "优化主管", "优化专家", "专家", "知识维护人"];
  const actt = find(ts, t => t.header[0] === "动作类型标识与名称")[0];
  spec.actions = actt.rows.map(r => {
    const m = strip(r[0]).match(/^(A_\d+)\s+(\w+)\s+(.+)$/), roles = [...new Set(roleNames.filter(x => r[1].split("；")[0].includes(x)).map(x => x === "优化工程师" ? "地市优化工程师" : x === "专家" ? "优化专家" : x))];
    return { id: m[1], code: m[2], label: m[3].trim(), roles, purpose: strip(r[1]), input: strip(r[2]), changes: strip(r[3]), failure: strip(r[4]), definedOnly: /只定义/.test(r[4]) };
  });

  // ── 规则（4.2）
  const rl = find(ts, t => t.header[0] === "规则标识及版本")[0];
  spec.rules = [];
  for (const r of rl.rows) {
    const m = r[0].match(/^(RULE_[A-Z]\d+(?:／[A-Z]\d+)*)\s*(v[\d.]+)?/); if (!m) throw new Error("规则行无法解析：" + r[0]);
    const ids = m[1].includes("／") ? m[1].split("／").map((x, i) => i ? "RULE_" + x : x) : [m[1]];
    for (const id of ids) spec.rules.push({ id, version: (m[2] || "").replace(/^v/, ""), registerOnly: /只登记/.test(r[0]), meaning: strip(r[1]), scope: strip(r[2]), output: strip(r[3]), uses: strip(r[4]) });
  }

  // ── 派单规则 RULE_D01～D04（门限只取自 SPEC 的规则表）
  const D = id => spec.rules.find(x => x.id === id);
  const parseD = (r, text) => {
    const sc = r.scope.match(/^(LTE|NR)×(宏站|室分)×(一般)场景/);
    const th = text.match(/大于等于(\d+)（单日），弱覆盖占比大于等于(\d+)%/) || text.match(/≥(\d+)且占比≥(\d+)%/);
    if (!sc || !th) throw new Error("派单规则解析失败：" + r.id);
    return { ruleId: r.id, ruleVersion: r.version, rat: sc[1], siteType: sc[2], sceneLevel: sc[3], minWeakSamples: +th[1], minWeakRatio: +th[2] / 100 };
  };
  const dr = [D("RULE_D01"), D("RULE_D02")].map(r => parseD(r, r.meaning + " " + r.scope));
  const win = D("RULE_D01").meaning.match(/(\d+)天出现(\d+)天/), cat = D("RULE_D01").meaning.match(/类别“([^”]+)”、问题类型“([^”]+)”/);
  const prob = { 宏站: "宏站弱覆盖小区", 室分: "室分弱覆盖小区" };
  const copy = (id, from) => { const r = D(id), s = r.scope.match(/^(LTE|NR)×(宏站|室分)×(一般)场景/), src = dr.find(x => x.ruleId === from); if (!s || !new RegExp("同第" + (from === "RULE_D01" ? 2 : 3) + "行").test(r.meaning)) throw new Error("派单规则复用解析失败：" + id); return { ...src, ruleId: id, ruleVersion: r.version, rat: s[1], siteType: s[2] }; };
  spec.dispatchRules = [...dr, copy("RULE_D03", "RULE_D01"), copy("RULE_D04", "RULE_D02")].map(x => ({ ...x, category: cat[1], problemType: cat[2], dispatchProblem: prob[x.siteType], windowDays: +win[1], minHitDays: +win[2] }));

  // ── 措施类型字典
  const mt = find(ts, t => t.header[0] === "`measureCode`")[0];
  spec.measureTypes = mt.rows.map(r => ({ measureCode: r[0], name: r[1], smallClass: r[2], level: r[3], executorRole: r[4], remote: r[5] === "是", resolution: num(r[6], /([\d.]+)/, "分辨率"), maxStep: num(r[7], /([\d.]+)/, "单次上限"), direction: r[8] }));

  // ── 测试假设（TH）与参数：数值只取自 TH 表与函数 F_01 的公式说明
  const th = find(ts, t => t.header[0] === "编号" && t.header[1] === "假设内容与取值")[0];
  spec.assumptions = th.rows.map(r => ({ id: r[0], text: strip(r[1]), rules: strip(r[2]), cases: strip(r[3]), owner: r[4] }));
  const T = id => spec.assumptions.find(x => x.id === id).text;
  const f01 = spec.functions.find(f => f.id === "F_01").method;
  spec.params = {
    earthRadiusM: num(f01, /地球半径(\d+) km/, "F_01 地球半径") * 1000,
    eps: num(T("TH01"), /`eps`＝([\d.]+)/, "TH01"),
    maxStep: num(T("TH02"), /`maxStep`＝([\d.]+)/, "TH02"),
    tiltResolution: { 机械: num(T("TH03"), /机械([\d.]+)°/, "TH03 机械"), 电子: num(T("TH03"), /电子([\d.]+)°/, "TH03 电子") },
    falseWeakShare: num(T("TH07"), /`falseWeakShare`＝([\d.]+)/, "TH07"),
    azimuthDevThreshold: num(T("TH08"), /＝(\d+)°/, "TH08"),
    effectMinDelta: num(T("TH09"), /＝([\d.]+)/, "TH09"),
    effectMinDaysAfter: num(T("TH11"), /＝(\d+)天/, "TH11"),
    effectSustainDays: num(T("TH12"), /＝(\d+)天/, "TH12"),
    protectionTolerance: num(T("TH13"), /＝([\d.]+)/, "TH13"),
    targetRadiusK: num(T("TH14"), /k＝([\d.]+)/, "TH14"),
  };

  // ── 用例清单（SPEC 第六章，用于核对场景对 SPEC 用例的覆盖）
  spec.cases = [];
  for (const t of ts) if (/^用例标识/.test(t.header[0])) for (const r of t.rows) { const m = r[0].match(/^\*\*(TC\d+[a-z]?)\*\*\s*([^；]*)/); if (m) spec.cases.push({ id: m[1], title: m[2].trim(), elements: [...new Set([...r[0].matchAll(/\b(OT_[A-Z_]+|RT_\d+|F_\d+|A_\d+|INV_\d+|RULE_[A-Z]\d+)\b/g)].map(x => x[1]))] }); }
  spec.designDecisions = find(ts, t => t.header[1] === "设计取舍")[0].rows.map(r => ({ id: r[0], decision: strip(r[1]) }));
  return spec;
}
module.exports = { parseSpec, tables };
