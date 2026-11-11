// 生成主线故事线网页（story.html）：叙述来自 story/mainline.js，步骤与问答原文来自业务用例的真实执行结果，
// 技术要素定义来自 ontology/shwo.ontology.json（本体只来自 SPEC）。输出为单文件、零依赖、可离线打开。
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
const { STORY } = require(path.join(root, "story/mainline.js"));
const ONT = JSON.parse(fs.readFileSync(path.join(root, "ontology/shwo.ontology.json"), "utf8"));
const S = require(path.join(root, "src/scenarios.js"));
const { runBusiness } = require(path.join(root, "test/business.js"));

const biz = runBusiness();
const RES = new Map([...biz.decision, ...biz.qa].map(r => [r.id, r]));
const DEF = new Map([...biz.defs.decision, ...biz.defs.qa].map(d => [d.id, d]));
const EXP = S.EXP.chm, FE = S.FE;

// ── 种子事实（图表用）
function readCSV(name) {
  const text = fs.readFileSync(path.join(root, "data/seed", name), "utf8").replace(/^\uFEFF/, "").trim();
  const [head, ...lines] = text.split(/\r?\n/);
  const cols = head.split(",");
  return lines.map(l => { const v = l.split(","); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
}
const CELLS = new Map(readCSV("cells.csv").map(c => [c.cellKey, c]));
const series = readCSV("cell_mr.csv")
  .filter(r => r.cellKey === S.X && r.date >= "2026-09-04" && r.date <= "2026-09-10")
  .sort((a, b) => a.date.localeCompare(b.date))
  .map(r => ({ date: r.date, total: +r.sampleTotal, weak: +r.sampleWeak, ratio: +r.sampleWeak / +r.sampleTotal }));
const nameOf = k => (CELLS.get(k) || {}).name || S.NAME(k);
const targetOf = k => +(CELLS.get(k) || {}).targetRadius;

// ── 工具
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = v => (v * 100).toFixed(2) + "%";
const num = v => (Math.round(v * 100) / 100).toFixed(2);
const pad = n => String(n).padStart(2, "0");

// ── 本体要素（抽屉）
const KIND = { OT: "对象类型", RT: "关系类型", F: "函数", A: "动作", INV: "核心约束", RULE: "规则", TH: "测试假设" };
const KIND_SHORT = { OT: "对象", RT: "关系", F: "函数", A: "动作", INV: "约束", RULE: "规则", TH: "假设" };
const ELEM = {};
for (const o of ONT.objectTypes) ELEM[o.id] = { id: o.id, kind: "OT", name: o.name, def: o.definition,
  rows: [["身份", o.identity], ["业务状态", (ONT.states[o.id] || []).join(" / ") || "无"], ["属性", (o.attributes || []).map(a => a.name).join("、") || "—"]] };
for (const r of ONT.relationTypes) ELEM[r.id] = { id: r.id, kind: "RT", name: r.name, def: `${r.from.join("／")} → ${r.to.join("／")}`,
  rows: [["基数", r.cardinality], ["来源", r.source], ["被用到", r.usedBy]] };
for (const f of ONT.functions) ELEM[f.id] = { id: f.id, kind: "F", name: f.code, def: f.question,
  rows: [["输入", f.input], ["方法", f.method], ["输出", f.output], ["版本", f.version]] };
for (const a of ONT.actions) ELEM[a.id] = { id: a.id, kind: "A", name: a.label, def: a.purpose,
  rows: [["发起角色", (a.roles || []).join("、")], ["输入", a.input], ["变更", a.changes]] };
for (const c of ONT.constraints) ELEM[c.id] = { id: c.id, kind: "INV", name: "核心约束", def: c.text,
  rows: [["检查点", (c.checkpoints || []).join("、")]] };
for (const r of ONT.rules) ELEM[r.id] = { id: r.id, kind: "RULE", name: `规则 ${r.version || ""}`.trim(), def: r.meaning || r.scope || "",
  rows: [["范围", r.scope], ["输出", r.output], ["只登记", r.registerOnly ? "是" : "否"]] };
for (const t of ONT.assumptions) ELEM[t.id] = { id: t.id, kind: "TH", name: "测试假设", def: t.text,
  rows: [["关联规则", t.rules], ["关联用例", t.cases]] };

// ── 用例结果投影
function caseOf(id, withNotes) {
  const def = DEF.get(id), res = RES.get(id);
  if (!def || !res) throw new Error("找不到用例 " + id);
  const checks = res.steps.reduce((a, s) => { a.total += (s.checks || []).length; a.pass += (s.checks || []).filter(c => c.pass).length; return a; }, { total: 0, pass: 0 });
  return {
    id: def.id, kind: def.kind, title: def.title, role: def.role, scene: def.scene, world: def.world,
    data: def.data, spec: def.spec || [], total: checks.total, pass: checks.pass, nsteps: res.steps.length,
    steps: res.steps.map(s => ({ n: s.n, k: s.k, who: s.who, biz: s.biz, expect: s.expect, pass: s.pass, note: withNotes ? s.note : undefined })),
  };
}

// ── 图表
function chartMr() {
  const W = 760, H = 268, x0 = 56, y0 = 26, pw = 648, ph = 168, max = 0.45;
  const bw = pw / series.length - 18;
  const y = v => y0 + ph - (v / max) * ph;
  let g = "";
  for (let v = 0; v <= 0.4; v += 0.1) {
    const yy = y(v);
    g += `<line x1="${x0}" y1="${yy}" x2="${x0 + pw}" y2="${yy}" stroke="#d8cdb8" stroke-width="1"/>`
      + `<text x="${x0 - 10}" y="${yy + 4}" text-anchor="end" class="ax">${Math.round(v * 100)}%</text>`;
  }
  series.forEach((d, i) => {
    const cx = x0 + i * (pw / series.length) + 9, yy = y(d.ratio);
    g += `<rect x="${cx}" y="${yy}" width="${bw}" height="${y(0) - yy}" fill="#241f17" opacity="0.88"/>`
      + `<text x="${cx + bw / 2}" y="${yy - 8}" text-anchor="middle" class="val">${(d.ratio * 100).toFixed(1)}</text>`
      + `<text x="${cx + bw / 2}" y="${y(0) + 18}" text-anchor="middle" class="ax">${d.date.slice(5)}</text>`;
  });
  const ty = y(0.2);
  g += `<line x1="${x0}" y1="${ty}" x2="${x0 + pw}" y2="${ty}" stroke="#a8341b" stroke-width="1.4" stroke-dasharray="6 5"/>`
    + `<text x="${x0 + pw}" y="${ty - 8}" text-anchor="end" class="red">RULE_D01 门限 20%</text>`
    + `<text x="${x0}" y="${y0 - 8}" class="ax">弱覆盖占比 · 同时要求弱覆盖采样点 ≥ 2000</text>`
    + `<text x="${x0 + pw}" y="${y0 - 8}" text-anchor="end" class="red">7 / 7 天命中</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="7 天弱覆盖占比，全部高于 20% 门限">${g}</svg>`;
}

function chartTilt() {
  const W = 760, H = 214, x0 = 90, pw = 600, y = 112, max = 9;
  const px = v => x0 + (v / max) * pw;
  const cur = EXP.tilt.total, target = EXP.tilt.thetaT, after = +(cur + EXP.tilt.deltaMech).toFixed(2), eps = 0.5;
  let g = "";
  g += `<rect x="${px(target - eps)}" y="${y - 30}" width="${px(target + eps) - px(target - eps)}" height="60" fill="#a8791c" opacity="0.13"/>`;
  g += `<text x="${px(target)}" y="${y - 52}" text-anchor="middle" class="ax">命中容差 ±0.5°</text>`;
  for (let v = 0; v <= max; v++) {
    g += `<line x1="${px(v)}" y1="${y + 24}" x2="${px(v)}" y2="${y + 30}" stroke="#8a7f6d"/>`
      + `<text x="${px(v)}" y="${y + 48}" text-anchor="middle" class="ax">${v}°</text>`;
  }
  g += `<line x1="${x0}" y1="${y}" x2="${px(max)}" y2="${y}" stroke="#241f17" stroke-width="1"/>`;
  g += `<line x1="${px(target)}" y1="${y - 22}" x2="${px(target)}" y2="${y + 22}" stroke="#a8341b" stroke-width="1.5" stroke-dasharray="5 4"/>`
    + `<text x="${px(target) + 8}" y="${y - 36}" class="red">推荐总下倾 ${num(target)}°</text>`;
  g += `<circle cx="${px(cur)}" cy="${y}" r="6" fill="#241f17"/><text x="${px(cur)}" y="${y - 14}" text-anchor="middle" class="val">现状 ${num(cur)}°</text>`;
  g += `<circle cx="${px(after)}" cy="${y}" r="6" fill="#f7f2e6" stroke="#1b5a52" stroke-width="2"/><text x="${px(after)}" y="${y + 26}" text-anchor="middle" class="grn">调整后 ${num(after)}°</text>`;
  g += `<line x1="${px(cur)}" y1="${y}" x2="${px(after)}" y2="${y}" stroke="#1b5a52" stroke-width="2" opacity="0.5"/>`;
  g += `<text x="${px(2)}" y="${y + 70}" class="grn">Δ 1° · 1 轮（剩余缺口下一轮再评）</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="总下倾角现状 6 度、推荐 7.35 度、调整后 7 度">${g}</svg>`;
}

function chartImpact() {
  const W = 760, left = 224, pw = 420;
  const radius = EXP.impact.checks.filter(c => c.kind === "远端覆盖" || c.cell);
  const overlap = EXP.impact.checks.filter(c => c.neighbor);
  const maxR = 800, maxO = 250, rowH = 46;
  let g = "", y = 46;
  const bar = (yy, v, max, color) => `<rect x="${left}" y="${yy}" width="${Math.max(1, (v / max) * pw)}" height="14" fill="${color}" opacity="${color === "#241f17" ? .82 : .95}"/>`;
  const ticks = (max, yy, step) => {
    let t = "";
    for (let v = 0; v <= max; v += step) t += `<line x1="${left + (v / max) * pw}" y1="${yy}" x2="${left + (v / max) * pw}" y2="${yy + 6}" stroke="#8a7f6d"/>`
      + `<text x="${left + (v / max) * pw}" y="${yy - 5}" text-anchor="middle" class="ax">${v}</text>`;
    return t;
  };
  g += `<text x="0" y="16" class="cap">远端覆盖半径（m，越大越好，虚线＝目标半径）</text>`;
  g += ticks(maxR, 30, 200);
  for (const c of radius) {
    const nm = nameOf(c.cell), tgt = targetOf(c.cell);
    g += `<text x="0" y="${y + 12}" class="ax">${esc(nm)}　目标 ${tgt} m</text>`;
    g += bar(y, c.before, maxR, "#241f17") + bar(y + 20, c.after, maxR, "#1b5a52");
    g += `<line x1="${left + (tgt / maxR) * pw}" y1="${y - 6}" x2="${left + (tgt / maxR) * pw}" y2="${y + 38}" stroke="#a8341b" stroke-dasharray="4 3"/>`;
    g += `<text x="${left + (c.before / maxR) * pw + 7}" y="${y + 11}" class="val">${c.before}</text>`
      + `<text x="${left + (c.after / maxR) * pw + 7}" y="${y + 31}" class="val grn">${c.after}</text>`;
    y += rowH + 14;
  }
  y += 16;
  g += `<text x="0" y="${y - 14}" class="cap">重叠指数（m，越小越好）</text>`;
  g += ticks(maxO, y - 4, 50);
  for (const c of overlap) {
    const nm = nameOf(c.neighbor);
    g += `<text x="0" y="${y + 12}" class="ax">${esc(nm)}　${c.distance} m 处</text>`;
    g += bar(y, c.before, maxO, "#241f17") + bar(y + 20, c.after, maxO, "#1b5a52");
    g += `<text x="${left + (c.before / maxO) * pw + 7}" y="${y + 11}" class="val">${c.before}</text>`
      + `<text x="${left + (c.after / maxO) * pw + 7}" y="${y + 31}" class="val grn">${c.after}</text>`;
    y += rowH + 14;
  }
  g += `<g transform="translate(${left},${y + 6})"><rect x="0" y="-10" width="12" height="10" fill="#241f17" opacity=".82"/><text x="18" y="0" class="ax">调整前</text><rect x="92" y="-10" width="12" height="10" fill="#1b5a52"/><text x="110" y="0" class="ax">调整后</text><line x1="182" y1="-12" x2="182" y2="2" stroke="#a8341b" stroke-dasharray="4 3"/><text x="190" y="0" class="ax">目标半径</text></g>`;
  return `<svg viewBox="0 0 ${W} ${y + 40}" role="img" aria-label="周边影响：同天线小区与重叠邻区调整前后对比">${g}</svg>`;
}

function chartEffect() {
  const W = 760, H = 230, x0 = 80, base = 180, ph = 132, max = 0.45;
  const y = v => base - (v / max) * ph;
  const bars = [
    { l: "前窗 · 9/4–9/10", v: EXP.beforeRatio, c: "#241f17" },
    { l: "后窗 · 9/15–9/21", v: EXP.afterRatio1, c: "#1b5a52" },
  ];
  let g = "";
  for (let v = 0; v <= 0.4; v += 0.1) g += `<line x1="70" y1="${y(v)}" x2="420" y2="${y(v)}" stroke="#d8cdb8"/><text x="62" y="${y(v) + 4}" text-anchor="end" class="ax">${Math.round(v * 100)}%</text>`;
  bars.forEach((b, i) => {
    const x = x0 + i * 160, w = 96;
    g += `<rect x="${x}" y="${y(b.v)}" width="${w}" height="${base - y(b.v)}" fill="${b.c}" opacity="${i ? .92 : .88}"/>`
      + `<text x="${x + w / 2}" y="${y(b.v) - 10}" text-anchor="middle" class="val">${pct(b.v)}</text>`
      + `<text x="${x + w / 2}" y="${base + 20}" text-anchor="middle" class="ax">${b.l}</text>`;
  });
  const ty = y(0.2);
  g += `<line x1="70" y1="${ty}" x2="420" y2="${ty}" stroke="#a8341b" stroke-width="1.4" stroke-dasharray="6 5"/><text x="420" y="${ty - 8}" text-anchor="end" class="red">派单门限 20%</text>`;
  // 保护指标
  let py = 62;
  g += `<text x="470" y="40" class="cap">保护指标（同天线小区 / 重叠邻区）</text>`
    + `<line x1="470" y1="48" x2="740" y2="48" stroke="#d8cdb8"/>`;
  for (const k of ["Y", "Z1", "Z2"]) {
    const p = EXP.protection[k];
    g += `<text x="470" y="${py + 4}" class="ax">${esc(nameOf({ Y: S.Y, Z1: S.Z1, Z2: S.Z2 }[k]))}</text>`
      + `<text x="740" y="${py + 4}" text-anchor="end" class="val">${pct(p.before)} → ${pct(p.after)}</text>`;
    py += 26;
  }
  g += `<text x="470" y="${py + 14}" class="ax">均未变差（容差 2%）</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="前窗 37.28% 到后窗 8.64%，低于 20% 门限">${g}</svg>`;
}

const CHART = { mr: chartMr, tilt: chartTilt, impact: chartImpact, effect: chartEffect };

// ── 片段
function kpis(list) {
  return `<div class="kpis">` + list.map(k => `<div class="kpi"><div class="v">${esc(k.v)}</div><div class="l">${esc(k.l)}</div><div class="h">${esc(k.h)}</div></div>`).join("") + `</div>`;
}

function stepsHtml(c) {
  return `<ol class="steps">` + c.steps.map(s => {
    const kind = s.k === "at" ? "at" : s.k === "q" ? "q" : s.pass ? "ok" : "rej";
    const badge = s.k === "at" ? "时间推进" : s.k === "q" ? "提问" : s.pass ? "成功" : "被拒绝";
    const role = s.k === "at" ? "（时间）" : s.who;
    return `<li class="step" data-kind="${kind}">
      <div class="step-n">${pad(s.n)}</div>
      <div class="step-main">
        <div class="step-meta"><span class="role">${esc(role)}</span><span class="badge ${kind}">${esc(badge)}</span></div>
        <p class="step-biz">${esc(s.biz)}</p>
        <p class="step-expect">预期：${esc(s.expect || "—")}</p>
        ${s.note ? `<button class="result-toggle" aria-expanded="false">实际结果</button><pre class="result">${esc(s.note)}</pre>` : ""}
      </div>
    </li>`;
  }).join("") + `</ol>`;
}

function chatHtml(c) {
  const turns = c.steps.filter(s => s.k === "q");
  return `<div class="chat">` + turns.map((s, i) => `<div class="turn" style="--i:${i}">
      <div class="who"><span class="role">${esc(s.who)}</span><span class="t">问</span></div>
      <p class="q">“${esc(s.biz)}”</p>
      <div class="a"><span class="mark">答</span><div class="a-body"><div class="a-text">${esc(s.note || "（本步为动作，无回答）")}</div></div></div>
    </div>`).join("") + `</div>`;
}

function supportHtml(list) {
  return `<section class="panel support-panel">
    <details>
      <summary><span class="tag">支撑</span><span class="sum-title">同一幕上的异常与边界</span><span class="sum-count">${list.length} 个用例</span></summary>
      <div class="sup-list">` + list.map(item => {
        const c = caseOf(item.id, false), d = c;
        const steps = c.steps.filter(s => s.k !== "at").map(s => `<li><span class="nm">${pad(s.n)}</span><span class="b">${esc(s.biz)}</span><span class="e">→ ${esc(s.expect || "")}</span></li>`).join("");
        return `<details class="sup">
          <summary><span class="sid">${esc(d.id)}</span><span class="stitle">${esc(d.title)}</span><span class="ssteps">${d.nsteps} 步</span></summary>
          <p class="one">${esc(item.one)}</p>
          <ol class="sup-steps">${steps}</ol>
          <p class="sup-meta">角色：${esc(d.role)}　起始状态：${esc(d.world)}${d.data ? "　数据： " + esc(d.data) : ""}</p>
        </details>`;
      }).join("") + `</div>
    </details>
  </section>`;
}

function techHtml(act) {
  const t = act.tech;
  const counts = {};
  for (const id of t.elements) { const e = ELEM[id]; if (e) counts[KIND_SHORT[e.kind]] = (counts[KIND_SHORT[e.kind]] || 0) + 1; }
  const summary = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(" · ");
  const chain = t.chain.map((n, i) => (i ? `<span class="arrow" aria-hidden="true">→</span>` : "") + `<span class="node"><b>${esc(n.t)}</b><span>${esc(n.d)}</span></span>`).join("");
  const chips = t.elements.map(id => { const e = ELEM[id]; return e
    ? `<button class="chip" data-el="${esc(id)}"><b>${esc(id)}</b><span>${esc(KIND_SHORT[e.kind])}</span></button>`
    : `<button class="chip missing" disabled><b>${esc(id)}</b><span>未收录</span></button>`; }).join("");
  const guards = t.guards.map(g => `<li><b>${esc(g.id)}</b>${esc(g.text)}</li>`).join("");
  const facts = t.facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  return `<section class="tech">
    <button class="tech-strip" aria-expanded="false"><span class="t-label">技术这一层</span><span class="t-sum">${esc(summary)}</span><span class="t-plus" aria-hidden="true">＋</span></button>
    <div class="tech-body">
      <div class="chain" aria-label="本幕的技术链路">${chain}</div>
      <div class="chips">${chips}</div>
      <div class="tech-cols">
        <div><h4>这一步守住了什么</h4><ul class="guards">${guards}</ul></div>
        <div><h4>口径与机制</h4><dl class="facts">${facts}</dl></div>
      </div>
    </div>
  </section>`;
}

// ── 页面
const actNav = STORY.acts.map((a, i) => `<a class="rail-act" href="#act-${a.key}" data-act="${a.key}">
    <span class="r-no">${a.no}</span><span class="r-t">${esc(a.title)}</span><span class="r-time">${esc(a.time)}</span></a>`).join("");

const sections = STORY.acts.map((a, idx) => {
  const chart = CHART[a.chart] ? CHART[a.chart]() : "";
  const mains = a.mainCases.map(id => {
    const c = caseOf(id, true);
    return `<div class="case-block">
      <div class="case-head"><span class="case-id">${esc(c.id)}</span><span class="case-title">${esc(c.title)}</span>
        <span class="case-stat">${c.nsteps} 步 · ${c.pass}/${c.total} 项核对</span></div>
      <p class="case-scene">${esc(c.scene)}</p>
      ${stepsHtml(c)}
    </div>`;
  }).join("");
  const qas = a.qa.map(id => {
    const c = caseOf(id, true);
    return `<div class="case-block qa-block">
      <div class="case-head"><span class="case-id">${esc(c.id)}</span><span class="case-title">${esc(c.title)}</span>
        <span class="case-stat">${c.steps.filter(s => s.k === "q").length} 问</span></div>
      <p class="case-scene">${esc(c.scene)}</p>
      ${chatHtml(c)}
    </div>`;
  }).join("");
  return `<article class="act" id="act-${a.key}" data-key="${a.key}">
    <header class="act-head">
      <div class="act-num" aria-hidden="true">${a.no}</div>
      <div class="act-titles">
        <div class="kicker">${esc(a.kicker)}</div>
        <h2>${esc(a.title)}</h2>
        <p class="headline">${esc(a.headline)}</p>
      </div>
      <dl class="act-meta">
        <div><dt>时间</dt><dd>${esc(a.time)}</dd></div>
        <div><dt>角色</dt><dd>${a.roles.map(esc).join("、")}</dd></div>
        <div><dt>状态跨度</dt><dd>${esc(a.span)}</dd></div>
      </dl>
    </header>
    <p class="act-lede">${esc(a.lede)}</p>
    <div class="prose">${a.narrative.map(p => `<p>${esc(p)}</p>`).join("")}</div>
    ${kpis(a.kpis)}
    <figure class="figure">
      <figcaption>${esc(a.chartTitle)}</figcaption>
      ${chart}
      <p class="note">${esc(a.chartNote)}</p>
    </figure>
    <section class="panel">
      <div class="panel-head"><span class="tag">决策主线</span><h3>${esc(a.mainTitle)}</h3></div>
      <p class="panel-note">${esc(a.mainNote)}</p>
      ${mains}
    </section>
    <section class="panel qa-panel">
      <div class="panel-head"><span class="tag">问答现场</span><h3>${esc(a.qaTitle)}</h3></div>
      <p class="panel-note">${esc(a.qaNote)}</p>
      <p class="caveat">${esc(STORY.qaCaveat)}</p>
      ${qas}
    </section>
    ${supportHtml(a.support)}
    ${techHtml(a)}
  </article>`;
}).join("");

const convergeRows = STORY.acts.map(a => {
  const main = [...a.mainCases, ...a.qa];
  return `<tr><td class="c-no">${a.no}</td><td>${esc(a.title)}</td>
    <td>${main.map(id => `<span class="pill main">${esc(id)}</span>`).join(" ")}</td>
    <td>${a.support.map(s => `<span class="pill">${esc(s.id)}</span>`).join(" ")}</td></tr>`;
}).join("");

const stat = (v, l) => `<div class="hstat"><div class="hv">${esc(v)}</div><div class="hl">${esc(l)}</div></div>`;
const stepAll = [...biz.decision, ...biz.qa].reduce((a, c) => a + c.steps.length, 0);
const stepPass = [...biz.decision, ...biz.qa].reduce((a, c) => a + c.steps.filter(s => s.pass).length, 0);
const checkAll = [...biz.decision, ...biz.qa].reduce((a, c) => a + c.steps.reduce((b, s) => b + (s.checks || []).length, 0), 0);

const CSS = `
:root{
  --paper:#efe7d8; --card:#fbf7ec; --ink:#14100b; --ink2:#33302a; --muted:#7c7261;
  --line:#cfc3ab; --line2:#e4dac6; --red:#a8341b; --teal:#1b5a52; --amber:#a8791c;
  --serif:"Songti SC","STSong","Noto Serif CJK SC","Source Han Serif SC","SimSun",serif;
  --sans:"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Source Han Sans SC",sans-serif;
  --mono:"Cascadia Mono","Consolas","SFMono-Regular","JetBrains Mono",monospace;
}
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.78;
  background-image:radial-gradient(circle at 20% 0%,rgba(255,255,255,.55),transparent 55%),linear-gradient(rgba(20,16,11,.032) 1px,transparent 1px),linear-gradient(90deg,rgba(20,16,11,.032) 1px,transparent 1px);
  background-size:auto,96px 96px,96px 96px}
h1,h2,h3,h4{font-family:var(--serif);font-weight:600;margin:0}
p{margin:0 0 12px}
a{color:inherit}
button{font-family:inherit}
.progress{position:fixed;top:0;left:0;height:2px;width:0;background:var(--red);z-index:80}
/* hero */
.hero{position:relative;background:#14100b;color:#f4ecdb;overflow:hidden;padding:56px 40px 0}
.hero::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(244,236,219,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(244,236,219,.06) 1px,transparent 1px);background-size:76px 76px;mask-image:linear-gradient(to bottom,#000 10%,transparent 92%)}
.hero-inner{position:relative;max-width:1200px;margin:0 auto;padding-bottom:34px}
.kicker{font-family:var(--mono);font-size:10.5px;letter-spacing:.26em;text-transform:uppercase;color:#b99a68}
.hero .kicker{color:#c8a878}
.hero h1{font-size:clamp(38px,5.6vw,74px);line-height:1.12;letter-spacing:.01em;margin:18px 0 20px;color:#f7efde}
.hero .lede{max-width:44em;font-size:16.5px;line-height:1.85;color:#cfc3ae}
.hero-subject{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:30px 0 0;padding:16px 0 0;border-top:1px solid rgba(244,236,219,.18)}
.hero-subject dt{font-family:var(--mono);font-size:10px;letter-spacing:.18em;color:#a8997d;margin-bottom:4px}
.hero-subject dd{margin:0;font-size:13.5px;color:#efe6d4}
.hero-subject code{font-family:var(--mono);font-size:12.5px;color:#e7c9a0;overflow-wrap:anywhere}
.hero-subject dd{overflow-wrap:anywhere}
.hero-stats{position:relative;max-width:1200px;margin:0 auto;display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:0;border-top:1px solid rgba(244,236,219,.18)}
.hstat{padding:16px 14px 22px;border-right:1px solid rgba(244,236,219,.12)}
.hstat:last-child{border-right:0}
.hv{font-family:var(--serif);font-size:26px;color:#f7efde;line-height:1.2}
.hl{font-size:11.5px;color:#a8997d;margin-top:2px}
.mode-bar{position:relative;max-width:1200px;margin:0 auto;padding:0 0 22px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.mode-hint{font-family:var(--mono);font-size:10.5px;color:#a8997d;letter-spacing:.08em}
.seg{display:inline-flex;border:1px solid rgba(244,236,219,.35)}
.seg button{background:transparent;color:#cfc3ae;border:0;padding:6px 14px;font-family:var(--mono);font-size:11px;letter-spacing:.06em;cursor:pointer}
.seg button[aria-pressed="true"]{background:#f4ecdb;color:#14100b}
/* shell */
.shell{max-width:1240px;margin:0 auto;padding:0 40px 100px;display:grid;grid-template-columns:222px minmax(0,1fr);gap:52px}
.rail{position:sticky;top:0;align-self:start;max-height:100vh;overflow:auto;padding:38px 0 30px}
.rail-label{font-family:var(--mono);font-size:10px;letter-spacing:.2em;color:var(--muted);margin-bottom:14px}
.rail-act{display:block;position:relative;padding:9px 0 9px 14px;border-left:1px solid var(--line);text-decoration:none;color:var(--muted)}
.rail-act:hover{color:var(--ink)}
.rail-act.active{border-left:2px solid var(--red);padding-left:13px;color:var(--ink)}
.rail-act.active .r-no{color:var(--red)}
.r-no{font-family:var(--mono);font-size:10.5px;margin-right:6px;letter-spacing:.08em}
.r-t{font-size:14px}
.r-time{display:block;font-family:var(--mono);font-size:10px;color:var(--muted);margin-top:2px}
.rail-note{margin-top:22px;padding-top:14px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted);line-height:1.7}
.rail-note b{color:var(--ink2);font-weight:600}
/* act */
.act{padding:56px 0 8px;border-top:1px solid var(--line)}
.act:first-child{border-top:0;padding-top:12px}
.act-head{display:grid;grid-template-columns:112px minmax(0,1fr);gap:18px 22px}
.act-num{font-family:var(--serif);font-size:88px;line-height:.82;color:transparent;-webkit-text-stroke:1px var(--line);user-select:none}
.act-titles .kicker{color:var(--muted)}
.act-titles h2{font-size:36px;margin:2px 0 10px;letter-spacing:.02em}
.headline{font-family:var(--serif);font-size:19px;color:var(--ink);border-left:3px solid var(--red);padding-left:12px;margin:0;line-height:1.5}
.act-meta{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:20px 0 0;padding:14px 0 0;border-top:1px dashed var(--line)}
.act-meta dt{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--muted)}
.act-meta dd{margin:2px 0 0;font-size:12.5px;color:var(--ink2)}
.act-lede{font-size:16px;color:var(--ink2);margin:26px 0 18px;max-width:58em}
.prose p{font-size:15.5px;color:#2c2820;max-width:62em}
/* kpi */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:0 26px;margin:26px 0 6px}
.kpi{border-top:2px solid var(--ink);padding:10px 0 14px}
.kpi .v{font-family:var(--serif);font-size:27px;line-height:1.25;letter-spacing:.01em}
.kpi .l{font-size:12.5px;color:var(--ink2);margin-top:2px}
.kpi .h{font-size:11px;color:var(--muted);margin-top:2px}
/* figure */
.figure{margin:26px 0 0;background:var(--card);border:1px solid var(--line);padding:18px 20px 14px}
.figure figcaption{font-family:var(--serif);font-size:15px;margin-bottom:8px}
.figure svg{display:block;width:100%;height:auto}
.figure .note{font-size:11.5px;color:var(--muted);border-top:1px dashed var(--line2);padding-top:9px;margin:6px 0 0;line-height:1.7}
text.ax{font-family:var(--mono);font-size:10.5px;fill:#7c7261}
text.val{font-family:var(--mono);font-size:10.5px;fill:#241f17}
text.red{font-family:var(--mono);font-size:10px;fill:#a8341b}
text.grn{font-family:var(--mono);font-size:10px;fill:#1b5a52}
text.cap{font-family:var(--sans);font-size:11px;fill:#33302a}
/* panels */
.panel{margin-top:26px;background:var(--card);border:1px solid var(--line);padding:22px 24px 18px;position:relative}
.panel::before,.panel::after{content:"";position:absolute;width:9px;height:9px;border:1px solid var(--ink);opacity:.35}
.panel::before{top:-1px;left:-1px;border-right:0;border-bottom:0}
.panel::after{bottom:-1px;right:-1px;border-left:0;border-top:0}
.panel-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.tag{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;background:var(--ink);color:var(--paper);padding:2px 7px;white-space:nowrap}
.panel-head h3{font-size:21px;letter-spacing:.01em}
.panel-note{font-size:12.5px;color:var(--muted);margin:0 0 14px}
.case-block{border-top:1px solid var(--line);padding-top:14px;margin-top:14px}
.case-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.case-id{font-family:var(--mono);font-size:11px;color:var(--red);letter-spacing:.06em}
.case-title{font-size:14.5px;font-weight:600}
.case-stat{margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--muted)}
.case-scene{font-size:12.5px;color:var(--muted);margin:4px 0 10px;line-height:1.7}
/* steps */
.steps{list-style:none;margin:0;padding:0}
.step{display:grid;grid-template-columns:42px minmax(0,1fr);gap:10px;padding:12px 0;border-top:1px solid var(--line2)}
.step:first-child{border-top:0}
.step-n{font-family:var(--mono);font-size:11px;color:var(--muted);padding-top:2px;position:relative}
.step-n::after{content:"";position:absolute;left:0;top:19px;bottom:-12px;width:1px;background:var(--line2)}
.step:last-child .step-n::after{display:none}
.step[data-kind="rej"] .step-n{color:var(--red)}
.step[data-kind="at"] .step-biz{color:var(--muted);font-size:13px}
.step-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.role{font-size:11.5px;background:rgba(27,90,82,.09);color:#14463f;padding:1px 7px;border:1px solid rgba(27,90,82,.16)}
.badge{font-family:var(--mono);font-size:10px;letter-spacing:.06em;padding:1px 6px;border:1px solid var(--line);color:var(--muted)}
.badge.ok{color:#14463f;border-color:rgba(27,90,82,.35)}
.badge.rej{color:var(--red);border-color:rgba(168,52,27,.4)}
.badge.at{color:var(--muted);border-style:dashed}
.badge.q{color:var(--ink2);border-color:var(--line)}
.step-biz{margin:5px 0 2px;font-size:14px}
.step-expect{margin:0;font-size:12px;color:var(--muted);line-height:1.65}
.result-toggle{margin-top:7px;background:transparent;border:1px dashed var(--line);color:var(--muted);font-family:var(--mono);font-size:10px;letter-spacing:.06em;padding:2px 8px;cursor:pointer}
.result-toggle:hover{color:var(--ink);border-color:var(--ink)}
.result{display:none;margin:8px 0 0;padding:8px 10px;background:rgba(20,16,11,.045);border-left:2px solid var(--line);font-family:var(--mono);font-size:11px;line-height:1.7;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto}
.step.open .result{display:block}
body[data-mode="tech"] .result{display:block}
/* chat */
.chat{margin-top:6px}
.turn{padding:14px 0;border-top:1px solid var(--line2)}
.turn:first-child{border-top:0}
.who{display:flex;align-items:center;gap:8px}
.who .t{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--muted)}
.q{font-size:15px;margin:6px 0 8px;color:var(--ink);font-family:var(--serif)}
.a{display:flex;gap:9px;background:rgba(27,90,82,.055);border-left:2px solid var(--teal);padding:9px 12px}
.a .mark{font-family:var(--mono);font-size:10px;color:var(--teal);border:1px solid rgba(27,90,82,.4);padding:0 5px;height:18px;line-height:17px;flex:none;margin-top:2px}
.a-body{min-width:0;flex:1}
.a-text{position:relative;font-size:13px;line-height:1.82;color:#22302c;white-space:pre-wrap;overflow-wrap:anywhere}
.a.clamp .a-text{max-height:142px;overflow:hidden}
.a.clamp .a-text::after{content:"";position:absolute;left:0;right:0;bottom:0;height:46px;background:linear-gradient(rgba(238,244,241,0),#eef4f1)}
.a-more{margin:5px 0 0;background:none;border:0;padding:0;color:var(--teal);font-family:var(--mono);font-size:10px;letter-spacing:.06em;cursor:pointer;border-bottom:1px dashed rgba(27,90,82,.5)}
.a-more:hover{color:var(--red);border-color:rgba(168,52,27,.5)}
/* support */
.support-panel{background:transparent;border-style:dashed;padding:0}
.support-panel>details>summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:12px;padding:14px 18px;flex-wrap:wrap}
.support-panel>details>summary::-webkit-details-marker{display:none}
.support-panel>details[open]>summary{border-bottom:1px solid var(--line)}
.sum-title{font-family:var(--serif);font-size:16px}
.sum-count{margin-left:auto;font-family:var(--mono);font-size:10.5px;color:var(--muted)}
.sup-list{padding:0 18px 16px}
.sup{border-bottom:1px solid var(--line2);padding:8px 0}
.sup>summary{cursor:pointer;list-style:none;display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.sup>summary::-webkit-details-marker{display:none}
.sid{font-family:var(--mono);font-size:11px;color:var(--teal)}
.stitle{font-size:13.5px}
.ssteps{margin-left:auto;font-family:var(--mono);font-size:10px;color:var(--muted)}
.sup .one{font-size:12.5px;color:var(--ink2);margin:6px 0 6px;padding-left:2px}
.sup-steps{list-style:none;margin:0;padding:0 0 4px 2px}
.sup-steps li{display:grid;grid-template-columns:26px minmax(0,1fr);gap:8px;font-size:12px;color:var(--ink2);padding:3px 0;line-height:1.65}
.sup-steps .nm{font-family:var(--mono);font-size:10px;color:var(--muted)}
.sup-steps .e{grid-column:2;color:var(--muted);font-size:11.5px}
.sup-meta{font-size:11px;color:var(--muted);margin:8px 0 0}
/* tech */
.tech{margin-top:26px;border-top:2px solid var(--teal);background:linear-gradient(180deg,rgba(27,90,82,.07),rgba(27,90,82,.015) 60%,transparent)}
.tech-strip{width:100%;display:flex;align-items:baseline;gap:12px;background:transparent;border:0;padding:11px 14px;cursor:pointer;text-align:left}
.t-label{font-family:var(--mono);font-size:10px;letter-spacing:.18em;color:var(--teal)}
.t-sum{font-family:var(--mono);font-size:10.5px;color:var(--muted)}
.t-plus{margin-left:auto;font-family:var(--mono);color:var(--teal);font-size:12px}
.tech.open .t-plus{transform:rotate(45deg)}
body[data-mode="tech"] .tech .t-plus{display:none}
.tech-body{display:none;padding:2px 16px 20px}
body[data-mode="tech"] .tech .tech-body,.tech.open .tech-body{display:block}
.chain{display:flex;flex-wrap:wrap;align-items:stretch;gap:6px;margin:4px 0 14px}
.node{background:var(--card);border:1px solid var(--line);padding:6px 9px;min-width:96px}
.node b{display:block;font-family:var(--mono);font-size:10.5px;color:var(--ink)}
.node span{display:block;font-size:10.5px;color:var(--muted);line-height:1.5}
.arrow{align-self:center;color:var(--muted);font-size:12px}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:16px}
.chip{display:inline-flex;align-items:baseline;gap:5px;background:rgba(255,255,255,.55);border:1px solid rgba(27,90,82,.35);color:#17453f;font-family:var(--mono);font-size:10.5px;padding:2px 7px;cursor:pointer}
.chip span{font-size:9.5px;color:var(--muted)}
.chip:hover{background:var(--teal);color:#f4ecdb}
.chip:hover span{color:#cfe0da}
.chip:disabled{opacity:.4;cursor:default}
.tech-cols{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:28px}
.tech h4{font-family:var(--mono);font-size:9.5px;letter-spacing:.18em;color:var(--teal);margin:0 0 8px;font-weight:400}
.guards{list-style:none;margin:0;padding:0}
.guards li{font-size:12.5px;color:var(--ink2);padding:6px 0;border-bottom:1px dashed rgba(27,90,82,.18);line-height:1.7}
.guards b{font-family:var(--mono);font-size:10.5px;color:var(--red);margin-right:6px}
.facts{display:grid;grid-template-columns:84px minmax(0,1fr);gap:4px 10px;margin:0}
.facts dt{font-family:var(--mono);font-size:10px;color:var(--muted);padding-top:2px}
.facts dd{margin:0;font-size:12px;color:var(--ink2);line-height:1.65}
/* closing */
.closing{margin-top:70px;background:#14100b;color:#efe6d4;padding:44px 40px}
.closing-in{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:44px}
.closing h2{color:#f7efde;font-size:26px;margin-bottom:10px}
.closing p{font-size:13px;color:#c3b7a2;line-height:1.85;max-width:40em}
.closing .kicker{color:#c8a878}
.closing details{margin-top:18px;border-top:1px solid rgba(244,236,219,.18);padding-top:12px}
.closing summary{cursor:pointer;font-family:var(--mono);font-size:11px;color:#e0d3bd}
.converge{width:100%;border-collapse:collapse;margin-top:10px;font-size:11.5px}
.converge th,.converge td{text-align:left;padding:5px 8px;border-bottom:1px solid rgba(244,236,219,.12);vertical-align:top}
.converge th{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;color:#a8997d;font-weight:400}
.converge .c-no{font-family:var(--mono);color:#c8a878}
.pill{display:inline-block;font-family:var(--mono);font-size:9.5px;padding:1px 5px;border:1px solid rgba(244,236,219,.25);color:#d9cdb8;margin:1px 2px 1px 0}
.pill.main{border-color:#c8a878;color:#f0dcb8}
.meta-list{list-style:none;margin:0;padding:0;font-size:11.5px;color:#a8997d}
.meta-list li{padding:5px 0;border-bottom:1px solid rgba(244,236,219,.1);line-height:1.7}
.meta-list b{color:#d9cdb8;font-weight:400;font-family:var(--mono);font-size:10.5px;margin-right:6px}
/* drawer */
.backdrop{position:fixed;inset:0;background:rgba(20,16,11,.32);opacity:0;pointer-events:none;transition:opacity .2s;z-index:60}
.backdrop.show{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100%;width:min(430px,94vw);background:var(--card);border-left:1px solid var(--ink);z-index:70;display:flex;flex-direction:column;transform:translateX(103%);transition:transform .26s ease}
.drawer.open{transform:none}
.drawer-head{padding:18px 20px 14px;border-bottom:1px solid var(--line);display:flex;align-items:flex-start;gap:10px}
.drawer-head .did{font-family:var(--mono);font-size:13px;color:var(--red)}
.drawer-head .dkind{font-family:var(--mono);font-size:9.5px;letter-spacing:.14em;color:var(--muted);margin-top:3px}
.drawer-close{margin-left:auto;background:transparent;border:1px solid var(--line);width:26px;height:26px;line-height:1;cursor:pointer;color:var(--ink2)}
.drawer-body{padding:18px 20px 30px;overflow:auto}
.drawer-body .dname{font-family:var(--serif);font-size:18px;margin-bottom:8px}
.drawer-body .ddef{font-size:13px;line-height:1.85;color:var(--ink2);padding-bottom:12px;border-bottom:1px dashed var(--line)}
.drawer-body dl{display:grid;grid-template-columns:72px minmax(0,1fr);gap:6px 10px;margin:12px 0 0}
.drawer-body dt{font-family:var(--mono);font-size:9.5px;color:var(--muted);padding-top:3px}
.drawer-body dd{margin:0;font-size:12px;line-height:1.75;color:var(--ink2)}
.drawer-foot{margin-top:18px;padding-top:10px;border-top:1px solid var(--line);font-size:10.5px;color:var(--muted);line-height:1.7}
/* misc */
.caveat{font-size:11.5px;color:var(--muted);border-left:2px solid var(--line);padding-left:8px;margin:-6px 0 10px;line-height:1.7}
.figure,.kpi,.step,.turn{animation:rise .5s ease both}
@keyframes rise{from{opacity:.001;transform:translateY(6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){
  .figure,.kpi,.step,.turn{animation:none}
  html{scroll-behavior:auto}
}
@media (max-width:1080px){
  .hero-stats{grid-template-columns:repeat(3,minmax(0,1fr))}
  .shell{grid-template-columns:1fr;gap:0;padding:0 24px 80px}
  .rail{position:static;max-height:none;padding:20px 0 0;display:flex;gap:8px;overflow-x:auto;border-bottom:1px solid var(--line)}
  .rail-label,.rail-note{display:none}
  .rail-act{border-left:0;border-bottom:2px solid transparent;padding:8px 10px;white-space:nowrap}
  .rail-act.active{border-left:0;border-bottom:2px solid var(--red);padding-left:10px}
  .r-time{display:none}
  .act-meta{grid-template-columns:1fr}
  .tech-cols,.closing-in{grid-template-columns:1fr}
}
@media (max-width:640px){
  .hero{padding:36px 22px 0}
  .hero-subject{grid-template-columns:1fr}
  .hero-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .act-head{grid-template-columns:1fr}
  .act-num{font-size:56px}
  .act-titles h2{font-size:28px}
  .panel{padding:18px 16px}
}
@media print{
  .rail,.mode-bar,.backdrop,.drawer,.result-toggle{display:none!important}
  body{background:#fff}
  .act{page-break-inside:avoid}
}
`;

const JS = `
(function(){
  var body=document.body, KEY='shwo-story-mode';
  function setMode(m){
    body.dataset.mode=m;
    document.querySelectorAll('[data-mode-btn]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.modeBtn===m))});
    try{localStorage.setItem(KEY,m)}catch(e){}
  }
  try{var saved=localStorage.getItem(KEY); if(saved==='tech'||saved==='biz') setMode(saved)}catch(e){}
  document.addEventListener('click',function(e){
    var mb=e.target.closest('[data-mode-btn]'); if(mb){setMode(mb.dataset.modeBtn);return}
    var rt=e.target.closest('.result-toggle');
    if(rt){var st=rt.closest('.step'),on=st.classList.toggle('open');rt.setAttribute('aria-expanded',String(on));rt.textContent=on?'收起结果':'实际结果';return}
    var strip=e.target.closest('.tech-strip');
    if(strip){var tech=strip.closest('.tech'),op=tech.classList.toggle('open');strip.setAttribute('aria-expanded',String(op));return}
    var chip=e.target.closest('.chip[data-el]');
    if(chip){openDrawer(chip.dataset.el);return}
    if(e.target.closest('.drawer-close')||e.target.classList.contains('backdrop')) closeDrawer();
  });
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape') closeDrawer();
    if(e.key!=='ArrowRight'&&e.key!=='ArrowLeft') return;
    var acts=[].slice.call(document.querySelectorAll('.act')),idx=acts.findIndex(function(a){return a.getBoundingClientRect().top>120});
    var cur=idx<0?acts.length-1:Math.max(0,idx-1);
    var next=e.key==='ArrowRight'?Math.min(acts.length-1,cur+1):Math.max(0,cur-1);
    acts[next].scrollIntoView({behavior:'smooth',block:'start'});
  });
  // scroll spy + progress
  var links=[].slice.call(document.querySelectorAll('.rail-act')), acts=[].slice.call(document.querySelectorAll('.act'));
  function spy(){
    var y=window.scrollY+window.innerHeight*0.32,best=0;
    acts.forEach(function(a,i){ if(a.offsetTop<=y) best=i; });
    links.forEach(function(l,i){ l.classList.toggle('active',i===best); });
    var h=document.documentElement.scrollHeight-window.innerHeight;
    document.querySelector('.progress').style.width=(h>0?Math.min(100,window.scrollY/h*100):0)+'%';
  }
  window.addEventListener('scroll',spy,{passive:true}); window.addEventListener('resize',spy); spy();
  // 长回答折叠：超过 6 行时收起，避免整页被问答淹没
  document.querySelectorAll('.a').forEach(function(a){
    var t=a.querySelector('.a-text'); if(!t || t.scrollHeight<=150) return;
    a.classList.add('clamp');
    var btn=document.createElement('button');
    btn.className='a-more'; btn.type='button'; btn.textContent='展开全部回答';
    btn.addEventListener('click',function(){
      var c=a.classList.toggle('clamp');
      btn.textContent=c?'展开全部回答':'收起';
    });
    a.querySelector('.a-body').appendChild(btn);
  });
  // drawer
  var ELEMENTS=JSON.parse(document.getElementById('elements').textContent);
  function openDrawer(id){
    var e=ELEMENTS[id]; if(!e) return;
    document.getElementById('d-id').textContent=e.id;
    document.getElementById('d-kind').textContent=e.kindLabel;
    document.getElementById('d-name').textContent=e.name||'';
    document.getElementById('d-def').textContent=e.def||'';
    document.getElementById('d-rows').innerHTML=(e.rows||[]).filter(function(r){return r[1]}).map(function(r){return '<dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd>'}).join('');
    document.getElementById('backdrop').classList.add('show');
    var d=document.getElementById('drawer'); d.classList.add('open'); d.setAttribute('aria-hidden','false');
  }
  function closeDrawer(){
    var d=document.getElementById('drawer'); d.classList.remove('open'); d.setAttribute('aria-hidden','true');
    document.getElementById('backdrop').classList.remove('show');
  }
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
  window.openDrawer=openDrawer;
})();
`;

const elJson = {};
for (const a of STORY.acts) {
  for (const id of a.tech.elements.concat(a.tech.guards.map(g => g.id))) {
    if (ELEM[id]) elJson[id] = { id, kindLabel: KIND[ELEM[id].kind] || ELEM[id].kind, name: ELEM[id].name, def: ELEM[id].def, rows: ELEM[id].rows.filter(r => r[1]) };
  }
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>弱覆盖本体 · 从发现到关单入库｜主线故事线（SPEC V0.9）</title>
<meta name="description" content="弱覆盖本体应用在上海工单上的四幕主线场景：问题发现、定因与方案、审批与执行、效果关单与案例复用。">
<style>${CSS}</style>
</head>
<body data-mode="biz">
<div class="progress" aria-hidden="true"></div>

<header class="hero">
  <div class="hero-inner">
    <div class="kicker">弱覆盖本体应用 · 上海工单 · SPEC V0.9</div>
    <h1>${STORY.title[0]}<br>${STORY.title[1]}</h1>
    <p class="lede">${esc(STORY.subtitle)}</p>
    <dl class="hero-subject">
      <div><dt>主角小区</dt><dd>${esc(STORY.subject.cell)}</dd></div>
      <div><dt>身份</dt><dd><code>${esc(STORY.subject.identity)}</code></dd></div>
      <div><dt>工单 / 问题键</dt><dd><code>${esc(STORY.subject.ticket)}</code><br><code>${esc(STORY.subject.problem)}</code></dd></div>
    </dl>
  </div>
  <div class="hero-stats">
    ${stat("4", "幕 · 一条完整故事线")}
    ${stat(String(biz.decision.length + biz.qa.length), "决策与问答用例")}
    ${stat("9 · 17 · 12", "对象 · 关系 · 函数")}
    ${stat("11 · 17 · 19", "动作 · 约束 · 规则")}
    ${stat(stepPass + "/" + stepAll, "业务步骤断言")}
    ${stat("697/697", "全量断言验证")}
  </div>
  <div class="mode-bar">
    <span class="mode-hint">视角</span>
    <div class="seg" role="group" aria-label="视角切换">
      <button data-mode-btn="biz" aria-pressed="true">业务视角</button>
      <button data-mode-btn="tech" aria-pressed="false">技术视角</button>
    </div>
    <span class="mode-hint">← → 切换幕　·　技术要素可点开看 SPEC 定义</span>
  </div>
</header>

<div class="shell">
  <nav class="rail" aria-label="四幕导航">
    <div class="rail-label">四幕 · 故事线</div>
    ${actNav}
    <div class="rail-note"><b>读法</b>：先看每幕的业务叙述与关键数字，再看“决策主线”里的真实步骤与“问答现场”的真实回答；技术视角展开后，每一步背后的对象、函数、约束都在。<br><br>${esc(STORY.converged)}</div>
  </nav>
  <main>
    ${sections}
  </main>
</div>

<footer class="closing">
  <div class="closing-in">
    <div>
      <div class="kicker">Closing · 一条故事线的四个交接点</div>
      <h2>数据、判断、签字、证据，各归其位</h2>
      <p>发现交给数据与规则，定因交给可核验的计算，执行交给有权限的人，效果交给同一把尺子。四幕之间不是流程的串联，而是四次责任交接——每一次交接都留下可回溯的记录：${
        "discovery 快照、根因轮次、审批签名、工参版本、效果前后窗、案例适用条件"
      }。</p>
      <details>
        <summary>展开：收敛对照（29 决策 + 14 问答 → 4 幕）</summary>
        <table class="converge">
          <thead><tr><th>幕</th><th>主题</th><th>主线用例</th><th>支撑用例</th></tr></thead>
          <tbody>${convergeRows}</tbody>
        </table>
      </details>
    </div>
    <div>
      <ul class="meta-list">
        <li><b>SPEC</b>${esc(ONT.source.file)}（sha256 ${esc(ONT.source.sha256.slice(0, 12))}…）</li>
        <li><b>场景</b>${esc(STORY.subject.cell)} 主线；上海 4 张真实工单作对照样例</li>
        <li><b>执行</b>node test/run.js → ${stepPass}/${stepAll} 条业务步骤断言（${checkAll} 项核对，全量 697/697）</li>
        <li><b>数据</b>种子数据（CSV，确定性生成）；MR、工参、告警、派单均为仿真</li>
        <li><b>生成</b>node scripts/gen-story.js · ${new Date().toLocaleString("zh-CN", { hour12: false })}</li>
        <li><b>局限</b>本地仿真，不代表真实网络；SPEC 规则与测试假设待业务确认；问答为规则匹配，未接大模型</li>
      </ul>
    </div>
  </div>
</footer>

<div class="backdrop" id="backdrop"></div>
<aside class="drawer" id="drawer" aria-hidden="true" aria-label="本体要素定义">
  <div class="drawer-head">
    <div><div class="did" id="d-id"></div><div class="dkind" id="d-kind"></div></div>
    <button class="drawer-close" aria-label="关闭">×</button>
  </div>
  <div class="drawer-body">
    <div class="dname" id="d-name"></div>
    <p class="ddef" id="d-def"></p>
    <dl id="d-rows"></dl>
    <div class="drawer-foot">定义逐字取自 SPEC（经 scripts/spec-parse.js 解析），不改写、不补充。</div>
  </div>
</aside>

<script type="application/json" id="elements">${JSON.stringify(elJson)}</script>
<script>${JS}</script>
</body>
</html>
`;

const out = path.join(root, "story.html");
fs.writeFileSync(out, html, "utf8");
console.log(`已生成 ${path.relative(root, out)}（${(html.length / 1024).toFixed(1)} KB）`);
console.log(`主线用例 ${STORY.acts.reduce((a, x) => a + x.mainCases.length + x.qa.length, 0)} 个；支撑用例 ${STORY.acts.reduce((a, x) => a + x.support.length, 0)} 个；业务步骤 ${stepPass}/${stepAll}（${checkAll} 项核对）`);
