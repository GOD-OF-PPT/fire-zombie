# 项目进度与待办（交接文档）

《棱镜蜂群：霓虹协议》 PRISM SWARM: Neon Protocol — 竖屏 3D 跑酷射击（Three.js + Vite + TypeScript）。

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
| `tsc` + `vite build` 通过；vitest 72/72；playwright 12/12（移动竖屏 + 桌面） | ✅（本轮，未提交） |

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

## 3. 本轮改动文件（未提交）
- 修改：`src/render/Renderer.ts`、`src/render/Effects.ts`、`src/render/models/gltfLibrary.ts`、`src/render/models/toon.ts`、`src/app/Game.ts`、`scripts/shot.mjs`、`tests/e2e/flows.spec.ts`、`.gitignore`（忽略 `.shots/`）
- 新增：`src/render/models/mechPalette.ts`、`proceduralRig.ts`、`proceduralLibrary.ts`、`proceduralBosses.ts`、`monsters.ts`；`scripts/closeup.mjs`；`tests/unit/render-procedural-models.test.ts`、`tests/unit/render-gltf-fold.test.ts`
- 未改 `src/sim/` 与 `src/config/constants.ts`。

## 4. 仍待处理
- **真机（iOS/Android GPU）、音频同步**：未测。GPU 负载未量化：峰值约 41 万三角形（每个 GLB 角色约 6–7K 三角形，描边再画一遍）+ DPR 上限 2 + 半分辨率 Bloom。若真机掉帧，优先考虑：DPR 上限降到 1.5、远处敌人/后排队员关描边、或降低角色面数。
- **偶发帧尖峰**：4× 降速下最大约 35 ms（p95 15 ms），未细查（疑似首次出现的特效/几何上传或 GC）。
- **代码清理**：`soldiers.ts` / `rig.ts` / `kit.ts` 仍被道具、子弹、刀刃以及程序化兜底使用，需逐个确认未用导出。构建包 881 KB（gzip 235 KB），超过 `chunkSizeWarningLimit: 800` 会报警告；程序化兜底约占 36 KB，故意静态打包——GLB 失败时网络可能同样不可用，动态 import 的兜底块也可能加载失败。
- **Windows 上跑 e2e**：本机由 Playwright `webServer` 启动的 preview 探测不到，120 s 超时。先手动 `npx vite preview --port 4173 --strictPort --host 127.0.0.1`，再 `npx playwright test`（配置里 `reuseExistingServer: true`）即可。

## 5. 重要约束
- **不要改** `src/sim/` 与 `src/config/constants.ts`（`MAX_VISIBLE_UNITS=48` 有测试约束）；仅改渲染/表现层。
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
1. 审阅并提交本轮改动。
2. 真机测试帧率、发热、音频同步；按结果决定 DPR 上限 / 描边 LOD / 面数。
3. 代码清理与 chunk 体积警告。
