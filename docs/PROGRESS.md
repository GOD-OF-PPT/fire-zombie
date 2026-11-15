# 项目进度与待办（交接文档）

《棱镜蜂群：霓虹协议》 PRISM SWARM: Neon Protocol — 竖屏 3D 跑酷射击（Three.js + Vite + TypeScript）。

## 1. 当前状态（HEAD `5fd4672`）

玩法与完整度：已完成（开始/暂停/结算/多关卡、数字门可射击改值、武器升级、Boss、音效静音等）。
美术升级（方向 A：CC0 骨骼 glTF + 卡通着色 + 描边 + Bloom）：**已落地并推送**。

| 项目 | 状态 |
|---|---|
| 12 个 CC0 Quaternius `.glb`（`public/models/`，约 4.1MB）+ `ATTRIBUTION.md` | ✅ |
| 卡通 3 段色阶材质 + 轮廓线（`src/render/models/toon.ts`） | ✅ |
| glTF 加载 / 骨骼动画 / 武器挂点（`src/render/models/gltfLibrary.ts`） | ✅ |
| Bloom 后处理、更近镜头（`src/render/Renderer.ts`） | ✅ |
| 阵形防重叠（队长/机甲分层、可见成员上限） | ✅ |
| 敌人/Boss 受击闪烁收敛、护盾/危险区透明度调整 | ✅ |
| README「美术与渲染管线」、构建脚本 `scripts/build-models.mjs` | ✅ |
| `tsc` + `vite build` 通过；vitest 34/34；playwright 10/10 | ✅（提交时） |

## 2. 缺失 / 待核查（"核心美术升级是否完整"的审计结果）

审计进行到一半被中断，截图在 SwiftShader 下超时。以下为**已发现或未验证**项：

### 疑似缺陷（需优先处理）
1. **Trooper 头盔仍偏黑**：GLB 内 `Black`=#2257d8，`Head` 节点含 `Grey|Character_Main|Black`，但截图仍近黑。排查方向：浏览器缓存旧 glb、卡通暗部色阶过暗、轮廓线遮盖、`bakeMeshColorGeo` 取色（线性/sRGB 空间）。
2. **Stan 机甲（`hero_mech.glb`）观感偏脏**：贴图型（`Stan_Texture`，非顶点色），灰绿偏暗、体型大（targetHeight 2.42）会遮挡后方队员。建议：通过 `uTint`/调色后贴图提亮、缩小高度、或换用顶点色重绘。
3. **无加载失败兜底**：GLB 未加载或加载失败时 `computeVisualSquadTargets` 返回空，队伍与敌人完全不显示（无程序化后备、无错误提示）。
4. **手持枪方向**：从背后镜头看像“向上的棍子”，需侧视/特写确认挂点朝向与缩放（`WEAPON_CHIBI_SCALE`）。

### 未视觉验证
- 奖励箱 3D 武器特写、敌人死亡动画、VICTORY 转身挥手、标题页、Overdrive V 阵形、冰冻减速染色
- 敌人特写：Bastion / Siphon / Mitosis / Dasher（仅见过 Crawler）
- 性能：未实测（每个角色 = 网格 + 描边两次绘制）。可读取 `window.__prism.renderer.renderer.info.render.calls`（注意：`info.render` 在 composer 多 pass 下每 pass 重置，需 `renderer.info.autoReset=false` 手动统计）
- 真机（iOS/Android GPU）、音频同步

### 代码清理
- `src/render/models/soldiers.ts` / `rig.ts` / `kit.ts` 可能残留未用导出（仍被道具、子弹、刀刃、奖励后备几何使用）。
- 构建 chunk 845KB 警告，可考虑动态 import / manualChunks。

## 3. 重要约束
- **不要改** `src/sim/` 与 `src/config/constants.ts`（`MAX_VISIBLE_UNITS=48` 有测试约束）；仅改渲染/表现层。
- 仅使用 CC0 资源，并在 `ATTRIBUTION.md`/README 记录。
- 模型朝向：所有 GLB 面向 +Z；怪物/Boss `facingYaw=0`，英雄 π（胜利时 0）。
- Three 会把 `Index1.R` 重命名为 `Index1R`。
- `scripts/build-models.mjs` 需要原始素材目录（默认 `/tmp/qmodels`，VM 重启会被清空；通过 `QMODELS_DIR` 指定）。重新构建需重新下载 Quaternius 源文件。
- 调色板：trooper `Black`→#2257d8、`Character_Main`→#2ed3ff；heavy `Hazmat_Main`→#ffbe24；omega `Demon_Main`→#eb1c44、`Black`→#44206e。

## 4. 本地运行与验证
```bash
npm install
npx vite --port 5173 --host 0.0.0.0     # 开发
npx tsc --noEmit && npx vitest run && npm run build
npx playwright test                      # 移动竖屏 + 桌面
```
截图辅助：`scripts/shot.mjs`（支持 `DPR` 环境变量，等待资源就绪）。调试对象：`window.__prism`（`sim`、`renderer.assetsReady`、`ui`、`state`、`frame(dt)`、`beginPlay()`、`fastForward(sec, autopilot)`、`autoplay`）。
软件渲染（SwiftShader）很慢：批量在一次 `page.evaluate` 内推进帧，循环要有上限，截图用 `?play=1&unlock=1&sector=N`。

## 5. 建议下一步（按优先级）
1. 修头盔偏黑 → 特写截图复核。
2. 机甲提亮/缩小或换顶点色；确认不遮挡队伍。
3. 增加加载失败兜底（程序化士兵后备或错误提示）。
4. 补拍未验证画面（奖励箱、死亡、胜利、Bastion/Siphon/Mitosis/Dasher），确认枪朝向。
5. 实测性能（draw calls / triangles），必要时合并描边或降级。
6. 测试相关任务最低优先级，改动后重跑 tsc / vitest / build / playwright 并刷新展示截图。
