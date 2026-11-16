from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class AIError(Exception):
    def __init__(self, code: str, message: str, status: int = 502, retryable: bool = False):
        super().__init__(code)
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable


class ModelConfig(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['mock', 'ai', 'search'] = 'mock'
    provider: Literal['deepseek', 'qwen', 'openai'] | None = None
    model: str = Field(default='', max_length=100, pattern=r'^[A-Za-z0-9._:/-]*$')
    api_key: SecretStr | None = Field(default=None, max_length=4096)
    workspace_id: str = Field(default='', max_length=80, pattern=r'^[A-Za-z0-9_-]*$')
    region: Literal['cn-beijing', 'ap-southeast-1'] = 'cn-beijing'
    max_output_tokens: int = Field(default=8192, ge=256, le=32768)

    @field_validator('api_key')
    @classmethod
    def valid_key(cls, value):
        if value is not None:
            key = value.get_secret_value()
            if not key.strip() or any(ord(char) < 33 or ord(char) > 126 for char in key):
                raise ValueError('Key应为不含空格和换行的ASCII文本')
        return value


class TeachingIssue(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['error', 'warning', 'logic']
    line: int | None = Field(default=None, ge=1)
    reason: str


class TeachingAnswer(BaseModel):
    model_config = ConfigDict(extra='forbid')
    content_markdown: str = ''
    summary: str = ''
    steps: list[str] = Field(default_factory=list)
    issues: list[TeachingIssue] = Field(default_factory=list)
    corrected_code: str = ''
    example_code: str = ''
    expected_output: str = ''
    follow_ups: list[Annotated[str, Field(max_length=200)]] = Field(default_factory=list, max_length=2)
    is_supplementary: bool = False


class ModelAnswer(BaseModel):
    model_config = ConfigDict(extra='forbid')
    answer: TeachingAnswer
    knowledge_ids: list[str] = Field(default_factory=list, max_length=4)
