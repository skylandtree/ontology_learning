// 元数据：对象类型／Schema／Function／Action 全部取自 ontology/shwo.ontology.json（由 SPEC 解析生成）与 SPEC 4.1 的表字段映射。
// 只有两件事写在代码里，并且都能被测试核对回 SPEC：①对象主键与展示字段（须出现在该对象类型的身份说明里）；
// ②函数与动作的入参名（须出现在 SPEC 正文或对应动作行里，见 PARAM_ALIASES）。
const snake = s => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").toLowerCase();

const ONTOLOGY_CODE = "shwo-weak-coverage";
const PK = { OT_AREA: ["areaId"], OT_CELL: ["cellKey"], OT_CELL_MR: ["mrKey"], OT_ANTENNA: ["antennaId"], OT_SITE: ["siteId"],
  OT_TICKET: ["ticketNo"], OT_PLAN: ["planNo"], OT_EFFECT: ["effectNo"], OT_CASE: ["caseNo"] };
const DISPLAY = { OT_AREA: "areaName", OT_CELL: "cellName", OT_CELL_MR: "mrKey", OT_ANTENNA: "antennaId", OT_SITE: "siteId",
  OT_TICKET: "ticketNo", OT_PLAN: "planNo", OT_EFFECT: "effectNo", OT_CASE: "caseNo" };
// 入参名与 SPEC 用词的对应（SPEC 用“判断时点”“缺口”“Δ”等中文表述，接口用驼峰字段名）
const PARAM_ALIASES = { refTime: "判断时点", asOf: "判断时点", gap: "缺口", planDelta: "Δ", fixedDelta: "Δ", beta: "β", siteA: "站点", siteB: "站点",
  mode: "人工", approvals: "批准", auto: "自动执行", receipt: "回执", dispatchNo: "派单" };
// 函数入参（SPEC 3.4 输入契约；实现入口见 service.js）
const FN_PARAMS = {
  F_01: [["siteA", "object", "两个站点引用及其 lat、lon"], ["siteB", "object", "两个站点引用及其 lat、lon"]],
  F_02: [["h", "decimal", "挂高h（m）"], ["theta", "decimal", "总下倾θ（°）"], ["beta", "decimal", "垂直波束宽β（°）"], ["rat", "string", "制式，缺省 LTE"]],
  F_03: [["mechTilt", "decimal", "天线 mechTilt"], ["elecTilt", "decimal", "RT_02 的 elecTilt"]],
  F_04: [["h", "decimal", "挂高h（m）"], ["beta", "decimal", "垂直波束宽β（°）"], ["Rt", "decimal", "目标半径Rt"]],
  F_05: [["cellKey", "string", "小区"], ["date", "date", "自然日"], ["ruleId", "string", "派单规则，缺省按小区选取"]],
  F_06: [["cellKey", "string", "小区"], ["refTime", "timestamp", "判断时点"]],
  F_07: [["cellKey", "string", "派单小区"], ["hitDates", "array", "派单窗口的命中日"], ["refTime", "timestamp", "判断时点"]],
  F_08: [["cellKey", "string", "小区"], ["asOf", "timestamp", "判断时点"]],
  F_09: [["gap", "decimal", "缺口（F_08）"], ["adjustType", "string", "机械／电子"]],
  F_10: [["cellKey", "string", "派单小区"], ["adjustType", "string", "机械／电子"], ["planDelta", "decimal", "计划Δ"], ["fixedDelta", "decimal", "事后复核用实际Δ"], ["asOf", "timestamp", "判断时点"]],
  F_11: [["planNo", "string", "方案"], ["refTime", "timestamp", "判断时点"]],
  F_12: [["scope", "array", "发现范围（小区集合）"], ["refTime", "timestamp", "判断时点"]]
};
// 动作入参（SPEC 3.5 输入列；mode、approvals、executor、auto 为实现入口需要、SPEC 正文有对应表述的入参）
const ACT_PARAMS = {
  A_01: [["cellKey", "string", "小区"], ["refTime", "timestamp", "判断时点"]],
  A_02: [["ticketNo", "string", "工单"], ["mode", "string", "规则命中（优化本体）或人工"], ["role", "string", "主因／次因"], ["causeFamily", "string", "原因族"], ["causeLabel", "string", "三级原因"], ["evidenceRefs", "array", "证据引用"], ["source", "string", "来源"]],
  A_03: [["ticketNo", "string", "工单"], ["decision", "string", "确认／排除"], ["reason", "string", "复核判断"]],
  A_04: [["ticketNo", "string", "工单"], ["adjustType", "string", "机械／电子"]],
  A_05: [["planNo", "string", "方案"], ["decision", "string", "批准／不批准"], ["executor", "object", "执行人"], ["approvals", "array", "批准记录"], ["auto", "boolean", "是否自动执行（天馈类不得自动执行）"]],
  A_06: [["planNo", "string", "方案"], ["dispatchNo", "string", "派单号"], ["executeTime", "timestamp", "实施时间"], ["receipt", "string", "成功／失败／未知"], ["actualValues", "array", "现场实际值"]],
  A_07: [["planNo", "string", "方案"]],
  A_08: [["ticketNo", "string", "工单"]],
  A_09: [["effectNo", "string", "效果"], ["applicability", "object", "适用条件"]],
  A_10: [["planNo", "string", "方案"]],
  A_11: [["antennaId", "string", "天线"], ["chosenSource", "string", "所选来源"], ["reason", "string", "裁定理由"]]
};
// 函数经接口执行时的对象类型（用于 metadata.object）
const FN_SUBJECT = { F_01: "OT_SITE", F_02: "OT_CELL", F_03: "OT_CELL", F_04: "OT_CELL", F_05: "OT_CELL_MR", F_06: "OT_CELL", F_07: "OT_TICKET",
  F_08: "OT_TICKET", F_09: "OT_PLAN", F_10: "OT_PLAN", F_11: "OT_EFFECT", F_12: "OT_CELL" };

const TYPE_MAP = [[/^int\b/, "integer"], [/^number\b/, "decimal"], [/^bool\b/, "boolean"], [/^datetime\b/, "timestamp"],
  [/^date\b/, "date"], [/^struct/, "object"], [/^string\b/, "string"], [/^enum\b/, "string"]];
const typeOf = t => { for (const [rx, v] of TYPE_MAP) if (rx.test(t || "")) return v; return "string"; };
const labelOf = a => (a.meaning || a.name).replace(/^关系属性：/, "").split(/[；;。]/)[0].replace(/\s+/g, " ").slice(0, 40);

function createMeta(ont) {
  const j = ont.raw, map = j.mapping || { objectTables: [], attributeColumns: [], relationTables: [] };
  const tableOf = id => (map.objectTables.find(o => o.objectType === id) || {}).table || null;
  const colOf = (owner, attr) => map.attributeColumns.find(c => c.owner === owner && c.attribute === attr) || null;
  const fieldsOf = id => {
    const t = ont.ot(id);
    return t.attributes.map(a => {
      const c = colOf(id, a.name), pk = (PK[id] || []).includes(a.name);
      return { name: a.name, physicalColumn: snake((c && c.column) || a.name), physicalTable: (c && c.table) || tableOf(id),
        type: typeOf(a.type), label: pk ? a.name + "（主键）" : labelOf(a), isPrimaryKey: pk, sourceType: a.type, direction: (c && c.direction) || null };
    });
  };
  const schema = id => {
    const t = ont.ot(id);
    return { code: id, label: t.name, primaryKey: PK[id], displayField: DISPLAY[id], physicalTable: tableOf(id), definition: t.definition, identity: t.identity, fields: fieldsOf(id) };
  };
  const functions = j.functions.map(f => {
    const params = FN_PARAMS[f.id] || [];
    return { code: f.id, name: f.code, description: f.question, object: FN_SUBJECT[f.id] || null, type: "QUERY", source: "DSL", executorType: "JS",
      version: f.version, parameters: Object.fromEntries(params.map(([n, t, d]) => [n, { type: t, description: d, required: !["rat", "ruleId", "fixedDelta"].includes(n) }])),
      returnType: "object", outputSchema: { type: "object", properties: {} },
      objectKeys: params.map(p => p[0]).filter(n => ont.ot(FN_SUBJECT[f.id] || "OT_CELL").attributes.some(a => a.name === n)),
      inputContract: f.input, method: f.method, readOnly: true, executable: true };
  });
  const actions = j.actions.map(a => {
    const target = ((a.purpose + " " + a.changes).match(/(OT_[A-Z_]+)/) || [])[1] || null, params = ACT_PARAMS[a.id] || [];
    return { code: a.id, name: a.code, object: target, type: "ACTION", label: a.label, description: a.purpose, roles: a.roles,
      parameters: params.map(([n, t, d]) => ({ name: n, type: t, description: d, required: !["mode", "role", "causeFamily", "causeLabel", "evidenceRefs", "source", "reason", "executor", "approvals", "auto", "applicability"].includes(n) })),
      approvalRequired: /批准|审批/.test(a.purpose), usesProperties: Object.keys(Object.fromEntries((a.purpose.match(/`[A-Za-z][A-Za-z0-9_]*`/g) || []).map(x => [x.slice(1, -1), 1])))
        .filter(n => j.objectTypes.some(o => o.attributes.some(x => x.name === n))),
      definedOnly: !!a.definedOnly, failure: a.failure };
  });
  const relationTypes = j.relationTypes.map(r => {
    const m = (map.relationTables.find(x => x.relationType === r.id) || {});
    return { code: r.id, name: r.name, from: r.from, to: r.to, cardinality: r.cardinality, attributes: r.attributes.map(a => a.name),
      physicalTable: m.table || null, joinKeys: m.joinKeys || [], direction: m.direction || null };
  });
  const ontology = () => ({
    code: ONTOLOGY_CODE, file: "shwo.ontology.json", name: "无线弱覆盖分析及优化决策",
    description: `基于本体的弱覆盖场景：${j.objectTypes.length} 个对象类型、${j.relationTypes.length} 条关系、${j.functions.length} 个函数、${j.actions.length} 个动作；问题锚点为小区日MR统计`,
    domain: "无线网络优化（弱覆盖）", anchor: "OT_CELL_MR", spec: { file: j.source.file, sha256: j.source.sha256 },
    objectTypeCount: j.objectTypes.length, functionCount: j.functions.length, actionCount: j.actions.length, relationTypeCount: j.relationTypes.length
  });
  const fields = id => fieldsOf(id);
  const hasType = id => !!ont.ot(id);
  return { code: ONTOLOGY_CODE, ontology, objectTypes: () => j.objectTypes.map(t => ({ code: t.id, label: t.name, primaryKey: PK[t.id], displayField: DISPLAY[t.id], physicalTable: tableOf(t.id) })),
    schema, functions, actions, relationTypes, fields, hasType, states: j.states, transitions: j.transitions, dispatchRules: j.dispatchRules, measureTypes: j.measureTypes,
    constraints: j.constraints, rules: j.rules, assumptions: j.assumptions, params: j.params, taskDefs: j.cases, designDecisions: j.designDecisions };
}
module.exports = { createMeta, snake, PK, DISPLAY, PARAM_ALIASES, FN_PARAMS, ACT_PARAMS };
