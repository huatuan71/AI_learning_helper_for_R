// Real merged modules, isolated browser data, injected failures only at storage boundaries.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const http = require('node:http');
const playwright = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const engine = process.env.BROWSER || 'chromium';
let base = process.env.BASE_URL || 'http://127.0.0.1:8014';
const output = 'output/playwright';
const worker = fs.readFileSync(path.join(__dirname, '../static/service-worker.js'), 'utf8');
const offlineAssetCount = worker.split('const ASSETS = [')[1].split('];')[0].match(/'[^']+'/g).length;

async function main() {
  fs.mkdirSync(output,{recursive:true});
  const browser = await playwright[engine].launch({headless:true});
  let networkDown = false;
  let proxy;
  // Windows WebKit's emulated offline navigation raises an internal browser error.
  // Refuse real network connections at a local proxy to exercise its service worker.
  if (engine === 'webkit') {
    const backend = base;
    proxy = http.createServer((req,res) => {
      if (networkDown) {res.destroy();return;}
      const upstream = http.request(new URL(req.url,backend),{method:req.method,headers:req.headers},response => {
        res.writeHead(response.statusCode,response.headers);response.pipe(res);
      });
      upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
    });
    await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
    base='http://127.0.0.1:'+proxy.address().port;
  }
  const checks = [];
  const check = (value,label) => {assert.ok(value,label);checks.push(label);};
  const context = await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
  const errors = [];
  const setOffline = async value => {
    if (proxy) networkDown=value;
    else await context.setOffline(value);
  };
  context.on('page',page => page.on('pageerror',error => errors.push(error.message)));
  const page = await context.newPage();
  const ready = async target => {
    await target.waitForFunction(() => document.body.dataset.learningReady === 'true');
    await target.locator('#learning-tools').evaluate(node => {node.open=true;});
  };
  const snapshot = target => target.evaluate(async () => (await import('/static/learning-store.js?v=learning-v1')).learningStore.snapshot());
  try {
    await page.goto(base+'/#/history'); await ready(page);
    check((await page.locator('.lc-stats dd').allTextContents()).every(value=>value==='0'),'empty overview uses actual records');
    await page.getByRole('button',{name:'保存离线资料',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#learning-feedback').textContent.includes('离线资料已保存'));
    const initial = await page.evaluate(async () => (await import('/static/offline.js?v=learning-v1')).getOfflineStatus());
    check(initial.ready && initial.assetCount===offlineAssetCount,'UI downloads every declared public resource');
    check((await snapshot(page)).course.knowledge.length===43,'download stores complete course in IndexedDB');
    await page.evaluate(async () => {
      const {learningStore}=await import('/static/learning-store.js?v=learning-v1');
      await learningStore.enroll('K06');
      location.hash='/history/review';
    });
    const question = page.locator('.lc-question'); await question.waitFor();
    if ((await question.getAttribute('data-question-id')).includes('concept')) await question.getByRole('button',{name:'跳过，保留待处理',exact:true}).click();
    await page.locator('#review-answer').fill('独立回忆 <img src=x onerror=window.attack=1>');
    await question.getByRole('button',{name:'锁定答案',exact:true}).click();
    await page.evaluate(() => {
      window.originalPut=IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put=function(...args) {
        if (this.name==='attempts') throw new DOMException('测试存储空间不足','QuotaExceededError');
        return window.originalPut.apply(this,args);
      };
    });
    await question.getByRole('button',{name:'独立完成',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#learning-feedback').textContent.includes('测试存储空间不足'));
    check((await snapshot(page)).attempts.length===0,'failed attempt transaction leaves no partial attempt');
    const pending = await page.evaluate(()=>JSON.parse(localStorage.getItem('r-tutor-review-session-v1')).tasks.find(task=>task.submission));
    check(pending.submission.grade==='good' && pending.submission.timeZone==='Asia/Shanghai','failed submission keeps original immutable payload');
    await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalPut;});
    await page.reload(); await ready(page);
    check((await question.textContent()).includes('<img') && await question.getByRole('button',{name:'重试保存本次评级',exact:true}).isVisible(),'locked answer and pending retry recover on refresh');
    await question.getByRole('button',{name:'重试保存本次评级',exact:true}).click();
    await page.waitForFunction(async () => (await (await import('/static/learning-store.js?v=learning-v1')).learningStore.snapshot()).attempts.length===1);
    const attempt = (await snapshot(page)).attempts[0];
    check(attempt.id===pending.id && attempt.grade==='good','retry reuses original ID and assessment after reload');
    check(await page.evaluate(()=>!window.attack && !document.querySelector('.lc-question img')),'answer content renders as safe text');
    const tab = await context.newPage(); await tab.goto(base+'/#/history'); await ready(tab);
    await tab.evaluate(async () => {
      const {learningStore}=await import('/static/learning-store.js?v=learning-v1');
      await learningStore.enroll('K01');
    });
    await page.waitForFunction(async () => (await (await import('/static/learning-store.js?v=learning-v1')).learningStore.snapshot()).cards.some(card=>card.knowledgeId==='K01'));
    check((await snapshot(page)).cards.some(card=>card.knowledgeId==='K01'),'other tab enrollment is visible');
    const archive = await page.evaluate(async () => (await import('/static/learning-store.js?v=learning-v1')).learningStore.exportArchive());
    await page.locator('#learning-import').setInputFiles({name:'坏档案<img>.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
    await page.waitForFunction(()=>document.querySelector('#learning-feedback').textContent.includes('无法解析'));
    check((await snapshot(page)).attempts.length===1,'JSON parse failure preserves archive');
    await page.locator('#learning-import').setInputFiles({name:'未来版本.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...archive,schemaVersion:999}))});
    await page.waitForFunction(()=>document.querySelector('#learning-feedback').classList.contains('error'));
    check((await snapshot(page)).attempts.length===1,'incompatible archive preserves data and shows error');
    const device = await browser.newContext({viewport:{width:390,height:844},timezoneId:'Asia/Shanghai'});
    const other = await device.newPage(); await other.goto(base+'/#/history'); await ready(other);
    const importFile = {name:'设备A档案.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))};
    await other.locator('#learning-import').setInputFiles(importFile);
    await other.waitForFunction(async () => (await (await import('/static/learning-store.js?v=learning-v1')).learningStore.snapshot()).attempts.length===1);
    await other.evaluate(async () => {
      const {learningStore}=await import('/static/learning-store.js?v=learning-v1');
      const data=await learningStore.snapshot();const old=data.attempts[0];
      await learningStore.saveAttempt({...old,id:'device-b',at:new Date(Date.parse(old.at)+2*86400000).toISOString()});
    });
    const second = await other.evaluate(async () => (await import('/static/learning-store.js?v=learning-v1')).learningStore.exportArchive());
    await page.locator('#learning-import').setInputFiles({name:'设备B档案.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(second))});
    await page.waitForFunction(async () => (await (await import('/static/learning-store.js?v=learning-v1')).learningStore.snapshot()).attempts.length===2);
    check((await snapshot(page)).cards.find(card=>card.id===attempt.cardId).stage===1,'merging two device events recalculates cross-day stage');
    await page.locator('#learning-import').setInputFiles({name:'重复B.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(second))});
    await page.waitForFunction(()=>document.querySelector('#learning-feedback').textContent.includes('重复'));
    check((await snapshot(page)).attempts.length===2,'reimport is idempotent');
    await device.close();
    await page.evaluate(()=>{location.hash='/history';});
    await page.screenshot({path:output+'/'+engine+'-integration-desktop.png',fullPage:true});
    await setOffline(true);
    await page.reload(); await ready(page);
    check(await page.locator('.knowledge-orb').count()===43,'offline refresh restores all 43 topics');
    await page.evaluate(()=>{location.hash='/knowledge';});
    for (let index=1;index<=43;index++) {
      const id='K'+String(index).padStart(2,'0');
      await page.locator('#map-search').fill(id);
      await page.locator(`.scene-orb-label[data-id=${id}]`).click();
      await page.locator('#detail-body section').first().waitFor();
      assert.ok((await page.locator('#detail-body').textContent()).length>50,id);
      await page.locator('#detail-close').click();
    }
    check(true,'all 43 knowledge details open offline');
    await page.evaluate(async () => {await (await import('/static/learning-store.js?v=learning-v1')).learningStore.enroll('K02');location.hash='/history/review';});
    await question.waitFor(); await question.getByRole('button',{name:'未掌握，进入重学',exact:true}).click();
    await page.waitForFunction(async () => (await (await import('/static/learning-store.js?v=learning-v1')).learningStore.snapshot()).attempts.length===3);
    check(true,'offline grading saves attempt and schedule');
    await page.evaluate(()=>{location.hash='/history/summary';});
    await page.waitForFunction(()=>document.querySelector('#learning-report')?.textContent.includes('主要易错点'));
    check((await page.locator('#learning-report').textContent()).includes('本地课程与记录模板生成'),'offline summary uses actual course and evidence');
    await page.setViewportSize({width:390,height:844});
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'390px offline summary fits viewport');
    await page.screenshot({path:output+'/'+engine+'-integration-offline-mobile.png',fullPage:true});
    await page.locator('#history-title').focus();
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:output+'/'+engine+'-integration-offline-mobile-viewport.png'});
    const reopen = await context.newPage(); await reopen.goto(base+'/#/history'); await ready(reopen);
    check((await snapshot(reopen)).attempts.length===3,'new offline tab restores committed archive');
    const downloadPromise = reopen.waitForEvent('download');
    await reopen.locator('#learning-tools-content').getByRole('button',{name:'导出学习档案',exact:true}).click();
    await reopen.locator('#export-download').click();
    const download = await downloadPromise;
    const archivePath = output+'/'+engine+'-offline-archive.json';
    await download.saveAs(archivePath);
    check(JSON.parse(fs.readFileSync(archivePath,'utf8')).data.attempts.length===3,'offline archive export contains every saved attempt');
    await reopen.locator('#learning-import').setInputFiles(archivePath);
    await reopen.waitForFunction(()=>document.querySelector('#learning-feedback').textContent.includes('重复'));
    check((await snapshot(reopen)).attempts.length===3,'offline reimport is idempotent');
    await reopen.evaluate(async () => (await import('/static/learning-store.js?v=learning-v1')).learningStore.resetLearningData());
    await page.waitForFunction(()=>document.querySelector('#learning-report')?.textContent.includes('0 个主题'));
    check((await snapshot(page)).attempts.length===0,'other tab reset clears active learning UI');
    check((await snapshot(reopen)).course.knowledge.length===43,'reset preserves downloaded course');
    check(errors.length===0,'no uncaught page errors');
    const core = await import(pathToFileURL(path.resolve('tests/learning_core_test.mjs')).href);
    await setOffline(false);
    const coreResult = await core.runBrowserTests(page,base,engine);
    fs.writeFileSync(output+'/'+engine+'-integration-results.json',JSON.stringify({engine,version:browser.version(),os:process.platform,offlineMethod:proxy?'network connection refusal':'browser offline emulation',checks,passed:checks.length,core:coreResult,errors},null,2));
    console.log(JSON.stringify({engine,version:browser.version(),passed:checks.length,core:coreResult.count,checks}));
  } finally {
    await context.close();await browser.close();
    if(proxy) {proxy.closeAllConnections();await new Promise(resolve=>proxy.close(resolve));}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
