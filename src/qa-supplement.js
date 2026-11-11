// 本体外知识补充层：当本体自己答不了的时候（范围外／规则缺口／数据缺口／能力缺口／意图未识别），
// 由大模型补一段【通用工程知识与排查思路】作为参考。
//
// 三条不变量（与本体层严格分开）：
//   1. 不写库：补充只出现在回答里，不写进任何对象、关系、诊断记录，不进动作入参。
//   2. 不冒充本体：补充里不得出现本体没有的编号（OT_／RT_／F_／A_／INV_／RULE_／TH），
//      不得冒充本体的判定结论（命中／不命中、该调多少度、门限取值）。
//   3. 不代替人工：补充是参考方向，谁来确认、谁来做，写在回答里；不触发任何写动作。
//
// 补充段单独挂在返回值的 supplement 字段上，不并入 text，也不参与事实的数值落地检查——
// 因为它本来就不是本体事实。它的落地由本模块自己的检查（checkSupplement）负责。

// 缺口类型：本体答不了的五种形态。规则层在答不了的时候把 gap 一并带出来。
const GAP_KIND = {
  scope: "范围外",        // 问题类型不在 SPEC 范围内（如重叠覆盖、切换差）
  rule: "规则缺口",       // 有对象但没有适用规则／公式（VIP 场景、NR 下倾公式）
  data: "数据缺口",       // 缺 MR、缺工参、来源冲突
  capability: "能力缺口", // 本期措施字典外的手段、预测类请求
  unrecognized: "意图未识别", // 没匹配到任何本体意图
};

const ONT_SCOPE = "弱覆盖发现（4G／5G 宏站与室分，一般场景）＋4G 宏站“天线下倾角过小”的原因与处置";

// 补充段的系统提示：只给方向与通用做法，不给本体的判定结论。
const SUPPLEMENT_SYS = `你是通信网络优化工程师的知识顾问，坐在一个弱覆盖处置本体工作台旁边。提问者问的是这个工作台答不了的问题，你补的是【通用工程知识与排查思路】，不是这个工作台的判定。

硬性规则：
1. 你不判定。不得出现"命中""不命中""就是弱覆盖""已确认根因"这类对本体的结论，不得给出"应下倾多少度""调功率到多少"这类可执行指令。
2. 你不编号。不得出现本体里没有的编号（OT_／RT_／F_／A_／INV_／RULE_／TH 形式）；只能引用【本体已有】里给出的编号。
3. 你给方向：常见的排查顺序、可能的原因类别（类别级，不是本小区的结论）、这类问题通常由谁确认、在当前工作台里能接着问什么。
4. 数值只允许标准编号与频段号（如 3GPP TS 38.901、n78）；不得给门限、阈值、参数、容差、调整幅度这类可被当成系统参数的数字。
5. 纯文本，不用 Markdown、标题、列表符号、加粗；不超过 6 句、约 200 字。
6. 最后一句点明这是通用参考、不是本体的判定，需要业务或人工确认。`;

// 本体里没有的编号 → 不许出现在补充里
const ID_RE = /\b(?:OT_[A-Z_]+|RT_\d+|F_\d+|A_\d+|INV_\d+|RULE_[A-Z]\d+|TH\d+)\b/g;
// 冒充本体的判定（只抓断言式说法，"未命中""不命中"不算）
const VERDICT_RE = /判定为|认定为|结论[：:]|已确认根因|应下倾|应该下倾|就是命中|已命中|命中了|就是弱覆盖/;
// 可执行指令
const DIRECTIVE_RE = /(调(整|节)?(功率|方位|挂高)到|下倾到|设置为|改成)\s*\d/;
// 允许出现在补充里的数字形态：标准编号（38.901）、频段号（n78）、年份、3GPP/TS/RFC 字样
const ALLOW_STRIP = /\b3GPP\b|\bTS\b|\bRFC\b|\b\d{2}\.\d{3}\b|\bn\d{2,3}\b|\b(?:19|20)\d{2}\b/g;

const CAVEAT = "以上是通用工程参考，不是本体的判定结论，也不写入任何记录；要形成结论需业务或人工确认。";

function clean(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// 补充段的落地检查：编号不编造、不冒充判定、不给可执行指令、数值不带系统参数含义。
// allowed 是本次回答引用到的本体编号（允许被提及），gapKind 决定可以谈的范围。
function checkSupplement(text, allowed = [], gapKind = "") {
  const t = String(text || ""), issues = [];
  const ids = [...new Set(t.match(ID_RE) || [])];
  const fake = ids.filter(id => !allowed.includes(id));
  if (fake.length) issues.push("出现本体没有的编号：" + fake.join("、"));
  if (VERDICT_RE.test(t)) issues.push("出现对本体的判定结论");
  if (DIRECTIVE_RE.test(t)) issues.push("出现可执行指令");
  // 数值：允许标准编号与频段号，其余视为疑似系统参数（先剥掉允许形态再找数字）
  const stripped = t.replace(ALLOW_STRIP, " ").replace(ID_RE, " ");
  const nums = [...new Set(stripped.match(/\d+(?:\.\d+)?/g) || [])];
  if (nums.length) issues.push("出现疑似系统参数的数值：" + nums.slice(0, 4).join("、"));
  // 能力缺口／预测类不许给趋势结论
  if (gapKind === "capability" && /(会(继续|上升|下降|恶化)|预计|预测|趋势)/.test(t)) issues.push("出现趋势或预测结论");
  return { ok: issues.length === 0, issues, ids };
}

// 补一句免责说明（模型自己写了就不重复写）
function withCaveat(text) {
  const t = String(text || "").trim();
  if (!t) return t;
  if (/通用参考|不是本体的判定|需.*确认/.test(t.slice(-80))) return t;
  return t + " " + CAVEAT;
}

// 截到句末，超过 400 字就断在最后一个句号
function trim(text, max = 400) {
  const t = String(text || "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("；"), cut.lastIndexOf("\n"));
  return (i > 40 ? cut.slice(0, i + 1) : cut).trim();
}

/**
 * 构造并执行一次补充。
 * @param {object} p
 *   question 用户原句
 *   out      规则引擎给出的事实（其中 gap 字段描述缺口）
 *   ctx      会话上下文（角色、当前小区、当前工单）
 *   llm      大模型客户端
 *   app      应用（取本体要素清单，用于告诉模型"本体已有什么"）
 *   opt      {retryHint} 重写提示
 * @returns {Promise<object|null>} {ok, kind, text, issues, model, numbers}
 */
async function buildSupplement(p) {
  const { question, out, ctx = {}, llm, app, opt = {} } = p;
  const gap = out && out.gap;
  if (!gap || !llm || !llm.enabled) return null;
  const allowed = [...new Set(out.refs || [])];
  const ont = app && app.ont && app.ont.raw;
  const counts = ont ? `本体含 ${(ont.objectTypes || []).length} 个对象类型、${(ont.functions || []).length} 个函数、${(ont.actions || []).length} 个动作、${(ont.constraints || []).length} 条核心约束。` : "";
  const hint = opt.retryHint ? `\n上一版补充没通过检查：${opt.retryHint}。请重写，去掉这些内容。` : "";
  const msgs = [
    { role: "system", content: SUPPLEMENT_SYS },
    { role: "user", content:
      `【问题】${question}\n\n` +
      `【缺口类型】${GAP_KIND[gap.kind] || gap.kind || "本体未覆盖"}\n` +
      `【本体边界】${gap.boundary || ONT_SCOPE}\n` +
      `【本体已有（可引用的编号）】${allowed.join("、") || "无"}\n` +
      `【本体规模】${counts}\n` +
      `【当前上下文】角色 ${ctx.role || "未知"}；当前小区 ${ctx.cellName || "无"}；当前工单 ${ctx.ticketNo || "无"}。` + hint },
  ];
  const r = await llm.chat(msgs, { maxTokens: 500, temperature: opt.retryHint ? 0 : 0.3 });
  const raw = clean(r.content), checked = checkSupplement(raw, allowed, gap.kind);
  return {
    ok: checked.ok, kind: gap.kind, kindLabel: GAP_KIND[gap.kind] || gap.kind,
    text: checked.ok ? withCaveat(trim(raw)) : raw,
    issues: checked.issues, model: r.model,
    numbers: (raw.replace(ALLOW_STRIP, " ").match(/\d+(?:\.\d+)?/g) || []),
  };
}

module.exports = { buildSupplement, checkSupplement, GAP_KIND, ONT_SCOPE, SUPPLEMENT_SYS, CAVEAT, trim, withCaveat };
