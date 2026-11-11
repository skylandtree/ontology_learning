// spec/ 下可并存多个 SPEC 版本；取版本号最高的一份（生成本体与测试用同一份，避免"读到哪一份"取决于目录返回顺序）。
const fs = require("node:fs"), path = require("node:path");
const specDir = path.join(__dirname, "..", "spec");
const verOf = f => (f.match(/V(\d+)\.(\d+)/) || [0, 0, 0]).slice(1).map(Number);
function specFile() {
  const f = fs.readdirSync(specDir).filter(x => x.endsWith(".md"))
    .sort((a, b) => { const [am, an] = verOf(a), [bm, bn] = verOf(b); return am - bm || an - bn; }).pop();
  if (!f) throw new Error("spec/ 下没有 SPEC 文件");
  return f;
}
module.exports = { specDir, specFile };
