import {enhanceRTextarea} from './r-code-editor.js?v=r-highlighting-v1';
import {rCodeFragment} from './r-highlighter.js?v=r-highlighting-v1';
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
  const wrap = el('div', undefined, 'lc-ai-select');
  const caption = el('span', label, 'lc-ai-select-label');
  const trigger = button(values.find(([value]) => value === current)?.[1] || '', undefined, 'lc-ai-select-trigger');
  const menu = el('div', undefined, 'lc-ai-select-menu');
  const id = `exercise-select-${crypto.randomUUID()}`;
  caption.id = `${id}-label`;
  trigger.id = `${id}-trigger`;
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-label', label);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-controls', id);
  menu.id = id;
  menu.popover = 'auto';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-labelledby', caption.id);
  trigger.popoverTargetElement = menu;
  let activeValue = current;
  let listeners;
  let openingIndex = null;
  const options = values.map(([value, text]) => {
    const option = button(text, () => {
      activeValue = value;
      trigger.textContent = text;
      options.forEach(item => item.setAttribute('aria-selected', String(item === option)));
      menu.hidePopover();
      trigger.focus({preventScroll:true});
      change(value);
    }, 'lc-ai-select-option');
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(value === current));
    option.tabIndex = -1;
    menu.append(option);
    return option;
  });
  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 224), innerWidth - 24);
    const below = innerHeight - rect.bottom - 20;
    const above = rect.top - 20;
    const upwards = below < Math.min(menu.scrollHeight, 240) && above > below;
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(44, Math.min(320, upwards ? above : below))}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
    menu.style.top = upwards ? 'auto' : `${rect.bottom + 8}px`;
    menu.style.bottom = upwards ? `${innerHeight - rect.top + 8}px` : 'auto';
  };
  menu.addEventListener('toggle', event => {
    const open = event.newState === 'open';
    trigger.setAttribute('aria-expanded', String(open));
    listeners?.abort();
    if (open) {
      positionMenu();
      options[openingIndex ?? values.findIndex(([value]) => value === activeValue)]?.focus();
      openingIndex = null;
      listeners = new AbortController();
      window.addEventListener('resize', positionMenu, {signal:listeners.signal});
      window.addEventListener('scroll', event => {
        if (!menu.contains(event.target)) positionMenu();
      }, {capture:true, signal:listeners.signal});
    }
  });
  trigger.onkeydown = event => {
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      openingIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : null;
      menu.showPopover();
    }
  };
  menu.onkeydown = event => {
    const index = options.indexOf(document.activeElement);
    const destinations = {ArrowDown:(index + 1) % options.length,
      ArrowUp:(index - 1 + options.length) % options.length, Home:0, End:options.length - 1};
    if (Object.hasOwn(destinations, event.key)) {
      event.preventDefault();
      options[destinations[event.key]].focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      menu.hidePopover();
      trigger.focus({preventScroll:true});
    }
  };
  wrap.append(caption, trigger, menu);
  return wrap;
}
function details(label) {const node=el('details');node.append(el('summary',label));return node;}

export class AIExerciseUI {
  constructor({owner,getModelConfig,refreshModelConfig,openModelSettings,openKnowledge,codeBlock,download}) {
    Object.assign(this,{owner,getModelConfig,refreshModelConfig,openModelSettings,openKnowledge,codeBlock,download});
    this.options={mode:'knowledge',knowledgeIds:[],count:3,difficulty:'basic',formats:Object.keys(FORMATS)};
    try {const saved=JSON.parse(localStorage.getItem('r-tutor-ai-exercise-options')||'null');if(saved)this.options={...this.options,...saved};} catch {}
    this.pending = Promise.resolve();this.failedDrafts=[]; this.rows=[];this.message='';
    window.addEventListener('hashchange',()=>{if(!location.hash.startsWith('#/history/review/ai')) {this.cancel();this.releaseEditors();}});
  }
  refreshConfig() {this.cancel();this.paintStatus();}
  open(id) {
    this.cancel(); this.options.mode='knowledge'; this.options.knowledgeIds=id?[id]:[];
    this.owner.aiPractice=true;location.hash='/history/review/ai';this.owner.run(()=>this.owner.render());
  }
  cancel() {
    if (this.job) {this.job.controller.abort();this.job=null;this.message='已取消，可以再次出题。';this.paintStatus();}
  }
  releaseEditors() {
    for (const editor of this.codeEditors || []) editor.destroy();
    this.codeEditors = [];
  }
  async mount(root,snapshot) {
    this.releaseEditors();
    this.root=root;this.snapshot=snapshot;
    this.rows=await learningStore.listAIExercises();
    if(!root.isConnected||this.root!==root)return;
    root.replaceChildren();root.classList.add('lc-ai-exercises');root.id='learning-ai-exercises';
    root.append(el('h2','AI练习'));
    const scope=el('div',undefined,'lc-ai-scope');
    scope.append(select('选题范围',[['knowledge','选择知识点'],['unit','课程单元'],['recent','近期需巩固'],['comprehensive','综合练习']],this.options.mode,async value=>{
      this.cancel();this.options.mode=value;await this.mount(root,this.snapshot);
      if(root.isConnected)root.querySelector('[role="combobox"]')?.focus({preventScroll:true});
    }));
    if(this.options.mode==='unit') scope.append(select('课程单元',this.owner.units.map(unit=>[unit,unit]),this.options.unitId||this.owner.units[0],value=>{this.cancel();this.options.unitId=value;this.renderPreview();}));
    if(this.options.mode==='unit'&&!this.options.unitId)this.options.unitId=this.owner.units[0];
    if(['knowledge','comprehensive'].includes(this.options.mode)) {
      scope.append(this.knowledgePicker());
    }
    if(this.options.mode==='recent') {
      const recommendations=recommendExerciseKnowledge(snapshot,this.options);
      scope.append(el('p',recommendations.length?recommendations.map(item=>`${item.knowledgeId} · ${item.reasons.join('、')}`).join('；'):'还没有可推荐的学习记录，请选择知识点。','muted'));
    }
    root.append(scope);
    const settings=details('出题设置');settings.className='lc-ai-settings';
    settings.append(select('题目数量',[1,2,3,4,5].map(value=>[String(value),`${value}题`]),String(this.options.count),value=>{this.cancel();this.options.count=Number(value);this.renderPreview();}),
      select('难度',[['basic','基础'],['standard','标准'],['advanced','进阶']],this.options.difficulty,value=>{this.cancel();this.options.difficulty=value;this.renderPreview();}));
    const formats=el('fieldset');formats.className='lc-ai-formats';formats.append(el('legend','题型'));
    const formatGrid=el('div',undefined,'lc-ai-format-grid');
    for(const [format,text] of Object.entries(FORMATS)) {
      const label=el('label',undefined,'lc-ai-choice-option');const check=el('input');check.type='checkbox';check.value=format;check.checked=this.options.formats.includes(format);
      check.onchange=()=>{this.cancel();this.options.formats=Object.keys(FORMATS).filter(key=>key===format?check.checked:this.options.formats.includes(key));this.renderPreview();};
      const mark=el('span',undefined,'lc-ai-option-mark');mark.setAttribute('aria-hidden','true');
      label.append(check,el('span',text,'lc-ai-option-title'),mark);formatGrid.append(label);
    }
    formats.append(formatGrid);
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
  knowledgePicker() {
    const picker = details('选择知识点');
    picker.className = 'lc-ai-picker';
    picker.open = true;
    const summary = picker.querySelector('summary');
    const count = el('span', undefined, 'lc-ai-picker-count');
    count.setAttribute('aria-live', 'polite');
    summary.append(count);

    const content = el('div', undefined, 'lc-ai-picker-content');
    const selected = el('div', undefined, 'lc-ai-selected');
    selected.setAttribute('role', 'group');
    selected.setAttribute('aria-label', '已选知识点');
    const searchLabel = el('label', undefined, 'lc-ai-search');
    const search = el('input');
    search.type = 'search';
    search.placeholder = '搜索知识点或编号';
    search.setAttribute('aria-label', '搜索知识点或编号');
    searchLabel.append(search);
    const grid = el('div', undefined, 'lc-ai-knowledge');
    const empty = el('p', '没有找到匹配的知识点', 'lc-ai-picker-empty');
    empty.hidden = true;
    const choices = [];

    const updateSelection = () => {
      const ids = this.options.knowledgeIds;
      count.textContent = `已选 ${ids.length} / 3`;
      selected.replaceChildren();
      selected.hidden = ids.length === 0;
      for (const id of ids) {
        const item = this.owner.catalog.find(item => item.id === id);
        const chip = button('', () => {
          this.cancel();
          this.options.knowledgeIds = this.options.knowledgeIds.filter(value => value !== id);
          updateSelection();
          this.renderPreview();
          search.focus({preventScroll:true});
        }, 'lc-ai-selected-chip');
        chip.setAttribute('aria-label', `移除 ${id} ${item?.title || ''}`);
        const remove = el('span', '×', 'lc-ai-chip-remove');
        remove.setAttribute('aria-hidden', 'true');
        chip.append(el('span', `${id} · ${item?.title || id}`), remove);
        selected.append(chip);
      }
      for (const {item, check} of choices) {
        check.checked = ids.includes(item.id);
        check.disabled = ids.length === 3 && !check.checked;
      }
    };

    for (const item of this.owner.catalog) {
      const label = el('label', undefined, 'lc-ai-knowledge-option lc-ai-choice-option');
      const check = el('input');
      check.type = 'checkbox';
      check.value = item.id;
      check.onchange = () => {
        this.cancel();
        const ids = this.options.knowledgeIds.filter(id => id !== item.id);
        if (check.checked && ids.length < 3) ids.push(item.id);
        this.options.knowledgeIds = ids;
        updateSelection();
        this.renderPreview();
      };
      const mark = el('span', undefined, 'lc-ai-option-mark');
      mark.setAttribute('aria-hidden', 'true');
      label.append(check, el('span', item.id, 'lc-ai-option-id'),
        el('span', item.title, 'lc-ai-option-title'), mark);
      choices.push({item, label, check});
      grid.append(label);
    }
    search.oninput = () => {
      const query = search.value.trim().toLocaleLowerCase();
      for (const {item, label} of choices) {
        label.hidden = !`${item.id} ${item.title}`.toLocaleLowerCase().includes(query);
      }
      empty.hidden = choices.some(({label}) => !label.hidden);
      grid.hidden = !empty.hidden;
    };
    updateSelection();
    content.append(selected, searchLabel, grid, empty);
    picker.append(content);
    requestAnimationFrame(() => {
      const active = grid.querySelector('input:checked')?.closest('label');
      if (active && grid.isConnected) grid.scrollTop = active.offsetTop - grid.firstElementChild.offsetTop;
    });
    return picker;
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
    this.releaseEditors();
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
      if(row.code){this.codeBlock(panel,row.code,'题目代码',true,'r');}
      if(row.format==='choice') {
        const choices=el('fieldset');choices.append(el('legend','选择答案'));
        row.choices.forEach((text,index)=>{
          const label=el('label');const input=el('input');input.type='radio';input.name=row.id;input.checked=draft.selectedIndex===index;input.disabled=locked;
          input.onchange=()=>this.saveDraft(row.id,{selectedIndex:index});label.append(input,el('span',text));choices.append(label);
        });panel.append(choices);
      }
      const answer=el('textarea');answer.placeholder='写下你的答案或推理';answer.setAttribute('aria-label','我的答案');answer.value=draft.answerText;answer.disabled=locked;answer.maxLength=6000;
      answer.oninput=()=>this.saveDraft(row.id,{answerText:answer.value});panel.append(answer);
      if (row.format === 'code_fix') {
        answer.placeholder = '写下修正后的R代码';
      }
      const controls=el('div',undefined,'lc-ai-actions');
      controls.append(button('解题提示',()=>this.run(async()=>{
        await learningStore.saveAIExerciseDraft(row.id,{hintUsed:true},draft.attemptId);
      })));
      if(draft.hintUsed)for(const hint of row.hints)panel.append(el('p',hint,'lc-ai-hint'));
      controls.append(button('参考答案',()=>this.run(()=>learningStore.saveAIExerciseDraft(row.id,{answerRevealed:true},draft.attemptId))));
      if(!locked)controls.append(button('锁定答案',()=>this.run(()=>learningStore.lockAIExercise(row.id,draft.attemptId)),'primary'));
      if(draft.answerRevealed) {
        const reference=el('section',undefined,'lc-ai-reference');reference.append(el('h4','AI参考答案'),el('p',row.reference_answer),el('p',row.explanation));
        if(row.solution_code){this.codeBlock(reference,row.solution_code,'参考代码',true,'r');}
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
      if (row.format === 'code_fix') this.codeEditors.push(enhanceRTextarea(answer, {renderCode:rCodeFragment}));
      await this.mutate(()=>learningStore.recordAIExerciseView(row.id));
    }
  }
}
