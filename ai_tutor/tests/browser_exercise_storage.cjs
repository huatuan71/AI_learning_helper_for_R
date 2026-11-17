const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
async function main(){
 const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname.slice(8);res.setHeader('Content-Type',req.url.startsWith('/static/')?'text/javascript':'text/html');res.end(req.url.startsWith('/static/')?fs.readFileSync(path.join(__dirname,'../static',name)):'<!doctype html><title>Storage test</title>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{for(const oldVersion of [1,2]){
 const context=await browser.newContext(),page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
 const result=await page.evaluate(async ({oldVersion,source})=>{
  const check=(ok,message)=>{if(!ok)throw Error(message);checks.push(message);};const checks=[];
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('r-language-tutor-learning',oldVersion);r.onupgradeneeded=()=>{for(const n of ['conversations','events','cards','attempts','bookmarks','settings','course',...(oldVersion===2?['summaries']:[])])r.result.createObjectStore(n,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});db.close();
  const {learningStore:s}=await import('/static/learning-store.js');window.store=s;
  await s.ready();check((await s.snapshot()).aiExercises.length===0,'旧版本升级空集合');
  const request={schema_version:1,knowledge_ids:['K06'],count:1,difficulty:'basic',formats:['choice'],recent_prompts:[]};
  const response={status:'ok',mode:'ai',generation_id:'gen:1',generated_at:'2026-11-17T08:00:00.000Z',provider:'deepseek',model:'model',prompt_version:'learning-exercise-v1',knowledge_version:'v1',questions:[{id:'aiq:1',knowledge_ids:['K06'],learning_type:'concept',format:'choice',difficulty:'basic',prompt:'NA检测？',code:'',choices:['is.na(x)','x==NA','x=NULL','missing(x)'],correct_index:0,hints:['使用专用函数'],reference_answer:'is.na(x)',solution_code:'',explanation:'逐元素检查缺失值',source_refs:source.sources.map(ref=>({...ref,knowledge_id:source.id,title:source.title})),execution_status:'not_executed'}]};
  const forged=structuredClone(response);forged.questions[0].source_refs[0].file='forged.pdf';let forgedRejected=false;try{await s.saveExerciseBatch(forged,request);}catch{forgedRejected=true;}check(forgedRejected,'空课程缓存拒绝伪造来源');
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
  const oversized=structuredClone(archive);oversized.padding='x'.repeat(20*1024*1024);let sizeRejected=false;try{await s.importArchive(oversized);}catch{sizeRejected=true;}check(sizeRejected,'20MiB上限拒绝');
  const before=JSON.stringify(await s.snapshot());const invalid=structuredClone(archive);invalid.data.aiExerciseAttempts[0].questionId='aiq:missing';rejected=false;try{await s.importArchive(invalid);}catch{rejected=true;}check(rejected&&JSON.stringify(await s.snapshot())===before,'无效关联原子回滚');
  for (const mutate of [value => {value.data.aiExercises[0].draft.at='2026-11-17T01:00:00.000Z';}, value => {value.data.aiExercises[0].draft.timeZone='America/New_York';}, value => {value.data.aiExercises[0].draft.assistedAtLock=false;}]) {
    const altered=structuredClone(archive);mutate(altered);let rejected=false;
    try{await s.importArchive(altered);}catch{rejected=true;}
    check(rejected,'草稿锁定快照伪造被拒绝');
  }
  const {newExerciseDraft}=await import('/static/ai-exercise-data.js');
  const crossQuestion=structuredClone(archive);
  const forgedQuestion=structuredClone(crossQuestion.data.aiExercises[0]);
  forgedQuestion.id='aiq:other';forgedQuestion.draft.phase='locked';forgedQuestion.draft.rating=null;
  crossQuestion.data.aiExercises[0].draft=newExerciseDraft();
  crossQuestion.data.aiExercises.push(forgedQuestion);
  let crossRejected=false;try{await s.importArchive(crossQuestion);}catch{crossRejected=true;}
  check(crossRejected,'跨题复用历史作答ID被拒绝');
  const oldAttemptId=(await s.getAIExercise(q.id)).draft.attemptId;
  await s.restartAIExercise(q.id,oldAttemptId);check((await s.getAIExercise(q.id)).draft.attemptId!==a.id,'重新作答新ID');
  for (const operation of [() => s.saveAIExerciseDraft(q.id,{selectedIndex:2},oldAttemptId), () => s.lockAIExercise(q.id,oldAttemptId), () => s.submitAIExerciseAttempt(q.id,'need_review',oldAttemptId), () => s.restartAIExercise(q.id,oldAttemptId)]) {
    let rejected=false;try{await operation();}catch{rejected=true;}
    check(rejected,'旧页面作答ID拒绝覆盖新作答');
  }
  window.archive=archive;window.questionId=q.id;return checks;
 },{oldVersion,source:JSON.parse(fs.readFileSync(path.join(__dirname,'../data/course.json'),'utf8')).knowledge.find(item=>item.id==='K06')});
 await page.reload();await page.evaluate(async()=>{window.store=(await import('/static/learning-store.js')).learningStore;await window.store.ready();});
 await context.setOffline(true);assert.equal(await page.evaluate(async()=>(await window.store.listAIExercises())[0].draft.phase),'draft');await context.setOffline(false);
 const second=await context.newPage();await second.goto(`http://127.0.0.1:${server.address().port}`);await second.evaluate(async()=>{window.store=(await import('/static/learning-store.js')).learningStore;});
 await page.evaluate(async()=>{await window.store.saveAIExerciseDraft('aiq:1',{selectedIndex:1});await window.store.lockAIExercise('aiq:1');});
 const ids=await Promise.all([page,second].map(p=>p.evaluate(async()=>(await window.store.submitAIExerciseAttempt('aiq:1','need_review')).id)));assert.equal(ids[0],ids[1]);
 await page.evaluate(async()=>{
   const store=window.store;
   const archive=await store.exportArchive();
   const template=archive.data.aiExercises[0],attempt=archive.data.aiExerciseAttempts[0];
   await store.deleteAIExercise('aiq:1');
   if((await store.listAIExerciseAttempts()).length)throw Error('级联删除失败');
   await store.resetLearningData();
   if((await store.snapshot()).aiExercises.length)throw Error('重置失败');
   const {newExerciseDraft}=await import('/static/ai-exercise-data.js');
   archive.data.events=[];archive.data.cards=[];
   archive.data.aiExercises=Array.from({length:200},(_,index)=>({...template,id:'aiq:capacity:'+index,draft:newExerciseDraft()}));
   archive.data.aiExerciseAttempts=Array.from({length:2000},(_,index)=>({...attempt,id:'capacity:'+index,questionId:'aiq:capacity:0'}));
   await store.importArchive(archive);
   const before=JSON.stringify(await store.snapshot());
   const over=structuredClone(archive);over.data.aiExercises=[{...template,id:'aiq:capacity:overflow',draft:newExerciseDraft()}];over.data.aiExerciseAttempts=[];
   let rejected=false;try{await store.importArchive(over);}catch{rejected=true;}
   if(!rejected||JSON.stringify(await store.snapshot())!==before)throw Error('200题容量未原子拒绝');
   await store.saveAIExerciseDraft('aiq:capacity:0',{selectedIndex:0});await store.lockAIExercise('aiq:capacity:0');
   rejected=false;try{await store.submitAIExerciseAttempt('aiq:capacity:0','independent');}catch{rejected=true;}
   if(!rejected||(await store.listAIExerciseAttempts()).length!==2000||(await store.getAIExercise('aiq:capacity:0')).draft.phase!=='locked')throw Error('2000作答容量未原子拒绝');
   await store.resetLearningData();
 });
 console.log(JSON.stringify({oldVersion,checks:[...result,'刷新离线读取','双标签页幂等','级联删除与重置','200题和2000作答容量原子拒绝']}));await context.close();
 }}finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
