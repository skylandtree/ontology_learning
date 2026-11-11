// OpenAI 兼容大模型客户端：只负责 HTTP 调用、超时与错误归类，不掺杂业务语义。
// 零第三方依赖（用 Node 内置 fetch）。
//
// 配置来源（后者覆盖前者）：
//   1. 内置默认值
//   2. 本地配置文件 config/llm.config.json（api_key／base_url／model_name 等，字段用下划线写法）
//      路径可用环境变量 LLM_CONFIG_FILE 改写；文件不存在就当没配
//   3. 环境变量 LLM_BASE_URL／LLM_API_KEY／LLM_MODEL／…
//   4. 代码里 createLLM({…}) 显式传入的参数
// 缺 API Key 时自动视为"未启用"，问答退回纯规则。
const fs = require("node:fs"), path = require("node:path");
const DEFAULTS = { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", timeoutMs: 30000, temperature: 0.2, maxTokens: 1200, retries: 1, semanticEngine: "rule" };

// 本地配置文件：默认 config/llm.config.json（可用 LLM_CONFIG_FILE 指向别的路径）
const CONFIG_FILE = process.env.LLM_CONFIG_FILE || path.join(__dirname, "..", "config", "llm.config.json");

// 配置文件字段（下划线写法）→ 内部字段（驼峰）
const FILE_KEYS = {
  api_key: "apiKey", base_url: "baseUrl", model_name: "model",
  timeout_ms: "timeoutMs", temperature: "temperature", max_tokens: "maxTokens",
  retries: "retries", semantic_engine: "semanticEngine", enabled: "enabled",
  extra_headers: "extraHeaders"
};

/** 读本地配置文件；读不到或坏了都当作没配（不影响规则问答） */
function readFileConfig(file = CONFIG_FILE) {
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch { return { values: {}, source: null, error: null }; }
  let j;
  try { j = JSON.parse(raw); } catch (e) { return { values: {}, source: file, error: `配置文件不是合法 JSON：${e.message}` }; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return { values: {}, source: file, error: "配置文件根节点须是对象" };
  const values = {};
  for (const [k, v] of Object.entries(j)) {
    if (k === "extra_headers") { values.extraHeaders = v && typeof v === "object" && !Array.isArray(v) ? v : {}; continue; }
    if (FILE_KEYS[k]) values[FILE_KEYS[k]] = v;
  }
  if (values.semanticEngine && !["rule", "llm"].includes(String(values.semanticEngine))) values.semanticEngine = "rule";
  return { values, source: file, error: null };
}

class LLMError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "LLMError";
    this.code = code;
    Object.assign(this, extra);
  }
}

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
function parseHeaders(s) {
  if (!s) return {};
  try { const o = JSON.parse(s); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; }
}

// 环境变量：LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / LLM_TIMEOUT_MS / LLM_TEMPERATURE / LLM_MAX_TOKENS / LLM_RETRIES / LLM_EXTRA_HEADERS
// 优先级：默认值 < 本地配置文件 < 环境变量 < 显式入参
function readConfig(env = process.env, over = {}) {
  const file = readFileConfig(over.configFile || env.LLM_CONFIG_FILE || CONFIG_FILE);
  const f = file.values || {};
  const pick = (envKeys, fileVal, dflt) => {
    for (const k of envKeys) if (env[k] !== undefined && env[k] !== null && env[k] !== "") return env[k];
    if (fileVal !== undefined && fileVal !== null && fileVal !== "") return fileVal;
    return dflt;
  };
  const cfg = {
    baseUrl: String(pick(["LLM_BASE_URL", "OPENAI_BASE_URL"], f.baseUrl, DEFAULTS.baseUrl)).replace(/\/+$/, ""),
    apiKey: String(pick(["LLM_API_KEY", "OPENAI_API_KEY"], f.apiKey, "")),
    model: String(pick(["LLM_MODEL", "OPENAI_MODEL"], f.model, DEFAULTS.model)),
    timeoutMs: num(pick(["LLM_TIMEOUT_MS"], f.timeoutMs, DEFAULTS.timeoutMs), DEFAULTS.timeoutMs),
    temperature: num(pick(["LLM_TEMPERATURE"], f.temperature, DEFAULTS.temperature), DEFAULTS.temperature),
    maxTokens: num(pick(["LLM_MAX_TOKENS"], f.maxTokens, DEFAULTS.maxTokens), DEFAULTS.maxTokens),
    retries: num(pick(["LLM_RETRIES"], f.retries, DEFAULTS.retries), DEFAULTS.retries),
    // 语义理解引擎开关：rule＝纯规则（默认，可测可复现）｜llm＝大模型做语义理解
    semanticEngine: ["rule", "llm"].includes(String(pick(["LLM_SEMANTIC_ENGINE"], f.semanticEngine, DEFAULTS.semanticEngine))) ? String(pick(["LLM_SEMANTIC_ENGINE"], f.semanticEngine, DEFAULTS.semanticEngine)) : "rule",
    headers: { ...(f.extraHeaders || {}), ...parseHeaders(env.LLM_EXTRA_HEADERS) },
  };
  for (const k of Object.keys(over)) if (over[k] !== undefined && over[k] !== null) cfg[k] = over[k];
  cfg.baseUrl = String(cfg.baseUrl).replace(/\/+$/, "");
  cfg.timeoutMs = num(cfg.timeoutMs, DEFAULTS.timeoutMs);
  cfg.retries = Math.max(0, Math.min(3, num(cfg.retries, DEFAULTS.retries)));
  if (!["rule", "llm"].includes(String(cfg.semanticEngine))) cfg.semanticEngine = "rule";
  // 配置来源（给前端与自检显示"这次用的是哪份配置"）
  cfg.configFile = file.source;
  cfg.configError = file.error;
  // enabled 的优先级：代码显式入参 > 环境变量 LLM_ENABLED > 配置文件 enabled > "有 API Key 就算启用"。
  // 没写死的地方保持 undefined，让 createLLM 按"有 Key 就算启用"处理。
  if (over.enabled === undefined || over.enabled === null) {
    const envEnabled = env.LLM_ENABLED;
    if (envEnabled !== undefined && envEnabled !== null && envEnabled !== "") cfg.enabled = !/^(0|false|off|no)$/i.test(String(envEnabled));
    else if (f.enabled !== undefined) cfg.enabled = !!f.enabled;
    else cfg.enabled = undefined;
  }
  return cfg;
}

// 从模型输出里取 JSON 对象：容忍 ```json 围栏、前后解释文字
function pickJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

function createLLM(cfg = {}) {
  const conf = readConfig(process.env, cfg);
  // 启用条件：有 API Key，或配置文件里显式 enabled=true（本地自建模型服务可能不校验 Key）。
  // 优先级：代码显式入参 > 环境变量 > 配置文件 > "有 Key 就算启用"。
  // 显式 enabled=false 一律不启用——开关放在配置里，不散落在代码中。
  const forced = conf.enabled;
  const enabled = forced === false ? false : (!!conf.apiKey || forced === true);
  let last = null; // 最近一次调用摘要（给服务端日志与测试断言用）

  async function once(messages, opt) {
    if (!enabled) throw new LLMError("NO_KEY", "未配置 API Key（config/llm.config.json 的 api_key 或环境变量 LLM_API_KEY），大模型未启用");
    const body = {
      model: opt.model || conf.model,
      messages,
      temperature: opt.temperature === undefined ? conf.temperature : opt.temperature,
      max_tokens: opt.maxTokens || conf.maxTokens,
      stream: false,
    };
    if (opt.json) body.response_format = { type: "json_object" };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opt.timeoutMs || conf.timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(`${conf.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(conf.apiKey ? { authorization: `Bearer ${conf.apiKey}` } : {}), ...conf.headers },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const raw = await res.text();
      if (!res.ok) {
        // 4xx 不重试（除 429 限流），5xx 可重试
        const code = res.status === 401 || res.status === 403 ? "AUTH" : res.status === 429 ? "RATE" : `HTTP_${res.status}`;
        throw new LLMError(code, `大模型接口返回 ${res.status}：${raw.slice(0, 240)}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
      }
      let j;
      try { j = JSON.parse(raw); } catch { throw new LLMError("BAD_RESPONSE", "大模型接口返回的不是 JSON：" + raw.slice(0, 200)); }
      const content = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || "") : "";
      if (!content) throw new LLMError("EMPTY", "大模型返回了空内容");
      last = { model: (j && j.model) || body.model, usage: (j && j.usage) || null, ms: Date.now() - t0, finish: j.choices[0].finish_reason || null };
      return { content, usage: last.usage, model: last.model, ms: last.ms, finish: last.finish };
    } catch (e) {
      if (e instanceof LLMError) throw e;
      if (e && (e.name === "AbortError" || e.code === "ABORT_ERR")) throw new LLMError("TIMEOUT", `大模型调用超时（${opt.timeoutMs || conf.timeoutMs} ms）`);
      throw new LLMError("NETWORK", `无法连接大模型接口 ${conf.baseUrl}：${e.message}`, { retryable: true });
    } finally { clearTimeout(timer); }
  }

  async function chat(messages, opt = {}) {
    let attempt = 0, err = null;
    const max = opt.retries === undefined ? conf.retries : opt.retries;
    while (attempt <= max) {
      try { return await once(messages, opt); }
      catch (e) {
        err = e;
        if (!e.retryable || attempt === max) break;
        attempt += 1;
        await new Promise(r => setTimeout(r, 300 * attempt));
      }
    }
    throw err;
  }

  // 便捷：要求模型输出 JSON 对象（不支持 response_format 的网关会自动退化为文本解析）
  async function json(messages, opt = {}) {
    let r;
    try { r = await chat(messages, { ...opt, json: true }); }
    catch (e) { if (e.code !== "HTTP_400" && e.code !== "HTTP_422") throw e; r = await chat(messages, { ...opt, json: false }); }
    const obj = pickJson(r.content);
    if (!obj) throw new LLMError("BAD_JSON", "大模型未按 JSON 作答：" + r.content.slice(0, 200), { content: r.content });
    return { ...r, data: obj };
  }

  // 流式对话：请求 stream:true，按网关的 SSE 格式逐段吐出增量文本。
  // 网关不支持流式时（返回普通 JSON）也能兜住：把整段内容作为一次增量吐出。
  async function* chatStream(messages, opt = {}) {
    if (!enabled) throw new LLMError("NO_KEY", "未配置 API Key（config/llm.config.json 的 api_key 或环境变量 LLM_API_KEY），大模型未启用");
    const body = {
      model: opt.model || conf.model,
      messages,
      temperature: opt.temperature === undefined ? conf.temperature : opt.temperature,
      max_tokens: opt.maxTokens || conf.maxTokens,
      stream: true,
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), opt.timeoutMs || conf.timeoutMs);
    const t0 = Date.now();
    try {
      const res = await fetch(`${conf.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(conf.apiKey ? { authorization: `Bearer ${conf.apiKey}` } : {}), ...conf.headers },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const raw = await res.text();
        const code = res.status === 401 || res.status === 403 ? "AUTH" : res.status === 429 ? "RATE" : `HTTP_${res.status}`;
        throw new LLMError(code, `大模型接口返回 ${res.status}：${raw.slice(0, 240)}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
      }
      // 网关没给流：按普通 JSON 读一次，整段作为增量
      const ct = String(res.headers.get("content-type") || "");
      if (!res.body || (!ct.includes("text/event-stream") && !ct.includes("stream"))) {
        const j = await res.json().catch(() => null);
        const content = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || "") : "";
        if (!content) throw new LLMError("EMPTY", "大模型返回了空内容");
        last = { model: (j && j.model) || body.model, usage: (j && j.usage) || null, ms: Date.now() - t0, finish: null, streamed: false };
        yield content;
        return;
      }
      const dec = new TextDecoder();
      let buf = "", usage = null, model = body.model, finish = null;
      for await (const chunk of res.body) {
        // 超时按"相邻两段增量之间"计：整段回答再长，只要还在往外吐就不算超时；
        // 真卡住（网关挂起、首段迟迟不来）才由 timeoutMs 兜住。
        if (typeof timer.refresh === "function") timer.refresh();
        buf += dec.decode(chunk, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line || line.startsWith(":")) continue;          // 注释行（心跳）
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") { last = { model, usage, ms: Date.now() - t0, finish, streamed: true }; return; }
          let j;
          try { j = JSON.parse(data); } catch { continue; }      // 网关偶发的非 JSON 行：跳过
          if (j.model) model = j.model;
          if (j.usage) usage = j.usage;
          const ch = j.choices && j.choices[0];
          if (ch && ch.finish_reason) finish = ch.finish_reason;
          const delta = ch && ch.delta;
          const content = delta ? String(delta.content || "") : "";
          if (content) yield content;
        }
      }
      last = { model, usage, ms: Date.now() - t0, finish, streamed: true };
    } catch (e) {
      if (e instanceof LLMError) throw e;
      if (e && (e.name === "AbortError" || e.code === "ABORT_ERR")) throw new LLMError("TIMEOUT", `大模型调用超时（${opt.timeoutMs || conf.timeoutMs} ms）`);
      throw new LLMError("NETWORK", `无法连接大模型接口 ${conf.baseUrl}：${e.message}`, { retryable: true });
    } finally { clearTimeout(timer); }
  }

  return {
    enabled, conf, chat, json, chatStream,
    get last() { return last; },
    describe() {
      return {
        enabled, baseUrl: conf.baseUrl, model: conf.model, timeoutMs: conf.timeoutMs,
        semanticEngine: conf.semanticEngine, configFile: conf.configFile || null, configError: conf.configError || null,
        hasApiKey: !!conf.apiKey
      };
    },
  };
}

module.exports = { createLLM, readConfig, readFileConfig, pickJson, LLMError, DEFAULTS, CONFIG_FILE };
