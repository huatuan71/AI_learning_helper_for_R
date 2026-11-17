"""Local browser test fixture. All upstream traffic terminates in MockTransport."""
import asyncio
import json
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
import uvicorn

from app.main import app
from app.ai.sessions import SessionStore
from support.provider_fakes import streamed_wire, teaching, wire
from support.summary_fakes import summary_result
from support.exercise_fakes import exercise_result


async def fake_upstream(request):
    if request.headers.get('authorization') == 'Bearer test-invalid-key':
        return httpx.Response(401, json={'error': {'code': 'invalid_key'}})
    payload = json.loads(request.content)
    provider = 'openai' if request.url.host == 'api.openai.com' else 'deepseek' if request.url.host == 'api.deepseek.com' else 'qwen'
    messages = payload['input'] if provider == 'openai' else payload['input']['messages'] if provider == 'qwen' else payload['messages']
    text = '\n'.join(message['content'] for message in messages)
    if '延迟测试' in text:
        await asyncio.sleep(10)
    search = bool(payload.get('tools') or payload.get('parameters', {}).get('enable_search'))
    if search:
        sources = [] if '零结果' in text else [
            {'title': 'R官方资料（模拟上游）', 'url': 'https://stat.ethz.ch/R-manual/R-devel/library/base/html/NA.html'},
            {'title': '<img src=x onerror=alert(1)>', 'url': 'javascript:alert(1)'},
        ]
        return httpx.Response(200, json=wire(provider, '使用is.na检查缺失。', sources,
                                            search='无需搜索' not in text))
    if text == '只回复OK':
        return httpx.Response(200, json=wire(provider, 'OK'))
    if '你是R语言课程出题助手' in messages[0]['content']:
        data = json.loads(messages[-1]['content'])
        body = {key: data[key] for key in ['schema_version', 'knowledge_ids', 'count', 'difficulty', 'formats', 'recent_prompts']}
        return httpx.Response(200, json=wire(provider, json.dumps(exercise_result(body), ensure_ascii=False)))
    if '你是R语言学习记录分析助手' in messages[0]['content']:
        data = json.loads(messages[-1]['content'])
        item = next((item for item in data['evidence'] if item['knowledge_ids']), None)
        result = summary_result(item['id'], item['knowledge_ids'][0]) if item else {
            'overview': '本期仅有未关联知识点的对话，建议先补充独立练习记录。',
            'topics': [], 'review_priorities': [], 'next_actions': [],
            'uncertainties': ['现有记录不足以验证掌握程度。'],
        }
        return httpx.Response(200, json=wire(provider, json.dumps(result, ensure_ascii=False)))
    result = teaching()
    current = messages[-1]['content']
    if current.startswith('{"task_type"') and json.loads(current).get('question') == 'NA长回答测试':
        result['answer']['summary'] = '完整讲解。' + 'explanation ' * 1100 + '讲解结束'
        result['answer']['corrected_code'] = '# 长代码示例\n' + 'print(1)\n' * 1500 + '# 代码结束'
    if 'search_explanation' in text and '"source_id": "W1"' in text:
        result['answer']['summary'] = '使用is.na判断缺失。[W1]'
    if '"task_type": "debug"' in text:
        result['answer']['issues'] = [{'kind': 'logic', 'line': None, 'reason': '与NA比较不能得到可靠的筛选条件。'}]
        result['answer']['corrected_code'] = 'x <- c(1, NA, 3)\nx[!is.na(x)]'
    if current.startswith('{"task_type"'):
        question = json.loads(current).get('question', '')
        if question == 'NA格式兼容测试':
            result = {**result['answer'], 'knowledge_ids': result['knowledge_ids']}
            result.update(follow_ups=['建议一', '建议二', '建议三'], corrected_code=None)
        if question == 'NA字段失败测试':
            result['answer']['summary'] = {'invalid': '模拟格式错误'}
    if '模拟格式错误' in text:
        result['answer']['summary'] = {'invalid': '模拟格式错误'}
    if 'answer' in result and isinstance(result['answer'].get('summary'), str):
        answer = result['answer']
        code = answer['corrected_code'] or answer['example_code']
        answer['content_markdown'] = answer['summary'] + '\n\n' + '\n'.join(
            f'{index}. {step}' for index, step in enumerate(answer['steps'], 1))
        if code:
            answer['content_markdown'] += '\n\n用下面的R代码检查处理结果。\n\n```r\n' + code + '\n```\n\n运行后检查返回值。'
        if current.startswith('{"task_type"') and json.loads(current).get('question') == 'NA正文顺序测试':
            answer['content_markdown'] = ('先创建输入，用于后续缺失值处理。\n\n```r\nx <- c(1, NA)\n```\n\n'
                '输入中有一个缺失值。接着用下面代码过滤。\n\n```r\nx[!is.na(x)]\n```\n\n预期保留数值1。\n\n'
                '1. 思路一\n2. 思路二\n3. 思路三\n4. 验证结果\n\n'
                '| 项目 | 说明 |\n|---|---|\n| 输入 | 含NA |')
        if current.startswith('{"task_type"') and json.loads(current).get('question') == 'NA Markdown安全测试':
            answer['content_markdown'] = ('安全正文。\n\n<script>window.markdownAttack=true</script>'
                '<img src=x onerror="window.markdownAttack=true">\n\n'
                '[危险链接](javascript:alert(1)) [数据链接](data:text/html,bad) '
                '[凭据链接](https://name:password@example.org)\n\n`x[W1]`')
        if current.startswith('{"task_type"') and json.loads(current).get('question') == 'NA无代码解释测试':
            answer['content_markdown'] = 'NA表示缺失值。\n\n当前只需理解缺失的含义。'
        result['answer'] = {'content_markdown': answer.pop('content_markdown'), **answer}
        if current.startswith('{"task_type"') and json.loads(current).get('question') == 'NA旧格式四步骤测试':
            result['answer'].pop('content_markdown')
            result['answer']['steps'] = ['先明确目标', '思路一', '思路二', '思路三']
    if payload.get('stream') or request.headers.get('X-DashScope-SSE') == 'enable':
        slow = current.startswith('{"task_type"') and json.loads(current).get('question') in {'NA流式显示测试', 'NA正文顺序测试'}
        interrupted = current.startswith('{"task_type"') and json.loads(current).get('question') == 'NA中断测试'
        return streamed_wire(provider, json.dumps(result, ensure_ascii=False), delay=.08 if slow else .01,
                             size=20 if slow else 200, finish=not interrupted)
    return httpx.Response(200, json=wire(provider, json.dumps(result, ensure_ascii=False)))


if __name__ == '__main__':
    app.state.ai_transport = httpx.MockTransport(fake_upstream)
    app.state.sessions = SessionStore(rate=1000)
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8001)
    args = parser.parse_args()
    uvicorn.run(app, host='127.0.0.1', port=args.port, log_level='warning')
