## 学习功能集成交接 · 2026-11-16

本轮运行入口为 [集成服务](http://127.0.0.1:8014/)，工作树为仓库 `.worktrees/learning-integration`，分支为 `codex/learning-integration`。先打开知识地图，选择知识点，点击“加入复习”和“收藏”，再从“学习记录”进入概览、复习、小结或记录。

- 概览按实际学习事件、作答和卡片显示统计。题库共94题，覆盖43个知识点的概念与应用各一题及8道变式，来源可在题目内展开。
- 普通讲解后24小时检测，主动加入立即检测。复习间隔为1、3、7、14、30、60天。未掌握10分钟后重试，同卡同日第二次失败安排24小时后。提示或提前看答案最高评为提示完成，跨日至少24小时的到期独立回忆可升级。每卡每天最多两个自动任务，每轮最多两道首次检测，默认每次6题，可设3至12题。
- 收藏回答或知识后，在复习页添加难点备注。小结支持今日、最近7天与自选日期，显示课程依据、实际作答及对话入口，可导出文本周报或打印。
- 学习档案位于当前来源的 IndexedDB `r-language-tutor-learning`。旧键 `r-tutor-mock-v1` 在完整迁移成功后移除，迁移失败保留原记录。对话数量完整保存，界面按批次展示。复习待作答草稿另存 `r-tutor-review-session-v1`，失败重试沿用第一次提交的ID、时间、时区和评分。
- “设置与资料 → 导出完整档案”备份个人对话、事件、作答、收藏及设置。目标设备选择该JSON合并导入，重复导入去重，排程按事件重算。导入上限20MiB，损坏、冲突或未来版本给出反馈并保留当前档案。课程快照在目标设备单独下载。
- “清空记录”清除对话及回答收藏。“重置个人学习档案”清除个人事件、复习、收藏和设置，需勾选确认。两项操作均保留课程离线资料。

### 离线使用与安装

在“学习记录 → 设置与资料”点击“保存离线资料”，等待真实26项资源全部校验成功。看到版本与时间后可断网刷新、重开页面、浏览43个知识点、作答评级、看小结及管理档案。联网模型请求仍需服务和网络。

更新时点击“更新离线资料”，完成后刷新加载已保存版本。下载中断保留上一完整包，损坏资源会尝试回退上一完整包。显示资料不可用时，联网重新保存。浏览器可能拒绝持久存储，本轮Chromium返回常规存储，重要学习记录请导出备份。

Windows/Android的支持浏览器可从地址栏或菜单安装。iOS在Safari分享菜单选择“添加到主屏幕”。macOS使用支持的浏览器安装菜单。跨设备访问需固定的受信任HTTPS地址，本机localhost和127.0.0.1支持开发。手机访问电脑局域网普通HTTP时离线服务受安全上下文限制。换协议、域名、端口或浏览器会进入另一份本地档案。

### 本机启动与复验

以下命令路径已按当前ASCII目录调整，示例仓库根目录为 `E:/projects/r-ai-tutor`。历史分支、验收结果和版本记录沿用当时记录。

本轮复用仓库已有Python虚拟环境，运行代码来自集成工作树。默认 `start.cmd` 使用8000，独立工作树可指定端口及解释器。启动脚本检查目标端口，进程身份保存在该工作树 `.runtime/server.json`，`stop.cmd` 按脚本路径和启动时间核对身份。

```powershell
# 在 .worktrees/learning-integration/ai_tutor 中执行
./start.ps1 -Port 8014 -PythonExe 'E:/projects/r-ai-tutor/ai_tutor/.venv/Scripts/python.exe'
$py = 'E:/projects/r-ai-tutor/ai_tutor/.venv/Scripts/python.exe'
& $py -m pytest --collect-only -q
& $py -m pytest -q
node --test tests/learning_core_test.mjs
$env:PLAYWRIGHT_MODULE = (Resolve-Path './node_modules/playwright').Path
$env:BASE_URL = 'http://127.0.0.1:8014'
$env:PWA_BASE_URL = $env:BASE_URL
node tests/browser_pwa.js --integrated
node tests/browser_integration.cjs
$env:BROWSER = 'webkit'
node tests/browser_integration.cjs
Remove-Item Env:BROWSER
# 另一个终端启动模拟上游测试服务
& $py tests/browser_fixture_server.py --port 8015
# 原终端运行全部既有浏览器套件
$env:AI_BASE_URL = 'http://127.0.0.1:8015'
node tests/browser_regression.cjs
$env:LEARNING_CORE_DIR = (Join-Path (Get-Location) 'static')
node tests/browser_learning_center.js
```

测试会使用隔离浏览器上下文。学习中心76项专项使用真实核心模块及离线接口替身，真实离线流程由PWA和集成套件覆盖。截图与JSON报告位于项目 `output/playwright/`。全部命令、真实结果、四端范围和真机步骤见 [测试记录](../../../docs/deliverables/test-records.md)。

