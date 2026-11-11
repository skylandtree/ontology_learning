/* ============================================================================
   board.js —— 小区大屏：只列小区基础属性
   这一屏只回答"有哪些小区、它们的基本属性是什么"：制式、频段、站点类型、
   场景等级、区域、目标半径、发射功率、重叠邻区数。
   判定与处置不在大屏上给——那是点进小区详情后由决策链自己跑出来的结果，
   放在大屏上会变成"看板替人做判断"。点任意卡片进入详情，决策链自动执行。
   ========================================================================== */
import { state, esc, n1, clockTxt, badge, DEMO_CELL, DEMO_CELL_NAME } from "./core.js";

/** 全量小区（本体库里的一条不少；大屏不做裁剪） */
export function scopeCells() {
  return state.cells || [];
}

/** 小区基础属性：卡面上显示的字段，全部来自本体对象与其关系 */
export function boardRows() {
  const attrs = state.board || {};
  return scopeCells().map(c => {
    const a = attrs[c.cellKey] || {};
    // 邻区：本体里没给就是"未知"，不等于"没有邻区"（SPEC：未提供＝未知）
    const hasNb = Array.isArray(c.neighbors);
    const nb = hasNb ? c.neighbors.filter(n => n.overlapWeight > 0) : [];
    return {
      cell: c,
      siteType: a.siteType || "",
      siteId: a.siteId || "",
      areaName: a.areaName || "",
      areaScene: a.areaScene || "",
      antennaId: a.antennaId || "",
      elecTilt: a.elecTilt,
      hasNeighbors: hasNb,
      neighbors: nb.length,
      neighborKeys: nb.map(n => n.targetCellKey)
    };
  });
}

export function filteredRows() {
  const f = state.filters || {};
  const q = (f.q || "").trim().toLowerCase();
  return boardRows().filter(r => {
    if (f.rat && r.cell.rat !== f.rat) return false;
    if (f.scene && (r.cell.sceneLevel || "") !== f.scene) return false;
    if (f.site && (r.siteType || "") !== f.site) return false;
    if (q) {
      const hay = `${r.cell.cellName} ${r.cell.cellKey} ${r.areaName} ${r.siteId} ${r.antennaId}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ── 卡片：只摆基础属性 ─────────────────────────────────────────────────── */
function card(r) {
  const c = r.cell;
  const attrs = [
    ["目标半径", c.targetRadius === undefined || c.targetRadius === null ? "未提供" : `${Math.round(c.targetRadius)} m`],
    ["发射功率", c.rsPower === undefined || c.rsPower === null ? "未提供" : `${n1(c.rsPower)} dBm`],
    ["区域", r.areaName || "未关联"],
    ["重叠邻区", !r.hasNeighbors ? "未知" : `${r.neighbors} 个`]
  ];
  return `<article class="ccard" data-cell="${esc(c.cellKey)}" tabindex="0">
    <div class="cc-hd">
      <span class="cc-nm">${esc(c.cellName)}</span>
      <span class="chip static">${esc(c.rat || "")}</span>
    </div>
    <div class="cc-key mono">${esc(c.cellKey)}</div>
    <div class="cc-tags">
      ${c.band ? `<span class="chip static">${esc(c.band)}</span>` : ""}
      <span class="chip static">${esc(r.siteType || "站点类型未知")}</span>
      <span class="chip static">${esc(c.sceneLevel || "场景等级缺失")}</span>
      ${r.areaScene ? `<span class="chip static">${esc(r.areaScene)}</span>` : ""}
    </div>
    <div class="cc-attrs">
      ${attrs.map(([k, v]) => `<span class="ca"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></span>`).join("")}
    </div>
    <div class="cc-ft">
      ${r.antennaId ? `<span class="tiny dim mono" title="RT_02 天线">${esc(r.antennaId)}</span>` : ""}
      ${r.siteId ? `<span class="tiny dim mono" title="RT_01 归属站点">${esc(r.siteId)}</span>` : ""}
      <span class="spacer"></span>
      <span class="tiny dim">点开自动执行决策链 →</span>
    </div>
    <div class="cc-els">${badge("OT_CELL")}</div>
  </article>`;
}

/* ── 筛选器：只按基础属性筛 ─────────────────────────────────────────────── */
function filtersHtml(rows) {
  const f = state.filters || {};
  const cells = scopeCells();
  const rats = [...new Set(cells.map(c => c.rat).filter(Boolean))];
  const scenes = [...new Set(cells.map(c => c.sceneLevel).filter(Boolean))];
  const sites = [...new Set(cells.map(c => (state.board || {})[c.cellKey]?.siteType).filter(Boolean))];
  const opt = (v, cur, label) => `<option value="${esc(v)}"${cur === v ? " selected" : ""}>${esc(label ?? v)}</option>`;
  return `<div class="row wrap filters">
    <span class="eyebrow">筛选</span>
    <select id="fRat" data-f="rat">${opt("", f.rat, "全部制式")}${rats.map(v => opt(v, f.rat)).join("")}</select>
    <select id="fScene" data-f="scene">${opt("", f.scene, "全部场景等级")}${scenes.map(v => opt(v, f.scene)).join("")}</select>
    <select id="fSite" data-f="site">${opt("", f.site, "全部站点类型")}${sites.map(v => opt(v, f.site)).join("")}</select>
    <input id="fQ" type="search" placeholder="搜索小区名／小区标识／区域／天线" value="${esc(f.q || "")}" style="width:250px">
    <span class="tiny dim" id="fCount">命中 ${rows.length} / ${cells.length} 个小区</span>
  </div>`;
}

/* ── 主视图 ─────────────────────────────────────────────────────────────── */
export function renderBoard() {
  const rows = filteredRows();
  const cells = scopeCells();
  const cnt = rat => cells.filter(c => c.rat === rat).length;
  const siteCnt = t => cells.filter(c => (state.board || {})[c.cellKey]?.siteType === t).length;
  const kpis = [
    ["小区总数", cells.length, "var(--cyan)"],
    ["LTE", cnt("LTE"), "var(--cyan)"],
    ["NR", cnt("NR"), "var(--violet)"],
    ["宏站", siteCnt("宏站"), "var(--ink-1)"],
    ["室分", siteCnt("室分"), "var(--amber)"]
  ].map(([k, v, col]) => `<div class="kpi" style="--k:${col}"><div class="k">${esc(k)}</div><div class="v num">${esc(v)}</div></div>`).join("");

  return `
  <div class="viewhd">
    <h2>小区大屏</h2><span class="sub">CELL BOARD · ATTRIBUTES · ${esc(state.meta.ontology?.code || "")}</span>
    <span class="right"><span class="tiny dim">判断时点 <span class="mono">${esc(clockTxt(state.clock))}</span></span></span>
  </div>
  <div class="note">
    这一屏只列<b>小区基础属性</b>：制式、频段、站点类型、场景等级、区域、目标半径、发射功率、重叠邻区——属性全部取自本体对象与其关系，不做判定。
    <br>点任意一张卡片进入小区详情：<b>决策链自动执行</b>，从发现判定一路走到闭环与案例，能走到哪一步由本体说了算，走到哪一步、执行了什么、卡在哪里，都显示在该小区详情页的首部。
    <br>想看“链停在需要人工接入的地方、处理完再继续”：点开 <b>${DEMO_CELL_NAME}</b>（第 ⑤ 步等现场回报）
      <button class="btn ghost tiny" data-act="demo-start" data-key="${DEMO_CELL}" title="从初始数据创建一次新的独立分析">从 09-11 重演</button>
      ；一路走通的对照是 <b>崇贤达NF02H_222</b>。
    <br>默认<b>独立分析</b>：每次点击小区都从初始数据开始，无需先点重置。需要沿用本轮时点、工单和案例时，可在右上角选择“连续分析”。
      “快速结果”和“逐步演示”执行相同业务规则，完整推理过程都可在步骤卡片中查看。
  </div>
  <div class="grid5">${kpis}</div>
  ${filtersHtml(rows)}
  <div class="ccards" id="boardGrid">${rows.map(card).join("") || `<div class="note">没有符合筛选条件的小区。</div>`}</div>`;
}

/** 只刷新卡片区（筛选输入时不重建整页，避免丢焦点） */
export function refreshBoardGrid() {
  const host = document.getElementById("boardGrid");
  if (!host) return;
  const rows = filteredRows();
  host.innerHTML = rows.map(card).join("") || `<div class="note">没有符合筛选条件的小区。</div>`;
  const cnt = document.getElementById("fCount");
  if (cnt) cnt.textContent = `命中 ${rows.length} / ${scopeCells().length}`;
}
