// Isolated Chromium/WebKit storage acceptance against the actual browser-native modules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function run(browser, baseUrl) {
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  const errors = [];
  first.on('pageerror', error => errors.push(error.message));
  try {
    await first.goto(baseUrl);
    // Create a genuine version-1 database before the new store module is imported.
    await first.evaluate(async () => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('r-language-tutor-learning', 1);
        request.onupgradeneeded = () => {
          for (const name of ['conversations', 'events', 'cards', 'attempts', 'bookmarks', 'settings', 'course']) {
            request.result.createObjectStore(name, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const tx = database.transaction(['events', 'settings'], 'readwrite');
        tx.objectStore('events').put({ id: 'legacy-view', kind: 'view', knowledgeId: 'K06', at: '2026-11-17T08:00:00.000Z' });
        tx.objectStore('settings').put({ id: 'current', value: { dailyLimit: 9 } });
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
      database.close();
    });
    const checks = await first.evaluate(async () => {
      const { learningStore: store } = await import('/static/learning-store.js?v=learning-v1');
      const data = await import('/static/learning-summary-data.js?v=ai-summary-v1');
      window.summaryStore = store;
      const checks = [];
      const check = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
      const stable = data.canonicalSummaryJSON;
      const period = { start_date: '2026-11-17', end_date: '2026-11-17', time_zone: 'Asia/Shanghai' };
      const config = { provider: 'deepseek', model: 'deepseek-chat', prompt_version: data.PROMPT_VERSION };
      const response = (input, generated_at = '2026-11-17T10:00:00.000Z', overview = '本期浏览了缺失值知识。') => ({
        request_id: 'summary-test', status: 'ok', mode: 'ai', ...config, input_fingerprint: input.input_fingerprint,
        generated_at, period: input.period, coverage: input.coverage, usage: { input_tokens: 123, output_tokens: 45, total_tokens: 168 }, duration_ms: 50,
        summary: { overview, topics: [{ knowledge_id: 'K06', observation: '记录表明浏览过知识点。', evidence_ids: [input.evidence[0].id] }],
          review_priorities: [], next_actions: [{ knowledge_id: 'K06', action: '完成一次独立检测', reason: '本期只有浏览证据。', evidence_ids: [input.evidence[0].id] }],
          uncertainties: ['掌握程度仍需检测。'] },
      });
      window.summaryPeriod = period;
      window.summaryConfig = config;
      window.summaryResponse = response;
      await store.ready();
      let snap = await store.snapshot();
      check(snap.events.length === 1 && snap.settings.dailyLimit === 9 && snap.summaries.length === 0, 'v1真实数据库升级v3保留旧事件与设置');
      let input = await data.buildSummaryInput(snap, period);
      window.summaryInput = input;
      const saved = await store.saveSummary(response(input), input);
      check(saved.id.startsWith('summary:') && saved.id.length === 72, '缓存ID由完整缓存键SHA256稳定生成');
      check(stable(await store.getSummary(saved.id)) === stable(saved), '按ID读取有效总结');
      check((await store.findSummary(input, config)).id === saved.id, '完全匹配缓存命中');
      check(await store.findSummary(input, { ...config, model: 'other' }) === null, '切换模型使缓存失配');
      check(!('text' in saved.evidence[0]) && !stable(saved).includes('signals'), '缓存仅保留定位元数据');
      const newer = await store.saveSummary(response(input, '2026-11-17T10:01:00.000Z', '更新总结'), input);
      check(newer.id === saved.id && (await store.listSummaries()).length === 1 && newer.response.summary.overview === '更新总结', '重新生成在同一稳定ID原子更新');
      await store.saveSummary(response(input), input);
      check((await store.getSummary(saved.id)).generated_at === newer.generated_at, '迟到旧响应不覆盖较新结果');
      const before = stable(await store.snapshot());
      for (const mutate of [
        value => { value.status = 'error'; },
        value => { value.summary.topics[0].evidence_ids = ['e:forged']; },
        value => { value.summary.topics[0].knowledge_id = 'K07'; },
        value => { value.summary.overview = 'x'.repeat(1201); },
        value => { value.input_fingerprint = 'a'.repeat(64); },
        value => { value.usage.output_tokens = -1; },
      ]) {
        const invalid = response(input); mutate(invalid);
        let rejected = false;
        try { await store.saveSummary(invalid, input); } catch { rejected = true; }
        check(rejected && stable(await store.snapshot()) === before, '错误总结或伪造引用保持已有缓存');
      }
      const privateFields = response(input, '2026-11-17T10:02:00.000Z');
      privateFields.secret = 'unwanted-private-value';
      privateFields.summary.secret = 'unwanted-private-value';
      const normalized = await store.saveSummary(privateFields, input);
      check(!stable(normalized).includes('unwanted-private-value'), '总结响应字段白名单剔除未知数据');
      const unicode = response(input, '2026-11-17T10:03:00.000Z');
      unicode.summary.overview = '😀'.repeat(1200);
      unicode.summary.topics[0].observation = '😀'.repeat(600);
      check((await store.saveSummary(unicode, input)).response.summary.overview === unicode.summary.overview, '总结文本按Unicode码点支持1200与600个emoji边界');
      const unicodeBefore = stable(await store.snapshot());
      for (const invalidText of ['😀'.repeat(1201), 'bad\uD800']) {
        const invalid = response(input); invalid.summary.overview = invalidText;
        let rejected = false; try { await store.saveSummary(invalid, input); } catch { rejected = true; }
        check(rejected && stable(await store.snapshot()) === unicodeBefore, '超长码点或孤立代理项拒绝并保留缓存');
      }
      await store.saveSummary(privateFields, input);
      const archive = await store.exportArchive();
      check(archive.schemaVersion === 3 && archive.data.summaries.length === 1, 'v3完整档案导出保留总结');
      await store.resetLearningData();
      check((await store.snapshot()).summaries.length === 0, '重置档案清除全部总结');
      await store.importArchive(archive);
      check(stable((await store.snapshot()).summaries) === stable(archive.data.summaries), 'v3完整档案恢复总结');
      const repeated = await store.importArchive(archive);
      check(repeated.imported === 0 && (await store.listSummaries()).length === 1, '重复导入稳定去重');
      const older = structuredClone(archive);
      older.data.summaries[0].generated_at = '2026-11-17T09:00:00.000Z';
      older.data.summaries[0].response.generated_at = older.data.summaries[0].generated_at;
      await store.importArchive(older);
      check((await store.listSummaries())[0].generated_at === unicode.generated_at, '导入同ID总结保留较晚生成结果');
      const tieA = structuredClone(archive); const tieB = structuredClone(archive);
      tieA.data.summaries[0].response.summary.overview = 'A';
      tieB.data.summaries[0].response.summary.overview = 'B';
      await store.resetLearningData(); await store.importArchive(tieA); await store.importArchive(tieB);
      const tied = stable((await store.snapshot()).summaries);
      await store.resetLearningData(); await store.importArchive(tieB); await store.importArchive(tieA);
      check(stable((await store.snapshot()).summaries) === tied, '时间相同按归一化内容确定顺序');
      const legacy = structuredClone(archive); legacy.schemaVersion = 1; delete legacy.data.summaries;
      await store.resetLearningData(); await store.importArchive(legacy);
      check((await store.snapshot()).events.length === 1 && (await store.snapshot()).summaries.length === 0, 'v1旧档案导入按空总结处理');
      await store.importArchive(archive);
      const preserved = stable(await store.snapshot());
      for (const mutate of [value => { delete value.data.summaries; }, value => { value.data.summaries[0].id = 'summary:forged'; },
        value => { value.data.summaries[0].response.summary.topics[0].evidence_ids = ['e:forged']; },
        value => { value.data.summaries[0].period.time_zone = 'UTC'; }, value => { value.data.summaries[0].response.usage = null; },
        value => { value.data.summaries[0].evidence[0].at = '2026-11-01T08:00:00.000Z'; },
        value => { value.data.summaries[0].response.coverage.policy_version = 'unknown'; },
        value => { value.data.summaries[0].response.duration_ms = 1.2; },
        value => { value.data.summaries[0].response.generated_at = '2026-02-30T00:00:00.000Z'; }]) {
        const invalid = structuredClone(archive); mutate(invalid);
        let rejected = false; try { await store.importArchive(invalid); } catch { rejected = true; }
        check(rejected && stable(await store.snapshot()) === preserved, '损坏新档案拒绝且保留原数据');
      }
      const originalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new Error('模拟存储失败'); };
      let rejected = false;
      try { await store.saveSummary(response(input, '2026-11-17T11:00:00.000Z'), input); } catch { rejected = true; }
      finally { IDBObjectStore.prototype.put = originalPut; }
      check(rejected && stable(await store.snapshot()) === preserved, '总结保存写入失败原子回滚');
      await store.clearConversations();
      check((await store.listSummaries()).length === 1, '清空对话保留仅事件来源的总结');
      await store.ingestConversation({ time: '2026-11-17T08:00:00.000Z', request: { question: 'NA是什么', knowledge_id: 'K06' },
        response: { request_id: 'source-chat', status: 'ok', related_knowledge: ['K06'], answer: { summary: 'NA表示缺失' } } });
      input = await data.buildSummaryInput(await store.snapshot(), period);
      const chatResponse = response(input, '2026-11-17T12:00:00.000Z');
      const source = input.evidence.find(item => item.kind === 'conversation');
      chatResponse.summary.topics[0].evidence_ids = [source.id];
      await store.saveSummary(chatResponse, input);
      await store.clearConversations();
      check((await store.listSummaries()).length === 1, '清空对话同事务删除引用对话的总结');
      let lateRejected = false;
      try { await store.saveSummary(chatResponse, input); } catch { lateRejected = true; }
      check(lateRejected && (await store.listSummaries()).length === 1, '清空对话后迟到响应不可重新保存已删除来源');
      // Missing historic evidence remains readable after archive restore.
      const orphan = structuredClone(archive); orphan.data.events = [];
      await store.resetLearningData(); await store.importArchive(orphan);
      check((await store.listSummaries()).length === 1 && (await store.snapshot()).events.length === 0, '历史总结原始记录缺失时仍可读取');
      await store.importArchive(archive);
      await store.deleteSummary(saved.id);
      check(await store.getSummary(saved.id) === null, '删除指定总结');
      await store.importArchive(archive);
      window.summaryArchive = archive;
      const pendingInput = structuredClone(window.summaryInput);
      await store.resetLearningData();
      lateRejected = false;
      try { await store.saveSummary(response(pendingInput), pendingInput); } catch { lateRejected = true; }
      check(lateRejected && (await store.listSummaries()).length === 0, '重置档案后迟到响应不可恢复已清除总结');
      await store.importArchive(archive);
      // Cap independent cache entries and retain the newest 100.
      for (let index = 0; index < 101; index += 1) {
        const distinct = structuredClone(window.summaryInput);
        distinct.input_fingerprint = index.toString(16).padStart(64, '0');
        const generated = new Date(Date.parse('2026-11-18T00:00:00.000Z') + index * 1000).toISOString();
        await store.saveSummary(response(distinct, generated), distinct);
      }
      const recent = await store.listSummaries();
      check(recent.length === 100 && recent[0].generated_at === '2026-11-18T00:01:40.000Z' && recent.at(-1).generated_at === '2026-11-18T00:00:01.000Z', '总结最多100条并按生成时间保留最近结果');
      await store.resetLearningData(); await store.importArchive(archive);
      return checks;
    });
    await second.goto(baseUrl);
    await second.evaluate(async () => {
      const { learningStore } = await import('/static/learning-store.js?v=learning-v1');
      window.summaryStore = learningStore;
      await learningStore.ready();
      window.summaryChanges = 0;
      learningStore.subscribe(() => { window.summaryChanges += 1; });
    });
    await first.evaluate(async () => {
      const input = window.summaryInput;
      await window.summaryStore.saveSummary(window.summaryResponse(input, '2026-11-19T00:00:00.000Z'), input);
    });
    await second.waitForFunction(() => window.summaryChanges > 0);
    checks.push('总结保存向第二标签页发送变更通知');
    await Promise.all([
      first.evaluate(() => window.summaryStore.saveSummary(window.summaryResponse(window.summaryInput, '2026-11-20T00:00:00.000Z'), window.summaryInput)),
      second.evaluate(async () => {
        const snap = await window.summaryStore.snapshot();
        const saved = snap.summaries[0];
        const response = { ...saved.response, generated_at: '2026-11-21T00:00:00.000Z' };
        await window.summaryStore.saveSummary(response, { input_fingerprint: saved.input_fingerprint, period: saved.period,
          coverage: saved.response.coverage, evidence: saved.evidence });
      }),
    ]);
    assert.equal(await first.evaluate(async () => (await window.summaryStore.listSummaries())[0].generated_at), '2026-11-21T00:00:00.000Z');
    checks.push('双标签页同缓存并发更新保留较新响应');
    await first.reload();
    await first.evaluate(async () => {
      window.summaryStore = (await import('/static/learning-store.js?v=learning-v1')).learningStore;
      await window.summaryStore.ready();
    });
    await context.setOffline(true);
    assert.equal(await first.evaluate(async () => (await window.summaryStore.listSummaries()).length), 1);
    checks.push('刷新后的离线IndexedDB总结读取');
    await context.setOffline(false);
    assert.deepEqual(errors, []);
    return { browser: browser.version(), count: checks.length, checks };
  } finally { await context.close(); }
}

async function blockedMigration(browser, baseUrl) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(baseUrl);
    return await page.evaluate(async () => {
      const old = await new Promise(resolve => {
        const request = indexedDB.open('r-language-tutor-learning', 1);
        request.onsuccess = () => resolve(request.result);
      });
      const { learningStore } = await import('/static/learning-store.js?v=learning-v1');
      let blocked = false;
      try { await learningStore.ready(); } catch (error) { blocked = /关闭旧页面后重试/.test(error.message); }
      old.close();
      await learningStore.ready();
      return blocked && (await learningStore.snapshot()).summaries.length === 0;
    });
  } finally { await context.close(); }
}

async function main() {
  const modules = ['learning-store.js', 'learning-summary-data.js', 'review-scheduler.js', 'ai-exercise-data.js'];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/static/') && modules.includes(url.pathname.slice(8))) {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      response.end(fs.readFileSync(path.join(__dirname, '../static', url.pathname.slice(8))));
    } else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Isolated storage test</title>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await (process.env.BROWSER === 'webkit' ? webkit : chromium).launch({ headless: true });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const result = await run(browser, baseUrl);
    assert.equal(await blockedMigration(browser, baseUrl), true);
    result.checks.push('旧标签页阻塞升级后关闭并成功重试');
    result.count += 1;
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}

module.exports = { run };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
