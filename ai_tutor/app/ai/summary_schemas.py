"""Versioned, bounded contracts for evidence-grounded learning summaries."""
from datetime import date, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PROMPT_VERSION = 'learning-summary-v1'
POLICY_VERSION = 'learning-summary-evidence-v1'
MAX_REQUEST_BYTES = 120 * 1024
MAX_OUTPUT_BYTES = 64 * 1024
KnowledgeId = Annotated[str, Field(pattern=r'^K(0[1-9]|[1-3]\d|4[0-3])$')]
EvidenceId = Annotated[str, Field(min_length=1, max_length=202)]
Count = Annotated[int, Field(strict=True, ge=0)]
SummaryText = Annotated[str, Field(min_length=1, max_length=600)]


class SummaryModel(BaseModel):
    model_config = ConfigDict(extra='forbid')

    @field_validator('*', mode='before')
    @classmethod
    def valid_unicode(cls, value):
        if isinstance(value, str):
            if not value.strip() or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
                raise ValueError('文本须为非空的有效Unicode字符串')
        return value


class SummaryPeriod(SummaryModel):
    start_date: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')
    end_date: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}$')
    time_zone: str = Field(min_length=1, max_length=100)

    @model_validator(mode='after')
    def valid_range(self):
        start, end = date.fromisoformat(self.start_date), date.fromisoformat(self.end_date)
        if start > end:
            raise ValueError('开始日期不得晚于结束日期')
        try:
            ZoneInfo(self.time_zone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError('时区必须为有效IANA时区') from None
        return self


class SummaryMetrics(SummaryModel):
    topic_count: Count = Field(le=43)
    study_event_count: Count
    attempt_count: Count
    independent_self_rated_count: Count
    conversation_count: Count

    @model_validator(mode='after')
    def valid_counts(self):
        if self.independent_self_rated_count > self.attempt_count:
            raise ValueError('独立自评次数不得超过作答次数')
        return self


class SummaryCoverage(SummaryModel):
    total_evidence_count: Count
    included_evidence_count: Count = Field(le=50)
    truncated: bool = Field(strict=True)
    policy_version: Literal[POLICY_VERSION]

    @model_validator(mode='after')
    def valid_counts(self):
        if self.included_evidence_count > self.total_evidence_count:
            raise ValueError('收录证据不得超过总数')
        if self.included_evidence_count < self.total_evidence_count and not self.truncated:
            raise ValueError('遗漏证据时必须标记摘录截断')
        return self


class AttemptSignals(SummaryModel):
    grade: Literal['again', 'hinted', 'good', 'easy']
    hint_used: bool = Field(strict=True)
    answer_revealed: bool = Field(strict=True)
    question_type: Literal['concept', 'application']


class SummaryEvidence(SummaryModel):
    id: EvidenceId
    source_id: str = Field(min_length=1, max_length=200)
    kind: Literal['conversation', 'attempt', 'event']
    at: str = Field(pattern=r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$')
    knowledge_ids: list[KnowledgeId] = Field(max_length=43)
    text: str = Field(min_length=1, max_length=1200)
    signals: AttemptSignals | None = None

    @model_validator(mode='after')
    def valid_source(self):
        datetime.fromisoformat(self.at)
        if len(set(self.knowledge_ids)) != len(self.knowledge_ids):
            raise ValueError('知识编号不得重复')
        if self.id != {'conversation': 'c:', 'attempt': 'a:', 'event': 'e:'}[self.kind] + self.source_id:
            raise ValueError('证据编号必须匹配类型及来源ID')
        if (self.kind == 'attempt') != (self.signals is not None):
            raise ValueError('作答证据须包含作答信号，其他证据省略信号')
        return self


class LearningSummaryRequest(SummaryModel):
    schema_version: Literal[1]
    input_fingerprint: str = Field(pattern=r'^[a-f0-9]{64}$')
    period: SummaryPeriod
    metrics: SummaryMetrics
    coverage: SummaryCoverage
    evidence: list[SummaryEvidence] = Field(max_length=50)

    @field_validator('schema_version', mode='before')
    @classmethod
    def strict_version(cls, value):
        if type(value) is not int:
            raise ValueError('schema_version必须为整数1')
        return value

    @model_validator(mode='after')
    def consistent_evidence(self):
        if len(self.evidence) != self.coverage.included_evidence_count:
            raise ValueError('证据数量与覆盖范围不一致')
        if len({item.id for item in self.evidence}) != len(self.evidence):
            raise ValueError('证据编号不得重复')
        counts = self.metrics
        total_records = counts.study_event_count + counts.attempt_count + counts.conversation_count
        if not total_records and counts.topic_count:
            raise ValueError('无学习记录时主题数必须为0')
        if self.coverage.total_evidence_count > total_records:
            raise ValueError('证据总量不得超过学习记录总量')
        if bool(self.coverage.total_evidence_count) != bool(total_records):
            raise ValueError('证据总量与统计是否为空不一致')
        if total_records and not self.evidence:
            raise ValueError('存在学习记录时须至少提供一条证据')
        allowed = set()
        for kind, metric in [('event', counts.study_event_count), ('attempt', counts.attempt_count),
                             ('conversation', counts.conversation_count)]:
            if sum(item.kind == kind for item in self.evidence) > metric:
                raise ValueError('证据类型数量超出本期统计')
        for item in self.evidence:
            day = datetime.fromisoformat(item.at).astimezone(ZoneInfo(self.period.time_zone)).date().isoformat()
            if not self.period.start_date <= day <= self.period.end_date:
                raise ValueError('证据时间须位于指定时区的日期范围内')
            allowed.update(item.knowledge_ids)
        if len(allowed) > counts.topic_count:
            raise ValueError('证据知识数量超出本期主题统计')
        return self


class CitedSummaryItem(SummaryModel):
    knowledge_id: KnowledgeId
    evidence_ids: list[EvidenceId] = Field(min_length=1, max_length=10)

    @field_validator('evidence_ids')
    @classmethod
    def unique_references(cls, value):
        if len(value) != len(set(value)):
            raise ValueError('引用证据不得重复')
        return value


class SummaryTopic(CitedSummaryItem):
    observation: SummaryText


class SummaryPriority(CitedSummaryItem):
    reason: SummaryText


class SummaryAction(CitedSummaryItem):
    action: SummaryText
    reason: SummaryText


class LearningSummary(SummaryModel):
    overview: str = Field(min_length=1, max_length=1200)
    topics: list[SummaryTopic] = Field(max_length=10)
    review_priorities: list[SummaryPriority] = Field(max_length=10)
    next_actions: list[SummaryAction] = Field(max_length=10)
    uncertainties: list[SummaryText] = Field(max_length=10)


class LearningSummaryResponse(SummaryModel):
    request_id: str
    status: Literal['ok', 'no_data']
    mode: Literal['ai', 'local']
    provider: Literal['deepseek', 'qwen', 'openai'] | None
    model: str | None
    prompt_version: Literal[PROMPT_VERSION]
    input_fingerprint: str
    generated_at: str
    period: SummaryPeriod
    coverage: SummaryCoverage
    usage: dict[Literal['input_tokens', 'output_tokens', 'total_tokens'], Count]
    duration_ms: Count
    summary: LearningSummary | None
