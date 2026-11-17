const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
async function main(){
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(8);res.setHeader('Content-Type',req.url.startsWith('/static/')?'text/javascript':'text/html');res.end(req.url.startsWith('/static/')?fs.readFileSync(path.join(__dirname,'../static',name)):'<!doctype html><title>Storage test</title>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{for(const oldVersion of [1,2]){
 const context=await browser.newContext(),page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async oldVersion=>{
  const check=(ok,message)=>{if(!ok)throw Error(message);checks.push(message);};const checks=[];
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('r-language-tutor-learning',oldVersion);r.onupgradeneeded=()=>{for(const n of ['conversations','events','cards','attempts','bookmarks','settings','course',...(oldVersion===2?['summaries']:[])])r.result.createObjectStore(n,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
  const {learningStore:s}=await import('/static/learning-store.js');window.store=s;
  await s.ready();check((await s.snapshot()).aiExercises.length===0,'旧版本升级空集合');
  const request={schema_version:1,knowledge_ids:['K06'],count:1,difficulty:'basic',formats:['choice'],recent_prompts:[]};
  const response={status:'ok',mode:'ai',generation_id:'gen:1',generated_at:'2026-11-17T08:00:00.000Z',provider:'deepseek',model:'model',prompt_version:'learning-exercise-v1',knowledge_version:'v1',questions:[{id:'aiq:1',knowledge_ids:['K06'],learning_type:'concept',format:'choice',difficulty:'basic',prompt:'NA检测？',code:'',choices:['is.na(x)','x==NA','x=NULL','missing(x)'],correct_index:0,hints:['使用专用函数'],reference_answer:'is.na(x)',solution_code:'',explanation:'逐元素检查缺失值',source_refs:[{knowledge_id:'K06',source_id:'S3',file:'course.pdf',locator:'p1',title:'缺失值'}],execution_status:'not_executed'}]};
  await s.saveExerciseBatch(response,request);await s.saveExerciseBatch(response,request);check((await s.listAIExercises()).length===1,'批次幂等');
  await s.recordAIExerciseView('aiq:1');await s.recordAIExerciseView('aiq:1');check((await s.snapshot()).events.length===1,'稳定浏览事件');
  await s.saveAIExerciseDraft('aiq:1',{selectedIndex:0,hintUsed:true});await s.lockAIExercise('aiq:1');
  let q=await s.getAIExercise('aiq:1');check(q.draft.phase==='locked'&&q.draft.assistedAtLock,'锁定保留辅助');
  let rejected=false;try{await s.saveAIExerciseDraft(q.id,{selectedIndex:1});}catch{rejected=true;}check(rejected,'锁定答案固定');
  await s.saveAIExerciseDraft(q.id,{answerRevealed:true,rating:'independent'});q=await s.getAIExercise(q.id);check(q.draft.rating==='assisted','辅助不能自评独立');
  const [a,b]=await Promise.all([s.submitAIExerciseAttempt(q.id,'independent'),s.submitAIExerciseAttempt(q.id,'need_review')]);check(a.id===b.id&&(await s.listAIExerciseAttempts()).length===1,'重复作答提交幂等');
  check(a.assessment_source==='ai_reference_match'&&a.referenceMatch===true,'AI参考匹配语义');
  const archive=await s.exportArchive();check(archive.schemaVersion===3,'档案版本3');await s.importArchive(archive);check((await s.listAIExerciseAttempts()).length===1,'档案重复导入');
  for(const version of [1,2]){const legacy=structuredClone(archive);legacy.schemaVersion=version;delete legacy.data.aiExercises;delete legacy.data.aiExerciseAttempts;if(version===1)delete legacy.data.summaries;await s.importArchive(legacy);}check(true,'兼容两个旧档案版本');
  const before=JSON.stringify(await s.snapshot());const invalid=structuredClone(archive);invalid.data.aiExerciseAttempts[0].questionId='aiq:missing';rejected=false;try{await s.importArchive(invalid);}catch{rejected=true;}check(rejected&&JSON.stringify(await s.snapshot())===before,'无效关联原子回滚');
  await s.restartAIExercise(q.id);check((await s.getAIExercise(q.id)).draft.attemptId!==a.id,'重新作答新ID');
  window.archive=archive;window.questionId=q.id;return checks;
 },oldVersion);
 await page.reload();await page.evaluate(async()=>{window.store=(await import('/static/learning-store.js')).learningStore;await window.store.ready();});
 await context.setOffline(true);assert.equal(await page.evaluate(async()=>(await window.store.listAIExercises())[0].draft.phase),'draft');await context.setOffline(false);
 const second=await context.newPage();await second.goto(`http://127.0.0.1:${server.address().port}`);await second.evaluate(async()=>{window.store=(await import('/static/learning-store.js')).learningStore;});
 await page.evaluate(async()=>{await window.store.saveAIExerciseDraft('aiq:1',{selectedIndex:1});await window.store.lockAIExercise('aiq:1');});
 const ids=await Promise.all([page,second].map(p=>p.evaluate(async()=>(await window.store.submitAIExerciseAttempt('aiq:1','need_review')).id)));assert.equal(ids[0],ids[1]);
 await page.evaluate(async()=>{await window.store.deleteAIExercise('aiq:1');if((await window.store.listAIExerciseAttempts()).length)throw Error('级联删除失败');await window.store.resetLearningData();if((await window.store.snapshot()).aiExercises.length)throw Error('重置失败');});
 console.log(JSON.stringify({oldVersion,checks:[...result,'刷新离线读取','双标签页幂等','级联删除与重置']}));await context.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
