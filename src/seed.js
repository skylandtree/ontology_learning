// 种子数据：data/seed/ 下按表分别存放的 CSV（UTF-8，带 BOM，可直接用 Excel 打开）。表头就是 SPEC 字段字典里的字段名。
// 这里定义每张表的列与类型，并负责读写；生成脚本和应用都用它，保证两边对得上。
const fs = require("node:fs"), path = require("node:path");

// 列类型：s 字符串，f 小数，i 整数，b 是／否
const TABLES = {
  sites:         { file: "sites.csv",          cols: { siteId: "s", siteType: "s", lifecycle: "s", lat: "f", lon: "f" } },
  antennas:      { file: "antennas.csv",       cols: { antennaId: "s", siteId: "s", height: "f", mechTilt: "f", supportsRET: "b", azimuth: "f", effectiveTime: "s" } },
  cells:         { file: "cells.csv",          cols: { cellKey: "s", cellName: "s", rat: "s", band: "s", sceneLevel: "s", rsPower: "f", rsPowerPlan: "f", targetRadius: "f", azimuthDeviationDeg: "f", obstructionEvidence: "s" } },
  neighbors:     { file: "cell_neighbors.csv", cols: { cellKey: "s", targetCellKey: "s", freqType: "s", overlapWeight: "f" } },
  cellSite:      { file: "cell_site.csv",      cols: { cellKey: "s", siteId: "s" } },
  cellAntenna:   { file: "cell_antenna.csv",   cols: { cellKey: "s", antennaId: "s", elecTilt: "f", vBeam: "f", arrayPort: "s", effectiveTime: "s" } },
  areas:         { file: "areas.csv",          cols: { areaId: "s", areaName: "s", areaScene: "s", areaLevel: "s", indoorOutdoor: "s", urbanRural: "s", district: "s" } },
  areaCells:     { file: "area_cells.csv",     cols: { areaId: "s", cellKey: "s", role: "s", share: "f" } },
  cellMR:        { file: "cell_mr.csv",        cols: { cellKey: "s", date: "s", sampleTotal: "i", sampleWeak: "i", receivedAt: "s" } },
  cellMetrics:   { file: "cell_metrics.csv",   cols: { cellKey: "s", name: "s", date: "s", value: "f", receivedAt: "s" } },
  alarms:        { file: "alarms.csv",         cols: { cell: "s", type: "s", startDate: "s", endDate: "s" } },
  // 以下三张是来源事实，不入本体：派单系统里的真实工单、现场回填记录、数据来源清单
  sourceTickets: { file: "source_tickets.csv", cols: { taskno: "s", district: "s", rat: "s", issue: "s", kpiName: "s", kpiValue: "f", cellName: "s", windowStart: "s", windowEnd: "s", closure: "s", inScope: "b", reason: "s" } },
  fieldExecutions: { file: "field_executions.csv", cols: { taskno: "s", cellName: "s", antennaId: "s", param: "s", fromValue: "f", toValue: "f", executeTime: "s", receivedAt: "s", executor: "s", receipt: "s" } },
  provenance:    { file: "provenance.csv",     cols: { entityType: "s", entityId: "s", origin: "s", note: "s" } },
};

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(x => x !== "")) rows.push(row); row = []; } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); if (row.some(x => x !== "")) rows.push(row); }
  return rows;
}
const esc = v => { const s = v === undefined || v === null ? "" : typeof v === "boolean" ? (v ? "是" : "否") : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (cols, rows) => "﻿" + [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n") + "\n";
const conv = (t, s) => { if (s === "" || s === undefined) return undefined; return t === "f" ? Number(s) : t === "i" ? parseInt(s, 10) : t === "b" ? s === "是" : s; };

function readTable(dir, name) {
  const T = TABLES[name], rows = parseCsv(fs.readFileSync(path.join(dir, T.file), "utf8")), head = rows[0], cols = Object.keys(T.cols);
  if (head.join() !== cols.join()) throw new Error(`${T.file} 表头应为 ${cols.join(",")}，实际 ${head.join(",")}`);
  return rows.slice(1).map(r => { const o = {}; cols.forEach((c, i) => { const v = conv(T.cols[c], r[i]); if (v !== undefined) o[c] = v; }); return o; });
}
// 读取全部 CSV，组装成应用使用的种子对象
function readSeed(dir) {
  dir = dir || path.join(__dirname, "..", "data", "seed");
  const d = Object.fromEntries(Object.keys(TABLES).map(k => [k, readTable(dir, k)]));
  const nb = {}; for (const n of d.neighbors) (nb[n.cellKey] = nb[n.cellKey] || []).push({ targetCellKey: n.targetCellKey, freqType: n.freqType, overlapWeight: n.overlapWeight });
  d.cells = d.cells.map(c => nb[c.cellKey] ? { ...c, neighbors: nb[c.cellKey] } : c);   // 没有邻区表行＝邻区未提供（未知）
  const byName = Object.fromEntries(d.cells.map(c => [c.cellName, c.cellKey]));
  d.sourceTickets = d.sourceTickets.map(t => ({ ...t, short: t.taskno.slice(0, 5), cellKey: byName[t.cellName] || null }));
  d.fieldExecutions = d.fieldExecutions.map(f => ({ ...f, cellKey: byName[f.cellName] || null }));
  d.provenance = Object.fromEntries(d.provenance.map(p => [p.entityId, `${p.origin}：${p.note}`]));
  delete d.neighbors; return d;
}
function writeSeed(dir, data) { fs.mkdirSync(dir, { recursive: true }); for (const [k, T] of Object.entries(TABLES)) fs.writeFileSync(path.join(dir, T.file), toCsv(Object.keys(T.cols), data[k])); }
module.exports = { TABLES, parseCsv, toCsv, readSeed, writeSeed };
