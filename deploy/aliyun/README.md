# 阿里云部署

本应用独立运行在 `shwo-ontology-app` 容器中，Node.js 24，宿主机只监听
`127.0.0.1:27080`。现有 HTTPS Nginx 将 `/ontology/` 转发至此端口，
该路径使用独立的 HTTP Basic 登录；已有站点的其他路径保留原路由。

前端从模块 URL 推导应用路径，因此本地 `http://127.0.0.1:27080/` 与
云端 `https://服务器IP/ontology/` 均可使用。Nginx 必须保留入口末尾 `/`，
`proxy_pass` 末尾的 `/` 用于去除转发路径前缀；SSE 禁用代理缓冲。

服务器目录：

- `/opt/shwo-ontology/releases/<发布编号>/`：每次部署的独立源码目录。
- `/opt/shwo-ontology/current`：当前源码目录的符号链接。
- `/opt/shwo-ontology/config/llm.config.json`：私有模型配置，只读挂载，不进镜像。
- `/opt/shwo-ontology/compose.yaml` 和 `.env`：运行配置及当前镜像标签。
- `/etc/dads-everyday/ontology.htpasswd`：独立访问账号的密码散列。
- `/var/backups/shwo-ontology/<发布编号>/`：部署前代理配置与服务状态快照。

首次构建、验证和启动（在服务器上执行；模型配置须先单独上传）：

```sh
docker build --pull=false -f deploy/aliyun/Dockerfile -t shwo-ontology:<发布编号> .
docker run --rm --network none --memory 256m shwo-ontology:<发布编号> npm test
cd /opt/shwo-ontology
docker compose up -d
curl --fail http://127.0.0.1:27080/__health
docker exec dads-everyday-proxy nginx -t
docker exec dads-everyday-proxy nginx -s reload
```

完整测试需要在测试容器中监听回环地址，不应使用 `--read-only`；测试不会
调用真实模型接口。运行容器使用只读文件系统和内存数据库，无需数据库卷。

日常维护：

```sh
cd /opt/shwo-ontology
docker compose ps
docker compose logs --tail 100 app
docker compose restart app
```

更新时先保留旧镜像、`.env` 和当前链接目标，再构建并测试新镜像。
将 `.env` 的 `ONTOLOGY_IMAGE` 切换至新标签后运行 `docker compose up -d`。
回退时恢复旧标签及链接目标，再运行相同命令。首次部署需要撤除时，仅移除
本体应用的容器、Nginx 中 `/ontology` 的两段 location 和其密码散列文件，
确认 `nginx -t` 通过后 reload；保留其他应用、数据库、数据卷及证书配置。

模型配置沿用本机的语义引擎设置，密钥通过 SSH 单独传输。模型配置目录需允许
容器 UID 1000 读取；部署使用目录权限 750、文件权限 640、属主 root:1000。
访问账号的明文密码只存于本地交付的访问说明，不写入镜像或此文档。

当前仍是仿真应用：SQLite 在内存中，服务重启会恢复种子数据。
0.4 起各分析使用独立的运行时、仿真时钟、工参与审计，默认每次点击小区即创建
新的独立分析，无需手动重置。页面“重置”只重置本次分析；其他访问者保持原状态。
“连续分析”仍可保留本轮案例与工单，原 OSDK 业务规则和不带分析标识的调用保持兼容。
运行时最多保留 12 个分析，关闭页面或开始新分析会释放旧分析；空闲一小时的分析
在后续创建时回收。服务更新后，浏览器刷新页面会自动创建新的独立分析。
