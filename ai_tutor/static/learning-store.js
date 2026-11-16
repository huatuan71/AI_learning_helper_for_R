import {
  createCard, scheduleReview, normalizeAttempt, normalizeTime, assertKnowledgeId, compareAttempts,
} from './review-scheduler.js?v=learning-v1';

const DATABASE = 'r-language-tutor-learning';
const DATABASE_VERSION = 1;
const SCHEMA_VERSION = 1;
const TABLES = ['conversations', 'events', 'cards', 'attempts', 'bookmarks', 'settings', 'course'];
const PERSONAL_TABLES = TABLES.filter(name => name !== 'course');
const LIMITS = Object.freeze({
  archiveBytes: 20 * 1024 * 1024,
  conversations: 100_000, events: 200_000, cards: 86, attempts: 100_000, bookmarks: 100_043,
  text: 100_000, list: 1000, id: 200,
});
const DEFAULT_SETTINGS = Object.freeze({ dailyLimit: 6 });

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} 必须为对象`);
  return value;
}

function string(value, name, max = LIMITS.text, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new TypeError(`${name} 的类型或长度无效`);
  }
  return value;
}

function array(value, name, max = LIMITS.list) {
  if (!Array.isArray(value) || value.length > max) throw new TypeError(`${name} 的数组数量无效`);
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sizeCheck(value) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw new TypeError('档案必须为可序列化 JSON'); }
  if (!serialized || new TextEncoder().encode(serialized).byteLength > LIMITS.archiveBytes) {
    throw new RangeError('档案超过20 MiB上限');
  }
}

function pickStrings(value, fields) {
  object(value, '记录字段');
  const result = {};
  for (const key of fields) {
    if (value[key] !== undefined) result[key] = value[key] === null ? null : string(value[key], key);
  }
  return result;
}

function pickNumbers(value, fields) {
  const result = {};
  for (const key of fields) {
    if (value[key] === undefined) continue;
    if (value[key] !== null && (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < 0)) {
      throw new TypeError(`${key} 必须为非负数`);
    }
    result[key] = value[key];
  }
  return result;
}

function pickBooleans(value, fields) {
  const result = {};
  for (const key of fields) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') throw new TypeError(`${key} 必须为布尔值`);
    result[key] = value[key];
  }
  return result;
}

// Mirrors app.js safeRecord. Request history, credentials and unknown model fields never enter IndexedDB.
function safeRecord(value) {
  object(value, '对话');
  const source = object(value.response, '回答');
  const answer = object(source.answer, '教学内容');
  string(answer.summary, '回答摘要');
  const request = pickStrings(value.request,
    ['session_id', 'question', 'task_type', 'code', 'error_message', 'knowledge_id', 'teaching_mode']);
  if (request.knowledge_id != null) assertKnowledgeId(request.knowledge_id);
  const response = {
    ...pickStrings(source, ['request_id', 'status', 'mode', 'task_type', 'matched_case_id',
      'prompt_version', 'knowledge_version', 'provider', 'model', 'search_status']),
    ...pickNumbers(source, ['duration_ms']),
    ...pickBooleans(source, ['used_web_search']),
  };
  if (source.request_id != null) string(source.request_id, 'request_id', 128, false);
  if (source.matched_case_id != null) string(source.matched_case_id, 'matched_case_id', LIMITS.id, false);
  if (source.related_knowledge !== undefined) {
    response.related_knowledge = array(source.related_knowledge, '相关知识', 43).map(assertKnowledgeId);
  }
  response.answer = {
    ...pickStrings(answer, ['content_markdown', 'summary', 'corrected_code', 'example_code',
      'expected_output', 'execution_status', 'code_kind']),
    ...pickBooleans(answer, ['is_supplementary']),
  };
  for (const key of ['steps', 'follow_ups']) {
    if (answer[key] !== undefined) response.answer[key] = array(answer[key], key).map(item => string(item, key));
  }
  response.answer.issues = array(answer.issues || [], 'issues').map(issue => ({
    ...pickStrings(issue, ['kind', 'reason']), ...pickNumbers(issue, ['line']),
  }));
  response.citations = array(source.citations || [], 'citations').map(item => {
    const citation = pickStrings(item, ['knowledge_id', 'source_id', 'file', 'locator', 'raw']);
    if (citation.knowledge_id != null) assertKnowledgeId(citation.knowledge_id);
    return citation;
  });
  response.web_citations = array(source.web_citations || [], 'web_citations').map(item => pickStrings(item, ['source_id', 'title', 'url']));
  response.usage = pickNumbers(source.usage || {}, ['input_tokens', 'output_tokens', 'total_tokens']);
  const result = { time: normalizeTime(value.time), request, response };
  if (value.display_question !== undefined) result.display_question = string(value.display_question, '展示问题');
  return result;
}

async function conversation(record) {
  const safe = safeRecord(record);
  const bytes = new TextEncoder().encode(canonical(safe));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return { id: safe.response.request_id ? `request:${safe.response.request_id}` : `legacy:${hash}`, record: safe };
}

function validateEvent(value) {
  object(value, '学习事件');
  const result = {
    id: string(value.id, '事件ID', LIMITS.id, false), knowledgeId: assertKnowledgeId(value.knowledgeId),
    kind: value.kind, at: normalizeTime(value.at),
  };
  if (!['view', 'study', 'exercise_view', 'debug', 'enroll'].includes(value.kind)) throw new TypeError('学习事件类型无效');
  for (const key of ['conversationId', 'caseId']) {
    if (value[key] !== undefined) result[key] = string(value[key], key, LIMITS.id, false);
  }
  return result;
}

function validateCard(value) {
  object(value, '复习卡');
  const base = createCard(value.knowledgeId, value.type, value.enrolledAt);
  if (base.id !== value.id || !Number.isInteger(value.stage) || value.stage < 0 || value.stage > 5 ||
      !['new', 'review', 'relearning'].includes(value.state)) throw new TypeError('复习卡结构无效');
  const result = {
    ...base, stage: value.stage, state: value.state, updatedAt: normalizeTime(value.updatedAt),
    dueAt: normalizeTime(value.dueAt),
    lastReviewedAt: value.lastReviewedAt === null ? null : normalizeTime(value.lastReviewedAt),
  };
  if (result.updatedAt < base.enrolledAt || result.dueAt < base.enrolledAt ||
      (result.lastReviewedAt && (result.lastReviewedAt < base.enrolledAt || result.lastReviewedAt > result.updatedAt))) {
    throw new TypeError('复习卡时间顺序无效');
  }
  return result;
}

function validateBookmark(value) {
  object(value, '收藏');
  const knowledgeId = value.knowledgeId === null ? null : assertKnowledgeId(value.knowledgeId);
  const conversationId = value.conversationId === null ? null : string(value.conversationId, '对话ID', LIMITS.id, false);
  const expected = conversationId ? `conversation:${conversationId}` : `knowledge:${knowledgeId}`;
  if (value.id !== expected || (!knowledgeId && !conversationId)) throw new TypeError('收藏关联无效');
  const result = {
    id: expected, knowledgeId, conversationId, title: string(value.title, '收藏标题', 1000),
    note: string(value.note, '难点备注', 20_000), createdAt: normalizeTime(value.createdAt), updatedAt: normalizeTime(value.updatedAt),
  };
  if (result.updatedAt < result.createdAt) throw new TypeError('收藏时间顺序无效');
  return result;
}

function validateSettings(value) {
  object(value, '设置');
  if (!Number.isInteger(value.dailyLimit) || value.dailyLimit < 3 || value.dailyLimit > 12) {
    throw new TypeError('每日复习数量必须为3至12');
  }
  return { dailyLimit: value.dailyLimit };
}

function validateCourse(value) {
  object(value, '课程快照');
  sizeCheck(value);
  string(value.version, '课程版本', LIMITS.id, false);
  const knowledge = array(value.knowledge, '课程知识', 43);
  const ids = new Set(knowledge.map(item => assertKnowledgeId(item.id)));
  if (ids.size !== 43 || knowledge.length !== 43) throw new TypeError('课程快照需包含43个不同知识点');
  for (const item of knowledge) {
    string(item.title, '知识标题', 1000, false);
    object(item.fields, '知识内容');
    for (const field of Object.values(item.fields)) string(field, '课程文本');
    array(item.prerequisites, '先修关系', 43).forEach(assertKnowledgeId);
  }
  for (const key of ['questions', 'errors', 'relations']) array(value[key], key);
  // Preserve all public course metadata, including source references used by offline UI.
  return JSON.parse(JSON.stringify(value));
}

function evidenceForConversation(row) {
  const { request, response, time } = row.record;
  if (response.status !== 'ok') return null;
  const knowledgeId = response.related_knowledge?.[0] || request.knowledge_id;
  if (!knowledgeId) return null;
  let kind = 'study';
  if (response.task_type === 'debug' || request.task_type === 'debug') kind = 'debug';
  if (response.task_type === 'exercise' || request.task_type === 'exercise') kind = 'exercise_view';
  return {
    id: `conversation:${row.id}`, knowledgeId, kind, at: time, conversationId: row.id,
    ...(response.matched_case_id ? { caseId: response.matched_case_id } : {}),
  };
}

function mergeRows(existing, incoming) {
  const merged = new Map(existing.map(row => [row.id, row]));
  let imported = 0;
  let duplicates = 0;
  for (const row of incoming) {
    const saved = merged.get(row.id);
    if (saved) {
      duplicates += 1;
      // Equal IDs with different payloads indicate corruption or ID reuse. Abort the whole transaction.
      if (canonical(saved) !== canonical(row)) throw new TypeError(`同一ID的数据冲突：${row.id}`);
    } else {
      imported += 1;
      merged.set(row.id, row);
    }
  }
  return { rows: [...merged.values()], imported, duplicates };
}

function publicAttempt(row) {
  const { resultCard, ...attempt } = row;
  return attempt;
}

// Rebuild from facts, never trust imported stage values as recall evidence.
function rebuild(data) {
  const cards = new Map();
  for (const saved of data.cards) {
    cards.set(saved.id, createCard(saved.knowledgeId, saved.type, saved.enrolledAt));
  }
  const timeline = [];
  for (const event of data.events) {
    if (['study', 'debug', 'exercise_view', 'enroll'].includes(event.kind)) {
      timeline.push({ at: event.at, id: event.id, event });
    }
  }
  for (const row of data.attempts) timeline.push({ at: row.at, id: row.id, attempt: publicAttempt(row) });
  timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || Number(Boolean(a.attempt)) - Number(Boolean(b.attempt)) ||
    (a.id < b.id ? -1 : Number(a.id > b.id)));
  const histories = new Map();
  const attempts = [];
  const enrollments = new Set();
  for (const entry of timeline) {
    if (entry.event) {
      const event = entry.event;
      for (const type of ['concept', 'application']) {
        const id = `${event.knowledgeId}:${type}`;
        let card = cards.get(id);
        if (!card || event.at < card.enrolledAt) {
          card = createCard(event.knowledgeId, type, event.at);
          cards.set(id, card);
        }
        if (event.kind === 'enroll' && !enrollments.has(event.knowledgeId)) {
          card.dueAt = event.at;
          card.updatedAt = event.at;
        }
      }
      if (event.kind === 'enroll') enrollments.add(event.knowledgeId);
    } else {
      const attempt = entry.attempt;
      let card = cards.get(attempt.cardId);
      if (!card || attempt.at < card.enrolledAt) {
        const [id, type] = attempt.cardId.split(':');
        card = createCard(id, type, attempt.at);
      }
      const history = histories.get(card.id) || [];
      card = scheduleReview(card, attempt, history);
      cards.set(card.id, card);
      history.push(attempt);
      histories.set(card.id, history);
      attempts.push({ ...attempt, resultCard: { ...card } });
    }
  }
  data.cards = [...cards.values()].sort((a, b) => a.id < b.id ? -1 : Number(a.id > b.id));
  data.attempts = attempts;
}

async function validateArchive(value) {
  object(value, '档案');
  sizeCheck(value);
  if (value.app !== 'r-language-tutor' || value.schemaVersion !== SCHEMA_VERSION) throw new TypeError('档案应用标识或schema版本不兼容');
  normalizeTime(value.exportedAt);
  string(value.knowledgeVersion, '知识版本', LIMITS.id, false);
  const source = object(value.data, '学习档案');
  const conversations = await Promise.all(array(source.conversations, '对话', LIMITS.conversations).map(async row => {
    const normalized = await conversation(row.record);
    if (row.id !== normalized.id) throw new TypeError('对话稳定ID校验失败');
    return normalized;
  }));
  return {
    conversations,
    events: array(source.events, '事件', LIMITS.events).map(validateEvent),
    cards: array(source.cards, '复习卡', LIMITS.cards).map(validateCard),
    attempts: array(source.attempts, '作答', LIMITS.attempts).map(normalizeAttempt),
    bookmarks: array(source.bookmarks, '收藏', LIMITS.bookmarks).map(validateBookmark),
    settings: validateSettings(source.settings),
  };
}

let databasePromise;
let channel;
let fallbackListening = false;
const listeners = new Set();
const NOTIFY_KEY = 'r-language-tutor-learning-change';

function notify() {
  for (const listener of listeners) {
    try { listener(); } catch (error) { globalThis.console?.error('学习数据通知失败', error); }
  }
}

function startNotifications() {
  if (!channel && typeof globalThis.BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel(NOTIFY_KEY);
      channel.onmessage = notify;
    } catch { channel = undefined; }
  }
  if (!fallbackListening && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('storage', event => { if (event.key === NOTIFY_KEY) notify(); });
    fallbackListening = true;
  }
}

function publish() {
  notify();
  try {
    if (channel) { channel.postMessage('changed'); return; }
  } catch { /* Fall back to the storage event when a channel is unavailable. */ }
  try { globalThis.localStorage?.setItem(NOTIFY_KEY, globalThis.crypto.randomUUID()); } catch { /* IndexedDB remains usable. */ }
}

async function openDatabase() {
  if (!globalThis.indexedDB) throw new Error('此浏览器无法使用 IndexedDB，请检查浏览器的本地存储权限');
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, DATABASE_VERSION);
      let blocked = false;
      request.onupgradeneeded = () => {
        const database = request.result;
        // Add future version-specific migrations here, within this upgrade transaction.
        for (const name of TABLES) {
          const store = database.objectStoreNames.contains(name) ? request.transaction.objectStore(name) :
            database.createObjectStore(name, { keyPath: 'id' });
          const indexes = {
            conversations: ['record.time'], events: ['knowledgeId', 'at'], cards: ['knowledgeId', 'dueAt'],
            attempts: ['cardId', 'at'], bookmarks: ['conversationId'], settings: [], course: [],
          };
          for (const key of indexes[name]) {
            if (!store.indexNames.contains(key)) store.createIndex(key, key);
          }
        }
      };
      request.onblocked = () => {
        blocked = true;
        reject(new Error('学习数据库升级被其他页面阻塞，请关闭旧页面后重试'));
      };
      request.onerror = () => reject(new Error(`学习数据库无法打开：${request.error?.message || '本地存储不可用'}`));
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) { database.close(); return; }
        database.onversionchange = () => { database.close(); databasePromise = undefined; notify(); };
        database.onclose = () => { databasePromise = undefined; };
        startNotifications();
        resolve(database);
      };
    }).catch(error => { databasePromise = undefined; throw error; });
  }
  return databasePromise;
}

async function transaction(mode, mutate) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(TABLES, mode);
    const rows = {};
    let remaining = TABLES.length;
    let result;
    let failure;
    tx.oncomplete = () => { if (mode === 'readwrite') publish(); resolve(result); };
    tx.onerror = () => { failure ||= tx.error; };
    tx.onabort = () => reject(failure || tx.error || new Error('学习数据事务已中止，原有数据已保留'));
    for (const name of TABLES) {
      const request = tx.objectStore(name).getAll();
      request.onsuccess = () => {
        rows[name] = request.result;
        remaining -= 1;
        if (remaining) return;
        try {
          if (mode === 'readonly') { result = mutate(rows); return; }
          // Synchronous work in the request callback keeps the IndexedDB transaction active in WebKit.
          const original = {};
          for (const table of TABLES) original[table] = new Map(rows[table].map(row => [row.id, canonical(row)]));
          result = mutate(rows);
          for (const table of TABLES) {
            const store = tx.objectStore(table);
            for (const row of rows[table]) {
              if (original[table].get(row.id) !== canonical(row)) store.put(row);
              original[table].delete(row.id);
            }
            for (const id of original[table].keys()) store.delete(id);
          }
        } catch (error) { failure = error; tx.abort(); }
      };
    }
  });
}

function snapshotOf(rows) {
  return {
    conversations: rows.conversations.sort((a, b) => a.record.time.localeCompare(b.record.time) || a.id.localeCompare(b.id)),
    events: rows.events.sort(compareAttempts), cards: rows.cards.sort((a, b) => a.id.localeCompare(b.id)),
    attempts: rows.attempts.map(publicAttempt).sort(compareAttempts),
    bookmarks: rows.bookmarks.sort((a, b) => a.id.localeCompare(b.id)),
    settings: rows.settings[0]?.value || { ...DEFAULT_SETTINGS }, course: rows.course[0]?.value || null,
  };
}

async function ingest(records, tolerateInvalid) {
  array(records, '旧记录', LIMITS.conversations);
  const prepared = [];
  for (const record of records) {
    try { prepared.push(await conversation(record)); }
    catch (error) { if (!tolerateInvalid) throw error; }
  }
  return transaction('readwrite', rows => {
    let imported = 0;
    const conversationIds = new Set(rows.conversations.map(row => row.id));
    const eventIds = new Set(rows.events.map(event => event.id));
    for (const row of prepared) {
      // Network retries can carry a different receipt time. The first committed response wins.
      if (conversationIds.has(row.id)) continue;
      rows.conversations.push(row);
      conversationIds.add(row.id);
      const event = evidenceForConversation(row);
      if (event && !eventIds.has(event.id)) { rows.events.push(event); eventIds.add(event.id); }
      imported += 1;
    }
    rebuild(rows);
    return { imported, conversationId: prepared[0]?.id };
  });
}

export const learningStore = Object.freeze({
  async ready() { await openDatabase(); },
  async snapshot() { return transaction('readonly', snapshotOf); },
  async migrateLegacy(records) {
    const { imported } = await ingest(records, true);
    return { imported };
  },
  async ingestConversation(record) {
    const { conversationId } = await ingest([record], false);
    return { conversationId };
  },
  async recordVisit(knowledgeId, at = new Date().toISOString()) {
    const event = validateEvent({ id: globalThis.crypto.randomUUID(), knowledgeId, kind: 'view', at });
    await transaction('readwrite', rows => { rows.events.push(event); });
  },
  async enroll(knowledgeId, at = new Date().toISOString()) {
    const event = validateEvent({ id: `enroll:${knowledgeId}`, knowledgeId, kind: 'enroll', at });
    await transaction('readwrite', rows => {
      if (rows.events.some(item => item.id === event.id)) return;
      rows.events.push(event);
      rebuild(rows);
    });
  },
  async saveAttempt(value) {
    // ID lookup precedes payload validation so a retry always returns its committed response.
    const id = string(value?.id, '作答ID', LIMITS.id, false);
    return transaction('readwrite', rows => {
      const saved = rows.attempts.find(item => item.id === id);
      if (saved) return { card: saved.resultCard, attempt: publicAttempt(saved) };
      const attempt = normalizeAttempt(value);
      rows.attempts.push(attempt);
      rebuild(rows);
      const stored = rows.attempts.find(item => item.id === id);
      return { card: stored.resultCard, attempt: publicAttempt(stored) };
    });
  },
  async saveBookmark(value) {
    const bookmark = validateBookmark(value);
    await transaction('readwrite', rows => {
      if (bookmark.conversationId && !rows.conversations.some(item => item.id === bookmark.conversationId)) {
        throw new TypeError('收藏关联的对话不存在');
      }
      const saved = rows.bookmarks.find(item => item.id === bookmark.id);
      if (saved && (saved.updatedAt > bookmark.updatedAt ||
          (saved.updatedAt === bookmark.updatedAt && canonical(saved) >= canonical(bookmark)))) return;
      rows.bookmarks = rows.bookmarks.filter(item => item.id !== bookmark.id).concat(bookmark);
    });
  },
  async removeBookmark(id) {
    string(id, '收藏ID', LIMITS.id + 20, false);
    await transaction('readwrite', rows => { rows.bookmarks = rows.bookmarks.filter(item => item.id !== id); });
  },
  async saveCourse(value) {
    const course = validateCourse(value);
    await transaction('readwrite', rows => { rows.course = [{ id: 'current', value: course }]; });
  },
  async saveSettings(value) {
    const settings = validateSettings(value);
    await transaction('readwrite', rows => { rows.settings = [{ id: 'current', value: settings }]; });
  },
  async clearConversations() {
    await transaction('readwrite', rows => {
      rows.conversations = [];
      rows.bookmarks = rows.bookmarks.filter(item => !item.conversationId);
    });
  },
  async exportArchive() {
    const { course, ...data } = await learningStore.snapshot();
    const archive = {
      app: 'r-language-tutor', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(),
      knowledgeVersion: course?.version || data.conversations.at(-1)?.record.response.knowledge_version || 'unknown', data,
    };
    sizeCheck(archive);
    return archive;
  },
  async importArchive(value) {
    const incoming = await validateArchive(value);
    return transaction('readwrite', rows => {
      let imported = 0;
      let duplicates = 0;
      for (const name of ['conversations', 'events', 'attempts']) {
        const existing = name === 'attempts' ? rows.attempts.map(publicAttempt) : rows[name];
        const merged = mergeRows(existing, incoming[name]);
        rows[name] = merged.rows;
        imported += merged.imported;
        duplicates += merged.duplicates;
      }
      for (const card of incoming.cards) {
        const saved = rows.cards.find(item => item.id === card.id);
        if (!saved) rows.cards.push(card);
        else if (card.enrolledAt < saved.enrolledAt) saved.enrolledAt = card.enrolledAt;
      }
      const eventIds = new Set(rows.events.map(event => event.id));
      for (const row of rows.conversations) {
        const event = evidenceForConversation(row);
        if (event && !eventIds.has(event.id)) { rows.events.push(event); eventIds.add(event.id); }
      }
      for (const bookmark of incoming.bookmarks) {
        if (bookmark.conversationId && !rows.conversations.some(item => item.id === bookmark.conversationId)) {
          throw new TypeError('档案含失去对话关联的收藏');
        }
        const index = rows.bookmarks.findIndex(item => item.id === bookmark.id);
        if (index < 0) { rows.bookmarks.push(bookmark); imported += 1; }
        else {
          duplicates += 1;
          const saved = rows.bookmarks[index];
          if (saved.updatedAt < bookmark.updatedAt ||
              (saved.updatedAt === bookmark.updatedAt && canonical(saved) < canonical(bookmark))) rows.bookmarks[index] = bookmark;
        }
      }
      rows.settings = [{ id: 'current', value: incoming.settings }];
      rebuild(rows);
      if (rows.cards.length > LIMITS.cards) throw new RangeError('复习卡数量超过课程上限');
      return { imported, duplicates };
    });
  },
  async resetLearningData() {
    await transaction('readwrite', rows => { for (const name of PERSONAL_TABLES) rows[name] = []; });
  },
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('订阅者必须为函数');
    startNotifications();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
});
