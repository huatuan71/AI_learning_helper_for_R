const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const server = http.createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname.slice(8);
    const isModule = request.url.startsWith('/static/');
    response.setHeader('Content-Type', isModule ? 'text/javascript' : 'text/html');
    response.end(isModule
      ? fs.readFileSync(path.join(__dirname, '../static', name))
      : '<!doctype html><title>Storage test</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });

  try {
    for (const oldVersion of [1, 2]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);

      const result = await page.evaluate(async ({ oldVersion, source }) => {
        const checks = [];
        const check = (condition, message) => {
          if (!condition) throw Error(message);
          checks.push(message);
        };
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open('r-language-tutor-learning', oldVersion);
          request.onupgradeneeded = () => {
            for (const name of [
              'conversations', 'events', 'cards', 'attempts', 'bookmarks', 'settings', 'course',
              ...(oldVersion === 2 ? ['summaries'] : []),
            ]) {
              request.result.createObjectStore(name, { keyPath: 'id' });
            }
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        database.close();

        const { learningStore: store } = await import('/static/learning-store.js');
        window.store = store;
        await store.ready();
        check((await store.snapshot()).aiExercises.length === 0, '旧版本升级空集合');

        const request = {
          schema_version: 1,
          knowledge_ids: ['K06'],
          count: 1,
          difficulty: 'basic',
          formats: ['choice'],
          recent_prompts: [],
        };
        const response = {
          status: 'ok',
          mode: 'ai',
          generation_id: 'gen:1',
          generated_at: '2026-11-17T08:00:00.000Z',
          provider: 'deepseek',
          model: 'model',
          prompt_version: 'learning-exercise-v1',
          knowledge_version: 'v1',
          questions: [{
            id: 'aiq:1',
            knowledge_ids: ['K06'],
            learning_type: 'concept',
            format: 'choice',
            difficulty: 'basic',
            prompt: 'NA检测？',
            code: '',
            choices: ['is.na(x)', 'x==NA', 'x=NULL', 'missing(x)'],
            correct_index: 0,
            hints: ['使用专用函数'],
            reference_answer: 'is.na(x)',
            solution_code: '',
            explanation: '逐元素检查缺失值',
            source_refs: source.sources.map(ref => ({
              ...ref,
              knowledge_id: source.id,
              title: source.title,
            })),
            execution_status: 'not_executed',
          }],
        };

        const forged = structuredClone(response);
        forged.questions[0].source_refs[0].file = 'forged.pdf';
        let forgedRejected = false;
        try {
          await store.saveExerciseBatch(forged, request);
        } catch {
          forgedRejected = true;
        }
        check(forgedRejected, '空课程缓存拒绝伪造来源');

        await store.saveExerciseBatch(response, request);
        await store.saveExerciseBatch(response, request);
        check((await store.listAIExercises()).length === 1, '批次幂等');
        await store.recordAIExerciseView('aiq:1');
        await store.recordAIExerciseView('aiq:1');
        check((await store.snapshot()).events.length === 1, '稳定浏览事件');

        await store.saveAIExerciseDraft('aiq:1', { selectedIndex: 0, hintUsed: true });
        await store.lockAIExercise('aiq:1');
        let question = await store.getAIExercise('aiq:1');
        check(question.draft.phase === 'locked' && question.draft.assistedAtLock, '锁定保留辅助');
        let rejected = false;
        try {
          await store.saveAIExerciseDraft(question.id, { selectedIndex: 1 });
        } catch {
          rejected = true;
        }
        check(rejected, '锁定答案固定');

        await store.saveAIExerciseDraft(question.id, { answerRevealed: true, rating: 'independent' });
        question = await store.getAIExercise(question.id);
        check(question.draft.rating === 'assisted', '辅助不能自评独立');
        const [firstAttempt, repeatedAttempt] = await Promise.all([
          store.submitAIExerciseAttempt(question.id, 'independent'),
          store.submitAIExerciseAttempt(question.id, 'need_review'),
        ]);
        check(firstAttempt.id === repeatedAttempt.id &&
          (await store.listAIExerciseAttempts()).length === 1, '重复作答提交幂等');
        check(firstAttempt.assessment_source === 'ai_reference_match' &&
          firstAttempt.referenceMatch === true, 'AI参考匹配语义');

        const archive = await store.exportArchive();
        check(archive.schemaVersion === 3, '档案版本3');
        await store.importArchive(archive);
        check((await store.listAIExerciseAttempts()).length === 1, '档案重复导入');
        for (const version of [1, 2]) {
          const legacy = structuredClone(archive);
          legacy.schemaVersion = version;
          delete legacy.data.aiExercises;
          delete legacy.data.aiExerciseAttempts;
          if (version === 1) delete legacy.data.summaries;
          await store.importArchive(legacy);
        }
        check(true, '兼容两个旧档案版本');

        const oversized = structuredClone(archive);
        oversized.padding = 'x'.repeat(20 * 1024 * 1024);
        let sizeRejected = false;
        try {
          await store.importArchive(oversized);
        } catch {
          sizeRejected = true;
        }
        check(sizeRejected, '20MiB上限拒绝');

        const before = JSON.stringify(await store.snapshot());
        const invalid = structuredClone(archive);
        invalid.data.aiExerciseAttempts[0].questionId = 'aiq:missing';
        rejected = false;
        try {
          await store.importArchive(invalid);
        } catch {
          rejected = true;
        }
        check(rejected && JSON.stringify(await store.snapshot()) === before, '无效关联原子回滚');

        for (const mutate of [
          value => { value.data.aiExercises[0].draft.at = '2026-11-17T01:00:00.000Z'; },
          value => { value.data.aiExercises[0].draft.timeZone = 'America/New_York'; },
          value => { value.data.aiExercises[0].draft.assistedAtLock = false; },
        ]) {
          const altered = structuredClone(archive);
          mutate(altered);
          let rejected = false;
          try {
            await store.importArchive(altered);
          } catch {
            rejected = true;
          }
          check(rejected, '草稿锁定快照伪造被拒绝');
        }

        const { newExerciseDraft } = await import('/static/ai-exercise-data.js');
        const crossQuestion = structuredClone(archive);
        const forgedQuestion = structuredClone(crossQuestion.data.aiExercises[0]);
        forgedQuestion.id = 'aiq:other';
        forgedQuestion.draft.phase = 'locked';
        forgedQuestion.draft.rating = null;
        crossQuestion.data.aiExercises[0].draft = newExerciseDraft();
        crossQuestion.data.aiExercises.push(forgedQuestion);
        let crossRejected = false;
        try {
          await store.importArchive(crossQuestion);
        } catch {
          crossRejected = true;
        }
        check(crossRejected, '跨题复用历史作答ID被拒绝');

        const oldAttemptId = (await store.getAIExercise(question.id)).draft.attemptId;
        await store.restartAIExercise(question.id, oldAttemptId);
        check((await store.getAIExercise(question.id)).draft.attemptId !== firstAttempt.id, '重新作答新ID');
        for (const operation of [
          () => store.saveAIExerciseDraft(question.id, { selectedIndex: 2 }, oldAttemptId),
          () => store.lockAIExercise(question.id, oldAttemptId),
          () => store.submitAIExerciseAttempt(question.id, 'need_review', oldAttemptId),
          () => store.restartAIExercise(question.id, oldAttemptId),
        ]) {
          let rejected = false;
          try {
            await operation();
          } catch {
            rejected = true;
          }
          check(rejected, '旧页面作答ID拒绝覆盖新作答');
        }
        window.archive = archive;
        window.questionId = question.id;
        return checks;
      }, {
        oldVersion,
        source: JSON.parse(fs.readFileSync(path.join(__dirname, '../data/course.json'), 'utf8'))
          .knowledge.find(item => item.id === 'K06'),
      });

      await page.reload();
      await page.evaluate(async () => {
        window.store = (await import('/static/learning-store.js')).learningStore;
        await window.store.ready();
      });
      await context.setOffline(true);
      assert.equal(await page.evaluate(async () =>
        (await window.store.listAIExercises())[0].draft.phase), 'draft');
      await context.setOffline(false);

      const second = await context.newPage();
      await second.goto(`http://127.0.0.1:${server.address().port}`);
      await second.evaluate(async () => {
        window.store = (await import('/static/learning-store.js')).learningStore;
      });
      await page.evaluate(async () => {
        await window.store.saveAIExerciseDraft('aiq:1', { selectedIndex: 1 });
        await window.store.lockAIExercise('aiq:1');
      });
      const attemptIds = await Promise.all([page, second].map(activePage =>
        activePage.evaluate(async () =>
          (await window.store.submitAIExerciseAttempt('aiq:1', 'need_review')).id)));
      assert.equal(attemptIds[0], attemptIds[1]);

      await page.evaluate(async () => {
        const store = window.store;
        const archive = await store.exportArchive();
        const template = archive.data.aiExercises[0];
        const attempt = archive.data.aiExerciseAttempts[0];
        await store.deleteAIExercise('aiq:1');
        if ((await store.listAIExerciseAttempts()).length) throw Error('级联删除失败');
        await store.resetLearningData();
        if ((await store.snapshot()).aiExercises.length) throw Error('重置失败');

        const { newExerciseDraft } = await import('/static/ai-exercise-data.js');
        archive.data.events = [];
        archive.data.cards = [];
        archive.data.aiExercises = Array.from({ length: 200 }, (_, index) => ({
          ...template,
          id: 'aiq:capacity:' + index,
          draft: newExerciseDraft(),
        }));
        archive.data.aiExerciseAttempts = Array.from({ length: 2000 }, (_, index) => ({
          ...attempt,
          id: 'capacity:' + index,
          questionId: 'aiq:capacity:0',
        }));
        await store.importArchive(archive);

        const before = JSON.stringify(await store.snapshot());
        const overflowArchive = structuredClone(archive);
        overflowArchive.data.aiExercises = [{
          ...template,
          id: 'aiq:capacity:overflow',
          draft: newExerciseDraft(),
        }];
        overflowArchive.data.aiExerciseAttempts = [];
        let rejected = false;
        try {
          await store.importArchive(overflowArchive);
        } catch {
          rejected = true;
        }
        if (!rejected || JSON.stringify(await store.snapshot()) !== before) {
          throw Error('200题容量未原子拒绝');
        }
        await store.saveAIExerciseDraft('aiq:capacity:0', { selectedIndex: 0 });
        await store.lockAIExercise('aiq:capacity:0');
        rejected = false;
        try {
          await store.submitAIExerciseAttempt('aiq:capacity:0', 'independent');
        } catch {
          rejected = true;
        }
        if (!rejected || (await store.listAIExerciseAttempts()).length !== 2000 ||
            (await store.getAIExercise('aiq:capacity:0')).draft.phase !== 'locked') {
          throw Error('2000作答容量未原子拒绝');
        }
        await store.resetLearningData();
      });
      console.log(JSON.stringify({
        oldVersion,
        checks: [
          ...result,
          '刷新离线读取',
          '双标签页幂等',
          '级联删除与重置',
          '200题和2000作答容量原子拒绝',
        ],
      }));
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
