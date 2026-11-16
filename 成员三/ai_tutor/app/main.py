from pathlib import Path
from typing import Literal
from uuid import uuid4
import logging
import os
import re
import time
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ConfigDict, model_validator
from starlette.exceptions import HTTPException
from starlette.datastructures import MutableHeaders
from .engine import DATA, ENRICHMENT, KNOWLEDGE, answer
from .ai.routes import router as ai_router
from .ai.schemas import AIError
from .ai.service import TutorService, run_for_session
from .ai.sessions import SessionStore, check_origin, check_secure
from .ai.streaming import response_stream

ROOT = Path(__file__).resolve().parents[1]
logger = logging.getLogger('r_tutor')
logger.setLevel(logging.INFO)
logger.propagate = False
if not logger.handlers:
    logger.addHandler(logging.StreamHandler())
class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    request_id: str
    error: ErrorDetail


app = FastAPI(title='R语言AI助教', version='1.2.0', description='课程模拟、三厂商AI与网页搜索；代码分析及参考修正。',
              responses={404:{'model':ErrorResponse,'description':'资源或知识点不存在'},
                         422:{'model':ErrorResponse,'description':'参数校验失败'},
                         500:{'model':ErrorResponse,'description':'内部错误；测试中通过故障注入验证'}})
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173','http://127.0.0.1:5173'] if os.getenv('APP_ENV') != 'production' else [],
                   allow_credentials=True, allow_methods=['GET','POST','PUT','DELETE'], allow_headers=['Content-Type'])
app.state.sessions = SessionStore()
app.include_router(ai_router)


class History(BaseModel):
    model_config = ConfigDict(extra='forbid')
    role: Literal['user','assistant']
    content: str = Field(max_length=12000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    session_id: str = Field(default='', max_length=100)
    question: str = Field(default='', max_length=2000)
    task_type: Literal['auto','concept','function','debug','exercise'] = 'auto'
    code: str = Field(default='', max_length=10000)
    error_message: str = Field(default='', max_length=2000)
    knowledge_id: str | None = None
    teaching_mode: Literal['hint','solution'] = 'hint'
    history: list[History] = Field(default_factory=list, max_length=12)

    @model_validator(mode='after')
    def valid(self):
        if not (self.question.strip() or self.code.strip() or self.knowledge_id):
            raise ValueError('请输入问题、代码或选择知识点')
        if sum(len(h.content) for h in self.history)>24000:
            raise ValueError('历史内容总长度不得超过24000字符')
        return self


class Issue(BaseModel):
    kind: str
    line: int | None
    reason: str


class Answer(BaseModel):
    content_markdown: str = ''
    summary: str
    steps: list[str]
    issues: list[Issue]
    corrected_code: str
    example_code: str
    expected_output: str
    execution_status: Literal['not_executed']
    code_kind: Literal['reference_example', 'ai_suggestion']
    follow_ups: list[str]
    is_supplementary: bool = False


class Citation(BaseModel):
    knowledge_id: str
    source_id: str
    file: str
    locator: str
    raw: str


class ChatResponse(BaseModel):
    request_id: str
    status: Literal['ok','no_match']
    mode: Literal['mock', 'ai', 'search']
    task_type: str
    answer: Answer
    citations: list[Citation]
    related_knowledge: list[str]
    matched_case_id: str | None
    prompt_version: str
    knowledge_version: str
    provider: str | None = None
    model: str | None = None
    used_web_search: bool = False
    search_status: Literal['not_requested', 'not_triggered', 'completed', 'no_results', 'failed'] = 'not_requested'
    web_citations: list[dict[str, str]] = Field(default_factory=list)
    usage: dict[str, int] = Field(default_factory=dict)
    duration_ms: int = 0


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
                if request.url.path.startswith('/api/ai'):
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
            logger.info('version=1.2.0 request_id=%s status=%s duration_ms=%s', request.state.request_id,
                        status_code, round((time.monotonic() - started) * 1000))


app.add_middleware(RequestContextMiddleware)


@app.exception_handler(RequestValidationError)
async def validation(request, exc):
    if request.url.path.startswith('/api/ai'):
        return failure(request, 422, 'VALIDATION_ERROR', '模型配置不符合要求，请检查模式、模型ID、Key及业务空间字段。')
    details = ['.'.join(str(v) for v in e['loc'])+': '+e['msg'] for e in exc.errors()]
    return failure(request, 422, 'VALIDATION_ERROR', '输入不符合要求；'+'；'.join(details))


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return failure(request, exc.status_code, 'NOT_FOUND' if exc.status_code==404 else 'HTTP_ERROR', str(exc.detail))


@app.exception_handler(AIError)
async def ai_error(request, exc):
    return JSONResponse(status_code=exc.status, content={'request_id': request.state.request_id,
        'error': {'code': exc.code, 'message': exc.message, 'retryable': exc.retryable}})


@app.get('/api/health')
def health():
    return {'status':'ok','mode':'mock','version':'1.2.0','available_modes':['mock','ai','search'],'knowledge_version':DATA['version'],
            'counts':{k:len(DATA[k]) for k in ['knowledge','questions','errors','relations']}}


@app.get('/api/knowledge')
def catalog():
    return {'items':[{k:x[k] for k in ['id','title','chapter','prerequisites']} for x in KNOWLEDGE.values()],
            'relations':DATA['relations'],'knowledge_version':DATA['version']}


@app.get('/api/knowledge/{knowledge_id}')
def knowledge(knowledge_id: str):
    if knowledge_id not in KNOWLEDGE:
        raise HTTPException(404, '知识点不存在，请从课程目录选择')
    return {**KNOWLEDGE[knowledge_id], 'enrichment': ENRICHMENT.get(knowledge_id)}


CONTENT_TYPES = {'.R': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml'}
CONTENT_NAME = re.compile(r'K\d{2}_[A-Za-z0-9_]+\.(R|txt|svg)')


@app.get('/content/{kind}/{name}', include_in_schema=False)
def content_asset(kind: Literal['code', 'images'], name: str):
    """Serve example scripts, validation logs and diagrams referenced by the supplements."""
    path = ROOT/'content_assets'/kind/name
    if not CONTENT_NAME.fullmatch(name) or not path.is_file():
        raise HTTPException(404, '资源不存在')
    return FileResponse(path, media_type=CONTENT_TYPES[path.suffix],
                        headers={'Cache-Control': 'no-cache', 'Content-Disposition': 'inline'})


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


@app.post('/api/chat', response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request, response: Response):
    return await respond(body, request, response)


@app.post('/api/review', response_model=ChatResponse)
async def review(body: ChatRequest, request: Request, response: Response):
    return await respond(body, request, response, True)


@app.post('/api/chat/stream')
async def chat_stream(body: ChatRequest, request: Request, response: Response):
    store, session = prepare_request(body, request, response)
    return response_stream(body, request, response, store, session, ChatResponse.model_validate)


@app.post('/api/review/stream')
async def review_stream(body: ChatRequest, request: Request, response: Response):
    store, session = prepare_request(body, request, response, True)
    return response_stream(body, request, response, store, session, ChatResponse.model_validate, True)


@app.get('/', include_in_schema=False)
def index():
    return FileResponse(ROOT/'static/index.html')


app.mount('/static', StaticFiles(directory=ROOT/'static'), name='static')
