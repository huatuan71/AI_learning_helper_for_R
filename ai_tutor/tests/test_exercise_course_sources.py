"""The embedded offline source allowlist follows the shipped course."""
import json
from pathlib import Path


def test_offline_exercise_sources_match_course():
    root = Path(__file__).resolve().parents[1]
    module = (root / 'static/ai-exercise-data.js').read_text(encoding='utf-8')
    embedded = module.split('export const EXERCISE_COURSE_SOURCES = Object.freeze(', 1)[1].split(');', 1)[0]
    actual = json.loads(embedded)
    course = json.loads((root / 'data/course.json').read_text(encoding='utf-8'))
    expected = [{key: item[key] for key in ('id', 'title', 'sources')} for item in course['knowledge']]
    # The client keeps only the source fields used by exercise responses.
    for item in expected:
        item['sources'] = [{key: source[key] for key in ('source_id', 'file', 'locator')}
                           for source in item['sources']]
    assert actual == expected
