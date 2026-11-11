// OSDK 错误码字典：通用码取自《OSDK REST API 规范 v1.0》第 11 节；主体码取自 SPEC 的约束与动作失败约定
// （INV_01～INV_17、STATE、REVIEW_REQUIRED 等），两者都由 GET /api/v1/osdk/errorCodes 返回，调用方可按 errorCode 分支。
const crypto = require("node:crypto");

const GENERIC = [
  { code: 1001, errorCode: "INVALID_FIELD", status: 400, description: "where／select／orderBy 含未知字段或操作符" },
  { code: 1002, errorCode: "OBJECT_NOT_FOUND", status: 404, description: "对象不存在（get／update／delete）" },
  { code: 1003, errorCode: "NO_CONFIG", status: 500, description: "配置缺失（无数据源或主键定义）" },
  { code: 1004, errorCode: "METHOD_NOT_FOUND", status: 404, description: "锚点方法不存在" },
  { code: 1004, errorCode: "OSDK_FUNCTION_NOT_FOUND", status: 404, description: "Function 不存在" },
  { code: 1004, errorCode: "OSDK_ACTION_NOT_FOUND", status: 404, description: "Action 不存在" },
  { code: 1005, errorCode: "GROOVY_EXEC_FAILED", status: 500, description: "Groovy 脚本执行异常" },
  { code: 1005, errorCode: "OSDK_FUNCTION_TYPE_UNSUPPORTED", status: 400, description: "Function 类型不支持执行" },
  { code: 1006, errorCode: "NOT_IMPLEMENTED", status: 501, description: "本实现不提供的平台能力（如 Groovy 脚本引擎）" },
  { code: 1007, errorCode: "INVALID_PARAMETER", status: 400, description: "函数或动作入参缺失／非法" },
  { code: 1008, errorCode: "UNAUTHENTICATED", status: 401, description: "缺认证头（currentnetuserid／x-sys-code）" },
  { code: 1500, errorCode: "INTERNAL_ERROR", status: 500, description: "服务内部异常（非调用方可修正的问题）" },
  { code: 403, errorCode: "ROW_FILTER_DENIED", status: 403, description: "行级过滤策略缺失导致拒绝" },
  { code: 403, errorCode: "FIELD_MUTATION_BLOCKED", status: 403, description: "字段被行级过滤锁定，禁止修改" }
];

// 主体拒绝码：数值码 1101 起连续编号，HTTP 状态按类给出
const DOMAIN_STATUS = { PERMISSION_DENIED: 403, NOT_FOUND: 404, DEFINED_ONLY: 409, ACTION_REQUIRED: 403, SUPERVISOR_REQUIRED: 409 };
const DOMAIN = ["PERMISSION_DENIED", "NOT_FOUND", "STATE", "REVIEW_REQUIRED", "ROUND_IN_PROGRESS", "STALE_FACTS",
  "NOT_MATCHED", "NOT_SUPPORTED", "APPLICABILITY_REQUIRED", "DEFINED_ONLY", "ACTION_REQUIRED",
  ...Array.from({ length: 17 }, (_, i) => "INV_" + String(i + 1).padStart(2, "0")),
  "SUPERVISOR_REQUIRED"];   // 追加在末尾：不改动既有 INV_xx 的数值码

// 个别主体码补一句可读说明（其余统一指向 SPEC 的核心约束／动作失败约定）
const DOMAIN_DESC = {
  SUPERVISOR_REQUIRED: "作用于 2 个及以上小区或 VIP／VVIP 场景，须追加优化主管批准（A_05）",
  ACTION_REQUIRED: "该对象类型只能由本体动作写入，不走对象写接口（工单／方案／效果／案例）",
  DEFINED_ONLY: "该动作本期只定义、不运行（如 A_10 回退方案）",
  STALE_FACTS: "方案所依据的工参已变化，退回草案重算，不覆盖既有记录"
};

const REGISTRY = [
  ...GENERIC,
  ...DOMAIN.map((errorCode, i) => ({ code: 1101 + i, errorCode, status: DOMAIN_STATUS[errorCode] || 409, description: DOMAIN_DESC[errorCode] || `${errorCode}：见 SPEC 的核心约束／动作失败约定` }))
];
const BY_CODE = Object.fromEntries(REGISTRY.map(e => [e.errorCode, e]));

const traceId = () => crypto.randomBytes(8).toString("hex");

class OsdkError extends Error {
  constructor(errorCode, message, details) {
    super(message || errorCode);
    const reg = BY_CODE[errorCode] || { code: 1100, errorCode, status: 409 };
    this.errorCode = reg.errorCode; this.code = reg.code; this.status = reg.status; this.details = details;
  }
}
function envelopeOk(data) { return { code: 0, message: "success", data, traceId: traceId() }; }
function envelopeError(e) {
  // 未归类的异常按服务内部错误返回（不假装是入参问题）
  const reg = e instanceof OsdkError ? e : new OsdkError("INTERNAL_ERROR", String(e && e.message || e));
  const body = { error: true, code: reg.code, status: reg.status, message: reg.message, errorCode: reg.errorCode, traceId: traceId() };
  if (reg.details !== undefined) body.details = reg.details;
  return { status: reg.status, body };
}
module.exports = { REGISTRY, BY_CODE, OsdkError, envelopeOk, envelopeError, traceId };
