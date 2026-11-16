# 学习功能多线程实施约定

## 使用顺序

本轮分为三个并行开发线程和一个集成验收线程。先启动线程一、二、三，待三个线程分别完成提交后，再启动线程四。

| 线程 | 分支 | 直接复制的提示词 | 主要成果 |
|---|---|---|---|
| 一 | `codex/learning-core` | `01-storage-and-review.md` | IndexedDB、数据迁移、档案导入导出、复习算法 |
| 二 | `codex/learning-ui` | `02-learning-ui.md` | 学习概览、复习、小结、收藏、现有页面联动 |
| 三 | `codex/offline-pwa` | `03-offline-and-platforms.md` | PWA、离线资源包、离线启动、安装适配 |
| 四 | `codex/learning-integration` | `04-acceptance.md` | 合并、真实浏览器验收、问题修复、运行说明 |

代码仓库的路径示例为 `E:/projects/r-ai-tutor`，项目位于 `ai_tutor`。功能代码基线为 `8464936`，四个任务分支从包含本组说明的同一提交创建。

各线程使用独立工作树。优先使用聊天已分配的工作树。需要自行创建时，可使用仓库下的 `.worktrees/learning-core`、`.worktrees/learning-ui`、`.worktrees/offline-pwa`、`.worktrees/learning-integration`，并将 `/.worktrees/` 加入本机 `.git/info/exclude`。这样并行切换分支和修改文件相互独立。

每个线程先阅读适用的 `AGENTS.md`、本文件和对应提示词。线程一至三完成本分支提交，线程四完成集成分支提交。最终由用户决定何时合并到 `main` 和发布。

## 已确认的产品范围

- 平台覆盖 Android、iOS、macOS、Windows，交付形式采用可安装网页 PWA。
- 在现有“学习记录”入口中增加“概览、复习、小结、记录”四个页签。
- 实现学习概览、自动复习、最近学习小结、知识与回答收藏，以及个人难点备注。
- 数据保存在各设备的 IndexedDB 中，支持旧记录迁移、事务保存、完整档案导出和合并导入。
- 首次下载离线资料后，课程浏览、本地练习、调度、统计、小结和档案管理可以离线完成。
- 联网模型问答沿用现有 FastAPI 流程。离线小结使用明确的课程资料与记录模板。
- 问答、纠错、引用、参考答案、复制、记录定位和错误反馈继续通过现有入口使用。
- 课程原始内容保持原有编号、来源与数据结构，新增复习题单独存放并标明来源。

## 文件归属

| 线程 | 可直接修改的文件 |
|---|---|
| 一 | 新增 `static/learning-store.js`、`static/review-scheduler.js`、`tests/learning_core_test.mjs`、`docs/learning-core.md` |
| 二 | `static/app.js`、`static/index.html`、`static/knowledge-map.js`，新增 `static/learning-center.js`、`static/learning-center.css`、`static/review-bank.json`、`tests/browser_learning_center.js`、`docs/learning-ui.md` |
| 三 | `static/bootstrap.js`、`app/main.py`，新增 `static/offline.js`、`static/service-worker.js`、`static/manifest.webmanifest`、`static/icons/`、`tests/browser_pwa.js`、`tests/test_pwa_assets.py`、`docs/offline-pwa.md` |
| 四 | 合并完成后按实际问题修复以上文件，更新 `README.md`、`docs/deliverables/test-records.md`、必要的浏览器测试及交接说明 |

已有 `static/learning.css`、`static/style.css`、`static/liquid-scene.js` 和模型模块由集成线程在确有问题时修改。线程一至三发现跨归属需求时，写入各自交接说明，并给出具体接入位置。

## 现有项目事实

- 前端使用原生 HTML、CSS、JavaScript，学习入口为 `/#/history`。
- 导航包含首页、知识地图、AI问答、代码纠错、学习记录。
- `static/app.js` 中的 `safeRecord()` 已对对话字段做白名单保存。
- 旧记录的 localStorage 键为 `r-tutor-mock-v1`，当前界面最多恢复最近100条。
- 对话含时间、请求、回答、主要知识点、引用和错误案例标识。
- 43个知识点、24道问答、14个错误案例来自 `data/course.json`。
- 八个单元依次为环境与自助学习、类型与缺失、向量与字符串、矩阵与数组、数据框、列表与批量处理、函数与控制、综合与包扩展。
- 现有 FastAPI 版本为 `1.2.1`，接口测试对版本与接口数量有断言。
- 当前静态资源标记为 `20261116.3`，新功能统一使用资源标记 `learning-v1`，集成时核对所有入口与缓存版本。

## 共享数据约定

所有持久化时间使用 UTC ISO 8601 字符串，按日统计时使用设备当前时区。可测试的算法函数接受显式 `now` 参数。

```ts
type KnowledgeId = string // 仅接受课程中存在的 K01 至 K43
type CardType = 'concept' | 'application'
type Grade = 'again' | 'hinted' | 'good' | 'easy'

interface LearningEvent {
  id: string
  knowledgeId: KnowledgeId
  kind: 'view' | 'study' | 'exercise_view' | 'debug' | 'enroll'
  at: string
  conversationId?: string
  caseId?: string
}

interface ReviewCard {
  id: string // `${knowledgeId}:${type}`
  knowledgeId: KnowledgeId
  type: CardType
  stage: number // 整数 0 至 5
  state: 'new' | 'review' | 'relearning'
  enrolledAt: string
  updatedAt: string
  dueAt: string
  lastReviewedAt: string | null
}

interface ReviewAttempt {
  id: string // 本次提交唯一标识，重试复用
  cardId: string
  questionId: string
  at: string
  timeZone: string // 作答时的IANA时区，保证导入重算可复现
  grade: Grade
  answerText: string
  hintUsed: boolean
  answerRevealed: boolean
  variantPassed: boolean
  assessmentSource: 'self' | 'objective'
}

interface Bookmark {
  id: string // `knowledge:K06` 或 `conversation:<conversationId>`
  knowledgeId: KnowledgeId | null
  conversationId: string | null
  title: string
  note: string
  createdAt: string
  updatedAt: string
}

interface LearningSettings {
  dailyLimit: number // 默认6，可设置3至12
}

interface LearningSnapshot {
  conversations: Array<{id: string, record: object}>
  events: LearningEvent[]
  cards: ReviewCard[]
  attempts: ReviewAttempt[]
  bookmarks: Bookmark[]
  settings: LearningSettings
  course: object | null // data/course.json 同结构的已下载快照
}
```

记录浏览、查看答案和请求模型讲解属于学习行为。复习等级由有效作答事件建立。旧记录可以用于恢复学习主题和时间，首次诊断负责建立回忆表现。

每个知识点最多建立概念、应用两张复习卡，题库可为同一张卡提供多个题目。来源和附带引用用于展示，学习事件绑定本轮实际主要知识点。

## 线程一提供的存储接口

`static/learning-store.js` 导出单例 `learningStore`。方法均返回 Promise，`subscribe()` 除外。

```ts
learningStore.ready(): Promise<void>
learningStore.snapshot(): Promise<LearningSnapshot>
learningStore.migrateLegacy(records: object[]): Promise<{imported: number}>
learningStore.ingestConversation(record: object): Promise<{conversationId: string}>
learningStore.recordVisit(knowledgeId: string, at?: string): Promise<void>
learningStore.enroll(knowledgeId: string, at?: string): Promise<void>
learningStore.saveAttempt(attempt: ReviewAttempt): Promise<{card: ReviewCard, attempt: ReviewAttempt}>
learningStore.saveBookmark(bookmark: Bookmark): Promise<void>
learningStore.removeBookmark(id: string): Promise<void>
learningStore.saveCourse(course: object): Promise<void>
learningStore.saveSettings(settings: LearningSettings): Promise<void>
learningStore.clearConversations(): Promise<void>
learningStore.exportArchive(): Promise<object>
learningStore.importArchive(archive: object): Promise<{imported: number, duplicates: number}>
learningStore.resetLearningData(): Promise<void>
learningStore.subscribe(listener: () => void): () => void
```

- `ready()` 打开并升级数据库，失败时返回清晰错误供页面反馈。
- `migrateLegacy()` 对同一批旧记录重复执行时结果稳定，并采用现有字段白名单。
- `ingestConversation()` 保存完整历史，成功讲解按主要知识点建立学习事件。现有对话界面可以继续分页或限制一次渲染的数量。
- `recordVisit()` 记录详情浏览，`enroll()` 将两类复习卡加入当前可复习任务。重复加入保持记录幂等。
- `clearConversations()` 清除对话及其对应回答收藏，学习事件和复习档案由专门的重置操作管理。
- `resetLearningData()` 清除个人学习数据，课程离线包可继续使用。
- 变更成功后通知当前页面，并通过 BroadcastChannel 或等效方式通知同源其他标签页。
- 档案采用 `{app: 'r-language-tutor', schemaVersion: 1, exportedAt, knowledgeVersion, data}`。`data` 包含个人学习数据与设置，课程内容通过离线包下载。
- 导入先完成结构、大小、版本、知识编号及字段校验，再进行事务写入。按事件与作答ID去重，合并后按有效作答事件重算卡片状态。
- 导入当前已存在的有效事件集合，两次执行得到相同结果。损坏档案的导入保持现有数据可读。

## 线程一提供的算法接口

`static/review-scheduler.js` 导出以下纯函数。界面线程和测试线程通过命名导入使用。

```ts
createCard(knowledgeId: string, type: CardType, now: string): ReviewCard
scheduleReview(card: ReviewCard, attempt: ReviewAttempt, previousAttempts: ReviewAttempt[]): ReviewCard
buildReviewQueue(input: {
  cards: ReviewCard[], events: LearningEvent[], attempts: ReviewAttempt[],
  knowledge: object[], now: string, timeZone: string, limit: number
}): Array<{card: ReviewCard, reason: string, priority: number}>
```

### 复习调度规则

1. 普通讲解后，新建卡片安排24小时后的首次检测。主动加入复习安排当前时间可练习。
2. 六级间隔依次为1、3、7、14、30、60天。
3. `again` 对应“未掌握”，回到0级，进入重学并安排10分钟后的重试。
4. `hinted` 对应“提示完成”，下降一级，最低0级，安排24小时后复习。
5. `good` 对应“独立完成”，在符合跨日独立回忆条件时上升一级，按新等级间隔安排。
6. `easy` 对应“熟练完成”，要求独立完成且通过变式题，满足条件时上升两级，否则按实际表现降为 `good` 或 `hinted`。
7. 重学当日通过及同日重复练习按24小时后检测安排，等级提升由后续跨日独立检测确认。提示或提前查看答案后，评分上限为 `hinted`。
8. 每张卡每个本地自然日最多进入两次自动任务。再次未通过后转入讲解，并安排次日检测。手动打开讲解继续可用。
9. 队列优先级采用 `40×逾期程度 + 30×最近失败 + 20×先修补强需要 + 10×主动标记`，各项取0至1。逾期程度为逾期时长除以原定间隔，最高1。
10. 先修补强基于直接先修关系与有效检测证据，关系遍历去重并限制深度，兼容缺失或循环关系。
11. 默认每次6题，最多两道首次检测题。同分按到期时间、卡片ID稳定排序。资料不足的任务保留状态并反馈可理解原因。
12. 跳过和退出作为待处理任务保存，刷新恢复时读取实际已提交结果。一次重试复用同一作答ID。

上述规则属于项目初始可调策略，参数集中定义，文档记录算法版本。

同日判断使用该作答记录的 `timeZone`，队列配额使用调用方显式传入的设备当前时区。导入重算按作答UTC时间与ID稳定排序，保留每次作答的原始时区。

`hintUsed` 和 `answerRevealed` 表示首次答案锁定前的提示或答案使用情况。学生先锁定自己的答案，再展开参考内容进行自评时，独立作答证据按锁定时的状态记录。空答案需要选择重学或继续作答。

## 线程二提供的复习题库

`static/review-bank.json` 使用以下结构，至少覆盖43个知识点的概念和应用各一题。

```json
{
  "version": "review-bank-v1",
  "items": [
    {
      "id": "K06-concept-01",
      "knowledgeId": "K06",
      "type": "concept",
      "format": "self",
      "prompt": "说明 NA 的含义以及一种检测方法。",
      "hint": "结合缺失值检测函数回忆。",
      "reference": "根据课程资料填写的参考说明。",
      "code": "is.na(x)",
      "sourceRefs": [{"knowledgeId": "K06", "field": "解释"}],
      "variantOf": null
    }
  ]
}
```

`format` 支持 `self` 和 `choice`。选择题增加 `choices` 字符串数组、`correctIndex` 整数。已有课程练习若缺少专门答案，题目明确使用课程解释或示例对照题，并标注改编来源。

概念题和代码阅读题使用参考要点、自评和已知答案选择题。代码运行状态沿用“未运行验证”。每次保存评分时记录 `assessmentSource`，自评与客观题结果可追溯。

## 线程三提供的离线接口

`static/offline.js` 导出以下方法，学习界面线程导入使用。

```ts
registerOffline(): Promise<{supported: boolean}>
getOfflineStatus(): Promise<{
  supported: boolean, ready: boolean,
  knowledgeVersion: string | null, downloadedAt: string | null,
  assetCount: number
}>
downloadOffline(onProgress?: (state: {completed: number, total: number}) => void): Promise<{
  course: object, knowledgeVersion: string, downloadedAt: string, assetCount: number
}>
getOfflineCourse(): Promise<object | null>
```

- 线程三通过 `bootstrap.js` 调用 `registerOffline()`，学习页面负责展示下载与更新入口。
- `downloadOffline()` 成功后，界面线程将返回的课程快照交给 `learningStore.saveCourse()`。
- 离线代码优先读取完整已验证快照。下载中断保留上一个可用版本，状态提示对应实际缓存结果。
- UI启动时优先请求现有课程接口，连接失败时从已保存课程快照恢复目录、详情与版本展示。
- 后端增加 `/sw.js` 和 `/offline-course.json` 两个资源入口，均设置 `include_in_schema=False`，现有API协议继续有效。
- `/offline-course.json` 直接提供 `data/course.json` 的公共课程内容。Service Worker缓存采用明确资源白名单，模型配置、Key、模型请求和流式响应沿用实时网络请求。
- Manifest路径为 `/static/manifest.webmanifest`，图标由线程三提供 `static/icons/icon-192.png`、`icon-512.png` 和 `apple-touch-icon.png`。
- 线程二在 `index.html` 添加manifest和图标链接，以及新的学习样式表。线程三负责这些资源的真实文件和离线清单。
- 浏览器持久存储申请在用户点击“保存离线资料”时进行，页面展示实际结果。

## 联调与验收约定

线程一至三的交付说明统一包含提交编号、修改文件、导出接口、真实测试结果、依赖其他线程的待验证项。

依赖模块未合并时，可以在测试专用目录使用替身测试调用契约。生产代码使用本文件规定的真实接口。集成线程合并后执行端到端测试。

验收覆盖实际问答、学习事件、复习排程、重复提交、刷新恢复、多标签页、档案重复导入、损坏文件、离线重开、更新失败、知识来源、安全文本渲染和旧功能回归。

浏览器覆盖桌面1440px及390×844窄屏，并记录 Android Chromium、iOS WebKit、macOS、Windows 的实际测试环境。报告分别注明真机、模拟器、浏览器设备仿真和未验证项。

## 用户操作

1. 新开三个独立聊天，分别复制 `01`、`02`、`03` 的完整提示词。
2. 三个线程完成后，记录它们返回的提交编号。
3. 新开第四个聊天，复制 `04` 的完整提示词，并附上三个提交编号。
4. 从集成线程提供的地址验收。四端真机检查可按交接清单逐项完成。
