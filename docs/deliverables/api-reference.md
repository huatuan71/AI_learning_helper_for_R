# R语言AI助教接口说明

应用版本为1.2.1，核对时间为2026-11-17T11:31:58+08:00。
接口表和数据类型取自当前运行服务的OpenAPI。模型适配测试使用模拟上游，真实账号与公网验收状态见测试记录。

## 启动与接入

运行 `ai_tutor/start.cmd` 使用默认8000端口。本轮集成服务为 `http://127.0.0.1:8016/`。
交互文档为 `/docs`，完整字段约束为 `/openapi.json`。
同域页面使用相对路径，JavaScript请求设置 `credentials: 'include'`。

## 已实现接口

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/ai/providers` | Providers |
| GET | `/api/ai/config` | Get Config |
| PUT | `/api/ai/config` | Configure |
| DELETE | `/api/ai/config` | Clear Config |
| POST | `/api/ai/test` | Test Connection |
| GET | `/api/health` | Health |
| GET | `/api/knowledge` | Catalog |
| GET | `/api/knowledge/{knowledge_id}` | Knowledge |
| POST | `/api/chat` | Chat |
| POST | `/api/review` | Review |
| POST | `/api/chat/stream` | Chat Stream |
| POST | `/api/review/stream` | Review Stream |
| POST | `/api/learning/summary` | Learning Summary |

目录接口返回43个知识点和95条关系，详情接口返回成员一课程字段、来源定位和先修知识。
健康接口报告应用能力与版本，读取健康状态无需模型调用。

## 学习与PWA公共资源

以下资源使用同源GET访问，返回200，两个根资源使用 `include_in_schema=False`。OpenAPI包含11条路径与13个操作。

| 路径 | 内容与访问方式 |
|---|---|
| `/sw.js` | JavaScript Service Worker，根作用域 `/`，响应头 `Service-Worker-Allowed: /` |
| `/offline-course.json` | 原始 `data/course.json` 公共课程快照，含43个知识点 |
| `/static/manifest.webmanifest` | PWA名称、启动入口、standalone显示模式与图标 |
| `/static/review-bank.json` | 94道带来源的本地复习题 |
| `/static/icons/icon-192.png`、`icon-512.png`、`apple-touch-icon.png` | 图标均位于 `/static/icons/` |

`/sw.js` 和 `/offline-course.json` 使用 `Cache-Control: no-cache, no-store, must-revalidate`。离线缓存由用户点击保存建立完整30项公开资源包。配置、Key、所有API、模型POST和SSE通过实时网络请求。

学习档案存于设备IndexedDB，通过页面导出JSON和合并导入。学习概览、收藏、小结和复习排程由浏览器模块处理。
学习入口为 `/#/history`，复习为 `/#/history/review`，小结为 `/#/history/summary`，对话为 `/#/history/records`。
跨设备安装PWA需受信任HTTPS。本机开发可使用localhost或127.0.0.1。

## 问答请求

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `session_id` | string | 否 | "" |
| `question` | string | 否 | "" |
| `task_type` | string | 否 | "auto" |
| `code` | string | 否 | "" |
| `error_message` | string | 否 | "" |
| `knowledge_id` | string / null | 否 | null |
| `teaching_mode` | string | 否 | "hint" |
| `history` | array<History> | 否 | null |

`history`每条包含user或assistant角色与文本，最多12条，每条最多12000字符，总计最多24000字符。
问题、代码或知识编号至少提供一项，审查入口还需要问题或代码。未知知识编号返回404。
当前模式由服务器Cookie会话决定，`session_id`用于兼容既有调用。
`/api/review`强制debug，练习使用hint或solution模式。
普通问答发送模型时省略teaching_mode，练习题按hint或solution处理。

## 问答响应

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `request_id` | string | 是 | null |
| `status` | string | 是 | null |
| `mode` | string | 是 | null |
| `task_type` | string | 是 | null |
| `answer` | Answer | 是 | null |
| `citations` | array<Citation> | 是 | null |
| `related_knowledge` | array<string> | 是 | null |
| `matched_case_id` | string / null | 是 | null |
| `prompt_version` | string | 是 | null |
| `knowledge_version` | string | 是 | null |
| `provider` | string / null | 否 | null |
| `model` | string / null | 否 | null |
| `used_web_search` | boolean | 否 | false |
| `search_status` | string | 否 | "not_requested" |
| `web_citations` | array<object> | 否 | null |
| `usage` | object | 否 | null |
| `duration_ms` | integer | 否 | 0 |

### 回答内容

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `content_markdown` | string | 否 | "" |
| `summary` | string | 是 | null |
| `steps` | array<string> | 是 | null |
| `issues` | array<Issue> | 是 | null |
| `corrected_code` | string | 是 | null |
| `example_code` | string | 是 | null |
| `expected_output` | string | 是 | null |
| `execution_status` | string | 是 | null |
| `code_kind` | string | 是 | null |
| `follow_ups` | array<string> | 是 | null |
| `is_supplementary` | boolean | 否 | false |

- 新AI回答使用 `answer.content_markdown` 保存连续Markdown正文，包含按顺序排列的解释、列表、多段代码及预期现象。
- 前端完整渲染正文，同级要点保持在同一列表。代码块保留复制及未经运行验证标识。
- `summary`提供兼容文本。已有记录及模拟回答继续支持steps、issues、corrected_code、example_code和expected_output，全部步骤按顺序展示。
- `follow_ups`位于完整回答与来源之后。练习题可主动选择参考答案。

- `mode`取mock、ai、search。
- `answer.code_kind`取reference_example或ai_suggestion，`execution_status`为not_executed。
- `answer.is_supplementary`标识课程之外的AI补充。
- `citations`由后端课程映射生成，包含knowledge_id、source_id、file、locator、raw。
- `web_citations`每项包含source_id、title、url，编号形如W1，正文以[W1]关联可点击来源。
- `search_status`取not_requested、not_triggered、completed、no_results或failed。
- `used_web_search`只在获取有效搜索来源时为true。
- `usage`保存厂商返回的input_tokens、output_tokens和total_tokens。搜索与整理调用相加。
- `duration_ms`为后端模型流程总耗时。

## 模型配置与连接测试

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `mode` | string | 否 | "mock" |
| `provider` | string / null | 否 | null |
| `model` | string | 否 | "" |
| `api_key` | string / null | 否 | null |
| `workspace_id` | string | 否 | "" |
| `region` | string | 否 | "cn-beijing" |
| `max_output_tokens` | integer | 否 | 8192 |

GET配置返回mode、provider、model、workspace_id、region、max_output_tokens、configured、key_suffix、expires_in_seconds、expired和last_test。
配置查询、写入和连接测试响应使用Cache-Control no-store。
max_output_tokens默认8192，允许256至32768。回答正文、示例代码、修正代码及预期输出按完整字符串返回，输出预算通过厂商请求参数控制。

PUT配置以mode、provider、model及api_key应用新连接。同厂商更新可省略Key，后端沿用该会话已有Key。切换厂商需要该厂商的Key。mode=mock会清除连接配置。
百炼支持北京和新加坡，业务空间ID填写后使用对应官方空间域名，留空使用传统DashScope官方域名。

POST连接测试以小请求核实聊天连接，会计入用量及限流。它返回status、provider、model、usage、duration_ms、search_tested，搜索实测在实际提问中完成。
DELETE配置取消会话中的在途模型调用并清除Key，配置回到mock。

## 流式问答与纠错

POST `/api/chat/stream` 和 `/api/review/stream` 使用相同的ChatRequest，通过SSE返回事件。
真实AI与搜索模式的前端采用流式接口，厂商回答通过实际流式HTTP读取。
搜索模式先收集网络证据，再流式生成教学回答。

| 事件 | 数据与用途 |
|---|---|
| status | stage为preparing、searching、generating、validating或repairing |
| delta | field与text，新正文追加到content_markdown，兼容summary、steps.0等步骤和旧代码字段 |
| reset | 清除当前草稿，开始重试或结构修复后的预览 |
| done | 完整ChatResponse，结构和引用校验通过后写入学习记录 |
| error | request_id及统一error对象，终止生成并丢弃草稿 |

响应使用text/event-stream，并设置Cache-Control及X-Accel-Buffering。等待期间发送心跳注释。
初始输入和来源错误采用HTTP错误响应，响应头发出后的生成错误通过error事件返回。
浏览器取消、连接断开或清除模型配置会取消上游调用并释放会话及并发名额。
预览标记待校验，模型内部思考内容过滤，最终成功事件到达后保存记录。
已输出内容的流式连接发生故障时，由页面提示用户手动重试。

## AI学习总结

`POST /api/learning/summary` 接收本地整理的证据，返回一次JSON响应。提示词版本为 `learning-summary-v1`。
页面入口为“学习记录 → 小结 → AI总结”。使用当前会话选择的厂商和模型，搜索模式下关闭搜索工具。
该请求沿用会话并发、Origin检查、60秒普通生成预算和厂商重试规则。输出Token上限取用户设置与4096的较小值。
请求设置 `cache: 'no-store'`，接口成功及失败响应均设置 `Cache-Control: no-store`。

### 请求

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `schema_version` | integer | 是 | null |
| `input_fingerprint` | string | 是 | null |
| `period` | SummaryPeriod | 是 | null |
| `metrics` | SummaryMetrics | 是 | null |
| `coverage` | SummaryCoverage | 是 | null |
| `evidence` | array<SummaryEvidence> | 是 | null |

### 日期范围

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `start_date` | string | 是 | null |
| `end_date` | string | 是 | null |
| `time_zone` | string | 是 | null |

### 本地统计

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `topic_count` | integer | 是 | null |
| `study_event_count` | integer | 是 | null |
| `attempt_count` | integer | 是 | null |
| `independent_self_rated_count` | integer | 是 | null |
| `conversation_count` | integer | 是 | null |

### 摘录覆盖

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `total_evidence_count` | integer | 是 | null |
| `included_evidence_count` | integer | 是 | null |
| `truncated` | boolean | 是 | null |
| `policy_version` | string | 是 | null |

### 证据

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `id` | string | 是 | null |
| `source_id` | string | 是 | null |
| `kind` | string | 是 | null |
| `at` | string | 是 | null |
| `knowledge_ids` | array<string> | 是 | null |
| `text` | string | 是 | null |
| `signals` | AttemptSignals / null | 否 | null |

### 作答信号

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `grade` | string | 是 | null |
| `hint_used` | boolean | 是 | null |
| `answer_revealed` | boolean | 是 | null |
| `question_type` | string | 是 | null |

### 响应

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `request_id` | string | 是 | null |
| `status` | string | 是 | null |
| `mode` | string | 是 | null |
| `provider` | string / null | 是 | null |
| `model` | string / null | 是 | null |
| `prompt_version` | string | 是 | null |
| `input_fingerprint` | string | 是 | null |
| `generated_at` | string | 是 | null |
| `period` | SummaryPeriod | 是 | null |
| `coverage` | SummaryCoverage | 是 | null |
| `usage` | object | 是 | null |
| `duration_ms` | integer | 是 | null |
| `summary` | LearningSummary / null | 是 | null |

### 总结正文

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `overview` | string | 是 | null |
| `topics` | array<SummaryTopic> | 是 | null |
| `review_priorities` | array<SummaryPriority> | 是 | null |
| `next_actions` | array<SummaryAction> | 是 | null |
| `uncertainties` | array<string> | 是 | null |

### 主题观察

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `knowledge_id` | string | 是 | null |
| `evidence_ids` | array<string> | 是 | null |
| `observation` | string | 是 | null |

### 复习优先项

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `knowledge_id` | string | 是 | null |
| `evidence_ids` | array<string> | 是 | null |
| `reason` | string | 是 | null |

### 下一步建议

| 字段 | 类型 | 必填 | 默认值 |
|---|---|---|---|
| `knowledge_id` | string | 是 | null |
| `evidence_ids` | array<string> | 是 | null |
| `action` | string | 是 | null |
| `reason` | string | 是 | null |

输入版本固定为整数1。日期是有效的YYYY-MM-DD，起止日期均包含在范围内，按显式IANA时区归属自然日。
证据时间采用UTC ISO格式，来源ID最多200字符，证据ID为类型前缀 `c:`、`a:` 或 `e:` 加来源ID。
最多50条证据，单条摘录最多1200个Unicode字符，请求原始JSON最多120 KiB UTF-8。
知识ID限课程K01至K43，知识列表去重。统计为非负整数，独立自评次数不得超过作答次数。
覆盖数量须与证据和本地统计相符，遗漏记录必须标记truncated。作答必须包含signals，其他类型省略signals。
grade取again、hinted、good、easy，question_type取concept或application，两种提示标志均为布尔值。
前端排除专用代码字段、个人备注和密钥，使用同一输入对象进行预览和发送。
输入指纹是归一化输入的SHA-256，排除指纹字段自身与界面临时状态。

overview最多1200字符，三个具体建议数组及uncertainties分别最多10项。
observation、reason、action和单条uncertainty最多600字符，每项具体建议引用1至10个不重复证据。
模型输出JSON总量同时限制为64 KiB UTF-8。
后端核对知识和证据属于本次输入，且知识点与对应证据关联。无效JSON、未知引用和超长输出返回502 STRUCTURED_OUTPUT_INVALID。
模型处理学习记录时将原对话与旧AI回答视为数据。总结解释自评和提示的局限，掌握等级与复习时间继续由现有规则计算。

### 请求示例

示例指纹使用64个0表示占位，实际页面由 `buildSummaryInput` 计算。

```json
{
  "schema_version": 1,
  "input_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000",
  "period": {
    "start_date": "2026-11-17",
    "end_date": "2026-11-17",
    "time_zone": "Asia/Shanghai"
  },
  "metrics": {
    "topic_count": 1,
    "study_event_count": 1,
    "attempt_count": 0,
    "independent_self_rated_count": 0,
    "conversation_count": 0
  },
  "coverage": {
    "total_evidence_count": 1,
    "included_evidence_count": 1,
    "truncated": false,
    "policy_version": "learning-summary-evidence-v1"
  },
  "evidence": [
    {
      "id": "e:visit-example",
      "source_id": "visit-example",
      "kind": "event",
      "at": "2026-11-17T08:00:00.000Z",
      "knowledge_ids": [
        "K06"
      ],
      "text": "浏览知识点，仅表明访问"
    }
  ]
}
```

### 成功示例

示例中的用量和耗时用于说明字段。运行时取厂商实际返回的usage与本次处理耗时。

```json
{
  "request_id": "example-request",
  "status": "ok",
  "mode": "ai",
  "provider": "deepseek",
  "model": "configured-model",
  "prompt_version": "learning-summary-v1",
  "input_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000",
  "generated_at": "2026-11-17T08:01:00.000Z",
  "period": {
    "start_date": "2026-11-17",
    "end_date": "2026-11-17",
    "time_zone": "Asia/Shanghai"
  },
  "coverage": {
    "total_evidence_count": 1,
    "included_evidence_count": 1,
    "truncated": false,
    "policy_version": "learning-summary-evidence-v1"
  },
  "usage": {
    "input_tokens": 100,
    "output_tokens": 80,
    "total_tokens": 180
  },
  "duration_ms": 1200,
  "summary": {
    "overview": "本期记录显示浏览了缺失值相关知识，掌握程度需验证。",
    "topics": [
      {
        "knowledge_id": "K06",
        "observation": "有一次知识点访问记录。",
        "evidence_ids": [
          "e:visit-example"
        ]
      }
    ],
    "review_priorities": [],
    "next_actions": [
      {
        "knowledge_id": "K06",
        "action": "独立完成一次缺失值练习。",
        "reason": "现有证据只有浏览记录，建议检测理解情况。",
        "evidence_ids": [
          "e:visit-example"
        ]
      }
    ],
    "uncertainties": [
      "浏览记录不足以验证独立作答能力。"
    ]
  }
}
```

空范围在模型调用前返回200，响应包含 `status: "no_data"`、`mode: "local"` 和 `summary: null`。
此时无需配置模型，也不会产生模型调用。

```json
{
  "request_id": "example-request",
  "status": "no_data",
  "mode": "local",
  "provider": null,
  "model": null,
  "prompt_version": "learning-summary-v1",
  "input_fingerprint": "0000000000000000000000000000000000000000000000000000000000000000",
  "generated_at": "2026-11-17T08:01:00.000Z",
  "period": {
    "start_date": "2026-11-17",
    "end_date": "2026-11-17",
    "time_zone": "Asia/Shanghai"
  },
  "coverage": {
    "total_evidence_count": 0,
    "included_evidence_count": 0,
    "truncated": false,
    "policy_version": "learning-summary-evidence-v1"
  },
  "usage": {},
  "duration_ms": 0,
  "summary": null
}
```

未配置模型返回409 CONFIG_REQUIRED，会话失效返回409 SESSION_EXPIRED。
请求超过120 KiB返回413 REQUEST_TOO_LARGE，字段或日期无效返回422 VALIDATION_ERROR。
取消、超时、上游故障和配置变更使用下文统一错误结构。

```json
{"request_id":"example-request","error":{"code":"STRUCTURED_OUTPUT_INVALID","message":"模型总结格式或来源校验失败，请重新生成。","retryable":true}}
```

### 浏览器调用

```javascript
const {buildSummaryInput} = await import('/static/learning-summary-data.js?v=ai-summary-v1');
const {learningStore} = await import('/static/learning-store.js?v=learning-v1');
const input = await buildSummaryInput(await learningStore.snapshot(), {
  start_date: '2026-11-17', end_date: '2026-11-17', time_zone: 'Asia/Shanghai'
});
const controller = new AbortController();
const response = await fetch('/api/learning/summary', {
  method: 'POST', credentials: 'include', cache: 'no-store',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify(input), signal: controller.signal
});
const result = await response.json();
if (!response.ok) throw new Error(result.error.message);
if (result.status === 'ok') await learningStore.saveSummary(result, input);
// 取消按钮调用 controller.abort()。
```

### 保存、恢复与离线更新

IndexedDB版本为2，完整档案schemaVersion为2，新增summaries数组。支持导入schemaVersion 1，旧档案的总结按空数组处理。
缓存保留有效响应和证据定位元数据，最多100条，按生成时间保留最近结果。
缓存键包含日期、时区、输入指纹、厂商、模型及提示词版本，同一输入主动重新生成后原子更新。
合并相同总结ID时保留较晚的有效结果，时间相同按归一化内容确定顺序，档案整体上限20 MiB。
清空对话会在同一事务中清理引用该对话的总结，重置个人档案会清理全部总结。
界面可复制、导出文本、打印及跳转来源，原始证据缺失时显示提示并禁用失效跳转。
已保存总结可离线查看。资源版本为 `ai-summary-v1`，旧离线包用户联网点击“更新离线资料”，成功后刷新。

更新记录为2026年11月17日，新增手动学习总结、取消、证据校验、缓存与档案兼容。



## 会话、限额和错误

Cookie名称为r_tutor_session，随机生成，启用HttpOnly与SameSite=Strict，公网启用Secure。
会话空闲30分钟到期。服务重启后配置失效，GET配置返回expired标记并创建空配置。
写入接口检查Origin和Sec-Fetch-Site，公网配置与模型调用要求HTTPS。

每会话同时1次模型请求，全服务并发3个，会话与IP每分钟各5次，连接测试计入额度。
普通模型请求总期限60秒，搜索流程90秒。暂时性故障共享1次重试额度，结构校验失败可修复1次。

所有HTTP响应附带X-Request-ID。问答正文及错误正文同时包含request_id。
错误结构如下。

```json
{"request_id":"请求编号","error":{"code":"稳定错误码","message":"中文说明","retryable":false}}
```

| 状态 | 错误码或含义 |
|---|---|
| 400 | PROVIDER_AUTH_FAILED、MODEL_NOT_FOUND、PROVIDER_BAD_REQUEST、HTTPS_REQUIRED |
| 402 | QUOTA_EXCEEDED |
| 403 | ORIGIN_FORBIDDEN |
| 404 | NOT_FOUND |
| 409 | SESSION_EXPIRED、CONFIG_REQUIRED、CONFIG_CHANGED |
| 413 | REQUEST_TOO_LARGE，总结输入超过120 KiB |
| 422 | VALIDATION_ERROR、CONFIG_REQUIRED、SEARCH_UNSUPPORTED、CONTENT_REFUSED |
| 429 | SESSION_BUSY、SERVICE_BUSY、RATE_LIMITED、PROVIDER_RATE_LIMITED |
| 499 | REQUEST_CANCELLED |
| 502 | SEARCH_FAILED、STRUCTURED_OUTPUT_INVALID、UPSTREAM_FORMAT_ERROR、EMPTY_RESPONSE、OUTPUT_TRUNCATED、STREAM_INTERRUPTED |
| 503 | SERVICE_BUSY、NETWORK_ERROR、PROVIDER_UNAVAILABLE |
| 504 | UPSTREAM_TIMEOUT |

参数错误返回422。Markdown正文经本地DOMPurify净化，代码按文本展示，链接限定HTTP或HTTPS并排除URL凭据。网络引用编号映射到实际搜索来源。
源码、日志与浏览器记录中采用脱敏及明确字段清单，API Key保存在服务器会话内存。
