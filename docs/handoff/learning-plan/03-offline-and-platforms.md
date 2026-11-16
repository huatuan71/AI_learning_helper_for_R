# 线程三提示词

将下面的提示词完整复制到一个独立聊天。

```text
请为R语言AI助教实现跨平台PWA和可验证的离线资料下载、离线启动与更新能力，支持Android、iOS、macOS、Windows。

仓库路径示例为 E:/projects/r-ai-tutor，项目位于 ai_tutor。
你的专属分支为 codex/offline-pwa。

先读取适用的AGENTS.md，以及 docs/handoff/learning-plan/00-coordination.md。遵守共享导出接口、资源路径和文件归属。

使用独立工作树。优先使用当前聊天已分配的工作树。需要自行创建时，可在仓库 .worktrees/offline-pwa 创建本分支工作树，并将 /.worktrees/ 加入本机 .git/info/exclude。

你的修改范围
- static/bootstrap.js、app/main.py。
- 新增 static/offline.js、static/service-worker.js、static/manifest.webmanifest、static/icons/。
- 新增 tests/browser_pwa.js、tests/test_pwa_assets.py、docs/offline-pwa.md。

先检查当前启动链、全部模块依赖、课程及图片资源引用、FastAPI静态资源挂载和现有浏览器测试。页面主体与学习中心由线程二负责，学习数据库和调度算法由线程一负责。

一、PWA与资源

实现合法manifest、项目自己的安装图标、standalone显示、名称、主题色、作用域及启动地址。使用现有R学习助手标识，保证PNG图标真实有效。
线程二会在index.html中加入协作约定的manifest、图标与学习样式链接。

在FastAPI增加 /sw.js 和 /offline-course.json 两个公共资源入口，均设置 include_in_schema=False。
/sw.js 返回真实Service Worker脚本，具备正确Content-Type、作用域和更新缓存头。
/offline-course.json 直接提供 data/course.json 的课程快照。现有业务接口与课程结构保持兼容。

修改bootstrap.js，资源标记使用 learning-v1，并在合适的启动位置调用 registerOffline。注册失败反馈要便于界面读取，现有课程和问答启动流程继续可用。

二、离线模块接口

导出协作约定的 registerOffline、getOfflineStatus、downloadOffline、getOfflineCourse 四个方法。

实现明确的资源白名单，覆盖应用HTML、CSS、JS、Three.js、复习题库、课程快照、manifest、图标及实际依赖的课程图像。
课程内容、参考答案和资源版本按真实下载结果展示。线程一、二尚未提供的文件列入最终资源清单，并明确交接依赖。

下载过程逐项汇报进度。只有完整资源集校验成功才标记离线可用。采用版本化缓存，更新中断时继续提供上一完整版本。处理安装尚未激活、多个标签页、旧版本更新、网络中断、配额不足和不支持持久存储的情况。

缓存采用公开静态资源白名单。API Key、模型会话、配置接口、提问POST和SSE请求通过实时网络访问。
离线GET课程由页面使用快照恢复，服务健康状态按实际连接显示。

三、跨平台行为

支持HTTPS正式入口及localhost开发入口，记录手机通过局域网HTTP访问时的实际离线能力和发布所需条件。
Android与iOS按支持的浏览器能力安装，macOS和Windows提供浏览器安装入口说明。
持久存储申请在用户主动保存离线资料时执行，返回或记录实际结果。
本地数据和离线缓存按浏览器来源隔离，备份恢复由学习模块的通用档案接口承接。

四、测试

使用playwright skill验证真实浏览器。至少覆盖完整下载、下载失败、版本状态、断网刷新、关闭重开、缓存命中、知识地图详情读取、缺失资源、更新中断、恢复联网和模型接口实时请求。
增加FastAPI资源测试，核对路径、Content-Type、缓存头、manifest、图标和现有OpenAPI协议。
现有接口测试继续运行。将测试结果区分为本线程已验证、等待其他模块合并后验证、需要真机验证。

将资源清单、缓存策略、更新方法、HTTPS条件、安装步骤、测试命令和结果写入 docs/offline-pwa.md。

完成后只提交你的归属文件，提交信息使用 feat: add cross-platform offline PWA support。最终返回提交编号、实际测试环境和结果、需要界面线程调用的事项以及集成时应检查的资源清单。
```
