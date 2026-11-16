"""Generate handoff documentation from the running app's actual OpenAPI schema."""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
DELIVERABLES_ROOT = ROOT.parent / 'docs' / 'deliverables'
BASE = os.environ.get('BASE_URL', 'http://127.0.0.1:8000').rstrip('/')


def read(path):
    with urlopen(BASE + path, timeout=10) as response:
        return json.load(response)


def type_name(schema):
    if '$ref' in schema:
        return schema['$ref'].split('/')[-1]
    if 'anyOf' in schema:
        return ' / '.join(type_name(item) for item in schema['anyOf'])
    if schema.get('type') == 'array':
        return 'array<' + type_name(schema['items']) + '>'
    return schema.get('type', 'object')


def table(schema, name):
    model = schema['components']['schemas'][name]
    lines = ['| 字段 | 类型 | 必填 | 默认值 |', '|---|---|---|---|']
    for key, value in model['properties'].items():
        required = '是' if key in model.get('required', []) else '否'
        default = json.dumps(value.get('default'), ensure_ascii=False)
        lines.append(f'| `{key}` | {type_name(value)} | {required} | {default} |')
    return '\n'.join(lines)


def main():
    health, schema = read('/api/health'), read('/openapi.json')
    if health['version'] != '1.2.1':
        raise RuntimeError('请先重启至1.2.1再生成接口说明')
    timestamp = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds')
    routes = ['| 方法 | 路径 | 用途 |', '|---|---|---|']
    for path, operations in schema['paths'].items():
        for method, operation in operations.items():
            if method in {'get', 'post', 'put', 'delete'}:
                routes.append(f'| {method.upper()} | `{path}` | {operation.get("summary", "")} |')
    text = f'''# R语言AI助教接口说明

应用版本为{health['version']}，核对时间为{timestamp}。
接口表和数据类型取自当前运行服务的OpenAPI。模型适配测试使用模拟上游，真实账号与公网验收状态见测试记录。

## 启动与接入

运行 `ai_tutor/start.cmd` 使用默认8000端口。本轮集成服务为 `{BASE}/`。
交互文档为 `/docs`，完整字段约束为 `/openapi.json`。
同域页面使用相对路径，JavaScript请求设置 `credentials: 'include'`。

## 已实现接口

{chr(10).join(routes)}

目录接口返回43个知识点和95条关系，详情接口返回成员一课程字段、来源定位和先修知识。
健康接口报告应用能力与版本，读取健康状态无需模型调用。

## 学习与PWA公共资源

以下资源使用同源GET访问，返回200，两个根资源使用 `include_in_schema=False`。OpenAPI仍有10条路径与12个操作。

| 路径 | 内容与访问方式 |
|---|---|
| `/sw.js` | JavaScript Service Worker，根作用域 `/`，响应头 `Service-Worker-Allowed: /` |
| `/offline-course.json` | 原始 `data/course.json` 公共课程快照，含43个知识点 |
| `/static/manifest.webmanifest` | PWA名称、启动入口、standalone显示模式与图标 |
| `/static/review-bank.json` | 94道带来源的本地复习题 |
| `/static/icons/icon-192.png`、`icon-512.png`、`apple-touch-icon.png` | 图标均位于 `/static/icons/` |

`/sw.js` 和 `/offline-course.json` 使用 `Cache-Control: no-cache, no-store, must-revalidate`。离线缓存由用户点击保存建立完整26项公开资源包。配置、Key、所有API、模型POST和SSE通过实时网络请求。

学习档案存于设备IndexedDB，通过页面导出JSON和合并导入。学习概览、收藏、小结和复习排程由浏览器模块处理。
学习入口为 `/#/history`，复习为 `/#/history/review`，小结为 `/#/history/summary`，对话为 `/#/history/records`。
跨设备安装PWA需受信任HTTPS。本机开发可使用localhost或127.0.0.1。

## 问答请求

{table(schema, 'ChatRequest')}

`history`每条包含user或assistant角色与文本，最多12条，每条最多12000字符，总计最多24000字符。
问题、代码或知识编号至少提供一项，审查入口还需要问题或代码。未知知识编号返回404。
当前模式由服务器Cookie会话决定，`session_id`用于兼容既有调用。
`/api/review`强制debug，练习使用hint或solution模式。
普通问答发送模型时省略teaching_mode，练习题按hint或solution处理。

## 问答响应

{table(schema, 'ChatResponse')}

### 回答内容

{table(schema, 'Answer')}

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

{table(schema, 'ModelConfig')}

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

## 会话、限额和错误

Cookie名称为r_tutor_session，随机生成，启用HttpOnly与SameSite=Strict，公网启用Secure。
会话空闲30分钟到期。服务重启后配置失效，GET配置返回expired标记并创建空配置。
写入接口检查Origin和Sec-Fetch-Site，公网配置与模型调用要求HTTPS。

每会话同时1次模型请求，全服务并发3个，会话与IP每分钟各5次，连接测试计入额度。
普通模型请求总期限60秒，搜索流程90秒。暂时性故障共享1次重试额度，结构校验失败可修复1次。

所有HTTP响应附带X-Request-ID。问答正文及错误正文同时包含request_id。
错误结构如下。

```json
{{"request_id":"请求编号","error":{{"code":"稳定错误码","message":"中文说明","retryable":false}}}}
```

| 状态 | 错误码或含义 |
|---|---|
| 400 | PROVIDER_AUTH_FAILED、MODEL_NOT_FOUND、PROVIDER_BAD_REQUEST、HTTPS_REQUIRED |
| 402 | QUOTA_EXCEEDED |
| 403 | ORIGIN_FORBIDDEN |
| 404 | NOT_FOUND |
| 409 | SESSION_EXPIRED、CONFIG_REQUIRED、CONFIG_CHANGED |
| 422 | VALIDATION_ERROR、CONFIG_REQUIRED、SEARCH_UNSUPPORTED、CONTENT_REFUSED |
| 429 | SESSION_BUSY、SERVICE_BUSY、RATE_LIMITED、PROVIDER_RATE_LIMITED |
| 499 | REQUEST_CANCELLED |
| 502 | SEARCH_FAILED、STRUCTURED_OUTPUT_INVALID、UPSTREAM_FORMAT_ERROR、EMPTY_RESPONSE、OUTPUT_TRUNCATED、STREAM_INTERRUPTED |
| 503 | SERVICE_BUSY、NETWORK_ERROR、PROVIDER_UNAVAILABLE |
| 504 | UPSTREAM_TIMEOUT |

参数错误返回422。Markdown正文经本地DOMPurify净化，代码按文本展示，链接限定HTTP或HTTPS并排除URL凭据。网络引用编号映射到实际搜索来源。
源码、日志与浏览器记录中采用脱敏及明确字段清单，API Key保存在服务器会话内存。
'''
    (DELIVERABLES_ROOT / 'api-reference.md').write_text(text, encoding='utf-8')
    print('接口说明已按当前运行服务的OpenAPI更新。')


if __name__ == '__main__':
    main()
