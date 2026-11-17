import {requestJson} from './api-client.js?v=ascii-v1';
import {learningStore} from './learning-store.js?v=learning-v1';
import {buildExerciseRequest, recommendExerciseKnowledge} from './ai-exercise-data.js?v=ai-exercise-v1';

const FORMATS = {choice:'单选',short_answer:'简答',code_reading:'代码阅读',code_fix:'代码纠错'};
const RATINGS = {need_review:'需重学',assisted:'辅助完成',independent:'独立完成'};
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, handler, className = '') {
  const node = el('button',text,className);
  node.type = 'button'; node.onclick = handler;
  return node;
}
function select(label, values, current, change) {
  const wrap = el('label',label);
  const node = el('select'); node.setAttribute('aria-label',label);
  for (const [value,text] of values) {const option=el('option',text);option.value=value;node.append(option);}
  node.value = current; node.onchange = () => change(node.value); wrap.append(node);
  return wrap;
}
function details(label) {const node=el('details');node.append(el('summary',label));return node;}

export class AIExerciseUI {
  constructor({owner,getModelConfig,refreshModelConfig,openModelSettings,openKnowledge,codeBlock,download}) {
    Object.assign(this,{owner,getModelConfig,refreshModelConfig,openModelSettings,openKnowledge,codeBlock,download});
    this.options={mode:'knowledge',knowledgeIds:[],count:3,difficulty:'basic',formats:Object.keys(FORMATS)};
    try {const saved=JSON.parse(localStorage.getItem('r-tutor-ai-exercise-options')||'null');if(saved)this.options={...this.options,...saved};} catch {}
    this.pending = Promise.resolve();this.failedDrafts=[]; this.rows=[];this.message='';
    window.addEventListener('hashchange',()=>{if(!location.hash.startsWith('#/history/review'))this.cancel();});
  }
  refreshConfig() {this.cancel();this.paintStatus();}
  open(id) {
    this.cancel(); this.options.mode='knowledge'; this.options.knowledgeIds=id?[id]:[];
    this.owner.aiPractice=true;location.hash='/history/review/ai';this.owner.run(()=>this.owner.render());
  }
  cancel() {
    if (this.job) {this.job.controller.abort();this.job=null;this.message='已取消，可以再次出题。';this.paintStatus();}
  }
  async mount(root,snapshot) {
    this.root=root;this.snapshot=snapshot;
    this.rows=await learningStore.listAIExercises();
    if(!root.isConnected||this.root!==root)return;
    root.replaceChildren();root.classList.add('lc-ai-exercises');root.id='learning-ai-exercises';
    root.append(el('h2','AI练习'));
    const scope=el('div',undefined,'lc-ai-scope');
    scope.append(select('选题范围',[['knowledge','选择知识点'],['unit','课程单元'],['recent','近期需巩固'],['comprehensive','综合练习']],this.options.mode,value=>{
      this.cancel();this.options.mode=value;this.mount(root,this.snapshot);
    }));
    if(this.options.mode==='unit') scope.append(select('课程单元',this.owner.units.map(unit=>[unit,unit]),this.options.unitId||this.owner.units[0],value=>{this.cancel();this.options.unitId=value;this.renderPreview();}));
    if(this.options.mode==='unit'&&!this.options.unitId)this.options.unitId=this.owner.units[0];
    if(['knowledge','comprehensive'].includes(this.options.mode)) {
      const choose=details('知识点（最多3个）');choose.open=true;
      const grid=el('div',undefined,'lc-ai-knowledge');
      for(const item of this.owner.catalog) {
        const label=el('label');const check=el('input');check.type='checkbox';check.value=item.id;
        check.checked=this.options.knowledgeIds.includes(item.id);
        check.onchange=()=>{
          this.cancel();
          const ids=[...this.options.knowledgeIds.filter(id=>id!==item.id),...(check.checked?[item.id]:[])];
          if(ids.length>3){check.checked=false;this.message='每批最多选择3个知识点。';this.paintStatus();return;}
          this.options.knowledgeIds=ids;this.renderPreview();
        };
        label.append(check,el('span',`${item.id} · ${item.title}`));grid.append(label);
      }
      choose.append(grid);scope.append(choose);
      requestAnimationFrame(()=>{
        const selected=grid.querySelector('input:checked')?.closest('label');
        if(selected&&grid.isConnected)grid.scrollTop=selected.offsetTop-grid.firstElementChild.offsetTop;
      });
    }
    if(this.options.mode==='recent') {
      const recommendations=recommendExerciseKnowledge(snapshot,this.options);
      scope.append(el('p',recommendations.length?recommendations.map(item=>`${item.knowledgeId} · ${item.reasons.join('、')}`).join('；'):'还没有可推荐的学习记录，请选择知识点。','muted'));
    }
    root.append(scope);
    const settings=details('出题设置');settings.className='lc-ai-settings';
    settings.append(select('题目数量',[1,2,3,4,5].map(value=>[String(value),`${value}题`]),String(this.options.count),value=>{this.cancel();this.options.count=Number(value);this.renderPreview();}),
      select('难度',[['basic','基础'],['standard','标准'],['advanced','进阶']],this.options.difficulty,value=>{this.cancel();this.options.difficulty=value;this.renderPreview();}));
    const formats=el('fieldset');formats.append(el('legend','题型'));
    for(const [format,text] of Object.entries(FORMATS)) {
      const label=el('label');const check=el('input');check.type='checkbox';check.checked=this.options.formats.includes(format);
      check.onchange=()=>{this.cancel();this.options.formats=Object.keys(FORMATS).filter(key=>key===format?check.checked:this.options.formats.includes(key));this.renderPreview();};
      label.append(check,el('span',text));formats.append(label);
    }
    settings.append(formats);root.append(settings);
    this.preview=details('发送内容');this.preview.id='ai-exercise-preview';root.append(this.preview);
    this.model=el('p',undefined,'muted lc-caption');this.status=el('p');this.status.setAttribute('role','status');this.status.id='ai-exercise-status';
    const actions=el('div',undefined,'lc-ai-actions');
    this.generateButton=button('AI出题',()=>this.generate(),'primary');this.generateButton.id='ai-exercise-generate';
    this.cancelButton=button('取消生成',()=>this.cancel());this.cancelButton.id='ai-exercise-cancel';
    this.configureButton=button('配置模型',event=>this.openModelSettings(event.currentTarget));this.configureButton.id='ai-exercise-configure';
    actions.append(this.generateButton,this.cancelButton,this.configureButton);root.append(this.model,actions,this.status);
    this.results=el('div');root.append(this.results);this.renderPreview();await this.renderSaved();this.paintStatus();
  }
  renderPreview() {
    if(!this.preview)return;
    try {localStorage.setItem('r-tutor-ai-exercise-options',JSON.stringify(this.options));} catch {}
    this.preview.replaceChildren(el('summary','发送内容'));
    try {
      this.snapshot={...this.owner.data,course:{...(this.owner.course||{}),knowledge:this.owner.catalog},aiExercises:this.rows};
      this.input=buildExerciseRequest(this.snapshot,this.options);
      this.preview.append(el('p',`实际知识范围 ${this.input.knowledge_ids.join('、')}`),el('pre',JSON.stringify(this.input,null,2)));
    } catch(error) {this.input=null;this.preview.append(el('p',error.message));}
    this.paintStatus();
  }
  paintStatus() {
    if(!this.status?.isConnected)return;
    const config=this.getModelConfig();
    this.model.textContent=config.configured&&config.mode!=='mock'?`题目范围将发送至 ${config.provider} · ${config.model}，按厂商计费。搜索关闭。`:'配置模型后可以AI出题，已保存的练习可离线作答。';
    this.status.textContent=this.job?'正在出题，可以取消。':this.message;
    this.generateButton.textContent=this.rows.length?'重新出题':'AI出题';
    this.generateButton.disabled=!!this.job||!this.input;
    this.generateButton.setAttribute('aria-busy',String(!!this.job));this.cancelButton.hidden=!this.job;
    this.configureButton.hidden=!!config.configured&&config.mode!=='mock'&&!this.needsConfig;
  }
  async generate() {
    if(this.job||!this.input)return;
    const config=this.getModelConfig();
    if(!config.configured||config.mode==='mock'){await this.openModelSettings(this.generateButton);return;}
    if(!navigator.onLine){this.message='联网后可以出题，已保存练习可继续作答。';this.paintStatus();return;}
    const job={controller:new AbortController(),input:this.input};this.job=job;this.paintStatus();
    try {
      const signal=AbortSignal.any([job.controller.signal,AbortSignal.timeout(70000)]);
      const response=await requestJson('/api/learning/exercises',job.input,{signal});
      if(this.job!==job||signal.aborted)return;
      await this.mutate(()=>learningStore.saveExerciseBatch(response,job.input));
      if(this.job!==job)return;
      this.rows=await learningStore.listAIExercises();this.message='题目已保存在当前设备。';this.renderPreview();await this.renderSaved();
    } catch(error) {
      if(this.job!==job)return;
      this.message=error.message||'出题失败，请重试。';
      if(['CONFIG_REQUIRED','SESSION_EXPIRED','CONFIG_CHANGED'].includes(error.code)){this.needsConfig=true;await this.refreshModelConfig?.().catch(()=>{});}
    } finally {if(this.job===job)this.job=null;this.paintStatus();}
  }
  async mutate(operation) {
    this.owner.saving=true;
    try{return await operation();}finally{this.owner.saving=false;}
  }
  saveDraft(id,patch) {
    const attemptId=this.rows.find(row=>row.id===id)?.draft.attemptId;
    this.pending=this.pending.then(async()=>{
      try {
        while(this.failedDrafts.length){const failed=this.failedDrafts[0];await this.mutate(()=>learningStore.saveAIExerciseDraft(failed.id,failed.patch,failed.attemptId));this.failedDrafts.shift();}
        await this.mutate(()=>learningStore.saveAIExerciseDraft(id,patch,attemptId));
      }
      catch(error){this.failedDrafts.push({id,patch,attemptId});this.message=error.message;this.paintStatus();}
    });
    return this.pending;
  }
  async run(operation) {
    const focused=document.activeElement;
    const questionId=focused?.closest('[data-question-id]')?.dataset.questionId;
    const label=focused?.textContent;
    try {await this.pending;
      while(this.failedDrafts.length){const failed=this.failedDrafts[0];await this.mutate(()=>learningStore.saveAIExerciseDraft(failed.id,failed.patch,failed.attemptId));this.failedDrafts.shift();}
      await this.mutate(operation);this.rows=await learningStore.listAIExercises();this.message='';this.paintStatus();await this.renderSaved();
      const panel=[...this.results.querySelectorAll('[data-question-id]')].find(node=>node.dataset.questionId===questionId);
      const target=panel&&([...panel.querySelectorAll('button')].find(node=>node.textContent===label)||panel.querySelector('button.primary,textarea:not(:disabled)'));
      target?.focus({preventScroll:true});
    }
    catch(error){this.message=error.message||'保存失败，请重试。';this.paintStatus();}
  }
  async renderSaved() {
    if(!this.results?.isConnected)return;
    const result=this.results;
    const attempts=await learningStore.listAIExerciseAttempts();
    if(result!==this.results||!result.isConnected)return;
    this.results.replaceChildren();
    this.results.append(el('p',`已保存 ${this.rows.length} 题 · 练习 ${attempts.length} 次 · 主题 ${new Set(this.rows.flatMap(row=>row.knowledge_ids)).size} 个`,'muted'));
    if(attempts.length) {
      const history=details('练习记录与自评');
      for(const attempt of attempts.slice().reverse())history.append(el('p',`${new Date(attempt.at).toLocaleString('zh-CN')} · ${RATINGS[attempt.rating]||attempt.rating} · ${attempt.assessment_source==='ai_reference_match'?'与AI参考选项比对':'自评'}`));
      this.results.append(history);
    }
    for(const row of this.rows) {
      const panel=el('article',undefined,'lc-paper lc-ai-question');panel.dataset.questionId=row.id;
      const draft=row.draft;const locked=draft.phase!=='draft';
      panel.append(el('span','AI生成','lc-ai-badge'),el('h3',`${row.knowledge_ids.join('、')} · ${FORMATS[row.format]}`),el('p',row.prompt));
      if(row.code){this.codeBlock(panel,row.code,'题目代码',true);}
      if(row.format==='choice') {
        const choices=el('fieldset');choices.append(el('legend','选择答案'));
        row.choices.forEach((text,index)=>{
          const label=el('label');const input=el('input');input.type='radio';input.name=row.id;input.checked=draft.selectedIndex===index;input.disabled=locked;
          input.onchange=()=>this.saveDraft(row.id,{selectedIndex:index});label.append(input,el('span',text));choices.append(label);
        });panel.append(choices);
      }
      const answer=el('textarea');answer.placeholder='写下你的答案或推理';answer.setAttribute('aria-label','我的答案');answer.value=draft.answerText;answer.disabled=locked;answer.maxLength=6000;
      answer.oninput=()=>this.saveDraft(row.id,{answerText:answer.value});panel.append(answer);
      const controls=el('div',undefined,'lc-ai-actions');
      controls.append(button('解题提示',()=>this.run(async()=>{
        await learningStore.saveAIExerciseDraft(row.id,{hintUsed:true},draft.attemptId);
      })));
      if(draft.hintUsed)for(const hint of row.hints)panel.append(el('p',hint,'lc-ai-hint'));
      controls.append(button('参考答案',()=>this.run(()=>learningStore.saveAIExerciseDraft(row.id,{answerRevealed:true},draft.attemptId))));
      if(!locked)controls.append(button('锁定答案',()=>this.run(()=>learningStore.lockAIExercise(row.id,draft.attemptId)),'primary'));
      if(draft.answerRevealed) {
        const reference=el('section',undefined,'lc-ai-reference');reference.append(el('h4','AI参考答案'),el('p',row.reference_answer),el('p',row.explanation));
        if(row.solution_code){this.codeBlock(reference,row.solution_code,'参考代码',true);}
        if(locked&&row.format==='choice')reference.append(el('p',draft.selectedIndex===row.correct_index?'与AI参考选项一致':'与AI参考选项不一致'));
        panel.append(reference);
      }
      if(locked&&draft.phase!=='saved') {
        panel.append(select('自评',Object.entries(RATINGS).filter(([key])=>!draft.assistedAtLock||key!=='independent'),draft.rating||'need_review',value=>this.saveDraft(row.id,{rating:value})));
        controls.append(button('保存作答',()=>this.run(async()=>{
          const current=await learningStore.getAIExercise(row.id);const rating=current.draft.rating||'need_review';
          await learningStore.saveAIExerciseDraft(row.id,{rating},draft.attemptId);await learningStore.submitAIExerciseAttempt(row.id,rating,draft.attemptId);
        }),'primary'));
      }
      if(draft.phase==='saved'){panel.append(el('p',`作答已保存 · ${RATINGS[draft.rating]||draft.rating}`));controls.append(button('重新作答',()=>this.run(()=>learningStore.restartAIExercise(row.id,draft.attemptId))));}
      if(draft.hintUsed||draft.answerRevealed)panel.append(el('small','已记录提示或参考答案使用情况','muted'));
      const sources=details('内容来源');
      for(const source of row.source_refs)sources.append(button(`${source.knowledge_id} · ${source.title} · ${source.file} · ${source.locator}`,()=>this.openKnowledge(source.knowledge_id)));
      panel.append(sources,el('small',`${row.provider} · ${row.model} · ${new Date(row.generated_at).toLocaleString('zh-CN')}`,'muted'));
      controls.append(button('导出练习',()=>this.download([row.prompt,row.code||'',...row.choices,'参考答案',row.reference_answer,row.solution_code||'',row.explanation,'代码未运行验证'].join('\n\n'),'r-tutor-ai-exercise.txt')),
        button('删除练习',()=>this.run(()=>learningStore.deleteAIExercise(row.id))));
      panel.append(controls);this.results.append(panel);
      await this.mutate(()=>learningStore.recordAIExerciseView(row.id));
    }
  }
}
