"""Normalize model formatting, then validate teaching content and provenance."""
import json
import re

from .schemas import ModelAnswer, TeachingAnswer


class TeachingOutputError(ValueError):
    def __init__(self, code, field):
        super().__init__(code)
        self.code = code
        self.field = field


def output_schema(allowed_ids):
    schema = ModelAnswer.model_json_schema()
    answer = schema['$defs']['TeachingAnswer']
    answer['properties'] = {key: value for key, value in answer['properties'].items()
                            if key in {'content_markdown', 'issues', 'follow_ups', 'is_supplementary'}}
    answer['properties']['content_markdown']['minLength'] = 1
    answer['required'] = ['content_markdown']
    references = schema['properties']['knowledge_ids']
    references['maxItems'] = len(allowed_ids)
    if allowed_ids:
        references['items']['enum'] = allowed_ids
    return schema


def hint_content(text):
    """Hide fenced solutions, including incomplete fences in streaming previews."""
    return re.sub(r'(?ms)^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n.*?(?:^ {0,3}\1[ \t]*$|\Z)|\Z)', '', text).strip()


def normalize_payload(payload, req, task):
    if not isinstance(payload, dict):
        raise TeachingOutputError('root_object_required', 'answer')
    raw = payload.get('answer', payload)
    if isinstance(raw, str):
        raw = {**payload, 'summary': raw}
    if not isinstance(raw, dict):
        raise TeachingOutputError('answer_object_required', 'answer')
    fields = {key: raw[key] for key in TeachingAnswer.model_fields if key in raw}
    for key in ('content_markdown', 'steps', 'issues', 'corrected_code', 'example_code', 'expected_output', 'is_supplementary'):
        if fields.get(key) is None:
            fields.pop(key, None)
    if isinstance(fields.get('content_markdown'), str) and fields['content_markdown'].strip() and not fields.get('summary'):
        fields['summary'] = fields['content_markdown']
    if task == 'exercise' and req.teaching_mode == 'hint':
        for key in ('content_markdown', 'summary'):
            if isinstance(fields.get(key), str):
                fields[key] = hint_content(fields[key])
    if isinstance(fields.get('steps'), str):
        fields['steps'] = [fields['steps']] if fields['steps'].strip() else []
    follow_ups = fields.get('follow_ups', [])
    if isinstance(follow_ups, str):
        follow_ups = [follow_ups]
    fields['follow_ups'] = []
    if isinstance(follow_ups, list):
        fields['follow_ups'] = [item.strip()[:200] for item in follow_ups
                               if isinstance(item, str) and item.strip()][:2]
    if task in {'concept', 'function', 'exercise'}:
        fields['issues'] = []
    if isinstance(fields.get('issues'), list):
        issues = []
        line_count = len(req.code.splitlines())
        aliases = {'运行错误': 'error', '错误': 'error', '警告': 'warning', '逻辑错误': 'logic'}
        for issue in fields['issues']:
            if not isinstance(issue, dict):
                issues.append(issue)
                continue
            issue = {key: issue[key] for key in ('kind', 'line', 'reason') if key in issue}
            if isinstance(issue.get('kind'), str):
                issue['kind'] = aliases.get(issue['kind'], issue['kind'])
            line = issue.get('line')
            if isinstance(line, str) and len(line) <= 6 and line.isdecimal():
                line = int(line)
            issue['line'] = line if type(line) is int and 1 <= line <= line_count else None
            issues.append(issue)
        fields['issues'] = issues
    ids = payload.get('knowledge_ids', raw.get('knowledge_ids', []))
    if ids is None:
        ids = []
    if isinstance(ids, str):
        ids = [ids]
    if isinstance(ids, list) and all(isinstance(item, str) for item in ids):
        ids = list(dict.fromkeys(item.strip() for item in ids))
    return {'answer': fields, 'knowledge_ids': ids}


def parse_teaching(text, allowed_ids, sources, req, task=None):
    text = text.lstrip('\ufeff').strip()
    if text.startswith('```'):
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', text, flags=re.IGNORECASE)
    try:
        payload = json.loads(text)
        if isinstance(payload, str):
            payload = json.loads(payload)
    except (json.JSONDecodeError, ValueError):
        raise TeachingOutputError('invalid_json', 'answer') from None
    result = ModelAnswer.model_validate(normalize_payload(payload, req, task or req.task_type))
    if not (result.answer.content_markdown.strip() or result.answer.summary.strip()):
        raise TeachingOutputError('empty_summary', 'answer.summary')
    if set(result.knowledge_ids) - set(allowed_ids):
        raise TeachingOutputError('unknown_knowledge_reference', 'knowledge_ids')
    prose = '\n'.join([result.answer.content_markdown, result.answer.summary, *result.answer.steps, *result.answer.follow_ups,
                       *(issue.reason for issue in result.answer.issues)])
    prose = re.sub(r'(?ms)^ {0,3}(`{3,}|~{3,})[^\n]*\n.*?^ {0,3}\1[ \t]*$', '', prose)
    prose = re.sub(r'`[^`]*`', '', prose)
    references = set(re.findall(r'\[W\d+\]', prose))
    valid = {'[' + source['source_id'] + ']' for source in sources}
    if references - valid:
        raise TeachingOutputError('unknown_web_reference', 'answer')
    return result


def validation_details(error):
    if isinstance(error, TeachingOutputError):
        return [{'field': error.field, 'type': error.code}]
    known_fields = set(TeachingAnswer.model_fields) | {'answer', 'knowledge_ids', 'kind', 'line', 'reason'}
    return [{'field': '.'.join(str(part) if isinstance(part, int) or part in known_fields else '<extra>'
                              for part in item['loc']), 'type': item['type']}
            for item in error.errors(include_input=False, include_context=False, include_url=False)[:8]]


def output_shape(text):
    try:
        payload = json.loads(text.lstrip('\ufeff').strip())
    except ValueError:
        return {'root': 'invalid_json', 'characters': len(text)}
    shape = {'root': type(payload).__name__, 'characters': len(text)}
    if isinstance(payload, dict):
        known = set(TeachingAnswer.model_fields) | {'answer', 'knowledge_ids', 'data', 'result', 'response'}
        shape['fields'] = sorted(key for key in payload if key in known)
        shape['extra_field_count'] = len(set(payload) - known)
        shape['answer_type'] = type(payload.get('answer')).__name__
    return shape
