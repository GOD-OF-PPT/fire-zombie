# 项目进度与待办（交接文档）

## 2026-11-17：V2 游戏完整性与美术精修

- 新增主动技能「相位脉冲力场」（`src/sim/aegis.ts`）、确定性暴击判定、炽热连杀倍率（`FEVER ×1.2~2.5`）、`1×/2×` 局内倍速与实时 DPS 面板。
- 无尽协议新增 4 组「双协议共鸣羁绊」（`src/config/protocols.ts`），三选一界面实时预览即将激活的羁绊。
- 强化工坊扩充至 6 项基础模块 + 无限等级「奇点超频 Lv.∞」+ 100% 免费重置；新增「战术档案·图鉴勋章」三栏弹窗与 12 项晶核奖励勋章，持久化统计首领与怪物生涯击杀数。
- 升级 5 色阶卡通着色器、流光跑道着色器、1024×1024 星环巨月天际线、空中飞车航道与探照灯束、角色/首领精细几何造型及 8 小节多轨 Synthwave 配乐。
- 模拟层全部 50 项单测通过，无头 Chromium WebGL 全流程零报错验证通过，同步输出默认单文件入口 `index.html`（原 `playable-v2.html`）。


《棱镜蜂群：霓虹协议》 PRISM SWARM: Neon Protocol — 竖屏 3D 跑酷射击（Three.js + Vite + TypeScript）。

## 2026-11-16：无尽模式与美术细化（当前工作区）

- 首页可直接进入「无尽协议」：随机阶段、三位首领轮回、递增威胁、阶段间保留编队与武器、独立纪录与结算。
- 首领击破后暂停并三选一强化，提供 6 条成长路线；战场在标准、重装与蜂拥事件间轮换。补员、共鸣重置、武器学习等级与环轨刃上限已处理。
- 角色增加涂装、陶瓷高光、通讯器和反应堆背包；装备仍合并至原蒙皮。场景加入机械维护单元、管线、道路标识、精细门框、建筑细节与月面远景。
- 修复跨阶段首领不可见、强化面板点击被拖动捕获、建筑窗灯插值噪点，以及重开继承局内增幅的问题。
- 构建及 85 项单测通过；模型合并测试覆盖新装备在动画姿态下的位置等价性。浏览器检查覆盖无尽流程、三选一、第二只首领显示、纪录与重开，以及原关卡与工坊。
- 本机 RTX 4060，390×844 / DPR 2，106 人代表画面，预热后 90 帧（含 GPU 完成等待）p50 1.6ms / p95 3.0ms，聚合 94 次 draw calls。此为单一桌面 GPU 场景采样，不代表手机真机或全流程峰值；手机性能及长期平衡仍待试玩验证。

下面各节保留此前开发记录，历史测试数字与美术描述不代表本轮状态。

## 1. 当前状态（HEAD `e842675` + 本轮未提交改动）

玩法与完整度：已完成（开始/暂停/结算/多关卡、数字门可射击改值、武器升级、Boss、音效静音等）。
美术升级（方向 A：CC0 骨骼 glTF + 卡通着色 + 描边 + Bloom）：已落地；上一轮审计发现的缺陷已在本轮修复，并完成性能实测与优化（第 2 节）。

| 项目 | 状态 |
|---|---|
| 12 个 CC0 Quaternius `.glb`（`public/models/`，约 4.1MB）+ `ATTRIBUTION.md` | ✅ |
| 卡通 3 段色阶材质 + 轮廓线（`src/render/models/toon.ts`） | ✅ |
| glTF 加载 / 骨骼动画 / 武器挂点（`src/render/models/gltfLibrary.ts`） | ✅ |
| GLB 加载失败兜底：程序化骨骼模型库 + 提示 | ✅（本轮） |
| 每个角色合并为单一蒙皮网格（含手持枪），draw calls 降 59% | ✅（本轮） |
| `tsc` + `vite build` 通过；vitest 77/77；playwright 14/14（移动竖屏 + 桌面） | ✅（本轮，未提交） |
| 玩法调整（门布局、Boss 狂暴、武器克制、手动超载、第 4 关随机回廊） | ✅（本轮，未提交，见 2.4） |

## 2. 本轮已解决

### 2.1 原"疑似缺陷"
1. **Trooper 头盔偏黑**：根因不是 GLB 颜色或缓存，而是描边。描边材质用 `BackSide`，three 会定义 `FLIP_SIDED` 并把 `transformedNormal` 取反，外壳沿法线**向内**收缩，盖住了头盔表面。`toon.ts` 描边着色器里撤销翻转、屏幕法线软归一化、视空间微推 0.035（缓存键 `prism-toon-outline-v2`）。另外角色着色亮度封顶 0.88（Bloom 阈值 0.93 以下），白色眼睛/骷髅不再泛白。
2. **机甲观感偏脏 / 遮挡**：`mechPalette.ts` 的 `regradeMechTexture` 给 `Stan_Texture` 重新调色；`targetHeight` 2.42→2.08；`computeVisualSquadTargets` 把机甲排到队伍前沿，不再挡住后排；队伍 ≥55 时数量徽章上移（badgeY 2.95）。
3. **无加载失败兜底**：`Renderer.loadActorModels()` 给 `loadGltfLibrary()` 加 30 s 超时，失败或超时改用 `buildProceduralLibrary()`（`proceduralRig.ts` / `proceduralLibrary.ts` / `proceduralBosses.ts` / `monsters.ts`，与 GLB 同名的动画和 `Index1R` 挂点，渲染层无需特殊分支）。`renderer.modelSource` 为 `loading | gltf | procedural | failed`；进入游戏后提示「模型加载失败，已切换为简化模型」。顺带修复：对象池复用敌人时残留 Death 定格姿态（`AnimatedActor.resetAnimation()`）。
4. **手持枪方向**：侧视特写确认 5 种枪都沿奔跑方向水平朝前（GLB 与程序化一致）。背后镜头里像"向上的棍子"是约 46° 俯角下的透视缩短，挂点和 `WEAPON_CHIBI_SCALE` 无需修改。

### 2.2 视觉验证（GLB 与程序化两套都看过）
奖励箱 3D 武器、敌人死亡、VICTORY 转身挥手、标题页、Overdrive V 阵形、冰冻减速、Bastion / Siphon / Mitosis / Dasher（含 Dasher 蓄力）实机与特写。

- **冰冻染色几乎不可见（已修）**：原来的乘法色 (0.58, 0.94, 1.42) 作用在全是暖色的怪物上，只让红色变暗一点。改为 `uFrost` 色相偏移：保留明暗（取 max 通道），向冰蓝混合，强度 0.78。接口 `setVisuals(flash, r, g, b, frost)`，材质缓存键 `prism-toon-char-v3`。

### 2.3 性能（实测 + 优化）
测法：`.shots/perf.mjs` 用自动驾驶跑完整关卡，每 0.25 s 模拟时间渲染一帧，`renderer.info.autoReset=false` 统计 composer 全部 pass；390×844 @DPR2（画布 780×1688），RTX 4060；帧 CPU 时间 = `Game.frame()` + `gl.finish()`；用 CDP 4× CPU 降速近似手机。

| 指标（GLB 模型） | 优化前 | 优化后 |
|---|---|---|
| draw calls 峰值（第 1 关） | 305 | 125 |
| draw calls 平均（第 1/2/3 关） | 205 / 174 / 177 | 82 / 75 / 76 |
| 三角形峰值 | 41.2 万 | 41.2 万（未变） |
| 每帧着色器程序查找（getParameters） | 约 108 次 | 0 |
| 帧 CPU p50 / p95，4× 降速，第 1 关 | 34.1 / 47.0 ms | 11.9 / 15.1 ms |
| 帧 CPU p50 / p95，不降速，第 1 关 | 5.5 / 9.0 ms | 0.8 / 3.0 ms |

程序化兜底模型：draw calls 峰值 177→125，三角形峰值约 14 万。

原因与改法：
- **一个角色多块网格**：Trooper = 身体 + 头盔 + 2 肩甲 + 枪，各带描边，共 10 次绘制。`gltfLibrary.ts` 的 `foldIntoSingleSkin()` 在构建模板时把挂在骨骼下的刚体部件转成刚性蒙皮顶点、把同骨架的其它 SkinnedMesh 重映射，全部并入一个 SkinnedMesh；`weaponSkinsFor()` 把 5 种枪烘焙到手骨上（共享一份顶点缓冲，只换索引，换枪 = 换 geometry）。现在每个英雄/怪物/Boss = 1 网格 + 1 描边。被动画直接驱动的非骨骼节点、带贴图或 morph 的网格不会合并，保持原样。
- **同一材质交替画蒙皮/非蒙皮网格**（身体 vs 头盔/枪）：three 每次切换都会重做整套程序查找。合并后不再混用；剩余刚体部件用共享 uniform 的孪生材质；描边材质按 宽度/颜色/是否蒙皮 缓存共享。
- **加法混合的 DoubleSide 透明材质被画两遍**（背面 + 正面，且每遍重新查找程序）：加 `forceSinglePass: true`（加法混合与顺序无关，画面不变）。
- **隐藏的池化角色仍在每帧更新骨骼矩阵**：`ActorRoot.updateMatrixWorld` 在隐藏时跳过整棵子树。

正确性：`tests/unit/render-gltf-fold.test.ts` 对 11 个 GLB（机甲只有一个网格，不需合并）在动画姿态下比较合并前后每个顶点的世界坐标（误差 <1e-3；故意改错刚体变换时该测试会失败）；程序化测试检查烘焙进蒙皮的枪顶点与手骨位置一致（<1e-4）。合并前后的特写截图逐像素比较：GLB 英雄与 5 种怪物 diff = 0。

### 2.4 玩法调整（已验证）
依据无画面模拟的打法对比：原关卡里好门几乎都在左侧，全程贴左不动就能三关通关；不瞄准也能拿 2–3 星；第 1 关 Boss 反而最难。只改了配置（`src/config/sectors.ts`、`src/app/meta.ts`），没动 `src/sim/`：
- 三关的好门改为左右交替；两侧都有致命固定门（例如第 1 关 d228 右 -22、d260 左 -28），贴边不动会死。
- 第 1 关新增：d260 致命门、d340 环轨刃能量舱（与 d368 右侧可射击门 -2→+16 争火力）、d440 "稳拿 +12 / 射击 -4→+24"、d680 右侧单门 -8。
- Boss 血量：第 1 关 5600→7500，第 2 关 22000→26000，第 3 关 31000→70000（配合按比例扣人与人数增长，自动驾驶 Boss 战约 13 / 24 / 26 s）。
- 星级门槛：第 1 关 [60, 140]，第 2 关 [80, 165]，第 3 关 [100, 200]（不瞄准的打法最多 2 星）。
- 验证：`sim-sectors-balance.test.ts`、e2e 全通流程均通过；`.shots/analysis/balance.test.ts` / `sweep.test.ts` 对比各打法（见下方"模拟结果"）。
- 已改 `src/sim/`（新开关默认关闭，单测、平衡机器人和标题页演示仍走原逻辑）：
  - Boss 命中按队伍规模扣人：每 100 人扣 `strikeLoss` / `hostileLoss` 人，下限为其一半（`bosses.ts` 的 `scaledBossLoss`）。
  - 共鸣超载手动释放：`RunModifiers.manualOverdrive` 时满槽保持，`InputSample.overdrive` 触发；HUD 共鸣槽满后可点击，或按空格。
  - 每局镜像：`RunModifiers.layoutSeed` 把"一排门 + 它之前的遭遇"作为一段随机左右翻转（`spawner.ts` 的 `computeMirrorFlags`）；重试保持同一布局；URL `?seed=0` 固定为原始布局（e2e 已改用）。
- 第 2 关：d186 改为"×2 还是 +12"；d248 能量舱移到差门侧；d722 的 ×2 锁门改为"射击 +8→+36 / 稳拿 +24"，压住滚雪球；d584、d940 新增并排二选一能量舱；d872、d998 在好门前放怪。
- 第 3 关：补空档，新增 d506 怪群 + d520"射击 -4→+20 / 稳拿 +12"、d905"稳拿 +15 / 射击 -10→+30"、d1075 重甲守在好门前。
- 武器克制（`config/weapons.ts` 的 `WEAPON_COUNTER_MULT`）：脉冲→骷髅灵 ×1.5，散射→刺球 ×1.4 / 史莱姆 ×1.3，贯穿→重甲 ×1.8，爆破→史莱姆 ×1.6 / 刺球 ×1.2，冰冻→迅龙 ×1.6；奖励说明同步。
- 怪物冲线最大减员：迅龙 4→6、重甲 8→12、史莱姆 4→6、骷髅灵 4→6（刺球不变，保护新手开局）。
- 工坊：总价 2650→2140，伤害每级 8%→6%；Boss 血量随工坊总等级 +2.5%/级（满级 ×1.375，`RunModifiers.bossHpMult`）。
- **Boss 软狂暴**（瞄准回报）：只调门数值拉不开差距（不瞄准时居中站位也能把门打满），改为惩罚慢打。`BossConfig.enrageAfterSec`（第 1/2/3 关 11 / 26 / 42 s）后，攻击/召唤/弹幕计时器按 +8%/s 加速（上限 ×2），并每 2 s 发出一次无法躲避的核心脉冲（每 100 人扣 4 人）。HUD 首领名后显示"· 狂暴"并闪烁。未配置该字段的首领不受影响。
- **第 3 关空档**：新增 d628 怪群（重甲 + 刺球 + 迅龙）、d722 右侧可射击单门 -6→+12、d812 史莱姆群、d982 左侧可射击单门 -4→+10。跑道空闲占比 22.8%→17.6%。
- **第 4 关「随机回廊」**（通关第 3 关解锁）：`src/config/gauntlet.ts` 按布局种子生成整条跑道（1300 u，16.5 u/s，开局 6 人）。开局一排教学门，之后三幕各一副"牌组"（致命门 / 取舍门 / 必射门 / ×2 / 锁门 / 可射击单门 / 负面单门），每局只换顺序、左右和数值；门与门之间填怪群、并排能量舱（3 组）、电容桶 + 怪、棱镜。前 5 排的差门只扣人不致死。首领按种子在三位首领中轮换（"·极"版：魔像王 24000 / 魔龙 27000 / 魔王 70000 HP）。星级 [150, 300]；挑战：通关一次、击破 6 个能量舱、通关时 ≥300 人。开场横幅显示本局首领和"布局 #种子"，结算"新布局再战"即换一张图。
  - 接入方式：`getSectorScript(sector, seed)`（第 1–3 关返回手工脚本，第 4 关按种子生成并缓存）；`SimWorld.script` 保存本局脚本，`spawner.ts` / `bosses.ts` 改读它；`SectorId` 扩为 1–4，存档、标题卡片、音乐、配色同步。
  - 测试：`tests/unit/sim-gauntlet.test.ts`（同种子结果一致、12 个种子布局互不相同且覆盖 3 位首领、60 个种子结构合法、种子 1–6 自动驾驶通关且 AFK 失败）；e2e 新增"第 4 关默认锁定，解锁后 `?seed=5` 自动驾驶通关"。

模拟结果（`?seed=0` 原始布局；比率 = 自动驾驶 / 只挑门不瞄准 的终局人数）：

| 区域 | 自动驾驶 | 只挑门 | 比率 | 人类延迟 | 迟钝玩家 | 空闲占比 |
|---|---|---|---|---|---|---|
| 1 | 149 ★3（Boss 13.4 s） | 86 ★2 | 1.73 | 113 ★2 | 66 ★2 | 11% |
| 2 | 172 ★3（24.6 s） | 122 ★2 | 1.41 | 192 ★3 | 103 ★2 | 17% |
| 3 | 250 ★3（22.7 s） | 58 ★1 | 4.31 | 258 ★3 | 90 ★1 | 18% |
| 4（40 个种子） | 胜 40/40，均 340 ★3.0 | 胜 40/40，均 224 ★2.5 | 1.52 | 胜 29/40 | 胜 16/40 | — |

贴左 / 贴右不动在第 1–3 关都会死于减员门；第 4 关 AFK 40/40 失败。
## 3. 本轮改动文件（未提交）
- 修改：`src/render/Renderer.ts`、`src/render/Effects.ts`、`src/render/models/gltfLibrary.ts`、`src/render/models/toon.ts`、`src/app/Game.ts`、`scripts/shot.mjs`、`tests/e2e/flows.spec.ts`、`.gitignore`（忽略 `.shots/`）
- 新增：`src/render/models/mechPalette.ts`、`proceduralRig.ts`、`proceduralLibrary.ts`、`proceduralBosses.ts`、`monsters.ts`；`scripts/closeup.mjs`；`tests/unit/render-procedural-models.test.ts`、`tests/unit/render-gltf-fold.test.ts`
- 玩法轮新增：`src/config/gauntlet.ts`、`tests/unit/sim-gauntlet.test.ts`；修改 `src/config/{sectors,enemies,weapons}.ts`、`src/app/{Game,meta,save}.ts`、`src/sim/{bosses,combat,entities,index,resonance,spawner,world}.ts`、`src/types/game.ts`、`src/ui/UI.ts`、`src/input/InputController.ts`、`src/audio/AudioEngine.ts`、`src/styles/main.css`、单测与 e2e。
- 未改 `src/config/constants.ts`。

## 4. 仍待处理
- **真机（iOS/Android GPU）、音频同步**：未测。GPU 负载未量化：峰值约 41 万三角形（每个 GLB 角色约 6–7K 三角形，描边再画一遍）+ DPR 上限 2 + 半分辨率 Bloom。若真机掉帧，优先考虑：DPR 上限降到 1.5、远处敌人/后排队员关描边、或降低角色面数。
- **偶发帧尖峰**：4× 降速下最大约 35 ms（p95 15 ms），未细查（疑似首次出现的特效/几何上传或 GC）。
- **代码清理**：`soldiers.ts` / `rig.ts` / `kit.ts` 仍被道具、子弹、刀刃以及程序化兜底使用，需逐个确认未用导出。构建包 881 KB（gzip 235 KB），超过 `chunkSizeWarningLimit: 800` 会报警告；程序化兜底约占 36 KB，故意静态打包——GLB 失败时网络可能同样不可用，动态 import 的兜底块也可能加载失败。
- **Windows 上跑 e2e**：本机由 Playwright `webServer` 启动的 preview 探测不到，120 s 超时。先手动 `npx vite preview --port 4173 --strictPort --host 127.0.0.1`，再 `npx playwright test`（配置里 `reuseExistingServer: true`）即可。

## 5. 重要约束
- `src/sim/` 须保持确定性；新玩法开关（手动超载、镜像布局）默认关闭，测试与标题页演示走原逻辑。Boss 狂暴由 `BossConfig.enrageAfterSec` 配置驱动，第 1–3 关默认开启。不要改 `src/config/constants.ts`（`MAX_VISIBLE_UNITS=48` 有测试约束）。
- 仅使用 CC0 资源，并在 `ATTRIBUTION.md`/README 记录。
- 模型朝向：所有 GLB 面向 +Z；怪物/Boss `facingYaw=0`，英雄 π（胜利时 0）。
- Three 会把 `Index1.R` 重命名为 `Index1R`；英雄的枪烘焙在这根骨骼上。
- `buildTemplate` 先测量包围盒、再合并网格（已调好的 targetHeight 基于未合并部件的采样）；调整顺序会让角色尺寸轻微变化。
- `scripts/build-models.mjs` 需要原始素材目录（默认 `/tmp/qmodels`，VM 重启会被清空；通过 `QMODELS_DIR` 指定）。重新构建需重新下载 Quaternius 源文件。
- 调色板：trooper `Black`→#2257d8、`Character_Main`→#2ed3ff；heavy `Hazmat_Main`→#ffbe24；omega `Demon_Main`→#eb1c44、`Black`→#44206e。

## 6. 本地运行与验证
```bash
npm install
npx vite --port 5173 --host 127.0.0.1    # 开发（Windows 上用 127.0.0.1）
npx tsc --noEmit && npx vitest run && npm run build
npx playwright test                      # 移动竖屏 + 桌面；Windows 见第 4 节
```
截图辅助（`GPU=1` 用本机显卡，比 SwiftShader 快很多；`BLOCK_GLB=1` 拦截 GLB 请求，查看程序化兜底）：
- `scripts/shot.mjs <dir> mid|basic|boss|result|defeat|workshop`（支持 `DPR`、`PROG`、`SECTOR`、`SKIPINTRO`）。
- `scripts/closeup.mjs <dir> [trooper,heavy,mech,crawler,dasher,bastion,mitosis,siphon,warden,hydra,omega]`：单个角色背面/正面/侧面特写。

调试对象：`window.__prism`（`sim`、`renderer.assetsReady`、`renderer.modelSource`、`ui`、`state`、`frame(dt)`、`beginPlay()`、`fastForward(sec, autopilot)`、`autoplay`、`stop()`）。统计 draw calls 时设 `renderer.renderer.info.autoReset=false` 并在每帧前手动 `reset()`。
软件渲染（SwiftShader）很慢：批量在一次 `page.evaluate` 内推进帧，循环要有上限，截图用 `?play=1&unlock=1&sector=N`。

## 7. 建议下一步（按优先级）
1. 审阅并提交本轮改动（含玩法轮）。
2. 真人试玩第 4 关多个种子，确认难度曲线；必要时调 `gauntlet.ts` 的数值系数或首领血量。
3. 真机测试帧率、发热、音频同步；按结果决定 DPR 上限 / 描边 LOD / 面数。
4. 代码清理与 chunk 体积警告。
