"""Request context, logging and shared HTTP exception responses."""
import logging
import time
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders

from .config import APP_VERSION


logger = logging.getLogger('r_tutor')
logger.setLevel(logging.INFO)
logger.propagate = False
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())


def failure(request, status, code, message):
    return JSONResponse(status_code=status, content={'request_id':request.state.request_id,
       'error':{'code':code,'message':message,'retryable':status>=500}})


class RequestContextMiddleware:
    """Pure ASGI keeps disconnect events visible to cancellable upstream calls."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        request = Request(scope, receive)
        request.state.request_id = str(uuid4())
        started = time.monotonic()
        sent = False
        status_code = 500

        async def send_response(message):
            nonlocal sent, status_code
            if message['type'] == 'http.response.start':
                sent = True
                status_code = message['status']
                headers = MutableHeaders(scope=message)
                headers['X-Request-ID'] = request.state.request_id
                headers['X-Content-Type-Options'] = 'nosniff'
                if request.url.path.startswith('/api/ai') or request.url.path in {'/api/learning/summary', '/api/learning/exercises'}:
                    headers['Cache-Control'] = 'no-store'
            await send(message)

        try:
            await self.app(scope, receive, send_response)
        except Exception as exc:
            logger.error('request_id=%s error_type=%s', request.state.request_id, type(exc).__name__)
            if sent:
                raise
            response = failure(request, 500, 'INTERNAL_ERROR', '服务内部错误，请查看本地日志或联系维护者')
            await response(scope, receive, send_response)
        finally:
            logger.info('version=%s request_id=%s status=%s duration_ms=%s', APP_VERSION, request.state.request_id,
                        status_code, round((time.monotonic() - started) * 1000))


async def validation(request, exc):
    if request.url.path.startswith('/api/ai'):
        return failure(request, 422, 'VALIDATION_ERROR', '模型配置不符合要求，请检查模式、模型ID、Key及业务空间字段。')
    details = ['.'.join(str(v) for v in e['loc'])+': '+e['msg'] for e in exc.errors()]
    return failure(request, 422, 'VALIDATION_ERROR', '输入不符合要求；'+'；'.join(details))


async def http_error(request, exc):
    return failure(request, exc.status_code, 'NOT_FOUND' if exc.status_code==404 else 'HTTP_ERROR', str(exc.detail))


async def ai_error(request, exc):
    return JSONResponse(status_code=exc.status, content={'request_id': request.state.request_id,
        'error': {'code': exc.code, 'message': exc.message, 'retryable': exc.retryable}})
