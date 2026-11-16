import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  createCard, scheduleReview, buildReviewQueue, effectiveGrade, localDay, normalizeAttempt,
  REVIEW_CONFIG,
} from '../static/review-scheduler.js?v=learning-v1';

const START = '2026-01-01T08:00:00.000Z';
const DAY = REVIEW_CONFIG.dayMs;
const later = (days, minutes = 0) => new Date(Date.parse(START) + days * DAY + minutes * 60_000).toISOString();
const knowledge = Array.from({ length: 43 }, (_, index) => ({
  id: `K${String(index + 1).padStart(2, '0')}`, prerequisites: [],
}));
function attempt(overrides = {}) {
  return {
    id: 'a1', cardId: 'K06:concept', questionId: 'K06-concept-01', at: later(1), timeZone: 'Asia/Shanghai',
    grade: 'good', answerText: '用 is.na 检测缺失值', hintUsed: false, answerRevealed: false,
    variantPassed: false, assessmentSource: 'self', ...overrides,
  };
}
function queue(overrides = {}) {
  return buildReviewQueue({ cards: [], events: [], attempts: [], knowledge, now: later(1), timeZone: 'Asia/Shanghai', limit: 6, ...overrides });
}

export function runAlgorithmTests() {
  test('新卡保持0级，首次检测精确延后24小时，输入保持不变', () => {
    const card = createCard('K06', 'concept', START);
    assert.equal(card.stage, 0);
    assert.equal(card.state, 'new');
    assert.equal(card.dueAt, later(1));
    assert.equal(card.lastReviewedAt, null);
    assert.equal(queue({ cards: [card], now: later(0, 1439) }).length, 0);
    assert.equal(queue({ cards: [card] }).length, 1);
    const before = JSON.stringify(card);
    scheduleReview(card, attempt(), []);
    assert.equal(JSON.stringify(card), before);
  });
  test('again / hinted / good / easy 覆盖全部六级间隔和上下边界', () => {
    for (let stage = 0; stage <= 5; stage += 1) {
      const card = { ...createCard('K06', 'concept', START), stage };
      const again = scheduleReview(card, attempt({ grade: 'again' }), []);
      assert.equal(again.stage, 0);
      assert.equal(again.state, 'relearning');
      assert.equal(again.dueAt, later(1, 10));
      const hinted = scheduleReview(card, attempt({ grade: 'hinted' }), []);
      assert.equal(hinted.stage, Math.max(0, stage - 1));
      assert.equal(hinted.dueAt, later(2));
      for (const grade of ['good', 'easy']) {
        const result = scheduleReview(card, attempt({ grade, variantPassed: true }), []);
        const nextStage = Math.min(5, stage + (grade === 'easy' ? 2 : 1));
        assert.equal(result.stage, nextStage);
        assert.equal(result.dueAt, later(1 + REVIEW_CONFIG.intervalDays[nextStage]));
      }
    }
  });
  test('提示与提前看答案封顶hinted，easy缺少变式降为good', () => {
    const card = { ...createCard('K06', 'concept', START), stage: 3 };
    for (const flag of ['hintUsed', 'answerRevealed']) {
      const value = attempt({ grade: 'easy', variantPassed: true, [flag]: true });
      assert.equal(effectiveGrade(value), 'hinted');
      assert.equal(scheduleReview(card, value, []).stage, 2);
    }
    assert.equal(scheduleReview(card, attempt({ grade: 'easy' }), []).stage, 4);
    assert.equal(effectiveGrade(attempt({ grade: 'again', hintUsed: true })), 'again');
  });
  test('主动加入当天通过、提前刷题与跨午夜短间隔均不能升级', () => {
    const card = { ...createCard('K06', 'concept', START), dueAt: START };
    for (const at of [START, later(0, 1439), '2026-01-01T16:01:00.000Z']) {
      const result = scheduleReview(card, attempt({ at, grade: 'easy', variantPassed: true }), []);
      assert.equal(result.stage, 0);
      assert.equal(Date.parse(result.dueAt) - Date.parse(at), DAY);
    }
  });
  test('重学当日通过后24小时检测，后续跨日独立作答升级', () => {
    const first = attempt({ grade: 'again' });
    const failed = scheduleReview(createCard('K06', 'concept', START), first, []);
    const second = attempt({ id: 'a2', at: later(1, 10) });
    const passed = scheduleReview(failed, second, [first]);
    assert.equal(passed.stage, 0);
    assert.equal(passed.dueAt, later(2, 10));
    const third = attempt({ id: 'a3', at: later(2, 10) });
    assert.equal(scheduleReview(passed, third, [first, second]).stage, 1);
  });
  test('每日每卡至多两次，连续失败转为24小时后检测', () => {
    const first = attempt({ grade: 'again' });
    const failed = scheduleReview(createCard('K06', 'concept', START), first, []);
    const second = attempt({ id: 'a2', grade: 'again', at: later(1, 10) });
    const failedAgain = scheduleReview(failed, second, [first]);
    assert.equal(failedAgain.dueAt, later(2, 10));
    assert.equal(queue({ cards: [failedAgain], attempts: [first, second], now: later(1, 30) }).length, 0);
    assert.equal(queue({ cards: [failed], attempts: [first], now: later(1, 10) }).length, 1);
    assert.equal(queue({ cards: [{ ...failedAgain, dueAt: later(1, 20) }], attempts: [first, second], now: later(1, 30) }).length, 0);
  });
  test('同题同日重复作答不升级，同ID重试幂等', () => {
    const first = attempt();
    const result = scheduleReview(createCard('K06', 'concept', START), first, []);
    assert.deepEqual(scheduleReview(result, first, [first]), result);
    const second = attempt({ id: 'a2', at: later(1, 10), grade: 'easy', variantPassed: true });
    assert.equal(scheduleReview(result, second, [first]).stage, result.stage);
  });
  test('队列最多两道首次检测题，默认6题，可设3至12，数千逾期项稳定去重', () => {
    const newCards = knowledge.map(item => createCard(item.id, 'concept', START));
    assert.equal(queue({ cards: newCards }).length, 2);
    const attempts = newCards.slice(0, 12).map((card, index) => attempt({
      id: `past-${index}`, cardId: card.id, at: START, grade: 'hinted',
    }));
    const cards = newCards.map((card, index) => index < 12 ? { ...card, state: 'review', lastReviewedAt: START } : card);
    assert.equal(queue({ cards, attempts }).length, 6);
    assert.equal(queue({ cards, attempts, limit: 12 }).length, 12);
    const many = Array.from({ length: 2000 }, (_, index) => cards[index % cards.length]);
    const result = queue({ cards: many, attempts, now: later(1000) });
    assert.equal(new Set(result.map(item => item.card.id)).size, result.length);
    assert.deepEqual(result, queue({ cards: [...many].reverse(), attempts: [...attempts].reverse(), now: later(1000) }));
    assert.throws(() => queue({ limit: 2 }), /3至12/);
  });
  test('同分按到期时间、卡ID稳定排序，错题优先与权重精确计算', () => {
    const cards = ['K07', 'K06'].map(id => createCard(id, 'concept', START));
    assert.deepEqual(queue({ cards }).map(item => item.card.id), ['K06:concept', 'K07:concept']);
    const failed = attempt({ grade: 'again', at: START });
    const result = queue({ cards, attempts: [failed] });
    assert.equal(result[0].priority, 30);
    const overdue = queue({ cards, attempts: [failed], now: later(2) });
    assert.equal(overdue[0].priority, 70);
    const enrolled = queue({ cards, events: [{ id: 'e', kind: 'enroll', knowledgeId: 'K07', at: START }] });
    assert.equal(enrolled[0].card.id, 'K07:concept');
    assert.equal(enrolled[0].priority, 10);
  });
  test('直接先修去重、循环与缺失关系保护，独立掌握证据抑制补强', () => {
    const catalog = [
      { id: 'K06', prerequisites: ['K05', 'K05', 'K06', 'K99'] },
      { id: 'K05', prerequisites: ['K06', 'K04'] }, { id: 'K04', prerequisites: [] },
    ];
    const card = createCard('K06', 'concept', START);
    const failure = attempt({ grade: 'again', at: START });
    const result = queue({ cards: [card], attempts: [failure], knowledge: catalog });
    assert.equal(result.filter(item => item.card.id === 'K05:concept').length, 1);
    assert.equal(result.some(item => item.card.id === 'K04:concept'), false);
    assert.equal(result.find(item => item.card.id === 'K05:concept').priority, 20);
    const evidence = attempt({ id: 'parent', cardId: 'K05:concept', at: START });
    assert.equal(queue({ cards: [card], attempts: [failure, evidence], knowledge: catalog }).length, 1);
    const hinted = { ...evidence, hintUsed: true };
    assert.equal(queue({ cards: [card], attempts: [failure, hinted], knowledge: catalog }).length, 2);
    const futureParent = { ...createCard('K05', 'concept', START), dueAt: later(10) };
    assert.equal(queue({ cards: [card, futureParent], attempts: [failure, hinted], knowledge: catalog }).length, 2);
    assert.equal(futureParent.dueAt, later(10));
  });
  test('课程缺失保留任务并解释原因，跳过后继续处理其余任务', () => {
    const cards = ['K06', 'K07'].map(id => createCard(id, 'concept', START));
    const result = queue({ cards, knowledge: [] });
    assert.match(result[0].reason, /课程资料缺失/);
    const skipped = result[0].card.id;
    assert.equal(result.filter(item => item.card.id !== skipped).length, 1);
    assert.equal(queue({ cards, knowledge: [] })[0].card.id, skipped);
  });
  test('IANA时区、UTC边界与夏令时按本地自然日计数', () => {
    assert.notEqual(localDay('2026-01-01T15:59:59.000Z', 'Asia/Shanghai'), localDay('2026-01-01T16:00:00.000Z', 'Asia/Shanghai'));
    assert.equal(localDay('2026-11-01T05:30:00.000Z', 'America/New_York'), localDay('2026-11-01T06:30:00.000Z', 'America/New_York'));
    const card = { ...createCard('K06', 'concept', START), dueAt: later(1) };
    const attempts = [attempt({ id: 'x', at: '2026-01-02T15:50:00.000Z' }), attempt({ id: 'y', at: '2026-01-02T15:59:00.000Z' })];
    assert.equal(queue({ cards: [card], attempts, now: '2026-01-02T16:00:00.000Z' }).length, 1);
    assert.equal(queue({ cards: [card], attempts, now: '2026-01-02T16:00:00.000Z', timeZone: 'UTC' }).length, 0);
  });
  test('错误时间、知识编号、类型、空答案、倒序作答均拒绝', () => {
    for (const at of ['bad', '2026-02-30T08:00:00Z', '2026-01-01', '2026-01-01T08:00:00+08:00']) {
      assert.throws(() => createCard('K06', 'concept', at));
    }
    assert.throws(() => createCard('K44', 'concept', START));
    assert.throws(() => createCard('K06', 'other', START));
    assert.throws(() => normalizeAttempt(attempt({ answerText: '  ' })), /空答案/);
    assert.doesNotThrow(() => normalizeAttempt(attempt({ answerText: '', grade: 'again' })));
    assert.throws(() => normalizeAttempt(attempt({ timeZone: 'invalid' })));
    assert.throws(() => normalizeAttempt(attempt({ timeZone: '+08:00' })));
    assert.throws(() => normalizeAttempt(attempt({ hintUsed: 1 })));
    assert.throws(() => scheduleReview(createCard('K06', 'concept', START), attempt({ at: later(-1) }), []));
    assert.throws(() => queue({ cards: [{ ...createCard('K06', 'concept', START), dueAt: 'bad' }] }));
  });
}

// Run through the repository's Playwright CLI run-code entry point. No fake IndexedDB is used.
export async function runBrowserTests(page, baseUrl = 'http://127.0.0.1:8765', browserName = 'chromium') {
  const context = await page.context().browser().newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  const errors = [];
  first.on('pageerror', error => errors.push(error.message));
  second.on('pageerror', error => errors.push(error.message));
  try {
    await first.goto(`${baseUrl}/offline-course.json`);
    const checks = await first.evaluate(async () => {
      const { learningStore: store } = await import('/static/learning-store.js?v=learning-v1');
      window.coreStore = store;
      const checks = [];
      const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
      const stable = value => JSON.stringify(value);
      await store.ready();
      await store.resetLearningData();
      const at = '2026-01-01T08:00:00.000Z';
      const record = (index, task = 'concept') => ({
        time: at, request: { question: `问题${index}`, knowledge_id: 'K06', task_type: task, history: ['secret'], api_key: 'secret' },
        response: { request_id: `r${index}`, status: 'ok', task_type: task, related_knowledge: ['K06', 'K07'],
          answer: { summary: '答案', steps: ['解释'], extra: 'secret' }, citations: [{ knowledge_id: 'K07', raw: '来源' }], secret: 'secret' },
      });
      const legacy = Array.from({ length: 125 }, (_, index) => record(index));
      localStorage.setItem('r-tutor-mock-v1', JSON.stringify(legacy));
      const migrated = await store.migrateLegacy(JSON.parse(localStorage.getItem('r-tutor-mock-v1')));
      check(migrated.imported === 125, '迁移完整125条历史');
      check((await store.migrateLegacy(legacy)).imported === 0, '重复迁移幂等');
      let snapshot = await store.snapshot();
      check(!stable(snapshot).includes('secret'), '对话字段白名单');
      check(snapshot.cards.length === 2 && snapshot.events.every(event => event.knowledgeId === 'K06'), '仅主要知识点建立两类卡与行为证据');
      check(snapshot.cards.every(card => card.dueAt === '2026-01-02T08:00:00.000Z'), '讲解后24小时检测');
      const anonymous = record('anonymous');
      delete anonymous.response.request_id;
      const anonymousId = await store.ingestConversation(anonymous);
      const repeatedId = await store.ingestConversation({ ...anonymous, extra: 'discarded' });
      check(anonymousId.conversationId === repeatedId.conversationId && anonymousId.conversationId.startsWith('legacy:'), '无请求ID的旧对话按白名单内容SHA256稳定去重');
      check((await store.migrateLegacy([null, { time: at }])).imported === 0, '旧记录迁移跳过无效条目');
      await store.ingestConversation(record('exercise', 'exercise'));
      await store.ingestConversation(record('debug', 'debug'));
      await store.recordVisit('K07', at);
      snapshot = await store.snapshot();
      check(['view', 'study', 'exercise_view', 'debug'].every(kind => snapshot.events.some(event => event.kind === kind)), '浏览、讲解、练习与纠错行为分开记录');
      await store.enroll('K06', at);
      await store.enroll('K06', '2026-01-02T08:00:00.000Z');
      snapshot = await store.snapshot();
      check(snapshot.cards.every(card => card.dueAt === at) && snapshot.events.filter(event => event.kind === 'enroll').length === 1, '主动加入当前任务且重复加入幂等');
      window.coreAttempt = { id: 'attempt-1', cardId: 'K06:concept', questionId: 'K06-concept-01', at: '2026-01-02T08:00:00.000Z',
        timeZone: 'Asia/Shanghai', grade: 'easy', answerText: '回答', hintUsed: true, answerRevealed: false, variantPassed: true, assessmentSource: 'self' };
      const saved = await store.saveAttempt(window.coreAttempt);
      check(saved.card.stage === 0, '真实存储按提示后有效评级排程');
      check(stable(await store.saveAttempt({ id: 'attempt-1' })) === stable(saved), '同作答ID返回已保存结果');
      await store.saveSettings({ dailyLimit: 9 });
      const course = await (await fetch('/offline-course.json')).json();
      await store.saveCourse(course);
      const row = (await store.snapshot()).conversations[0];
      await store.saveBookmark({ id: `conversation:${row.id}`, knowledgeId: 'K06', conversationId: row.id, title: '回答', note: '难点', createdAt: at, updatedAt: at });
      await store.saveBookmark({ id: 'knowledge:K06', knowledgeId: 'K06', conversationId: null, title: '知识', note: '备注', createdAt: at, updatedAt: at });
      const archive = await store.exportArchive();
      window.coreArchive = archive;
      check(archive.app === 'r-language-tutor' && archive.schemaVersion === 1 && !('course' in archive.data) && archive.data.settings.dailyLimit === 9, '完整档案含设置并记录课程版本');
      const before = stable(await store.snapshot());
      const result = await store.importArchive(archive);
      const duplicateCount = ['conversations', 'events', 'attempts', 'bookmarks'].reduce((count, key) => count + archive.data[key].length, 0);
      check(result.imported === 0 && result.duplicates === duplicateCount && stable(await store.snapshot()) === before, '档案重复导入计数与排程重算幂等');
      const invalids = [
        value => { value.app = 'other'; }, value => { value.schemaVersion = 2; },
        value => { value.data.events[0].knowledgeId = 'K99'; }, value => { value.data.attempts[0].at = 'invalid'; },
        value => { value.data.settings.dailyLimit = '6'; }, value => { value.data.attempts[0].hintUsed = 1; },
        value => { value.data.cards[0].stage = 6; }, value => { value.data.events = Array(200001).fill({}); },
        value => { value.data.bookmarks[0].note = 'x'.repeat(20001); },
        value => { value.padding = 'x'.repeat(20 * 1024 * 1024); },
      ];
      for (const change of invalids) {
        const invalid = structuredClone(archive);
        change(invalid);
        let rejected = false;
        try { await store.importArchive(invalid); } catch { rejected = true; }
        check(rejected && stable(await store.snapshot()) === before, '损坏档案校验拒绝且保留原数据');
      }
      const conflict = structuredClone(archive);
      conflict.data.events[0].at = '2026-01-01T09:00:00.000Z';
      let rejected = false;
      try { await store.importArchive(conflict); } catch { rejected = true; }
      check(rejected && stable(await store.snapshot()) === before, '事件ID冲突事务回滚');
      const originalPut = IDBObjectStore.prototype.put;
      let writes = 0;
      IDBObjectStore.prototype.put = function (...args) {
        writes += 1;
        if (writes === 2) throw new Error('模拟中途写入失败');
        return originalPut.apply(this, args);
      };
      rejected = false;
      try { await store.enroll('K08', at); } catch { rejected = true; }
      finally { IDBObjectStore.prototype.put = originalPut; }
      check(rejected && writes === 2 && stable(await store.snapshot()) === before, '原生IndexedDB中途失败原子回滚');
      await store.clearConversations();
      snapshot = await store.snapshot();
      check(snapshot.conversations.length === 0 && snapshot.bookmarks.length === 1 && snapshot.attempts.length === 1 && snapshot.events.length > 0, '清空对话及回答收藏，保留知识收藏与学习档案');
      await store.resetLearningData();
      snapshot = await store.snapshot();
      check(snapshot.course.version === course.version && snapshot.settings.dailyLimit === 6 && snapshot.cards.length === 0, '重置学习数据并保留课程离线包');
      await store.importArchive(archive);
      const restored = await store.snapshot();
      check(restored.attempts.length === archive.data.attempts.length && restored.attempts[0].id === 'attempt-1', '空库导入保留全部作答记录');
      check(restored.cards.find(card => card.id === 'K06:concept').dueAt === saved.card.dueAt, '空库导入按有效作答恢复排程');
      const shuffled = structuredClone(archive);
      for (const key of ['conversations', 'events', 'cards', 'attempts', 'bookmarks']) shuffled.data[key].reverse();
      await store.resetLearningData();
      await store.importArchive(shuffled);
      check(stable(await store.snapshot()) === stable(restored), '导入乱序事件与作答按确定顺序重算');
      await store.resetLearningData();
      const altered = structuredClone(archive);
      altered.data.cards.forEach(card => { card.stage = 5; });
      await store.importArchive(altered);
      check(stable(await store.snapshot()) === stable(restored), '导入卡片等级由作答证据重算');
      await store.resetLearningData();
      await store.enroll('K06', at);
      const late = { ...window.coreAttempt, id: 'late', at: '2026-01-04T08:00:00.000Z', timeZone: 'America/New_York', grade: 'good', hintUsed: false };
      check((await store.saveAttempt(late)).card.stage === 1, '跨日独立作答写入后升级');
      await store.saveAttempt({ ...late, id: 'early', at: '2026-01-04T07:00:00.000Z', grade: 'again', timeZone: 'Asia/Shanghai' });
      const chronological = await store.snapshot();
      check(chronological.cards.find(card => card.id === 'K06:concept').stage === 0 && chronological.attempts[0].id === 'early', '迟到作答按UTC重排并抑制同日刷题升级');
      const mergedArchive = await store.exportArchive();
      mergedArchive.data.attempts.reverse();
      await store.resetLearningData();
      await store.importArchive(mergedArchive);
      check(stable(await store.snapshot()) === stable(chronological), '不同原始时区与多作答乱序导入排程可复现');
      const seedArchive = structuredClone(archive);
      seedArchive.data = { conversations: [], events: [], attempts: [], bookmarks: [], settings: { dailyLimit: 6 }, cards: [archive.data.cards[0]] };
      await store.resetLearningData();
      const seedImport = await store.importArchive(seedArchive);
      const seedSnapshot = await store.snapshot();
      if (seedImport.duplicates !== 0 || seedSnapshot.cards.length !== 1 || seedSnapshot.cards[0].stage !== 0) throw new Error('孤立卡片种子恢复失败');
      await store.resetLearningData();
      await store.importArchive(archive);
      return checks;
    });
    await second.goto(`${baseUrl}/offline-course.json`);
    await second.evaluate(async () => {
      const { learningStore } = await import('/static/learning-store.js?v=learning-v1');
      window.coreStore = learningStore;
      await learningStore.ready();
      window.coreChanges = 0;
      window.coreUnsubscribe = learningStore.subscribe(() => { window.coreChanges += 1; });
    });
    await first.evaluate(() => window.coreStore.enroll('K09', '2026-01-03T08:00:00.000Z'));
    await second.waitForFunction(() => window.coreChanges > 0);
    checks.push('BroadcastChannel跨标签页提交通知');
    const submitted = await first.evaluate(() => window.coreAttempt);
    const concurrent = await Promise.all([
      first.evaluate(value => window.coreStore.saveAttempt({ ...value, id: 'concurrent', at: '2026-01-03T08:00:00.000Z' }), submitted),
      second.evaluate(value => window.coreStore.saveAttempt({ ...value, id: 'concurrent', at: '2026-01-03T08:00:00.000Z' }), submitted),
    ]);
    assert.deepEqual(concurrent[0], concurrent[1]);
    assert.equal(await second.evaluate(async () => (await window.coreStore.snapshot()).attempts.filter(item => item.id === 'concurrent').length), 1);
    checks.push('双标签页同作答ID并发去重');
    await Promise.all([
      first.evaluate(() => window.coreStore.enroll('K10', '2026-01-03T08:00:00.000Z')),
      second.evaluate(() => window.coreStore.enroll('K10', '2026-01-03T08:00:00.000Z')),
    ]);
    assert.equal(await second.evaluate(async () => (await window.coreStore.snapshot()).events.filter(item => item.id === 'enroll:K10').length), 1);
    checks.push('双标签页加入复习无丢失更新');
    await first.reload();
    const restoredCount = await first.evaluate(async () => {
      const { learningStore } = await import('/static/learning-store.js?v=learning-v1');
      return (await learningStore.snapshot()).attempts.length;
    });
    assert.equal(restoredCount, 2);
    checks.push('刷新从已提交IndexedDB恢复');
    await second.close();
    const upgrade = await first.evaluate(async () => {
      const { learningStore } = await import('/static/learning-store.js?v=learning-v1');
      const open = version => new Promise((resolve, reject) => {
        const request = indexedDB.open('r-language-tutor-learning', version);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const database = await open(2);
      const names = [...database.objectStoreNames];
      database.close();
      let rejected = false;
      try { await learningStore.ready(); } catch (error) { rejected = /无法打开/.test(error.message); }
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('r-language-tutor-learning');
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
      await learningStore.ready();
      const snapshot = await learningStore.snapshot();
      return { names, rejected, empty: snapshot.events.length === 0 };
    });
    assert.equal(upgrade.names.length, 7);
    assert.equal(upgrade.rejected, true);
    assert.equal(upgrade.empty, true);
    checks.push('新库七表建表、versionchange关闭连接、更高版本拒绝及失败后重试');
    assert.deepEqual(errors, []);
    return { browserName, checks, count: checks.length };
  } finally {
    await context.close();
  }
}

// Importing this file from Playwright exposes the browser suite without starting node:test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--browser') {
    const modulePath = process.argv[3];
    const { chromium } = await import(modulePath ? pathToFileURL(modulePath).href : 'playwright');
    const browser = await chromium.launch({ headless: true, ...(process.argv[5] ? { executablePath: process.argv[5] } : {}) });
    try {
      const page = await browser.newPage();
      console.log(JSON.stringify(await runBrowserTests(page, process.argv[4]), null, 2));
    } finally { await browser.close(); }
  } else runAlgorithmTests();
}
