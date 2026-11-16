"""Knowledge supplement import (scripts/import_enrichment.py) and its API exposure."""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('import_enrichment', ROOT/'scripts/import_enrichment.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)

MINIMAL = """# K01 测试标题

## 基本信息

- 难度为核心。
- 前置知识为无。

## 学习目标

- 能够测试。

## 直观理解

见[K01_example_01.R](../ai_tutor/content_assets/code/K01_example_01.R)和[S3《课件》PDF 9](../../成员一/课件.pdf#page=9)。

## 基础例题

```r
## 这是R注释，不是章节标题
x <- 1
```

## 易错案例

错误。

## 完整练习

练习。
"""


def write_draft(tmp_path, text, name='K01.md'):
    drafts = tmp_path/'drafts'
    drafts.mkdir(exist_ok=True)
    (drafts/name).write_text(text, encoding='utf-8')
    return importer.build(drafts=drafts)


def test_shipped_drafts_import_cleanly_and_output_is_current():
    data, problems = importer.build()
    assert problems == []
    assert data['count'] >= 8
    shipped = json.loads((ROOT/'data/enrichment.json').read_text(encoding='utf-8'))
    assert shipped == json.loads(json.dumps(data, ensure_ascii=False)), '草稿已修改，请重新运行 scripts/import_enrichment.py'
    for item in data['items'].values():
        names = [s['title'] for s in item['sections']]
        assert '基本信息' not in names and '追问建议' not in names
        for asset in item['assets']:
            assert (ROOT/'content_assets'/asset).is_file()
        text = json.dumps(item, ensure_ascii=False)
        assert '../ai_tutor/' not in text and '.pdf#page' not in text


def test_heading_inside_code_fence_is_not_a_section(tmp_path):
    data, problems = write_draft(tmp_path, MINIMAL)
    assert problems == []
    item = data['items']['K01']
    example = next(s for s in item['sections'] if s['title'] == '基础例题')
    assert '## 这是R注释' in example['markdown']
    assert item['difficulty'] == '核心' and item['prerequisites'] == []


def test_links_are_rewritten_and_pdf_links_become_text(tmp_path):
    data, _ = write_draft(tmp_path, MINIMAL)
    intuition = next(s for s in data['items']['K01']['sections'] if s['title'] == '直观理解')['markdown']
    assert '](/content/code/K01_example_01.R)' in intuition
    assert 'S3《课件》PDF 9' in intuition and '.pdf' not in intuition


def test_missing_asset_and_missing_section_are_reported(tmp_path):
    broken = MINIMAL.replace('K01_example_01.R)', 'K01_missing.R)').replace('## 完整练习\n\n练习。\n', '')
    _, problems = write_draft(tmp_path, broken)
    assert any('缺少资源' in p for p in problems)
    assert any('完整练习' in p for p in problems)


def test_unknown_knowledge_id_is_reported(tmp_path):
    _, problems = write_draft(tmp_path, MINIMAL.replace('# K01', '# K99'), name='K99.md')
    assert any('course.json中没有' in p for p in problems)


@pytest.fixture(scope='module')
def client():
    pytest.importorskip('fastapi')
    from fastapi.testclient import TestClient
    from app.main import app
    return TestClient(app)


def test_knowledge_detail_includes_supplement(client):
    k06 = client.get('/api/knowledge/K06').json()
    assert k06['enrichment']['id'] == 'K06'
    assert [s['title'] for s in k06['enrichment']['sections']][:2] == ['学习目标', '先备检查']
    assert client.get('/api/knowledge/K43').json()['enrichment'] is None


def test_content_assets_are_served_with_safe_names_only(client):
    script = client.get('/content/code/K06_example_01.R')
    assert script.status_code == 200 and script.headers['content-type'] == 'text/plain; charset=utf-8'
    image = client.get('/content/images/K06_visual_01.svg')
    assert image.status_code == 200 and image.headers['content-type'] == 'image/svg+xml'
    assert image.headers['x-content-type-options'] == 'nosniff'
    assert client.get('/content/code/K06_missing.R').status_code == 404
    assert client.get('/content/code/..%2F..%2Fapp%2Fmain.py').status_code == 404
    assert client.get('/content/data/K06_example_01.R').status_code == 422


def test_ai_context_carries_teaching_notes():
    pytest.importorskip('fastapi')
    from app.main import ChatRequest
    from app.ai.service import course_context
    _, records = course_context(ChatRequest(question='NA和NaN有什么区别', knowledge_id='K06'), False)
    k06 = next(r for r in records if r['id'] == 'K06')
    assert records[0]['id'] == 'K06' and '易错案例' in k06['teaching_notes']
    assert len(json.dumps(records, ensure_ascii=False)) <= 21000


def test_bracket_in_image_description_is_reported(tmp_path):
    broken = MINIMAL.replace('## 易错案例', '![区间(0,60]示意](../ai_tutor/content_assets/images/K01_visual_01.svg)\n\n## 易错案例')
    _, problems = write_draft(tmp_path, broken)
    assert any('方括号' in p for p in problems)


def test_verification_status_is_read_from_basic_info(tmp_path):
    data, _ = write_draft(tmp_path, MINIMAL.replace('- 前置知识为无。', '- 前置知识为无。\n- 验证状态为待R实测。'))
    assert data['items']['K01']['verified'] is False
    shipped = json.loads((ROOT/'data/enrichment.json').read_text(encoding='utf-8'))['items']
    assert shipped['K06']['verified'] is True and shipped['K09']['verified'] is False


def test_ai_context_marks_unverified_notes():
    pytest.importorskip('fastapi')
    from app.main import ChatRequest
    from app.ai.service import course_context
    _, records = course_context(ChatRequest(question='cut分组的区间边界', knowledge_id='K15'), False)
    k15 = next(r for r in records if r['id'] == 'K15')
    assert '待R实测' in k15['teaching_notes']['验证状态']
