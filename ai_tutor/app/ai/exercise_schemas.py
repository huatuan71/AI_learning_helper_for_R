"""Bounded contracts for AI-generated self-study exercises."""
import unicodedata
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .summary_schemas import KnowledgeId

PROMPT_VERSION = 'learning-exercise-v1'
MAX_REQUEST_BYTES = 32 * 1024
MAX_OUTPUT_BYTES = 128 * 1024
Format = Literal['choice', 'short_answer', 'code_reading', 'code_fix']
Difficulty = Literal['basic', 'standard', 'advanced']
Text200 = Annotated[str, Field(min_length=1, max_length=200)]


def normalized(text):
    return ''.join(unicodedata.normalize('NFKC', text).casefold().split())


class ExerciseModel(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

    @field_validator('*', mode='before')
    @classmethod
    def unicode_text(cls, value):
        def check(item):
            if isinstance(item, str) and any(0xD800 <= ord(c) <= 0xDFFF for c in item):
                raise ValueError('文本必须为有效Unicode')
            if isinstance(item, list):
                for part in item:
                    check(part)
        check(value)
        return value


class ExerciseRequest(ExerciseModel):
    schema_version: Literal[1]
    knowledge_ids: list[KnowledgeId] = Field(min_length=1, max_length=3)
    count: int = Field(ge=1, le=5)
    difficulty: Difficulty
    formats: list[Format] = Field(min_length=1, max_length=4)
    recent_prompts: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(max_length=10)

    @field_validator('schema_version', mode='before')
    @classmethod
    def integer_version(cls, value):
        if type(value) is not int:
            raise ValueError('schema_version必须为整数1')
        return value

    @model_validator(mode='after')
    def unique_lists(self):
        if len(set(self.knowledge_ids)) != len(self.knowledge_ids) or len(set(self.formats)) != len(self.formats):
            raise ValueError('知识点和题型不得重复')
        if any(not text.strip() for text in self.recent_prompts):
            raise ValueError('近期题干不得为空')
        return self


class ModelQuestion(ExerciseModel):
    knowledge_ids: list[KnowledgeId] = Field(min_length=1, max_length=3)
    learning_type: Literal['concept', 'application']
    format: Format
    difficulty: Difficulty
    prompt: str = Field(min_length=1, max_length=1200)
    code: str = Field(default='', max_length=2000)
    choices: list[Annotated[str, Field(min_length=1, max_length=1200)]] = Field(max_length=4)
    correct_index: int | None = Field(ge=0, le=3)
    hints: list[Text200] = Field(min_length=1, max_length=2)
    reference_answer: str = Field(min_length=1, max_length=1600)
    solution_code: str = Field(default='', max_length=3000)
    explanation: str = Field(min_length=1, max_length=1000)

    @model_validator(mode='after')
    def question_shape(self):
        if any(not text.strip() for text in [self.prompt, self.reference_answer, self.explanation, *self.hints, *self.choices]):
            raise ValueError('题干、选项、提示及答案不得为空')
        if len(set(self.knowledge_ids)) != len(self.knowledge_ids):
            raise ValueError('知识编号不得重复')
        if self.format == 'choice':
            if len(self.choices) != 4 or self.correct_index is None or len({normalized(x) for x in self.choices}) != 4:
                raise ValueError('单选题须有4个唯一选项及有效参考索引')
        elif self.choices or self.correct_index is not None:
            raise ValueError('其他题型须使用空选项和null参考索引')
        if self.format in {'code_reading', 'code_fix'} and not self.code.strip():
            raise ValueError('代码题须包含题目代码')
        return self


class ModelExerciseBatch(ExerciseModel):
    questions: list[ModelQuestion] = Field(min_length=1, max_length=5)


class ExerciseSource(ExerciseModel):
    knowledge_id: KnowledgeId
    title: str
    source_id: str
    file: str
    locator: str


class ExerciseQuestion(ModelQuestion):
    id: str = Field(pattern=r'^aiq:')
    source_refs: list[ExerciseSource] = Field(min_length=1)
    execution_status: Literal['not_executed']


class ExerciseResponse(ExerciseModel):
    request_id: str
    status: Literal['ok']
    mode: Literal['ai']
    generation_id: str
    generated_at: str
    provider: Literal['deepseek', 'qwen', 'openai']
    model: str
    prompt_version: Literal[PROMPT_VERSION]
    knowledge_version: str
    usage: dict[Literal['input_tokens', 'output_tokens', 'total_tokens'], Annotated[int, Field(ge=0)]]
    duration_ms: int = Field(ge=0)
    questions: list[ExerciseQuestion]
