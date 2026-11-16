import asyncio
import os
import secrets
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from fastapi import Request, Response

from ..config import DEVELOPMENT_ORIGINS, is_production
from .schemas import AIError, ModelConfig

COOKIE = 'r_tutor_session'


@dataclass
class Session:
    touched: float
    config: ModelConfig = field(default_factory=ModelConfig, repr=False)
    requests: deque = field(default_factory=deque)
    task: asyncio.Task | None = field(default=None, repr=False)
    busy: bool = False
    last_test: dict | None = None


class SessionStore:
    """Single-worker, event-loop-owned memory. Keys never enter a file or cookie."""

    def __init__(self, ttl=1800, max_sessions=1000, max_concurrent=3, rate=5):
        self.ttl = ttl
        self.max_sessions = max_sessions
        self.max_concurrent = max_concurrent
        self.rate = rate
        self.sessions: dict[str, Session] = {}
        self.ip_requests: dict[str, deque] = {}
        self.active = 0

    def prune(self):
        now = time.monotonic()
        for token, session in list(self.sessions.items()):
            if now - session.touched >= self.ttl:
                self.clear(session)
                del self.sessions[token]
        for ip, events in list(self.ip_requests.items()):
            if not events or now - events[-1] >= 60:
                del self.ip_requests[ip]

    def resolve(self, request: Request, response: Response, recover=False):
        self.prune()
        token = request.cookies.get(COOKIE)
        expired = bool(token and token not in self.sessions)
        if expired and not recover:
            raise AIError('SESSION_EXPIRED', '模型配置已到期或服务已重启，请打开模型设置重新配置。', 409)
        if token not in self.sessions:
            if len(self.sessions) >= self.max_sessions:
                raise AIError('SERVICE_BUSY', '当前会话较多，请稍后重试。', 503, True)
            token = secrets.token_urlsafe(32)
            self.sessions[token] = Session(time.monotonic())
            response.set_cookie(COOKIE, token, httponly=True, samesite='strict',
                                secure=is_production() or request.url.scheme == 'https')
        session = self.sessions[token]
        session.touched = time.monotonic()
        return session, expired

    def clear(self, session):
        if session.task and not session.task.done():
            session.task.cancel()
        session.config = ModelConfig()
        session.last_test = None

    @asynccontextmanager
    async def admit(self, session, ip):
        now = time.monotonic()
        events = self.ip_requests.setdefault(ip, deque())
        for queue in (session.requests, events):
            while queue and now - queue[0] >= 60:
                queue.popleft()
        if session.busy:
            raise AIError('SESSION_BUSY', '当前会话已有请求，请等待完成。', 429, True)
        if self.active >= self.max_concurrent:
            raise AIError('SERVICE_BUSY', '服务正在处理其他请求，请稍后重试。', 429, True)
        if len(session.requests) >= self.rate or len(events) >= self.rate:
            raise AIError('RATE_LIMITED', '每个会话及IP每分钟最多5次模型请求，请稍后重试。', 429, True)
        session.requests.append(now)
        events.append(now)
        session.busy = True
        self.active += 1
        try:
            yield
        finally:
            session.busy = False
            session.task = None
            session.touched = time.monotonic()
            self.active -= 1


def check_origin(request: Request):
    """Browser writes must originate from this app or an explicit dev origin."""
    origin = request.headers.get('origin')
    public_url = os.getenv('PUBLIC_URL') or os.getenv('RENDER_EXTERNAL_URL', '')
    allowed = {str(request.base_url).rstrip('/')}
    if public_url:
        parsed = urlsplit(public_url)
        allowed.add(f'{parsed.scheme}://{parsed.netloc}')
    if not is_production():
        allowed.update(DEVELOPMENT_ORIGINS)
    if request.headers.get('sec-fetch-site') == 'cross-site' or (origin and origin not in allowed):
        raise AIError('ORIGIN_FORBIDDEN', '请从本应用页面配置和调用模型。', 403)


def check_secure(request: Request):
    local = request.url.hostname in {'127.0.0.1', 'localhost', '::1', 'testserver'}
    if request.url.scheme != 'https' and (is_production() or not local):
        raise AIError('HTTPS_REQUIRED', '请通过HTTPS访问后配置模型。', 400)


def public_config(session, expired=False):
    config = session.config
    key = config.api_key.get_secret_value() if config.api_key else ''
    return {
        'mode': config.mode, 'provider': config.provider, 'model': config.model,
        'workspace_id': config.workspace_id, 'region': config.region,
        'max_output_tokens': config.max_output_tokens,
        'configured': bool(key), 'key_suffix': key[-4:] if len(key) > 4 else '',
        'expires_in_seconds': 1800, 'expired': expired, 'last_test': session.last_test,
    }
