from fastapi import APIRouter, Request, Response
from starlette.exceptions import HTTPException

from ..ai.schemas import AIError
from ..ai.service import TutorService, run_for_session
from ..ai.sessions import check_origin, check_secure
from ..ai.streaming import response_stream
from ..engine import KNOWLEDGE, answer
from ..schemas import ChatRequest, ChatResponse


router = APIRouter()


def prepare_request(body, request, response, review=False):
    if body.knowledge_id and body.knowledge_id not in KNOWLEDGE:
        raise HTTPException(404, '知识点不存在，请从课程目录选择')
    if review and not (body.code.strip() or body.question.strip()):
        raise AIError('VALIDATION_ERROR', '代码审查需要代码或问题描述', 422)
    check_origin(request)
    store = request.app.state.sessions
    session, _ = store.resolve(request, response)
    if session.config.mode != 'mock':
        check_secure(request)
    return store, session


async def respond(body, request, response, review=False):
    store, session = prepare_request(body, request, response, review)
    if session.config.mode == 'mock':
        result = answer(body, review)
    else:
        async with store.admit(session, request.client.host):
            service = TutorService(getattr(request.app.state, 'ai_transport', None))
            result = await run_for_session(request, session, service.reply(
                body, session.config, review, request_id=request.state.request_id))
    return {'request_id':request.state.request_id, **result}


@router.post('/api/chat', response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request, response: Response):
    return await respond(body, request, response)


@router.post('/api/review', response_model=ChatResponse)
async def review(body: ChatRequest, request: Request, response: Response):
    return await respond(body, request, response, True)


@router.post('/api/chat/stream')
async def chat_stream(body: ChatRequest, request: Request, response: Response):
    store, session = prepare_request(body, request, response)
    return response_stream(body, request, response, store, session, ChatResponse.model_validate)


@router.post('/api/review/stream')
async def review_stream(body: ChatRequest, request: Request, response: Response):
    store, session = prepare_request(body, request, response, True)
    return response_stream(body, request, response, store, session, ChatResponse.model_validate, True)
