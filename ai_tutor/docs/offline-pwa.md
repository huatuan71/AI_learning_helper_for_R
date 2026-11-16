# 跨平台 PWA 与离线资料

> 本文记录学习功能初次集成时的实现与验证。当前目录、模块入口与测试命令见 [项目说明](../../README.md)。应用壳版本已更新为 `structure-v1`，离线清单为28项。初次集成的截图和报告归档在 `evidence/learning-v1/`。

## 交付与接入

本线程工作树为 `.worktrees/offline-pwa`，分支为 `codex/offline-pwa`，基线为 `c7f8759`。实现文件为 `app/main.py`、`static/bootstrap.js`、`static/offline.js`、`static/service-worker.js`、`static/manifest.webmanifest`、`static/icons/`、`tests/browser_pwa.js`、`tests/test_pwa_assets.py` 和本文档。

课程结构沿用 `data/course.json`。公共入口 `/offline-course.json` 返回原始文件字节，`/sw.js` 返回 Service Worker 脚本。两个入口均使用 `include_in_schema=False`。SW 响应类型为 `application/javascript`，作用域头为 `Service-Worker-Allowed: /`。两个入口的更新头均为 `Cache-Control: no-cache, no-store, must-revalidate`。

`static/offline.js` 提供协作约定的四个命名导出。以下附加字段用于界面反馈。

| 方法 | 返回及用途 |
|---|---|
| `registerOffline()` | `{supported, registered, error}`。等待首次安装激活，失败时返回可读原因 |
| `getOfflineStatus()` | `{supported, ready, knowledgeVersion, downloadedAt, assetCount}`，附加 `resourceVersion`、`bundleVersion`、`reviewBankVersion`、`updateAvailable`、`persistence` 和错误信息 |
| `downloadOffline(onProgress)` | 返回真实下载的 `{course, knowledgeVersion, downloadedAt, assetCount}`，附加三个资源版本字段与 `persistence`。失败时抛出带 `code` 的错误 |
| `getOfflineCourse()` | 返回完整通过校验的课程快照，资源不完整或不可访问时返回 `null` |

`persistence` 为 `{supported, granted, error}`。`supported` 对应持久存储申请 API 的能力，`granted` 对应浏览器实际决定，缺少能力时为 `null`。状态读取通过 `navigator.storage.persisted()` 查询实际持久化情况。申请在用户调用 `downloadOffline()` 时执行。

`bootstrap.js` 使用 `learning-v1` 资源标记，在原有依赖启动前异步调用注册方法。页面可读取 `window.__rTutorOffline`，并监听 `r-tutor-offline` 事件。注册错误位于其 `error` 字段。其他标签页完成下载时，事件中的 `changedAt` 更新，界面随后调用 `getOfflineStatus()`。相同注册状态重复读取时抑制重复事件。

## 界面线程交接

线程二在 `index.html` 中接入以下资源，并统一入口的版本标记为 `learning-v1`。

```html
<link rel="manifest" href="/static/manifest.webmanifest">
<link rel="icon" type="image/png" href="/static/icons/icon-192.png">
<link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png">
<link rel="stylesheet" href="/static/learning-center.css?v=learning-v1">
```

图标沿用现有 `R / 学习助手` 标识，使用项目蓝色 R 与深色斜线。提供真实 192×192、512×512 PNG 及 180×180 Apple Touch PNG。Manifest 的名称为“R语言学习助手”，`display` 为 `standalone`，`id` 与 `scope` 为 `/`，`start_url` 为 `/#/home`，主题色与背景色均为 `#f5f5f7`。

保存按钮直接调用下载函数，展示逐项进度、错误、下载版本、时间与持久存储结果，再交给存储模块保存课程。

```js
import {downloadOffline, getOfflineStatus, getOfflineCourse} from './offline.js?v=learning-v1';
import {learningStore} from './learning-store.js?v=learning-v1';

async function saveOfflineMaterials(onProgress) {
  const result = await downloadOffline(onProgress);
  await learningStore.saveCourse(result.course);
  return result;
}
```

`getOfflineStatus().ready` 以实际缓存核验结果为准。课程版本使用 `knowledgeVersion`，参考答案版本使用 `reviewBankVersion`，壳资源标记使用 `resourceVersion`，完整内容摘要使用 `bundleVersion`。`updateAvailable` 表示已安装 SW 的资源标记与已下载包不同。课程和题库同标记内容更新通过用户再次下载获得。

现有 `app.js` 末尾的 `Promise.all([api('/api/health'), api('/api/knowledge')])` 需要由线程二调整，使健康请求失败后仍能恢复课程。建议接入位置如下。

1. 目录首次使用 `GET /api/knowledge`。请求失败时调用 `getOfflineCourse()`，从 `course.knowledge` 建立目录，从 `course.relations` 建立关系，版本读取 `course.version`。
2. `knowledge-map.js` 的详情通过共享读取函数请求 `GET /api/knowledge/{id}`。失败时在上述已验证快照的 `knowledge` 中按 ID 查找。这样详情、解释、示例、先修与来源使用同一份快照。
3. `GET /api/health` 独立检测实际服务连接。离线状态反馈包含实际健康请求结果，恢复网络时重新探测。`navigator.onLine` 可作为触发重试的线索。
4. 下载成功后调用 `learningStore.saveCourse(result.course)`。进入学习中心时重新核对 `getOfflineStatus()`，浏览器驱逐缓存后的反馈需引导重新下载。
5. 更新成功后提示用户刷新以加载新的壳资源。当前已打开的页面保留用户正在操作的表单，下一次页面启动读取最新完整包。
6. 个人数据备份恢复接入 `learningStore.exportArchive()` 与 `importArchive()`。界面展示浏览器来源与档案导出入口。

## 资源白名单

`service-worker.js` 中的 `ASSETS` 是完整运行资源清单，共 26 项。请求按路径匹配，同一公开文件的查询版本标记映射到规范缓存键。

| 资源 | 路径 |
|---|---|
| 应用 HTML | `/`、`/static/index.html` |
| 当前样式 | `/static/style.css`、`/static/learning.css`、`/static/model-settings.css` |
| 学习样式，线程二提供 | `/static/learning-center.css` |
| 启动与离线模块 | `/static/bootstrap.js`、`/static/offline.js` |
| 现有功能模块 | `/static/app.js`、`/static/knowledge-map.js`、`/static/liquid-scene.js`、`/static/r-file.js`、`/static/model-settings.js`、`/static/answer-markdown.js` |
| 学习存储与算法，线程一提供 | `/static/learning-store.js`、`/static/review-scheduler.js` |
| 学习界面与题库，线程二提供 | `/static/learning-center.js`、`/static/review-bank.json` |
| 本地第三方依赖 | `/static/vendor/three/three.module.min.js`、`/static/vendor/marked/marked.js`、`/static/vendor/dompurify/purify.js` |
| 课程快照 | `/offline-course.json` |
| 安装元数据与图标 | `/static/manifest.webmanifest`、`/static/icons/icon-192.png`、`/static/icons/icon-512.png`、`/static/icons/apple-touch-icon.png` |

当前课程及前端引用中的运行图片为上述三个图标。课程内容中的 PDF 文件名用于来源定位。后续新增课程插图或模块依赖时，需要同步扩充 `ASSETS` 并运行资源依赖清点测试。Three.js、Marked 和 DOMPurify 的实际运行依赖均在本地资源清单中。

线程一、二的五个待交接文件均是必需资源。当前本分支直接点击下载会在 `/static/learning-center.css` 返回 404 时失败，并报告具体路径与 HTTP 状态。集成线程合并五个文件后运行完整验收。

## 缓存、校验与更新

安装阶段注册 SW，用户主动保存时下载白名单资源。每次下载使用独立版本化缓存，名称以 `r-language-tutor-offline:` 开头，包含资源标记与随机 ID。

下载逐项验证 HTTP 成功状态、MIME 类型、非空内容、JSON 可解析性与 PNG 签名，并记录每个资源的 SHA-256 和字节数。课程必须包含原有版本、知识、关系、问题与错误案例结构。题库必须包含版本、题目与有效参考答案。写入后重新读取全部缓存并验证摘要，通过后最后写入提交记录。`ready` 仅对存在完整提交记录且摘要一致的资源包返回 `true`。

更新下载采用 `cache: 'no-store'`、`credentials: 'omit'` 和拒绝重定向的公开请求，每项最多等待20秒。断网、缺失资源、错误类型、配额失败与写入损坏都会使本次下载失败。失败清理当前临时缓存，上一完整包继续提供服务。系统直接终止 SW 时可能留下缺少提交记录的临时缓存，读取逻辑会跳过这些缓存。浏览器站点数据管理界面可清理它们。

同一 SW 下的多个标签页共享一个进行中的下载，均收到进度与最终结果。SW 安装完成后激活并接管页面，更新过程使用一致的提交记录格式读取旧包。每次成功保存后保留最新两个完整包，清理更早的完整包。其他 SW 正在使用的未提交缓存按其自己的生命周期处理。

页面导航会核对整个资源包，单个资源命中会核对其内容摘要。状态和课程快照读取会核对整个包的摘要。最新包发生驱逐或损坏时，尝试读取上一完整包。公开壳资源采用完整包优先策略，显式再次下载会从网络获取最新内容。

所有 `/api/` 请求、配置和模型会话、问答 POST、SSE 流式响应均使用实时网络。课程目录与详情的离线恢复由页面调用课程快照接口完成。Service Worker 的抓取规则仅匹配同源公开白名单 GET 请求。密钥和个人学习档案由现有会话与学习存储接口承接。

离线资料、IndexedDB 与浏览器持久存储均按来源隔离。协议、域名和端口决定来源，浏览器配置文件与系统安装容器也可能独立存储。跨设备和来源迁移使用通用学习档案接口，在目标容器内重新保存课程离线资料。

## 发布条件与四端安装

正式入口使用受设备信任的 HTTPS，开发入口使用同一设备的 `http://localhost` 或 `http://127.0.0.1`。SW 注册使用 `updateViaCache: 'none'`，每次启动可由浏览器检查脚本更新。SW 与 CacheStorage 的安全上下文要求可查阅官方参考。[Service Worker 注册说明](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)

手机通过局域网 IP 的普通 HTTP 地址访问时，浏览器通常将页面视为非安全上下文，离线模块返回 `supported: false` 并显示 HTTPS 指引。手机访问本机 localhost 指向手机自身。验收已用解析到127.0.0.1的普通 HTTP 测试主机名实测安全上下文限制，手机局域网真机测试待执行。发布时需要 HTTPS 证书、固定来源、根作用域路由以及上述资源的可访问性。

| 平台 | 浏览器内的安装步骤 |
|---|---|
| Android | 使用支持安装的 Chrome 或 Samsung Internet 打开 HTTPS 入口，从浏览器菜单选择安装应用或添加到主屏幕 |
| iOS / iPadOS | 在 Safari 打开 HTTPS 入口，分享菜单选择添加到主屏幕，按系统提示确认打开为网页 App。其他浏览器的分享入口取决于系统和浏览器能力 |
| macOS | Chrome / Edge 使用地址栏或菜单的安装入口。Safari 在 macOS Sonoma 14 及以后通过文件或分享菜单选择添加到程序坞 |
| Windows | Chrome / Edge 使用地址栏安装图标或菜单中的安装此站点为应用，之后从开始菜单启动 |

安装入口取决于系统和浏览器版本。iOS 的添加到主屏幕与桌面 Chromium 的安装提示采用各自浏览器入口。[安装能力与入口](https://web.dev/learn/pwa/installation)、[Apple 的 Mac 网页 App 说明](https://support.apple.com/en-ie/104996)

安装后，在目标 App 容器内打开学习记录并保存离线资料，确认 `ready`、版本、资源数和实际持久存储结果。随后断网关闭 App 并重新打开，检查知识详情和本地复习。持久化申请由浏览器决定，返回 `false` 时可正常完成缓存，但资料仍可能受存储驱逐策略影响。[持久存储申请说明](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist)

## 测试命令

以下命令在本工作树的 `成员三/ai_tutor` 下执行。使用主工作区已有 Python 虚拟环境。

```powershell
$pwaPython = 'E:\作业2\R语言及其应用\小组作业\成员三\ai_tutor\.venv\Scripts\python.exe'
& $pwaPython -m pytest -q
& $pwaPython -m uvicorn app.main:app --host 127.0.0.1 --port 8013 --log-level warning
```

在另一个终端准备 Playwright CLI 和浏览器测试依赖。已有本地 Playwright 时可使用其 `node_modules` 目录作为 `NODE_PATH`。

```powershell
npm.cmd install --no-save --package-lock=false --prefix .tmp/pwa-tools @playwright/cli
$env:NODE_PATH = (Join-Path (Get-Location) '.tmp\pwa-tools\node_modules')
$env:PWA_BROWSER_CHANNEL = 'chrome'
$env:PWA_BASE_URL = 'http://127.0.0.1:8013'
node tests/browser_pwa.js
# 合并线程一、二之后执行真实界面集成模式
node tests/browser_pwa.js --integrated
```

本机需要已安装 Chrome。也可安装 Playwright Chromium 后清除 `PWA_BROWSER_CHANNEL` 使用默认浏览器。脚本使用临时测试代理、独立持久浏览器目录、真实 SW 和 CacheStorage，在工作树根目录输出 `output/playwright/pwa-results.json` 与手机尺寸截图。测试进程关闭并重新启动浏览器验证离线重开。实际系统安装由真机清单验收。

默认模式仅对当前缺少的五个交接文件提供测试替身，题库替身由真实课程解释生成，并用独立测试版本标记。页面测试适配器调用真实 `KnowledgeMap` 与四个离线导出。`--integrated` 要求五个实际文件齐全，并直接运行合并后的页面，适合线程四验收。

现有浏览器回归使用项目原有 Playwright CLI 脚本，在工作树根目录生成仅替换端口的临时副本并运行。

```powershell
Set-Location ../..
npx.cmd --offline --package @playwright/cli playwright-cli -s=pwa-regression open http://127.0.0.1:8013/
New-Item -ItemType Directory -Force -Path .tmp,output/playwright | Out-Null
$browserSource = Get-Content -Raw '成员三/ai_tutor/tests/browser_check.js'
[IO.File]::WriteAllText((Join-Path (Get-Location) '.tmp\browser_check_8013.js'), $browserSource.Replace('http://127.0.0.1:8000','http://127.0.0.1:8013'))
npx.cmd --offline --package @playwright/cli playwright-cli -s=pwa-regression run-code --filename .tmp/browser_check_8013.js
```

## 已验证结果

2026年11月16日在 Windows、Python 3.12.10、Node.js 24.15.0、实际安装的 Chrome 157.0.8103.51 上完成测试。浏览器由 Playwright `1.66.0-alpha-1794252756000` 驱动，桌面尺寸1440×1000，窄屏仿真390×844。

| 范围 | 结果 |
|---|---|
| 后端与现有接口回归 | 219 passed，包含新增8项PWA测试和原有211项测试 |
| 现有 `browser_check.js` 页面回归 | 82项通过，浏览器未捕获异常0项 |
| 离线浏览器契约验收 | 27项通过，使用上述五个交接文件替身与课程读取适配器 |
| 实际入口缺失交接资源 | 下载报告 `learning-center.css` 的404并保持 `ready: false` |
| 持久存储申请实际结果 | API支持，浏览器本次返回 `granted: false` |
| HTTP安全上下文 | localhost支持，普通HTTP测试主机名返回不支持与HTTPS指引 |

27项离线验收覆盖首次安装激活、安装与完整包状态、缺失资源、完整下载、逐项进度、真实版本与摘要、状态事件、图标解码、断网刷新、实际地图详情、Three.js缓存命中、离线实时API失败、浏览器进程关闭重开、联网恢复、更新中断、配额故障注入、并发标签页、缺少持久存储能力、跨标签页课程更新、旧包与新SW兼容、新资源标记提交、实时配置及问答SSE、公开缓存清单、保留两个完整版本、HTTP安全条件、摘要损坏回退及资源驱逐检测。

模型相关浏览器验证使用真实 FastAPI 端点和课程模拟回答，现有AI单元测试使用项目的模拟上游。外部付费模型调用质量由已有模型验收流程覆盖。窄屏截图属于桌面浏览器设备尺寸仿真。

初次受限环境中的 TestClient 停滞和 Chrome Crashpad 管道限制已通过获批的本机隔离测试执行方式解决。

## 合并后与真机待验收

- 线程四合并线程一、二后运行 `node tests/browser_pwa.js --integrated`，验证实际 `app.js` 的健康状态反馈、课程目录和详情快照恢复、学习中心下载按钮与进度、参考答案版本、学习档案保存和导入导出。
- 核对 `index.html` 的manifest与图标链接、学习样式链接及全部资源版本标记。原有入口的 `20261116.3` 需要由界面线程统一为 `learning-v1`。
- 核对五个交接文件及26项白名单实际可获取，运行资源依赖清点测试。题库版本、参考答案与课程版本需显示真实下载结果。
- 在Android Chrome、iOS Safari、macOS Safari/Chrome和Windows Chrome/Edge实际安装，保存后断网关闭并重开，检查知识详情、本地学习、系统图标、standalone显示及联网恢复。
- 在手机实际局域网HTTP入口检查能力反馈，再在正式HTTPS入口验证安装。检查安装容器内的数据与普通浏览器来源隔离行为、持久化申请结果和通用学习档案迁移。

## 集成验收更新 · 2026-11-16

本分支成果已合并到 `codex/learning-integration`。最终实际代码、完整测试结果、跨浏览器范围、启动地址与真机待验收步骤见 `成员三/测试记录.md` 中本轮集成记录。本文前述单分支测试保留原始范围，跨线程待接线事项已在集成工作树复核。
