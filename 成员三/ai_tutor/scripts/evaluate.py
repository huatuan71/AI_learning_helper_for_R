"""Export inspectable retrieval checks, or explicitly run a real account evaluation."""
import argparse
import csv
import getpass
import http.cookiejar
import json
import math
import time
from pathlib import Path
import sys
from urllib.parse import urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.engine import DATA, answer, retrieve
from app.schemas import ChatRequest
from app.ai.providers import PROVIDERS


def cases():
    items = [{'id': item['id'], 'question': item['question'], 'knowledge_ids': item['knowledge_ids']}
             for item in DATA['questions']]
    items.extend({'id': item['id'], 'question': item['title'], 'code': item['fields']['复现代码'],
                  'task_type': 'debug', 'knowledge_ids': item['knowledge_ids']} for item in DATA['errors'])
    holdout = json.loads((ROOT / 'tests/evaluation_holdout.json').read_text(encoding='utf-8'))
    return [('existing', item) for item in items] + [('candidate_holdout', item) for item in holdout['cases']]


def evaluate(args):
    connection = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
    base = args.base_url.rstrip('/')
    parsed = urlsplit(base)
    if parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1', 'localhost'}):
        raise ValueError('评估地址须为HTTPS或本机回环HTTP')

    def call(path, body=None, method=None):
        request = Request(base + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type': 'application/json'} if body is not None else {})
        with connection.open(request, timeout=100) as response:
            return json.load(response)

    if args.live:
        key = getpass.getpass('输入测试账号Key（隐藏输入，仅存于本次进程及后端会话） ')
        config = {'mode': 'search' if args.search else 'ai', 'provider': args.provider,
                  'model': args.model or PROVIDERS[args.provider]['default_model'], 'api_key': key,
                  'workspace_id': args.workspace_id, 'region': args.region}
        call('/api/ai/config', config, 'PUT')
        del key, config
    rows = []
    durations = []
    try:
        for suite, item in cases()[:args.limit]:
            req = ChatRequest(**{key: item[key] for key in ('question', 'code', 'task_type') if key in item})
            matched = answer(req)['related_knowledge'] or retrieve(req.question + '\n' + req.code)
            row = {'case_id': item['id'], 'suite': suite,
                   'mode': ('search' if args.search else 'ai') if args.live else 'mock',
                   'expected_knowledge_ids': ' '.join(item['knowledge_ids']),
                   'retrieved_knowledge_ids': ' '.join(matched),
                   'top4_hit': bool(set(item['knowledge_ids']) & set(matched)),
                   'all_required_hit': set(item['knowledge_ids']) <= set(matched),
                   'http_status': '', 'duration_ms': '', 'answer': '',
                   'correctness': '', 'clarity': '', 'code_usability': '', 'citation_support': '',
                   'manual_review': 'pending'}
            if args.live:
                started = time.monotonic()
                try:
                    result = call('/api/review' if req.task_type == 'debug' else '/api/chat', req.model_dump())
                    row.update(http_status=200, answer=json.dumps(result, ensure_ascii=False))
                    row['duration_ms'] = round((time.monotonic() - started) * 1000)
                    durations.append(row['duration_ms'])
                except HTTPError as error:
                    detail = json.load(error)
                    row.update(http_status=error.code, answer=detail.get('error', {}).get('code', 'HTTP_ERROR'))
                except (URLError, TimeoutError):
                    row.update(http_status=0, answer='NETWORK_ERROR')
                elapsed = time.monotonic() - started
                time.sleep(max(0, 13 - elapsed))
            rows.append(row)
    finally:
        if args.live:
            try:
                call('/api/ai/config', method='DELETE')
            except (HTTPError, URLError, TimeoutError):
                print('评估结束时连接已断开，服务端配置将按会话到期策略清除。')
    destination = Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('w', encoding='utf-8-sig', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]) if rows else ['case_id'])
        writer.writeheader()
        writer.writerows(rows)
    report = {'cases': len(rows), 'real_model_calls': args.live, 'manual_answer_quality': 'pending'}
    for suite in ('existing', 'candidate_holdout'):
        subset = [row for row in rows if row['suite'] == suite]
        if subset:
            report[suite] = {'cases': len(subset), 'top4_hit_rate': sum(row['top4_hit'] for row in subset) / len(subset)}
    if durations:
        ordered = sorted(durations)
        report['successful_calls'] = len(durations)
        report['success_rate'] = len(durations) / len(rows)
        middle = len(ordered) // 2
        report['median_ms'] = ordered[middle] if len(ordered) % 2 else (ordered[middle - 1] + ordered[middle]) / 2
        report['p95_ms'] = ordered[math.ceil(len(ordered) * .95) - 1]
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='显式调用真实模型，将产生账号用量')
    parser.add_argument('--search', action='store_true')
    parser.add_argument('--provider', choices=list(PROVIDERS), default='deepseek')
    parser.add_argument('--model', default='')
    parser.add_argument('--workspace-id', default='')
    parser.add_argument('--region', choices=['cn-beijing','ap-southeast-1'], default='cn-beijing')
    parser.add_argument('--base-url', default='http://127.0.0.1:8000')
    parser.add_argument('--limit', type=int, choices=range(1, 51), default=50)
    parser.add_argument('--output', default=str(ROOT.parent / '回归评估结果.csv'))
    evaluate(parser.parse_args())
