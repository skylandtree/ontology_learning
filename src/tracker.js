// 覆盖追踪：记录本体要素（对象类型、关系、函数、动作、约束、规则、测试假设）在决策场景、问答场景中被实际用到的情况。
// kind∈OT／RT／F／A／INV／RULE／TH；ctx∈decision／qa／test；INV 另记 pass／violation。
class Tracker {
  constructor() { this.ctx = "test"; this.hits = new Map(); this.scene = null; this.tap = null; }
  hit(kind, id, detail) {
    const k = `${kind}|${id}`;
    if (!this.hits.has(k)) this.hits.set(k, { kind, id, ctx: new Set(), scenes: new Set(), detail: new Set(), detailCtx: new Set() });
    const h = this.hits.get(k); h.ctx.add(this.ctx); if (this.scene) h.scenes.add(this.scene); if (detail) { h.detail.add(detail); h.detailCtx.add(this.ctx + ":" + detail); }
    // 可选挂钩：按调用顺序拿到"这一次用到了哪些本体要素"（自主决策链用它记录推理过程）。
    // 只旁听，不改变覆盖统计；回调出错不影响主流程。
    if (this.tap) { try { this.tap(kind, id, detail); } catch { /* 记录失败不影响判定 */ } }
  }
  has(kind, id, ctx) { const h = this.hits.get(`${kind}|${id}`); return !!h && (!ctx || h.ctx.has(ctx)); }
  with(ctx, scene, fn) { const a = [this.ctx, this.scene]; this.ctx = ctx; this.scene = scene; try { return fn(); } finally { [this.ctx, this.scene] = a; } }
  async withAsync(ctx, scene, fn) { const a = [this.ctx, this.scene]; this.ctx = ctx; this.scene = scene; try { return await fn(); } finally { [this.ctx, this.scene] = a; } }
}
module.exports = { Tracker, tracker: new Tracker() };
