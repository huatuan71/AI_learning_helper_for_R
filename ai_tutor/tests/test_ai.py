"""All provider requests in this suite use fake keys and MockTransport."""
import asyncio
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.ai.providers import ADAPTERS, PROVIDERS, CallBudget, safe_source
from app.ai.schemas import AIError, ModelConfig
from app.ai.sessions import Session, SessionStore

from support.provider_fakes import FAKE_KEY, configure, install, teaching, wire

pytestmark = pytest.mark.usefixtures('clean_state')


def test_catalog_and_config_lifecycle(client):
    providers = client.get('/api/ai/providers').json()['providers']
    assert {item['id'] for item in providers} == {'deepseek', 'qwen', 'openai'}
    initial = client.get('/api/ai/config')
    assert initial.json()['mode'] == 'mock'
    response = configure(client)
    assert response.status_code == 200
    assert response.json()['key_suffix'] == '1234'
    assert FAKE_KEY not in response.text
    assert 'HttpOnly' in initial.headers['set-cookie']
    assert client.get('/api/ai/config').headers['cache-control'] == 'no-store'
    assert client.delete('/api/ai/config').json()['configured'] is False
    assert client.post('/api/chat', json={'question': 'NA'}).json()['mode'] == 'mock'


@pytest.mark.parametrize('provider', PROVIDERS)
def test_default_output_budget_reaches_provider(client, monkeypatch, provider):
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=wire(provider, json.dumps(teaching())))
    install(monkeypatch, handler)
    assert client.get('/api/ai/config').json()['max_output_tokens'] == 8192
    assert configure(client, provider).json()['max_output_tokens'] == 8192
    assert client.post('/api/chat', json={'question':'NA'}).status_code == 200
    payload = seen[0]
    forwarded = payload['parameters']['max_tokens'] if provider == 'qwen' else payload.get('max_output_tokens', payload.get('max_tokens'))
    assert forwarded == 8192


@pytest.mark.parametrize('limit', [4096, 8192, 16384, 32768])
def test_configurable_output_budget(client, limit):
    response = configure(client, max_output_tokens=limit)
    assert response.status_code == 200
    assert client.get('/api/ai/config').json()['max_output_tokens'] == limit


@pytest.mark.parametrize('limit', [255, 32769])
def test_output_budget_boundaries(client, limit):
    assert configure(client, max_output_tokens=limit).status_code == 422


def test_long_teaching_fields_are_preserved(client, monkeypatch):
    body = teaching()
    body['answer'].update(summary='完整解释。' + 'explanation ' * 1200,
        corrected_code='# 完整修正\n' + 'print(1)\n' * 1500,
        example_code='# 独立示例\n' + 'print(2)\n' * 1500,
        expected_output='1\n' * 3500)
    install(monkeypatch, lambda request: httpx.Response(200, json=wire('deepseek', json.dumps(body))))
    configure(client, max_output_tokens=32768)
    response = client.post('/api/review', json={'question':'NA怎么处理', 'code':'x <- c(1, NA)'})
    assert response.status_code == 200
    for field in ('summary','corrected_code','example_code','expected_output'):
        assert response.json()['answer'][field] == body['answer'][field]


def test_sessions_are_isolated(client):
    configure(client)
    with TestClient(app) as other:
        assert other.get('/api/ai/config').json()['configured'] is False
        assert other.post('/api/chat', json={'question': 'NA'}).json()['mode'] == 'mock'
        other.delete('/api/ai/config')
    assert client.get('/api/ai/config').json()['configured'] is True


def test_provider_change_requires_new_key(client):
    configure(client)
    response = client.put('/api/ai/config', json={'mode': 'ai', 'provider': 'openai', 'model': 'gpt-6-astra'})
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'CONFIG_REQUIRED'
    assert client.get('/api/ai/config').json()['provider'] == 'deepseek'
    response = client.put('/api/ai/config', json={'mode': 'ai', 'provider': 'deepseek', 'model': 'custom-model'})
    assert response.status_code == 200


@pytest.mark.parametrize('body', [
    {'mode': 'invalid'}, {'mode': 'ai', 'api_key': 'bad\nkey'},
    {'mode': 'ai', 'api_key': FAKE_KEY, 'workspace_id': '../../evil'},
    {'mode': 'ai', 'max_output_tokens': 100000}, {'mode': 'ai', 'api_key': {'value': FAKE_KEY}},
    {'mode': 'mock', 'base_url': 'http://127.0.0.1:9000'},
])
def test_config_validation_is_redacted(client, body):
    response = client.put('/api/ai/config', json=body)
    assert response.status_code == 422
    assert FAKE_KEY not in response.text


def test_search_capability_validation(client):
    response = configure(client, mode='search', model='unverified-model')
    assert response.status_code == 422
    assert response.json()['error']['code'] == 'SEARCH_UNSUPPORTED'


def test_cookie_expiry_and_restart(client):
    configure(client)
    token = client.cookies.get('r_tutor_session')
    app.state.sessions.sessions[token].touched -= 1801
    assert client.post('/api/chat', json={'question': 'NA'}).json()['error']['code'] == 'SESSION_EXPIRED'
    assert client.get('/api/ai/config').json()['expired'] is True
    configure(client)
    app.state.sessions = SessionStore()
    assert client.get('/api/ai/config').json()['configured'] is False


@pytest.mark.parametrize('method,path', [('put','/api/ai/config'), ('delete','/api/ai/config'),
                                       ('post','/api/ai/test'), ('post','/api/chat')])
def test_cross_origin_is_rejected(client, method, path):
    kwargs = {'headers': {'Origin': 'https://unrelated.example'}}
    if method == 'put':
        kwargs['json'] = {'mode': 'mock'}
    elif path == '/api/chat':
        kwargs['json'] = {'question': 'NA'}
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 403


def test_production_https_and_cookie(monkeypatch):
    monkeypatch.setenv('APP_ENV', 'production')
    with TestClient(app, base_url='http://localhost') as insecure:
        assert configure(insecure).json()['error']['code'] == 'HTTPS_REQUIRED'
    with TestClient(app, base_url='https://classroom.example') as secure:
        response = configure(secure)
        assert response.status_code == 200
        cookie = response.headers['set-cookie']
        assert 'Secure' in cookie and 'HttpOnly' in cookie and 'SameSite=strict' in cookie


@pytest.mark.parametrize('provider', PROVIDERS)
@pytest.mark.parametrize('task', ['concept','function','debug','exercise'])
def test_provider_teaching_and_prompts(client, monkeypatch, provider, task):
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        assert request.headers['authorization'] == 'Bearer ' + FAKE_KEY
        assert FAKE_KEY not in request.content.decode()
        return httpx.Response(200, json=wire(provider, json.dumps(teaching())))
    install(monkeypatch, handler)
    assert configure(client, provider).status_code == 200
    response = client.post('/api/review' if task == 'debug' else '/api/chat', json={
        'question': 'is.na怎么判断缺失？', 'task_type': task, 'knowledge_id': 'K06',
        'history': [{'role': 'user', 'content': '上一轮的用户代码x <- c(1, NA)'}]})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['mode'] == 'ai' and result['provider'] == provider
    assert result['answer']['execution_status'] == 'not_executed'
    assert result['answer']['code_kind'] == 'ai_suggestion'
    assert result['citations'][0]['knowledge_id'] == 'K06'
    assert result['usage']['input_tokens'] == 10
    assert not result['web_citations'] and not result['used_web_search']
    assert 'K06' in json.dumps(seen) and '上一轮的用户代码' in json.dumps(seen, ensure_ascii=False)
    if task == 'exercise':
        assert not result['answer']['example_code']


@pytest.mark.parametrize('provider', PROVIDERS)
def test_search_pipeline_and_real_sources(client, monkeypatch, provider):
    seen = []
    def handler(request):
        payload = json.loads(request.content)
        seen.append(payload)
        is_search = bool(payload.get('tools') or payload.get('parameters', {}).get('enable_search'))
        if is_search:
            return httpx.Response(200, json=wire(provider, 'R官方文档说明缺失值。',
                sources=[{'title': 'R文档', 'url': 'https://stat.ethz.ch/R-manual/R-devel/library/base/html/NA.html'}], search=True))
        body = teaching()
        body['answer']['summary'] += '[W1]'
        return httpx.Response(200, json=wire(provider, json.dumps(body)))
    install(monkeypatch, handler)
    configure(client, provider, 'search')
    response = client.post('/api/chat', json={'question': '搜索R官方文档解释NA', 'knowledge_id': 'K06'})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['search_status'] == 'completed' and result['used_web_search'] is True
    assert result['web_citations'][0]['source_id'] == 'W1'
    assert result['usage']['input_tokens'] == 20 and len(seen) == 2
    assert FAKE_KEY not in response.text
    if provider == 'deepseek':
        assert seen[0]['tools'] == [{'type': 'deepseek_web_search'}]
        assert 'response_format' not in seen[0]
    elif provider == 'openai':
        assert seen[0]['tools'] == [{'type': 'web_search'}] and seen[0]['store'] is False
    else:
        assert seen[0]['parameters']['search_options']['enable_source'] is True


@pytest.mark.parametrize('provider', PROVIDERS)
@pytest.mark.parametrize('triggered', [True, False])
def test_search_zero_results_and_not_triggered(client, monkeypatch, provider, triggered):
    count = 0
    def handler(request):
        nonlocal count
        count += 1
        return httpx.Response(200, json=wire(provider,
            '未找到资料' if count == 1 else json.dumps(teaching()), search=triggered and count == 1))
    install(monkeypatch, handler)
    configure(client, provider, 'search')
    response = client.post('/api/chat', json={'question': 'NA'})
    assert response.status_code == 200, response.text
    assert response.json()['search_status'] == ('no_results' if triggered else 'not_triggered')
    assert not response.json()['used_web_search'] and not response.json()['web_citations']


@pytest.mark.parametrize('provider', ['deepseek','openai'])
def test_failed_search_is_an_error(client, monkeypatch, provider):
    install(monkeypatch, lambda request: httpx.Response(200, json=wire(provider, '搜索失败', search=True, failed=True)))
    configure(client, provider, 'search')
    response = client.post('/api/chat', json={'question': 'NA'})
    assert response.status_code == 502 and response.json()['error']['code'] == 'SEARCH_FAILED'


@pytest.mark.parametrize('status,code,expected,attempts', [
    (401, 'invalid_key', 'PROVIDER_AUTH_FAILED', 1),
    (403, 'denied', 'PROVIDER_AUTH_FAILED', 1),
    (402, 'insufficient_balance', 'QUOTA_EXCEEDED', 1),
    (429, 'insufficient_quota', 'QUOTA_EXCEEDED', 1),
    (404, 'unknown_model', 'MODEL_NOT_FOUND', 1),
    (429, 'rate_limit', 'PROVIDER_RATE_LIMITED', 2),
    (503, 'unavailable', 'PROVIDER_UNAVAILABLE', 2),
    (400, 'DataInspectionFailed', 'CONTENT_REFUSED', 1),
    (400, 'unsupported', 'PROVIDER_BAD_REQUEST', 1),
])
def test_upstream_errors_redacted(client, monkeypatch, caplog, status, code, expected, attempts):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={'error': {'code': code, 'message': FAKE_KEY}})
    install(monkeypatch, handler)
    configure(client)
    response = client.post('/api/chat', json={'question': 'NA'})
    assert response.json()['error']['code'] == expected
    assert len(calls) == attempts
    assert FAKE_KEY not in response.text + caplog.text


@pytest.mark.parametrize('exception,expected', [(httpx.ReadTimeout, 'UPSTREAM_TIMEOUT'),
                                               (httpx.ConnectError, 'NETWORK_ERROR')])
def test_transport_errors(client, monkeypatch, exception, expected):
    def handler(request):
        raise exception(FAKE_KEY, request=request)
    install(monkeypatch, handler)
    configure(client)
    assert client.post('/api/chat', json={'question': 'NA'}).json()['error']['code'] == expected


@pytest.mark.parametrize('invalid', ['not json', json.dumps(teaching(knowledge_ids=['K99'])),
                                  json.dumps(teaching(answer={'summary': '猜测[W99]'})),
                                  json.dumps(teaching(answer={'summary': {'text': '类型错误'}}))])
def test_invalid_output_repairs_once(client, monkeypatch, invalid):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=wire('deepseek', invalid))
    install(monkeypatch, handler)
    configure(client)
    response = client.post('/api/chat', json={'question': 'NA'})
    assert response.json()['error']['code'] == 'STRUCTURED_OUTPUT_INVALID'
    assert len(calls) == 2


def test_repair_success(client, monkeypatch):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=wire('deepseek', 'bad' if len(calls) == 1 else json.dumps(teaching())))
    install(monkeypatch, handler)
    configure(client)
    assert client.post('/api/chat', json={'question': 'NA'}).status_code == 200
    assert len(calls) == 2


def test_rate_limit_and_test_connection(client):
    configure(client)
    assert client.post('/api/ai/test').json()['search_tested'] is False
    for _ in range(4):
        assert client.post('/api/chat', json={'question': 'NA'}).status_code == 200
    response = client.post('/api/chat', json={'question': 'NA'})
    assert response.status_code == 429 and response.json()['error']['code'] == 'RATE_LIMITED'
    assert client.get('/api/ai/config').json()['last_test']['status'] == 'ok'


def test_ip_limit_survives_new_session(client):
    configure(client)
    for _ in range(5):
        assert client.post('/api/chat', json={'question': 'NA'}).status_code == 200
    with TestClient(app) as other:
        configure(other)
        assert other.post('/api/chat', json={'question': 'NA'}).status_code == 429


def test_gate_limits_and_releases():
    async def scenario():
        store = SessionStore(max_concurrent=1)
        session = Session(time.monotonic())
        async with store.admit(session, 'one'):
            with pytest.raises(AIError, match='SESSION_BUSY'):
                async with store.admit(session, 'one'):
                    pass
            with pytest.raises(AIError, match='SERVICE_BUSY'):
                async with store.admit(Session(time.monotonic()), 'two'):
                    pass
        assert store.active == 0 and not session.busy
    asyncio.run(scenario())


def test_clear_cancels_inflight(monkeypatch):
    async def scenario():
        started = asyncio.Event()
        async def handler(request):
            started.set()
            await asyncio.sleep(10)
            return httpx.Response(200, json=wire('deepseek', json.dumps(teaching())))
        install(monkeypatch, handler)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://testserver') as connection:
            await connection.put('/api/ai/config', json={'mode':'ai', 'provider':'deepseek', 'model':'deepseek-flash', 'api_key':FAKE_KEY})
            pending = asyncio.create_task(connection.post('/api/chat', json={'question':'NA'}))
            await asyncio.wait_for(started.wait(), 2)
            assert (await connection.delete('/api/ai/config')).status_code == 200
            response = await asyncio.wait_for(pending, 2)
            assert response.json()['error']['code'] == 'CONFIG_CHANGED'
            assert app.state.sessions.active == 0
    asyncio.run(scenario())


@pytest.mark.parametrize('url', ['javascript:alert(1)', 'data:text/html,bad', 'https://name:password@example.org', 'https://example.org\nHeader: bad'])
def test_unsafe_network_source(url):
    assert safe_source({'url': url}) is None


@pytest.mark.parametrize('region,workspace,host', [
    ('cn-beijing','','dashscope.aliyuncs.com'),
    ('ap-southeast-1','','dashscope-intl.aliyuncs.com'),
    ('cn-beijing','workspace123','workspace123.cn-beijing.maas.aliyuncs.com'),
])
def test_qwen_endpoint(region, workspace, host):
    config = ModelConfig(mode='ai', provider='qwen', model='qwen-plus', api_key=FAKE_KEY, region=region, workspace_id=workspace)
    url, body = ADAPTERS['qwen'].request(config, [], False, True, 2048)
    assert url == f'https://{host}/api/v1/services/aigc/text-generation/generation'
    assert body['parameters']['response_format']['type'] == 'json_object'


def test_expired_budget():
    with pytest.raises(AIError, match='UPSTREAM_TIMEOUT'):
        CallBudget(time.monotonic() - 1).remaining()


def test_non_json_upstream(client, monkeypatch):
    install(monkeypatch, lambda request: httpx.Response(200, text='<html>failure</html>'))
    configure(client)
    assert client.post('/api/chat', json={'question':'NA'}).json()['error']['code'] == 'UPSTREAM_FORMAT_ERROR'


@pytest.mark.parametrize('provider', PROVIDERS)
def test_truncation_is_rejected(provider):
    raw = wire(provider, 'partial')
    if provider == 'openai':
        raw['status'] = 'incomplete'
    else:
        output = raw['output'] if provider == 'qwen' else raw
        output['choices'][0]['finish_reason'] = 'length'
    with pytest.raises(AIError, match='OUTPUT_TRUNCATED'):
        ADAPTERS[provider].parse(raw, False)


@pytest.mark.parametrize('provider', PROVIDERS)
def test_missing_usage_stays_empty(provider):
    result = ADAPTERS[provider].parse(wire(provider, 'OK', usage=False), False)
    assert result.usage == {}


def test_model_echo_of_key_is_redacted(client, monkeypatch):
    result = teaching()
    result['answer']['summary'] = '意外回显 ' + FAKE_KEY
    install(monkeypatch, lambda request: httpx.Response(200, json=wire('deepseek', json.dumps(result))))
    configure(client)
    response = client.post('/api/chat', json={'question':'NA'})
    assert response.status_code == 200 and FAKE_KEY not in response.text
    assert '已隐藏密钥' in response.json()['answer']['summary']


def test_search_and_answer_share_retry_budget(client, monkeypatch):
    calls = []
    def handler(request):
        calls.append(request)
        if len(calls) != 2:
            return httpx.Response(503)
        return httpx.Response(200, json=wire('deepseek', '未检索到来源', search=True))
    install(monkeypatch, handler)
    configure(client, mode='search')
    response = client.post('/api/chat', json={'question':'NA'})
    assert response.json()['error']['code'] == 'PROVIDER_UNAVAILABLE'
    assert len(calls) == 3


def test_total_deadline_cancels_transport():
    async def scenario():
        async def handler(request):
            await asyncio.sleep(1)
            return httpx.Response(200, json=wire('deepseek', 'OK'))
        config = ModelConfig(mode='ai', provider='deepseek', model='deepseek-flash', api_key=FAKE_KEY)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as connection:
            started = time.monotonic()
            with pytest.raises(AIError, match='UPSTREAM_TIMEOUT'):
                await ADAPTERS['deepseek'].complete(connection, config, [], CallBudget(started + .03))
            assert time.monotonic() - started < .5
    asyncio.run(scenario())


def test_new_topic_replaces_old_topic(client, monkeypatch):
    seen = []
    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json=wire('deepseek', json.dumps(teaching(knowledge_ids=['K21']))))
    install(monkeypatch, handler)
    configure(client)
    response = client.post('/api/chat', json={'question':'矩阵乘法怎么做', 'knowledge_id':'K06',
        'history':[{'role':'user','content':'缺失值怎么处理'}]})
    assert response.status_code == 200
    assert response.json()['related_knowledge'] == ['K21']
    current = json.loads(seen[0]['messages'][-1]['content'])
    assert current['course_material'][0]['id'] == 'K21'


def test_publish_tool_verifies_then_writes(monkeypatch, tmp_path):
    from io import BytesIO
    from scripts import publish_info
    root = tmp_path / 'ai_tutor'
    root.mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(publish_info, 'ROOT', root)
    monkeypatch.setattr(publish_info, 'DELIVERABLES_ROOT', tmp_path)
    def fake_urlopen(url, timeout):
        if url.endswith('/api/health'):
            result = BytesIO(json.dumps({'version':'1.2.1', 'counts':{'knowledge':43}}).encode())
        else:
            result = BytesIO(b'<dialog id="model-dialog"></dialog>')
        result.geturl = lambda: url
        return result
    monkeypatch.setattr(publish_info, 'urlopen', fake_urlopen)
    publish_info.publish('https://classroom.example')
    assert 'svg' in (root / 'output/release/qrcode.svg').read_text()
    assert 'https://classroom.example' in (tmp_path / 'release.md').read_text(encoding='utf-8')


def test_publish_tool_rejects_wrong_service(monkeypatch):
    from io import BytesIO
    from scripts import publish_info
    response = BytesIO(b'{"version":"1.1.0"}')
    response.geturl = lambda: 'https://classroom.example/api/health'
    monkeypatch.setattr(publish_info, 'urlopen', lambda *args, **kwargs: response)
    with pytest.raises(ValueError):
        publish_info.publish('https://classroom.example')


def test_connection_probe_accepts_valid_incomplete_response(client, monkeypatch):
    raw = wire('openai', '')
    raw['status'] = 'incomplete'
    install(monkeypatch, lambda request: httpx.Response(200, json=raw))
    configure(client, 'openai')
    result = client.post('/api/ai/test')
    assert result.status_code == 200 and result.json()['search_tested'] is False
