# 模型配置与运行说明

应用版本为1.2.1，适用于成员二、成员三、成员四及课堂使用者。当前应用入口位于仓库根目录的 `ai_tutor/`，统一启动与测试步骤见 [项目说明](../../README.md)。

## 本机使用

1. 首次使用运行 `ai_tutor/setup.cmd`，已有环境更新时在该目录运行 `.venv\Scripts\python.exe -m pip install -r requirements.txt`。
2. 运行 `ai_tutor/start.cmd`，浏览器打开 `http://127.0.0.1:8000/`。
3. 点击“更多 → 模型设置”，选择真实AI或网页搜索模式。
4. 选择厂商，填写模型ID和自己的Key。百炼按账号填写业务空间与地域。
5. 勾选数据发送及用量确认，点击“应用设置”。可主动点击“测试连接”核实聊天连接。
6. 进入AI问答或代码纠错。搜索模式逐条展示本轮来源，练习支持提示及参考答案。
7. 使用“清除密钥”立即回到模拟模式。停止本机服务使用 `stop.cmd`。

密钥输入支持显示和隐藏。Key保存在当前浏览器会话对应的服务器内存，空闲30分钟或服务重启后清除。浏览器存储和导出采用字段清单。问题、代码及必要历史会发送至所选厂商，搜索模式还会产生搜索与回答整理调用。

回答Token上限默认8192，可在模型设置中填写256至32768。解释、完整代码、引用编号及JSON结构均占用输出预算，具体可用长度受所选模型约束。代码和主要讲解字段按完整字符串校验、展示和保存。

## 厂商能力与依据

核查日期为2026年11月15日。以下适配器已完成模拟上游测试，真实账号状态见测试记录。

| 厂商 | 预设模型 | 接口 | 搜索方式 |
|---|---|---|---|
| DeepSeek | deepseek-flash | Chat Completions | deepseek_web_search工具及server_tool_calls |
| 通义千问 | qwen-plus，搜索另可选qwen-flash | DashScope原生生成接口 | enable_search及search_info.search_results |
| OpenAI | gpt-6-astra | Responses | web_search及返回的工具调用和来源 |

三家支持普通JSON接口、SSE流式回答和厂商返回的Token用量。模型ID可编辑，搜索开关依据已核实模型表启用。真实AI页面逐步显示讲解和代码，搜索模式先归集网络证据，再流式生成教学回答。生成中内容标记待校验，完成结构与引用校验后写入学习记录。

回答使用连续Markdown正文，完整列表、多段代码和对应说明按生成顺序展示。追问按钮位于回答末尾。代码块支持复制并标记未经运行验证。普通提问直接完整回答，练习题默认提供提示，点击“参考答案”可查看完整解答。

旧学习记录继续读取，原有摘要和全部步骤顺序展示。后续追问会携带完整正文，并按既有历史预算裁剪较早内容。

DeepSeek搜索工具的参数和输出结构来自其官方说明。调用前在官方平台申请API Key。[API说明](https://api-docs.deepseek.com/guides/web_tools/)、[官方平台](https://platform.deepseek.com/)

百炼使用原生接口提取结构化搜索来源。北京与新加坡使用各自地域Key，业务空间ID填写后使用空间官方域名。传统DashScope账号可将空间ID留空。[API说明](https://help.aliyun.com/zh/model-studio/web-search)、[官方控制台](https://bailian.console.aliyun.com/)

OpenAI使用Responses API的搜索工具，正文引用链接到实际返回来源。模型账号权限、可用地区和用量以控制台为准。[API说明](https://developers.openai.com/api/docs/guides/tools-web-search?api-mode=responses)、[Key管理](https://platform.openai.com/api-keys)

## 故障处理

| 页面提示 | 操作 |
|---|---|
| Key无效或没有权限 | 核对厂商、模型ID、地域与Key，重新应用设置 |
| 额度不足 | 到对应厂商控制台检查额度 |
| 每分钟请求受限 | 等待后重试，会话与IP分别每分钟5次 |
| 搜索未触发或零结果 | 查看本轮状态，调整问题或使用真实AI模式 |
| 模型配置到期或服务重启 | 重新填写并应用Key |
| 网络故障或超时 | 稍后重试或修改模型配置 |
| 回答字段校验失败且自动修复未成功 | 重试，并保留页面显示的字段名和请求编号供维护者查看日志 |

应用提供取消请求按钮，浏览器断开和清除配置会取消在途上游工作。已经发出的厂商请求可能产生用量。

流式连接提前中断会显示错误并清除草稿。点击发送可重新尝试，完整学习记录在成功校验后保存。应用更新重启后，请刷新页面并重新填写Key。

回答结构校验日志位于 `.runtime/server.err.log`。使用页面请求编号检索，可看到initial与repair阶段的字段名、错误类型和输出结构摘要，便于维护者核对模型输出格式。

## Render部署

仓库根目录提供 `render.yaml`，配置Python 3.12、免费实例、新加坡地域、同域静态页面与API及单worker。

Render的Root Directory使用仓库根目录 `.`。构建命令为 `python render_service.py build`，启动命令为 `python render_service.py start`。仓库根目录的英文入口脚本通过Python路径处理定位应用，读取现有依赖和课程数据。Render配置字段中的路径均使用ASCII字符。

1. 将本次应用改动同步至自己的GitHub仓库分支。
2. 在Render登录，创建Blueprint并连接该仓库，Blueprint Path填写 `render.yaml`，核对Root Directory为 `.`。
3. 环境变量APP_ENV使用production。Render提供的RENDER_EXTERNAL_URL用于公网来源检查。
4. 等待构建和健康检查成功，检查首页、`/docs`、`/openapi.json`及`/api/health`。
5. 通过正式HTTPS页面配置自己的Key，完成真实提问与搜索。
6. 在本地的 `ai_tutor/` 目录运行下列命令，脚本先核验公网健康状态和首页，再生成发布信息及SVG二维码。

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-tools.txt
.\.venv\Scripts\python.exe scripts/publish_info.py --url https://your-app.onrender.com
```

二维码生成位置为 `ai_tutor/output/release/qrcode.svg`，地址记录到 `docs/deliverables/release.md`。
Render免费实例空闲15分钟后休眠，唤醒约需1分钟，课堂演示前打开页面预热并检查配置状态。[部署说明](https://render.com/docs/deploy-fastapi)、[免费实例说明](https://render.com/docs/free)

部署配置中的代理头信任参数适用于Render反向代理后的实例。本机启动脚本采用回环地址。公网验收需使用真实手机蜂窝网络、学校网络及两设备并发。

## 评估与维护

在 `ai_tutor` 目录运行下列命令。

```powershell
# 安装维护工具和测试依赖
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt

# 后端测试均使用假Key及模拟HTTP
.\.venv\Scripts\python.exe -m pytest -q

# 导出38道已有案例和12道候选题的检索评估
.\.venv\Scripts\python.exe scripts/evaluate.py

# 显式进行20次真实调用，Key通过隐藏输入提供，将产生用量
.\.venv\Scripts\python.exe scripts/evaluate.py --live --provider deepseek --limit 20 --output output/live-evaluation.csv

# 搜索评估单独记录
.\.venv\Scripts\python.exe scripts/evaluate.py --live --search --provider deepseek --limit 20 --output output/search-evaluation.csv

# 按当前运行版本生成接口说明
.\.venv\Scripts\python.exe scripts/generate_api_docs.py
```

真实评估脚本按13秒最小间隔调用，遵守每分钟5次的限制。CSV保留问题编号、检索命中、响应与耗时，人工评分栏由成员一和成员四填写。
`tests/evaluation_holdout.json`是开发者起草的候选题，待成员四独立审核后作为保留集。检索命中率和回答质量分别报告。

代码建议的运行状态统一为未经运行验证，核心R样例需在受控R环境核验并补充记录。
