"""Stable learning-summary fixtures for backend and browser integration tests."""
from app.ai.summary_schemas import POLICY_VERSION


def summary_input():
    return {
        'schema_version': 1, 'input_fingerprint': 'a' * 64,
        'period': {'start_date': '2026-11-11', 'end_date': '2026-11-17', 'time_zone': 'Asia/Shanghai'},
        'metrics': {'topic_count': 1, 'study_event_count': 1, 'attempt_count': 0,
                    'independent_self_rated_count': 0, 'conversation_count': 1},
        'coverage': {'total_evidence_count': 1, 'included_evidence_count': 1,
                     'truncated': False, 'policy_version': POLICY_VERSION},
        'evidence': [{'id': 'c:summary-example', 'source_id': 'summary-example', 'kind': 'conversation',
                      'at': '2026-11-17T08:00:00.000Z', 'knowledge_ids': ['K06'],
                      'text': '提问：如何处理缺失值？\n已有讲解：使用is.na识别缺失值。'}],
    }


def summary_result(evidence_id='c:summary-example', knowledge_id='K06'):
    return {
        'overview': '本期记录涉及缺失值处理，当前掌握程度仍需独立检测。',
        'topics': [{'knowledge_id': knowledge_id, 'observation': '曾提问缺失值识别方法。',
                    'evidence_ids': [evidence_id]}],
        'review_priorities': [{'knowledge_id': knowledge_id, 'reason': '现有记录以讲解为主，建议复习后检测。',
                               'evidence_ids': [evidence_id]}],
        'next_actions': [{'knowledge_id': knowledge_id, 'action': '独立完成一次缺失值识别练习。',
                         'reason': '用独立作答验证本期讲解内容。', 'evidence_ids': [evidence_id]}],
        'uncertainties': ['对话记录和自评不能替代独立测评，掌握程度需验证。'],
    }
