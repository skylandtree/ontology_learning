// 本体运行时：加载 ontology/shwo.ontology.json（由 scripts/gen-ontology.js 从 SPEC 生成）。运行期不再读取 SPEC 以外的任何定义。
const fs = require("node:fs"), path = require("node:path");

function loadOntology(file) {
  const j = JSON.parse(fs.readFileSync(file || path.join(__dirname, "..", "ontology", "shwo.ontology.json"), "utf8"));
  const by = (arr, k = "id") => Object.fromEntries(arr.map(x => [x[k], x]));
  const OT = by(j.objectTypes), RT = by(j.relationTypes), F = by(j.functions), A = by(j.actions), INV = by(j.constraints), RULE = by(j.rules), TH = by(j.assumptions);
  const ont = {
    raw: j, ids: { OT: Object.keys(OT), RT: Object.keys(RT), F: Object.keys(F), A: Object.keys(A), INV: Object.keys(INV), RULE: Object.keys(RULE), TH: Object.keys(TH) },
    ot: id => OT[id], rt: id => RT[id], func: id => F[id], action: id => A[id], inv: id => INV[id], rule: id => RULE[id], th: id => TH[id],
    param: k => { if (!(k in j.params)) throw new Error("本体无此参数：" + k); return j.params[k]; },
    symptom: label => j.symptomLabels.includes(label),
    measure: code => j.measureTypes.find(m => m.measureCode === code),
    // 对象只允许 SPEC 定义的属性；未知类型、未知属性一律拒绝
    validate(type, doc) {
      const t = OT[type]; if (!t) throw new Error(`对象类型未在 SPEC 中定义：${type}`);
      const allowed = new Set(t.attributes.map(a => a.name));
      for (const k of Object.keys(doc)) if (!allowed.has(k)) throw new Error(`${type} 的属性 ${k} 未在 SPEC 中定义`);
    },
    // 关系端点类型必须与 SPEC 一致
    checkLink(rt, fromType, toType) {
      const r = RT[rt]; if (!r) throw new Error(`关系类型未在 SPEC 中定义：${rt}`);
      if (!r.from.includes(fromType) || !r.to.includes(toType)) throw new Error(`${rt} 端点应为 ${r.from.join("／")}→${r.to.join("／")}，实际 ${fromType}→${toType}`);
    },
    // 按“制式×站点类型×场景等级”选取派单规则；选不到＝规则缺口（H12）
    dispatchRule(rat, siteType, sceneLevel) { return j.dispatchRules.find(r => r.rat === rat && r.siteType === siteType && r.sceneLevel === sceneLevel) || null; },
  };
  return ont;
}
module.exports = { loadOntology };
