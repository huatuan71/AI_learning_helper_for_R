"""Regression coverage for repository paths and generated delivery filenames."""
import csv
import json
from pathlib import Path
import re
import subprocess
from types import SimpleNamespace
from urllib.parse import unquote, urlsplit

from app.main import app
from scripts import evaluate, generate_api_docs, publish_info


REPO = Path(__file__).resolve().parents[2]


def test_git_tracked_paths_are_ascii():
    result = subprocess.run(
        ['git', '-C', str(REPO), 'ls-files', '-z'],
        check=True, capture_output=True,
    )
    paths = [name for name in result.stdout.decode('utf-8').split('\0') if name]
    assert paths
    assert all(name.isascii() for name in paths)


def test_course_source_filenames_are_ascii_and_resolve():
    course = json.loads((REPO / 'ai_tutor/data/course.json').read_text(encoding='utf-8'))
    filenames = set(course['source_files'])
    for group in ('knowledge', 'questions', 'errors'):
        for item in course[group]:
            filenames.update(source['file'] for source in item['sources']
                             if Path(source['file']).suffix.lower() == '.pdf')
    for name in filenames:
        assert name.isascii(), name
        assert (REPO / 'content/sources' / name).is_file(), name


def test_supplement_asset_links_are_ascii_and_resolve():
    supplements = list((REPO / 'content/supplements').glob('*.md'))
    assert supplements
    for document in supplements:
        content = document.read_text(encoding='utf-8')
        for href in re.findall(r'!?\[[^\]]*\]\(([^)\n]+)\)', content):
            target = urlsplit(href)
            if target.scheme or target.netloc or not target.path:
                continue
            path = unquote(target.path)
            assert path.isascii(), (document.name, href)
            assert (document.parent / path).is_file(), (document.name, href)


def test_delivery_paths_and_generation_from_another_working_directory(monkeypatch, tmp_path):
    expected = REPO / 'docs/deliverables'
    for script in (evaluate, generate_api_docs, publish_info):
        assert script.DELIVERABLES_ROOT == expected
    assert evaluate.DEFAULT_OUTPUT == expected / 'regression-evaluation.csv'

    destination = tmp_path / 'deliverables'
    destination.mkdir()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(generate_api_docs, 'DELIVERABLES_ROOT', destination)
    monkeypatch.setattr(generate_api_docs, 'read', lambda path:
                        {'version': '1.2.1'} if path == '/api/health' else app.openapi())
    generate_api_docs.main()
    assert (destination / 'api-reference.md').is_file()

    output = destination / 'regression-evaluation.csv'
    evaluate.evaluate(SimpleNamespace(
        live=False, search=False, base_url='http://127.0.0.1:8000', limit=1, output=str(output),
    ))
    with output.open(encoding='utf-8-sig', newline='') as stream:
        assert len(list(csv.DictReader(stream))) == 1
