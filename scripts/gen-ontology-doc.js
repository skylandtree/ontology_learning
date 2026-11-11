// 由 ontology/shwo.ontology.json 生成人读版 ontology/ONTOLOGY.md（JSON 本身由 scripts/gen-ontology.js 从 SPEC 生成）。
const fs = require("node:fs"), path = require("node:path"), root = path.join(__dirname, ".."), o = JSON.parse(fs.readFileSync(path.join(root, "ontology/shwo.ontology.json"), "utf8"));
const esc = s => String(s === undefined ? "" : s).replace(/\|/g, "／").replace(/\n/g, " ");
const tbl = (h, rows) => `| ${h.join(" | ")} |\n|${h.map(() => "---").join("|")}|\n` + rows.map(r => `| ${r.map(esc).join(" | ")} |`).join("\n") + "\n";
let md = `# 本体定义（由 SPEC 生成）\n\n本文件由 \`scripts/gen-ontology-doc.js\` 从 \`ontology/shwo.ontology.json\` 生成；该 JSON 由 \`scripts/gen-ontology.js\` 从 \`${o.source.file}\`（sha256 \`${o.source.sha256.slice(0, 16)}…\`）的表格解析而来。本体的全部要素只来自这份 SPEC，没有任何其他来源。\n\n`;
md += `| 要素 | 数量 |\n|---|---|\n| 对象类型 | ${o.objectTypes.length} |\n| 关系类型 | ${o.relationTypes.length} |\n| 函数 | ${o.functions.length} |\n| 动作类型 | ${o.actions.length} |\n| 核心约束 | ${o.constraints.length} |\n| 业务规则（含只登记） | ${o.rules.length} |\n| 测试假设 | ${o.assumptions.length} |\n| 派单规则 | ${o.dispatchRules.length} |\n| 措施类型 | ${o.measureTypes.length} |\n\n`;
md += "## 对象类型与属性\n\n" + o.objectTypes.map(t => `### ${t.id} ${t.name}\n\n${t.definition}\n\n身份与生命周期：${t.identity}\n\n` + tbl(["属性", "类型与允许值", "必填与缺失含义"], t.attributes.map(a => [a.name, a.type, a.rule]))).join("\n");
md += "\n## 关系类型\n\n" + tbl(["标识", "名称", "起点→终点", "数量关系与成立条件", "使用"], o.relationTypes.map(r => [r.id, r.name, r.from.join("／") + "→" + r.to.join("／"), r.cardinality, r.usedBy]));
md += "\n## 对象、属性、关系与实际表、字段的对应关系（SPEC 4.1）\n\n接口元数据里的 `physicalTable`／`physicalColumn` 就取自这里：表名照 SPEC 4.1 抄录，物理列名由 SPEC 字段名按下划线化得到（样例 CSV 表头是驼峰，接入真实系统时按 SPEC 假设 U24 替换）。\n\n" +
  tbl(["对象类型", "承载表", "主键", "方向"], (o.mapping || { objectTables: [] }).objectTables.map(m => [m.objectType, m.table || "平台存储（无单一表）", m.physicalKey.join("＋"), m.direction || "—"])) +
  "\n" + tbl(["关系类型", "关联表", "连接键", "方向"], (o.mapping || { relationTables: [] }).relationTables.map(m => [m.relationType, m.table || "无单一表（派生／多表）", m.joinKeys.join("＋"), m.direction || "—"])) +
  `\n字段映射 ${(o.mapping || { attributeColumns: [] }).attributeColumns.length} 条，其中落到具体“表.字段”的 ${(o.mapping || { attributeColumns: [] }).attributeColumns.filter(x => x.mapped).length} 条：\n\n` +
  tbl(["对象／关系", "属性", "表.字段", "方向"], (o.mapping || { attributeColumns: [] }).attributeColumns.filter(x => x.mapped).map(m => [m.owner, m.attribute, m.table + "." + m.column, m.direction || "—"])) +
  `\n未落到单一字段的属性（派生、写回多表或本期不落库）：${(o.mapping || { attributeColumns: [] }).attributeColumns.filter(x => !x.mapped).map(m => m.owner + "." + m.attribute).join("、")}\n`;
md += "\n## 状态\n\n" + tbl(["对象", "状态取值", "允许转移"], Object.keys(o.states).map(k => [k, o.states[k].join("、"), o.transitions[k]]));
md += "\n## 函数\n\n" + tbl(["标识", "名称", "版本", "业务问题", "判断方法", "输出"], o.functions.map(f => [f.id, f.code, f.version, f.question, f.method, f.output]));
md += "\n## 动作类型\n\n" + tbl(["标识", "名称", "允许角色", "业务目的", "输入与前提", "拒绝与未知处理"], o.actions.map(a => [a.id, a.label + "（" + a.code + "）" + (a.definedOnly ? "【只定义】" : ""), a.roles.join("／"), a.purpose, a.input, a.failure]));
md += "\n## 核心约束\n\n" + tbl(["编号", "约束", "校验点"], o.constraints.map(c => [c.id, c.text, c.checkpoints.join("、")]));
md += "\n## 业务规则\n\n" + tbl(["标识", "版本", "含义", "适用与判定", "输出与缺失处理", "使用"], o.rules.map(r => [r.id + (r.registerOnly ? "（只登记）" : ""), r.version, r.meaning, r.scope, r.output, r.uses]));
md += "\n## 派单规则（RULE_D01～D04，一般场景）\n\n" + tbl(["规则", "制式", "站点类型", "单日弱覆盖采样点≥", "占比≥", "窗口", "派单问题"], o.dispatchRules.map(r => [r.ruleId, r.rat, r.siteType, r.minWeakSamples, r.minWeakRatio, `${r.windowDays}天出现${r.minHitDays}天`, r.dispatchProblem]));
md += "\n## 措施类型字典\n\n" + tbl(["措施代码", "名称", "层级", "执行方", "可远程", "分辨率", "单次上限", "方向"], o.measureTypes.map(m => [m.measureCode, m.name, m.level, m.executorRole, m.remote ? "是" : "否", m.resolution + "°", m.maxStep + "°", m.direction]));
md += "\n## 测试假设与参数\n\n" + tbl(["编号", "假设", "关联规则／函数", "确认责任"], o.assumptions.map(a => [a.id, a.text, a.rules, a.owner])) + `\n解析出的参数：\`${JSON.stringify(o.params)}\`\n`;
fs.writeFileSync(path.join(root, "ontology/ONTOLOGY.md"), md); console.log("ONTOLOGY.md 已生成");
