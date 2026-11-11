// 业务用例执行入口：默认进程内直调；传入 transport（如接口层 api-transport）时同一套用例改走 OSDK 接口。
// 用法：node test/business.js [BD-01,BQ-02] [--transport api]
require("./model-isolated.js");   // 测试与本机大模型配置隔离：档位恒为 rule（见该文件说明）
const { CASES: DECISION } = require("./cases/decision-cases.js"), { CASES: QA } = require("./cases/qa-cases.js"), fw = require("./cases/framework.js");
const { report } = fw;
function runBusiness(ids, transport) {
  const pick = c => !ids || !ids.length || ids.includes(c.id);
  const run = c => fw.runCase(c, transport ? transport.wrap : undefined);
  return { decision: DECISION.filter(pick).map(run), qa: QA.filter(pick).map(run), defs: { decision: DECISION, qa: QA }, transport: transport ? transport.name : "in-process" };
}
if (require.main === module) {
  const args = process.argv.slice(2), transportId = args.includes("--transport") ? args[args.indexOf("--transport") + 1] : null;
  const ids = (args.find(a => /^B[DB]-\d+/.test(a)) || "").split(",").filter(Boolean);
  const transport = transportId === "api" ? require("./cases/api-transport.js").transport : null;
  if (transportId && !transport) { console.error(`未知 transport：${transportId}（可用：api）`); process.exit(2); }
  const r = runBusiness(ids, transport), all = [...r.decision, ...r.qa];
  console.log(report(all, transport ? `业务决策与问答案例（经 OSDK 接口执行：${transport.name}）` : "业务决策与问答案例（进程内直调）"));
  const bad = all.reduce((s, c) => s + c.steps.reduce((a, st) => a + (st.checks || []).filter(k => !k.pass).length, 0), 0);
  process.exit(bad ? 1 : 0);
}
const catalogDoc = () => require("./cases/catalog-doc.js").catalogDoc();
module.exports = { runBusiness, catalogDoc };
