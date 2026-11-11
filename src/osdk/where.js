// where 条件编译：把 OSDK 的 where 对象编译成对对象文档的判定函数，同时校验字段与操作符（附录 A）。
// 简化写法 "status": "ACTIVE" 等价于 {"status":{"eq":"ACTIVE"}}；{eq:null}→值为空，{ne:null}→有值。
const { OsdkError } = require("./errors.js");

const OPS = ["eq", "ne", "in", "nin", "like", "nlike", "gt", "gte", "lt", "lte"];
const isNil = v => v === null || v === undefined;
const like = (v, p) => {
  const rx = new RegExp("^" + String(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
  return rx.test(String(v));
};
const cmp = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)));

function test(field, op, want) {
  return doc => {
    const v = doc[field];
    switch (op) {
      case "eq": return isNil(want) ? isNil(v) : !isNil(v) && String(v) === String(want) || v === want;
      case "ne": return isNil(want) ? !isNil(v) : !(String(v) === String(want) || v === want);
      case "in": return (want || []).some(x => isNil(x) ? isNil(v) : String(x) === String(v) || x === v);
      case "nin": return !(want || []).some(x => isNil(x) ? isNil(v) : String(x) === String(v) || x === v);
      case "like": return !isNil(v) && like(v, want);
      case "nlike": return isNil(v) || !like(v, want);
      case "gt": return !isNil(v) && cmp(v, want) > 0;
      case "gte": return !isNil(v) && cmp(v, want) >= 0;
      case "lt": return !isNil(v) && cmp(v, want) < 0;
      case "lte": return !isNil(v) && cmp(v, want) <= 0;
      default: return false;
    }
  };
}
// fields：该对象类型允许出现在 where／select／orderBy 里的字段名
function compile(where, fields, what = "where") {
  if (where === undefined || where === null) return () => true;
  if (typeof where !== "object" || Array.isArray(where)) throw new OsdkError("INVALID_FIELD", `${what} 应为对象`);
  const preds = [];
  for (const [field, cond] of Object.entries(where)) {
    if (!fields.includes(field)) throw new OsdkError("INVALID_FIELD", `${what} 含未知字段：${field}`);
    if (cond !== null && typeof cond === "object" && !Array.isArray(cond)) {
      const ops = Object.keys(cond);
      if (!ops.length) throw new OsdkError("INVALID_FIELD", `${what}.${field} 未给出操作符`);
      for (const op of ops) {
        if (!OPS.includes(op)) throw new OsdkError("INVALID_FIELD", `${what}.${field} 含未知操作符：${op}`);
        preds.push(test(field, op, cond[op]));
      }
    } else preds.push(test(field, "eq", cond));
  }
  return doc => preds.every(p => p(doc));
}
function checkFields(list, fields, what) {
  for (const f of list || []) if (!fields.includes(f)) throw new OsdkError("INVALID_FIELD", `${what} 含未知字段：${f}`);
  return list || [];
}
module.exports = { compile, checkFields, OPS };
