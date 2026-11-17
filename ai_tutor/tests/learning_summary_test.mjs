import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  buildSummaryInput, canonicalSummaryJSON, normalizeSummaryPeriod, summaryCacheKey, summaryMatches,
} from '../static/learning-summary-data.js?v=ai-summary-v1';

const PERIOD = { start_date: '2026-11-16', end_date: '2026-11-17', time_zone: 'Asia/Shanghai' };
const AT = '2026-11-17T08:00:00.000Z';
const snapshot = overrides => ({ conversations: [], events: [], attempts: [], bookmarks: [], ...overrides });
const event = (id = 'e1', knowledgeId = 'K06', at = AT) => ({ id, kind: 'view', knowledgeId, at });
const attempt = overrides => ({ id: 'a1', cardId: 'K06:concept', questionId: 'q1', at: AT, timeZone: 'Asia/Shanghai',
  grade: 'good', answerText: '缺失值', hintUsed: false, answerRevealed: false, variantPassed: false,
  assessmentSource: 'self', ...overrides });
const conversation = overrides => ({ id: 'c1', record: { time: AT, request: { question: '如何检测NA？', code: 'sensitive code',
  knowledge_id: 'K06', task_type: 'concept' }, response: { status: 'ok', related_knowledge: ['K06'],
    answer: { summary: '使用 is.na 检测。', corrected_code: 'sensitive code' } }, ...overrides } });

test('空库保留显式范围和零覆盖统计，SHA256依据完整归一化输入', async () => {
  const input = await buildSummaryInput(snapshot(), PERIOD);
  assert.deepEqual(input.metrics, { topic_count: 0, study_event_count: 0, attempt_count: 0, independent_self_rated_count: 0, conversation_count: 0 });
  assert.equal(input.coverage.total_evidence_count, 0);
  const { input_fingerprint, ...rest } = input;
  assert.equal(input_fingerprint, createHash('sha256').update(canonicalSummaryJSON(rest)).digest('hex'));
});

test('仅浏览可生成事实证据，个人备注与代码字段不进入请求', async () => {
  const input = await buildSummaryInput(snapshot({ events: [event()], bookmarks: [{ note: 'private note' }] }), PERIOD);
  assert.equal(input.metrics.study_event_count, 1);
  assert.equal(input.metrics.independent_self_rated_count, 0);
  assert.match(input.evidence[0].text, /仅表明访问/);
  const text = JSON.stringify(await buildSummaryInput(snapshot({ conversations: [conversation()] }), PERIOD));
  assert.ok(!text.includes('sensitive code') && !text.includes('private note'));
});

test('独立自评、提示、答案、未掌握、客观评分保留区别', async () => {
  const attempts = [attempt(), attempt({ id: 'hint', hintUsed: true, grade: 'easy' }),
    attempt({ id: 'answer', answerRevealed: true }), attempt({ id: 'again', grade: 'again', answerText: '' }),
    attempt({ id: 'objective', assessmentSource: 'objective' })];
  const input = await buildSummaryInput(snapshot({ attempts }), PERIOD);
  assert.equal(input.metrics.attempt_count, 5);
  assert.equal(input.metrics.independent_self_rated_count, 1);
  const hint = input.evidence.find(item => item.source_id === 'hint');
  assert.deepEqual(hint.signals, { grade: 'easy', hint_used: true, answer_revealed: false, question_type: 'concept' });
  assert.match(input.evidence.find(item => item.source_id === 'objective').text, /客观题评分/);
});

test('对话派生事件统计保留，摘录去重，重复输入ID去重', async () => {
  const row = conversation();
  const input = await buildSummaryInput(snapshot({ conversations: [row, structuredClone(row)],
    events: [{ ...event(), kind: 'study', conversationId: row.id }] }), PERIOD);
  assert.equal(input.metrics.conversation_count, 1);
  assert.equal(input.metrics.study_event_count, 1);
  assert.equal(input.coverage.total_evidence_count, 1);
  assert.equal(input.evidence[0].kind, 'conversation');
  await assert.rejects(buildSummaryInput(snapshot({ events: [event(), { ...event(), kind: 'debug' }] }), PERIOD), /同ID冲突/);
});

test('北京时间午夜与纽约夏令时按范围的IANA时区筛选', async () => {
  const data = snapshot({ events: [event('before', 'K06', '2026-11-15T15:59:59.999Z'), event('start', 'K06', '2026-11-15T16:00:00.000Z'),
    event('end', 'K06', '2026-11-17T15:59:59.999Z'), event('after', 'K06', '2026-11-17T16:00:00.000Z')] });
  assert.deepEqual((await buildSummaryInput(data, PERIOD)).evidence.map(item => item.source_id), ['start', 'end']);
  const dst = await buildSummaryInput(snapshot({ events: [event('a', 'K06', '2026-11-01T04:00:00.000Z'),
    event('b', 'K06', '2026-11-02T04:59:59.999Z'), event('c', 'K06', '2026-11-02T05:00:00.000Z')] }),
  { start_date: '2026-11-01', end_date: '2026-11-01', time_zone: 'America/New_York' });
  assert.equal(dst.evidence.length, 2);
});

test('非法日期、时区和倒置范围被拒绝', () => {
  for (const value of [{ ...PERIOD, start_date: '2026-02-30' }, { ...PERIOD, time_zone: 'Bad/Zone' },
    { ...PERIOD, time_zone: '+08:00' }, { ...PERIOD, start_date: '2026-11-18' }]) {
    assert.throws(() => normalizeSummaryPeriod(value));
  }
});

test('1200 Unicode字符与120KiB UTF8预算均受限，单个代理项被修复', async () => {
  const conversations = Array.from({ length: 100 }, (_, i) => ({ ...conversation({ response: { related_knowledge: ['K06'],
    answer: { summary: '\uD800' + '😀中文'.repeat(800) } } }), id: `long${i}` }));
  const input = await buildSummaryInput(snapshot({ conversations }), PERIOD);
  assert.ok(input.evidence.length <= 50);
  assert.equal(input.coverage.total_evidence_count, 100);
  assert.equal(input.coverage.truncated, true);
  assert.equal(input.coverage.included_evidence_count, input.evidence.length);
  assert.ok(Buffer.byteLength(JSON.stringify(input)) <= 120 * 1024);
  for (const item of input.evidence) {
    assert.ok(Array.from(item.text).length <= 1200);
    assert.ok(item.text.isWellFormed());
  }
});

test('排序、抽样及指纹不受快照数组或对象键顺序影响', async () => {
  const events = Array.from({ length: 100 }, (_, i) => event(`event${i}`, `K${String(i % 43 + 1).padStart(2, '0')}`));
  const first = await buildSummaryInput(snapshot({ events }), PERIOD);
  const second = await buildSummaryInput(snapshot({ events: [...events].reverse().map(({ at, ...rest }) => ({ at, ...rest })) }), PERIOD);
  assert.deepEqual(first, second);
  assert.equal(first.metrics.topic_count, 43);
  assert.equal(new Set(first.evidence.flatMap(item => item.knowledge_ids)).size, 43);
});

test('反复纠错与需巩固作答优先，旧记录变化更新指纹', async () => {
  const events = Array.from({ length: 90 }, (_, i) => event(`view${i}`, 'K01'));
  events.push({ ...event('debug1', 'K06'), kind: 'debug' }, { ...event('debug2', 'K06'), kind: 'debug' });
  const data = snapshot({ events, attempts: [attempt({ grade: 'again' }), attempt({ id: 'a2', grade: 'hinted' })] });
  const input = await buildSummaryInput(data, PERIOD);
  for (const id of ['a1', 'a2', 'debug1', 'debug2']) assert.ok(input.evidence.some(item => item.source_id === id));
  data.attempts[0].grade = 'hinted';
  assert.notEqual((await buildSummaryInput(data, PERIOD)).input_fingerprint, input.input_fingerprint);
});

test('文本中的围栏代码和常见凭据被省略', async () => {
  const input = await buildSummaryInput(snapshot({ conversations: [conversation({ request: {
    question: '说明\n```r\nprivate_code()\n```\napi_key=secret-value\nBearer abcdefghijk\nsk-privatekey12345', knowledge_id: 'K06',
  } })] }), PERIOD);
  assert.ok(!JSON.stringify(input).match(/private_code|secret-value|abcdefghijk|sk-privatekey/));
});

test('缓存键同时包含范围时区指纹厂商模型和提示词版本', async () => {
  const input = await buildSummaryInput(snapshot({ events: [event()] }), PERIOD);
  const config = { provider: 'deepseek', model: 'deepseek-chat', prompt_version: 'learning-summary-v1' };
  const record = { ...input, ...config };
  assert.equal(summaryMatches(record, input, config), true);
  assert.equal(summaryMatches(record, input, { provider: null, model: null, prompt_version: 'learning-summary-v1' }), false);
  assert.equal(summaryMatches(record, input, {}), false);
  for (const changed of [{ ...config, provider: 'qwen' }, { ...config, model: 'other' }, { ...config, prompt_version: 'v2' }]) {
    assert.notEqual(summaryCacheKey(input, changed), summaryCacheKey(record));
  }
  assert.notEqual(summaryCacheKey({ ...input, period: { ...PERIOD, time_zone: 'UTC' } }, config), summaryCacheKey(record));
});
