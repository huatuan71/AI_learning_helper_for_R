"""Small HTTP adapters. Endpoint hosts are fixed, including workspace hosts."""

import asyncio
import json
import time
from dataclasses import dataclass, field
from urllib.parse import urlsplit

import httpx

from .schemas import AIError

PROVIDERS = {
    'deepseek': {
        'name': 'DeepSeek', 'default_model': 'deepseek-flash',
        'search_models': ['deepseek-flash'],
        'documentation': 'https://api-docs.deepseek.com/guides/web_tools/',
        'key_url': 'https://platform.deepseek.com/api_keys',
    },
    'qwen': {
        'name': '通义千问 / 百炼', 'default_model': 'qwen-plus',
        'search_models': ['qwen-plus', 'qwen-flash'],
        'documentation': 'https://help.aliyun.com/zh/model-studio/web-search',
        'key_url': 'https://bailian.console.aliyun.com/',
    },
    'openai': {
        'name': 'OpenAI', 'default_model': 'gpt-6-astra',
        'search_models': ['gpt-6-astra'],
        'documentation': 'https://developers.openai.com/api/docs/guides/tools-web-search?api-mode=responses',
        'key_url': 'https://platform.openai.com/api-keys',
    },
}


def catalog():
    return {'providers': [
        {'id': key, **value, 'verified_on': '2026-11-15',
         'supports_chat': True, 'supports_search': True, 'streaming': True,
         'account_tested': False}
        for key, value in PROVIDERS.items()
    ]}


def validate_config(config):
    if config.mode == 'mock':
        return
    if not config.provider or not config.model or not config.api_key:
        raise AIError('CONFIG_REQUIRED', '请选择厂商、填写模型ID和API Key。', 422)
    if config.mode == 'search' and config.model not in PROVIDERS[config.provider]['search_models']:
        raise AIError('SEARCH_UNSUPPORTED', '该模型尚未核实搜索能力，请选择列表中的搜索模型或使用真实AI模式。', 422)


def safe_source(source):
    if not isinstance(source, dict):
        return None
    url = source.get('url', '')
    if not isinstance(url, str) or len(url) > 3000 or any(ord(c) < 32 for c in url):
        return None
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {'https', 'http'} or not parsed.hostname or parsed.username or parsed.password:
            return None
        parsed.port
    except ValueError:
        return None
    title = source.get('title') or parsed.hostname
    return {'url': url, 'title': str(title)[:300], 'snippet': str(source.get('snippet', ''))[:1500]}


def normalize_usage(raw):
    raw = raw or {}
    values = {
        'input_tokens': raw.get('input_tokens', raw.get('prompt_tokens')),
        'output_tokens': raw.get('output_tokens', raw.get('completion_tokens')),
        'total_tokens': raw.get('total_tokens'),
    }
    return {key: value for key, value in values.items() if type(value) is int and value >= 0}


@dataclass
class Completion:
    text: str
    usage: dict = field(default_factory=dict)
    sources: list[dict] = field(default_factory=list)
    search_status: str = 'not_requested'


@dataclass
class StreamState:
    text: str = ''
    usage: dict = field(default_factory=dict)
    finished: bool = False
    completion: Completion | None = None


def redact_stream_text(text, key, final=False):
    if not final:
        for size in range(min(len(key) - 1, len(text)), 0, -1):
            if text.endswith(key[:size]):
                text = text[:-size]
                break
    return text.replace(key, '[已隐藏密钥]')


@dataclass
class CallBudget:
    deadline: float
    retries_left: int = 1

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise AIError('UPSTREAM_TIMEOUT', '模型响应超时，请重试或切换模型。', 504, True)
        return remaining


def upstream_error(response):
    try:
        raw = response.json()
        detail = raw.get('error', raw)
        code = str(detail.get('code', '')).lower() if isinstance(detail, dict) else ''
    except (ValueError, AttributeError):
        code = ''
    if response.status_code == 402 or any(word in code for word in ['quota', 'balance', 'arrearage', 'insufficient']):
        return AIError('QUOTA_EXCEEDED', '账号额度不足，请检查厂商控制台。', 402)
    if response.status_code in {401, 403}:
        return AIError('PROVIDER_AUTH_FAILED', 'Key无效或账号没有访问权限，请检查模型设置。', 400)
    if response.status_code == 404:
        return AIError('MODEL_NOT_FOUND', '模型或接口不存在，请检查模型ID及业务空间。', 400)
    if response.status_code == 429:
        return AIError('PROVIDER_RATE_LIMITED', '厂商请求频率受限，请稍后重试。', 429, True)
    if response.status_code >= 500:
        return AIError('PROVIDER_UNAVAILABLE', '模型服务暂不可用，请稍后重试。', 503, True)
    if 'inspection' in code or 'safety' in code:
        return AIError('CONTENT_REFUSED', '模型未接受本次内容，请调整问题后重试。', 422)
    return AIError('PROVIDER_BAD_REQUEST', '厂商未接受请求，请检查模型、地域和搜索能力。', 400)


class Provider:
    def request(self, config, messages, search, structured, max_tokens):
        raise NotImplementedError

    def parse(self, raw, search):
        raise NotImplementedError

    def enable_stream(self, payload, headers):
        payload['stream'] = True

    def read_delta(self, raw, state):
        raise NotImplementedError

    async def stream_completion(self, client, url, payload, headers, config, budget, on_text):
        self.enable_stream(payload, headers)
        state = StreamState()
        last_emit = 0
        data_lines = []
        await on_text('')
        async with client.stream('POST', url, json=payload, headers=headers,
            timeout=httpx.Timeout(min(40, budget.remaining()), connect=min(10, budget.remaining()))) as response:
            if not response.is_success:
                await response.aread()
                raise upstream_error(response)
            if 'text/event-stream' not in response.headers.get('content-type', ''):
                raise AIError('UPSTREAM_FORMAT_ERROR', '模型流式接口返回了无法识别的数据。')
            async for line in response.aiter_lines():
                if line.startswith('data:'):
                    data_lines.append(line[5:].lstrip(' '))
                    continue
                if line or not data_lines:
                    continue
                data = '\n'.join(data_lines)
                data_lines = []
                if data == '[DONE]':
                    state.finished = True
                    break
                try:
                    raw = json.loads(data)
                    self.read_delta(raw, state)
                except (ValueError, TypeError, KeyError, AttributeError, IndexError):
                    raise AIError('UPSTREAM_FORMAT_ERROR', '模型流式数据结构无法解析。') from None
                now = time.monotonic()
                if state.text and (now - last_emit >= .05 or state.finished):
                    await on_text(redact_stream_text(state.text, config.api_key.get_secret_value()))
                    last_emit = now
        if not state.finished:
            raise AIError('STREAM_INTERRUPTED', '模型连接提前中断，请重新发送。', 502, True)
        result = state.completion or Completion(valid_text(state.text), state.usage)
        result.text = redact_stream_text(result.text, config.api_key.get_secret_value(), final=True)
        await on_text(result.text)
        return result

    async def complete(self, client, config, messages, budget, search=False, structured=False, max_tokens=None, connection_test=False, on_text=None):
        url, payload = self.request(config, messages, search, structured,
                                    max_tokens or config.max_output_tokens)
        headers = {'Authorization': 'Bearer ' + config.api_key.get_secret_value()}
        stream_started = False

        async def progress(text):
            nonlocal stream_started
            stream_started = stream_started or bool(text)
            await on_text(text)

        while True:
            try:
                remaining = budget.remaining()
                async with asyncio.timeout(remaining):
                    if on_text is not None:
                        return await self.stream_completion(client, url, payload, headers, config, budget, progress)
                    response = await client.post(url, json=payload, headers=headers,
                        timeout=httpx.Timeout(min(40, remaining), connect=min(10, remaining)))
                if not response.is_success:
                    raise upstream_error(response)
                try:
                    raw = response.json()
                    result = self.parse(raw, search)
                except AIError as exc:
                    # A tiny connection probe can exhaust a reasoning model's output budget.
                    if connection_test and exc.code in {'OUTPUT_TRUNCATED', 'EMPTY_RESPONSE'}:
                        result = Completion('', normalize_usage(raw.get('usage')))
                    else:
                        raise
                except (ValueError, TypeError, KeyError, IndexError, AttributeError):
                    raise AIError('UPSTREAM_FORMAT_ERROR', '模型服务返回了无法识别的数据，请重试。') from None
                key = config.api_key.get_secret_value()
                result.text = result.text.replace(key, '[已隐藏密钥]')
                result.sources = [source for source in result.sources if key not in str(source)]
                return result
            except (httpx.TimeoutException, TimeoutError):
                error = AIError('UPSTREAM_TIMEOUT', '模型响应超时，请重试或切换模型。', 504, True)
            except httpx.HTTPError:
                error = AIError('NETWORK_ERROR', '无法连接模型服务，请检查网络或稍后重试。', 503, True)
            except AIError as exc:
                error = exc
            if stream_started or not error.retryable or budget.retries_left <= 0 or budget.remaining() < 1:
                raise error
            budget.retries_left -= 1
            await asyncio.sleep(min(0.25, budget.remaining()))


def collect_sources(sources):
    unique = {}
    for source in sources:
        safe = safe_source(source)
        if safe:
            unique.setdefault(safe['url'], safe)
    return list(unique.values())[:12]


class DeepSeekProvider(Provider):
    def enable_stream(self, payload, headers):
        super().enable_stream(payload, headers)
        payload['stream_options'] = {'include_usage': True}

    def read_delta(self, raw, state):
        state.usage.update(normalize_usage(raw.get('usage')))
        for choice in raw.get('choices', []):
            check_stop(choice.get('finish_reason'))
            state.text += choice.get('delta', {}).get('content') or ''
            state.finished = state.finished or choice.get('finish_reason') == 'stop'

    def request(self, config, messages, search, structured, max_tokens):
        body = {'model': config.model, 'messages': messages, 'max_tokens': max_tokens,
                'stream': False, 'thinking': {'type': 'disabled'}}
        if search:
            body['tools'] = [{'type': 'deepseek_web_search'}]
        elif structured:
            body['response_format'] = {'type': 'json_object'}
        return 'https://api.deepseek.com/chat/completions', body

    def parse(self, raw, search):
        choice = raw['choices'][0]
        check_stop(choice.get('finish_reason'))
        message = choice['message']
        sources = []
        calls = [call for step in message.get('server_tool_calls', []) for call in step.get('calls', [])
                 if call.get('type') == 'deepseek_web_search']
        for call in calls:
            sources.extend(call.get('sources', []))
        if calls:
            for annotation in message.get('annotations', []):
                if annotation.get('type') == 'url_citation':
                    sources.append(annotation.get('url_citation', {}))
        sources = collect_sources(sources)
        state = search_state(search, bool(calls), sources,
                             bool(calls) and all(call.get('status') == 'failed' for call in calls))
        return Completion(valid_text(message.get('content')), normalize_usage(raw.get('usage')), sources, state)


class QwenProvider(Provider):
    def enable_stream(self, payload, headers):
        headers['X-DashScope-SSE'] = 'enable'
        payload['parameters']['incremental_output'] = True

    def read_delta(self, raw, state):
        state.usage.update(normalize_usage(raw.get('usage')))
        for choice in raw.get('output', {}).get('choices', []):
            check_stop(choice.get('finish_reason'))
            state.text += choice.get('message', {}).get('content') or ''
            state.finished = state.finished or choice.get('finish_reason') == 'stop'

    def request(self, config, messages, search, structured, max_tokens):
        if config.workspace_id:
            host = f'{config.workspace_id}.{config.region}.maas.aliyuncs.com'
        else:
            host = 'dashscope.aliyuncs.com' if config.region == 'cn-beijing' else 'dashscope-intl.aliyuncs.com'
        parameters = {'result_format': 'message', 'max_tokens': max_tokens, 'enable_search': search}
        if search:
            parameters['search_options'] = {'enable_source': True, 'enable_citation': True,
                                            'citation_format': '[<number>]', 'search_strategy': 'turbo'}
        if structured:
            parameters['response_format'] = {'type': 'json_object'}
        return f'https://{host}/api/v1/services/aigc/text-generation/generation', {
            'model': config.model, 'input': {'messages': messages}, 'parameters': parameters}

    def parse(self, raw, search):
        output = raw['output']
        choice = output['choices'][0]
        check_stop(choice.get('finish_reason'))
        info = output.get('search_info', raw.get('search_info'))
        sources = collect_sources(info.get('search_results', [])) if isinstance(info, dict) else []
        # plugins.search.count represents intent, so it cannot prove search completion.
        state = search_state(search, isinstance(info, dict), sources)
        return Completion(valid_text(choice['message'].get('content')), normalize_usage(raw.get('usage')), sources, state)


class OpenAIProvider(Provider):
    def read_delta(self, raw, state):
        kind = raw.get('type')
        if kind == 'response.output_text.delta':
            state.text += raw['delta']
        elif kind == 'response.completed':
            state.completion = self.parse(raw['response'], False)
            state.text = state.completion.text
            state.finished = True
        elif kind == 'response.incomplete':
            raise AIError('OUTPUT_TRUNCATED', '模型输出达到长度上限，请调整回答长度。')
        elif kind == 'response.refusal.delta':
            raise AIError('CONTENT_REFUSED', '模型未接受本次内容，请调整问题。', 422)
        elif kind in {'response.failed', 'error'}:
            raise AIError('PROVIDER_UNAVAILABLE', '模型流式生成失败，请稍后重试。', 503, True)

    def request(self, config, messages, search, structured, max_tokens):
        body = {'model': config.model, 'input': messages, 'max_output_tokens': max_tokens, 'store': False}
        if search:
            body['tools'] = [{'type': 'web_search'}]
            body['include'] = ['web_search_call.action.sources']
        if structured:
            body['text'] = {'format': {'type': 'json_object'}}
        return 'https://api.openai.com/v1/responses', body

    def parse(self, raw, search):
        if raw.get('status') == 'incomplete':
            raise AIError('OUTPUT_TRUNCATED', '模型输出达到长度上限，请缩短问题或调整回答长度。')
        if raw.get('status') in {'failed', 'cancelled'} or raw.get('error'):
            raise AIError('PROVIDER_UNAVAILABLE', '模型未完成回答，请稍后重试。', 503, True)
        messages = [item for item in raw['output'] if item.get('type') == 'message']
        content = [part for message in messages for part in message.get('content', [])]
        if any(part.get('type') == 'refusal' for part in content):
            raise AIError('CONTENT_REFUSED', '模型未接受本次内容，请调整问题后重试。', 422)
        calls = [item for item in raw['output'] if item.get('type') == 'web_search_call']
        sources = [source for call in calls for source in call.get('action', {}).get('sources', [])]
        if calls:
            sources.extend(annotation for part in content for annotation in part.get('annotations', [])
                           if annotation.get('type') == 'url_citation')
        sources = collect_sources(sources)
        state = search_state(search, bool(calls), sources,
                             bool(calls) and all(call.get('status') == 'failed' for call in calls))
        text = '\n'.join(part.get('text', '') for part in content if part.get('type') == 'output_text')
        return Completion(valid_text(text), normalize_usage(raw.get('usage')), sources, state)


def valid_text(value):
    if not isinstance(value, str) or not value.strip():
        raise AIError('EMPTY_RESPONSE', '模型返回了空回答，请调整问题后重试。')
    return value


def check_stop(reason):
    if reason in {'length', 'max_tokens'}:
        raise AIError('OUTPUT_TRUNCATED', '模型输出达到长度上限，请缩短问题或调整回答长度。')
    if reason in {'content_filter', 'safety'}:
        raise AIError('CONTENT_REFUSED', '模型未接受本次内容，请调整问题后重试。', 422)


def search_state(requested, triggered, sources, failed=False):
    if not requested:
        return 'not_requested'
    if failed:
        return 'failed'
    if sources:
        return 'completed'
    return 'no_results' if triggered else 'not_triggered'


ADAPTERS = {'deepseek': DeepSeekProvider(), 'qwen': QwenProvider(), 'openai': OpenAIProvider()}
