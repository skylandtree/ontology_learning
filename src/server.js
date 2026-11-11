// 本体后端服务入口：OSDK REST 接口（规范见 OSDK-REST-API-发布规范.md）。
// 启动：node src/server.js --port 27072
// 认证头：currentnetuserid（用户）、x-sys-code（系统+租户）、x-context-key-groups（角色，逗号分隔，可 URL 编码）。
const { createServer } = require("./osdk/http.js");
const { BASE } = require("./osdk/service.js");

if (require.main === module) {
  const port = +(process.argv[process.argv.indexOf("--port") + 1] || 27072), s = createServer();
  s.listen(port, () => {
    console.log(`OSDK 本体服务：http://localhost:${port}${BASE}`);
    console.log(`示例：curl "${"http://localhost:" + port}${BASE}/api/v1/osdk/ontologies" -H "x-sys-code: data" -H "currentnetuserid: test-user"`);
    console.log("数据为本地仿真副本（MR、工参、告警、派单），不连接真实网络。");
  });
}
module.exports = { createServer, BASE };
