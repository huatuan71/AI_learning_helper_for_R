"""Manual, cancellable learning summary endpoint."""
from fastapi import APIRouter, Request, Response

from ..ai.learning_summary import LearningSummaryService, validate_course_ids
from ..ai.schemas import AIError
from ..ai.service import run_for_session
from ..ai.sessions import COOKIE, check_origin, check_secure
from ..ai.summary_schemas import LearningSummaryRequest, LearningSummaryResponse, MAX_REQUEST_BYTES
from ..schemas import ErrorResponse

router = APIRouter(tags=['学习总结'])


@router.post('/api/learning/summary', response_model=LearningSummaryResponse, responses={
    400: {'model': ErrorResponse}, 403: {'model': ErrorResponse},
    409: {'model': ErrorResponse}, 413: {'model': ErrorResponse},
    429: {'model': ErrorResponse}, 499: {'model': ErrorResponse},
    502: {'model': ErrorResponse}, 503: {'model': ErrorResponse},
    504: {'model': ErrorResponse},
})
async def learning_summary(body: LearningSummaryRequest, request: Request, response: Response):
    if len(await request.body()) > MAX_REQUEST_BYTES:
        raise AIError('REQUEST_TOO_LARGE', '总结输入超过120 KiB上限，请缩短摘录。', 413)
    check_origin(request)
    validate_course_ids(body)
    service = LearningSummaryService(getattr(request.app.state, 'ai_transport', None))
    if not body.coverage.total_evidence_count:
        # No session creation, configuration requirement, or provider call for an empty period.
        result = await service.generate(body, None)
    else:
        check_secure(request)
        if not request.cookies.get(COOKIE):
            raise AIError('CONFIG_REQUIRED', '请先在模型设置中配置厂商、模型和API Key，再生成AI总结。', 409)
        store = request.app.state.sessions
        session, _ = store.resolve(request, response)
        if session.config.mode == 'mock':
            raise AIError('CONFIG_REQUIRED', '请先在模型设置中配置厂商、模型和API Key，再生成AI总结。', 409)
        async with store.admit(session, request.client.host):
            result = await run_for_session(request, session, service.generate(
                body, session.config, request_id=request.state.request_id))
    response.headers['Cache-Control'] = 'no-store'
    return {'request_id': request.state.request_id, **result}
