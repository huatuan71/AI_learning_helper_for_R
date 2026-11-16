import asyncio
import json

import httpx
import pytest

from app.main import app
from app.ai.providers import PROVIDERS
from support.provider_fakes import (
    FAKE_KEY, ModelStream, configure, events, install, streamed_wire, teaching, wire,
)

pytestmark = pytest.mark.usefixtures('clean_state')


@pytest.mark.parametrize('provider', PROVIDERS)
def test_real_stream_request_and_validated_completion(client, monkeypatch, provider):
    seen = []
    def handler(request):
        payload = json.loads(request.content)
        seen.append(payload)
        if provider == 'qwen':
            assert request.headers['X-DashScope-SSE'] == 'enable'
            assert payload['parameters']['incremental_output'] is True
        else:
            assert payload['stream'] is True
        return streamed_wire(provider, json.dumps(teaching(), ensure_ascii=False), delay=.01, size=30)
    install(monkeypatch, handler)
    configure(client, provider)
    response = client.post('/api/chat/stream', json={'question':'NA'})
    assert response.status_code == 200
    assert response.headers['content-type'].startswith('text/event-stream')
    result = events(response)
    assert any(kind == 'delta' and data['field'] == 'summary' for kind, data in result)
    assert result[-1][0] == 'done'
    assert result[-1][1]['answer']['summary'] == teaching()['answer']['summary']
    assert result[-1][1]['usage']['input_tokens'] == 10
    assert len(seen) == 1 and app.state.sessions.active == 0


def test_stream_mock_and_validation(client):
    response = client.post('/api/chat/stream', json={'question':'NA'})
    assert events(response)[-1][1]['mode'] == 'mock'
    assert 'HttpOnly' in response.headers['set-cookie']
    assert client.post('/api/review/stream', json={'knowledge_id':'K06'}).status_code == 422
    assert client.post('/api/chat/stream', json={'question':'NA','knowledge_id':'K99'}).status_code == 404


@pytest.mark.parametrize('provider', PROVIDERS)
def test_streamed_search_uses_real_sources(client, monkeypatch, provider):
    def handler(request):
        payload = json.loads(request.content)
        search = bool(payload.get('tools') or payload.get('parameters', {}).get('enable_search'))
        if search:
            return httpx.Response(200, json=wire(provider, '官方资料',
                sources=[{'url':'https://r-project.org/','title':'R'}], search=True))
        result = teaching()
        result['answer']['summary'] += '[W1]'
        return streamed_wire(provider, json.dumps(result, ensure_ascii=False))
    install(monkeypatch, handler)
    configure(client, provider, 'search')
    result = events(client.post('/api/chat/stream', json={'question':'NA'}))
    assert any(kind == 'status' and data['stage'] == 'searching' for kind, data in result)
    assert result[-1][0] == 'done' and result[-1][1]['used_web_search'] is True


def test_stream_key_split_across_chunks(client, monkeypatch):
    result = teaching()
    result['answer']['summary'] = '密钥意外回显 ' + FAKE_KEY + ' 已结束'
    install(monkeypatch, lambda request: streamed_wire('deepseek', json.dumps(result), size=1))
    configure(client)
    response = client.post('/api/chat/stream', json={'question':'NA'})
    assert FAKE_KEY not in response.text
    summary = ''.join(data['text'] for kind, data in events(response) if kind == 'delta' and data['field'] == 'summary')
    assert FAKE_KEY not in summary and '已隐藏密钥' in summary
    assert events(response)[-1][0] == 'done'


def test_interrupted_stream_has_no_success_or_automatic_retry(client, monkeypatch):
    seen = []
    def handler(request):
        seen.append(request)
        return streamed_wire('deepseek', json.dumps(teaching()), finish=False)
    install(monkeypatch, handler)
    configure(client)
    result = events(client.post('/api/chat/stream', json={'question':'NA'}))
    assert result[-1][0] == 'error'
    assert result[-1][1]['error']['code'] == 'STREAM_INTERRUPTED'
    assert not any(kind == 'done' for kind, _ in result)
    assert len(seen) == 1 and app.state.sessions.active == 0


def test_stream_repair_resets_preview(client, monkeypatch):
    calls = []
    def handler(request):
        calls.append(request)
        result = teaching(knowledge_ids=['K99']) if len(calls) == 1 else teaching()
        return streamed_wire('deepseek', json.dumps(result))
    install(monkeypatch, handler)
    configure(client)
    result = events(client.post('/api/chat/stream', json={'question':'NA'}))
    assert sum(kind == 'reset' for kind, _ in result) == 2
    assert result[-1][0] == 'done' and len(calls) == 2


def test_clear_configuration_cancels_stream(monkeypatch):
    async def scenario():
        started = asyncio.Event()
        async def handler(request):
            started.set()
            await asyncio.sleep(10)
            return streamed_wire('deepseek', json.dumps(teaching()))
        install(monkeypatch, handler)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://testserver') as connection:
            await connection.put('/api/ai/config', json={'mode':'ai','provider':'deepseek','model':'deepseek-flash','api_key':FAKE_KEY})
            pending = asyncio.create_task(connection.post('/api/chat/stream', json={'question':'NA'}))
            await asyncio.wait_for(started.wait(), 2)
            await connection.delete('/api/ai/config')
            response = await asyncio.wait_for(pending, 2)
            assert events(response)[-1][1]['error']['code'] == 'CONFIG_CHANGED'
            assert app.state.sessions.active == 0
    asyncio.run(scenario())


def test_stream_authentication_error_is_redacted(client, monkeypatch):
    install(monkeypatch, lambda request: httpx.Response(401, json={'error':{'message':FAKE_KEY}}))
    configure(client)
    response = client.post('/api/chat/stream', json={'question':'NA'})
    assert events(response)[-1][1]['error']['code'] == 'PROVIDER_AUTH_FAILED'
    assert FAKE_KEY not in response.text and app.state.sessions.active == 0


def test_stream_rate_limit_is_an_error_event(client, monkeypatch):
    install(monkeypatch, lambda request: streamed_wire('deepseek', json.dumps(teaching())))
    configure(client)
    for _ in range(5):
        assert events(client.post('/api/chat/stream', json={'question':'NA'}))[-1][0] == 'done'
    result = events(client.post('/api/chat/stream', json={'question':'NA'}))
    assert result[-1][0] == 'error' and result[-1][1]['error']['code'] == 'RATE_LIMITED'
    assert app.state.sessions.active == 0


def test_stream_exercise_hint_excludes_solution_code(client, monkeypatch):
    install(monkeypatch, lambda request: streamed_wire('deepseek', json.dumps(teaching())))
    configure(client)
    result = events(client.post('/api/chat/stream', json={'question':'NA练习','task_type':'exercise','teaching_mode':'hint'}))
    assert not any(kind == 'delta' and data['field'] in {'corrected_code','example_code','expected_output'} for kind, data in result)
    assert result[-1][0] == 'done' and result[-1][1]['answer']['example_code'] == ''
