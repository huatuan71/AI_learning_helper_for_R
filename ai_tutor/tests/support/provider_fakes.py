"""Provider payloads and transport doubles shared by Python and browser tests."""
import asyncio
import json

import httpx

from app.main import app
from app.ai.providers import PROVIDERS

FAKE_KEY = 'test-key-not-real-1234'


def teaching(**updates):
    body = {'answer': {'summary': '使用is.na判断缺失。', 'steps': ['先检查缺失值。'],
            'issues': [], 'corrected_code': '', 'example_code': 'is.na(c(1, NA))',
            'expected_output': '', 'follow_ups': ['如何计算均值？'], 'is_supplementary': False},
            'knowledge_ids': ['K06']}
    body.update(updates)
    return body


def wire(provider, text, sources=None, search=False, failed=False, usage=True):
    sources = sources or []
    if provider == 'openai':
        output = [{'type': 'message', 'content': [{'type': 'output_text', 'text': text}]}]
        if search:
            output.insert(0, {'type': 'web_search_call', 'status': 'failed' if failed else 'completed',
                              'action': {'type': 'search', 'sources': sources}})
        return {'status': 'completed', 'output': output,
                'usage': {'input_tokens': 10, 'output_tokens': 5, 'total_tokens': 15} if usage else {}}
    choice = {'message': {'content': text}, 'finish_reason': 'stop'}
    if provider == 'deepseek':
        if search:
            choice['message']['server_tool_calls'] = [{'calls': [
                {'type': 'deepseek_web_search', 'status': 'failed' if failed else 'completed', 'sources': sources}]}]
        return {'choices': [choice], 'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15} if usage else {}}
    output = {'choices': [choice]}
    if search:
        output['search_info'] = {'search_results': sources}
    return {'output': output, 'usage': {'input_tokens': 10, 'output_tokens': 5, 'total_tokens': 15} if usage else {}}


def configure(client, provider='deepseek', mode='ai', **kwargs):
    return client.put('/api/ai/config', json={'mode': mode, 'provider': provider,
        'model': PROVIDERS[provider]['default_model'], 'api_key': FAKE_KEY, **kwargs})


def install(monkeypatch, handler):
    monkeypatch.setitem(app.state._state, 'ai_transport', httpx.MockTransport(handler))


class ModelStream(httpx.AsyncByteStream):
    def __init__(self, provider, text, delay=0, size=128, finish=True):
        self.provider = provider
        self.text = text
        self.delay = delay
        self.size = size
        self.finish = finish
        self.closed = False

    async def __aiter__(self):
        for offset in range(0, len(self.text), self.size):
            chunk = self.text[offset:offset + self.size]
            if self.provider == 'openai':
                event = {'type':'response.output_text.delta', 'delta':chunk}
            elif self.provider == 'qwen':
                event = {'output':{'choices':[{'message':{'content':chunk}, 'finish_reason':'null'}]}}
            else:
                event = {'choices':[{'delta':{'content':chunk}, 'finish_reason':None}]}
            if self.delay:
                await asyncio.sleep(self.delay)
            encoded = ('data: ' + json.dumps(event, ensure_ascii=False) + '\n\n').encode()
            for position in range(0, len(encoded), 11):
                yield encoded[position:position + 11]
        if not self.finish:
            return
        if self.provider == 'openai':
            event = {'type':'response.completed', 'response':wire('openai', self.text)}
        elif self.provider == 'qwen':
            event = wire('qwen', '')
        else:
            event = {'choices':[{'delta':{}, 'finish_reason':'stop'}],
                     'usage':{'prompt_tokens':10,'completion_tokens':5,'total_tokens':15}}
        yield ('data: ' + json.dumps(event, ensure_ascii=False) + '\n\n').encode()
        if self.provider == 'deepseek':
            yield b'data: [DONE]\n\n'

    async def aclose(self):
        self.closed = True


def streamed_wire(provider, text, **kwargs):
    return httpx.Response(200, headers={'Content-Type':'text/event-stream'},
                          stream=ModelStream(provider, text, **kwargs))


def events(response):
    items = []
    for frame in response.text.split('\n\n'):
        lines = frame.splitlines()
        event = next((line[6:].strip() for line in lines if line.startswith('event:')), None)
        data = '\n'.join(line[5:].lstrip() for line in lines if line.startswith('data:'))
        if event and data:
            items.append((event, json.loads(data)))
    return items


