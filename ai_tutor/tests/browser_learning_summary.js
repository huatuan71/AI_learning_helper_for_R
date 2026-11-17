/* Run with BASE_URL pointing at browser_fixture_server.py. Upstream traffic is mocked there. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function run(page, baseUrl, outputDir) {
  const checks = [];
  const check = (value, label) => {assert.ok(value, label); checks.push(label);};
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const store = fn => page.evaluate(async source => {
    const {learningStore} = await import('/static/learning-store.js?v=learning-v1');
    return (new Function('store', 'return (' + source + ')(store)'))(learningStore);
  }, fn.toString());
  const snapshot = () => store(store => store.snapshot());
  const ready = async () => {
    await page.waitForFunction(() => document.body.dataset.learningReady === 'true');
    await page.locator('#ai-summary-input').waitFor({state:'attached'});
  };
  const summary = async () => {
    await page.evaluate(() => {location.hash = '/history/summary';});
    await ready();
  };
  const reload = async () => {await page.reload(); await ready();};
  const configure = async (model = 'deepseek-chat') => {
    const response = await page.context().request.put(baseUrl + '/api/ai/config', {data:{mode:'ai', provider:'deepseek', model, api_key:'browser-summary-test-key', max_output_tokens:4096}});
    check(response.ok(), 'fixture model configured');
    await reload();
  };
  const waitSaved = async count => page.waitForFunction(async count => {
    const {learningStore} = await import('/static/learning-store.js?v=learning-v1');
    return (await learningStore.snapshot()).summaries.length === count;
  }, count);
  await page.goto(baseUrl + '/#/history/summary');
  await ready();
  await store(store => store.resetLearningData());
  await reload();
  await page.locator('#ai-summary-generate').click();
  await page.getByText('这段时间还没有可用于总结的学习记录。', {exact:true}).waitFor();
  check((await snapshot()).summaries.length === 0, 'empty range generates no saved summary');

  await store(async store => {
    const at = new Date().toISOString();
    await store.ingestConversation({time:at, request:{question:'如何判断NA？', task_type:'concept', knowledge_id:'K06'},
      response:{request_id:'browser-summary-conversation', status:'ok', mode:'mock', task_type:'concept', related_knowledge:['K06'],
        answer:{summary:'使用is.na检查缺失值。', steps:[], issues:[], follow_ups:[]}, citations:[]}});
  });
  await reload();
  await page.locator('#ai-summary-generate').click();
  await page.locator('#model-dialog').waitFor({state:'visible'});
  check(await page.locator('#model-mode').evaluate(node => node === document.activeElement), 'unconfigured model opens keyboard-focused settings');
  await page.locator('#model-close').click();
  await configure();

  await page.locator('.lc-ai-preview>summary').click();
  const preview = JSON.parse(await page.locator('#ai-summary-input').textContent());
  check(preview.evidence.length > 0 && preview.input_fingerprint.length === 64, 'preview displays actual normalized evidence and fingerprint');
  const requestPromise = page.waitForRequest(request => request.url().endsWith('/api/learning/summary') && request.method() === 'POST');
  await page.locator('#ai-summary-generate').click();
  const actual = (await requestPromise).postDataJSON();
  check(JSON.stringify(preview) === JSON.stringify(actual), 'preview and request use the same input');
  await waitSaved(1);
  await page.locator('#learning-ai-summary h3').first().waitFor();
  check((await page.locator('#learning-ai-summary').textContent()).includes('DeepSeek'), 'real HTTP and MockTransport chain renders provider metadata');
  check((await snapshot()).summaries[0].response.status === 'ok', 'validated response persists in IndexedDB');
  const originalText = await page.locator('#learning-ai-summary').textContent();
  const saved = (await snapshot()).summaries[0];
  check(saved.evidence.every(item => !Object.hasOwn(item, 'text')), 'saved evidence contains location metadata');
  await page.screenshot({path:path.join(outputDir, 'ai-summary-desktop.png'), fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(outputDir, 'ai-summary-mobile.png'), fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await reload();
  check((await page.locator('#learning-ai-summary').textContent()).includes(saved.response.summary.overview), 'refresh restores saved summary');
  check(await page.locator('#ai-summary-generate').textContent() === '重新生成', 'cached result offers explicit regeneration');
  const clearedConfig = await page.context().request.delete(baseUrl + '/api/ai/config');
  check(clearedConfig.ok(), 'fixture model configuration clears');
  await reload();
  check((await page.locator('#learning-ai-summary').textContent()).includes(saved.response.summary.overview), 'clearing model configuration preserves saved summary');
  await configure();

  await page.evaluate(() => {
    window.summaryCopies = [];
    Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async text => window.summaryCopies.push(text)}});
  });
  await page.getByRole('button', {name:'复制总结', exact:true}).click();
  check(await page.evaluate(() => window.summaryCopies[0].includes('来源') && window.summaryCopies[0].includes('DeepSeek')), 'copy includes summary metadata and evidence locations');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name:'导出AI总结', exact:true}).click();
  const download = await downloadPromise;
  const filename = path.join(outputDir, 'ai-summary-export.txt');
  await download.saveAs(filename);
  check(fs.readFileSync(filename, 'utf8').includes(saved.response.summary.overview), 'AI summary exports as readable text');
  const reportPromise = page.waitForEvent('download');
  await page.getByRole('button', {name:'导出文本周报', exact:true}).click();
  const report = await reportPromise;
  await report.saveAs(path.join(outputDir, 'weekly-with-ai.txt'));
  check(fs.readFileSync(path.join(outputDir, 'weekly-with-ai.txt'), 'utf8').includes('AI学习总结'), 'weekly report includes current AI summary');
  await page.evaluate(() => {window.print = () => {window.summaryPrinted = true;};});
  await page.getByRole('button', {name:'打印', exact:true}).click();
  check(await page.evaluate(() => window.summaryPrinted), 'print entry remains available');

  let calls = 0;
  let responseMode = 'failure';
  let pending;
  let pendingStarted;
  const pendingResponse = () => new Promise(resolve => {pending = resolve; pendingStarted?.();});
  const handler = async route => {
    calls++;
    const input = route.request().postDataJSON();
    if (responseMode === 'failure') {
      await route.fulfill({status:503, json:{error:{code:'NETWORK_ERROR',message:'测试网络故障'}}});
      return;
    }
    if (responseMode === 'expired') {
      await route.fulfill({status:409, json:{error:{code:'SESSION_EXPIRED',message:'测试会话过期'}}});
      return;
    }
    if (responseMode === 'required') {
      await route.fulfill({status:409, json:{error:{code:'CONFIG_REQUIRED',message:'测试模型配置缺失'}}});
      return;
    }
    if (responseMode === 'invalid') {
      await route.fulfill({status:502, json:{error:{code:'STRUCTURED_OUTPUT_INVALID',message:'测试输出格式错误'}}});
      return;
    }
    const mode = responseMode;
    if (mode === 'delayed') await pendingResponse();
    const evidence = input.evidence.find(item => item.kind === 'conversation' && item.knowledge_ids.includes('K06'));
    const response = structuredClone(saved.response);
    Object.assign(response, {request_id:'browser-summary-' + calls, generated_at:new Date().toISOString(),
      input_fingerprint:input.input_fingerprint, period:input.period, coverage:input.coverage});
    response.summary.topics = [{knowledge_id:'K06', observation:'<img src=x onerror=window.summaryAttack=true> 安全文本', evidence_ids:[evidence.id]}];
    response.summary.review_priorities = [];
    response.summary.next_actions = [];
    try {await route.fulfill({json:response});} catch { /* A cancelled browser request has already closed. */ }
  };
  await page.route('**/api/learning/summary', handler);
  await page.locator('#ai-summary-generate').click();
  await page.getByText('测试网络故障', {exact:true}).waitFor();
  check((await page.locator('#learning-ai-summary').textContent()) === originalText, 'failed regeneration preserves previous summary');
  check(await page.locator('#ai-summary-generate').isEnabled(), 'failure restores generation button');
  responseMode = 'invalid';
  await page.locator('#ai-summary-generate').click();
  await page.getByText('测试输出格式错误', {exact:true}).waitFor();
  check((await snapshot()).summaries.length === 1, 'format failure keeps saved result');
  responseMode = 'required';
  await page.locator('#ai-summary-generate').click();
  await page.getByText('测试模型配置缺失', {exact:true}).first().waitFor();
  await page.locator('#ai-summary-configure').click();
  await page.locator('#model-dialog').waitFor({state:'visible'});
  check(await page.locator('#model-dialog').isVisible(), 'CONFIG_REQUIRED response offers model settings');
  await page.locator('#model-close').click();
  responseMode = 'expired';
  await page.locator('#ai-summary-generate').click();
  await page.getByText('测试会话过期', {exact:true}).first().waitFor();
  await page.locator('#ai-summary-configure').waitFor({state:'visible'});
  await page.locator('#ai-summary-configure').click();
  await page.locator('#model-dialog').waitFor({state:'visible'});
  check(await page.locator('#model-dialog').isVisible(), 'expired configuration offers model settings');
  await page.locator('#model-close').click();
  responseMode = 'delayed';
  const callsBefore = calls;
  let started = new Promise(resolve => {pendingStarted = resolve;});
  await page.locator('#ai-summary-generate').click();
  await started;
  await page.locator('#ai-summary-cancel').waitFor({state:'visible'});
  check(await page.locator('#ai-summary-generate').isDisabled(), 'duplicate generation is disabled');
  await page.locator('#ai-summary-cancel').click();
  await page.getByText('已取消，可以再次生成。', {exact:true}).waitFor();
  pending?.();
  check(calls === callsBefore + 1 && (await snapshot()).summaries.length === 1, 'cancel keeps the previous cache and only sends one request');

  await store(store => store.recordVisit('K06'));
  await page.locator('.lc-ai-stale').waitFor();
  check((await page.locator('.lc-ai-stale').textContent()).includes('先前的记录'), 'new evidence marks the summary as stale');
  started = new Promise(resolve => {pendingStarted = resolve;});
  await page.locator('#ai-summary-generate').click();
  await started;
  await page.locator('#ai-summary-cancel').waitFor({state:'visible'});
  await page.locator('#summary-period').selectOption('custom');
  await page.getByLabel('开始日期', {exact:true}).fill('2000-01-01');
  await page.getByLabel('结束日期', {exact:true}).fill('2000-01-02');
  await ready();
  check(await page.locator('#learning-ai-summary h3').count() === 0, 'range change hides the unrelated summary');
  pending?.();
  await waitSaved(2);
  check(await page.locator('#learning-ai-summary h3').count() === 0, 'late result is saved under its original period');
  await page.locator('#summary-period').selectOption('week');
  await ready();
  await page.getByText('<img src=x onerror=window.summaryAttack=true> 安全文本', {exact:true}).waitFor();
  check(await page.evaluate(() => !window.summaryAttack && !document.querySelector('#learning-ai-summary img')), 'model content renders as safe text');
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(outputDir, 'ai-summary-safety-desktop.png'), fullPage:true});
  await page.locator('.lc-ai-source summary').first().click();
  const original = await snapshot();
  const source = original.summaries.find(item => item.input_fingerprint !== saved.input_fingerprint)?.evidence[0];
  check(source && await page.locator('.lc-ai-source[open]').count() > 0, 'evidence location is keyboard-operable disclosure');
  await page.locator('.lc-ai-source[open]').getByRole('button', {name:'返回对话', exact:true}).click();
  await page.waitForURL('**/#/chat');
  check((await page.locator('#messages').textContent()).includes('如何判断NA'), 'source link opens the original conversation');
  await summary();
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390px layout has no document overflow');
  check(await page.locator('#ai-summary-generate').evaluate(node => node.getBoundingClientRect().height >= 44), 'generation target is at least 44px');
  await page.screenshot({path:path.join(outputDir, 'ai-summary-safety-mobile.png'), fullPage:true});

  await page.unroute('**/api/learning/summary', handler);
  await reload();
  check((await page.locator('#learning-ai-summary').textContent()).includes('安全文本'), 'saved regenerated summary restores after reload');
  await page.evaluate(async () => {
    const {downloadOffline} = await import('/static/offline.js?v=learning-v1');
    const {learningStore} = await import('/static/learning-store.js?v=learning-v1');
    const result = await downloadOffline();
    await learningStore.saveCourse(result.course);
  });
  await reload();
  await page.context().setOffline(true);
  await reload();
  check((await page.locator('#learning-ai-summary').textContent()).includes('安全文本'), 'offline refresh restores saved summary and new modules');
  await page.context().setOffline(false);
  const archive = await store(store => store.exportArchive());
  await store(store => store.clearConversations());
  check((await snapshot()).summaries.length === 0, 'clearing source conversations removes referenced summaries');
  archive.data.conversations = [];
  await page.evaluate(async archive => {
    const {learningStore} = await import('/static/learning-store.js?v=learning-v1');
    await learningStore.importArchive(archive);
  }, archive);
  await page.locator('.lc-ai-missing').first().waitFor();
  check(await page.locator('.lc-ai-missing').first().isDisabled(), 'imported historical summary disables missing evidence locations');
  check(await page.locator('#learning-ai-summary').getByRole('button', {name:'返回对话', exact:true}).count() === 0, 'missing source cannot open an unrelated conversation');
  check(errors.length === 0, 'browser has no uncaught JavaScript errors');
  return {passed:checks.length, checks, errors, browser:{desktop:{width:1440,height:1000}, narrow:{width:390,height:844}, timezone:'Asia/Shanghai'}};
}

async function main() {
  const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const outputDir = process.env.SUMMARY_TEST_OUTPUT || path.resolve(__dirname, '../output/playwright');
  fs.mkdirSync(outputDir, {recursive:true});
  const browser = await chromium.launch({headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || 'chrome'});
  const context = await browser.newContext({viewport:{width:1440,height:1000}, timezoneId:'Asia/Shanghai', reducedMotion:'reduce'});
  const page = await context.newPage();
  try {
    const result = await run(page, process.env.BASE_URL || 'http://127.0.0.1:8001', outputDir);
    result.browser.version = browser.version();
    console.log(JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(outputDir, 'ai-summary-results.json'), JSON.stringify(result, null, 2));
  } catch (error) {
    await page.screenshot({path:path.join(outputDir, 'ai-summary-failure.png'), fullPage:true});
    console.error(error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
if (require.main === module) main();
module.exports = {run};
