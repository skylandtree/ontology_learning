/* ============================================================================
   ui.js —— 界面通用片段（面板、键值表、判定徽章）
   视图与流程页共用；这里只拼装 HTML，不含任何业务判定。
   ========================================================================== */
import { esc, verdictClass } from "./core.js";

export const panel = (title, sub, body, cls = "") => `
  <section class="panel ${cls}">
    <div class="panel-hd"><h3>${esc(title)}</h3>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}<span class="spacer"></span></div>
    <div class="panel-bd">${body}</div>
  </section>`;

export const panelTight = (title, sub, body) => `
  <section class="panel">
    <div class="panel-hd"><h3>${esc(title)}</h3>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}<span class="spacer"></span></div>
    <div class="panel-bd tight">${body}</div>
  </section>`;

export const empty = (t, s = "") => `<div class="note">${esc(t)}${s ? `<br><span class="tiny dim">${esc(s)}</span>` : ""}</div>`;
export const loading = () => `<div class="loading">载入中 …</div>`;
export const kv = rows => `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
export const vchip = v => `<span class="verdict ${verdictClass(v)}">${esc(v ?? "—")}</span>`;
