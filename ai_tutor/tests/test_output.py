"""Regression cases for plausible model formatting and provenance errors."""
import json
import logging

import httpx
import pytest

from app.ai.output import output_schema, parse_teaching
from app.ai.schemas import ModelAnswer
from app.ai.service import SYSTEM, messages_for
from app.main import ChatRequest
from support.provider_fakes import (
    FAKE_KEY, configure, events, install, streamed_wire, teaching, wire,
)

pytestmark = pytest.mark.usefixtures('clean_state')


def variant(name):
    result = teaching()
    if name == 'flat':
        return {**result['answer'], 'knowledge_ids': result['knowledge_ids']}
    if name == 'answer_string':
        return {**result['answer'], 'answer': result['answer']['summary'],
                'knowledge_ids': result['knowledge_ids']}
    if name == 'optional_fields':
        result['answer'].update(steps='先检查缺失值。', issues=None, corrected_code=None,
                                example_code=None, expected_output=None, is_supplementary=None,
                                follow_ups=['建议一', '建议二', '建议三'], model_comment='辅助元数据')
        result['knowledge_ids'] = ['K06', 'K06']
        result['metadata'] = {'status': 'ok'}
    return result


@pytest.mark.parametrize('provider', ['deepseek', 'qwen', 'openai'])
@pytest.mark.parametrize('name', ['flat', 'answer_string', 'optional_fields'])
@pytest.mark.parametrize('stream', [False, True])
def test_model_format_variations(client, monkeypatch, provider, name, stream):
    calls = []
    def handler(request):
        calls.append(request)
        text = json.dumps(variant(name), ensure_ascii=False)
        if stream:
            return streamed_wire(provider, text, size=20, delay=.01)
        return httpx.Response(200, json=wire(provider, text))
    install(monkeypatch, handler)
    configure(client, provider)
    response = client.post('/api/chat/stream' if stream else '/api/chat', json={'question': 'NA'})
    assert response.status_code == 200, response.text
    if stream:
        frames = events(response)
        assert frames[-1][0] == 'done', frames[-1]
        assert any(kind == 'delta' and data['field'] == 'summary' for kind, data in frames)
        result = frames[-1][1]
    else:
        result = response.json()
    assert result['answer']['summary'] == teaching()['answer']['summary']
    assert result['related_knowledge'] == ['K06']
    assert len(result['answer']['follow_ups']) <= 2
    assert len(calls) == 1


def test_system_example_and_schema_match_validator():
    example = SYSTEM.split('完整结构示例如下：\n', 1)[1].split('\nknowledge_ids', 1)[0]
    assert ModelAnswer.model_validate_json(example).answer.content_markdown
    schema = output_schema(['K06'])
    assert schema['properties']['knowledge_ids']['items']['enum'] == ['K06']
    assert output_schema([])['properties']['knowledge_ids']['maxItems'] == 0
    messages = messages_for(ChatRequest(question='NA'), 'concept', [{'id': 'K06'}])
    assert 'JSON Schema' in messages[0]['content']
    assert json.loads(messages[-1]['content'])['allowed_knowledge_ids'] == ['K06']


@pytest.mark.parametrize('wrapper', ['plain', 'fence', 'encoded'])
def test_json_wrappers(wrapper):
    text = json.dumps(teaching())
    if wrapper == 'fence':
        text = '\ufeff```JSON\n' + text + '\n```'
    elif wrapper == 'encoded':
        text = json.dumps(text)
    result = parse_teaching(text, ['K06'], [], ChatRequest(question='NA'))
    assert result.answer.summary == teaching()['answer']['summary']


def test_r_indexing_is_not_a_web_reference(client, monkeypatch):
    result = teaching()
    result['answer'].update(summary='用`x[W1]`提取元素。', steps=['也可以分行写\n```r\nx[W2]\n```'],
                            example_code='W1 <- c(1, 2)\nx[W1]')
    install(monkeypatch, lambda request: httpx.Response(200, json=wire('deepseek', json.dumps(result))))
    configure(client)
    response = client.post('/api/chat', json={'question': 'NA'})
    assert response.status_code == 200
    assert response.json()['answer']['example_code'] == result['answer']['example_code']


@pytest.mark.parametrize('line,expected', [(1, 1), ('1', 1), (99, None), (0, None), ('未知', None)])
def test_issue_line_normalization(client, monkeypatch, line, expected):
    result = teaching()
    result['answer']['issues'] = [{'kind': '逻辑错误', 'line': line, 'reason': '请使用is.na。'}]
    install(monkeypatch, lambda request: httpx.Response(200, json=wire('deepseek', json.dumps(result))))
    configure(client)
    response = client.post('/api/review', json={'question': 'NA', 'code': 'x == NA'})
    assert response.status_code == 200
    assert response.json()['answer']['issues'] == [{'kind': 'logic', 'line': expected, 'reason': '请使用is.na。'}]


@pytest.mark.parametrize('field', ['summary', 'follow_ups'])
def test_forged_prose_reference_still_fails(client, monkeypatch, field):
    result = teaching()
    result['answer'][field] = ['伪造[W99]'] if field == 'follow_ups' else '伪造[W99]'
    install(monkeypatch, lambda request: httpx.Response(200, json=wire('deepseek', json.dumps(result))))
    configure(client)
    response = client.post('/api/chat', json={'question': 'NA'})
    assert response.json()['error']['code'] == 'STRUCTURED_OUTPUT_INVALID'


@pytest.mark.parametrize('stream', [False, True])
def test_repair_and_logs_have_field_details_without_content(client, monkeypatch, caplog, stream):
    calls = []
    result = teaching()
    result['answer']['summary'] = {'private-output-marker': 'never-log-this-content'}
    def handler(request):
        calls.append(json.loads(request.content))
        text = json.dumps(result)
        if stream:
            return streamed_wire('deepseek', text)
        return httpx.Response(200, json=wire('deepseek', text))
    install(monkeypatch, handler)
    monkeypatch.setattr(logging.getLogger('r_tutor'), 'propagate', True)
    caplog.set_level(logging.WARNING, logger='r_tutor')
    configure(client)
    response = client.post('/api/chat/stream' if stream else '/api/chat', json={'question': 'NA'})
    data = events(response)[-1][1] if stream else response.json()
    assert data['error']['code'] == 'STRUCTURED_OUTPUT_INVALID'
    assert 'answer.summary' in data['error']['message']
    repair = calls[1]['messages'][-1]['content']
    assert 'answer.summary' in repair and 'string_type' in repair
    assert data['request_id'] in caplog.text
    assert 'phase=initial' in caplog.text and 'phase=repair' in caplog.text
    assert 'string_type' in caplog.text
    assert all(secret not in caplog.text + response.text for secret in
               (FAKE_KEY, 'private-output-marker', 'never-log-this-content'))


@pytest.mark.parametrize('provider', ['deepseek', 'qwen', 'openai'])
@pytest.mark.parametrize('stream', [False, True])
def test_continuous_markdown_preserves_order(client, monkeypatch, provider, stream):
    body = '先准备输入。\n\n```r\nx <- c(1, NA)\n```\n\n再处理缺失。\n\n```r\nx[!is.na(x)]\n```\n\n1. 思路一\n2. 思路二\n3. 思路三\n4. 验证结果'
    result = {'answer': {'content_markdown': body, 'follow_ups': ['如何验证？']}, 'knowledge_ids': ['K06']}
    def handler(request):
        text = json.dumps(result, ensure_ascii=False)
        if stream:
            return streamed_wire(provider, text, size=20, delay=.01)
        return httpx.Response(200, json=wire(provider, text))
    install(monkeypatch, handler)
    configure(client, provider)
    response = client.post('/api/chat/stream' if stream else '/api/chat', json={'question': 'NA'})
    data = events(response)[-1][1] if stream else response.json()
    assert data['answer']['content_markdown'] == body
    assert data['answer']['summary'] == body
    assert data['answer']['steps'] == []
    if stream:
        deltas = [data['text'] for kind, data in events(response)
                  if kind == 'delta' and data['field'] == 'content_markdown']
        assert ''.join(deltas) == body


@pytest.mark.parametrize('task', ['concept', 'function', 'debug', 'exercise'])
def test_hint_parameter_is_scoped_to_exercises(task):
    messages = messages_for(ChatRequest(question='NA', teaching_mode='hint'), task, [])
    data = json.loads(messages[-1]['content'])
    assert ('teaching_mode' in data) == (task == 'exercise')
    assert '每段代码放在对应说明旁' in messages[0]['content']
    assert set(output_schema([])['$defs']['TeachingAnswer']['properties']) == {
        'content_markdown', 'issues', 'follow_ups', 'is_supplementary'}


@pytest.mark.parametrize('mode', ['hint', 'solution'])
@pytest.mark.parametrize('stream', [False, True])
def test_exercise_markdown_obeys_teaching_mode(client, monkeypatch, mode, stream):
    body = '先明确输入和输出。\n\n```r\nSECRET_SOLUTION <- 42\n```\n\n再思考缺失值。'
    result = {'answer': {'content_markdown': body}, 'knowledge_ids': ['K06']}
    def handler(request):
        text = json.dumps(result, ensure_ascii=False)
        if stream:
            return streamed_wire('deepseek', text, size=10, delay=.01)
        return httpx.Response(200, json=wire('deepseek', text))
    install(monkeypatch, handler)
    configure(client)
    response = client.post('/api/chat/stream' if stream else '/api/chat', json={
        'question': 'NA练习', 'task_type': 'exercise', 'teaching_mode': mode})
    data = events(response)[-1][1] if stream else response.json()
    assert data['answer']['content_markdown'].startswith('先明确输入')
    if mode == 'hint':
        assert 'SECRET_SOLUTION' not in response.text
    else:
        assert data['answer']['content_markdown'] == body


@pytest.mark.parametrize('forged', [True, False])
def test_markdown_citations_are_validated(client, monkeypatch, forged):
    body = '缺失值说明[W99]' if forged else '使用`x[W1]`。\n\n```r\nx[W2]\n```'
    result = {'answer': {'content_markdown': body}, 'knowledge_ids': ['K06']}
    install(monkeypatch, lambda request: httpx.Response(200, json=wire('deepseek', json.dumps(result))))
    configure(client)
    response = client.post('/api/chat', json={'question': 'NA'})
    if forged:
        assert response.json()['error']['code'] == 'STRUCTURED_OUTPUT_INVALID'
    else:
        assert response.json()['answer']['content_markdown'] == body
