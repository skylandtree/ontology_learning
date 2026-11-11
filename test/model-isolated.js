// 测试进程的模型隔离：让 /qa/ask 稳定走规则引擎，不受本机 config/llm.config.json 影响。
//
// 为什么必须隔离：
//   1. 可复现——断言里的意图与回答文本是规则引擎的确定输出，不因本机把 semantic_engine 切成 llm 就变；
//   2. 不真调网关——跑一次测试不该打付费接口（每问约 20 秒），也不该依赖网络；
//   3. 异步路由的契约另有验证——大模型模式（语义理解 → 取事实 → 自然化 → 数值落地 → 回退）
//      由 test/llm.js 用本地假网关单独覆盖。
//
// 做法：把 LLM_CONFIG_FILE 指向一个不存在的文件（没有配置＝未配置模型），
// 并清掉 LLM_SEMANTIC_ENGINE（否则它会盖过文件里的档位）。
// 生效档位因此恒为 rule，/qa/ask 同步返回。
const path = require("node:path");

if (!process.env.LLM_CONFIG_FILE) {
  process.env.LLM_CONFIG_FILE = path.join(__dirname, "no-such-llm.config.json");
}
delete process.env.LLM_SEMANTIC_ENGINE;

module.exports = { LLM_CONFIG_FILE: process.env.LLM_CONFIG_FILE };
