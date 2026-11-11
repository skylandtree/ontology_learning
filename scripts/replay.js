// 回放全部决策场景：逐个场景打印每一步动作的结论与断言结果。
const { SCENARIOS, runScenario } = require("../src/scenarios.js");
const only = process.argv[2];
for (const sc of SCENARIOS.filter(s => !only || s.id === only)) {
  const c = runScenario(sc); console.log(`\n═══ ${sc.id} ${sc.title}（SPEC ${sc.spec.join("、")}）  断言 ${c.passed}/${c.checks.length}`);
  c.steps.forEach(s => console.log("  · " + s)); c.checks.forEach(k => console.log(`  ${k.pass ? "✓" : "✗"} ${k.desc}${k.pass ? "" : "  ← " + k.detail}`));
}
