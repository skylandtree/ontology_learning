/* ============================================================================
   views.js —— 与具体小区无关的本体级视图（驾驶舱／案例库／本体图谱）
   规则（SPEC 5.3）：每个视图只负责「编排请求 → 渲染后端返回值」；
   界面上的每一个判定值都必须能在某次函数／动作返回值里找到出处。
   ========================================================================== */
import { state, esc, n1, badge } from "./core.js";
import { panel, panelTight, empty, kv, vchip } from "./ui.js";

/* ── 本体驾驶舱 ─────────────────────────────────────────────────────────── */
export function renderCockpit() {
  const d = state.def || {}, o = state.meta.ontology || {};
  const counts = {
    对象类型: (d.objectTypes || []).length, 关系类型: (d.relationTypes || []).length,
    函数: (d.functions || []).length, 动作: (d.actions || []).length,
    约束: (d.constraints || []).length, 规则: (d.rules || []).length,
    测试假设: (d.assumptions || []).length, 派单规则: (d.dispatchRules || []).length
  };
  const kpis = Object.entries(counts).map(([k, v]) => `
    <div class="kpi" style="--k:var(--cyan)"><div class="k">${esc(k)}</div><div class="v num">${v}</div></div>`).join("");
  const fns = (d.functions || []).map(f => `<tr>
      <td class="k">${badge(f.id)}</td><td>${esc(f.code)}</td>
      <td class="tiny dim">${esc(f.question || "")}</td>
      <td class="n mono tiny">v${esc(f.version)}</td></tr>`).join("");
  const acts = (d.actions || []).map(a => `<tr>
      <td class="k">${badge(a.id)}</td><td>${esc(a.label || a.code)}</td>
      <td class="tiny dim">${esc((a.roles || []).join(" / "))}</td>
      <td class="tiny">${a.definedOnly ? `<span class="verdict v-unk">只定义</span>` : `<span class="verdict v-hit">可执行</span>`}</td></tr>`).join("");
  const invs = (d.constraints || []).map(c => `<tr>
      <td class="k">${badge(c.id)}</td><td>${esc(c.text)}</td>
      <td class="tiny dim mono">${esc((c.checkpoints || []).join(" "))}</td></tr>`).join("");
  return `
    <div class="viewhd">
      <h2>本体驾驶舱</h2><span class="sub">ONTOLOGY COCKPIT · ${esc(o.code || "")}</span>
      <span class="right"><span class="chip ot static">${esc(o.anchor || "OT_CELL_MR")}</span>
        <span class="chip static">问题锚点</span></span>
    </div>
    <div class="note">本体只来自 SPEC：${esc(o.spec?.file || "")}　指纹 <span class="mono">${esc((o.spec?.sha256 || "").slice(0, 16))}…</span>
      <br>界面上的对象、字段、函数、动作、约束、规则全部来自 <span class="mono">GET /definition</span>，不在前端硬编码。</div>
    <div class="grid3">${kpis}</div>
    <div class="grid2">
      ${panelTight("函数 F_01–F_12", "只计算不写记录", `<table class="tbl"><thead><tr><th>标识</th><th>名称</th><th>说明</th><th>版本</th></tr></thead><tbody>${fns}</tbody></table>`)}
      ${panelTight("动作 A_01–A_11", "写入并留审计", `<table class="tbl"><thead><tr><th>标识</th><th>动作</th><th>允许角色</th><th>状态</th></tr></thead><tbody>${acts}</tbody></table>`)}
    </div>
    ${panelTight("核心约束 INV_01–INV_17", "拒绝即来自这里", `<table class="tbl"><thead><tr><th>标识</th><th>约束</th><th>校验点</th></tr></thead><tbody>${invs}</tbody></table>`)}`;
}

/* ── 案例库 ─────────────────────────────────────────────────────────────── */
export function renderCase() {
  const cs = state.cases?.items || [];
  const cur = state.ctx?.cell;
  return `
    <div class="viewhd"><h2>案例库与复用</h2><span class="sub">CASE · OT_CASE / RT_15</span>
      <span class="right"><button class="btn" data-act="reload-cases">刷新</button></span></div>
    ${cur ? `<div class="note">当前小区：<b>${esc(cur.cellName || "")}</b>（${esc(cur.rat || "")}／${esc(cur.sceneLevel || "")}）。
      引用须匹配适用条件，不匹配不得复用；只作参考，不照搬幅度（RT_15）。</div>` : ""}
    ${panelTight("历史案例", `适用条件不一致不得复用；只作参考，不照搬幅度（RT_15）`,
      cs.length ? `<table class="tbl"><thead><tr><th>案例号</th><th>来源工单</th><th>结论</th><th>验证</th><th>幅度</th><th>适用条件</th></tr></thead><tbody>
        ${cs.map(c => `<tr><td class="k mono">${esc(c.caseNo)}</td><td class="mono tiny">${esc(c.sourceTicketNo || "")}</td>
          <td>${vchip(c.outcome || "")}</td><td class="tiny">${esc(c.validation || "")}</td><td class="n">${n1(c.deltaValue)}°</td>
          <td class="tiny dim mono">${esc(JSON.stringify(c.applicability || {}))}</td></tr>`).join("")}
      </tbody></table>` : empty("案例库为空。", "A_09 允许把失败与证据不足的案例同样入库（不删除）。"))}`;
}

/* ── 本体图谱（全量类型级）───────────────────────────────────────────────
   展示的是本体本身：SPEC 定义的对象类型与关系类型，与当前小区、判断时点无关。
   数据只来自 GET /definition；某个小区跑过的流程与对象谱系在「决策链执行」里看。 */
const cut = (s, n) => { const t = String(s || ""); return t.length > n ? t.slice(0, n) + "…" : t; };

export function renderGraph() {
  const d = state.def || {}, o = state.meta.ontology || {};
  const ots = d.objectTypes || [], rts = d.relationTypes || [];
  const edgeCount = rts.reduce((n, r) => n + (r.from || []).length * (r.to || []).length, 0);
  const cnt = [
    ["对象类型", ots.length], ["关系类型", rts.length], ["函数", (d.functions || []).length],
    ["动作", (d.actions || []).length], ["核心约束", (d.constraints || []).length],
    ["规则", (d.rules || []).length], ["测试假设", (d.assumptions || []).length],
    ["派单规则", (d.dispatchRules || []).length]
  ];
  const strip = `<div class="om-counts">${cnt.map(([k, v]) => `<span><b>${v}</b>${esc(k)}</span>`).join("")}</div>`;
  const head = `
    <div class="viewhd"><h2>本体图谱</h2>
      <span class="sub">ONTOLOGY MAP · ${ots.length} 类型 / ${rts.length} 关系 / ${edgeCount} 条端点</span>
      <span class="right"><span class="chip ot static">${esc(o.code || "")}</span>
        <span class="tiny dim">GET /definition</span></span>
    </div>`;
  const legend = `<div class="om-legend">
      <span class="lg"><i class="sw" style="border-color:var(--amber);background:rgba(180,83,9,.10)"></i>数据（前置事实）</span>
      <span class="lg"><i class="sw" style="border-color:var(--cyan);background:rgba(14,116,144,.10)"></i>核心对象</span>
      <span class="lg"><i class="sw" style="border-color:var(--k-rt);background:rgba(3,105,161,.08)"></i>上下文与资源</span>
      <span class="lg"><i class="sw" style="border-color:var(--k-a);background:rgba(37,99,235,.08)"></i>处置流程</span>
      <span class="lg"><i class="sw arw"></i>箭头＝关系方向（起点 → 终点）</span>
      <span class="lg"><i class="sw dash"></i>虚线＝派生关系（RT_03 邻区／重叠覆盖，不落库）</span>
      <span class="lg"><i class="sw loop"></i>自环＝同类型关系（RT_03／RT_07）</span>
    </div>`;
  const relRows = rts.map(r => `<tr>
      <td class="k">${badge(r.id)}</td>
      <td>${esc(r.name || "")}</td>
      <td class="tiny om-ends">${(r.from || []).map(x => badge(x)).join("")} <span class="dim">→</span> ${(r.to || []).map(x => badge(x)).join("")}</td>
      <td class="tiny dim">${esc(cut(r.cardinality, 58))}</td>
      <td class="tiny dim">${esc(cut(r.usedBy, 30))}</td>
    </tr>`).join("");
  const otRows = ots.map(t => `<tr>
      <td class="k">${badge(t.id)}</td>
      <td>${esc(t.name || "")}</td>
      <td class="n">${(t.attributes || []).length}</td>
      <td class="tiny dim">${esc(cut(t.definition, 90))}</td>
    </tr>`).join("");
  const groups = [["函数", d.functions], ["动作", d.actions], ["核心约束", d.constraints], ["规则", d.rules], ["测试假设", d.assumptions]];
  const elHtml = groups.map(([label, arr]) => (arr || []).length
    ? `<div class="om-el-row"><span class="eyebrow">${esc(label)} ${arr.length}</span>${arr.map(x => badge(x.id)).join("")}</div>` : "").join("");
  return head + strip +
    panel("本体全图", `对象类型与关系类型（${ots.length} / ${rts.length}）；点节点进右栏检查器，连线悬停看方向、基数与成立条件`,
      `<div id="omapHost"></div>${legend}
       <div class="note" style="margin-top:9px">这张图不含任何实例：节点与连线全部来自 <span class="mono">GET /definition</span>，
         与当前小区、判断时点无关。某个小区实际跑过的流程与对象谱系，在左侧「当前小区 · 决策链执行」里看。</div>`) +
    `<div style="margin-top:12px">${panelTight("关系类型", "起点 → 终点；点击徽章看基数、成立条件与用于哪些函数／动作",
      `<table class="tbl"><thead><tr><th>关系</th><th>名称</th><th>起点 → 终点</th><th>基数</th><th>用于</th></tr></thead><tbody>${relRows}</tbody></table>`)}</div>` +
    `<div style="margin-top:12px">${panelTight("对象类型", "属性个数；点击徽章看字段、身份与生命周期",
      `<table class="tbl"><thead><tr><th>类型</th><th>名称</th><th>属性</th><th>定义</th></tr></thead><tbody>${otRows}</tbody></table>`)}</div>` +
    `<div style="margin-top:12px">${panelTight("要素清单", "标识全部来自本体定义；点击进检查器", `<div class="om-els">${elHtml}</div>`)}</div>`;
}
