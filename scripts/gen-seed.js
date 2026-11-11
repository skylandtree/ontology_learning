// 生成种子数据 data/seed/*.csv（每张表一个文件，表头即 SPEC 字段字典里的字段名）。
// 真实事实从 data/source/shanghai_tickets.json（工单原文）解析；其余数据按真实网管数据的样子构造：小区标识用 ECI／NCI、站点用 eNB／gNB ID、
// 天线编号用“站点-扇区-序号”，MR 日统计的采样点数、占比逐日有波动，不出现整齐的整数。哪些是原文、哪些是构造，只记在 provenance.csv。
const fs = require("node:fs"), path = require("node:path");
const { writeSeed } = require("../src/seed.js");
const root = path.join(__dirname, ".."), src = JSON.parse(fs.readFileSync(path.join(root, "data/source/shanghai_tickets.json"), "utf8"));
const man = Object.fromEntries(src["人工闭环"].map(r => [r["工单编号"].slice(0, 5), r])), auto = Object.fromEntries(src["自优化闭环"].map(r => [r["工单编号"].slice(0, 5), r]));
const must = (m, what) => { if (!m) throw new Error("原文解析失败：" + what); return m; };

// ── 原文里的真实事实
const chm = man["SHCHM"], bao = auto["SHBAO"], yap = man["SHYAP"];
const covChm = +must(chm["icos根因结论"].match(/小区覆盖率为([\d.]+)%/), "SHCHM 覆盖率")[1] / 100, covBao = +must(bao["根因结论"].match(/小区覆盖率为([\d.]+)%/), "SHBAO 覆盖率")[1] / 100;
const hChm = +must(chm["原因分析及优化方案"].match(/站高(\d+)米/), "站高")[1], azChm = +must(chm["原因分析及优化方案"].match(/方位角(\d+)度/), "方位角")[1];
const tilt = must(chm["_col15"].match(/下倾角由(\d)度到(\d)度/), "下倾角调整"), tiltFrom = +tilt[1], tiltTo = +tilt[2];
const alarm = must(chm["icos根因结论"].match(/存在告警(.+?)（劣化时间为：(\d+)月(\d+)日/), "告警"), alarmDate = `2026-${String(alarm[2]).padStart(2, "0")}-${String(alarm[3]).padStart(2, "0")}`;
const yapRate = +must(yap["icos根因结论"].match(/重叠覆盖率为([\d.]+)%/), "SHYAP 重叠覆盖率")[1] / 100;
const cellNameChm = must(chm["原因分析及优化方案"].match(/(崇贤达NF02H_\d+)小区/), "SHCHM 小区名")[1];
const areaChm = must(chm["原因分析及优化方案"].match(/主要覆盖周边的(.+?)；/), "覆盖区域")[1];
const cellNameYap = must(yap["原因分析及优化方案"].match(/(杨政松HR07H_\d+)小区/), "SHYAP 小区名")[1];
const nameBaoNb = must(bao["根因结论"].match(/邻区(宝泰支HR05H_\d+)，宝泰支HR05H_(\d+)/), "SHBAO 邻区名");

// ── 工具：确定性随机数（同一份脚本每次生成同样的数据）
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const R = rng(20260904), uni = (a, b) => a + (b - a) * R(), int = (a, b) => Math.floor(uni(a, b + 1)), r3 = x => Math.round(x * 1000) / 1000;
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const range = (from, n) => [...Array(n).keys()].map(i => addDays(from, i));
const offset = (lat, lon, dn, de) => ({ lat: +(lat + dn / 111194.93).toFixed(6), lon: +(lon + de / (111194.93 * Math.cos(lat * Math.PI / 180))).toFixed(6) });
const recvAt = date => `${addDays(date, 1)}T06:${String(int(4, 47)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}`;   // MR 日汇总次日凌晨到达

// 逐日 MR：mode "exact" 让窗口汇总占比恰好等于给定值（复现原文数值）；mode "pattern" 按命中／未命中日型生成；explicit 给定 [弱覆盖,总数] 对
function series(dates, o) {
  if (o.pairs) return dates.map((date, i) => ({ date, sampleWeak: o.pairs[i][0], sampleTotal: o.pairs[i][1] }));
  if (o.pattern) return dates.map((date, i) => { const hit = o.pattern[i], total = int(...(hit ? o.hitTotal : o.missTotal)), ratio = uni(...(hit ? o.hitRatio : o.missRatio)); return o.pattern[i] === null ? null : { date, sampleTotal: total, sampleWeak: Math.round(total * ratio) }; }).filter(Boolean);
  const rows = dates.map(date => { const total = int(...o.totals), ratio = Math.max(0.005, o.ratio + uni(-o.jitter, o.jitter)); return { date, sampleTotal: total, sampleWeak: Math.round(total * ratio) }; });
  if (o.exact) { let diff = Math.round(rows.reduce((s, r) => s + r.sampleTotal, 0) * o.ratio) - rows.reduce((s, r) => s + r.sampleWeak, 0); for (let i = 0; diff !== 0; i = (i + 1) % rows.length) { const st = Math.sign(diff); rows[i].sampleWeak += st; diff -= st; } }
  return rows;
}

const D = { sites: [], antennas: [], cells: [], neighbors: [], cellSite: [], cellAntenna: [], areas: [], areaCells: [], cellMR: [], cellMetrics: [], alarms: [], sourceTickets: [], fieldExecutions: [], provenance: [] };
const prov = (entityType, entityId, origin, note) => D.provenance.push({ entityType, entityId, origin, note });
const T0 = "2026-01-01T00:00:00";
const site = (id, name, type, lat, lon, origin, note) => { D.sites.push({ siteId: String(id), siteType: type, lifecycle: "开通", lat, lon }); prov("站点", String(id), origin, `${name}；${note}`); };
const ant = (enb, sector, seq, h, mech, az, ret, origin, note) => { const id = `${enb}-${sector}-${seq}`; D.antennas.push({ antennaId: id, siteId: String(enb), height: h, mechTilt: mech, supportsRET: ret, azimuth: az, effectiveTime: T0 }); prov("天线", id, origin, note); return id; };
const eci = (enb, local) => `LTE:${enb * 256 + local}`, nci = (gnb, local) => `NR:${gnb * 4096 + local}`;
const cell = (c) => {
  const key = c.rat === "NR" ? nci(c.site, c.local) : eci(c.site, c.local), name = `${c.stem}${c.code}_${c.local}`;
  D.cells.push({ cellKey: key, cellName: name, rat: c.rat, band: c.band, sceneLevel: c.scene === undefined ? "一般" : c.scene, rsPower: c.rs, rsPowerPlan: c.rsPlan ?? c.rs, targetRadius: c.Rt, azimuthDeviationDeg: c.azDev, obstructionEvidence: c.obstruct });
  D.cellSite.push({ cellKey: key, siteId: String(c.site) });
  if (c.ant) D.cellAntenna.push({ cellKey: key, antennaId: c.ant, elecTilt: c.elec, vBeam: c.beta, arrayPort: c.port || "P1", effectiveTime: T0 });
  for (const [n, w, f] of c.nb || []) D.neighbors.push({ cellKey: key, targetCellKey: n, freqType: f || "同频", overlapWeight: w });
  prov("小区", key, c.origin || "构造", c.note || "小区名、工参、邻区为构造");
  return key;
};
const mrRows = (key, rows) => rows.forEach(r => D.cellMR.push({ cellKey: key, date: r.date, sampleTotal: r.sampleTotal, sampleWeak: r.sampleWeak, receivedAt: recvAt(r.date) }));
const S1 = range("2026-09-04", 7), S2 = range("2026-09-15", 7), S3 = range("2026-09-22", 7), O1 = range("2026-10-16", 7);
// 九月发现范围：MR 逐日连续上报（2026-09-04 ~ 2026-09-28）。
// 为什么连续：真实网管里 MR 日统计每天都有，时钟走到哪天才入库哪天的；
// 若只有首周，后续窗口就成了"数据缺口"，大屏上所有小区都退化成同一种判定，看不出三态。
// 续段的日型不是拍脑袋写的，而是从首周的实际取值反推（命中／未命中／缺天），再按周重复——
// 这样任何 7 天窗口的判定都与首周一致（首周有几个命中日，续段也有几个）。
const SEP_EXT = range("2026-09-11", 18);   // S1 之后的续段：09-11 ~ 09-28
const ONT = JSON.parse(fs.readFileSync(path.join(root, "ontology/shwo.ontology.json"), "utf8"));
const ruleFor = key => {
  const c = D.cells.find(x => x.cellKey === key), st = D.sites.find(s => s.siteId === D.cellSite.find(x => x.cellKey === key).siteId);
  return ONT.dispatchRules.find(r => r.rat === c.rat && r.siteType === st.siteType && r.sceneLevel === c.sceneLevel) || null;
};
// 首周逐日日型：true 命中／false 未命中／null 缺天（门限取本体里的派单规则）
const weekType = key => {
  const r = ruleFor(key); if (!r) return null;
  return S1.map(d => {
    const m = D.cellMR.find(x => x.cellKey === key && x.date === d);
    if (!m) return null;
    return m.sampleWeak >= r.minWeakSamples && m.sampleWeak / m.sampleTotal >= r.minWeakRatio - 1e-12;
  });
};
// 续段取值带：命中日取命中带、未命中日取未命中带（带内取值必然越过／达不到门限）
const bandOf = key => ruleFor(key) && ruleFor(key).siteType === "室分" ? indoorHit : macroHit;
const macroHit = { hitTotal: [9300, 12600], hitRatio: [0.235, 0.33], missTotal: [8800, 12400], missRatio: [0.04, 0.17] };
const indoorHit = { hitTotal: [2850, 4300], hitRatio: [0.195, 0.27], missTotal: [2700, 4100], missRatio: [0.04, 0.13] };

// ═══ 崇明：SHCHM（原文）及同站同天线小区、重叠邻区 ═══
const base = { lat: 31.528614, lon: 121.817352 };
site(611382, "崇贤达", "宏站", base.lat, base.lon, "原文＋构造", "站名取自原文小区名“崇贤达”，坐标为构造");
const p1 = offset(base.lat, base.lon, 800, 0), p2 = offset(base.lat, base.lon, 0, 900);
site(611397, "崇贤北", "宏站", p1.lat, p1.lon, "构造", "坐标为构造");
site(611409, "陈家镇东", "宏站", p2.lat, p2.lon, "构造", "坐标为构造");
const aX = ant(611382, 2, 1, hChm, tiltFrom, azChm, true, "原文＋构造", `挂高 ${hChm} m、方位角 ${azChm}°、机械下倾 ${tiltFrom}° 取自人工闭环原文；是否电调为构造`);
const aZ1 = ant(611397, 1, 1, 30, 4, 200, true, "构造", "工参为构造"), aZ2 = ant(611409, 3, 1, 30, 3, 270, true, "构造", "工参为构造");
const Z1 = eci(611397, 141), Z2 = eci(611409, 87), Xk = eci(611382, 222), Yk = eci(611382, 223);
cell({ stem: "崇贤达", code: "NF02H", local: 222, site: 611382, rat: "LTE", band: "B3", rs: 12.2, Rt: 500, azDev: 5, obstruct: "否", ant: aX, elec: 3, beta: 6, port: "P1", nb: [[Z1, 0.62], [Z2, 0.41], [Yk, 0, "异频"]], origin: "原文＋构造", note: "小区名、制式、问题取自工单原文；频段、目标半径、电下倾、波束宽、功率、邻区为构造" });
cell({ stem: "崇贤达", code: "NF08H", local: 223, site: 611382, rat: "LTE", band: "B8", rs: 12.2, Rt: 400, azDev: 4, obstruct: "否", ant: aX, elec: 3, beta: 6, port: "P2", nb: [[Xk, 0, "异频"]], note: "X 的同天线小区，构造" });
cell({ stem: "崇贤北", code: "NF02H", local: 141, site: 611397, rat: "LTE", band: "B3", rs: 12.2, Rt: 400, azDev: 6, obstruct: "否", ant: aZ1, elec: 5, beta: 6, nb: [[Xk, 0.55]] });
cell({ stem: "陈家镇东", code: "NF02H", local: 87, site: 611409, rat: "LTE", band: "B3", rs: 12.2, Rt: 400, azDev: 8, obstruct: "未核查", ant: aZ2, elec: 5, beta: 6, nb: [[Xk, 0.37]] });
D.areas.push({ areaId: "AR3102300001", areaName: areaChm.replace(/周边$/, "") + "周边", areaScene: "乡镇道路", areaLevel: "一般", indoorOutdoor: "室外", urbanRural: "农村", district: "崇明" });
prov("区域", "AR3102300001", "原文＋构造", "覆盖区域名取自原文“主要覆盖周边的陈家镇陈东路”；场景、城乡为构造");
D.areaCells.push({ areaId: "AR3102300001", cellKey: Xk, role: "主服务", share: 0.7 }, { areaId: "AR3102300001", cellKey: Yk, role: "次服务", share: 0.3 });
// MR：前窗弱覆盖占比＝1−原文覆盖率；实施后第 1 周覆盖率恢复到 91.36%；第 2 周保持
mrRows(Xk, series(S1, { totals: [6850, 7550], ratio: 1 - covChm, jitter: 0.022, exact: true }));
mrRows(Xk, series(SEP_EXT.slice(0, 4), { totals: [6850, 7550], ratio: 1 - covChm, jitter: 0.022 }));   // 实施（09-14）之前仍是弱覆盖
mrRows(Xk, series(S2, { totals: [6900, 7500], ratio: 1 - 0.9136, jitter: 0.012, exact: true }));
mrRows(Xk, series(S3, { totals: [6900, 7500], ratio: 0.078, jitter: 0.012 }));
for (const [ds, ratio] of [[S1, 0.08], [SEP_EXT.slice(0, 4), 0.08], [S2, 0.07], [S3, 0.07]]) mrRows(Yk, series(ds, { totals: [5600, 6300], ratio, jitter: 0.01 }));
mrRows(Z1, series(S1, { totals: [5400, 6300], ratio: 0.052, jitter: 0.01 }));
mrRows(Z1, series(SEP_EXT, { totals: [5400, 6300], ratio: 0.052, jitter: 0.01 }));   // 邻区持续正常：占比低、从不命中
for (const [k, b, a, a2] of [[Z1, 0.25, 0.18, 0.17], [Z2, 0.2, 0.16, 0.16]]) for (const [ds, v] of [[S1, b], [S2, a], [S3, a2]]) for (const date of ds) D.cellMetrics.push({ cellKey: k, name: "实测重叠覆盖度", date, value: r3(v + uni(-0.006, 0.006)), receivedAt: recvAt(date) });
D.alarms.push({ cell: Xk, type: alarm[1].trim(), startDate: alarmDate, endDate: alarmDate });
prov("告警", Xk, "原文", "ICOS 根因结论：存在告警 BASE STATION INFORMATION，劣化时间 9 月 7 日");

// ═══ 崇明：覆盖发现范围内的其他小区 ═══
const mk = (o, mr, siteType = "宏站") => {
  const rat = o.rat || "LTE", enb = o.site, ps = offset(31.55, 121.55, o.dn, o.de);
  site(enb, o.stem, siteType, ps.lat, ps.lon, "构造", "站点位置为构造");
  const a = o.noAnt ? null : ant(enb, o.sector || 1, 1, o.h || 30, o.mech || 3, o.az || 90, true, "构造", "工参为构造");
  const key = cell({ stem: o.stem, code: o.code, local: o.local, site: enb, rat, band: o.band || "B3", scene: o.scene, rs: rat === "NR" ? undefined : 12.2, Rt: o.Rt || 500, azDev: o.azDev, obstruct: o.obstruct || "否", ant: a, elec: o.elec || 3, beta: 6, note: o.note });
  if (mr) mrRows(key, mr); return key;
};
const C2 = mk({ stem: "东滩公园", code: "NF02H", local: 164, site: 611124, dn: 800, de: 31000, h: 32, az: 120, azDev: 3 }, series(S1, { pairs: [[2000, 9874], [2043, 10215], [1999, 9120], [2260, 11302], [2188, 9941], [1210, 7013], [1522, 8211]] }));
const C3 = mk({ stem: "港沿路", code: "NF02H", local: 73, site: 610872, dn: 12200, de: -4100, az: 45, azDev: 7 }, series(S1, { pattern: [false, true, false, false, true, false, false], ...macroHit }));
const C4 = mk({ stem: "新河镇政府", code: "NF02H", local: 58, site: 610655, dn: 16700, de: -9500, az: 200, azDev: 9, obstruct: "未核查" }, null);
mrRows(C4, series(["2026-09-04", "2026-09-06", "2026-09-08", "2026-09-09", "2026-09-10"], { pattern: [true, true, false, false, false], ...macroHit }));
const C5 = mk({ stem: "堡镇中心", code: "NF02H", local: 132, site: 611018, dn: 3000, de: 17200, az: 300, azDev: 4 }, series(S1, { pattern: S1.map(() => true), ...macroHit }));
const C8 = mk({ stem: "崇明体育中心", code: "NF02H", local: 215, site: 610931, dn: 8700, de: -1800, az: 150, azDev: 2, scene: "VIP" }, series(S1, { pattern: S1.map(() => true), ...macroHit }));
const C10 = mk({ stem: "崇明医院门诊楼", code: "ND08H", local: 12, site: 610933, dn: 8800, de: -1900, noAnt: true, band: "B39", Rt: 60 }, series(S1, { pairs: [[561, 3120], [500, 3318], [497, 3107], [624, 4160], [431, 3012], [522, 3011], [312, 2987]] }), "室分");
const C11 = mk({ stem: "陈家镇", code: "HR05H", local: 36, site: 1038271, dn: -400, de: -5200, rat: "NR", noAnt: true, band: "N41" }, series(S1, { pattern: S1.map(() => true), ...macroHit }));
const C12 = mk({ stem: "长兴客运码头", code: "HR12H", local: 9, site: 1039008, dn: -21100, de: 23800, rat: "NR", noAnt: true, band: "N79", Rt: 60 }, series(S1, { pairs: [[556, 3098], [512, 3010], [488, 3067], [603, 3015], [301, 2998], [297, 3120], [284, 2975]] }), "室分");
// 九月续段（09-11 ~ 09-28）：日型由首周实际取值反推、按周重复，任何 7 天窗口的判定都与首周一致
const extOf = key => SEP_EXT.map((_, i) => { const t = weekType(key); return t ? t[i % 7] : true; });
mrRows(C2, series(SEP_EXT, { pattern: extOf(C2), ...bandOf(C2) }));
mrRows(C3, series(SEP_EXT, { pattern: extOf(C3), ...bandOf(C3) }));
mrRows(C4, series(SEP_EXT, { pattern: extOf(C4), ...bandOf(C4) }));
mrRows(C5, series(SEP_EXT, { pattern: extOf(C5), ...bandOf(C5) }));
mrRows(C8, series(SEP_EXT, { pattern: SEP_EXT.map(() => true), ...bandOf(C8) }));   // VIP：无适用规则，数据到不到都一样是规则缺口
mrRows(C10, series(SEP_EXT, { pattern: extOf(C10), ...bandOf(C10) }));
mrRows(C11, series(SEP_EXT, { pattern: extOf(C11), ...bandOf(C11) }));
mrRows(C12, series(SEP_EXT, { pattern: extOf(C12), ...bandOf(C12) }));
D.alarms.push({ cell: C5, type: "小区退服", startDate: S1[0], endDate: S1[6] }, { cell: C4, type: "传输链路中断", startDate: "2026-08-29", endDate: "2026-08-30" }, { cell: C8, type: "小区退服", startDate: "2026-09-08", endDate: "2026-09-08" });
prov("告警", C5, "构造", "小区退服覆盖整个发现窗口"); prov("告警", C4, "构造", "窗口之前的传输告警，与本次判断无关"); prov("告警", C8, "构造", "单日退服，与本次判断无关");

// ═══ 十月窗口：宝山 SHBAO（原文）、庙镇新村（同类新实例）、海剑 NR ═══
site(1021437, "宝泰支", "宏站", 31.406214, 121.489037, "构造", "站点位置为构造");
const BAO = cell({ stem: "宝泰支", code: "HR05H", local: 112, site: 1021437, rat: "NR", band: "N41", Rt: 500, origin: "原文＋构造", note: "SHBAO 源工单只写“本小区”，小区名称缺失；名称按相邻小区（宝泰支HR05H_111、_123）的命名规则构造，覆盖率 88.18% 取自原文" });
mrRows(BAO, series(O1, { totals: [6900, 7500], ratio: 1 - covBao, jitter: 0.02, exact: true }));
site(1021502, "海剑", "宏站", 31.412861, 121.502344, "构造", "站点位置为构造");
const N1 = cell({ stem: "海剑", code: "HR03H", local: 121, site: 1021502, rat: "NR", band: "N41", Rt: 500, note: "小区名、参数为构造" });
mrRows(N1, series(O1, { pattern: O1.map(() => true), ...macroHit }));
site(611583, "庙镇新村", "宏站", 31.723114, 121.660418, "构造", "站点位置为构造"); site(611590, "庙镇东", "宏站", 31.7229, 121.6711, "构造", "站点位置为构造"); site(611601, "庙镇南", "宏站", 31.7141, 121.6602, "构造", "站点位置为构造");
const aS = ant(611583, 1, 1, 35, 2, 90, true, "构造", "工参为构造"), aE = ant(611590, 1, 1, 30, 3, 180, true, "构造", "工参为构造"), aN = ant(611601, 2, 1, 30, 3, 20, true, "构造", "工参为构造");
const SE = eci(611590, 77), SS = eci(611601, 203);
const SIM = cell({ stem: "庙镇新村", code: "NF02H", local: 126, site: 611583, rat: "LTE", band: "B3", rs: 12.2, Rt: 450, azDev: 3, obstruct: "否", ant: aS, elec: 3.5, beta: 7, nb: [[SE, 0], [SS, 0]], note: "崇明 LTE 宏站弱覆盖的同类实例，工参、MR 为构造" });
cell({ stem: "庙镇东", code: "NF02H", local: 77, site: 611590, rat: "LTE", band: "B3", rs: 12.2, Rt: 450, azDev: 5, obstruct: "否", ant: aE, elec: 4, beta: 7 });
cell({ stem: "庙镇南", code: "NF02H", local: 203, site: 611601, rat: "LTE", band: "B3", rs: 12.2, Rt: 450, azDev: 6, obstruct: "未核查", ant: aN, elec: 4, beta: 7 });
D.areas.push({ areaId: "AR3102300002", areaName: "庙镇新村及周边道路", areaScene: "乡镇道路", areaLevel: "一般", indoorOutdoor: "室外", urbanRural: "农村", district: "崇明" }); prov("区域", "AR3102300002", "构造", "覆盖区域为构造");
D.areaCells.push({ areaId: "AR3102300002", cellKey: SIM, role: "主服务", share: 1 });
mrRows(SIM, series(O1, { totals: [7500, 8400], ratio: 0.288, jitter: 0.014, exact: true }));   // 覆盖率 71.2%
mrRows(SE, series(O1, { totals: [6200, 7000], ratio: 0.055, jitter: 0.01 }));

// ═══ 人工接入演示：陈家镇北NF02H_196（链走到第 5 步停住，等现场回报） ═══
// 与崇贤达NF02H_222 同类：窗口内命中→下倾角过小→机械下倾 Δ=1°→周边影响通过→派给现场维护人员。
// 区别只在种子里故意不给这个小区任何现场回填记录：链走到「实施回填」没有实际值可用，
// 按 INV_07（不得用计划值代替实际值）停在第 5 步，等现场维护人员回报后再继续后面两步。
site(611620, "陈家镇北", "宏站", 31.535, 121.826, "构造", "站点位置为构造（人工接入演示用）");
const aHmn = ant(611620, 1, 1, 38, 3, 90, true, "构造", "工参为构造（人工接入演示用）");
const HMN = cell({ stem: "陈家镇北", code: "NF02H", local: 196, site: 611620, rat: "LTE", band: "B3", rs: 12.2, Rt: 500, azDev: 3, obstruct: "否", ant: aHmn, elec: 3, beta: 6, nb: [[Z1, 0.48], [Z2, 0.36]], note: "人工接入演示：前四步数据齐备，现场回填记录故意留空" });
mrRows(HMN, series(range("2026-09-04", 10), { totals: [7100, 7500], ratio: 0.3728, jitter: 0.012, exact: true }));   // 09-04 ~ 09-13：弱覆盖
mrRows(HMN, series(range("2026-09-14", 15), { totals: [7200, 7600], ratio: 0.086, jitter: 0.01 }));                     // 09-14 起：MR 达标

// ═══ 来源事实：派单系统里的 4 张真实工单、现场回填记录 ═══
const tk = i => src["工单"][i]["工单编号"];
D.sourceTickets.push(
  { taskno: tk(2), district: "崇明", rat: "LTE", issue: "弱覆盖", kpiName: "小区覆盖率", kpiValue: covChm, cellName: cellNameChm, windowStart: S1[0], windowEnd: S1[6], closure: "人工闭环（下倾角 3°→4°）", inScope: true },
  { taskno: tk(0), district: "宝山", rat: "NR", issue: "弱覆盖", kpiName: "小区覆盖率", kpiValue: covBao, cellName: "宝泰支HR05H_112", windowStart: O1[0], windowEnd: O1[6], closure: "自优化闭环", inScope: true },
  { taskno: tk(3), district: "杨浦", rat: "NR", issue: "重叠覆盖", kpiName: "重叠覆盖率", kpiValue: yapRate, cellName: cellNameYap, closure: "人工闭环", inScope: false, reason: "SPEC 未定义重叠覆盖问题（M02／M03 只登记、本次不实现）" },
  { taskno: tk(1), district: "金山", rat: "NR", issue: "源工单未给出问题类型（根因为切换失败）", closure: "自优化闭环", inScope: false, reason: "SPEC 未定义切换差小区，本次不实现", cellName: "金珠港HR12H_133" });
D.fieldExecutions.push({ taskno: tk(2), cellName: cellNameChm, antennaId: aX, param: "mechTilt", fromValue: tiltFrom, toValue: tiltTo, executeTime: "2026-09-14T09:30:00", receivedAt: "2026-09-14T10:00:00", executor: "崇明维护班组", receipt: "成功" });
prov("现场回填", tk(2), "原文＋构造", "下倾角由 3° 调到 4° 取自人工闭环原文；实施与回填时间为构造（原文只写“根据现场勘查调整”）");

D.cellMR.sort((a, b) => a.cellKey === b.cellKey ? a.date.localeCompare(b.date) : a.cellKey.localeCompare(b.cellKey));
writeSeed(path.join(root, "data/seed"), D);
console.log(`seed(CSV)：站点 ${D.sites.length}、天线 ${D.antennas.length}、小区 ${D.cells.length}、MR日统计 ${D.cellMR.length}、告警 ${D.alarms.length}、来源工单 ${D.sourceTickets.length}`);
