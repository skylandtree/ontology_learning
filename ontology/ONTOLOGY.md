# 本体定义（由 SPEC 生成）

本文件由 `scripts/gen-ontology-doc.js` 从 `ontology/shwo.ontology.json` 生成；该 JSON 由 `scripts/gen-ontology.js` 从 `spec/本体与智能应用场景SPEC编制模板_弱覆盖_Day3_V0.9.md`（sha256 `f0fffe9b407f260c…`）的表格解析而来。本体的全部要素只来自这份 SPEC，没有任何其他来源。

| 要素 | 数量 |
|---|---|
| 对象类型 | 9 |
| 关系类型 | 17 |
| 函数 | 12 |
| 动作类型 | 11 |
| 核心约束 | 17 |
| 业务规则（含只登记） | 19 |
| 测试假设 | 12 |
| 派单规则 | 4 |
| 措施类型 | 2 |

## 对象类型与属性

### OT_AREA 覆盖区域

问题发生位置与影响范围的上下文（场景、室内外、城乡、区县），对应工单`cover_area`。不是小区、不是单个栅格、也不是工单；不承载弱覆盖判定与状态（H9）

身份与生命周期：主键`areaId`；无业务状态，范围变更产生新版本；典型：A1

| 属性 | 类型与允许值 | 必填与缺失含义 |
|---|---|---|
| areaId | string | 必填；不随服务小区、措施变化；栅格尺寸与聚合规则，不影响派单判定 |
| areaName | string；`range`＝栅格集合或边界；`areaLevel`∈一般／VIP／VVIP；`indoorOutdoor`∈室内／室外；`urbanRural`∈城区／农村 | `areaScene`、`indoorOutdoor`必填，其余缺失＝未知；`range`变更产生新版本；不设区域弱覆盖状态与区域指标（H9），派单与效果看小区 |
| range | string；`range`＝栅格集合或边界；`areaLevel`∈一般／VIP／VVIP；`indoorOutdoor`∈室内／室外；`urbanRural`∈城区／农村 | `areaScene`、`indoorOutdoor`必填，其余缺失＝未知；`range`变更产生新版本；不设区域弱覆盖状态与区域指标（H9），派单与效果看小区 |
| areaScene | string；`range`＝栅格集合或边界；`areaLevel`∈一般／VIP／VVIP；`indoorOutdoor`∈室内／室外；`urbanRural`∈城区／农村 | `areaScene`、`indoorOutdoor`必填，其余缺失＝未知；`range`变更产生新版本；不设区域弱覆盖状态与区域指标（H9），派单与效果看小区 |
| areaLevel | string；`range`＝栅格集合或边界；`areaLevel`∈一般／VIP／VVIP；`indoorOutdoor`∈室内／室外；`urbanRural`∈城区／农村 | `areaScene`、`indoorOutdoor`必填，其余缺失＝未知；`range`变更产生新版本；不设区域弱覆盖状态与区域指标（H9），派单与效果看小区 |
| indoorOutdoor | string；`range`＝栅格集合或边界；`areaLevel`∈一般／VIP／VVIP；`indoorOutdoor`∈室内／室外；`urbanRural`∈城区／农村 | `areaScene`、`indoorOutdoor`必填，其余缺失＝未知；`range`变更产生新版本；不设区域弱覆盖状态与区域指标（H9），派单与效果看小区 |
| urbanRural | string；`range`＝栅格集合或边界；`areaLevel`∈一般／VIP／VVIP；`indoorOutdoor`∈室内／室外；`urbanRural`∈城区／农村 | `areaScene`、`indoorOutdoor`必填，其余缺失＝未知；`range`变更产生新版本；不设区域弱覆盖状态与区域指标（H9），派单与效果看小区 |
| district | string；`range`＝栅格集合或边界；`areaLevel`∈一般／VIP／VVIP；`indoorOutdoor`∈室内／室外；`urbanRural`∈城区／农村 | `areaScene`、`indoorOutdoor`必填，其余缺失＝未知；`range`变更产生新版本；不设区域弱覆盖状态与区域指标（H9），派单与效果看小区 |

### OT_CELL 小区

无线覆盖的服务单元，弱覆盖派单对象，同时是邻区、功率等参数的作用对象；承载场景等级与小区级指标，逐日MR统计由OT_CELL_MR承载（RT_16）。与天线（物理载体）、站点（归属单位）区别开；没有告警状态，弱覆盖处理状态归工单

身份与生命周期：主键`cellKey`（LTE:ECI／NR:NCI），PCI与名称不作标识；改名、改PCI身份不变；典型：X（B1，派单对象）、Y（B2，同天线）、Z1、Z2（邻区）、W、N1、C2～C11（同类新实例）。样例用简称

| 属性 | 类型与允许值 | 必填与缺失含义 |
|---|---|---|
| cellKey | string，"LTE:"＋ECI／"NR:"＋NCI | 必填；PCI与名称不作标识；样例X、Y、Z1、Z2、W、N1、C2～C11为简称，真实数据按映射表转ECI |
| rat | enum LTE／NR；string | `rat`必填，与站点类型、场景等级共同决定适用的派单规则，并决定原因函数是否适用（NR的F_02、F_04暂不适用）；`band`选填，用于区分同天线多频小区 |
| band | enum LTE／NR；string | `rat`必填，与站点类型、场景等级共同决定适用的派单规则，并决定原因函数是否适用（NR的F_02、F_04暂不适用）；`band`选填，用于区分同天线多频小区 |
| sceneLevel | enum 一般／VIP／VVIP | 选取派单规则的条件之一；缺失＝未知，不默认一般场景，派单判定返回“证据不足”（规则缺口）；建单时快照到工单；VIP／VVIP的方案批准追加优化主管 |
| rsPower | number，dBm／RE | 选填；缺失则次因“功率偏低”记未核查；功率偏低＝`rsPower`＜`rsPowerPlan`；规划值 |
| rsPowerPlan | number，dBm／RE | 选填；缺失则次因“功率偏低”记未核查；功率偏低＝`rsPower`＜`rsPowerPlan`；规划值 |
| targetRadius | number，m，＞0 | F_08、F_10必需；默认＝0.5×最近站间距（TH14），人工覆盖须留痕；缺失→相关函数返回“未知” |
| neighbors | `struct[]`：`{targetCellKey, freqType∈同频／异频, overlapWeight}` | 选填；A→B与B→A分别记在各自名下；未提供＝未知，不等于无邻区；距离由F_01派生，不存储 |
| metrics | `struct[]`时序`{name, date, value}`；如`实测重叠覆盖度`，0～1 | 缺失＝未知，保护项缺数据时效果“待评估”；实测重叠覆盖度与F_10输出的预测重叠指数不是同一个量（H5） |
| azimuthDeviationDeg | number °；enum 是／否／未核查（引用勘察记录，不存勘察原文） | 选填；缺失＝未核查，不得当作“无偏差”“无遮挡” |
| obstructionEvidence | number °；enum 是／否／未核查（引用勘察记录，不存勘察原文） | 选填；缺失＝未核查，不得当作“无偏差”“无遮挡” |
| cellName | string／string／enum／string／enum | `sceneLevel`缺失→规则缺口，派单判定“证据不足”（TC03h） |

### OT_CELL_MR 小区日MR统计

一个小区一个自然日的MR汇聚统计：有效采样点数与RSRP＜-110 dBm的弱覆盖采样点数；[派单规则]“数据源＝MR”所指的前置数据本身，弱覆盖发现与效果前后窗比较的输入。不是MR原始采样（来源事实，不入本体），不是弱覆盖结论（占比与是否命中由F_05派生，不存储）

身份与生命周期：主键`mrKey`＝`{cellKey}@{date}`（业务发生日期）；无业务状态，只追加：同日重复到达按最新接收的一条为准、旧条保留为旧版本；缺天＝没有实例＝未知；典型：LTE:X@2026-10-01

| 属性 | 类型与允许值 | 必填与缺失含义 |
|---|---|---|
| mrKey | string＝`{cellKey}@{date}`；string（RT_16）；date，自然日 | 必填；`date`取业务发生日期，不取接收日期；缺天＝没有该实例＝未知，不补0；样例X、Y为简称，真实数据按映射表转ECI／NCI |
| cellKey | string＝`{cellKey}@{date}`；string（RT_16）；date，自然日 | 必填；`date`取业务发生日期，不取接收日期；缺天＝没有该实例＝未知，不补0；样例X、Y为简称，真实数据按映射表转ECI／NCI |
| date | string＝`{cellKey}@{date}`；string（RT_16）；date，自然日 | 必填；`date`取业务发生日期，不取接收日期；缺天＝没有该实例＝未知，不补0；样例X、Y为简称，真实数据按映射表转ECI／NCI |
| sampleTotal | int，采样点；`sampleWeak`＝RSRP＜-110 dBm的采样点，且≤`sampleTotal` | 必填；弱覆盖占比＝`sampleWeak`÷`sampleTotal`与单日命中由F_05派生，不存储；分母口径 |
| sampleWeak | int，采样点；`sampleWeak`＝RSRP＜-110 dBm的采样点，且≤`sampleTotal` | 必填；弱覆盖占比＝`sampleWeak`÷`sampleTotal`与单日命中由F_05派生，不存储；分母口径 |
| receivedAt | datetime；int，从1起 | 同日重复到达按最新接收的一条为准，旧版本保留可读；工单`discovery.evidenceRefs[]`引用`mrKey`＋`version`，因此数据更正不改写已建工单的发现依据（INV_17）；`receivedAt`缺省取装载时间 |
| version | datetime；int，从1起 | 同日重复到达按最新接收的一条为准，旧版本保留可读；工单`discovery.evidenceRefs[]`引用`mrKey`＋`version`，因此数据更正不改写已建工单的发现依据（INV_17）；`receivedAt`缺省取装载时间 |

### OT_ANTENNA 天线

下倾角、挂高、方位角的物理载体，天馈类措施的作用对象；一副天线可承载多个小区（多频、多制式共天馈）。是资源，小区是它提供的服务，二者通过RT_02关联

身份与生命周期：主键`antennaId`（站点＋扇区＋天线序号，编码规则）；随工参版本变化（`effectiveTime`）；典型：AN1（承载X、Y）、AN2

| 属性 | 类型与允许值 | 必填与缺失含义 |
|---|---|---|
| antennaId | string；`siteId`引用OT_SITE | 必填；编码规则 |
| siteId | string；`siteId`引用OT_SITE | 必填；编码规则 |
| height | number，m，相对覆盖面，＞0 | 必填；缺失→F_08返回“未知（证据不足）”，不判不命中 |
| mechTilt | number，°，整副天线共用 | 必填；每次变更生成新版本，带`effectiveTime`，旧版本保留；A_06回填更新 |
| supportsRET | bool；number，°，自正北顺时针 | `supportsRET`必填，决定能否选电调；`azimuth`选填 |
| azimuth | bool；number，°，自正北顺时针 | `supportsRET`必填，决定能否选电调；`azimuth`选填 |
| effectiveTime | datetime | 版本属性，必填；取实施时间，不取回填接收时间 |

### OT_SITE 基站／站点

小区归属单位，参数与工程的作用边界；提供坐标用于站间距，提供站点类型（宏站／室分）用于选取派单规则与派单问题。规划站点推进本次不用

身份与生命周期：主键`siteId`（eNB ID／gNB ID）；状态规划→在建→开通→退网，本场景只取“开通”；典型：S1、S2、S3

| 属性 | 类型与允许值 | 必填与缺失含义 |
|---|---|---|
| siteId | string；enum 宏站／室分；enum 规划／在建／开通／退网 | 必填；`siteType`决定派单规则与派单问题（宏站／室分弱覆盖小区），缺失→小区站点类型未知，A_01拒绝（INV_01）；原因与处置本场景限宏站、开通 |
| siteType | string；enum 宏站／室分；enum 规划／在建／开通／退网 | 必填；`siteType`决定派单规则与派单问题（宏站／室分弱覆盖小区），缺失→小区站点类型未知，A_01拒绝（INV_01）；原因与处置本场景限宏站、开通 |
| lifecycle | string；enum 宏站／室分；enum 规划／在建／开通／退网 | 必填；`siteType`决定派单规则与派单问题（宏站／室分弱覆盖小区），缺失→小区站点类型未知，A_01拒绝（INV_01）；原因与处置本场景限宏站、开通 |
| lat | number，度 | 必填；缺失→F_01返回空，站间距＝未知 |
| lon | number，度 | 必填；缺失→F_01返回空，站间距＝未知 |

### OT_TICKET 工单

对一个已发现的弱覆盖小区的处置单（处置载体），对应[派单规则]的“类别／问题类型／派单问题”；承载发现依据快照、根因、措施与评估链条，可复发。不是问题锚点：问题由前置数据按规则发现，工单只记录“发现之后怎么处理”。不等于[覆盖汇总]的三级原因——后者是规则，不是问题实例

身份与生命周期：主键`ticketNo`（TK-{制式}-{小区标识}-{序号}，编码规则；接入派单系统后以`taskno`为准）；状态待核验→已确认／已排除→处置中→待评估→已改善／改善未解决→已关闭；典型：TK-LTE-X-001

| 属性 | 类型与允许值 | 必填与缺失含义 |
|---|---|---|
| ticketNo | string，TK-{制式}-{小区标识}-{序号} | 必填、唯一；编号规则；接入派单系统后对应`taskno` |
| problemCategory | enum 覆盖结构；enum MR弱覆盖小区；enum 宏站弱覆盖小区／室分弱覆盖小区；enum 近端／远端／室分／上行／综合；enum LTE／NR；enum 一般／VIP／VVIP | 前三项取[派单规则]原文，`dispatchProblem`由站点类型决定；`rat`、`sceneLevel`为建单时的小区快照；`weakKind`未分型＝空 |
| problemType | enum 覆盖结构；enum MR弱覆盖小区；enum 宏站弱覆盖小区／室分弱覆盖小区；enum 近端／远端／室分／上行／综合；enum LTE／NR；enum 一般／VIP／VVIP | 前三项取[派单规则]原文，`dispatchProblem`由站点类型决定；`rat`、`sceneLevel`为建单时的小区快照；`weakKind`未分型＝空 |
| dispatchProblem | enum 覆盖结构；enum MR弱覆盖小区；enum 宏站弱覆盖小区／室分弱覆盖小区；enum 近端／远端／室分／上行／综合；enum LTE／NR；enum 一般／VIP／VVIP | 前三项取[派单规则]原文，`dispatchProblem`由站点类型决定；`rat`、`sceneLevel`为建单时的小区快照；`weakKind`未分型＝空 |
| weakKind | enum 覆盖结构；enum MR弱覆盖小区；enum 宏站弱覆盖小区／室分弱覆盖小区；enum 近端／远端／室分／上行／综合；enum LTE／NR；enum 一般／VIP／VVIP | 前三项取[派单规则]原文，`dispatchProblem`由站点类型决定；`rat`、`sceneLevel`为建单时的小区快照；`weakKind`未分型＝空 |
| rat | enum 覆盖结构；enum MR弱覆盖小区；enum 宏站弱覆盖小区／室分弱覆盖小区；enum 近端／远端／室分／上行／综合；enum LTE／NR；enum 一般／VIP／VVIP | 前三项取[派单规则]原文，`dispatchProblem`由站点类型决定；`rat`、`sceneLevel`为建单时的小区快照；`weakKind`未分型＝空 |
| sceneLevel | enum 覆盖结构；enum MR弱覆盖小区；enum 宏站弱覆盖小区／室分弱覆盖小区；enum 近端／远端／室分／上行／综合；enum LTE／NR；enum 一般／VIP／VVIP | 前三项取[派单规则]原文，`dispatchProblem`由站点类型决定；`rat`、`sceneLevel`为建单时的小区快照；`weakKind`未分型＝空 |
| discovery | struct：`{problemKey, ruleId, ruleVersion, window{from,to,days}, hitDates[], hitDays, unknownDates[], minHitDays, verdict, evidenceRefs[]}`；`problemKey`＝`{cellKey}@{问题类型}@{窗口末日}`；`evidenceRefs[]`＝`{mrKey, version}`，窗口内实际存在的OT_CELL_MR（缺天不引用），经RT_17指向锚点数据 | 必填；建单时由A_01重算的F_06结果写入，此后不改；重算只追加诊断记录，不改快照；历史工单按当时规则版本与数据版本读回；`evidenceRefs[]`至少一条，否则拒绝建单（INV_16） |
| status | enum 待核验／已确认／已排除／处置中／待评估／已改善／改善未解决／已关闭 | 必填；迁移见状态约束；不含“复发”（H3） |
| relatedTicketNo | string；number，可空 | 复发时填原工单号；`affectedUsers`空＝未知，不是0 |
| affectedUsers | string；number，可空 | 复发时填原工单号；`affectedUsers`空＝未知，不是0 |
| diagnostics | `struct[]`：`{callId, kind∈发现判定／假性弱覆盖／下倾角命中, funcId, funcVersion, inputRefs[], ruleVersions[], result, evidenceRefs[], calledAt, calledBy}` | 每次调用追加，不覆盖；`inputRefs`含MR窗口与工参版本；派单判定只引用实际适用的那条派单规则；见下文“函数结果与动作记录” |
| rootCauses | `struct[]`：`{round, role∈主因／次因／已排除, causeFamily, causeLabel, evidenceRefs[], diagCallId, source∈规则／优化本体／人工}` | A_02追加新轮次，不覆盖旧轮；`causeLabel`取[覆盖汇总]三级原因；症状级标签不得作主因；置信度口径，定义前不输出“置信度” |

### OT_PLAN 优化方案

针对工单根因的措施方案：措施类型快照、动作明细、周边影响结果、审批、执行信息、回退条件。措施类型与执行记录都是它的属性，不单设对象

身份与生命周期：主键`planNo`（工单号＋轮次）；执行状态草案→待确认→已批准→已派单→已实施／失败／未知→已回退；典型：PL-TK-LTE-X-001-R1

| 属性 | 类型与允许值 | 必填与缺失含义 |
|---|---|---|
| planNo | stringPL-{ticketNo}-R{round}；string；int | 必填；一张工单可有多轮方案 |
| ticketNo | stringPL-{ticketNo}-R{round}；string；int | 必填；一张工单可有多轮方案 |
| round | stringPL-{ticketNo}-R{round}；string；int | 必填；一张工单可有多轮方案 |
| measureType | struct：`{measureCode, name, bigClass, midClass, smallClass, level, executorRole, remote, reversible, direction, maxStep, resolution}` | 必填；生成时带入字典快照，字典日后变更不改历史方案 |
| status | enum 草案／待确认／已批准／未批准／已派单／已实施／失败／未知／已回退 | 必填；迁移见状态约束 |
| actions | `struct[]`：`{targetKind∈天线／小区阵列, targetKey, param∈mechTilt／elecTilt, currentValue, targetValue, deltaValue, rollbackValue}`；° | 必填；`deltaValue`取F_10调减后的值，为分辨率整数倍且≤单次上限 |
| impact | struct：`{callId, result∈通过／调减／不通过／未评估, deltaPlan, deltaFinal, checks[]}` | 必填；`checks[]`逐项留痕；邻区工参缺失该项＝未评估，整体不得为“通过” |
| approval | struct：`{approverRoles[], decision, time, reason}`；string | `rollbackCondition`必填＝保护指标恶化或超门限；`approval`在A_05写入 |
| rollbackCondition | struct：`{approverRoles[], decision, time, reason}`；string | `rollbackCondition`必填＝保护指标恶化或超门限；`approval`在A_05写入 |
| execution | struct：`{dispatchNo, executor, executeTime, receipt∈成功／失败／未知, actualValues[]}` | A_06写入；回执缺失＝未知；`actualValues`为现场回填实际值，不得用计划值代替 |

### OT_EFFECT 优化效果

一次方案实施后一轮评价的结果记录，是“改善／达标／持续有效”的依据。评价过程是函数F_11，评价结果是对象——它有多轮、有状态，并被历史案例引用，需要独立追踪

身份与生命周期：主键`effectNo`（工单号＋轮次＋评估序号）；效果状态待评估→评估中→改善／未改善／劣化／未达标→持续有效；典型：EF-TK-LTE-X-001-R1-E1

| 属性 | 类型与允许值 | 必填与缺失含义 |
|---|---|---|
| effectNo | string；int；struct：`{from, to, days}`（自然日） | 必填；前窗＝派单判定所用7天窗口（取`discovery.evidenceRefs`所指的OT_CELL_MR版本，不随后续更正漂移）；后窗＝实施日次日起连续有数据的天（遇第一个缺天即止）；一个方案可多轮评估 |
| planNo | string；int；struct：`{from, to, days}`（自然日） | 必填；前窗＝派单判定所用7天窗口（取`discovery.evidenceRefs`所指的OT_CELL_MR版本，不随后续更正漂移）；后窗＝实施日次日起连续有数据的天（遇第一个缺天即止）；一个方案可多轮评估 |
| round | string；int；struct：`{from, to, days}`（自然日） | 必填；前窗＝派单判定所用7天窗口（取`discovery.evidenceRefs`所指的OT_CELL_MR版本，不随后续更正漂移）；后窗＝实施日次日起连续有数据的天（遇第一个缺天即止）；一个方案可多轮评估 |
| beforeWindow | string；int；struct：`{from, to, days}`（自然日） | 必填；前窗＝派单判定所用7天窗口（取`discovery.evidenceRefs`所指的OT_CELL_MR版本，不随后续更正漂移）；后窗＝实施日次日起连续有数据的天（遇第一个缺天即止）；一个方案可多轮评估 |
| afterWindow | string；int；struct：`{from, to, days}`（自然日） | 必填；前窗＝派单判定所用7天窗口（取`discovery.evidenceRefs`所指的OT_CELL_MR版本，不随后续更正漂移）；后窗＝实施日次日起连续有数据的天（遇第一个缺天即止）；一个方案可多轮评估 |
| beforeRatio | number，0～1；int（后窗前7天按派单规则的命中天数）；bool，可空 | 后窗不足7天时为空；判定空＝未知，不是“否” |
| afterRatio | number，0～1；int（后窗前7天按派单规则的命中天数）；bool，可空 | 后窗不足7天时为空；判定空＝未知，不是“否” |
| afterHitDays | number，0～1；int（后窗前7天按派单规则的命中天数）；bool，可空 | 后窗不足7天时为空；判定空＝未知，不是“否” |
| improved | number，0～1；int（后窗前7天按派单规则的命中天数）；bool，可空 | 后窗不足7天时为空；判定空＝未知，不是“否” |
| achieved | number，0～1；int（后窗前7天按派单规则的命中天数）；bool，可空 | 后窗不足7天时为空；判定空＝未知，不是“否” |
| sustained | number，0～1；int（后窗前7天按派单规则的命中天数）；bool，可空 | 后窗不足7天时为空；判定空＝未知，不是“否” |
| protectionOk | number，0～1；int（后窗前7天按派单规则的命中天数）；bool，可空 | 后窗不足7天时为空；判定空＝未知，不是“否” |
| protection | `struct[]`：`{name, before, after, pass}`；enum 待评估／评估中／改善／未改善／劣化／未达标／持续有效 | `status`必填，是效果状态；保护指标取同天线小区与重叠邻区的小区级指标，任一项缺数据→待评估 |
| status | `struct[]`：`{name, before, after, pass}`；enum 待评估／评估中／改善／未改善／劣化／未达标／持续有效 | `status`必填，是效果状态；保护指标取同天线小区与重叠邻区的小区级指标，任一项缺数据→待评估 |
| callRef | `struct[]`：`{name, before, after, pass}`；enum 待评估／评估中／改善／未改善／劣化／未达标／持续有效 | `status`必填，是效果状态；保护指标取同天线小区与重叠邻区的小区级指标，任一项缺数据→待评估 |

### OT_CASE 历史案例

已评定的“问题—根因—措施—效果”记录，含失败与证据不足，供同类问题检索复用。不是[覆盖汇总]的100行规则

身份与生命周期：主键`caseNo`（CS-{ticketNo}-R{轮次}）；验证状态未验证→已验证；当前0个实例；典型：CS-TK-LTE-X-001-R1（测试中）

| 属性 | 类型与允许值 | 必填与缺失含义 |
|---|---|---|
| caseNo | string | 必填，可追溯到来源 |
| sourceTicketNo | string | 必填，可追溯到来源 |
| planNo | string | 必填，可追溯到来源 |
| effectNo | string | 必填，可追溯到来源 |
| applicability | struct：`{rat, siteType, sceneLevel, areaScene, urbanRural, indoorOutdoor, causeFamily, vendor, tiltRange}`；方案快照；number，° | 必填；引用案例须匹配适用条件 |
| measureType | struct：`{rat, siteType, sceneLevel, areaScene, urbanRural, indoorOutdoor, causeFamily, vendor, tiltRange}`；方案快照；number，° | 必填；引用案例须匹配适用条件 |
| deltaValue | struct：`{rat, siteType, sceneLevel, areaScene, urbanRural, indoorOutdoor, causeFamily, vendor, tiltRange}`；方案快照；number，° | 必填；引用案例须匹配适用条件 |
| outcome | enum 有效可复现／无效／证据不足；enum 未验证／已验证 | 必填；失败与证据不足必须入库；当前案例数为0 |
| validation | enum 有效可复现／无效／证据不足；enum 未验证／已验证 | 必填；失败与证据不足必须入库；当前案例数为0 |

## 关系类型

| 标识 | 名称 | 起点→终点 | 数量关系与成立条件 | 使用 |
|---|---|---|---|---|
| RT_01 | 归属于 | OT_CELL→OT_SITE | N:1；小区隶属的基站（eNB／gNB ID为ECI／NCI高位） | F_01站间距；A_04作用边界 |
| RT_02 | 由…提供覆盖 | OT_CELL→OT_ANTENNA | N:1（天线1:N）；属性`elecTilt`、`vBeam`、`arrayPort`；实际角色；成立：工参小区—天线对应与现场核对一致 | F_02～F_04、F_08；F_10决定同天线小区范围（INV_12） |
| RT_03 | 邻区／重叠覆盖 | OT_CELL→OT_CELL | N:M有向，以小区属性`neighbors`记录；重叠为派生 | F_10重叠邻区范围与预测重叠指数 |
| RT_04 | 主要覆盖 | OT_CELL→OT_AREA | N:M；`role`主服务／次服务；`share`采样占比；`period` | 工单`cover_area`上下文、问答“这个区域涉及哪些小区”；不参与派单判定 |
| RT_05 | 针对 | OT_TICKET→OT_CELL | N:1，恰好一个；派单对象＝弱覆盖小区；成立：该小区的前置数据（OT_CELL_MR）按派单规则判为“达到派单条件”（INV_16） | A_01；INV_01、INV_14 |
| RT_06 | 涉及 | OT_TICKET→OT_CELL | N:M；`role`同天线小区／重叠邻区 | F_07告警范围；F_10保护范围 |
| RT_07 | 复发关联 | OT_TICKET→OT_TICKET | N:0..1；新工单指向原工单，原工单不重开 | A_01；INV_11 |
| RT_08 | 根因依据 | OT_TICKET→OT_CELL／OT_ANTENNA | N:M；`evidenceKind`；成立：某轮根因引用了该小区的MR窗口、指标或天线工参版本 | F_08、A_02；INV_03 |
| RT_09 | 针对 | OT_PLAN→OT_TICKET | N:1；成立：工单“已确认” | A_04；INV_04 |
| RT_10 | 作用于 | OT_PLAN→OT_ANTENNA／OT_CELL | N:M；`role`主作用／受影响。机械下倾：主作用＝天线，受影响＝承载的所有小区；电子下倾：主作用＝对应阵列小区，受影响＝仅该阵列 | F_10、A_05；INV_12 |
| RT_11 | 检验 | OT_EFFECT→OT_PLAN | N:1；成立：方案已实施 | F_11、A_07 |
| RT_12 | 比较前后指标（目标） | OT_EFFECT→OT_CELL | N:1；目标＝工单针对的弱覆盖小区 | F_11 |
| RT_13 | 比较前后指标（保护） | OT_EFFECT→OT_CELL | N:M；`role`同天线小区／重叠邻区 | F_11 |
| RT_14 | 沉淀为 | OT_EFFECT→OT_CASE | 1:0..1 | A_09；INV_11 |
| RT_15 | 被引用于 | OT_CASE→OT_PLAN | N:M | A_04 |
| RT_16 | 统计对象 | OT_CELL_MR→OT_CELL | N:1；一个小区一个自然日至多一个当前版本；成立：MR日汇总的`cellKey`对应到本体小区 | F_05、F_06、F_12（发现）；F_11（前后窗、保护指标）；INV_17 |
| RT_17 | 发现依据 | OT_TICKET→OT_CELL_MR | N:M；成立：该工单`discovery`快照引用了这条MR日统计（`mrKey`＋`version`） | A_01；INV_16；TC01a、TC04a |

## 对象、属性、关系与实际表、字段的对应关系（SPEC 4.1）

接口元数据里的 `physicalTable`／`physicalColumn` 就取自这里：表名照 SPEC 4.1 抄录，物理列名由 SPEC 字段名按下划线化得到（样例 CSV 表头是驼峰，接入真实系统时按 SPEC 假设 U24 替换）。

| 对象类型 | 承载表 | 主键 | 方向 |
|---|---|---|---|
| OT_AREA | areas | areaId | 读 |
| OT_CELL | cells | cellKey | 读 |
| OT_CELL_MR | cell_mr | cellKey＋date | 读 |
| OT_ANTENNA | antennas | antennaId＋effectiveTime | 读 |
| OT_SITE | sites | siteId | 读 |
| OT_TICKET | source_tickets | ticketNo＋taskno | 写 |
| OT_PLAN | 平台存储（无单一表） | planNo＋ticketNo | 写 |
| OT_EFFECT | 平台存储（无单一表） | effectNo＋ticketNo | 写 |
| OT_CASE | 平台存储（无单一表） | caseNo | 写 |

| 关系类型 | 关联表 | 连接键 | 方向 |
|---|---|---|---|
| RT_01 | cell_site | cellKey＋siteId | 读 |
| RT_02 | cell_antenna | cellKey＋antennaId＋effectiveTime | 读 |
| RT_03 | cell_neighbors | cellKey | 读 |
| RT_04 | area_cells | areaId＋cellKey | 读 |
| RT_05 | source_tickets | cellName＋rat | 写 |
| RT_06 | 无单一表（派生／多表） | antennaId | 派生 |
| RT_07 | 无单一表（派生／多表） |  | 写 |
| RT_08 | 无单一表（派生／多表） | cellKey＋date | 写 |
| RT_09 | 无单一表（派生／多表） | ticketNo | 写 |
| RT_10 | 无单一表（派生／多表） |  | 派生 |
| RT_11 | 无单一表（派生／多表） | planNo＋planNo | 写 |
| RT_12 | 无单一表（派生／多表） |  | 派生 |
| RT_13 | 无单一表（派生／多表） |  | 派生 |
| RT_14 | 无单一表（派生／多表） | effectNo | 写 |
| RT_15 | 无单一表（派生／多表） |  | 读 |
| RT_16 | 无单一表（派生／多表） |  | 读 |
| RT_17 | 无单一表（派生／多表） | version＋cellKey＋date＋receivedAt | 写 |

字段映射 92 条，其中落到具体“表.字段”的 37 条：

| 对象／关系 | 属性 | 表.字段 | 方向 |
|---|---|---|---|
| OT_AREA | areaId | areas.areaId | 读 |
| OT_AREA | areaName | areas.areaName | 读 |
| OT_AREA | areaScene | areas.areaScene | 读 |
| OT_AREA | areaLevel | areas.areaLevel | 读 |
| OT_AREA | indoorOutdoor | areas.indoorOutdoor | 读 |
| OT_AREA | urbanRural | areas.urbanRural | 读 |
| OT_AREA | district | areas.district | 读 |
| OT_CELL | cellKey | cells.cellKey | 读 |
| OT_CELL | cellName | cells.cellName | 读 |
| OT_CELL | rat | cells.rat | 读 |
| OT_CELL | band | cells.band | 读 |
| OT_CELL | sceneLevel | cells.sceneLevel | 读 |
| OT_CELL | rsPower | cells.rsPower | 读 |
| OT_CELL | rsPowerPlan | cells.rsPowerPlan | 读 |
| OT_CELL | targetRadius | cells.targetRadius | 读 |
| OT_CELL | azimuthDeviationDeg | cells.azimuthDeviationDeg | 读 |
| OT_CELL | obstructionEvidence | cells.obstructionEvidence | 读 |
| OT_CELL_MR | cellKey | cell_mr.cellKey | 读 |
| OT_CELL_MR | date | cell_mr.date | 读 |
| OT_CELL_MR | sampleTotal | cell_mr.sampleTotal | 读 |
| OT_CELL_MR | sampleWeak | cell_mr.sampleWeak | 读 |
| OT_CELL_MR | receivedAt | cell_mr.receivedAt | 读 |
| OT_ANTENNA | antennaId | antennas.antennaId | 读 |
| OT_ANTENNA | siteId | antennas.siteId | 读 |
| OT_ANTENNA | height | antennas.height | 读 |
| OT_ANTENNA | azimuth | antennas.azimuth | 读 |
| OT_ANTENNA | supportsRET | antennas.supportsRET | 读 |
| OT_ANTENNA | mechTilt | antennas.mechTilt | 读 |
| OT_ANTENNA | effectiveTime | antennas.effectiveTime | 读 |
| OT_SITE | siteId | sites.siteId | 读 |
| OT_SITE | siteType | sites.siteType | 读 |
| OT_SITE | lifecycle | sites.lifecycle | 读 |
| OT_SITE | lat | sites.lat | 读 |
| OT_SITE | lon | sites.lon | 读 |
| OT_TICKET | rat | source_tickets.rat | 读 |
| RT_04 | role | area_cells.role | 读 |
| RT_04 | share | area_cells.share | 读 |

未落到单一字段的属性（派生、写回多表或本期不落库）：OT_AREA.range、OT_CELL.neighbors[]、OT_CELL.metrics[]、OT_CELL_MR.mrKey、OT_CELL_MR.version、OT_TICKET.ticketNo、OT_TICKET.problemCategory、OT_TICKET.problemType、OT_TICKET.dispatchProblem、OT_TICKET.weakKind、OT_TICKET.sceneLevel、OT_TICKET.discovery、OT_TICKET.status、OT_TICKET.relatedTicketNo、OT_TICKET.affectedUsers、OT_TICKET.diagnostics[]、OT_TICKET.rootCauses[]、OT_PLAN.planNo、OT_PLAN.ticketNo、OT_PLAN.round、OT_PLAN.measureType、OT_PLAN.status、OT_PLAN.actions[]、OT_PLAN.impact、OT_PLAN.approval、OT_PLAN.rollbackCondition、OT_PLAN.execution、OT_EFFECT.effectNo、OT_EFFECT.planNo、OT_EFFECT.round、OT_EFFECT.beforeWindow、OT_EFFECT.afterWindow、OT_EFFECT.beforeRatio、OT_EFFECT.afterRatio、OT_EFFECT.afterHitDays、OT_EFFECT.improved、OT_EFFECT.achieved、OT_EFFECT.sustained、OT_EFFECT.protectionOk、OT_EFFECT.protection[]、OT_EFFECT.status、OT_EFFECT.callRef、OT_CASE.caseNo、OT_CASE.sourceTicketNo、OT_CASE.planNo、OT_CASE.effectNo、OT_CASE.applicability、OT_CASE.measureType、OT_CASE.deltaValue、OT_CASE.outcome、OT_CASE.validation、RT_06.role、RT_08.evidenceKind、RT_10.role、RT_13.role

## 状态

| 对象 | 状态取值 | 允许转移 |
|---|---|---|
| OT_TICKET | 待核验、已确认、已排除、处置中、待评估、已改善、改善未解决、已关闭 | 待核验→已确认／已排除（A_03；已确认须有主因证据，已排除须F_07＝排除）；已确认→处置中（A_05）；处置中→待评估（A_06回执成功）；待评估→已改善／改善未解决（A_07，样本足）；已改善→已关闭（A_08，须持续有效＝真）；改善未解决→处置中（新一轮A_04）。再次触发不重开，由A_01新建并关联 |
| OT_PLAN | 草案、待确认、已批准、未批准、已派单、已实施、失败、未知、已回退 | 草案→待确认（A_04，impact＝通过或调减）；草案停留并转人工（impact＝不通过或未评估）；待确认→已批准→已派单／未批准（A_05）；已派单→已实施／失败／未知（A_06）；已实施→已回退（A_10，本期只定义） |
| OT_EFFECT | 待评估、评估中、改善、未改善、劣化、未达标、持续有效 | 待评估→改善／未改善／劣化／未达标（A_07，后窗≥7天且保护指标齐全）；改善→持续有效（后窗14天内每个7天滑窗都未达到派单条件）。保护不通过＝劣化；改善且达标＝改善；改善未达标＝未达标 |
| OT_CASE | 未验证、已验证 | 评定为持续有效且可复现后→已验证；无效与证据不足的案例同样保留，不删除 |

## 函数

| 标识 | 名称 | 版本 | 业务问题 | 判断方法 | 输出 |
|---|---|---|---|---|---|
| F_01 | siteDistance | 0.1 | 两站点相距多远（站间距）；OT_SITE | 球面大圆距离（haversine，地球半径6371 km） | `distance`（m）；任一坐标缺失→空（未知） |
| F_02 | theoryRadius | 0.1 | 小区的理论覆盖范围；OT_CELL（经RT_02取天线） | RULE_W06：rNear＝h÷tan(θ＋β/2)；rFar＝h÷tan(θ－β/2) | `{rNear, rFar}`（m，1位小数）；h、θ、β≤0或θ＋β/2≥90°→无效；θ－β/2≤0→rFar＝不收敛（∞），不得当作0；`rat`＝NR→未定义（H6） |
| F_03 | totalTilt | 0.1 | 小区实际总下倾角；OT_CELL | 总下倾＝`mechTilt`＋`elecTilt` | °；任一缺失→空 |
| F_04 | recommendTilt | 0.1 | 为让远端落在目标半径应下倾多少；OT_CELL | RULE_W06：θ_t＝arctan(h÷Rt)＋β/2（主瓣上沿落在Rt上） | °；h、Rt、β≤0→无效 |
| F_05 | dailyWeakCheck | 0.3 | 小区某天是否弱覆盖（单日命中）；OT_CELL_MR（经RT_16属于OT_CELL） | RULE_D01～D04：占比＝sampleWeak÷sampleTotal；`sampleWeak`≥门限（宏站2000／室分500）且占比≥门限（宏站20%／室分15%）→命中，等于门限算命中 | `{date, mrKey, version, ratio(4位小数), weakOk, ratioOk, hit∈是／否／未知}`；当天无OT_CELL_MR实例→未知，ratio为空，不得为0；无对应规则→未知（规则缺口） |
| F_06 | discoverCell | 0.3 | 小区是否达到派单条件（7天出现3天）＝该小区的前置数据是否发现了弱覆盖问题；OT_CELL | RULE_D01～D04：命中天数≥3→达到；命中＋未知＜3→未达到（缺天补满也不够）；其余→证据不足 | `{verdict∈达到派单条件／未达到派单条件／证据不足, problemKey（仅“达到”时给出）, ruleId, window, hitDays, hitDates[], unknownDates[], missDates[], daily[], evidenceRefs[]}`；`evidenceRefs[]`＝窗口内实际存在的OT_CELL_MR键与版本；无对应规则→证据不足，`unknownDates`＝全部7天，不套用其他场景门限 |
| F_07 | falseWeakCheck | 0.2 | 弱覆盖是否由退服、告警等造成；OT_TICKET（派单小区及RT_06涉及的小区） | RULE_W04：重合占比＝落在告警区间内的命中日数÷命中日数；≥TH07＝排除；0＜占比＜TH07＝部分重合，转人工；＝0＝无重合 | `{结论∈排除／部分重合／无重合／不适用, 重合天数, 命中日数, 占比, 所用告警引用}`；无命中日→不适用 |
| F_08 | matchTiltCause | 0.2 | 弱覆盖是否由下倾角过小引起，并排除次因；OT_TICKET→OT_CELL→OT_ANTENNA | RULE_W06、W05／W08／W09，顺序见下文“函数填写要求” | `{match∈命中／不命中／未知／冲突, totalTilt, thetaTarget, deficit, rNear, rFar, otherCauses[], role, missing[]}`；缺任一必需输入→未知并列缺项；`rat`＝NR→未知（规则缺口）；站点类型＝室分→未知（不适用宏站下倾模型）；工参待回填→未知；工参冲突→冲突 |
| F_09 | planTilt | 0.1 | 一次调多少、需几轮；OT_PLAN | RULE_W14：Δ＝⌊min(缺口,TH02)÷分辨率⌋×分辨率；轮次＝⌈缺口÷TH02⌉ | `{Δ(°), 轮次, executable}`；Δ＝0（缺口小于分辨率）→不可执行；F_08未命中→不生成 |
| F_10 | assessImpact | 0.1 | 调整会不会伤到同天线小区和重叠邻区；OT_PLAN→OT_CELL | RULE_W13，逐级尝试见下文 | `{result∈通过／调减／不通过／未评估, deltaPlan, deltaFinal, affectedCells[], attempts[], checks[]}`；邻区工参缺失→该项“未评估”，整体不得为“通过” |
| F_11 | judgeEffect | 0.3 | 措施是否有效、是否持续；OT_EFFECT | RULE_W16＋RULE_D01～D04，判定顺序见下文 | `{beforeRatio, afterRatio, afterHitDays, improved, achieved, sustained, protectionOk, status, daysAfter}`；后窗＜TH11（7天）、前窗无数据或无对应规则→状态“待评估”，各判定为空 |
| F_12 | scanWeakCells | 0.1 | 在给定范围内，哪些小区的前置数据按[派单规则]发现了弱覆盖问题；OT_CELL（范围）→OT_CELL_MR | 对范围内每个小区：读其窗口内OT_CELL_MR（RT_16）、制式、站点类型（RT_01）、场景等级，逐日调F_05、再调F_06；按判定分组汇总；只读，不创建工单、不读取工单，同一数据与规则版本重复调用结果相同 | `{refTime, window, scope[], items[{cellKey, verdict, problemKey, ruleId, hitDays, unknownDates[], evidenceRefs[]}], counts{达到, 未达到, 证据不足}}`；窗口内无任何OT_CELL_MR的小区列为“证据不足（数据缺口）”，不静默跳过；站点类型未知或规则缺口→该项“证据不足”并标注缺项 |

## 动作类型

| 标识 | 名称 | 允许角色 | 业务目的 | 输入与前提 | 拒绝与未知处理 |
|---|---|---|---|---|---|
| A_01 | 建单（依发现结果）（createTicket） | 优化本体／地市优化工程师 | 优化本体或地市优化工程师；对前置数据发现的弱覆盖小区建立可追溯的处置单；目标：新建OT_TICKET | 输入：`cellKey`、判断时点（缺省取运行时钟）；可附F_12清单项作参考，但不采信。前提：小区存在且能确定制式、站点类型（RT_01）；A_01自行重算F_06＝达到派单条件（窗口＝判断时点所在日之前的7个自然日），并且窗口内存在OT_CELL_MR证据 | 成功：返回`ticketNo`且重开一致，`discovery.evidenceRefs[]`逐条可读回OT_CELL_MR。小区不存在或站点类型未知→拒绝（INV_01）；重复→关联（INV_14）；证据不足（缺天、规则缺口、窗口无MR）→拒绝，不建单（INV_09、INV_16）；未达到派单条件→不建单（INV_16） |
| A_02 | 写入根因（writeRootCause） | 优化本体／地市优化工程师／优化专家 | 优化本体（规则命中）、优化工程师、专家；记录定因结论；目标：OT_TICKET的`rootCauses[]` | 输入：`ticketNo`、`causeLabel`、`causeFamily`、`role`、`evidenceRefs`、`source`。前提：工单为待核验或已确认；F_07结论不是“排除” | 症状级标签作主因→拒绝（INV_02）；主因无证据→拒绝（INV_03）；工单已排除→拒绝 |
| A_03 | 确认或排除（confirmTicket） | 地市优化工程师／优化专家 | 地市优化工程师（疑难转专家）；确认定因或排除假性弱覆盖；目标：OT_TICKET状态 | 输入：`ticketNo`、`decision`、`reason`。前提：工单待核验；已有主因证据，或F_07＝排除 | F_07＝部分重合→须人工写明复核判断，不得自动确认；F_08次因命中→不得自动确认，由工程师判断是否转专家（TC03f）；无主因证据→不得确认 |
| A_04 | 生成优化方案（generatePlan） | 优化本体 | 优化本体；为已确认工单生成带周边校验的方案；目标：新建OT_PLAN | 输入：`ticketNo`、`adjustType`。前提：工单已确认；F_08＝命中；电子下倾要求`supportsRET`为真 | 工单待核验或已排除→拒绝（INV_04）；F_08＝未知→不建（INV_09）；电子下倾但不支持电调→拒绝 |
| A_05 | 确认并派单（approveAndDispatch） | 地市优化工程师 | 地市优化工程师；作用于2个及以上小区、VIP／VVIP场景（取自小区场景等级）或跨站的方案追加优化主管批准；批准并派给现场；实际操作目标：机械＝天线AN1的`mechTilt`，电子＝X阵列的`elecTilt` | 输入：`planNo`、`decision`、`executor`。前提：方案待确认；`impact`为通过或调减；方案所依据的工参版本等于当前版本 | `impact`为不通过／未评估→拒绝（INV_06）；试图自动执行天馈类措施→拒绝（INV_05）；工参版本已变→退回草案重算（TC07b③） |
| A_06 | 回填执行信息（recordExecution） | 地市优化工程师／现场维护人员 | 现场维护人员回填，优化工程师复核；记录现场实际调整；目标：OT_PLAN的`execution`，并更新OT_ANTENNA的`mechTilt`（或RT_02的`elecTilt`）新版本 | 输入：`planNo`、`dispatchNo`、`executeTime`、`receipt`、`actualValues[]`。前提：方案已派单 | 缺实际值→不得记已实施（INV_07）；回执缺失记“未知”，工单留在处置中（INV_08）；实际≠计划→按实际值记，并以实际值调F_10事后复核；与其他来源冲突→INV_15 |
| A_07 | 写入优化效果（recordEffect） | 优化本体／地市优化工程师 | 优化本体，优化工程师复核；记录一轮效果评价；目标：新建OT_EFFECT | 输入：`planNo`。前提：方案已实施；前窗取工单派单窗口，后窗取实施日次日起的小区MR，保护指标取RT_06涉及小区 | 后窗不足7天或保护指标缺数据→效果“待评估”、判定为空（INV_09）；保护指标恶化→劣化，提示回退 |
| A_08 | 关闭工单（closeTicket） | 优化主管 | 优化主管；关闭已持续有效的问题；目标：OT_TICKET状态 | 输入：`ticketNo`。前提：效果状态＝持续有效 | `sustained`为空或假→拒绝（INV_10）；优化本体无权关闭 |
| A_09 | 历史案例入库（archiveCase） | 优化专家／知识维护人 | 优化专家或知识维护人；沉淀经验；目标：新建OT_CASE | 输入：`effectNo`、`applicability`（制式、站点类型、场景等级、区域场景等）。前提：效果已评定（含劣化、未改善） | 缺适用条件→拒绝；引用不存在的效果→拒绝；不得只存成功案例（INV_11） |
| A_10 | 回退方案（rollbackPlan）【只定义】 | 地市优化工程师 | 优化工程师；保护指标恶化时恢复原值；目标：新建回退方案 | 输入：`planNo`。前提：效果＝劣化，或保护指标不通过 | 本期只定义，不测 |
| A_11 | 裁定工参冲突（resolveFactConflict） | 地市优化工程师 | 地市优化工程师；对同一天线同一生效区间两个来源取值冲突作出裁定；目标：OT_ANTENNA 对应字段的新版本与冲突记录 | 输入：`conflictId`、`chosenSource`、`reason`。前提：冲突记录为未裁定 | 无未裁定冲突、未写理由、所选来源不在两个来源之内→拒绝（INV_15）；优化本体无权裁定 |

## 核心约束

| 编号 | 约束 | 校验点 |
|---|---|---|
| INV_01 | 一张工单恰好针对一个弱覆盖小区（派单对象），该小区须能确定制式与站点类型（宏站／室分） | A_01、RT_05 |
| INV_02 | 症状级标签（[覆盖汇总]K族7个：弱覆盖、远端弱覆盖、室分弱覆盖、上行弱覆盖、重叠覆盖、过覆盖、服务小区过覆盖导致重叠覆盖）不得作主因，须先下钻 | A_02 |
| INV_03 | 主因至少有一条直接证据（小区MR、工参、告警记录、勘察） | A_02、RT_08 |
| INV_04 | 待核验或已排除的工单不得生成优化方案 | A_04 |
| INV_05 | 天馈类措施（`executorRole`＝现场维护）不得自动执行：须人工确认并派单，由现场维护人员执行并回填 | A_05 |
| INV_06 | 周边影响为“不通过”或“未评估”的方案不得批准；“调减”的方案必须按调减后的幅度写入 | A_04、A_05、F_10 |
| INV_07 | 效果评估与复核使用现场回填的实际值，不使用计划值 | A_06、F_10 |
| INV_08 | 回执或回填缺失记“未知”，不得推进到待评估或关闭 | A_06、A_07 |
| INV_09 | MR缺天、规则缺失（含场景等级无对应派单规则）、工参缺失一律记“未知／证据不足”，不得写0或默认结论 | F_05、F_06、F_12、F_08、F_10、F_11、A_01 |
| INV_10 | 持续有效为空或否时，工单不得关闭 | A_08 |
| INV_11 | 历史不覆盖：根因修订追加轮次；工参变更带生效时间；复发新建工单关联原单；失败与证据不足案例照常入库 | A_02、A_06、A_09 |
| INV_12 | 影响范围由调整方式决定：机械下倾→天线承载的所有小区；电子下倾→仅对应阵列小区 | F_10、RT_10 |
| INV_13 | 单次调整幅度≤单次上限，且为调节分辨率的整数倍；缺口更大则分轮 | F_09 |
| INV_14 | 同一小区同一问题类型存在未关闭工单时，不重复建单，关联已有工单 | A_01 |
| INV_15 | 同一天线同一生效区间两个来源取值冲突时不自动裁决，转人工；裁定前相关函数返回“冲突”，不评估 | A_06、F_08、F_10、F_11 |
| INV_16 | 问题须由前置数据发现：工单只能依发现结果建立——建单时F_06对窗口内OT_CELL_MR判定为“达到派单条件”，且`discovery.evidenceRefs[]`指向窗口内实际存在的OT_CELL_MR；无前置数据支撑的工单（未达到、证据不足、窗口无MR）不得建立；工单的状态、关闭与删除不改变前置数据与发现判定 | A_01、RT_17 |
| INV_17 | 前置数据只追加：OT_CELL_MR不被覆盖改写——同日重复到达新增版本，迟到数据按业务日期归日；已建工单的`discovery`快照与效果前窗按其引用的数据版本读回，不因数据更正而重算改写；更正后的发现结果由F_12另行给出 | DM_01、A_01、F_11、F_12 |

## 业务规则

| 标识 | 版本 | 含义 | 适用与判定 | 输出与缺失处理 | 使用 |
|---|---|---|---|---|---|
| RULE_D01 | 1.0 | 4G宏站弱覆盖小区；[派单规则]第2行原文：“宏站基站RSRP小于-110的弱覆盖采样点大于等于2000（单日），弱覆盖占比大于等于20%；7天出现3天”；类别“覆盖结构”、问题类型“MR弱覆盖小区”、派单问题“宏站弱覆盖小区”、数据源MR；规则文件原文，业务确认待补 | LTE×宏站×一般场景；对OT_CELL_MR逐日判定：单日`sampleWeak`≥2000且占比≥0.20→命中；7天内命中≥3天→达到派单条件 | 缺天→未知；命中＋未知＜3→未达到；其余→证据不足 | F_05、F_06、F_12、F_11；TC01、TC01a、TC03b、TC08 |
| RULE_D02 | 1.0 | 4G室分弱覆盖小区；[派单规则]第3行：单日RSRP＜-110采样点≥500且占比≥15%，7天出现3天；派单问题“室分弱覆盖小区” | LTE×室分×一般场景 | 同RULE_D01 | F_05、F_06、F_12；TC08（C10） |
| RULE_D03 | 1.0 | 5G宏站弱覆盖小区；[派单规则]第4行，门限同第2行 | NR×宏站×一般场景 | 同RULE_D01 | F_05、F_06、F_12；TC06c（N1） |
| RULE_D04 | 1.0 | 5G室分弱覆盖小区；[派单规则]第5行，门限同第3行 | NR×室分×一般场景 | 同RULE_D01 | F_05、F_06、F_12；TC08（C11） |
| RULE_F01 | 0.1 | 发现范围与窗口：从前置数据发现弱覆盖问题时，窗口＝判断时点所在日之前的7个自然日（窗口末日＝判断日前一天）；范围内每个小区都要有结论；本组拟定，参照场景收敛文档SC-WC-01的每日09:00批量识别；待确认 | 范围＝给定小区集合（显式列出或按站点／区县展开）；窗口内无OT_CELL_MR的小区→“证据不足（数据缺口）”，不静默跳过，也不判“未达到”；规则缺口（VIP／VVIP或场景等级缺失）→“证据不足”；发现只读，不依赖工单；每日一次的调度时点与MR到齐时间 | 证据不足分项列出缺天日期或缺失的规则 | F_12；TC01、TC08 |
| RULE_W04 | 0.2 | 先排除假性弱覆盖；Day1 W4，[覆盖汇总]第12行含“处理邻区故障站点”；按命中日计；待确认 | 取派单小区及其同天线小区、重叠邻区的告警区间；重合占比＝落在告警区间内的命中日数÷命中日数；≥TH07排除；0～TH07之间部分重合；＝0无重合 | 排除→工单“已排除”，不调参；部分重合→转人工；无命中日→不适用 | F_07；TC01、TC03c、TC03d、TC08（C5） |
| RULE_W05 | 0.1 | 次因排除：发射功率偏低、覆盖方向偏差、周边遮挡；Day1 W5、W8、W9，；待确认 | 功率：现网低于规划值；方位：偏差＞TH08；遮挡：有勘察或GIS证据 | 次因命中→与主因并列记录，不自动确认；缺证据→未核查，不当作无 | F_08；TC03f |
| RULE_W08 | 0.1 | 次因排除：发射功率偏低、覆盖方向偏差、周边遮挡；Day1 W5、W8、W9，；待确认 | 功率：现网低于规划值；方位：偏差＞TH08；遮挡：有勘察或GIS证据 | 次因命中→与主因并列记录，不自动确认；缺证据→未核查，不当作无 | F_08；TC03f |
| RULE_W09 | 0.1 | 次因排除：发射功率偏低、覆盖方向偏差、周边遮挡；Day1 W5、W8、W9，；待确认 | 功率：现网低于规划值；方位：偏差＞TH08；遮挡：有勘察或GIS证据 | 次因命中→与主因并列记录，不自动确认；缺证据→未核查，不当作无 | F_08；TC03f |
| RULE_W06 | 0.1 | 下倾角过小：总下倾偏离推荐下倾；Day1 W6，[覆盖汇总]A族6行；公式；待确认 | LTE宏站；rNear＝h÷tan(θ＋β/2)，rFar＝h÷tan(θ－β/2)，θ_t＝arctan(h÷Rt)＋β/2；缺口＝θ_t－θ＞TH01→命中。主因证据＝工参推算＋小区按派单规则达到派单条件（MR派单窗口）；MR距离—电平分布为补强证据，本次无输入（见未决事项） | 缺任一必需输入→未知并列缺项；NR→未知（公式未定义）；室分→未知（不适用）；不命中→转其他原因族 | F_02、F_03、F_04、F_08；TC01、TC03a、TC06、TC08 |
| RULE_W13 | 0.1 | 周边影响护栏：增强类措施不得伤到同天线小区与重叠邻区；Day1 W13，几何近似；待确认 | 范围：机械＝天线承载全部小区，电子＝目标阵列；①范围内每小区调整后rFar≥目标半径；②派单小区对每个重叠邻区的预测重叠指数不增大；Δ逐级减一个分辨率取第一个可行值 | 通过／调减／不通过；邻区工参缺失→未评估，不得批准 | F_10；TC01、TC02a～c、TC02f、TC03g、TC05a |
| RULE_W14 | 0.1 | 措施准入与约束；Day1 W14；单次上限与分辨率为测试假设；待确认 | 天馈类（含机械下倾）不得自动执行；单次Δ≤TH02且为TH03整数倍；缺口更大分轮；作用于2个以上小区或VIP／VVIP小区追加主管批准 | Δ＝0不可执行；越限拒绝 | F_09；A_04、A_05；TC01、TC07b |
| RULE_W16 | 0.2 | 效果判断：派单窗口与实施次日起的后窗同口径比较＋三层判断＋保护指标；Day1 W16，按[派单规则]口径；待确认 | 见“效果判断与持续观察”；达标与持续有效均以“不再满足派单规则”为准 | 后窗不足7天或保护指标缺数据→待评估；未知不记0 | F_11；TC01、TC02d、TC03e、TC07e、TC07f |
| RULE_G01 | 0.1 | 目标覆盖半径取法；本组拟定；待确认 | 默认＝TH14×最近站间距；可人工覆盖并留痕；样例直接给定250 m（0.5×500.4＝250.2） | 缺失→F_08、F_10返回未知 | F_08、F_10；TC02a～b |
| RULE_T01 | 0.3 | 工单粒度与来源：一个弱覆盖小区一张工单（[派单规则]“派单问题”为小区）；工单只能依发现结果开立，不是问题锚点（H14、INV_16）；待确认 | 同小区同问题类型未关闭时不重复建单，关联已有工单；已关闭后再次达到派单条件→新建并关联原单；建单须满足INV_16 | 站点类型未知→拒绝建单；未达到或证据不足→不建单 | A_01；TC01a、TC07a、TC09 |
| RULE_M01 | 0.1 | 原因—措施：弱覆盖小区天线下倾角过小→增大下倾角；[覆盖汇总]LTE第27行、NR第31行（备选“或在远端增强信号覆盖”本期不实现）；规则未验证，待确认 | 本小区侧；措施类型TILT_UP_MECH或TILT_UP_ELEC | 未命中F_08→不推荐；NR→公式缺口，转人工 | A_04；TC01、TC06c |
| RULE_M02（只登记） | 0.1 | M02：过覆盖小区天线下倾角过小（第87、89行）→增大下倾角；M03：重叠覆盖度权重值高的邻区对天线下倾角过小（第45、48行）→增大邻区侧天线下倾角；待确认 | 本期不实现：M02的护栏口径（过覆盖需防近端新增弱覆盖）、M03的作用对象（邻区侧天线）待确认 | — | 用例待补，见未决事项 |
| RULE_M03（只登记） | 0.1 | M02：过覆盖小区天线下倾角过小（第87、89行）→增大下倾角；M03：重叠覆盖度权重值高的邻区对天线下倾角过小（第45、48行）→增大邻区侧天线下倾角；待确认 | 本期不实现：M02的护栏口径（过覆盖需防近端新增弱覆盖）、M03的作用对象（邻区侧天线）待确认 | — | 用例待补，见未决事项 |
| RULE_W03（只登记） |  | 影响评估：受影响面积与采样占比、用户数、流量；Day1 W3 | 本次无用户面数据，只给覆盖影响，不推算用户数 | 缺业务数据→只给覆盖影响 | — |

## 派单规则（RULE_D01～D04，一般场景）

| 规则 | 制式 | 站点类型 | 单日弱覆盖采样点≥ | 占比≥ | 窗口 | 派单问题 |
|---|---|---|---|---|---|---|
| RULE_D01 | LTE | 宏站 | 2000 | 0.2 | 7天出现3天 | 宏站弱覆盖小区 |
| RULE_D02 | LTE | 室分 | 500 | 0.15 | 7天出现3天 | 室分弱覆盖小区 |
| RULE_D03 | NR | 宏站 | 2000 | 0.2 | 7天出现3天 | 宏站弱覆盖小区 |
| RULE_D04 | NR | 室分 | 500 | 0.15 | 7天出现3天 | 室分弱覆盖小区 |

## 措施类型字典

| 措施代码 | 名称 | 层级 | 执行方 | 可远程 | 分辨率 | 单次上限 | 方向 |
|---|---|---|---|---|---|---|---|
| TILT_UP_MECH | 增大机械下倾角 | 天线 | 现场维护 | 否 | 1° | 2° | 近中端增强、远端收缩 |
| TILT_UP_ELEC | 增大电子下倾角 | 小区阵列 | 参数平台或优化人员 | 是 | 0.1° | 2° | 同上 |

## 测试假设与参数

| 编号 | 假设 | 关联规则／函数 | 确认责任 |
|---|---|---|---|
| TH01 | 命中容差`eps`＝0.5° | RULE_W06；F_08 | 优化专家 |
| TH02 | 单次调整上限`maxStep`＝2° | RULE_W14；F_09 | 工程规范／优化专家 |
| TH03 | 调节分辨率：机械1°，电子0.1° | RULE_W14；F_09、F_10 | 工程规范 |
| TH07 | 告警与命中日重合占比门限`falseWeakShare`＝0.5 | RULE_W04；F_07 | 优化专家 |
| TH08 | 方位偏差门限＝20° | RULE_W05／W08／W09；F_08 | 优化专家 |
| TH09 | 最小改善幅度（占比绝对差）＝0.05 | RULE_W16；F_11 | 省优化主管 |
| TH11 | 后窗最少天数＝7天（与派单窗口同口径），不足则待评估 | RULE_W16；F_11 | 省优化主管 |
| TH12 | 判“持续有效”所需后窗天数＝14天，其中每个7天滑窗都不满足派单规则 | RULE_W16；F_11 | 省优化主管 |
| TH13 | 保护指标恶化容差＝0.02 | RULE_W16；F_11 | 省优化主管 |
| TH14 | 目标半径系数k＝0.5 | RULE_G01 | 优化专家 |
| TH15 | 理论覆盖半径采用简化平地模型（挂高相对覆盖面；θ＋β/2＜90°） | RULE_W06；F_02、F_04 | 优化专家 |
| TH16 | 预测重叠指数＝max(0, rFar(目标)＋rFar(邻区)－站间距)，只比较派单小区对邻区 | RULE_W13；F_10 | 优化专家 |

解析出的参数：`{"earthRadiusM":6371000,"eps":0.5,"maxStep":2,"tiltResolution":{"机械":1,"电子":0.1},"falseWeakShare":0.5,"azimuthDevThreshold":20,"effectMinDelta":0.05,"effectMinDaysAfter":7,"effectSustainDays":14,"protectionTolerance":0.02,"targetRadiusK":0.5}`
