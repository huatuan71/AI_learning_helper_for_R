// Browser-native ES module. Keep policy changes versioned for archive replay.
export const ALGORITHM_VERSION = 'review-v1';
export const REVIEW_CONFIG = Object.freeze({
  intervalDays: Object.freeze([1, 3, 7, 14, 30, 60]),
  dayMs: 86_400_000,
  retryMs: 600_000,
  dailyCardLimit: 2,
  firstDetectionLimit: 2,
  defaultLimit: 6,
  minLimit: 3,
  maxLimit: 12,
  prerequisiteDepth: 1,
  weights: Object.freeze({ overdue: 40, failure: 30, prerequisite: 20, enrolled: 10 }),
});

export function assertKnowledgeId(id) {
  if (typeof id !== 'string' || !/^K(0[1-9]|[1-3]\d|4[0-3])$/.test(id)) {
    throw new TypeError('知识编号必须为课程中的 K01 至 K43');
  }
  return id;
}

export function normalizeTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) {
    throw new TypeError('时间必须为 UTC ISO 8601 字符串');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new TypeError('时间无效');
  }
  return date.toISOString();
}

export function localDay(at, timeZone) {
  const time = normalizeTime(at);
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 100 || /^[+-]/.test(timeZone)) {
    throw new TypeError('请提供 IANA 时区');
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(time));
}

export function effectiveGrade(attempt) {
  if (attempt.grade === 'again') return 'again';
  if (attempt.hintUsed || attempt.answerRevealed) return 'hinted';
  if (attempt.grade === 'easy' && !attempt.variantPassed) return 'good';
  return attempt.grade;
}

export function normalizeAttempt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('作答记录无效');
  for (const key of ['id', 'cardId', 'questionId']) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 200) {
      throw new TypeError(`作答 ${key} 无效`);
    }
  }
  const [knowledgeId, type, extra] = value.cardId.split(':');
  assertKnowledgeId(knowledgeId);
  if (extra !== undefined || !['concept', 'application'].includes(type)) throw new TypeError('卡片编号无效');
  if (!['again', 'hinted', 'good', 'easy'].includes(value.grade)) throw new TypeError('复习评级无效');
  if (!['self', 'objective'].includes(value.assessmentSource)) throw new TypeError('评分来源无效');
  for (const key of ['hintUsed', 'answerRevealed', 'variantPassed']) {
    if (typeof value[key] !== 'boolean') throw new TypeError(`${key} 必须为布尔值`);
  }
  if (typeof value.answerText !== 'string' || value.answerText.length > 20_000) throw new TypeError('答案长度无效');
  if (!value.answerText.trim() && value.grade !== 'again') throw new TypeError('空答案请选择重学或继续作答');
  const at = normalizeTime(value.at);
  localDay(at, value.timeZone);
  return {
    id: value.id, cardId: value.cardId, questionId: value.questionId, at, timeZone: value.timeZone,
    grade: value.grade, answerText: value.answerText, hintUsed: value.hintUsed,
    answerRevealed: value.answerRevealed, variantPassed: value.variantPassed,
    assessmentSource: value.assessmentSource,
  };
}

export function createCard(knowledgeId, type, now) {
  assertKnowledgeId(knowledgeId);
  if (!['concept', 'application'].includes(type)) throw new TypeError('复习卡类型无效');
  const enrolledAt = normalizeTime(now);
  return {
    id: `${knowledgeId}:${type}`, knowledgeId, type, stage: 0, state: 'new',
    enrolledAt, updatedAt: enrolledAt,
    dueAt: new Date(Date.parse(enrolledAt) + REVIEW_CONFIG.dayMs).toISOString(),
    lastReviewedAt: null,
  };
}

export function compareAttempts(a, b) {
  return Date.parse(a.at) - Date.parse(b.at) || compareIds(a.id, b.id);
}

function compareIds(a, b) {
  return a < b ? -1 : Number(a > b);
}

function validateCard(card) {
  const base = createCard(card.knowledgeId, card.type, card.enrolledAt);
  normalizeTime(card.dueAt);
  normalizeTime(card.updatedAt);
  if (card.lastReviewedAt !== null) normalizeTime(card.lastReviewedAt);
  if (base.id !== card.id || !Number.isInteger(card.stage) || card.stage < 0 || card.stage > 5 ||
      !['new', 'review', 'relearning'].includes(card.state)) throw new TypeError('复习卡结构无效');
}

export function scheduleReview(card, value, previousAttempts = []) {
  const attempt = normalizeAttempt(value);
  validateCard(card);
  if (card.id !== attempt.cardId) {
    throw new TypeError('作答与卡片不匹配或等级无效');
  }
  const now = Date.parse(attempt.at);
  if (now < Date.parse(normalizeTime(card.enrolledAt)) ||
      (card.lastReviewedAt && now < Date.parse(normalizeTime(card.lastReviewedAt)))) {
    throw new RangeError('作答时间早于卡片历史，请按 UTC 时间与 ID 顺序重算');
  }
  const unique = new Map(previousAttempts.filter(item => item.cardId === card.id).map(item => [item.id, item]));
  if (unique.has(attempt.id)) return { ...card };
  const history = [...unique.values()].sort(compareAttempts);
  if (history.some(item => compareAttempts(item, attempt) >= 0)) throw new RangeError('作答历史顺序无效');
  const day = localDay(attempt.at, attempt.timeZone);
  const todayCount = history.filter(item => localDay(item.at, attempt.timeZone) === day).length;
  const grade = effectiveGrade(attempt);
  let stage = card.stage;
  let state = 'review';
  let delay = REVIEW_CONFIG.dayMs;
  if (grade === 'again') {
    stage = 0;
    state = 'relearning';
    delay = todayCount + 1 >= REVIEW_CONFIG.dailyCardLimit ? REVIEW_CONFIG.dayMs : REVIEW_CONFIG.retryMs;
  } else if (grade === 'hinted') {
    stage = Math.max(0, stage - 1);
  } else {
    const lastAt = card.lastReviewedAt || card.enrolledAt;
    const crossDay = localDay(lastAt, attempt.timeZone) !== day;
    const independentRecall = crossDay && todayCount === 0 && now >= Date.parse(normalizeTime(card.dueAt)) &&
      now - Date.parse(lastAt) >= REVIEW_CONFIG.dayMs;
    if (independentRecall) {
      stage = Math.min(5, stage + (grade === 'easy' ? 2 : 1));
      delay = REVIEW_CONFIG.intervalDays[stage] * REVIEW_CONFIG.dayMs;
    }
  }
  return {
    ...card, stage, state, updatedAt: attempt.at, lastReviewedAt: attempt.at,
    dueAt: new Date(now + delay).toISOString(),
  };
}

export function buildReviewQueue({ cards, events, attempts, knowledge, now, timeZone, limit = REVIEW_CONFIG.defaultLimit }) {
  const at = normalizeTime(now);
  const today = localDay(at, timeZone);
  if (!Number.isInteger(limit) || limit < REVIEW_CONFIG.minLimit || limit > REVIEW_CONFIG.maxLimit) {
    throw new RangeError('每次复习数量必须为3至12');
  }
  const currentTime = Date.parse(at);
  cards.forEach(validateCard);
  const byKnowledge = new Map(knowledge.map(item => [item.id, item]));
  const history = new Map();
  const uniqueAttempts = new Map(attempts.map(item => [item.id, item]));
  for (const attempt of [...uniqueAttempts.values()].sort(compareAttempts)) {
    if (Date.parse(attempt.at) > currentTime) continue;
    if (!history.has(attempt.cardId)) history.set(attempt.cardId, []);
    history.get(attempt.cardId).push(attempt);
  }
  const enrolled = new Set(events.filter(item => item.kind === 'enroll' && Date.parse(item.at) <= currentTime)
    .map(item => item.knowledgeId));
  const candidates = new Map(cards.map(card => [card.id, card]));
  const reinforcement = new Set();
  // Only direct prerequisites are eligible. The visited set also guards self-edges and cycles.
  for (const card of cards) {
    const latest = history.get(card.id)?.at(-1);
    if (Date.parse(card.dueAt) > currentTime || !latest || effectiveGrade(latest) !== 'again') continue;
    const visited = new Set([card.knowledgeId]);
    const parents = byKnowledge.get(card.knowledgeId)?.prerequisites || [];
    for (const id of parents.slice(0, 43 * REVIEW_CONFIG.prerequisiteDepth)) {
      if (visited.has(id) || !byKnowledge.has(id)) continue;
      visited.add(id);
      const parentHistory = history.get(`${id}:concept`) || [];
      const evidence = parentHistory.at(-1);
      const mastered = evidence && ['good', 'easy'].includes(effectiveGrade(evidence));
      if (mastered) continue;
      const parentId = `${id}:concept`;
      reinforcement.add(parentId);
      if (!candidates.has(parentId)) {
        candidates.set(parentId, { ...createCard(id, 'concept', at), dueAt: at });
      } else if (Date.parse(candidates.get(parentId).dueAt) > currentTime) {
        candidates.set(parentId, { ...candidates.get(parentId), dueAt: at });
      }
    }
  }
  const ranked = [];
  for (const card of candidates.values()) {
    if (Date.parse(card.dueAt) > currentTime) continue;
    const previous = history.get(card.id) || [];
    const todayCount = previous.filter(item => localDay(item.at, timeZone) === today).length;
    if (todayCount >= REVIEW_CONFIG.dailyCardLimit) continue;
    const latest = previous.at(-1);
    const failed = latest && effectiveGrade(latest) === 'again';
    const startAt = card.lastReviewedAt || card.enrolledAt;
    const interval = Math.max(1, Date.parse(card.dueAt) - Date.parse(startAt));
    const overdue = Math.min(1, Math.max(0, (currentTime - Date.parse(card.dueAt)) / interval));
    const weights = REVIEW_CONFIG.weights;
    const priority = weights.overdue * overdue + weights.failure * Number(Boolean(failed)) +
      weights.prerequisite * Number(reinforcement.has(card.id)) + weights.enrolled * Number(enrolled.has(card.knowledgeId));
    let reason = previous.length ? '到期复习' : '首次检测';
    if (enrolled.has(card.knowledgeId)) reason = '主动加入复习';
    if (reinforcement.has(card.id)) reason = '直接先修补强';
    if (failed) reason = '最近未掌握，优先重试';
    if (!byKnowledge.has(card.knowledgeId)) reason += '，课程资料缺失，请下载课程后继续';
    ranked.push({ card: { ...card }, reason, priority });
  }
  ranked.sort((a, b) => b.priority - a.priority || Date.parse(a.card.dueAt) - Date.parse(b.card.dueAt) ||
    compareIds(a.card.id, b.card.id));
  let firstCount = 0;
  return ranked.filter(item => {
    if (history.get(item.card.id)?.length) return true;
    firstCount += 1;
    return firstCount <= REVIEW_CONFIG.firstDetectionLimit;
  }).slice(0, limit);
}
