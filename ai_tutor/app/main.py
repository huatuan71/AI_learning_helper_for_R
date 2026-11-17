"""Application assembly and the compatible ``app.main:app`` server entry point."""
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from .ai.routes import router as ai_router
from .ai.schemas import AIError
from .ai.sessions import SessionStore
from .api.chat import router as chat_router
from .api.course import router as course_router
from .api.learning_summary import router as learning_summary_router
from .api.pages import router as pages_router
from .config import APP_VERSION, STATIC_ROOT, cors_origins
from .http import RequestContextMiddleware, ai_error, http_error, validation
from .schemas import Answer, ChatRequest, ChatResponse, Citation, ErrorDetail, ErrorResponse, History, Issue


# Re-export models for existing imports. New callers can import app.schemas.
__all__ = [
    'app', 'create_app', 'Answer', 'ChatRequest', 'ChatResponse', 'Citation',
    'ErrorDetail', 'ErrorResponse', 'History', 'Issue',
]


def create_app():
    """Assemble an application with its own in-memory session store."""
    application = FastAPI(
        title='R语言AI助教', version=APP_VERSION,
        description='课程模拟、三厂商AI与网页搜索；代码分析及参考修正。',
        responses={
            404: {'model': ErrorResponse, 'description': '资源或知识点不存在'},
            422: {'model': ErrorResponse, 'description': '参数校验失败'},
            500: {'model': ErrorResponse, 'description': '内部错误；测试中通过故障注入验证'},
        },
    )
    application.add_middleware(
        CORSMiddleware, allow_origins=cors_origins(), allow_credentials=True,
        allow_methods=['GET', 'POST', 'PUT', 'DELETE'], allow_headers=['Content-Type'],
    )
    application.add_middleware(RequestContextMiddleware)
    application.state.sessions = SessionStore()
    application.add_exception_handler(RequestValidationError, validation)
    application.add_exception_handler(HTTPException, http_error)
    application.add_exception_handler(AIError, ai_error)
    application.include_router(ai_router)
    application.include_router(course_router)
    application.include_router(chat_router)
    application.include_router(learning_summary_router)
    application.include_router(pages_router)
    application.mount('/static', StaticFiles(directory=STATIC_ROOT), name='static')
    return application


app = create_app()
