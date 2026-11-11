// 命令行问答。默认先回放到“崇明 SHCHM 第 1 周效果评估之后”（2026-09-22）再提问；--stage fresh 从只有前置数据、尚无任何工单开始。
// 语义理解引擎默认按本地配置文件 config/llm.config.json 的 semantic_engine（rule｜llm）走；
// 加 --llm 强制走大模型（OpenAI 兼容接口，配置来自 config/llm.config.json 或 LLM_BASE_URL／LLM_API_KEY／LLM_MODEL）：
// 大模型负责听懂问题与措辞，事实仍来自本体函数。
const readline = require("node:readline"), { createQA } = require("./qa.js"), { createLLMQA } = require("./qa-llm.js"), { createLLM } = require("./llm.js"), { qaWorld } = require("./qa-eval.js"), { fresh } = require("./scenarios.js");
const argv = process.argv;
const fresh_ = argv.includes("--stage") && argv[argv.indexOf("--stage") + 1] === "fresh";
const cfg = createLLM().conf;
const useLLM = argv.includes("--llm") || cfg.semanticEngine === "llm";
const app = fresh_ ? fresh(require("./scenarios.js").SEED) : qaWorld().app;
const rule = createQA(app);
const llm = useLLM ? createLLM() : null;
const qa = createLLMQA({ qa: rule, app, llm });
if (useLLM && !qa.enabled) console.log(`⚠ 已选大模型语义理解，但没有读到 API Key（config/llm.config.json 的 api_key 或环境变量 LLM_API_KEY），本轮按纯规则问答运行。`);
else if (qa.enabled) console.log(`已接入大模型：${llm.conf.model} @ ${llm.conf.baseUrl}（配置来源：${llm.conf.configFile || "环境变量"}；事实仍来自本体函数，回答仅由模型改写）`);
else console.log(`语义理解：规则引擎（config/llm.config.json 的 semantic_engine=${cfg.semanticEngine}）`);
console.log(fresh_ ? "起点：2026-09-11，只有前置数据，没有工单。" : "已回放：崇明 SHCHM 已走到第 1 周效果评估（2026-09-22）。");
console.log("可以问：哪些小区弱覆盖、某小区的判定与逐日 MR、工单依据/根因/方案/周边影响/审批/执行/效果、能否关单、案例、OT_／RT_／F_／A_／INV_／RULE_／TH 的含义；“请对××建单／定因／生成方案”由优化本体执行，确认、审批、关单等只提示。输入 exit 退出。");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "问> " }); rl.prompt();
const history = [];
rl.on("line", async line => {
  const q = line.trim(); if (q === "exit" || q === "quit") return rl.close();
  if (q) {
    const r = await qa.ask(q, { history, clock: app.store.peekNow() });
    console.log("\n" + r.text + `\n  [意图 ${r.intent}${r.by === "llm" ? "｜大模型改写" : "｜规则"}${r.llm && r.llm.error ? "｜模型不可用：" + r.llm.error.code : ""}｜引用 ${r.refs.join("、") || "—"}｜数值落地 ${r.grounded.ok ? "通过" : "未通过 " + r.grounded.ungrounded.join(",")}${r.writes && r.writes.length ? "｜写入 " + r.writes.join("；") : ""}${r.pending && r.pending.length ? "｜待人工 " + r.pending.join("、") : ""}]\n`);
    history.push({ role: "user", content: q }, { role: "assistant", content: String(r.text || "").slice(0, 500) });
    if (history.length > 8) history.splice(0, history.length - 8);
  }
  rl.prompt();
});
