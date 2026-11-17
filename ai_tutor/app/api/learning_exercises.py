"""Manual, cancellable AI exercise endpoint."""
from fastapi import APIRouter, Request, Response

from ..ai.exercise_generation import ExerciseGenerationService, validate_course_ids
from ..ai.exercise_schemas import ExerciseRequest, ExerciseResponse, MAX_REQUEST_BYTES
from ..ai.schemas import AIError
from ..ai.service import run_for_session
from ..ai.sessions import COOKIE, check_origin, check_secure
from ..schemas import ErrorResponse

router = APIRouter(tags=['AI练习'])


@router.post('/api/learning/exercises', response_model=ExerciseResponse, responses={
    status: {'model': ErrorResponse} for status in [400, 403, 409, 413, 429, 499, 502, 503, 504]
})
async def learning_exercises(body: ExerciseRequest, request: Request, response: Response):
    if len(await request.body()) > MAX_REQUEST_BYTES:
        raise AIError('REQUEST_TOO_LARGE', '出题请求超过32 KiB上限，请缩短近期题干。', 413)
    check_origin(request)
    check_secure(request)
    validate_course_ids(body)
    if not request.cookies.get(COOKIE):
        raise AIError('CONFIG_REQUIRED', '请先配置模型，再使用AI出题。', 409)
    store = request.app.state.sessions
    session, _ = store.resolve(request, response)
    if session.config.mode == 'mock':
        raise AIError('CONFIG_REQUIRED', '请先配置模型，再使用AI出题。', 409)
    service = ExerciseGenerationService(getattr(request.app.state, 'ai_transport', None))
    async with store.admit(session, request.client.host):
        result = await run_for_session(request, session, service.generate(
            body, session.config, request_id=request.state.request_id))
    response.headers['Cache-Control'] = 'no-store'
    return {'request_id': request.state.request_id, **result}
