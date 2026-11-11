// 大模型接入自检：node scripts/llm-check.js
// 依次检查：配置 → 最小对话请求 → JSON 模式 → 一次完整语义问答（理解 → 取事实 → 自然化 → 数值落地）
const { createLLM } = require("../src/llm.js");
const { createLLMQA } = require("../src/qa-llm.js");
const { createQA } = require("../src/qa.js");
const { qaWorld } = require("../src/qa-eval.js");

const ok = s => console.log("  ✓ " + s);
const bad = s => console.log("  ✗ " + s);

(async () => {
  const llm = createLLM();
  const d = llm.describe();
  console.log("配置：", d);
  if (d.configFile) console.log("配置文件：" + d.configFile);
  if (d.configError) console.log("⚠ 配置文件有问题：" + d.configError);
  console.log("语义理解开关（config/llm.config.json 的 semantic_engine）：" + d.semanticEngine);
  if (!d.enabled) {
    console.log("\n未配置 API Key。问答将按纯规则运行；");
    console.log("方式一：本地配置文件（推荐）——复制 config/llm.config.example.json 为 config/llm.config.json，填写：");
    console.log('  "api_key": "sk-..."');
    console.log('  "base_url": "http://127.0.0.1:8000/v1"');
    console.log('  "model_name": "qwen2.5-7b-instruct"');
    console.log('  "semantic_engine": "llm"        // rule＝纯规则，llm＝大模型做语义理解');
    console.log("方式二：环境变量（覆盖配置文件）");
    console.log('  $env:LLM_BASE_URL="https://api.openai.com/v1"');
    console.log('  $env:LLM_API_KEY="sk-..."');
    console.log('  $env:LLM_MODEL="gpt-4o-mini"');
    process.exit(1);
  }

  console.log("\n1) 最小对话请求");
  try {
    const r = await llm.chat([{ role: "user", content: "只回复两个字：收到" }], { maxTokens: 20 });
    ok(`${r.model || d.model} 可用，${r.ms} ms，用量 ${r.usage ? r.usage.total_tokens + " tokens" : "未返回"}`);
  } catch (e) {
    bad(`${e.code}：${e.message}`);
    process.exit(1);
  }

  console.log("\n2) JSON 模式（语义解析依赖）");
  try {
    const r = await llm.json([
      { role: "system", content: '只输出 JSON，格式 {"intent":"cause","cell":"","dates":[],"ids":[],"reason":""}' },
      { role: "user", content: "崇贤达NF02H_222 的根因是哪一类问题" },
    ], { maxTokens: 120 });
    ok(`返回 JSON：${JSON.stringify(r.data).slice(0, 120)}`);
  } catch (e) {
    bad(`${e.code}：${e.message}（网关不支持 response_format 时会自动退化为文本解析，此处失败请检查模型是否支持 JSON 输出）`);
  }

  console.log("\n3) 完整语义问答");
  const app = qaWorld().app;
  const qa = createLLMQA({ qa: createQA(app), app, llm, opts: { defaultCell: "崇贤达NF02H_222" } });
  const q = process.argv[2] || "崇贤达那个小区为啥被判成弱覆盖了？";
  const t0 = Date.now();
  const r = await qa.ask(q, { clock: app.store.peekNow() });
  console.log(`  问：${q}`);
  console.log(`  答：${r.text}`);
  console.log(`  意图 ${r.intent}｜来源 ${r.by === "llm" ? "大模型改写" : "规则原文"}｜${Date.now() - t0} ms`);
  if (r.llm && r.llm.understood) console.log(`  理解：${JSON.stringify(r.llm.understood)}`);
  if (r.llm && r.llm.error) bad(`自然化失败：${r.llm.error.code} ${r.llm.error.msg}`);
  if (r.llm && r.llm.planError) bad(`语义解析失败：${r.llm.planError.code} ${r.llm.planError.msg}`);
  console.log(r.grounded.ok ? "  ✓ 数值落地通过" : "  ✗ 数值未落地：" + r.grounded.ungrounded.join("、"));
})();
