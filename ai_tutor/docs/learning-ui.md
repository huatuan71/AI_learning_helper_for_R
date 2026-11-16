# 学习界面交接

> 本文记录学习功能初次集成时的实现与验证。当前目录、模块入口与测试命令见 [项目说明](../../README.md)。应用壳版本已更新为 `structure-v1`，离线清单为28项。初次集成的截图和报告归档在 `evidence/learning-v1/`。

## 分支与修改范围

分支为 `codex/learning-ui`，基线为 `c7f8759ebe426da8cb4e6c838aaf55b93ea93695`。独立工作树位于仓库 `.worktrees/learning-ui`。交付提交使用 `feat: add learning center and guided review`，提交编号随最终交付消息提供，也可通过 `git log -1 codex/learning-ui` 查询。

本次提交包含以下八个归属文件。

- `static/app.js`
- `static/index.html`
- `static/knowledge-map.js`
- `static/learning-center.js`
- `static/learning-center.css`
- `static/review-bank.json`
- `tests/browser_learning_center.js`
- `docs/learning-ui.md`

## 页面与统计

- `/#/history` 为概览，`/#/history/review` 为复习，`/#/history/summary` 为小结，`/#/history/records` 为记录。链接支持刷新和前进后退。方向键、Home、End可切换页签。
- 界面沿用系统字体、`#0071e3`、原浮动磨砂导航与对话代码材质。概览使用八个单元进度和最近六项活动。设置、档案管理和离线资料集中在“设置与资料”。
- 学习主题从学习事件中的知识编号去重。浏览标签只依据 `view` 事件，已学习标签依据 `study`、`debug`、`exercise_view`。已练习标签依据已提交作答。
- 待复习统计已到期卡片，每个知识点最多有概念、应用两张卡。独立完成主题按至少一次有效独立作答的知识编号去重。有效证据要求答案非空、评级为 `good` 或 `easy`，且锁定前未使用提示或答案。两类卡分别排程。
- 今日统计与日期范围使用当前设备本地日期。每次作答另存IANA时区，交由核心模块复算排程。小结逐项给出课程要点、课程易错提醒、典型代码、实际作答次数与下一步，并附知识点和对应对话入口。
- 小结采用课程与记录模板，标明生成方式和范围。支持文本周报下载及浏览器打印。打印前展开代码和来源，打印后恢复折叠状态。

## 复习证据与题库

`review-bank-v1`共94题，包含43个知识点的概念与应用各一题，以及8道客观变式。概念与应用题基于 `data/course.json` 的解释、参数、示例、输出和易错提醒编制对照题，并标注改编来源。K06变式同时引用已有补充草稿的基础例题。K40至K43的扩展包示例保留未运行验证提示。

选择题采用已知 `correctIndex`，错误回答只开放重学。开放题使用参考要点与自评，存储 `assessmentSource: 'self'`。所有代码标记“未运行验证”。

首次答案锁定前的提示与答案使用状态保存在 `evidence`。锁定后打开参考要点用于自评，保存时沿用锁定时的证据。提示或提前看答案使评级上限为 `hinted`。熟练评级要求独立作答及正确完成关联客观变式，缺少变式的题目最高开放独立完成。空答案可以选择重学。

任务由 `buildReviewQueue` 生成，默认6题，限额3至12，展示算法返回的安排原因。草稿、题目、跳过位置、锁定证据与稳定作答ID保存在同源 localStorage 的 `r-tutor-review-session-v1`。正式作答交给 IndexedDB。刷新恢复时剔除已提交结果，同日任务保留待处理项，新日期重新按实际状态建立任务。

## 接线与导出接口

`learning-center.js`导出 `LearningCenter` 与 `downloadText`。生产模块直接导入共享 `learningStore`、`buildReviewQueue` 和离线接口，资源标记为 `learning-v1`。

- 启动时执行 `ready()`、完整旧记录 `migrateLegacy()` 与 `snapshot()`。当前对话最多一次显示最近100条，旧对话定位时可额外装入目标记录。记录页每次加载30条，导出入口读取完整历史。
- 成功问答在 `app.js` 的 `send()` 中调用 `ingestConversation()`。知识详情调用 `recordVisit()`，加入复习调用 `enroll()`，知识与回答收藏使用 `saveBookmark()`，备注可编辑和移除。
- 原“清空记录”接 `clearConversations()`。完整重置放在独立折叠区域，通过明确确认勾选调用 `resetLearningData()`。
- 档案下载通过Blob与下载链接，导入通过文件选择与本地JSON解析，随后调用 `importArchive()`。解析失败和模块校验失败均反馈，重复导入展示导入与重复数量。文件大小上限20MB。文件名、答案、备注、课程字段均使用安全文本节点。
- 离线下载直接调用 `downloadOffline(onProgress)`，显示真实回调计数，成功后调用 `saveCourse()`。持久存储由线程三的点击下载流程申请，界面读取实际授权结果。更新失败重新读取实际可用版本。
- 启动先请求原课程API，失败时恢复存储快照或 `getOfflineCourse()`。知识详情请求失败时也从同一快照取值。联网问答继续使用原后端流程。
- `index.html`已添加manifest、192图标和Apple触摸图标链接及学习样式。

## 真实验证

2026年11月16日在Windows运行Google Chrome `157.0.8103.51`，通过Playwright真实浏览器检查。桌面视口为1440×1000，窄屏视口为390×844，时区为Asia/Shanghai。窄屏检查使用桌面Chrome调整视口。

| 检查 | 结果 |
|---|---|
| 真实线程一存储与算法模块，离线接口测试替身 | 76项通过，0个未捕获JS错误 |
| 全部依赖使用测试专用替身 | 76项通过，0个未捕获JS错误 |
| 已有 `tests/test_api.py` | 55项通过 |
| 三个生产JS文件与浏览器测试的 `node --check` | 通过 |
| `git diff --check` | 通过 |

浏览器检查覆盖真实后端模拟模式问答、学习事件、四页签、跳过与刷新、空答案、提示限制、提前看答案限制、锁定后参考答案、客观错误、熟练变式、稳定作答ID重试、收藏备注安全渲染、日期小结、周报下载、打印入口、旧记录重复迁移、档案错误与重复导入、确认重置、107条历史分页和完整导出、课程接口失败后快照恢复、离线更新失败反馈、长中文与超长代码换行、44px评级触摸目标、键盘和前进后退。

真实核心测试在开始时读取并固定线程一当前文件，通过浏览器路由提供这些真实模块，未将其复制进本分支。

| 模块 | SHA-256 |
|---|---|
| `learning-store.js` | `c09536b5bc6c43e12a365c6d2e3cf41b4f41a49c5848f2aed13ffbaf34276f9a` |
| `review-scheduler.js` | `5f980a4eb2b61de6a8b481c9df7820c38afccae80f2c4236baca439535680b6b` |

运行时先启动本工作树的FastAPI服务，然后在项目目录执行以下命令。环境中已安装Playwright时可省略 `PLAYWRIGHT_MODULE`。

```powershell
$env:BASE_URL = 'http://127.0.0.1:8012'
$env:PLAYWRIGHT_MODULE = '已安装的playwright包绝对路径'
$env:LEARNING_CORE_DIR = '线程一工作树/成员三/ai_tutor/static的绝对路径'
node tests/browser_learning_center.js
```

移除 `LEARNING_CORE_DIR` 后运行测试专用IndexedDB替身。合并完成后，将其设为当前项目static绝对路径即可使用当前真实核心模块。`LEARNING_TEST_OUTPUT`可指定独立证据目录。默认产物位于项目 `output/playwright/`，截图与测试数据未加入提交。

- `learning-ui-results.json`记录76项真实核心测试的逐项结果、浏览器环境与模块摘要。
- `contract/learning-ui-results.json`记录76项替身测试结果。
- `learning-overview-desktop-viewport.png`与`learning-overview-desktop.png`展示桌面概览。
- `learning-review-mobile-viewport.png`与`learning-review-mobile.png`展示390px复习页面。
- `learning-overview-mobile.png`与`learning-summary-mobile.png`展示窄屏概览和小结。
- `learning-archive.json`、`learning-all-records.json`与`learning-report.txt`为实际下载验证文件。

## 集成线程需要完成的事项

1. 合并线程一、二、三的归属文件。当前分支通过动态加载学习中心，在依赖缺失时显示明确错误，现有问答仍能启动。生产验收需使用合并后的真实模块。
2. 线程三的 `bootstrap.js`需使用 `learning-v1` 导入app及知识地图，并调用 `registerOffline()`。其当前工作树已有这一接法。本分支已完成index入口标记，未修改跨归属bootstrap。
3. 核对Service Worker白名单覆盖 `learning-center.js`、`learning-center.css`、`review-bank.json`、`learning-store.js`与`review-scheduler.js`，核对manifest和三个图标。使用真实 `downloadOffline()`重新验证下载进度、持久存储、断网重开、更新中断及旧包恢复。当前离线相关浏览器检查验证的是UI调用契约和快照恢复。
4. 用真实模块完成多标签页的导入、清空和重置联动，以及跨设备文件导入。当前测试在单浏览器上下文内完成刷新与档案迁移。
5. Android、iOS真机和macOS尚未验证，iOS WebKit亦未运行。补充文件应用保存／选择、安装态、安全区域、软键盘、触摸滚动和打印窗口检查。当前打印测试验证入口调用，真实系统打印窗口与分页需继续验收。
6. 问答联动测试使用原后端模拟模式，真实云模型与流式厂商回归留给集成验收。课程内容与代码均按来源展示，新增题库尚需课程负责人复核措辞。

## 集成验收更新 · 2026-11-16

本分支成果已合并到 `codex/learning-integration`。最终实际代码、完整测试结果、跨浏览器范围、启动地址与真机待验收步骤见 `成员三/测试记录.md` 中本轮集成记录。本文前述单分支测试保留原始范围，跨线程待接线事项已在集成工作树复核。
