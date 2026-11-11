// 来源数据逐字抄录：data/副本上海工单.xlsx（三个 Sheet）与 data/覆盖问题汇总_4g&5g.xlsx → data/source/*.json
// 只抄录、不改写、不推断（换行统一为 \n）；解析与映射在 src/parse.js。
// 需要 xlsx 模块（默认取 ../tmp/_readxlsx/node_modules/xlsx，可用 XLSX_MODULE 指定）；抄录结果已入库，运行应用不需要本脚本。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "..", "data");
const XLSX = require(process.env.XLSX_MODULE || path.join(ROOT, "..", "tmp", "_readxlsx", "node_modules", "xlsx"));
const clean = (v) => (v === null || v === undefined ? null : typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : v);

function sheetRows(file, sheet) {
  const wb = XLSX.readFile(file), ws = wb.Sheets[sheet];
  const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, blankrows: false }).filter(r => r.some(v => v !== null && v !== ""));
  const header = arr[0].map((h, i) => clean(h) || `_col${i + 1}`);
  return { header, rows: arr.slice(1).map((r, i) => ({ _row: i + 2, ...Object.fromEntries(header.map((h, j) => [h, clean(r[j])])) })) };
}

// 1) 上海工单：工单清单 + 自优化闭环 + 人工闭环
const TK = path.join(DATA, "副本上海工单.xlsx");
const list = sheetRows(TK, "工单"), auto = sheetRows(TK, "自优化闭环"), manual = sheetRows(TK, "人工闭环");
const tickets = {
  _source: "data/副本上海工单.xlsx（Sheet：工单、自优化闭环、人工闭环），逐字抄录",
  _note: "人工闭环 Sheet 第15列无表头（内容为【优化措施及实施情况】），抄录时记为 _col15；工单 Sheet 的“装填”列即闭环状态",
  headers: { 工单: list.header, 自优化闭环: auto.header, 人工闭环: manual.header },
  工单: list.rows, 自优化闭环: auto.rows, 人工闭环: manual.rows
};
fs.writeFileSync(path.join(ROOT, "data", "source", "shanghai_tickets.json"), JSON.stringify(tickets, null, 1));

console.log(`工单 ${list.rows.length} 张；自优化闭环 ${auto.rows.length} 行；人工闭环 ${manual.rows.length} 行 → data/source/shanghai_tickets.json`);
