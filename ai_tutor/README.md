# R语言AI助教 1.2.1

这是基于成员一课程资料的学习应用，支持本地模拟、DeepSeek、通义千问和OpenAI真实问答，以及厂商网页搜索。默认模拟模式使用课程规则，所有代码建议显示未经运行验证。

## 开发入口

日常启动、依赖安装、项目级测试及目录职责见仓库根目录 [README](../README.md)。2026-11-16 的集成过程、本机端口和工作树命令已归档至 [学习功能集成交接](docs/handoff/learning-integration-2026-11-16.md)。

## 配置真实AI

在“更多 → 模型设置”选择厂商及真实AI或网页搜索模式，填写自己的模型ID和API Key，确认数据发送及用量后应用设置。连接测试由用户主动触发，可能产生用量。Key保存在该浏览器会话对应的后端内存，空闲30分钟或服务重启后清除。“清除密钥”可立即回到模拟模式。

三家已通过模拟上游测试，用户已反馈DeepSeek连接正常，完整真实问答及搜索质量评估待记录，Render发布待账号到位。配置、官方申请入口、评估和部署步骤见[模型配置与运行说明](../docs/deliverables/model-setup.md)，发布状态见 [发布信息](../docs/deliverables/release.md)。

回答Token上限默认8192，可在模型设置中调整至32768。主要解释和代码字段支持完整长回答，实际输出长度受模型能力和所选预算约束。

真实AI与网页搜索模式采用SSE流式输出，讲解和代码逐步显示。生成中内容标记待校验，结构及引用校验成功后保存学习记录。取消或中断时清除草稿并恢复发送状态。

AI回答以连续Markdown正文组织，标题、完整列表和多段代码按回答顺序显示。代码与对应说明相邻，追问按钮位于回答末尾。普通问题直接完整作答，练习题默认提示优先，可主动查看参考答案。旧记录完整展示已有步骤。

更新现有虚拟环境时运行 `.venv\Scripts\python.exe -m pip install -r requirements.txt`，然后重启服务。正式发布后的二维码生成依赖qrcode，可执行 `.venv\Scripts\python.exe -m pip install -r requirements-tools.txt` 安装。

## 现在怎么用

1. 双击本目录的 `start.cmd`。看到 `Ready` 表示启动成功；如果提示8000端口已经占用，先打开下面的网址确认已有服务。
2. 浏览器打开 [新版首页](http://127.0.0.1:8000/#/home)，点击“AI问答”，再点“缺失值与均值”。回答后点击“例题”或“易错点”连续学习；首条回答出现后隐藏示例入口。
3. 从导航进入“代码纠错”，手动输入或点击“选择.R文件”（也可拖入文件），补充报错后发送。桌面左侧编辑、右侧查看参考分析，手机上下排列。问答中仍可“添加代码”，收起后不提交残留内容。“内容来源”和“参考输出”默认折叠。
4. 知识地图把43个液态玻璃知识球体按八个课程单元分组，以相同角速度公转。按住鼠标左键或手指左右拖动调整公转角度，上下拖动移动摄像机。向下拖动抬高摄像机，向上拖动降低摄像机，松手后固定当前视角。拖动结束约1秒后恢复公转，悬停、搜索、筛选或阅读详情期间暂停。未拖动时松手打开详情。滚轮缩放，桌面详情在右侧、手机详情在底部，顶部导航可随时切换栏目。
5. “学习记录”包含概览、复习、小结与记录四页签。记录页可返回对话、导出或清空对话。切换视图保留未发送对话草稿，复习作答草稿支持刷新恢复。右上角“更多”、记录页和“设置与资料 → 学习档案”的“导出学习档案”打开同一面板，默认导出完整档案，也可选择对话记录。
6. 用完后双击 `stop.cmd`。脚本只停止它启动且身份核对一致的本项目进程，不关闭其他占用端口的程序。

当前对话导出文件名为 `r-tutor-conversations.json`，完整档案为 `r-tutor-learning-archive.json`，小结为 `r-tutor-weekly-report_{start}_{end}.txt`。

### AI学习总结

进入“学习记录 → 小结”，选择今日、最近7天或自选日期，点击“AI总结”。按钮附近显示当前厂商、模型和费用提示，“发送内容”可预览本次统计与摘录。生成使用模型设置中的会话密钥，搜索模式下使用普通生成。未配置时可直接打开模型设置。

生成中可取消，失败后可重试。有效总结保存在当前设备，刷新和离线可查看，可复制、导出文本和跳转知识或原学习记录。相同输入会显示已保存结果，点击“重新生成”主动更新。当前记录或模型设置变化后，旧结果会显示提示。

完整档案schemaVersion升级为2，新增summaries数组，继续支持导入版本1。IndexedDB升级为2，最多保存100份总结。清空对话会清理关联总结，重置个人档案会清理全部总结。已安装旧离线包的设备，联网点击“更新离线资料”，成功后刷新，当前资源版本为 `notice-timer-v1`。

本轮已安装当前电脑需要的依赖。换电脑或重新创建环境时，先安装Python 3.12（含Python Launcher），双击 `setup.cmd`，安装成功后再双击 `start.cmd`。首次安装需要联网；安装完成后，课程网页及模拟问答不依赖网络。

FastAPI交互文档：[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)。默认Swagger页面使用外部静态资源，首次打开需网络；原始接口定义 [openapi.json](http://127.0.0.1:8000/openapi.json) 可离线访问。接口操作的详细说明见[接口说明](../docs/deliverables/api-reference.md)。

## 新版页面地址

| 页面 | 本地地址 |
|---|---|
| 首页 | http://127.0.0.1:8000/#/home |
| 知识地图 | http://127.0.0.1:8000/#/knowledge |
| AI问答 | http://127.0.0.1:8000/#/chat |
| 代码纠错 | http://127.0.0.1:8000/#/review |
| 学习记录 | http://127.0.0.1:8000/#/history |

这些地址是同一网页内的视图。问答和纠错共用IndexedDB档案，并迁移旧版浏览器记录。浏览器前进、后退及刷新均支持。页面遵循系统“减少动画”设置，可用 Tab、Enter、Escape 操作导航和弹窗。

顶部导航采用浮动磨砂玻璃样式，搜索、输入、模型回答、“更多”菜单与设置弹窗复用同一套半透明材质。问答内容可滚动经过导航与输入栏下方，底部留白随输入栏高度调整。知识地图使用贯穿全屏的深色背景与深色玻璃导航。问答与纠错工作区铺满可用屏幕宽度，纠错页采用整页滚动。

学习页签统一保留纵向滚动条位置，长短页面切换时保持标题、页签和顶部导航对齐。“更多”菜单固定在导航下方，页面滚动时位置保持固定，较矮窗口可滚动菜单内部。

导出面板的两种选项支持整行选择和方向键切换，说明文字单独分行，窄屏和矮窗口内可滚动。完整档案保存为 `r-tutor-learning-archive.json`，包含对话、学习事件、复习卡片、作答、收藏和个人设置，可通过档案导入恢复。对话选项保存为 `r-tutor-conversations.json`，包含问题、回答、代码、引用和时间。课程资料在“设置与资料”中单独保存。当前离线资源版本为 `notice-timer-v1`，已有离线包的设备需要联网点击“更新离线资料”，成功后刷新。

## 本地.R文件与知识地图

- 仅接受单个 `.R` / `.r` 普通UTF-8文本文件，最大100KB；空白文件、无效UTF-8、空字符或明显二进制内容会被拒绝。目录不读取。
- 文件在浏览器中读取，不上传文件对象，也没有新增上传接口。点击发送后，代码字符串仍通过原来的 `/api/review` JSON请求提交给本地服务。
- 选择新文件且编辑区已有不同内容时，需要确认替换；取消或读取失败保留原代码。移除文件只清除关联信息，“清空代码”才删除代码内容。
- 文件可读取最多100KB，但接口仍只接受10000字符；超过限制会提示并阻止发送，不静默截断。文件关联和未提交草稿不会跨刷新保存。
- 问答、纠错均无课程侧栏。知识地图使用Three.js 0.170.0和自定义GLSL：规则点阵由顶点着色器形成连续波面，球体顶点着色器负责液态形变，片元着色器负责Fresnel边缘、虹彩和屏幕空间折射近似。
- 全景同时生成43个知识点，八个课程单元中心以同一半径16.5按正圆排列，各单元内部保持小圆环和原有间距。默认公转速度为0.025弧度/秒，约1.43度/秒。气泡公转与海洋波动使用独立状态。左右拖动调整公转角度，上下拖动让摄像机围绕课程中心升降，俯仰范围约5.7至71.6度，灵敏度为每像素0.0017弧度。气泡保持水平公转，鼠标滚轮支持缩放。搜索、筛选、悬停及阅读详情时暂停公转。系统开启“减少动画”时保持静止，离开地图或隐藏浏览器标签时暂停渲染，返回后继续。
- 全景不绘制暗色关系线；聚焦知识点时只显示它的直接关系线。文字保持透明背景并锚定在球体上，前景完整标题优先，发生遮挡时后方标签收缩为编号，悬停、聚焦或搜索命中后恢复完整标题。
- 知识详情使用深色覆盖面板：桌面端占页面约44%宽度并贯穿场景高度，手机端使用约70%视口高度的底部面板；打开详情不会离开知识地图。
- 课程单元使用项目自绘的深色菜单，支持鼠标、触摸、上下方向键、Home、End、Enter和Escape。五个栏目之间由页面内容执行100毫秒淡出和160毫秒淡入，导航栏持续显示。系统开启“减少动画”时立即切换。
- 可见知识标签是原生按钮，Tab、Enter和Space可操作；另有K01至K43的隐藏结构化导航供辅助技术使用。WebGL初始化失败时保留原生二维知识地图。
- 地图详情使用真实 `GET /api/knowledge/{id}` 内容。圆球缩写只用于显示，详情保留完整标题、解释、语法、参数、示例、易错点与来源；不会改变课程数据。

## 运行范围和能力限制

- 默认只监听 `127.0.0.1:8000`。这是当前电脑的地址，不是公网地址，手机和其他同学的电脑不能直接用它访问。
- 包含43个知识条目、24道问答、14个错误案例、95条知识关系。代码换行和来源定位来自原文；没有重新运行R代码或逐页核验PDF。
- 精确收录问题与已知错误案例优先匹配；关键词检索支持常见同义词。模拟模式遇到陌生问题、未知代码模式可能返回“未找到可靠匹配”，这是模拟版的正常限制。
- 模拟模式错误输出采用课程参考案例。真实AI模式按提交代码生成参考分析。代码标识符区分大小写，参考修正中的变量和数据需按实际任务调整。
- 追问支持例子、易错点和练习，发送最近6轮及当前代码，历史总长最多24000字符。真实AI模式由所选模型理解上下文。
- 同一浏览器的学习档案完整保存对话，问答工作区显示最近100条，较早对话可从学习记录打开；服务端会话配置保存在内存。不要把session_id当成用户认证。
- Excel的“39条已运行、4条待实测”记录已保留在导入报告中，本应用不将任何输出标为本次实测结果。

## 给成员二

前端可直接使用相对路径 `/api/chat` 等接口。独立开发服务器只放行 `http://localhost:5173` 和 `http://127.0.0.1:5173`；更换端口需要显式调整后端CORS配置。不要从 `file://` 双击HTML作为联调方式。

应用由 `app/main.py` 的 `create_app()` 组装，接口实现位于 `app/api/`，公共数据模型位于 `app/schemas.py`，资料检索和模拟回答位于 `app/engine.py`，模型、搜索及会话管理位于 `app/ai/`。前端入口是 `static/bootstrap.js`，`api-client.js`提供HTTP与SSE传输，`answer-renderer.js`负责回答正文渲染；`model-settings.js`负责模型设置；`knowledge-map.js`负责知识数据与详情，`liquid-scene.js`负责Three.js场景、GLSL材质和镜头转场，`r-file.js`负责本地文件读取，`learning.css`负责布局。Three.js及许可证固定在 `static/vendor/three/`，页面运行不依赖CDN。

`static/answer-markdown.js`使用本地Marked 18.2.0与DOMPurify 3.4.17解析及净化正文。固定版本来自npm发布包，已按包的sha512摘要核验，许可证随各自 `static/vendor/` 目录保存。

知识地图的主要可调参数集中在 `static/liquid-scene.js` 顶部的 `CONFIG`。`camera`控制构图、缩放范围和聚焦转场，`revolution.angularSpeed`控制公转角速度，单位为弧度/秒。`revolution.resumeDelayMs`控制拖动后的恢复等待时间。`ocean`控制粒子数量、范围、渐隐与波幅，`liquid`控制液态形变、透射与色散，`clusterRing`控制初始圆环布局。桌面使用17600个海面粒子，手机或低性能模式使用6240个，设备像素比上限分别为1.5和1。

## 给维护者

在本目录打开PowerShell，执行以下命令：

```powershell
# 自动接口与资料回归测试
.\.venv\Scripts\python.exe -m pytest -q

# 成员一更新资料后重新导入，再重启服务并测试
.\.venv\Scripts\python.exe scripts/import_data.py

# 按实际运行接口重新生成 docs/deliverables/api-reference.md
.\.venv\Scripts\python.exe scripts/generate_api_docs.py
```

运行依赖锁定在 `requirements.txt`，课程导入与发布工具使用 `requirements-tools.txt`，开发测试使用 `requirements-dev.txt`。维护前在项目虚拟环境执行 `python -m pip install -r requirements-dev.txt`。启动异常查看 `.runtime/server.err.log`；该目录、虚拟环境及临时文件都被Git忽略。

浏览器验收脚本位于 `tests/browser_check.js`，由Playwright CLI的 `run-code --filename` 执行。截图与下载验证产物使用项目目录的 `output/playwright/`，不纳入版本控制。浏览器验收命令（在工作区根目录执行，需 Node.js / npx）：

```powershell
npx.cmd --yes --package @playwright/cli playwright-cli -s=r-tutor-v3 open http://127.0.0.1:8000
npx.cmd --yes --package @playwright/cli playwright-cli -s=r-tutor-v3 run-code --filename "ai_tutor/tests/browser_check.js"
npx.cmd --yes --package @playwright/cli playwright-cli -s=r-tutor-v3 run-code --filename "ai_tutor/tests/browser_map_files.js"
npx.cmd --yes --package @playwright/cli playwright-cli -s=r-tutor-v3 run-code --filename "ai_tutor/tests/browser_glass_ui.js"
npx.cmd --yes --package @playwright/cli playwright-cli -s=r-tutor-mobile-map open http://127.0.0.1:8000/#/knowledge --device "Pixel 7"
npx.cmd --yes --package @playwright/cli playwright-cli -s=r-tutor-mobile-map run-code --filename "ai_tutor/tests/browser_mobile_map.js"
```

脚本清空独立测试浏览器中的学习记录，请勿连接个人常用浏览器执行。断开验收脚本 `tests/browser_offline.js` 由回归执行器在隔离上下文注入连接失败。真实断网刷新和重开由 `browser_pwa.js --integrated` 与 `browser_integration.cjs` 覆盖。停止脚本兼容 Windows PowerShell 与 PowerShell 7，并核对父进程身份及项目 Python 子进程。

## 已知测试环境说明

当前依赖组合的Starlette对TestClient使用httpx发出弃用警告；不影响本次测试通过。后续升级测试依赖时再迁移，不能因此省略回归。Codex的受限沙箱中TestClient曾停滞，当前通过记录来自正常本机权限下的测试。

## 模型与搜索浏览器测试

`tests/browser_fixture_server.py`默认监听127.0.0.1:8001，可用 `--port` 指定独立端口，所有上游调用使用MockTransport。为批量浏览器回归，测试服务将每分钟限制设为1000，正常应用的5次限制由后端测试单独验证。

在ai_tutor目录启动该测试服务后，用Playwright CLI打开 `http://127.0.0.1:8001/` 并运行 `tests/browser_ai.js`。该脚本覆盖设置、模拟真实问答、搜索引用、取消、密钥存储、键盘和手机布局。测试完成后停止该隔离服务。

Render配置位于仓库根目录 `render.yaml`，Root Directory使用 `.`，通过根目录 `render_service.py build` 安装依赖，通过 `render_service.py start` 启动。正式URL到位后运行 `scripts/publish_info.py --url HTTPS地址`，生成经基础核验的二维码及发布信息。
