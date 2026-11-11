// Web 聚合、分析隔离和原 OSDK 业务结果的一致性回归；不调用真实模型。
require('./model-isolated.js');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const { handle } = require('../web/server.js');
const { createApp } = require('../src/app.js');
const { Tracker } = require('../src/tracker.js');
const { createService } = require('../src/osdk/service.js');
const API = '/agent-onto-harness/api/v1/osdk/shwo-weak-coverage';
const START = '2026-09-11T09:00:00', CELL = 'LTE:156514014';
const headers = { currentnetuserid: 'web-test', 'x-sys-code': 'data', 'x-context-key-groups': encodeURIComponent('地市优化工程师') };
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const ok = (value, label) => { assert.ok(value, label); checks++; };

(async () => {
  const server = http.createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = `http://127.0.0.1:${server.address().port}`;
  const owned = new Set();
  async function request(path, { id, method = 'GET', body, auth = true, extraHeaders } = {}) {
    const r = await fetch(root + path, { method, headers: { ...(auth ? headers : {}), ...(id ? { 'x-analysis-id': id } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, headers: r.headers, body: text ? JSON.parse(text) : null };
  }
  const start = async includeDefinition => {
    const r = await request('/__analysis', { method: 'POST', body: { includeDefinition } });
    eq(r.status, 200, '创建独立分析'); owned.add(r.body.id); return r.body;
  };
  const data = async (id, suffix, body) => {
    const r = await request(API + suffix, { id, method: body ? 'POST' : 'GET', body });
    eq(r.status, 200, suffix); return r.body.data;
  };
  const summary = async id => (await request('/__summary', { id })).body;
  try {
    eq((await request('/__analysis', { method: 'POST', body: {}, auth: false })).status, 401, '聚合入口保留 OSDK 鉴权');
    const a = await start(true), b = await start(false);
    ok(a.id !== b.id, '每次分析标识不同');
    eq(a.bootstrap.clock, START, '独立分析的起始判断时点');
    eq(b.bootstrap.clock, START, '另一分析不沿用时点');
    eq(a.bootstrap.definition.objectTypes.length, 9, '本体定义来自原接口');
    eq(b.bootstrap.definition, undefined, '已加载的静态本体可以复用');
    for (const type of Object.keys(a.bootstrap.counts)) {
      const query = await data(a.id, `/objects/${type}/query`, { limit: 1 });
      eq(a.bootstrap.counts[type], query.totalCount, '聚合统计与正式查询一致：' + type);
    }
    const before = await request('/__cell-context?cell=' + encodeURIComponent(CELL), { id: a.id });
    const discover = await data(a.id, '/functions/F_06/execute', { params: { cellKey: CELL, refTime: START } });
    eq(before.body.ctx.discover, discover.result, '聚合详情不另作发现判定');
    eq(before.body.ctx.ticket, null, '初始未建工单');
    const expectedApp = createApp({ tracker: new Tracker(), at: START });
    const expectedService = createService(expectedApp);
    const expected = await expectedService.dispatch({ method: 'POST', path: API + '/chain/run', headers, body: { cellKey: CELL }, query: new URLSearchParams() });
    const completed = await data(a.id, '/chain/run', { cellKey: CELL });
    eq(completed, JSON.parse(JSON.stringify(expected.body.data)), '快速整链与原 OSDK 的完整业务结果逐项一致');
    expectedApp.store.close();
    eq(completed.outcome, 'completed', '原崇明七步链完整闭环');
    ok(completed.clock.to > START, '分析确实推进了仿真时钟');
    const after = await request('/__cell-context?cell=' + encodeURIComponent(CELL), { id: a.id });
    eq(after.body.ctx.ticket.ticketNo, completed.artifacts.ticketNo, '详情读取本轮工单');
    eq(after.body.ctx.plan.planNo, completed.artifacts.planNo, '详情读取本轮方案');
    eq(after.body.ctx.effect.effectNo, completed.artifacts.effectNo, '详情读取本轮效果');
    eq(after.body.ctx.cases[0].caseNo, completed.artifacts.caseNo, '详情保留案例库');
    eq(after.body.ctx.scanRef, '2026-09-11T09:00:00', '已建工单仍使用原发现快照');
    eq(after.body.clock, (await data(a.id, '/sim/clock')).now, '上下文使用动作审计结束后的真实时点');
    for (const n of [1, 2, 3, 4, 5, 6, 7]) ok(completed.steps.find(step => step.n === n).trace.length > 0, '步骤推理保留：' + n);
    const statsA = await summary(a.id);
    eq(statsA.counts.OT_CASE, 1, '已闭环分析保留入库案例');
    eq(statsA.auditRuns.length, (await data(a.id, '/audit/runs', undefined)).items.length, '聚合审计不漏动作');
    const untouched = await request('/__cell-context?cell=' + encodeURIComponent(CELL), { id: b.id });
    eq(untouched.body.clock, START, '同小区另一分析不受已推进时点影响');
    eq(untouched.body.ctx.ticket, null, '同小区另一分析不继承工单');
    eq(untouched.body.ctx.antenna, before.body.ctx.antenna, '同小区另一分析不继承实施工参');
    eq((await summary(b.id)).counts.OT_CASE, 0, '案例写入不污染另一分析');
    const c = await start(false);
    const repeated = await data(c.id, '/chain/run', { cellKey: CELL });
    eq(repeated, completed, '不点击重置，重复独立分析结果与首次一致');
    const human = await start(false);
    const stopped = await data(human.id, '/chain/run', { cellKey: 'LTE:156574916' });
    eq(stopped.stop.step, 5, '人工接入小区仍停在缺少现场回报处');
    eq(stopped.stop.errorCode || stopped.stop.code, 'INV_07', '原回填约束不变');
    await request('/__reset', { id: b.id, method: 'POST' });
    eq((await summary(a.id)).counts.OT_CASE, 1, '重置另一分析不删除已完成案例');
    eq((await summary(b.id)).counts.OT_TICKET, 0, '重置只作用于当前分析');
    eq((await request('/__health', { id: 'invalid-id' })).status, 410, '失效标识明确失败，不回落共享状态');
    eq((await request('/__cell-context?cell=missing', { id: b.id })).status, 404, '不存在小区仍返回正式错误');
    eq((await request('/__summary', { id: b.id, auth: false })).status, 401, '统计保留鉴权');
    const stream = await fetch(root + API + '/qa/ask/stream', { method: 'POST', headers: { ...headers, 'x-analysis-id': b.id, 'content-type': 'application/json' }, body: JSON.stringify({ question: '派单规则是什么', readOnly: true, mode: 'rule' }) });
    const sse = await stream.text();
    eq(stream.status, 200, '独立分析的流式问答');
    ok(sse.includes('event: delta') && sse.includes('event: done'), 'SSE 增量与完成帧不变');
    eq((await summary(b.id)).auditRuns.length, 0, '只读问答不产生动作审计');
    await request('/__analysis', { id: b.id, method: 'DELETE' }); owned.delete(b.id);
    eq((await request('/__summary', { id: b.id })).status, 410, '已释放分析不能继续访问');
    eq((await summary(a.id)).counts.OT_CASE, 1, '释放分析不影响其他标识');
    const html = await fetch(root + '/');
    const etag = html.headers.get('etag');
    ok(etag, '静态资源提供内容校验标识');
    eq((await fetch(root + '/', { headers: { 'if-none-match': etag } })).status, 304, '静态资源可复用缓存');
    eq((await fetch(root + '/', { headers: { 'if-none-match': 'W/' + etag } })).status, 304, '兼容 HTTPS gzip 代理的弱 ETag');
    const text = await html.text();
    ok(text.includes('modulepreload'), '脚本依赖可提前并行加载');
    ok(text.includes('独立分析') && text.includes('连续分析') && text.includes('逐步演示'), '保留连续场景与演示选择');
    while (owned.size < 12) {
      const extra = await start(false);
      eq((await data(extra.id, '/chain/run', { cellKey: CELL })).outcome, 'completed', '容量内的独立分析仍可完整执行');
    }
    eq((await request('/__analysis', { method: 'POST', body: {} })).status, 503, '达到资源上限时明确拒绝，不删除其他分析');
    eq((await summary(a.id)).counts.OT_CASE, 1, '满载不覆盖已有案例');
    const releaseId = [...owned].pop();
    await request('/__analysis', { id: releaseId, method: 'DELETE' }); owned.delete(releaseId);
    await start(false);
    fs.writeFileSync('reports/web-regression.json', JSON.stringify({ passed: checks, failed: 0, peakRssMiB: Math.round(process.memoryUsage().rss / 1024 / 1024) }, null, 2));
    console.log(`Web 回归：${checks}/${checks} 通过（聚合一致性、业务规则、分析隔离、独立重跑、人工接入、SSE、缓存）`);
  } finally {
    for (const id of owned) await request('/__analysis', { id, method: 'DELETE' });
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
