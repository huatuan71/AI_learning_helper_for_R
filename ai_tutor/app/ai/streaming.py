import asyncio
import json
import logging

import anyio
from fastapi.responses import StreamingResponse

from ..engine import answer
from .schemas import AIError
from .service import TutorService


def frame(event, data):
    return 'event: ' + event + '\ndata: ' + json.dumps(data, ensure_ascii=False) + '\n\n'


def response_stream(body, request, response, store, session, validator, review=False):
    request_id = request.state.request_id
    config = session.config

    def error_payload(error):
        return {'request_id': request_id, 'error': {'code': error.code,
                'message': error.message, 'retryable': error.retryable}}

    async def events():
        if config.mode == 'mock':
            result = validator({'request_id': request_id, **answer(body, review)}).model_dump()
            yield frame('done', result)
            return
        queue = asyncio.Queue()

        async def emit(event, data):
            queue.put_nowait((event, data))

        async def produce():
            try:
                service = TutorService(getattr(request.app.state, 'ai_transport', None))
                result = await service.reply(body, config, review, emit=emit, request_id=request_id)
                result = validator({'request_id': request_id, **result}).model_dump()
                await emit('done', result)
            except AIError as error:
                await emit('error', error_payload(error))
            except asyncio.CancelledError:
                error = AIError('CONFIG_CHANGED', '模型配置已更改，本次请求已停止，请重新发送。', 409)
                await emit('error', error_payload(error))
            except Exception as error:
                logging.getLogger('r_tutor').error('request_id=%s error_type=%s', request_id, type(error).__name__)
                await emit('error', error_payload(AIError('INTERNAL_ERROR', '生成过程出现错误，请重新发送。', 500)))

        try:
            async with store.admit(session, request.client.host):
                if session.config is not config:
                    raise AIError('CONFIG_CHANGED', '模型配置已更改，请重新发送。', 409)
                task = asyncio.create_task(produce())
                session.task = task

                async def disconnect():
                    while not await request.is_disconnected():
                        await asyncio.sleep(.25)
                    task.cancel()

                watcher = asyncio.create_task(disconnect())
                try:
                    yield frame('status', {'stage': 'preparing', 'request_id': request_id})
                    while True:
                        try:
                            event, data = await asyncio.wait_for(queue.get(), timeout=10)
                        except TimeoutError:
                            yield ': keep-alive\n\n'
                            continue
                        if session.config is not config:
                            raise AIError('CONFIG_CHANGED', '模型配置已更改，请重新发送。', 409)
                        yield frame(event, data)
                        if event in {'done', 'error'}:
                            break
                finally:
                    task.cancel()
                    watcher.cancel()
                    with anyio.CancelScope(shield=True):
                        await asyncio.gather(task, watcher, return_exceptions=True)
        except AIError as error:
            yield frame('error', error_payload(error))

    result = StreamingResponse(events(), media_type='text/event-stream',
        headers={'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no'})
    result.raw_headers.extend((key, value) for key, value in response.raw_headers if key.lower() == b'set-cookie')
    return result
