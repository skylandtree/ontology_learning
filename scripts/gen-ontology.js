// 生成 ontology/shwo.ontology.json：本体定义只来自 spec/ 下的 SPEC，并自检（SPEC 中出现的每个标识都有定义，定义的每个标识都出自 SPEC）。
const fs = require("node:fs"), path = require("node:path");
const { parseSpec } = require("./spec-parse.js"), { specDir, specFile } = require("./spec-file.js");
const root = path.join(__dirname, "..");
const md = fs.readFileSync(path.join(specDir, specFile()), "utf8");
const spec = parseSpec(md);
const ont = { ...spec, source: { file: "spec/" + specFile(), sha256: spec.source.sha256, note: "全部要素由 scripts/spec-parse.js 从该文件的表格解析，不含任何其他来源" } };

// 自检：SPEC 正文里出现的标识 ⊆ 已定义标识（范围写法 RT_01～RT_17 的两端也须已定义）
const defined = { OT: ont.objectTypes.map(x => x.id), RT: ont.relationTypes.map(x => x.id), F: ont.functions.map(x => x.id), A: ont.actions.map(x => x.id), INV: ont.constraints.map(x => x.id), RULE: ont.rules.map(x => x.id) };
const problems = [];
for (const [k, re] of [["OT", /\bOT_[A-Z_]+\b/g], ["RT", /\bRT_\d+\b/g], ["F", /\bF_\d+\b/g], ["A", /\bA_\d+\b/g], ["INV", /\bINV_\d+\b/g], ["RULE", /\bRULE_[A-Z]\d+\b/g]]) {
  for (const id of new Set(md.match(re) || [])) if (!defined[k].includes(id)) problems.push(`SPEC 引用了未定义的 ${id}`);
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
fs.writeFileSync(path.join(root, "ontology", "shwo.ontology.json"), JSON.stringify(ont, null, 1) + "\n");
console.log(`本体已生成：对象类型 ${ont.objectTypes.length}、关系 ${ont.relationTypes.length}、函数 ${ont.functions.length}、动作 ${ont.actions.length}、约束 ${ont.constraints.length}、规则 ${ont.rules.length}（含只登记）、测试假设 ${ont.assumptions.length}、派单规则 ${ont.dispatchRules.length}、措施类型 ${ont.measureTypes.length}、SPEC 用例 ${ont.cases.length}`);
