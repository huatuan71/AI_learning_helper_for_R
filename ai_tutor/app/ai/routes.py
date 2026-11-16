from fastapi import APIRouter, Request, Response

from .providers import catalog, validate_config
from .schemas import AIError, ModelConfig
from .service import TutorService, run_for_session
from .sessions import check_origin, check_secure, public_config

router = APIRouter(prefix='/api/ai', tags=['模型配置'])


@router.get('/providers')
async def providers():
    return catalog()


@router.get('/config')
async def get_config(request: Request, response: Response):
    session, expired = request.app.state.sessions.resolve(request, response, recover=True)
    response.headers['Cache-Control'] = 'no-store'
    return public_config(session, expired)


@router.put('/config')
async def configure(body: ModelConfig, request: Request, response: Response):
    check_origin(request)
    check_secure(request)
    store = request.app.state.sessions
    session, _ = store.resolve(request, response, recover=True)
    if body.mode != 'mock' and body.api_key is None and body.provider == session.config.provider:
        body = body.model_copy(update={'api_key': session.config.api_key})
    validate_config(body)
    store.clear(session)
    session.config = body if body.mode != 'mock' else ModelConfig()
    response.headers['Cache-Control'] = 'no-store'
    return public_config(session)


@router.delete('/config')
async def clear_config(request: Request, response: Response):
    check_origin(request)
    session, _ = request.app.state.sessions.resolve(request, response, recover=True)
    request.app.state.sessions.clear(session)
    response.headers['Cache-Control'] = 'no-store'
    return public_config(session)


@router.post('/test')
async def test_connection(request: Request, response: Response):
    check_origin(request)
    check_secure(request)
    store = request.app.state.sessions
    session, _ = store.resolve(request, response)
    if session.config.mode == 'mock':
        raise AIError('CONFIG_REQUIRED', '请先应用真实AI或搜索配置，再测试连接。', 409)
    async with store.admit(session, request.client.host):
        service = TutorService(getattr(request.app.state, 'ai_transport', None))
        try:
            result = await run_for_session(request, session, service.test(session.config))
        except AIError as exc:
            session.last_test = {'status': 'error', 'code': exc.code, 'message': exc.message}
            raise
        session.last_test = result
        response.headers['Cache-Control'] = 'no-store'
        return result
