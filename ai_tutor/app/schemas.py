"""Request and response models shared by HTTP routes and evaluation tools."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool


class ErrorResponse(BaseModel):
    request_id: str
    error: ErrorDetail


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
