// 业务用例框架：按业务人员的实际使用顺序写步骤（谁、在什么时候、做什么或问什么、预期看到什么），在上海种子数据上逐步执行。
// 步骤有四种：at 推进时钟（MR 日统计随到达时间入库）、A 某个角色执行动作、Q 某个角色向系统提问、V 查看／核对（只读）。
// 每步的预期要么是“成功＋若干核对”，要么是“被某条约束拒绝”；问答步骤还核对意图、回答里必须出现的事实、数值落地和是否写库。
const S = require("../../src/scenarios.js"), { createQA } = require("../../src/qa.js"), { tracker } = require("../../src/tracker.js"), { loadMR } = require("../../src/loader.js");
const { fresh, SEED, Ctx, BOT, ENG, SUP, FLD, KNW, EXPERT, FE, X, APPLIC, dispatch, execute } = S;
// MR 平台日汇总到达／更正（DM_01）：进程内直接装载；接口层走 POST /ingest/cell-mr，语义相同
const ingestMR = (w, rows) => (w.app.ingestMR ? w.app.ingestMR(rows) : loadMR(w.app.store, rows));

// ── 步骤构造器
const at = (iso, biz) => ({ k: "at", iso, biz: biz || `时间推进到 ${iso.replace("T", " ")}（此前到达的 MR 日统计已入库）` });
const A = (actor, id, biz, input, ex = {}) => ({ k: "act", actor, id, biz, input, ex });
const Q = (role, q, ex = {}) => ({ k: "q", role, q, ex });
const V = (role, biz, fn) => ({ k: "view", role, biz, fn });
// 打开某张工单的页面：问答里“它／这张工单”指的就是这张
const F = (role, biz, key) => ({ k: "focus", role, biz, key });
const ok = (expect, check) => ({ ok: true, expect, check });
const rej = (code, expect, check) => ({ ok: false, code, expect, check });

// ── 世界状态：业务从哪一步开始。每个状态都是前一个状态再往前走一步，所有数据来自 data/seed 的 CSV，时钟随 MR 到达时间推进。
const CHAIN = [
  ["清晨", "2026-09-11 09:00，晨会前。前 7 天（9 月 4 日～10 日）的 MR 日统计都已到达（9 月 11 日凌晨入库），还没有任何工单。"],
  ["工单待核验", "崇明崇贤达NF02H_222 已由优化本体依发现结果建单，状态“待核验”，尚未定因。"],
  ["已定因", "该工单已由优化本体按规则定因（F_07 告警部分重合，F_08 下倾角命中），等待工程师确认。"],
  ["已确认", "工程师已确认根因（附复核意见），工单“已确认”，尚无方案。"],
  ["方案待确认", "优化本体已生成机械下倾方案 R1（周边影响通过），方案“待确认”，作用于崇贤达NF02H_222、崇贤达NF08H_223 两个小区。"],
  ["已派单", "2026-09-12：工程师与优化主管已批准并派单，现场维护人员尚未回填，工单“处置中”。"],
  ["已回填", "现场已调整机械下倾 3°→4° 并回填，方案“已实施”，工单“待评估”，后窗 MR 尚未到齐。"],
  ["第1周已评估", "2026-09-22：后窗满 7 天，已写入第 1 周效果（改善，持续有效为空），工单“已改善”。"],
  ["持续有效", "2026-09-29：后窗满 14 天，第二次评估为“持续有效”，工单可关闭。"],
  ["已关单入库", "2026-09-29 10:00：优化主管已关闭工单，知识维护人已把案例入库（有效可复现、未验证）。"],
];
const WORLDS = Object.fromEntries(CHAIN.map(([n, d]) => [n, d]));
function buildWorld(name, seed, start, wrap) {
  const i = CHAIN.findIndex(c => c[0] === name); if (i < 0) throw new Error("没有这个业务状态：" + name);
  const app = wrap ? wrap(fresh(seed || SEED, start)) : fresh(seed || SEED, start), c = new Ctx("w", "w", []), x = {};
  if (i >= 1) x.no = app.act("A_01", { cellKey: X }, BOT).result.ticketNo;
  if (i >= 2) app.act("A_02", { ticketNo: x.no, mode: "rule" }, BOT);
  if (i >= 3) app.act("A_03", { ticketNo: x.no, decision: "确认", reason: "复核：告警与命中日仅部分重合，不影响主因" }, ENG);
  if (i >= 4) x.planNo = app.act("A_04", { ticketNo: x.no, adjustType: "机械" }, BOT).result.planNo;
  if (i >= 5) { app.at("2026-09-12T09:00:00"); x.dispatchNo = dispatch(c, app, x.planNo).dispatchNo; }
  if (i >= 6) { app.at(FE.receivedAt); execute(c, app, x.planNo, x.dispatchNo); }
  if (i >= 7) { app.at("2026-09-22T09:00:00"); x.e1 = app.act("A_07", { planNo: x.planNo }, BOT).result; }
  if (i >= 8) { app.at("2026-09-29T09:00:00"); x.e2 = app.act("A_07", { planNo: x.planNo }, BOT).result; }
  if (i >= 9) { app.at("2026-09-29T10:00:00"); app.act("A_08", { ticketNo: x.no }, SUP); x.caseNo = app.act("A_09", { effectNo: x.e2.effectNo, applicability: APPLIC }, KNW).result.caseNo; }
  return { app, x };
}

// ── 执行
const short = v => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 160 ? s.slice(0, 160) + "…" : s; };
const mkT = rec => ({
  ok: (desc, cond, detail) => rec.checks.push({ desc, pass: !!cond, detail: cond ? undefined : detail }),
  eq(desc, a, b) { this.ok(desc, JSON.stringify(a) === JSON.stringify(b), `实际 ${JSON.stringify(a)}，预期 ${JSON.stringify(b)}`); },
  near(desc, a, b, eps = 0.051) { this.ok(desc, typeof a === "number" && Math.abs(a - b) <= eps, `实际 ${a}，预期 ${b}`); },
});

function runCase(def, wrap) {
  const kind = def.kind === "qa" ? "biz-qa" : "biz-decision", res = { id: def.id, title: def.title, steps: [] };
  let w, qa; const x = {};
  const newQA = () => (wrap ? w.app.qa() : createQA(w.app));
  tracker.with("setup", def.id, () => { const b = buildWorld(def.world, def.seed && S.variant(def.seed), def.start, wrap); w = { app: b.app }; Object.assign(x, b.x); });
  tracker.with(kind, def.id, () => {
    def.steps.forEach((s, n) => {
      const rec = { n: n + 1, k: s.k, who: s.k === "act" ? s.actor.role : s.k === "at" ? "（时间）" : s.role, biz: s.k === "q" ? s.q : s.biz, checks: [], pass: true, expect: "" };
      const t = mkT(rec);
      try {
        if (s.k === "at") { w.app.at(s.iso); rec.expect = "时钟推进，到达的 MR 日统计入库"; t.eq("时钟", w.app.store.peekNow(), s.iso); }
        else if (s.k === "view") { rec.expect = "只读核对"; s.fn(x, w, t); }
        else if (s.k === "focus") { qa = qa || newQA(); qa.sess.ticketNo = x[s.key]; rec.expect = "当前工单切换"; t.ok("工单存在", !!w.app.store.doc("OT_TICKET", x[s.key]), String(x[s.key])); }
        else if (s.k === "act") {
          const input = typeof s.input === "function" ? s.input(x, w) : s.input, r = w.app.act(s.id, input, s.actor), ex = s.ex;
          rec.expect = ex.ok ? ex.expect || "成功" : `被拒绝：${ex.code}${ex.expect ? "（" + ex.expect + "）" : ""}`;
          rec.note = r.ok ? "成功 " + short(r.result) : `拒绝 ${r.code}：${r.msg}`;
          t.ok(ex.ok ? `${s.id} 成功` : `${s.id} 被 ${ex.code} 拒绝`, ex.ok ? r.ok : !r.ok && r.code === ex.code, `实际 ${r.ok ? "成功" : r.code + "：" + r.msg}`);
          if (ex.check) ex.check(r, x, w, t);
        } else if (s.k === "q") {
          if (!qa) { qa = newQA(); qa.sess.ticketNo = x.no || null; }
          const ex = s.ex, before = w.app.store.runs().length;
          // ex.cell＝当前小区上下文（问句里的“它／这个小区”指向它）；ex.readOnly＝只读问答（不代为执行写动作）
          const r = qa.ask(s.q, { role: s.role, cellKey: ex.cell || null, readOnly: !!ex.readOnly }), writes = w.app.store.runs().length - before;
          rec.expect = [ex.intent && `意图 ${ex.intent}`, (ex.has || []).length && `回答含：${ex.has.join("、")}`, (ex.not || []).length && `不含：${ex.not.join("、")}`, ex.gap === null && "本体能答（不声明缺口）", ex.gap && `缺口 ${ex.gap}`, `写入 ${ex.writes || 0} 条审计`, ex.pending && `提示人工 ${ex.pending.join("、")}`].filter(Boolean).join("；");
          rec.note = r.text; rec.intent = r.intent; rec.refs = r.refs; rec.grounded = r.grounded; rec.gap = r.gap ? r.gap.kind : null;
          t.ok(`意图＝${ex.intent}`, r.intent === ex.intent, `实际 ${r.intent}`);
          const miss = (ex.has || []).filter(h => !r.text.includes(h)); t.ok("回答含预期事实", miss.length === 0, `缺少 ${JSON.stringify(miss)}；答案：${r.text.slice(0, 260)}`);
          const bad = (ex.not || []).filter(h => r.text.includes(h)); t.ok("回答不含不该出现的内容", bad.length === 0, `出现 ${JSON.stringify(bad)}`);
          t.ok("回答里的数值与日期都能追溯到引用来源", r.grounded.ok, `未落地 ${JSON.stringify(r.grounded.ungrounded)}`);
          t.ok(`写入审计 ${ex.writes || 0} 条`, writes === (ex.writes || 0), `实际 ${writes}`);
          if (ex.pending) t.ok("提示了需要人工执行的动作", ex.pending.every(a => (r.pending || []).includes(a)), `实际 ${JSON.stringify(r.pending)}`);
          // 本体答不了时先声明缺口类型与边界（大模型补充段的挂载点）；gap: null 表示本体能答、不得声明缺口
          if (ex.gap !== undefined) {
            if (ex.gap === null) t.ok("本体能答：不声明缺口，不触发补充", !r.gap, `实际 ${r.gap ? r.gap.kind : "无 gap"}`);
            else {
              t.ok(`声明缺口类型＝${ex.gap}`, !!(r.gap && r.gap.kind === ex.gap), `实际 ${r.gap ? r.gap.kind : "无 gap"}`);
              t.ok("缺口带本体边界说明，补充只能在这条边界之外", !!(r.gap && String(r.gap.boundary || "").length > 8), r.gap ? String(r.gap.boundary) : "无 boundary");
            }
            t.ok("规则档不带补充段（补充在本体事实之外单列，不冒充本体）", !r.supplement, JSON.stringify(r.supplement));
          }
          if (ex.check) ex.check(r, x, w, t);
        }
      } catch (e) { t.ok("步骤执行无异常", false, e.stack.split("\n").slice(0, 3).join(" | ")); }
      rec.pass = rec.checks.every(c => c.pass); res.steps.push(rec);
    });
  });
  res.total = res.steps.reduce((s, r) => s + r.checks.length, 0); res.passed = res.steps.reduce((s, r) => s + r.checks.filter(c => c.pass).length, 0); res.ok = res.steps.every(r => r.pass);
  return res;
}

// ── 文档：用例清单（不含执行结果）与执行报告
const esc = s => String(s).replace(/\|/g, "／").replace(/\n/g, " ");
function catalog(defs, title, intro, lvl = 1) {
  const H = n => "#".repeat(lvl + n) + " ";
  let md = `${H(0)}${title}\n\n${intro}\n\n`;
  md += `| 编号 | 用例 | 主要角色 | 起始状态 | 步骤数 | 对应 SPEC 用例 |\n|---|---|---|---|---|---|\n` + defs.map(d => `| ${d.id} | ${d.title} | ${d.role} | ${d.world} | ${d.steps.length} | ${(d.spec || []).join("、") || "—"} |`).join("\n") + "\n\n";
  for (const d of defs) {
    md += `${H(1)}${d.id} ${d.title}\n\n- **主要角色**：${d.role}\n- **业务场景**：${d.scene}\n- **起始状态**（${d.world}）：${WORLDS[d.world]}\n${d.data || d.start ? "- **数据与时间**：" + [d.data && "与种子数据相比：" + d.data, d.start && "起始时间 " + d.start.replace("T", " ")].filter(Boolean).join("；") + "\n" : ""}${d.spec && d.spec.length ? "- **对应 SPEC 用例**：" + d.spec.join("、") + "\n" : ""}\n| # | 角色 | 业务动作／提问 | 预期 |\n|---|---|---|---|\n`;
    // 预期文字取自步骤定义（不执行）
    md += d.steps.map((s, n) => { const who = s.k === "act" ? s.actor.role : s.k === "at" ? "（时间）" : s.role, biz = s.k === "q" ? "问：" + s.q : s.biz, ex = s.ex || {};
      const exp = s.k === "at" ? "MR 日统计随到达时间入库" : s.k === "view" ? "只读核对" : s.k === "focus" ? "当前工单切换" : s.k === "act" ? (ex.ok ? ex.expect || "成功" : `被 ${ex.code} 拒绝${ex.expect ? "：" + ex.expect : ""}`) : [ex.intent && `意图 ${ex.intent}`, (ex.has || []).length && `回答含：${ex.has.join("、")}`, (ex.not || []).length && `不含：${ex.not.join("、")}`, ex.gap === null && "本体能答（不声明缺口）", ex.gap && `缺口 ${ex.gap}`, ex.writes ? `写入 ${ex.writes} 条审计` : "只读", ex.pending && `提示人工 ${ex.pending.join("、")}`].filter(Boolean).join("；");
      return `| ${n + 1} | ${who} | ${esc(biz)} | ${esc(exp)} |`; }).join("\n") + "\n\n";
  }
  return md;
}
function report(results, title) {
  const tot = results.reduce((s, r) => s + r.total, 0), pass = results.reduce((s, r) => s + r.passed, 0);
  let md = `# ${title}\n\n**${results.filter(r => r.ok).length}/${results.length} 个用例通过，${pass}/${tot} 条断言通过。**\n\n| 编号 | 用例 | 步骤 | 断言 | 结果 |\n|---|---|---|---|---|\n` + results.map(r => `| ${r.id} | ${r.title} | ${r.steps.length} | ${r.passed}/${r.total} | ${r.ok ? "✅" : "❌"} |`).join("\n") + "\n\n";
  for (const r of results) {
    md += `## ${r.id} ${r.title}\n\n`;
    for (const s of r.steps) {
      md += `${s.pass ? "✅" : "❌"} **${s.n}. ${s.who}**：${s.k === "q" ? "问：" + s.biz : s.biz}\n\n`;
      if (s.k === "q") md += `> ${s.note.replace(/\n/g, "\n> ")}\n\n意图 \`${s.intent}\`｜引用：${(s.refs || []).join("、") || "—"}\n\n`;
      else if (s.note) md += `> ${s.note}\n\n`;
      for (const c of s.checks.filter(c => !c.pass)) md += `- ❌ ${c.desc}：${c.detail}\n`; if (!s.pass) md += "\n";
    }
  }
  return md;
}
module.exports = { at, A, Q, V, F, ok, rej, runCase, catalog, report, WORLDS, CHAIN, buildWorld, ingestMR, S, BOT, ENG, SUP, FLD, KNW, EXPERT };
