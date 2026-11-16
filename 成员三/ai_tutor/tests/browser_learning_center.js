/* Run against the worktree server. Optional LEARNING_CORE_DIR serves actual sibling modules.
   PLAYWRIGHT_MODULE may point to an existing Playwright installation. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function createContractStore() {
  // Test-only persisted contract double. Production always imports the shared real module.
  const blank = () => ({conversations:[],events:[],cards:[],attempts:[],bookmarks:[],settings:{dailyLimit:6},course:null});
  let db;
  const listeners = new Set();
  const ready = new Promise((resolve,reject) => {
    const request = indexedDB.open('learning-ui-contract-test',1);
    request.onupgradeneeded = () => request.result.createObjectStore('state');
    request.onsuccess = () => {db=request.result;resolve();};request.onerror=()=>reject(request.error);
  });
  async function snapshot() {
    await ready;
    return new Promise((resolve,reject) => {
      const request=db.transaction('state').objectStore('state').get('data');
      request.onsuccess=()=>resolve(request.result||blank());request.onerror=()=>reject(request.error);
    });
  }
  async function update(fn,name) {
    const data=await snapshot();const result=await fn(data);
    await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(data,'data');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    const calls=JSON.parse(localStorage.getItem('learning-test-calls')||'[]');calls.push(name);localStorage.setItem('learning-test-calls',JSON.stringify(calls));
    listeners.forEach(fn=>fn());return result;
  }
  function enroll(data,id,at) {
    for(const type of ['concept','application']) {
      const card=data.cards.find(card=>card.id===`${id}:${type}`);
      if(card)card.dueAt=at;
      else data.cards.push({id:`${id}:${type}`,knowledgeId:id,type,stage:0,state:'new',enrolledAt:at,updatedAt:at,dueAt:at,lastReviewedAt:null});
    }
  }
  function ingest(data,record) {
    const id=record.response.request_id||'legacy-'+record.time;
    if(data.conversations.some(item=>item.id===id))return false;
    data.conversations.push({id,record});
    const knowledgeId=record.response.related_knowledge?.[0];
    if(knowledgeId){data.events.push({id:'conversation:'+id,kind:'study',knowledgeId,conversationId:id,at:record.time});enroll(data,knowledgeId,new Date(Date.parse(record.time)+86400000).toISOString());}
    return true;
  }
  return {
    ready:()=>ready,snapshot,
    subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
    migrateLegacy:records=>update(data=>({imported:records.filter(record=>ingest(data,record)).length}),'migrateLegacy'),
    ingestConversation:record=>update(data=>{ingest(data,record);return{conversationId:record.response.request_id||'legacy-'+record.time};},'ingestConversation'),
    recordVisit:(knowledgeId,at=new Date().toISOString())=>update(data=>data.events.push({id:crypto.randomUUID(),kind:'view',knowledgeId,at}),'recordVisit'),
    enroll:(id,at=new Date().toISOString())=>update(data=>{enroll(data,id,at);data.events.push({id:'enroll:'+id,kind:'enroll',knowledgeId:id,at});},'enroll'),
    saveAttempt:attempt=>update(data=>{
      const existing=data.attempts.find(item=>item.id===attempt.id);if(existing)return{attempt:existing,card:data.cards.find(item=>item.id===attempt.cardId)};
      if((attempt.hintUsed||attempt.answerRevealed)&&attempt.grade!=='again')attempt.grade='hinted';
      data.attempts.push(attempt);enroll(data,attempt.cardId.split(':')[0],new Date(Date.now()+86400000).toISOString());
      const card=data.cards.find(item=>item.id===attempt.cardId);card.lastReviewedAt=attempt.at;return{card,attempt};
    },'saveAttempt'),
    saveBookmark:bookmark=>update(data=>{data.bookmarks=data.bookmarks.filter(item=>item.id!==bookmark.id);data.bookmarks.push(bookmark);},'saveBookmark'),
    removeBookmark:id=>update(data=>{data.bookmarks=data.bookmarks.filter(item=>item.id!==id);},'removeBookmark'),
    saveCourse:course=>update(data=>{data.course=course;},'saveCourse'),
    saveSettings:settings=>update(data=>{data.settings=settings;},'saveSettings'),
    clearConversations:()=>update(data=>{data.conversations=[];data.bookmarks=data.bookmarks.filter(item=>!item.conversationId);},'clearConversations'),
    resetLearningData:()=>update(data=>{const course=data.course;Object.assign(data,blank(),{course});},'resetLearningData'),
    exportArchive:async()=>{const{course,...data}=await snapshot();return{app:'r-language-tutor',schemaVersion:1,exportedAt:new Date().toISOString(),knowledgeVersion:'test',data};},
    importArchive:archive=>update(data=>{
      if(archive.app!=='r-language-tutor'||archive.schemaVersion!==1||!Array.isArray(archive.data?.events))throw Error('档案格式或版本无效');
      let imported=0,duplicates=0;
      for(const key of ['conversations','events','cards','attempts','bookmarks'])for(const item of archive.data[key]) {
        if(data[key].some(row=>row.id===item.id))duplicates++;else{data[key].push(item);imported++;}
      }
      return{imported,duplicates};
    },'importArchive')
  };
}
function buildReviewQueue(input) {
  return input.cards.filter(card=>Date.parse(card.dueAt)<=Date.parse(input.now)).slice(0,input.limit)
    .map(card=>({card,reason:'主动加入，安排首次回忆检测',priority:10}));
}
const offlineDouble = `
export async function getOfflineCourse(){return null;}
export async function getOfflineStatus(){return JSON.parse(localStorage.getItem('learning-test-offline')||'null')||{supported:true,ready:false,knowledgeVersion:null,downloadedAt:null,assetCount:0};}
export async function downloadOffline(progress){progress({completed:1,total:2});await new Promise(r=>setTimeout(r,100));if(sessionStorage.getItem('learning-test-download-failure'))throw Error('测试下载中断');progress({completed:2,total:2});const result={course:await(await fetch('/test-course.json')).json(),knowledgeVersion:'contract-v1',downloadedAt:new Date().toISOString(),assetCount:2};localStorage.setItem('learning-test-offline',JSON.stringify({...result,course:undefined,supported:true,ready:true}));return result;}
export async function registerOffline(){return {supported:true};}
`;

async function run(page,baseUrl,outputDir) {
  const checks=[];
  const check=(condition,label)=>{assert.ok(condition,label);checks.push(label);};
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const store=fn=>page.evaluate(async source=>{const{learningStore}=await import('/static/learning-store.js?v=learning-v1');return(new Function('store','return ('+source+')(store)'))(learningStore);},fn.toString());
  const snap=()=>store(store=>store.snapshot());
  const navigate=async tab=>{await page.locator(`[data-learning-tab=${tab}]`).click();await page.waitForURL(tab==='overview'?'**/#/history':`**/#/history/${tab}`);await page.waitForTimeout(240);};
  const route=async view=>{await page.evaluate(view=>{location.hash='/'+view;},view);await page.waitForFunction(view=>document.body.dataset.view===view.split('/')[0],view);await page.waitForTimeout(250);};
  const reload=async()=>{await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.knowledge-orb').length===43);await page.waitForTimeout(300);};
  const noOverflow=async label=>check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.body.scrollWidth<=innerWidth),label);
  const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/course.json'),'utf8'));
  const bank=JSON.parse(fs.readFileSync(path.join(__dirname,'../static/review-bank.json'),'utf8'));
  check(fixture.knowledge.every(k=>['concept','application'].every(type=>bank.items.some(q=>q.knowledgeId===k.id&&q.type===type&&!q.variantOf))),'43 topics each have concept and application questions');
  check(bank.items.every(q=>q.reference&&q.sourceRefs.length&&(!q.choices||Number.isInteger(q.correctIndex))),'all question references and objective answers are present');
  await page.context().route('**/test-course.json',route=>route.fulfill({json:fixture}));
  await page.goto(baseUrl);
  await page.evaluate(async()=>{localStorage.clear();for(const name of ['r-language-tutor-learning','learning-ui-contract-test'])await new Promise(resolve=>{const request=indexedDB.deleteDatabase(name);request.onsuccess=request.onerror=request.onblocked=resolve;});});
  // Existing application has an open database. A fresh context is used by the runner.
  await reload();
  await route('history');
  check((await page.locator('.lc-stats dd').allTextContents()).every(text=>text==='0'),'first visit displays actual zero metrics');
  check(await page.getByRole('link',{name:'浏览知识地图 →',exact:true}).isVisible(),'empty learning entry is available');
  await page.screenshot({path:path.join(outputDir,'learning-empty-desktop.png'),fullPage:true});
  const legacy={time:new Date().toISOString(),request:{question:'缺失值旧记录',task_type:'concept',knowledge_id:'K06'},response:{request_id:'learning-legacy',status:'ok',task_type:'concept',related_knowledge:['K06'],answer:{summary:'NA表示缺失。',steps:[],issues:[],follow_ups:[]},citations:[]}};
  await page.evaluate(record=>localStorage.setItem('r-tutor-mock-v1',JSON.stringify([record])),legacy);
  await reload();
  check((await snap()).conversations.length===1,'legacy records migrate into persistent storage');
  await reload();check((await snap()).conversations.length===1,'repeat migration is idempotent');
  await navigate('records');check(await page.locator('#history-list').getByText('缺失值旧记录',{exact:true}).isVisible(),'records tab uses full store history');
  await page.locator('#history-list .history-row').first().click();
  check(await page.locator('.message').first().isVisible(),'record opens original conversation');
  await page.locator('.message').last().getByRole('button',{name:'收藏回答',exact:true}).click();
  await route('chat');
  await page.locator('#question').fill('mean中的na.rm怎么用？');await page.locator('#send').click();
  await page.waitForFunction(()=>document.querySelectorAll('.message').length>=2&&!document.querySelector('#send').disabled);
  check((await snap()).conversations.length===2,'real backend mock-mode Q&A ingests completed conversation');
  check((await snap()).events.some(event=>event.kind==='study'&&event.knowledgeId==='K06'),'Q&A creates actual study evidence');
  await route('knowledge');await page.locator('#map-search').fill('K06');await page.locator('.scene-orb-label[data-id=K06]').click();
  await page.getByRole('button',{name:'加入复习',exact:true}).click();
  await page.getByRole('button',{name:'收藏',exact:true}).click();
  check((await snap()).events.some(event=>event.kind==='view'&&event.knowledgeId==='K06'),'knowledge detail records visits');
  check((await snap()).cards.filter(card=>card.knowledgeId==='K06').length===2,'enrollment creates concept and application cards');
  await route('history/review');
  const first=page.locator('.lc-question');
  check(await first.isVisible(),'scheduler task renders');
  if((await first.getAttribute('data-question-id')).includes('application')) {
    await first.getByRole('button',{name:'跳过，保留待处理',exact:true}).click();
    check((await first.getAttribute('data-question-id')).includes('concept'),'skip preserves task and moves to next');
  } else {
    await first.getByRole('button',{name:'跳过，保留待处理',exact:true}).click();
    check((await first.getAttribute('data-question-id')).includes('application'),'skip preserves task and moves to next');
    await first.getByRole('button',{name:'跳过，保留待处理',exact:true}).click();
    await page.getByRole('button',{name:'继续待处理题',exact:true}).click();
  }
  await first.getByRole('button',{name:'锁定答案',exact:true}).click();
  check((await page.locator('#learning-feedback').textContent()).includes('请先作答'),'empty answer cannot lock');
  await first.getByRole('button',{name:'解题提示',exact:true}).click();
  await first.locator('input[type=radio]').first().check();
  await first.getByRole('button',{name:'锁定答案',exact:true}).click();
  check(await first.getByRole('button',{name:'独立完成',exact:true}).isDisabled(),'hint before locking restricts independent grade');
  check(await first.getByRole('button',{name:'熟练完成',exact:true}).isDisabled(),'hint restricts easy grade');
  await first.getByRole('button',{name:'提示完成',exact:true}).click();
  await page.waitForTimeout(250);
  if(!await first.count())await page.getByRole('button',{name:'继续待处理题',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.lc-question')?.dataset.questionId.includes('application'));
  check((await snap()).attempts[0].hintUsed===true,'actual hint use reaches storage');
  await page.locator('#review-answer').fill('先移除NA后计算均值，原向量保持原值。');
  await first.getByRole('button',{name:'锁定答案',exact:true}).click();
  await first.getByRole('button',{name:'参考答案',exact:true}).click();
  check(await first.getByRole('button',{name:'独立完成',exact:true}).isEnabled(),'reference after locking preserves independent evidence');
  check(await first.getByRole('button',{name:'熟练完成',exact:true}).isDisabled(),'question without verified variant restricts easy');
  await reload();
  check(await page.locator('#review-answer').evaluate(input=>input.readOnly),'locked draft restores after refresh');
  check((await page.locator('#review-answer').inputValue()).includes('原向量'),'draft answer restores');
  await first.getByRole('button',{name:'独立完成',exact:true}).click();
  await page.waitForTimeout(350);
  const attempts=(await snap()).attempts;
  check(attempts.length===2,'one attempt saved per submitted task');
  check(attempts[1].answerRevealed===false&&!attempts[1].hintUsed,'post-lock reference preserves original flags');
  check(attempts[1].assessmentSource==='self','open response records self-assessment');
  const bookmark=page.locator('.lc-bookmark').filter({hasText:'K06 · 缺失'}).first();
  await bookmark.locator('summary').click();
  const note='<img src=x onerror=window.learningAttack=true> 我的难点'+ '长中文'.repeat(100);
  await bookmark.locator('textarea').fill(note);await bookmark.getByRole('button',{name:'保存备注',exact:true}).click();
  await reload();check((await snap()).bookmarks.some(item=>item.note===note),'bookmark note persists');
  check(await page.evaluate(()=>!window.learningAttack&&!document.querySelector('.lc-bookmark img')),'notes render as safe text');
  await navigate('overview');
  check((await page.locator('.lc-stats dd').nth(3).textContent())==='1','independent progress comes from valid attempts');
  await page.screenshot({path:path.join(outputDir,'learning-overview-desktop.png'),fullPage:true});
  await page.screenshot({path:path.join(outputDir,'learning-overview-desktop-viewport.png')});
  await navigate('summary');await page.locator('#summary-period').selectOption('today');
  await page.waitForFunction(()=>document.querySelector('#learning-report')?.textContent.includes('主要易错点'));
  check((await page.locator('#learning-report').textContent()).includes('本地课程与记录模板生成'),'summary identifies generation mode');
  check(await page.locator('#learning-report').getByRole('button',{name:'返回知识点',exact:true}).count()>0,'summary source navigation is available');
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出文本周报',exact:true}).click();
  const reportDownload=await downloadPromise;check(reportDownload.suggestedFilename().endsWith('.txt'),'weekly report downloads as text');
  await reportDownload.saveAs(path.join(outputDir,'learning-report.txt'));
  check(fs.readFileSync(path.join(outputDir,'learning-report.txt'),'utf8').includes('主要易错点'),'export includes generated summary content');
  await page.evaluate(()=>{window.print=()=>{window.learningPrintRequested=true;};});
  await page.getByRole('button',{name:'打印',exact:true}).click();
  check(await page.evaluate(()=>window.learningPrintRequested),'print entry invokes browser print');
  await page.locator('#summary-period').selectOption('custom');
  await page.getByLabel('开始日期',{exact:true}).fill('2000-01-01');await page.getByLabel('结束日期',{exact:true}).fill('2000-01-02');
  check((await page.locator('#learning-report').textContent()).includes('0 个主题'),'custom range filters real records');
  await page.getByLabel('开始日期',{exact:true}).fill('2001-01-01');
  check((await page.locator('#learning-content').textContent()).includes('请选择有效日期'),'invalid range receives feedback');
  await page.locator('#learning-tools>summary').click();
  const archivePromise=page.waitForEvent('download');await page.locator('#learning-tools-content').getByRole('button',{name:'导出学习档案',exact:true}).click();await page.locator('#export-download').click();
  const archiveDownload=await archivePromise;await archiveDownload.saveAs(path.join(outputDir,'learning-archive.json'));
  const archive=JSON.parse(fs.readFileSync(path.join(outputDir,'learning-archive.json'),'utf8'));
  check(archive.app==='r-language-tutor'&&archive.data.attempts.length===2,'archive contains actual attempts');
  await page.locator('#learning-import').setInputFiles({name:'坏文件<img>.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await page.waitForFunction(()=>document.querySelector('#learning-feedback').textContent.includes('无法解析'));
  check((await snap()).attempts.length===2,'damaged file preserves current data');
  const validFile={name:'重复档案<img>.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(archive))};
  await page.locator('#learning-import').setInputFiles(validFile);
  await page.waitForFunction(()=>document.querySelector('#learning-feedback').textContent.includes('重复'));
  await page.locator('#learning-import').setInputFiles(validFile);await page.waitForTimeout(250);
  check((await snap()).attempts.length===2,'repeated import deduplicates attempts');
  check(await page.locator('#learning-feedback img').count()===0,'import filename is rendered safely');
  await page.getByRole('button',{name:'保存离线资料',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#learning-feedback').textContent.includes('离线资料已保存'));
  check((await snap()).course.knowledge.length===43,'offline download hands actual course snapshot to storage');
  check(await page.getByRole('button',{name:'更新离线资料',exact:true}).isVisible(),'offline update entry displays after success');
  await page.evaluate(()=>sessionStorage.setItem('learning-test-download-failure','1'));
  await page.getByRole('button',{name:'更新离线资料',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#learning-feedback').textContent.includes('测试下载中断'));
  check((await snap()).course.knowledge.length===43,'interrupted update preserves saved course snapshot');
  check((await page.locator('#learning-tools-content').textContent()).includes('可用版本 contract-v1'),'interrupted update reports previous usable version');
  await page.evaluate(()=>sessionStorage.removeItem('learning-test-download-failure'));
  await page.context().route('**/api/knowledge**',route=>route.abort());await reload();
  check(await page.locator('.knowledge-orb').count()===43,'saved course restores catalog when API fails');
  await route('knowledge');await page.locator('#map-search').fill('K06');await page.locator('.scene-orb-label[data-id=K06]').click();
  check((await page.locator('#detail-body').textContent()).includes('NA表示缺失'),'saved snapshot restores knowledge detail');
  await page.context().unroute('**/api/knowledge**');
  await route('history/review');
  await page.setViewportSize({width:390,height:844});
  await noOverflow('390px review has no horizontal document overflow');
  await page.screenshot({path:path.join(outputDir,'learning-review-mobile.png'),fullPage:true});
  await navigate('overview');await noOverflow('390px overview has no horizontal overflow');
  await page.screenshot({path:path.join(outputDir,'learning-overview-mobile.png'),fullPage:true});
  await page.locator('[data-learning-tab=overview]').focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(250);
  check(page.url().endsWith('/history/review'),'keyboard arrow switches learning tab');
  await navigate('records');await noOverflow('390px records have no horizontal overflow');
  await navigate('summary');await page.locator('#summary-period').selectOption('week');await page.waitForTimeout(300);
  await noOverflow('390px summary and long code wrap');
  await page.screenshot({path:path.join(outputDir,'learning-summary-mobile.png'),fullPage:true});
  await page.goBack();await page.waitForTimeout(250);check(page.url().endsWith('/history/records'),'browser back restores prior tab');
  await page.goForward();await page.waitForTimeout(250);check(page.url().endsWith('/history/summary'),'browser forward restores summary');
  await store(async store=>{const data=await store.snapshot();await store.saveAttempt(data.attempts[0]);});
  check((await snap()).attempts.length===2,'retrying committed attempt reuses ID without duplicate');
  const tools=page.locator('#learning-tools');
  if(!await tools.evaluate(node=>node.open))await tools.locator(':scope>summary').click();
  await page.getByLabel('每次题数',{exact:true}).selectOption('3');
  await page.waitForTimeout(150);check((await snap()).settings.dailyLimit===3,'review settings use storage interface');
  await navigate('records');
  await page.locator('#history-clear').click();await page.waitForTimeout(250);
  const cleared=await snap();
  check(cleared.conversations.length===0,'legacy clear entry clears stored conversations');
  check(cleared.attempts.length===2&&cleared.events.length>0,'conversation clearing preserves review evidence');
  check(cleared.bookmarks.every(item=>!item.conversationId),'clearing conversations removes answer bookmarks');
  const resetArchive=async()=>{
    if(!await tools.evaluate(node=>node.open))await tools.locator(':scope>summary').click();
    const details=tools.getByText('重置个人学习档案',{exact:true});
    if(!await details.evaluate(node=>node.parentElement.open))await details.click();
    check(await page.getByRole('button',{name:'确认重置',exact:true}).isDisabled(),'reset requires explicit acknowledgement');
    await page.getByText('我确认清除个人学习档案',{exact:true}).click();
    await page.getByRole('button',{name:'确认重置',exact:true}).click();await page.waitForTimeout(250);
  };
  await resetArchive();
  check((await snap()).attempts.length===0&&(await snap()).bookmarks.length===0,'confirmed reset clears personal learning archive');
  check((await snap()).course.knowledge.length===43,'reset preserves offline course snapshot');
  if(!await tools.evaluate(node=>node.open))await tools.locator(':scope>summary').click();
  await page.locator('#learning-import').setInputFiles(validFile);await page.waitForTimeout(300);
  check((await snap()).attempts.length===2&&(await snap()).conversations.length===2,'archive imports into reset device');
  await store(async store=>{
    const archive=await store.exportArchive();const template=archive.data.conversations[0].record;
    for(let i=0;i<105;i++){
      const record=structuredClone(template);record.response.request_id='learning-batch-'+i;record.request.question='历史对话 '+i;delete record.display_question;
      archive.data.conversations.push({id:'request:learning-batch-'+i,record});
    }
    await store.importArchive(archive);
  });
  await reload();await navigate('records');
  check((await snap()).conversations.length===107,'complete history retains more than 100 records');
  check(await page.locator('#history-list .history-row').count()===30,'history list renders a first batch');
  for(let i=0;i<3;i++)await page.locator('#history-list').getByRole('button',{name:'显示更多',exact:true}).click();
  check(await page.locator('#history-list .history-row').count()===107,'history exposes every stored conversation');
  const allPromise=page.waitForEvent('download');await page.locator('#history-export').click();await page.locator('#export-format-conversations').check();await page.locator('#export-download').click();
  const allDownload=await allPromise;await allDownload.saveAs(path.join(outputDir,'learning-all-records.json'));
  check(JSON.parse(fs.readFileSync(path.join(outputDir,'learning-all-records.json'),'utf8')).records.length===107,'legacy export entry exports complete stored history');
  const openConcept=async id=>{
    await store(async store=>{await store.resetLearningData();});
    await page.evaluate(id=>{localStorage.setItem('learning-test-topic',id);localStorage.removeItem('r-tutor-review-session-v1');localStorage.removeItem('r-tutor-mock-v1');},id);
    await page.evaluate(async id=>{const{learningStore}=await import('/static/learning-store.js?v=learning-v1');await learningStore.enroll(id);},id);
    await route('history/review');await page.evaluate(()=>localStorage.removeItem('r-tutor-review-session-v1'));await reload();
    if((await first.getAttribute('data-question-id')).includes('application'))await first.getByRole('button',{name:'跳过，保留待处理',exact:true}).click();
    await page.waitForFunction(id=>document.querySelector('.lc-question')?.dataset.questionId===id+'-concept-01',id);
  };
  await openConcept('K01');
  await first.locator('input[type=radio]').first().check();await first.getByRole('button',{name:'锁定答案',exact:true}).click();
  check(await first.getByRole('button',{name:'熟练完成',exact:true}).isDisabled(),'easy stays disabled before verified variant');
  await first.getByText('完成变式，验证熟练程度',{exact:true}).click();
  await first.getByRole('button',{name:'4',exact:true}).click();
  check(await first.getByRole('button',{name:'熟练完成',exact:true}).isEnabled(),'correct independent variant enables easy');
  await page.locator('#history-title').focus();await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:path.join(outputDir,'learning-review-mobile.png'),fullPage:true});
  await page.screenshot({path:path.join(outputDir,'learning-review-mobile-viewport.png')});
  const touch=await page.locator('.lc-grades button').evaluateAll(nodes=>nodes.every(node=>node.getBoundingClientRect().height>=44));
  check(touch,'mobile grading touch targets are at least 44px');
  await first.getByRole('button',{name:'熟练完成',exact:true}).click();await page.waitForTimeout(250);
  const easy=(await snap()).attempts[0];
  check(easy.variantPassed&&easy.grade==='easy'&&easy.assessmentSource==='objective','verified variant and objective evidence reach storage');
  await openConcept('K04');
  await first.getByRole('button',{name:'参考答案',exact:true}).click();
  await first.locator('input[type=radio]').first().check();await first.getByRole('button',{name:'锁定答案',exact:true}).click();
  check(await first.getByRole('button',{name:'独立完成',exact:true}).isDisabled(),'reference before lock restricts independent assessment');
  await first.getByRole('button',{name:'提示完成',exact:true}).click();await page.waitForTimeout(250);
  check((await snap()).attempts[0].answerRevealed,'early reference flag reaches storage');
  await openConcept('K07');
  await first.locator('input[type=radio]').nth(1).check();await first.getByRole('button',{name:'锁定答案',exact:true}).click();
  check(await first.getByRole('button',{name:'独立完成',exact:true}).isDisabled()&&await first.getByRole('button',{name:'提示完成',exact:true}).isDisabled(),'incorrect objective response requires relearning');
  await first.getByRole('button',{name:'未掌握',exact:true}).click();await page.waitForTimeout(250);
  check((await snap()).attempts[0].grade==='again','objective failure stores relearning grade');
  await store(async store=>{const data=await store.snapshot();const course=data.course;const k=course.knowledge.find(item=>item.id==='K07');k.fields['运行示例']='x <- "'+'长中文'.repeat(1200)+'"';await store.saveCourse(course);});
  await page.context().route('**/api/knowledge**',route=>route.abort());
  await reload();await navigate('summary');await page.waitForTimeout(300);
  await page.locator('#learning-report summary').filter({hasText:'典型代码'}).click();
  await noOverflow('390px very long imported code remains within document');
  check(await page.locator('#learning-report pre').evaluateAll(nodes=>nodes.some(node=>node.textContent.length>3600)&&nodes.every(node=>node.scrollWidth<=node.clientWidth)),'long code wraps within its own container');
  check(errors.length===0,'browser has no uncaught JavaScript errors');
  return {passed:checks.length,checks,errors};
}

async function main() {
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  const outputDir=process.env.LEARNING_TEST_OUTPUT||path.resolve(__dirname,'../output/playwright');fs.mkdirSync(outputDir,{recursive:true});
  const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
  const coreDir=process.env.LEARNING_CORE_DIR;
  const moduleSources=Object.fromEntries(['learning-store.js','review-scheduler.js'].map(name=>[name,coreDir?fs.readFileSync(path.join(coreDir,name),'utf8'):name==='learning-store.js'?`export const learningStore=(${createContractStore.toString()})();`:`export ${buildReviewQueue.toString()}`]));
  for(const [name,body] of Object.entries(moduleSources))await context.route(`**/static/${name}*`,route=>route.fulfill({contentType:'text/javascript',body}));
  await context.route('**/static/offline.js*',route=>route.fulfill({contentType:'text/javascript',body:offlineDouble}));
  // PWA files belong to the sibling branch. Keep this suite focused on the UI contract.
  await context.route('**/static/manifest.webmanifest*',route=>route.fulfill({json:{name:'R语言学习助手',start_url:'/'}}));
  await context.route('**/static/icons/*',route=>route.fulfill({status:204}));
  const page=await context.newPage();
  try {
    const result=await run(page,process.env.BASE_URL||'http://127.0.0.1:8012',outputDir);
    result.storage=coreDir?'merged real core modules':'test-only IndexedDB contract double';
    result.offline='test-only offline interface double';
    result.browser={version:browser.version(),platform:process.platform,desktop:{width:1440,height:1000},narrow:{width:390,height:844},timezone:'Asia/Shanghai'};
    result.moduleSha256=Object.fromEntries(Object.entries(moduleSources).map(([name,body])=>[name,require('node:crypto').createHash('sha256').update(body).digest('hex')]));
    console.log(JSON.stringify(result,null,2));fs.writeFileSync(path.join(outputDir,'learning-ui-results.json'),JSON.stringify(result,null,2));
  } catch(error){await page.screenshot({path:path.join(outputDir,'learning-failure.png'),fullPage:true});console.error(error);process.exitCode=1;}
  finally {await browser.close();}
}
if(require.main===module)main();
module.exports={run};
