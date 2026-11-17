import { assertKnowledgeId, effectiveGrade, localDay, normalizeAttempt, normalizeTime } from './review-scheduler.js?v=learning-v1';

export const PROMPT_VERSION = 'learning-summary-v1';
export const EVIDENCE_POLICY_VERSION = 'learning-summary-evidence-v1';
export const SUMMARY_LIMITS = Object.freeze({ evidence: 50, text: 1200, requestBytes: 120 * 1024, summaries: 100 });

export function canonicalSummaryJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalSummaryJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalSummaryJSON(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function summaryDigest(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalSummaryJSON(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeSummaryPeriod(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('总结日期范围无效');
  const result = {};
  for (const key of ['start_date', 'end_date']) {
    const date = value[key];
    if (typeof date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
      throw new TypeError('总结日期必须为有效的 YYYY-MM-DD');
    }
    result[key] = date;
  }
  if (result.start_date > result.end_date) throw new RangeError('总结结束日期应晚于或等于开始日期');
  localDay('2026-01-01T00:00:00.000Z', value.time_zone);
  result.time_zone = value.time_zone;
  return result;
}

export function isIndependentSelfRated(attempt) {
  return attempt.assessmentSource === 'self' && ['good', 'easy'].includes(attempt.grade) &&
    Boolean(attempt.answerText?.trim()) && !attempt.hintUsed && !attempt.answerRevealed;
}

function sourceId(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new TypeError('总结来源ID无效');
  return value;
}

function uniqueRows(rows = []) {
  if (!Array.isArray(rows)) throw new TypeError('总结记录必须为数组');
  const result = new Map();
  for (const row of rows) {
    const id = sourceId(row?.id);
    const saved = result.get(id);
    if (saved && canonicalSummaryJSON(saved) !== canonicalSummaryJSON(row)) throw new TypeError('总结来源存在同ID冲突');
    result.set(id, row);
  }
  return [...result.values()];
}

function excerpt(value) {
  // Only prose fields are submitted. Dedicated code fields and personal notes are never read.
  return String(value || '').replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '[代码块已省略]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+)/gi, '[密钥已省略]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|secret|password|密钥|密码)\s*[=:：]\s*)[^\s,;，；]+/gi, '$1[已省略]')
    .split('\n').filter(line => !/^\s*(?:[\w.$]+\s*<-|(?:library|source|setwd|install\.packages)\s*\()/.test(line)).join('\n').trim();
}

function clippedText(value) {
  const points = Array.from(value, point => /^[\uD800-\uDFFF]$/.test(point) ? '\uFFFD' : point);
  return { text: points.slice(0, SUMMARY_LIMITS.text).join(''), truncated: points.length > SUMMARY_LIMITS.text };
}

function knowledgeIds(values) {
  return [...new Set(values.filter(Boolean).map(assertKnowledgeId))].sort();
}

function selectEvidence(candidates) {
  const frequency = new Map();
  const corrections = new Map();
  for (const item of candidates) for (const id of item.knowledge_ids) {
    frequency.set(id, (frequency.get(id) || 0) + 1);
    if (item.debug) corrections.set(id, (corrections.get(id) || 0) + 1);
  }
  const score = item => item.difficulty || (item.debug ? (item.knowledge_ids.some(id => corrections.get(id) > 1) ? 4 : 2) : 0);
  const count = item => Math.max(0, ...item.knowledge_ids.map(id => frequency.get(id)));
  const ranked = [...candidates].sort((a, b) => score(b) - score(a) || count(b) - count(a) ||
    b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
  const selected = [];
  const ids = new Set();
  const topics = new Set();
  const add = item => {
    if (ids.has(item.id) || selected.length >= SUMMARY_LIMITS.evidence) return;
    selected.push(item);
    ids.add(item.id);
    item.knowledge_ids.forEach(id => topics.add(id));
  };
  ranked.filter(item => score(item) >= 3).slice(0, 20).forEach(add);
  for (const item of ranked) if (item.knowledge_ids.some(id => !topics.has(id))) add(item);
  ranked.forEach(add);
  return selected;
}

export async function buildSummaryInput(snapshot, value) {
  const period = normalizeSummaryPeriod(value);
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: period.time_zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const within = at => {
    const date = formatter.format(new Date(normalizeTime(at)));
    return date >= period.start_date && date <= period.end_date;
  };
  const conversations = uniqueRows(snapshot.conversations).filter(row => within(row.record.time));
  const attempts = uniqueRows(snapshot.attempts).map(normalizeAttempt).filter(row => within(row.at));
  const events = uniqueRows(snapshot.events).filter(row => within(row.at));
  const candidates = [];
  const topics = new Set();
  const append = (kind, row, at, ids, text, extra = {}) => {
    const normalizedIds = knowledgeIds(ids);
    normalizedIds.forEach(id => topics.add(id));
    candidates.push({ id: `${kind[0]}:${sourceId(row.id)}`, source_id: row.id, kind, at: normalizeTime(at),
      knowledge_ids: normalizedIds, ...clippedText(text), ...extra });
  };
  for (const row of conversations) {
    const { request, response } = row.record;
    const text = [['提问', request.question], ['回答摘录', response.answer?.summary], ['报错', request.error_message]]
      .map(([label, text]) => text ? `${label}：${excerpt(text)}` : '').filter(Boolean).join('\n') || '本期有一条对话记录，未包含可提交的文字摘录。';
    append('conversation', row, row.record.time, [...(response.related_knowledge || []), request.knowledge_id], text,
      { debug: request.task_type === 'debug' || response.task_type === 'debug' });
  }
  for (const row of attempts) {
    const [id, type] = row.cardId.split(':');
    const grade = effectiveGrade(row);
    const text = `复习作答，题型${type === 'concept' ? '概念' : '应用'}，${row.assessmentSource === 'self' ? '用户自评' : '客观题评分'}为${row.grade}。` +
      `使用提示：${row.hintUsed ? '是' : '否'}，查看参考答案：${row.answerRevealed ? '是' : '否'}。`;
    append('attempt', row, row.at, [id], text, { difficulty: grade === 'again' ? 5 : grade === 'hinted' ? 3 : 0,
      signals: { grade: row.grade, hint_used: row.hintUsed, answer_revealed: row.answerRevealed, question_type: type } });
  }
  const conversationIds = new Set(conversations.map(row => row.id));
  const eventLabels = { view: '浏览知识点，仅表明访问', study: '学习记录', debug: '代码纠错记录', exercise_view: '查看练习，未表明独立作答', enroll: '主动加入复习' };
  for (const row of events) {
    assertKnowledgeId(row.knowledgeId);
    topics.add(row.knowledgeId);
    if (!eventLabels[row.kind]) throw new TypeError('总结学习事件类型无效');
    if (row.conversationId && conversationIds.has(row.conversationId)) continue;
    append('event', row, row.at, [row.knowledgeId], eventLabels[row.kind], { debug: row.kind === 'debug' });
  }
  const chosen = selectEvidence(candidates);
  const input = {
    schema_version: 1, input_fingerprint: '0'.repeat(64), period,
    metrics: { topic_count: topics.size, study_event_count: events.length, attempt_count: attempts.length,
      independent_self_rated_count: attempts.filter(isIndependentSelfRated).length, conversation_count: conversations.length },
    coverage: { total_evidence_count: candidates.length, included_evidence_count: chosen.length,
      truncated: chosen.length < candidates.length || chosen.some(item => item.truncated), policy_version: EVIDENCE_POLICY_VERSION },
    evidence: [],
  };
  const refresh = () => {
    input.evidence = chosen.map(({ truncated, difficulty, debug, ...item }) => item)
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    input.coverage.included_evidence_count = chosen.length;
  };
  refresh();
  while (new TextEncoder().encode(JSON.stringify(input)).byteLength > SUMMARY_LIMITS.requestBytes) {
    chosen.pop();
    input.coverage.truncated = true;
    refresh();
  }
  const { input_fingerprint, ...fingerprinted } = input;
  input.input_fingerprint = await summaryDigest(fingerprinted);
  return input;
}

export function summaryCacheKey(value, config = value) {
  const period = normalizeSummaryPeriod(value.period);
  const fingerprint = value.input_fingerprint;
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new TypeError('总结输入指纹无效');
  if (!['deepseek', 'qwen', 'openai'].includes(config.provider) || typeof config.model !== 'string' ||
      !config.model.trim() || config.model.length > 200 || typeof config.prompt_version !== 'string' ||
      !config.prompt_version.trim() || config.prompt_version.length > 100) throw new TypeError('总结模型信息无效');
  return canonicalSummaryJSON({ period, input_fingerprint: fingerprint, provider: config.provider,
    model: config.model, prompt_version: config.prompt_version });
}

export function summaryMatches(record, input, config) {
  try { return summaryCacheKey(record) === summaryCacheKey(input, config); }
  catch { return false; }
}

export function summaryEvidenceMetadata(input) {
  return input.evidence.map(({ id, source_id, kind, at, knowledge_ids }) => ({
    id, source_id, kind, at, knowledge_ids: [...knowledge_ids],
  }));
}
