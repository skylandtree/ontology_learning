// 流式问答（应用层）：把一次问答拆成 SSE 事件。
//
// 事件序列：meta（引擎／阶段）→ refs（回答依据的本体资源）→ delta（增量文本）×N → done（完整回答）。
//
// 事实与措辞的来源不变：规则引擎一次算出事实，大模型只改措辞；数值落地检查在送出之前完成——
// 未通过校验的句子一个都不往外送，整段回退规则原文。因此流式只影响"呈现方式"，不影响"回答什么"。
// 规则模式下答案本身是瞬间可得的（确定、可复现），按句读逐段送出只是为了逐句可读；
// 大模型模式下增量取自网关的流式接口，落地检查通过后按同样节奏送出。
const { chunkText } = require("./qa-llm.js");

// 每段之间的间隔（毫秒）。设 0 即为"一次性吐完"。
const PACING = Math.max(0, Number(process.env.QA_STREAM_PACING_MS || 16));
const sleep = ms => (ms > 0 ? new Promise(r => setTimeout(r, ms)) : Promise.resolve());

function createQAStream({ qa, llmqa, llmConf }) {
  /** 产出问答事件流；调用方负责写 SSE 帧 */
  async function* run(question, opt = {}) {
    const mode = opt.mode || (llmConf ? llmConf.semanticEngine : "rule");
    // 大模型模式：语义理解与措辞交给模型（事实仍来自规则引擎）
    if (mode === "llm" && llmqa && llmqa.enabled) {
      for await (const ev of llmqa.askStream(question, opt)) {
        if (ev.type === "delta") { yield ev; await sleep(PACING); }
        else yield ev;
      }
      return;
    }
    // 规则模式
    const t0 = Date.now();
    const out = qa.ask(question, { role: opt.role, readOnly: !!opt.readOnly });
    yield { type: "meta", engine: "rule", stage: "answer", intent: out.intent };
    yield { type: "refs", intent: out.intent, refs: out.refs || [] };
    for (const c of chunkText(out.text)) { yield { type: "delta", text: c }; await sleep(PACING); }
    yield { type: "done", out: { ...out, by: "rule", llm: { enabled: false }, ms: Date.now() - t0 } };
  }
  return { run, PACING };
}

module.exports = { createQAStream, chunkText };
