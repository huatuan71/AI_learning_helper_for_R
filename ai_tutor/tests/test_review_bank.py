"""Verify every review item against the checked-in course and source material."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COURSE = json.loads((ROOT / 'data/course.json').read_text(encoding='utf-8'))
BANK = json.loads((ROOT / 'static/review-bank.json').read_text(encoding='utf-8'))


def test_unique_question_ids_and_complete_coverage():
    items = BANK['items']
    assert len({item['id'] for item in items}) == len(items) == 94
    for topic in COURSE['knowledge']:
        for kind in ('concept', 'application'):
            assert any(item['knowledgeId'] == topic['id'] and item['type'] == kind
                       and not item['variantOf'] for item in items)


def test_question_sources_and_references_resolve():
    topics = {item['id']: item for item in COURSE['knowledge']}
    source_files = {path.name for path in (ROOT.parent / 'content/sources').glob('*.pdf')}
    for item in BANK['items']:
        assert item['prompt'].strip() and item['reference'].strip()
        assert item['knowledgeId'] in topics and item['sourceRefs']
        for ref in item['sourceRefs']:
            topic = topics[ref['knowledgeId']]
            assert topic['sources'] and ref['field'].strip()
            if ref['field'].startswith('content/supplements/'):
                assert (ROOT.parent / ref['field'].split(' ')[0]).is_file()
            else:
                assert any(field in ref['field'] and value for field, value in topic['fields'].items())
            for source in topic['sources']:
                assert source['file'] and source['locator']
                if source['file'].endswith('.pdf'):
                    assert source['file'] in source_files
        if item.get('code') and item['type'] == 'application':
            assert item['code'] == topics[item['knowledgeId']]['fields']['运行示例']


def test_objective_answers_and_variants():
    by_id = {item['id']: item for item in BANK['items']}
    for item in BANK['items']:
        if item['format'] == 'choice':
            assert len(item['choices']) >= 2
            assert 0 <= item['correctIndex'] < len(item['choices'])
        if item['variantOf']:
            parent = by_id[item['variantOf']]
            assert item['format'] == 'choice'
            assert item['knowledgeId'] == parent['knowledgeId']
            assert item['type'] == parent['type']
