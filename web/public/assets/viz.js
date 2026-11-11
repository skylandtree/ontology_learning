/* ============================================================================
   viz.js —— 手写 SVG 图元（无第三方图表库）
   四组图元分别承载两类业务表达：
     · 本体表达：本体图谱（对象—关系—路径）、判定三态、证据链
     · 网优表达：逐日 MR 柱状、下倾几何剖面、扇区态势图、前后窗对比
   ========================================================================== */
import { esc, pct, n1, n2, d2, dayTxt } from "./core.js";

const NS = "http://www.w3.org/2000/svg";
const el = (n, a = {}) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
const T = (x, y, s, cls = "lbl", extra = {}) => { const t = el("text", { x, y, class: cls, ...extra }); t.textContent = s; return t; };

/* ── 1. 逐日 MR 柱状图 ─────────────────────────────────────────────────── */
/** daily: [{date, hit, ratio, sampleTotal, sampleWeak, version}]；rule: {minWeakRatio,minWeakSamples} */
export function mrChart(daily, rule = {}, opt = {}) {
  const W = opt.w || 640, H = opt.h || 190, PL = 34, PR = 12, PT = 12, PB = 40;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", style: "width:100%;height:auto" });
  if (!daily || !daily.length) { svg.appendChild(T(W / 2, H / 2, "窗口内无 OT_CELL_MR 实例 —— 未知，不是 0", "lbl", { "text-anchor": "middle" })); return svg; }
  const thr = rule.minWeakRatio ?? 0.2;
  const max = Math.max(thr * 1.35, ...daily.map(d => d.ratio || 0)) * 1.12;
  const iw = W - PL - PR, ih = H - PT - PB, n = daily.length, bw = Math.min(34, iw / n * 0.62);
  const y = v => PT + ih - (v / max) * ih, x = i => PL + (i + 0.5) * (iw / n);

  for (let g = 0; g <= 4; g++) { const v = max * g / 4, yy = y(v); svg.appendChild(el("line", { x1: PL, y1: yy, x2: W - PR, y2: yy, class: "grid" })); svg.appendChild(T(PL - 5, yy + 3, (v * 100).toFixed(0) + "%", "lbl", { "text-anchor": "end" })); }
  // 派单规则门限
  svg.appendChild(el("line", { x1: PL, y1: y(thr), x2: W - PR, y2: y(thr), stroke: "var(--amber)", "stroke-width": 1, "stroke-dasharray": "5 3" }));
  svg.appendChild(T(W - PR, y(thr) - 4, `门限 ${pct(thr, 0)}`, "lbl", { "text-anchor": "end", fill: "var(--amber)" }));

  daily.forEach((d, i) => {
    const cx = x(i), v = d.ratio || 0, yy = y(v), hgt = Math.max(PT + ih - yy, 1);
    if (d.hit === "是") {
      svg.appendChild(el("rect", { x: cx - bw / 2, y: yy, width: bw, height: hgt, rx: 1.5, fill: "url(#gCyan)", stroke: "var(--cyan)", "stroke-width": 1 }));
      svg.appendChild(T(cx, yy - 5, pct(v, 2), "lbl-b", { "text-anchor": "middle", fill: "var(--cyan)" }));
    } else if (d.hit === "否") {
      svg.appendChild(el("rect", { x: cx - bw / 2, y: yy, width: bw, height: hgt, rx: 1.5, fill: "rgba(100,116,139,.12)", stroke: "var(--ink-4)", "stroke-width": 1, "stroke-dasharray": "2 2" }));
      svg.appendChild(T(cx, yy - 5, pct(v, 2), "lbl", { "text-anchor": "middle" }));
    } else {
      svg.appendChild(el("rect", { x: cx - bw / 2, y: PT, width: bw, height: ih, rx: 1.5, fill: "url(#gWarn)", stroke: "var(--amber)", "stroke-width": 1, "stroke-dasharray": "4 3", opacity: .85 }));
      svg.appendChild(T(cx, PT + 12, "未知", "lbl", { "text-anchor": "middle", fill: "var(--amber)" }));
    }
    svg.appendChild(T(cx, H - PB + 14, dayTxt(d.date).slice(5), "lbl", { "text-anchor": "middle" }));
    svg.appendChild(T(cx, H - PB + 26, d.sampleTotal ? `${d.sampleWeak}/${d.sampleTotal}` : "缺天", "lbl", { "text-anchor": "middle", fill: "var(--ink-4)", "font-size": "8px" }));
    if (d.version > 1) svg.appendChild(T(cx + bw / 2 - 1, PT + 9, "v" + d.version, "lbl", { "text-anchor": "end", fill: "var(--amber)", "font-size": "8px" }));
  });
  svg.appendChild(el("line", { x1: PL, y1: PT + ih, x2: W - PR, y2: PT + ih, class: "axis" }));
  // 渐变定义
  const defs = el("defs");
  const g1 = el("linearGradient", { id: "gCyan", x1: 0, y1: 0, x2: 0, y2: 1 });
  g1.appendChild(el("stop", { offset: "0%", "stop-color": "rgba(8,145,178,.55)" })); g1.appendChild(el("stop", { offset: "100%", "stop-color": "rgba(8,145,178,.12)" }));
  const g2 = el("pattern", { id: "gWarn", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  g2.appendChild(el("rect", { width: 6, height: 6, fill: "rgba(180,83,9,.05)" })); g2.appendChild(el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "rgba(180,83,9,.34)", "stroke-width": 1.6 }));
  defs.appendChild(g1); defs.appendChild(g2); svg.insertBefore(defs, svg.firstChild);
  return svg;
}

/* ── 2. 下倾角几何剖面图（本设计的视觉核心）───────────────────────────── */
/** f8: F_08 返回；after: {totalTilt} 调整后的总下倾（可选，用于前后对比） */
export function tiltDiagram(f8, after = null) {
  const inp = f8?.inputs || {}, h = inp.h, beta = inp.vBeam, th = f8?.totalTilt, thT = f8?.thetaTarget, Rt = inp.Rt;
  const W = 560, H = 300, GL = 66, GB = 42, GT = 44, GR = 22;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", style: "width:100%;height:auto" });
  const defs = el("defs");
  const gc = el("linearGradient", { id: "gBeam", x1: 0, y1: 0, x2: 0, y2: 1 });
  gc.appendChild(el("stop", { offset: "0%", "stop-color": "rgba(8,145,178,.30)" })); gc.appendChild(el("stop", { offset: "100%", "stop-color": "rgba(8,145,178,.02)" }));
  const gv = el("linearGradient", { id: "gBeamT", x1: 0, y1: 0, x2: 0, y2: 1 });
  gv.appendChild(el("stop", { offset: "0%", "stop-color": "rgba(124,58,237,.20)" })); gv.appendChild(el("stop", { offset: "100%", "stop-color": "rgba(124,58,237,.02)" }));
  defs.appendChild(gc); defs.appendChild(gv); svg.appendChild(defs);

  if (![h, beta, th].every(v => typeof v === "number")) {
    svg.appendChild(T(W / 2, H / 2, "缺必需输入（挂高／垂直波束宽／总下倾）—— F_08＝未知，不画几何", "lbl", { "text-anchor": "middle", fill: "var(--amber)" }));
    return svg;
  }
  const rFar = f8.rFar || h / Math.tan((th - beta / 2) * Math.PI / 180);
  const rNear = f8.rNear || h / Math.tan((th + beta / 2) * Math.PI / 180);
  const xMax = Math.max(rFar, Rt || 0, 100) * 1.22;
  const yMax = h * 1.28;
  const X = m => GL + (m / xMax) * (W - GL - GR);
  const Y = hh => H - GB - (hh / yMax) * (H - GB - GT);

  // 地面与网格
  svg.appendChild(el("line", { x1: GL, y1: Y(0), x2: W - GR, y2: Y(0), stroke: "var(--line-2)", "stroke-width": 1.2 }));
  for (let g = 0; g <= 5; g++) { const m = xMax * g / 5; svg.appendChild(el("line", { x1: X(m), y1: Y(0), x2: X(m), y2: Y(yMax), class: "grid" })); svg.appendChild(T(X(m), Y(0) + 13, Math.round(m) + "m", "lbl", { "text-anchor": "middle", fill: "var(--ink-4)" })); }

  // 射线几何（与 SPEC 的 F_02 / F_04 同口径）：下倾角 θ 自水平线量起，
  // 波束边缘与水平线夹角为 θ±β/2，其落地距离 r = h / tan(θ±β/2)；
  // 地面上水平距离 d 处的高度 z = h − d·tan(θ±β/2)。
  const pt = (deg, d) => { const r = deg * Math.PI / 180; return [X(d), Y(h - d * Math.tan(r))]; };
  const ground = (deg) => h / Math.tan(deg * Math.PI / 180);
  const beam = (theta, color, dash, fill, opacity) => {
    const rf = ground(theta - beta / 2), rn = ground(theta + beta / 2);
    const p1 = pt(theta + beta / 2, rn), p2 = pt(theta - beta / 2, rf);
    const mid = pt(theta, ground(theta));
    svg.appendChild(el("polygon", { points: `${X(0)},${Y(h)} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`, fill, opacity }));
    svg.appendChild(el("line", { x1: X(0), y1: Y(h), x2: p1[0], y2: p1[1], stroke: color, "stroke-width": 1.4, "stroke-dasharray": dash }));
    svg.appendChild(el("line", { x1: X(0), y1: Y(h), x2: p2[0], y2: p2[1], stroke: color, "stroke-width": 1.4, "stroke-dasharray": dash }));
    svg.appendChild(el("line", { x1: X(0), y1: Y(h), x2: mid[0], y2: mid[1], stroke: color, "stroke-width": .8, opacity: .45, "stroke-dasharray": "1 3" }));
    return { rf, rn };
  };

  // 目标下倾（推荐）先画在下层
  if (typeof thT === "number") {
    beam(thT, "var(--violet)", "6 4", "url(#gBeamT)", 1);
    if (Rt) {
      svg.appendChild(el("line", { x1: X(Rt), y1: Y(0), x2: X(Rt), y2: Y(h) * .55, stroke: "var(--violet)", "stroke-width": 1.1, "stroke-dasharray": "4 3" }));
      svg.appendChild(T(X(Rt), Y(0) - 6, `目标半径 Rt=${Math.round(Rt)}m`, "lbl", { "text-anchor": "middle", fill: "var(--violet)" }));
    }
  }
  // 当前下倾
  const c = beam(th, "var(--cyan)", "", "url(#gBeam)", 1);

  // 图例（放在左上角，避开波束）
  svg.appendChild(el("line", { x1: GL, y1: 14, x2: GL + 18, y2: 14, stroke: "var(--violet)", "stroke-width": 1.6, "stroke-dasharray": "6 4" }));
  svg.appendChild(T(GL + 24, 17, `推荐下倾 θT=${n2(thT)}°`, "lbl", { fill: "var(--violet)" }));
  svg.appendChild(el("line", { x1: GL, y1: 29, x2: GL + 18, y2: 29, stroke: "var(--cyan)", "stroke-width": 1.6 }));
  svg.appendChild(T(GL + 24, 32, `当前总下倾 θ=${n2(th)}°`, "lbl", { fill: "var(--cyan)" }));

  // 塔
  svg.appendChild(el("line", { x1: X(0), y1: Y(0), x2: X(0), y2: Y(h), stroke: "var(--ink-2)", "stroke-width": 2 }));
  svg.appendChild(el("path", { d: `M${X(0) - 9} ${Y(0)} L${X(0)} ${Y(h)} L${X(0) + 9} ${Y(0)}`, fill: "none", stroke: "var(--ink-3)", "stroke-width": 1, opacity: .6 }));
  svg.appendChild(T(X(0) - 10, Y(h) - 2, "h=" + n1(h) + "m", "lbl", { "text-anchor": "end", fill: "var(--ink-2)" }));
  svg.appendChild(T(X(0) - 10, Y(h) + 12, "β=" + n1(beta) + "°", "lbl", { "text-anchor": "end", fill: "var(--ink-2)" }));

  // 远端/近端标注
  svg.appendChild(el("circle", { cx: X(c.rf), cy: Y(0), r: 3, fill: "var(--cyan)" }));
  svg.appendChild(T(X(c.rf), Y(0) - 8, `rFar ${n1(c.rf)}m`, "lbl-b", { "text-anchor": "middle", fill: "var(--cyan)" }));
  svg.appendChild(el("circle", { cx: X(c.rn), cy: Y(0), r: 3, fill: "var(--cyan)", opacity: .7 }));
  svg.appendChild(T(X(c.rn), Y(0) - 8, `rNear ${n1(c.rn)}m`, "lbl", { "text-anchor": "middle", fill: "var(--ink-3)" }));

  // 缺口标注（θT − θ）：在塔顶画一段夹角弧
  if (typeof thT === "number" && typeof f8.deficit === "number") {
    const ax = X(0), ay = Y(h), r0 = 30;
    const p = (a) => [ax + r0 * Math.cos(a * Math.PI / 180), ay + r0 * Math.sin(a * Math.PI / 180)];
    const s = p(th), e = p(thT);
    svg.appendChild(el("path", { d: `M${ax} ${ay} L${s[0]} ${s[1]} A${r0} ${r0} 0 0 1 ${e[0]} ${e[1]}`, fill: "none", stroke: "var(--red)", "stroke-width": 1.3 }));
    svg.appendChild(T(ax + r0 + 16, ay + 12, `缺口 ${n2(f8.deficit)}°`, "lbl-b", { fill: "var(--red)" }));
  }
  // 调整后叠加
  if (after && typeof after.totalTilt === "number") {
    const af = ground(after.totalTilt - beta / 2), an = ground(after.totalTilt + beta / 2);
    const p1 = pt(after.totalTilt + beta / 2, an), p2 = pt(after.totalTilt - beta / 2, af);
    svg.appendChild(el("line", { x1: X(0), y1: Y(h), x2: p1[0], y2: p1[1], stroke: "var(--green)", "stroke-width": 1.6, "stroke-dasharray": "7 4" }));
    svg.appendChild(el("line", { x1: X(0), y1: Y(h), x2: p2[0], y2: p2[1], stroke: "var(--green)", "stroke-width": 1.6, "stroke-dasharray": "7 4" }));
    svg.appendChild(el("circle", { cx: X(af), cy: Y(0), r: 3.5, fill: "var(--green)" }));
    svg.appendChild(T(X(af), Y(0) - 8, `调整后 rFar ${n1(af)}m`, "lbl-b", { "text-anchor": "middle", fill: "var(--green)" }));
  }
  return svg;
}

/* ── 3. 扇区态势图（俯视）──────────────────────────────────────────────── */
/** items: [{siteId,lat,lon,azimuth,beta,rFarBefore,rFarAfter,role,cells:[{cellKey,cellName}],dist}] */
export function sectorMap(items, opt = {}) {
  const W = opt.w || 560, H = opt.h || 360;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", style: "width:100%;height:auto" });
  const pts = items.filter(i => typeof i.lat === "number" && typeof i.lon === "number");
  if (pts.length < 1) { svg.appendChild(T(W / 2, H / 2, "无坐标信息", "lbl", { "text-anchor": "middle" })); return svg; }
  const R = 6371000, rad = d => d * Math.PI / 180;
  // 以目标站为画面中心：站点按经纬度投影，比例尺同时容纳最远的站点与最大的扇区半径
  const target0 = pts.find(i => i.role === "目标") || pts[0];
  const xy = p => [R * rad(p.lon), R * rad(p.lat)];
  const txy = xy(target0);
  const maxD = Math.max(...pts.map(p => { const q = xy(p); return Math.hypot(q[0] - txy[0], (q[1] - txy[1]) * Math.cos(rad(txy[1] / R))); }), 0);
  const maxR = Math.max(...pts.map(i => Math.max(i.rFarBefore || 0, i.rFarAfter || 0)), 100);
  const need = Math.max(maxD, maxR) * 1.1;
  const scale = Math.min((W / 2 - 70) / need, (H / 2 - 46) / need);
  const P = p => { const q = xy(p); return [W / 2 + (q[0] - txy[0]) * scale, H / 2 - (q[1] - txy[1]) * scale]; };
  // 距离标尺
  const barM = 200, barPx = barM * scale;
  svg.appendChild(el("line", { x1: 24, y1: H - 22, x2: 24 + barPx, y2: H - 22, stroke: "var(--ink-3)", "stroke-width": 1.4 }));
  svg.appendChild(el("line", { x1: 24, y1: H - 26, x2: 24, y2: H - 18, stroke: "var(--ink-3)", "stroke-width": 1.4 }));
  svg.appendChild(el("line", { x1: 24 + barPx, y1: H - 26, x2: 24 + barPx, y2: H - 18, stroke: "var(--ink-3)", "stroke-width": 1.4 }));
  svg.appendChild(T(24 + barPx / 2, H - 28, barM + " m", "lbl", { "text-anchor": "middle", fill: "var(--ink-2)" }));

  const target = items.find(i => i.role === "目标") || items[0];
  const tp = P(target);
  items.forEach(i => { if (i === target) return; const p = P(i); svg.appendChild(el("line", { x1: tp[0], y1: tp[1], x2: p[0], y2: p[1], stroke: "rgba(124,58,237,.5)", "stroke-width": 1, "stroke-dasharray": "3 3" })); });

  items.forEach(i => {
    const [px, py] = P(i);
    const az = (i.azimuth === undefined || i.azimuth === null) ? 0 : i.azimuth;
    const half = (i.beta || 65) / 2;
    const col = i.color || "var(--violet)";
    // 覆盖半径圈（调整前虚线 / 调整后实线）——射频规划惯用的覆盖圈
    for (const [rf, dash, op] of [[i.rFarBefore, "5 3", .5], [i.rFarAfter, "", 1]]) {
      if (!rf) continue;
      const r = Math.max(8, rf * scale);
      svg.appendChild(el("circle", { cx: px, cy: py, r, fill: "none", stroke: col, "stroke-width": i.role === "目标" ? 1.2 : .9, "stroke-dasharray": dash, opacity: .38 * op }));
    }
    // 主瓣扇区
    for (const [rf, dash, op] of [[i.rFarBefore, "5 3", .45], [i.rFarAfter, "", 1]]) {
      if (!rf) continue;
      const r = Math.max(8, rf * scale);
      const a0 = rad(az - half - 90), a1 = rad(az + half - 90);
      const x0 = px + r * Math.cos(a0), y0 = py + r * Math.sin(a0), x1 = px + r * Math.cos(a1), y1 = py + r * Math.sin(a1);
      svg.appendChild(el("path", { d: `M${px} ${py} L${x0} ${y0} A${r} ${r} 0 0 1 ${x1} ${y1} Z`, fill: hexA(col, .2 * op), stroke: col, "stroke-width": i.role === "目标" ? 1.4 : 1, "stroke-dasharray": dash, opacity: op }));
    }
    svg.appendChild(el("circle", { cx: px, cy: py, r: 3.6, fill: col }));
    const label = i.cells?.map(c => c.cellName).join("、") || i.siteId;
    svg.appendChild(T(px + 9, py - 7, label.length > 12 ? label.slice(0, 12) : label, "lbl-b", { fill: i.role === "目标" ? "var(--cyan)" : "var(--ink-2)" }));
    if (i.cells?.length > 1) svg.appendChild(T(px + 9, py + 6, `同站 ${i.cells.length} 个小区`, "lbl", { fill: "var(--ink-4)", "font-size": "8px" }));
    if (i.dist) svg.appendChild(T((px + tp[0]) / 2, (py + tp[1]) / 2 - 5, Math.round(i.dist) + "m", "lbl", { "text-anchor": "middle", fill: "var(--ink-3)" }));
  });
  // 图例
  const lx = W - 168, ly = 18;
  svg.appendChild(el("line", { x1: lx, y1: ly, x2: lx + 16, y2: ly, stroke: "var(--cyan)", "stroke-width": 1.6 }));
  svg.appendChild(T(lx + 21, ly + 3, "调整后远端覆盖", "lbl", { fill: "var(--cyan)" }));
  svg.appendChild(el("line", { x1: lx, y1: ly + 14, x2: lx + 16, y2: ly + 14, stroke: "var(--cyan)", "stroke-width": 1.4, "stroke-dasharray": "5 3" }));
  svg.appendChild(T(lx + 21, ly + 17, "调整前远端覆盖", "lbl", { fill: "var(--ink-3)" }));
  svg.appendChild(el("circle", { cx: lx + 8, cy: ly + 28, r: 3.4, fill: "var(--violet)" }));
  svg.appendChild(T(lx + 21, ly + 31, "重叠邻区／同站小区", "lbl", { fill: "var(--violet)" }));
  return svg;
}
function hexA(c, a) { const m = /var\(--([a-z-]+)\)/.exec(c); if (!m) return c; const map = { "--cyan": "8,145,178", "--violet": "124,58,237", "--green": "5,150,105", "--amber": "180,83,9", "--red": "220,38,38", "--blue": "37,99,235" }; return `rgba(${map[m[1]] || "8,145,178"},${a})`; }

/* ── 4. 周边影响逐项检查（bullet 条）────────────────────────────────── */
export function impactChecks(checks = []) {
  if (!checks.length) return `<div class="note">无周边影响检查项</div>`;
  return checks.map(c => {
    if (c.kind === "事后复核") return `<tr class="dim"><td>事后复核</td><td class="n">—</td><td colspan="3" class="tiny">实际Δ ${n1(c.delta)} m → ${esc(c.result)}</td></tr>`;
    if (c.kind === "远端覆盖") {
      const max = Math.max(c.before || 0, c.after || 0, c.targetRadius || 0) * 1.15;
      const w = v => `${Math.min(100, (v / max) * 100)}%`;
      const ok = c.pass;
      return `<tr>
        <td>远端覆盖 <span class="mono tiny dim">${esc(c.cell || "")}</span></td>
        <td class="n">${n1(c.before)} → <b style="color:${ok ? "var(--green)" : "var(--red)"}">${n1(c.after)}</b> m</td>
        <td style="width:34%">
          <div style="position:relative;height:16px">
            <div style="position:absolute;left:0;top:6px;height:4px;width:${w(c.before)};background:rgba(100,116,139,.6);border-radius:2px"></div>
            <div style="position:absolute;left:0;top:2px;height:4px;width:${w(c.after)};background:${ok ? "var(--green)" : "var(--red)"};border-radius:2px;box-shadow:0 0 8px ${ok ? "var(--green)" : "var(--red)"}"></div>
            <div style="position:absolute;left:${w(c.targetRadius)};top:0;width:2px;height:16px;background:var(--amber)"></div>
          </div>
        </td>
        <td class="n tiny">目标 ${Math.round(c.targetRadius)} m</td>
        <td>${ok ? `<span class="verdict v-hit">通过</span>` : `<span class="verdict v-bad">不满足</span>`}</td>
      </tr>`;
    }
    const ok = c.pass;
    return `<tr>
      <td>重叠指数 <span class="mono tiny dim">${esc(c.neighbor || "")}</span></td>
      <td class="n">${n1(c.before)} → <b style="color:${ok ? "var(--green)" : "var(--red)"}">${n1(c.after)}</b></td>
      <td class="tiny dim">站间距 ${n1(c.distance)} m${c.result ? " · " + esc(c.result) : ""}</td>
      <td colspan="2">${c.result ? `<span class="verdict v-unk">未评估</span>` : ok ? `<span class="verdict v-hit">不增大</span>` : `<span class="verdict v-bad">增大</span>`}</td>
    </tr>`;
  }).join("");
}

/* ── 5. 前后窗对比（效果）──────────────────────────────────────────────── */
export function windowCompare(before, after, opt = {}) {
  const W = opt.w || 560, H = opt.h || 150, PL = 40, PR = 16, PT = 16, PB = 26;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", style: "width:100%;height:auto" });
  const max = Math.max(before || 0, after || 0, .1) * 1.35;
  const bw = 74;
  const y = v => PT + (H - PT - PB) * (1 - v / max);
  [[before, "var(--violet)", "前窗"], [after, "var(--green)", "后窗"]].forEach(([v, c, lab], i) => {
    const x = PL + 20 + i * (bw + 60), yy = y(v || 0), h = Math.max(2, (H - PT - PB) - (yy - PT));
    svg.appendChild(el("rect", { x, y: yy, width: bw, height: h, rx: 2, fill: c, opacity: .28, stroke: c, "stroke-width": 1 }));
    svg.appendChild(T(x + bw / 2, yy - 6, pct(v), "lbl-d", { "text-anchor": "middle", fill: c }));
    svg.appendChild(T(x + bw / 2, H - 8, lab, "lbl", { "text-anchor": "middle" }));
  });
  svg.appendChild(el("line", { x1: PL, y1: H - PB, x2: W - PR, y2: H - PB, class: "axis" }));
  svg.appendChild(T(W - PR, PT - 4, opt.note || "", "lbl", { "text-anchor": "end" }));
  return svg;
}

/* ── 6. 本体图谱（类型级，全量）──────────────────────────────────────────
   画的是本体自己：SPEC 定义的 9 个对象类型与 17 类关系，与任何小区实例无关。
   布局是手定的（对象类型数量固定；定义里多出来的类型按顺序补到下方），
   连线标注 RT 编号、带方向箭头，自环表示同类型关系；点节点进右栏检查器。 */
const OM_W = 1220, OM_H = 780, OM_BW = 168, OM_BH = 64;
const OM_SLOTS = {
  OT_AREA:    { x: 170, y: 175, tone: "ctx" },
  OT_CELL:    { x: 520, y: 320, tone: "core" },
  OT_SITE:    { x: 170, y: 465, tone: "ctx" },
  OT_ANTENNA: { x: 800, y: 150, tone: "ctx" },
  OT_CELL_MR: { x: 1080, y: 560, tone: "data" },
  OT_TICKET:  { x: 880, y: 380, tone: "flow" },
  OT_PLAN:    { x: 600, y: 545, tone: "flow" },
  OT_EFFECT:  { x: 290, y: 545, tone: "flow" },
  OT_CASE:    { x: 290, y: 725, tone: "flow" }
};
const OM_TONE = { data: "var(--amber)", core: "var(--cyan)", ctx: "var(--k-rt)", flow: "var(--k-a)" };
// 部分关系两侧共用一段通道，标签沿曲线错开，避免叠字
const OM_LABEL_T = { RT_09: .42, RT_10: .64, RT_16: .56, RT_17: .52 };

function omBoxEdge(c, ux, uy) {
  const hw = OM_BW / 2 + 1, hh = OM_BH / 2 + 1;
  const tx = Math.abs(ux) > 1e-6 ? hw / Math.abs(ux) : Infinity;
  const ty = Math.abs(uy) > 1e-6 ? hh / Math.abs(uy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: c.x + ux * t, y: c.y + uy * t };
}
function omQuad(p1, c, p2, t) {
  const mt = 1 - t;
  return { x: mt * mt * p1.x + 2 * t * mt * c.x + t * t * p2.x,
           y: mt * mt * p1.y + 2 * t * mt * c.y + t * t * p2.y };
}

/** def: GET /definition；opt.anchor：问题锚点对象类型（来自 /ontologies） */
export function ontologyMap(def, opt = {}) {
  const d = def || {};
  const types = d.objectTypes || [];
  const rts = d.relationTypes || [];
  // 布局：先按手定坐标落位，定义里没列到的类型补在下方（本体改版后不至于画丢）
  const pos = {}, extra = [];
  types.forEach(t => {
    if (OM_SLOTS[t.id]) pos[t.id] = { ...OM_SLOTS[t.id] };
    else {
      const k = extra.length; extra.push(t.id);
      pos[t.id] = { x: 190 + (k % 4) * 290, y: OM_H + 40 + Math.floor(k / 4) * 118, tone: "ctx" };
    }
  });
  const H = OM_H + 40 + Math.ceil(extra.length / 4) * 118;
  const svg = el("svg", { viewBox: `0 0 ${OM_W} ${H}`, preserveAspectRatio: "xMidYMid meet", class: "omap", style: "width:100%;height:auto" });
  const defs = el("defs");
  const mk = el("marker", { id: "omArrow", viewBox: "0 0 10 10", refX: 9.5, refY: 5, markerWidth: 5.5, markerHeight: 5.5, orient: "auto" });
  mk.appendChild(el("path", { d: "M0 1 L9.5 5 L0 9 Z", fill: "rgba(71,85,105,.62)" }));
  defs.appendChild(mk); svg.appendChild(defs);

  // 关系端点：一条关系可以有多组起点／终点（如 RT_10 方案→天线·小区）
  const edges = [];
  rts.forEach(r => (r.from || []).forEach(f => (r.to || []).forEach(t => edges.push({
    rt: r.id, name: r.name || "", card: r.cardinality || "", from: f, to: t, self: f === t
  }))));
  // 同一对类型之间的多条关系用不同弧度分开（RT_05／06／08 都在工单—小区之间）
  const groups = new Map();
  edges.forEach(e => {
    if (e.self) return;
    const key = [e.from, e.to].sort().join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });
  groups.forEach(list => {
    list.sort((a, b) => String(a.rt).localeCompare(String(b.rt)));
    list.forEach((e, i) => { e.bow = (i - (list.length - 1) / 2) * 46; });
  });
  edges.forEach(e => { e.t = OM_LABEL_T[e.rt] || .5; });

  const label = (x, y, txt, col, title) => {
    const g = el("g");
    g.appendChild(el("rect", { x: x - 23, y: y - 8, width: 46, height: 16, rx: 2.5, fill: "#ffffff", stroke: col, "stroke-width": .7, opacity: .96 }));
    g.appendChild(T(x, y + 3.5, txt, "lbl", { "text-anchor": "middle", "font-size": "8.5px", fill: col }));
    if (title) { const ti = el("title"); ti.textContent = title; g.appendChild(ti); }
    svg.appendChild(g);
  };

  // 连线与关系徽章
  edges.forEach(e => {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) return;
    const col = OM_TONE[a.tone] || "var(--k-rt)";
    const dashed = e.rt === "RT_03" || /派生/.test(e.card);
    const title = `${e.rt} ${e.name}：${e.from} → ${e.to}${e.card ? "｜" + e.card : ""}`;
    if (e.self) {                                   // 自环：同类型关系（邻区、复发）
      const right = e.from !== "OT_CELL";
      let dPath, lx, ly;
      if (right) {
        dPath = `M${a.x + OM_BW / 2} ${a.y - 26} C${a.x + OM_BW / 2 + 78} ${a.y - 76} ${a.x + OM_BW / 2 + 78} ${a.y + 76} ${a.x + OM_BW / 2} ${a.y + 26}`;
        lx = a.x + OM_BW / 2 + 42; ly = a.y;
      } else {
        dPath = `M${a.x - 30} ${a.y - OM_BH / 2} C${a.x - 80} ${a.y - OM_BH / 2 - 88} ${a.x + 80} ${a.y - OM_BH / 2 - 88} ${a.x + 30} ${a.y - OM_BH / 2}`;
        lx = a.x; ly = a.y - OM_BH / 2 - 62;
      }
      svg.appendChild(el("path", { d: dPath, fill: "none", stroke: col, "stroke-width": 1.2, "stroke-opacity": .55,
        "stroke-dasharray": dashed ? "4 3" : "", "marker-end": "url(#omArrow)" }));
      label(lx, ly, e.rt, col, title);
      return;
    }
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const p1 = omBoxEdge(a, ux, uy), p2 = omBoxEdge(b, -ux, -uy);
    const c = { x: (p1.x + p2.x) / 2 - uy * e.bow, y: (p1.y + p2.y) / 2 + ux * e.bow };
    svg.appendChild(el("path", {
      d: `M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`,
      fill: "none", stroke: col, "stroke-width": 1.2, "stroke-opacity": .55,
      "stroke-dasharray": dashed ? "4 3" : "", "marker-end": "url(#omArrow)"
    }));
    const q = omQuad(p1, c, p2, e.t);
    label(q.x, q.y, e.rt, col, title);
  });

  // 对象类型节点（点开进右栏检查器）
  types.forEach(t => {
    const s = pos[t.id];
    const col = OM_TONE[s.tone] || "var(--k-ot)";
    const g = el("g", { class: "om-node", "data-el": t.id });
    g.appendChild(el("rect", {
      x: s.x - OM_BW / 2, y: s.y - OM_BH / 2, width: OM_BW, height: OM_BH, rx: 5,
      fill: s.tone === "core" ? "rgba(14,116,144,.10)" : "#ffffff", stroke: col,
      "stroke-width": s.tone === "core" ? 1.8 : 1.2
    }));
    g.appendChild(T(s.x, s.y - 12, t.id, "om-id", { "text-anchor": "middle", fill: col }));
    g.appendChild(T(s.x, s.y + 7, t.name || "", "om-nm", { "text-anchor": "middle" }));
    const deg = rts.filter(r => (r.from || []).includes(t.id) || (r.to || []).includes(t.id)).length;
    g.appendChild(T(s.x, s.y + 24, `${(t.attributes || []).length} 个属性 · ${deg} 类关系`, "om-meta", { "text-anchor": "middle" }));
    const ti = el("title");
    ti.textContent = `${t.id} ${t.name}\n${t.definition || ""}\n身份：${t.identity || ""}`;
    g.appendChild(ti);
    svg.appendChild(g);
    if (opt.anchor === t.id) {                      // 问题锚点（本体元数据里声明，不在此硬编码）
      g.appendChild(el("rect", { x: s.x - 30, y: s.y + OM_BH / 2 + 5, width: 60, height: 15, rx: 2,
        fill: "rgba(180,83,9,.08)", stroke: "rgba(180,83,9,.42)", "stroke-width": .8 }));
      g.appendChild(T(s.x, s.y + OM_BH / 2 + 15.5, "问题锚点", "om-mini", { "text-anchor": "middle", fill: "var(--amber)" }));
    }
  });
  return svg;
}

/* ── 6b. 本体谱系（对象实例链 + 本体关系）──────────────────────────────── */
/** tr: 后端 GET /trace/cell 的返回值。这里只按它给的对象与关系排版，不自行推断任何事实。
 *  竖排主干＝业务链（发现依据 → 小区 → 工单 → 方案 → 效果 → 案例），
 *  左右两列＝上下文与校验对象（站点／天线／区域／邻区／根因依据／受影响小区／保护指标小区）。 */
const LIN_SLOTS = {
  cell:     { x: 470, y: 44,  w: 300, h: 60, t: "目标小区" },
  ticket:   { x: 470, y: 124, w: 300, h: 60, t: "工单" },
  plan:     { x: 470, y: 204, w: 300, h: 60, t: "方案" },
  effect:   { x: 470, y: 284, w: 300, h: 60, t: "效果" },
  case:     { x: 470, y: 364, w: 300, h: 60, t: "案例" },
  neighbor: { x: 140, y: 44,  w: 240, h: 60, t: "邻区／重叠覆盖" },
  mr:       { x: 140, y: 124, w: 240, h: 60, t: "发现依据" },
  evidence: { x: 140, y: 204, w: 240, h: 60, t: "根因依据" },
  scope:    { x: 140, y: 284, w: 240, h: 60, t: "受影响小区" },
  protect:  { x: 140, y: 364, w: 240, h: 60, t: "保护指标小区" },
  site:     { x: 800, y: 44,  w: 240, h: 60, t: "站点" },
  antenna:  { x: 800, y: 124, w: 240, h: 60, t: "天线" },
  area:     { x: 800, y: 204, w: 240, h: 60, t: "区域" }
};
const LIN_ROLE_COLOR = {
  cell: "var(--cyan)", ticket: "var(--k-a)", plan: "var(--k-f)", effect: "var(--k-rule)", case: "var(--k-th)"
};
const LIN_EDGE_COLOR = {
  RT_05: "var(--cyan)", RT_17: "var(--cyan)", RT_09: "var(--cyan)", RT_11: "var(--cyan)", RT_12: "var(--cyan)", RT_14: "var(--cyan)",
  RT_08: "var(--k-f)", RT_10: "var(--k-f)", RT_13: "var(--k-f)", RT_06: "var(--k-f)"
};
export function ontologyLineage(tr) {
  const lin = tr?.lineage;
  const W = 1060, H = 436;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", style: "width:100%;height:auto" });
  if (!lin || !lin.nodes?.length) {
    svg.appendChild(T(W / 2, H / 2, "该小区还没有牵出任何对象实例", "lbl", { "text-anchor": "middle" }));
    return svg;
  }
  // 同一角色的实例并进一个框（MR 有 7 条、邻区有若干条，逐个画会糊）
  const byRole = new Map();
  lin.nodes.forEach(n => {
    if (!byRole.has(n.role)) byRole.set(n.role, []);
    byRole.get(n.role).push(n);
  });
  const roleOf = {};
  lin.nodes.forEach(n => { roleOf[n.ot + ":" + n.id] = n.role; });
  const boxes = [];
  byRole.forEach((list, role) => {
    const s = LIN_SLOTS[role]; if (!s) return;
    const x = s.x - s.w / 2, y = s.y - s.h / 2;
    const col = LIN_ROLE_COLOR[role] || "var(--ink-3)";
    const main = ["cell", "ticket", "plan", "effect", "case"].includes(role);
    const g = el("g");
    g.appendChild(el("rect", {
      x, y, width: s.w, height: s.h, rx: 4,
      fill: main ? "rgba(8,145,178,.06)" : "rgba(100,116,139,.05)",
      stroke: main ? col : "rgba(100,116,139,.4)", "stroke-width": main ? 1.2 : 1,
      "stroke-dasharray": main ? "" : "3 2"
    }));
    g.appendChild(T(s.x, y + 17, s.t, "lbl-b", { "text-anchor": "middle", fill: main ? col : "var(--ink-2)", "font-size": "10.5px" }));
    const names = list.map(n => n.label);
    const show = names.slice(0, 2);
    show.forEach((nm, i) => g.appendChild(T(s.x, y + 32 + i * 12, nm.length > 20 ? nm.slice(0, 19) + "…" : nm, "lbl", { "text-anchor": "middle", "font-size": "9px", fill: "var(--ink-3)" })));
    if (names.length > show.length) g.appendChild(T(s.x, y + 32 + show.length * 12, `等 ${names.length} 个`, "lbl", { "text-anchor": "middle", "font-size": "8.5px", fill: "var(--ink-4)" }));
    g.appendChild(T(s.x + s.w / 2 - 5, y + s.h - 5, list[0].ot, "lbl", { "text-anchor": "end", "font-size": "8px", fill: "var(--ink-4)" }));
    const ti = el("title"); ti.textContent = list.map(n => `${n.ot}：${n.label}${n.note ? "（" + n.note + "）" : ""}`).join("\n");
    g.appendChild(ti);
    svg.appendChild(g);
    boxes.push({ role, ...s, list });
  });
  // 关系连线：标注 RT 编号，方向写在标签里（不画箭头，避免与本体方向相反时产生误读）
  const seen = new Set();
  (lin.edges || []).forEach(e => {
    const ra = roleOf[e.from], rb = roleOf[e.to];
    if (!ra || !rb || ra === rb) return;
    const a = boxes.find(b => b.role === ra), b = boxes.find(b2 => b2.role === rb);
    if (!a || !b) return;
    const key = [ra, rb, e.rt].join("|");
    if (seen.has(key)) return; seen.add(key);
    // 锚点取框的边界，不从框心拉线
    let p1, p2, side = false;
    if (Math.abs(a.x - b.x) < 30) {
      const up = b.y < a.y;
      // 同列但跨了不止一格（如 RT_12 效果→小区）：从框右侧绕出去，不穿过中间的框
      if (Math.abs(a.y - b.y) > 100) {
        side = true;
        const sx = Math.max(a.x + a.w / 2, b.x + b.w / 2) + 26;
        p1 = { x: sx, y: a.y }; p2 = { x: sx, y: b.y };
      } else {
        p1 = { x: a.x, y: a.y + (up ? -a.h / 2 : a.h / 2) };
        p2 = { x: b.x, y: b.y + (up ? b.h / 2 : -b.h / 2) };
      }
    } else {
      const right = b.x > a.x;
      p1 = { x: a.x + (right ? a.w / 2 : -a.w / 2), y: a.y };
      p2 = { x: b.x + (right ? -b.w / 2 : b.w / 2), y: b.y };
    }
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x, dy = p2.y - p1.y, len = Math.hypot(dx, dy) || 1;
    const bow = side ? 34 : Math.min(34, len * .18);
    const c = { x: mx - dy / len * bow, y: my + dx / len * bow };
    const col = LIN_EDGE_COLOR[e.rt] || "rgba(100,116,139,.55)";
    svg.appendChild(el("path", { d: `M${p1.x} ${p1.y} Q${c.x} ${c.y} ${p2.x} ${p2.y}`, fill: "none", stroke: col, "stroke-width": 1.1, "stroke-dasharray": e.derived ? "4 3" : "", opacity: .85 }));
    const lx = (p1.x + 2 * c.x + p2.x) / 4, ly = (p1.y + 2 * c.y + p2.y) / 4;
    const tg = el("g");
    tg.appendChild(el("rect", { x: lx - 21, y: ly - 7, width: 42, height: 13, rx: 2.5, fill: "#ffffff", stroke: col, "stroke-width": .7, opacity: .96 }));
    tg.appendChild(T(lx, ly + 3, e.rt, "lbl", { "text-anchor": "middle", "font-size": "8px", fill: col }));
    const ti = el("title"); ti.textContent = `${e.rt} ${e.name || ""}：${e.note || ""}\n${e.from} → ${e.to}${e.derived ? "（派生，不落库）" : ""}`;
    tg.appendChild(ti);
    svg.appendChild(tg);
  });
  // 图例
  const lg = [["主线（工单—方案—效果—案例）", "var(--cyan)"], ["校验／周边（RT_08/10/13）", "var(--k-f)"], ["上下文（RT_01/02/03/04）", "rgba(100,116,139,.7)"]];
  let lx = 24;
  lg.forEach(([txt, col]) => {
    svg.appendChild(el("line", { x1: lx, y1: H - 14, x2: lx + 22, y2: H - 14, stroke: col, "stroke-width": 1.6 }));
    svg.appendChild(T(lx + 28, H - 11, txt, "lbl", { "font-size": "8.5px", fill: "var(--ink-4)" }));
    lx += 40 + txt.length * 8;
  });
  svg.appendChild(T(W - 16, H - 11, "虚线＝派生关系（RT_03 邻区，不落库）", "lbl", { "text-anchor": "end", "font-size": "8.5px", fill: "var(--ink-4)" }));
  return svg;
}

/* ── 7. 状态轨道 ───────────────────────────────────────────────────────── */
export function stateTrack(status, states) {
  const order = states || ["待核验", "已确认", "处置中", "待评估", "已改善", "已关闭"];
  const i = order.indexOf(status);
  return `<div class="track">${order.map((s, k) => {
    const cls = k < i ? "done" : k === i ? "cur" : "";
    return `<div class="track-node ${cls}"><span class="track-dot"></span><span class="track-l">${esc(s)}</span></div>` + (k < order.length - 1 ? `<div class="track-link"></div>` : "");
  }).join("")}</div>`;
}

/* ── 8. 迷你折线（诊断/指标趋势）──────────────────────────────────────── */
export function sparkline(values, opt = {}) {
  const W = opt.w || 120, H = opt.h || 26, col = opt.color || "var(--cyan)";
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet", style: "width:100%;height:auto" });
  const vs = (values || []).filter(v => typeof v === "number");
  if (vs.length < 2) return svg;
  const mn = Math.min(...vs), mx = Math.max(...vs), rg = (mx - mn) || 1;
  const px = i => 2 + i * (W - 4) / (vs.length - 1);
  const py = v => H - 3 - ((v - mn) / rg) * (H - 8);
  svg.appendChild(el("polyline", { points: vs.map((v, i) => `${px(i)},${py(v)}`).join(" "), fill: "none", stroke: col, "stroke-width": 1.4 }));
  svg.appendChild(el("circle", { cx: px(vs.length - 1), cy: py(vs[vs.length - 1]), r: 2.2, fill: col }));
  return svg;
}

/* ── 9. 小区卡片上的逐日 MR 条（发现窗口 7 天）────────────────────────── */
/** daily: [{date, ratio, hit}]；三态取自后端 F_05/F_06 的判定，前端不改判定 */
export function mrStrip(daily, rule = {}, opt = {}) {
  const W = opt.w || 268, H = opt.h || 40, PL = 3, PR = 3, PT = 4, PB = 11;
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", style: "width:100%;height:" + H + "px" });
  const defs = el("defs");
  const g1 = el("linearGradient", { id: "gStrip", x1: 0, y1: 0, x2: 0, y2: 1 });
  g1.appendChild(el("stop", { offset: "0%", "stop-color": "rgba(8,145,178,.62)" }));
  g1.appendChild(el("stop", { offset: "100%", "stop-color": "rgba(8,145,178,.12)" }));
  const g2 = el("pattern", { id: "gStripWarn", width: 5, height: 5, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  g2.appendChild(el("rect", { width: 5, height: 5, fill: "rgba(180,83,9,.06)" }));
  g2.appendChild(el("line", { x1: 0, y1: 0, x2: 0, y2: 5, stroke: "rgba(180,83,9,.42)", "stroke-width": 1.5 }));
  defs.appendChild(g1); defs.appendChild(g2); svg.appendChild(defs);
  if (!daily || !daily.length) { svg.appendChild(T(W / 2, H / 2, "窗口内无 MR 数据", "lbl", { "text-anchor": "middle" })); return svg; }
  const thr = typeof rule.minWeakRatio === "number" ? rule.minWeakRatio : null;
  const max = Math.max(thr ? thr * 1.5 : .3, ...daily.map(d => d.ratio || 0)) * 1.1;
  const iw = W - PL - PR, ih = H - PT - PB, n = daily.length, gap = 2, bw = Math.max(3, iw / n - gap);
  const y = v => PT + ih - (v / max) * ih;
  if (thr !== null) svg.appendChild(el("line", { x1: PL, y1: y(thr), x2: W - PR, y2: y(thr), stroke: "var(--amber)", "stroke-width": 1, "stroke-dasharray": "3 2", opacity: .8 }));
  daily.forEach((d, i) => {
    const x = PL + i * (iw / n) + gap / 2;
    if (d.hit === "未知") {   // 缺天：斜纹占满，不是零高度，也不是灰色
      svg.appendChild(el("rect", { x, y: PT, width: bw, height: ih, fill: "url(#gStripWarn)", stroke: "rgba(180,83,9,.5)", "stroke-width": .8 }));
      return;
    }
    const v = d.ratio || 0, yy = y(v), h = Math.max(1.5, PT + ih - yy);
    if (d.hit === "是") svg.appendChild(el("rect", { x, y: yy, width: bw, height: h, rx: 1, fill: "url(#gStrip)", stroke: "var(--cyan)", "stroke-width": .9 }));
    else svg.appendChild(el("rect", { x, y: yy, width: bw, height: h, rx: 1, fill: "rgba(100,116,139,.16)", stroke: "rgba(100,116,139,.5)", "stroke-width": .8, "stroke-dasharray": "2 1.5" }));
  });
  svg.appendChild(T(PL, H - 2, dayTxt(daily[0].date).slice(5), "lbl", { "font-size": "8px" }));
  svg.appendChild(T(W - PR, H - 2, dayTxt(daily[daily.length - 1].date).slice(5), "lbl", { "text-anchor": "end", "font-size": "8px" }));
  return svg;
}
