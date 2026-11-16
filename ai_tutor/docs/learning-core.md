# 本地学习存储与复习算法交接

> 本文记录学习功能初次集成时的实现与验证。当前目录、模块入口与测试命令见 [项目说明](../../README.md)。应用壳版本已更新为 `ascii-v1`，离线清单为28项。初次集成的截图和报告归档在 `evidence/learning-v1/`。

## 本线程交付

分支为 `codex/learning-core`，基于 `c7f8759`。独立工作树为仓库下的 `.worktrees/learning-core`，本机 `.git/info/exclude` 已加入 `/.worktrees/`。检查了仓库祖先目录和 `成员三` 下的适用路径，本次未发现 `AGENTS.md`。实现遵循 `docs/handoff/learning-plan/00-coordination.md`。

交付文件如下。

- `static/learning-store.js`
- `static/review-scheduler.js`
- `tests/learning_core_test.mjs`
- `docs/learning-core.md`

提交编号随最终交接消息提供，可在本工作树执行 `git log -1 --format=%H` 核对。提交信息为 `feat: add local learning storage and review scheduler`。

## 模块接口

两个生产模块均为浏览器原生 ES 模块，统一资源标记为 `learning-v1`。

```js
import { learningStore } from './learning-store.js?v=learning-v1';
import { createCard, scheduleReview, buildReviewQueue } from './review-scheduler.js?v=learning-v1';
```

`learningStore` 是冻结的单例。以下方法返回 Promise，`subscribe` 同步返回取消订阅函数。存储失败以异常返回，页面应展示 `error.message`。

| 方法 | 参数及返回 | 接入含义 |
|---|---|---|
| `ready()` | `Promise<void>` | 打开数据库并完成升级，失败后可重试 |
| `snapshot()` | `Promise<LearningSnapshot>` | 返回完整对话、事件、卡片、作答、收藏、设置与课程快照 |
| `migrateLegacy(records)` | `Promise<{imported}>` | 迁移传入的完整旧记录数组，跳过无效条目，重复迁移去重 |
| `ingestConversation(record)` | `Promise<{conversationId}>` | 白名单保存完整对话，成功回答生成行为事件与两类卡 |
| `recordVisit(knowledgeId, at?)` | `Promise<void>` | 记录详情浏览，每次调用生成新的浏览事件 |
| `enroll(knowledgeId, at?)` | `Promise<void>` | 两类卡进入当前任务，知识点级稳定事件使重复调用幂等 |
| `saveAttempt(attempt)` | `Promise<{card, attempt}>` | 保存原始作答并重算卡片，相同ID返回已提交结果 |
| `saveBookmark(bookmark)` | `Promise<void>` | 保存知识或回答收藏与难点备注 |
| `removeBookmark(id)` | `Promise<void>` | 删除指定收藏 |
| `saveCourse(course)` | `Promise<void>` | 保存完整43知识点的课程快照 |
| `saveSettings({dailyLimit})` | `Promise<void>` | 接受3至12的整数，默认6 |
| `clearConversations()` | `Promise<void>` | 清空对话及回答收藏 |
| `exportArchive()` | `Promise<object>` | 导出全部个人数据与设置 |
| `importArchive(archive)` | `Promise<{imported, duplicates}>` | 校验、原子合并及重算 |
| `resetLearningData()` | `Promise<void>` | 清空个人学习数据，保留课程快照 |
| `subscribe(listener)` | `() => void` | 本页提交及同源其他标签页提交时通知，回调重新读取快照 |

三个算法入口保持共享约定中的签名。

```js
createCard(knowledgeId, type, now)
scheduleReview(card, attempt, previousAttempts)
buildReviewQueue({ cards, events, attempts, knowledge, now, timeZone, limit })
```

`createCard` 与 `buildReviewQueue` 接受显式 `now`。`scheduleReview` 使用作答的 `at`。函数返回新对象，传入数组及卡片保持原有值。直接调用 `scheduleReview` 时，历史应按UTC时间、ID顺序提供，重复ID返回传入卡片的副本。存储层处理迟到作答并负责全历史重算。

模块还导出 `ALGORITHM_VERSION`、`REVIEW_CONFIG`，以及存储与测试共用的 `assertKnowledgeId`、`normalizeTime`、`localDay`、`normalizeAttempt`、`effectiveGrade`、`compareAttempts`。

## 数据表与事务

数据库名为 `r-language-tutor-learning`，当前 IndexedDB 版本为1，档案schema版本为1。每表主键均为 `id`。

| 表 | 数据与主键 | 索引 |
|---|---|---|
| conversations | `{id, record}`，请求ID存在时为 `request:<request_id>`，否则为规范化白名单记录的 `legacy:<SHA256>` | `record.time` |
| events | 共享约定中的 `LearningEvent`，对话事件为 `conversation:<conversationId>`，主动加入为 `enroll:<knowledgeId>` | `knowledgeId`, `at` |
| cards | 共享约定中的 `ReviewCard`，主键为 `K06:concept` 等 | `knowledgeId`, `dueAt` |
| attempts | 共享约定中的 `ReviewAttempt`，内部另存 `resultCard` 以支持提交重试返回 | `cardId`, `at` |
| bookmarks | 共享约定中的 `Bookmark` | `conversationId` |
| settings | `{id: 'current', value: {dailyLimit}}` | 无 |
| course | `{id: 'current', value: course}` | 无 |

快照及导出剥离内部 `resultCard`。所有持久化时间规范化为UTC毫秒精度ISO字符串。知识编号限制为课程中的K01至K43。时区为作答时的IANA名称，包含 `UTC`。

所有写操作在覆盖七张表的单个 `readwrite` 事务内读取当前状态、计算差异并提交。跨标签页事务由IndexedDB串行执行，同步请求回调中的计算兼容WebKit的事务生命周期。任一步骤失败中止整个事务。成功提交后通知本页，并通过BroadcastChannel通知其他标签页，缺少BroadcastChannel时使用 `storage` 事件。

相同请求ID的对话首次提交生效，接收时间变化的网络重试继续返回原稳定ID。作答ID重复提交直接返回已保存的作答和该作答的排程结果。迟到作答或档案合并可能重算后续结果，页面应在变更通知后获取最新快照。

收藏按 `updatedAt` 选择较新版本，同一时间按字段规范化JSON确定唯一结果。档案中的对话、事件或作答ID发生内容冲突时，整份导入失败并给出冲突ID。

升级时递增 `DATABASE_VERSION`，在 `onupgradeneeded` 的升级事务中按旧版本增加表、索引或转换已有行。当前版本实现从新库创建七表和索引。`versionchange` 会关闭旧连接，升级阻塞和浏览器存储不可用均返回可展示错误。后续算法规则变化应同步调整算法版本、重算策略及档案版本迁移，保留原作答时区。

## 行为证据与重算

- `recordVisit` 生成 `view`，浏览本身保持卡片档案状态。
- 成功回答的 `status` 为 `ok` 时，绑定 `response.related_knowledge[0]`，缺少该项时使用 `request.knowledge_id`。附带引用完整保存在对话来源中。
- 普通讲解生成 `study`，练习请求及其参考答案生成 `exercise_view`，代码纠错生成 `debug`。`request.teaching_mode` 保留提示与参考解的区别。
- `study`、`exercise_view`、`debug` 为对应知识点建立概念和应用两类卡，首次到期时间为学习后24小时。上述行为独立于复习评级。
- 主动加入生成 `enroll`，首次主动加入将两类卡拉入当前任务。重复加入保留已有结果。
- 评级由已保存的有效作答建立，保留自评或客观题来源。导入卡片的等级由事件与作答重算。仅有卡片且缺少事件时，以其 `enrolledAt` 恢复0级新卡。
- 重算将事件与作答按UTC时间排序，同一时刻先处理事件，作答再按ID排序。不同设备导入顺序保持相同排程。

## 算法版本与参数

算法版本为 `review-v1`。全部策略参数集中在 `REVIEW_CONFIG`。

| 参数 | 当前值 |
|---|---|
| 六级间隔 `intervalDays` | 1、3、7、14、30、60天 |
| 一天 `dayMs` | 86400000毫秒 |
| 重试 `retryMs` | 600000毫秒 |
| 每卡每天自动次数 `dailyCardLimit` | 2 |
| 每批首次检测数 `firstDetectionLimit` | 2 |
| 默认每批任务数 `defaultLimit` | 6 |
| 可选任务数 `minLimit` / `maxLimit` | 3 / 12 |
| 先修深度 `prerequisiteDepth` | 1，使用直接先修 |
| 优先级权重 | 逾期40、最近失败30、先修补强20、主动标记10 |

`again` 回到0级重学，10分钟后重试。同一自然日的第二次作答仍失败时，安排24小时后的检测，界面应显示继续讲解入口。

`hinted` 下降一级，最低0级，24小时后检测。提示或首次答案锁定前查看参考答案，使评级上限为 `hinted`。`again` 保持失败结果。

`good` 在跨日独立回忆时上升一级。`easy` 还要求 `variantPassed`，符合时上升两级，最高5级。缺少变式通过证据时按 `good` 处理。

本轮明确采用以下独立回忆判定，供界面与验收核对。

- 当前作答与上一作答属于不同本地自然日，首次检测与入卡时间属于不同日。
- 距离上一作答或首次入卡至少24小时。
- 已到期，且当前作答时区中当天尚无此卡作答。
- 提示和答案使用情况满足独立完成条件。

符合条件时按新等级间隔安排。提前练习、主动加入当天通过、重学当天通过和同日重复刷同题均安排24小时后检测，保持原等级。夏令时与旅行时区变化仍须满足完整24小时。

排程的同日判断使用本次作答保存的 `timeZone`，队列当日次数使用调用方当前设备时区。相同作答ID计数一次，每张卡当日最多两个自动任务。该限制按已提交作答计数，手动讲解与补充学习可继续。

队列优先级采用协作约定公式。逾期程度为逾期时长除以该卡本次原定间隔，最高1，立即入队卡片的分母下限为1毫秒。最近失败指最近有效评级为 `again`。主动标记来自 `enroll` 事件。相同优先级按到期时间、卡片ID的字符顺序稳定排序。

到期错题的直接先修知识缺少独立通过证据时，为其概念卡安排补强。关系去重，忽略自环和缺失编号，深度限制为1。已有先修卡可临时提前到当前队列，缺少卡片时返回一张0级候选卡，持久化从真实作答开始。先修卡同样受每天两次及每批两道首次检测题的约束。

## 档案格式与校验

```js
{
  app: 'r-language-tutor',
  schemaVersion: 1,
  exportedAt: '2026-11-16T04:00:00.000Z',
  knowledgeVersion: '916ec03645ae',
  data: { conversations, events, cards, attempts, bookmarks, settings }
}
```

完整对话数量独立于界面显示的100条限制。课程快照通过离线包下载，档案记录课程版本。无已下载课程时取最近对话版本，仍缺失时写入 `unknown`。

导入先校验可序列化JSON、应用标识、schema、UTC时间、知识编号、数组数量、文本长度、布尔值和数值等字段，再开启合并事务。当前限制如下。

| 项目 | 限制 |
|---|---|
| UTF-8 JSON档案 | 20 MiB |
| 对话 / 事件 / 作答 | 100000 / 200000 / 100000条 |
| 卡片 / 收藏 | 86 / 100043条 |
| 一般文本 / 作答文本 / 难点备注 | 100000 / 20000 / 20000字符 |
| 收藏标题 / 一般嵌套数组 | 1000字符 / 1000项 |
| 作答、事件、题目ID | 200字符 |
| 回答请求ID | 128字符 |

对话沿用 `app.js` 的字段白名单，外加类型和长度校验。请求上下文 `history` 和未知字段在保存及迁移时丢弃。`request_id` 用于稳定身份。迁移跳过无效旧条目，档案校验失败则整份拒绝。

导入的 `imported` / `duplicates` 统计对话、事件、作答、收藏四类行。卡片为派生状态，设置应用档案中的值，课程快照继续使用设备已有版本。回答收藏须关联合并后存在的对话。清空对话后保留的学习事件可以带历史对话来源ID。

## 界面线程接入位置

1. 启动时先 `await learningStore.ready()`。从 `r-tutor-mock-v1` 读取原始数组，在现有 `.slice(-100)` 之前传给 `migrateLegacy`。迁移成功后从快照恢复显示用记录，可对渲染列表分页。迁移失败应保留旧键以便重试，成功迁移后移除旧键或写入已迁移标记。
2. 在 `app.js` 的 `send()` 收到完整成功响应后，将本轮 `{time, request, response, display_question?}` 交给 `ingestConversation`。持久化应在 `records = records.slice(-100)` 前完成，并保留返回的 `conversationId` 供收藏与定位。
3. 修改当前 `save()` 的localStorage写入路径，统一从IndexedDB恢复完整档案。清空时先等待 `clearConversations` 成功再更新画面，并同步清理旧localStorage键，避免旧记录在刷新后重新迁移。
4. 当前导出按钮在 `app.js` 约573行。完整档案导出使用 `exportArchive()` 结果，导入读取JSON后调用 `importArchive()`，成功后刷新快照。数据重置单独调用 `resetLearningData()`。
5. 知识详情打开调用 `recordVisit`，主动加入调用 `enroll`。课程接口成功或离线包下载成功后，将原始 `data/course.json` 同结构对象交给 `saveCourse`。
6. 复习进入时从同一份快照调用 `buildReviewQueue`。`knowledge` 传完整知识对象数组，含原始 `prerequisites` 字段。`limit` 使用 `snapshot.settings.dailyLimit`，`timeZone` 使用设备当前IANA时区。
7. 首次答案锁定时固定 `hintUsed` / `answerRevealed`。锁定后展开参考内容自评时继续使用锁定状态。空答案仅允许 `again`。提交前生成一次 `crypto.randomUUID()`，失败重试复用该作答ID和原始时间、时区。
8. 缺少题库项或课程内容时保留卡片并显示原因。队列接口只能判断知识对象缺失，题库题目、参考答案与引用完整性由界面检查。虚拟先修卡可直接传其稳定 `cardId` 给 `saveAttempt`，也可通过 `enroll` 主动加入两类卡。
9. 跳过或退出时保持卡片待处理。界面会话内跳过当前项后继续下一项，刷新时读取实际已提交作答重新构建队列。每批队列的游标由界面维护。
10. 订阅变更后重新读取快照，合并本页作答状态与其他页面的已提交结果。页面销毁时调用取消订阅函数。再次失败转入讲解可由本日此卡两次作答及有效 `again` 状态判断。

```js
await learningStore.ready();
const snapshot = await learningStore.snapshot();
const tasks = buildReviewQueue({
  cards: snapshot.cards,
  events: snapshot.events,
  attempts: snapshot.attempts,
  knowledge: snapshot.course?.knowledge || knowledgeFromApi,
  now: new Date().toISOString(),
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  limit: snapshot.settings.dailyLimit,
});
```

页面运行需要浏览器原生IndexedDB、ES模块和Web Crypto。本地开发使用localhost，跨设备PWA部署使用HTTPS，以便稳定生成记录摘要和作答ID。

## 已运行测试

2026-11-16在Windows本机运行。Node为 `v24.15.0`。真实浏览器为已安装的Playwright Chromium 1217，headless模式，独立临时浏览器上下文及双标签页。测试调用生产ES模块与原生IndexedDB。

```powershell
# 在独立工作树根目录执行
node --test 'ai_tutor/tests/learning_core_test.mjs'
node --check 'ai_tutor/static/learning-store.js'
node --check 'ai_tutor/static/review-scheduler.js'
```

算法测试结果为13组通过，0失败，覆盖新卡、24小时检测、全部等级与评分、提示上限、同日与跨日、重复提交、任务配额、稳定排序、直接先修、循环与缺失关系、时区、夏令时和错误输入。

浏览器测试在项目根目录启动独立静态服务，暴露 `static/` 和 `data/course.json`。服务目录应为本工作树中的 `ai_tutor`。

```powershell
python -m http.server 8766 --bind 127.0.0.1 --directory ./ai_tutor
```

测试文件提供直接浏览器运行入口。依次传入本机已有Playwright模块绝对路径、静态服务地址和可选浏览器可执行文件绝对路径。以下复验命令在本工作树根目录执行，路径已按当前ASCII目录给出。

```powershell
$playwrightModule = (Resolve-Path './ai_tutor/node_modules/playwright/index.mjs').Path
node 'ai_tutor/tests/learning_core_test.mjs' --browser $playwrightModule http://127.0.0.1:8766
```

也可在已有Playwright驱动中导入测试文件的 `runBrowserTests(page, baseUrl, browserName)`。本轮先通过Playwright CLI执行浏览器入口，最终通过上述直接入口复跑并输出39项通过结果，0页面异常。

39项检查涵盖125条完整历史、重复迁移、无请求ID摘要去重、无效迁移条目、字段白名单、主要知识点与行为分类、主动加入幂等、保存作答、档案设置与版本、重复及乱序导入、十类损坏档案、ID冲突、原生事务中途失败回滚、清空与重置、空库恢复全部作答、证据重算、迟到作答、原始时区保留、BroadcastChannel、双标签页并发、刷新恢复、七表建库、versionchange关闭、更高版本拒绝与失败后重试。

## 等待集成及四端验证

- 合并界面与离线分支后，通过真实 `send()`、详情浏览、练习参考答案、纠错、收藏、清空和导出入口复测。本线程浏览器测试使用独立静态服务直接调用模块。
- 检查首次锁定答案前后的提示标记、题库变式题判定、自评来源，以及跳过后继续下一题的交互。
- 检查首次检测配额和同卡每天两次限制的界面反馈，第二次失败后仍可打开讲解。
- 核对静态入口、Service Worker缓存清单及两个模块依赖的 `?v=learning-v1` 地址。离线恢复通过 `saveCourse` 保存的原始快照接入。
- 覆盖1440px桌面和390×844窄屏。Android Chromium、iOS WebKit、macOS与Windows的真机PWA安装、离线重开和存储权限待集成线程验证。本线程已运行Windows桌面Chromium模块测试。
- 在真实WebKit浏览器验证IndexedDB事务、后台恢复、升级阻塞与存储配额失败。当前事务中途失败已用原生IndexedDB故障注入验证，系统磁盘耗尽及浏览器自动清理存储仍待真机验证。
- 关闭BroadcastChannel的环境复测storage通知降级，以及旧页面持有数据库时的升级阻塞提示。
- 以已有API和界面回归套件验证原问答、引用、安全渲染、错误反馈与流式入口。本线程变更为四个新增归属文件。

## 集成验收更新 · 2026-11-16

本分支成果已合并到 `codex/learning-integration`。最终实际代码、完整测试结果、跨浏览器范围、启动地址与真机待验收步骤见 `docs/deliverables/test-records.md` 中本轮集成记录。本文前述单分支测试保留原始范围，跨线程待接线事项已在集成工作树复核。
