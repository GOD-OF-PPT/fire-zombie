# 无尽排行榜接入

## 正式配置

| 项目 | 当前配置 |
| --- | --- |
| 服务 | `https://ranking-api-production-a8ed42bc.up.railway.app` |
| 游戏 | `fire-zombie` / 棱镜蜂群：霓虹协议 |
| 正式榜 | `endless-score` / 无尽总分榜 |
| 排序 | `score desc` → `wave desc` → `distance desc` |
| 更新方式 | `best`，保留最好一次的完整成绩与显示信息 |
| 访问 | 公开查询，开启游客提交 |
| 联网验收榜 | `integration-check` / 接入验收（非正式），游戏正常流程不会向此榜上传 |

游戏与两个榜单已在现有服务中创建。正式榜只接收正常游戏流程的成绩。前端使用指南第 9 节的 TypeScript / 原生 fetch 接法，身份及存储规则与部署的浏览器 SDK 一致。

接入指南：<https://github.com/GOD-OF-PPT/common-game-ranking-list/blob/main/docs/web-game-integration.md>。

## 玩家流程

1. 无尽模式失败或在阶段强化页选择「携赏金安全撤离」后，保存本地纪录、发放奖励并显示结算。
2. 尚未填写姓名时打开姓名弹窗；输入去除首尾空格后的 1–80 个字符。说明姓名会公开展示，并保存在当前设备。
3. 点击“保存并上榜”后，保存 `prism-swarm-save-v1.leaderboardName`，提交本局结算快照。可选择“稍后填写”，此时没有提交或身份申请。
4. 后续无尽结算会使用已保存的姓名自动上报，包括安全撤离。普通区域、随机回廊及标题演示不提交。
5. 上报后显示接受结果及服务返回的个人名次。`accepted:false` 表示保留历史最好成绩，不作为失败。
6. 首页和无尽结算均可打开排行榜。公共榜单查询不申请游客身份；已有姓名时再查询个人名次。

## 上报内容

| 字段 | 内容 / 单位 |
| --- | --- |
| `username` | 玩家确认的公开显示名，不作为身份标识 |
| `metrics.score` | 本局实际结算得分，整数 |
| `metrics.wave` | 本局抵达阶段，整数 |
| `metrics.distance` | 本局累计推进距离，游戏内米，最多三位小数 |
| `metrics.duration` | 游戏记录的本局活动时长，秒，最多三位小数；不参与本榜排序 |
| `info.mode` | `endless` |
| `info.bosses` / `kills` / `maxCombo` | 本局首领击破数、击杀数和最高连杀 |

上传的是同一局的冻结快照，不会把本地各自独立的最高得分、阶段、距离等纪录拼成一局。手动重试使用相同快照。服务返回的 `rank` 用于展示，支持并列名次，不使用数组下标推算排名。

## 身份与失败处理

- 一个游戏页面只创建一个客户端实例，复用进行中的身份请求。
- 按服务 SDK 的 `ranking:v1:<baseUrl>:<game>` 键存储匿名玩家 ID、玩家令牌与过期时间。刷新后复用；不自行生成服务端玩家 ID。
- 存储不可用时退化为实例内存存储。服务匿名令牌约 30 天有效；不同来源、端口、浏览器和设备的身份不会自动合并，用户名相同也不会合并。
- 每个请求有 10 秒超时并使用 AbortController 取消；不在帧循环上传、轮询或无限重试。
- 上传失败时保留当前结算结果，提供手动重试。离开 / 重开后，旧响应不会重新打开结算或覆盖新游戏 UI。
- 接受上报后，即使查询名次失败，仍显示“已上传”；个人未上榜的 404 显示为空状态。限流、身份失效和网络故障有独立提示。
- 不自动丢弃仍在有效期内的身份来绕过 401。网页只使用服务签发的玩家令牌，管理密钥及后端游戏密钥不写入源码、产物或玩家存档。
- 远端玩家姓名使用 DOM textContent 输出，避免作为 HTML 执行。

## 代码入口

- `src/services/leaderboard.ts`：公开配置、身份复用、HTTP 协议与超时。
- `src/ui/LeaderboardUI.ts`、`src/styles/leaderboard.css`：姓名弹窗、上报状态、榜单与分页。
- `src/app/Game.ts`：无尽结算时冻结本局成绩，处理上报、重试和异步响应生命周期。
- `src/app/save.ts`：向旧 v1 存档兼容添加姓名字段。
- `src/standalone.ts`、`scripts/standalone-template.html`、`scripts/build-standalone.mjs`：生成默认单文件入口 `index.html`；开发、预览根地址直接加载该入口，生产构建同名输出到 `dist/`。原 `playable-v2.html` 已重命名，旧地址在开发和预览服务器中保留参数并跳转。

## 验证（2026-11-17）

- `npm run build` / TypeScript 检查通过；98 项单测通过。
- 26 项桌面 / 移动浏览器测试通过，覆盖首次输入、空姓名校验、刷新复用姓名和身份、实际本局指标、`accepted:false`、断网重试、旧响应隔离、并列排名、分页、名称 HTML 转义、普通关卡隔离、稍后填写和单文件入口。
- 自动回归请求使用拦截响应，不向正式服务写入成绩。
- 重新生成的单文件版本通过 `file://` 离线启动及相位脉冲输入检查；离线核心玩法不依赖排行榜服务。
- 在 `http://127.0.0.1:5188` 的真实浏览器来源调用部署的 HTTPS API，使用独立 `integration-check` 验收榜：首次提交返回 `accepted:true`；刷新后相同玩家 ID；较差成绩返回 `accepted:false` 且姓名和最佳得分不变；第二个游客的相同排序指标得到并列第 1 名。
- 联网验收榜保留两条明确标注的测试记录。验收期间没有向 `endless-score` 发送成绩 POST；正式榜公开跨域查询成功。
- 本地证据：`.shots/ranking-review/live-report.json`、`first-name.png`、`leaderboard-live.png`、`formal-board.jpg`、`e2e-report.json`。这些临时验收文件不随业务代码发布。

手机真机、跨设备身份合并及服务端可信分数验证不属于本次已验证范围；身份和计分可信性沿用排行榜服务的游客直传协议。
