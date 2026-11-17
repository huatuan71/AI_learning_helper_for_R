import {learningStore} from './learning-store.js?v=learning-v1';
import {buildReviewQueue} from './review-scheduler.js?v=learning-v1';
import {getOfflineStatus, downloadOffline, getOfflineCourse} from './offline.js?v=learning-v1';
import {LearningSummaryUI} from './learning-summary-ui.js?v=ai-summary-v1';

const $ = id => document.getElementById(id);
const SESSION_KEY = 'r-tutor-review-session-v1';
const TABS = ['overview', 'review', 'summary', 'records'];
const GRADES = {again:'未掌握', hinted:'提示完成', good:'独立完成', easy:'熟练完成'};
const day = value => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};
const independent = attempt => ['good','easy'].includes(attempt.grade) && !!attempt.answerText?.trim() && !attempt.hintUsed && !attempt.answerRevealed;
function node(tag, text, cls) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (cls) result.className = cls;
  return result;
}
function action(text, handler, cls = '') {
  const result = node('button', text, cls);
  result.type = 'button';
  result.onclick = handler;
  return result;
}
function link(text, href) {
  const result = node('a', text);
  result.href = href;
  return result;
}
function section(title, cls = '') {
  const result = node('section', undefined, 'lc-section ' + cls);
  result.append(node('h2', title));
  return result;
}
function disclosure(title) {
  const result = node('details');
  result.append(node('summary', title));
  return result;
}
export function downloadText(value, filename, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([value], {type}));
  const anchor = link('', url);
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export class LearningCenter {
  constructor({units, openKnowledge, openConversation, openExport, api, codeBlock, onSnapshot, notify,
    getModelConfig, refreshModelConfig, openModelSettings}) {
    Object.assign(this, {units, openKnowledge, openConversation, openExport, api, codeBlock, onSnapshot, notify});
    this.tab = 'overview';
    this.catalog = [];
    this.bank = [];
    this.session = null;
    this.summaryRange = {mode:'week', start:day(Date.now()-6*86400000), end:day(Date.now())};
    this.saving = false;
    this.renderToken = 0;
    this.summaryUI = new LearningSummaryUI({getModelConfig, refreshModelConfig, openModelSettings, notify,
      openKnowledge, openConversation, download:downloadText,
      title:id => this.catalog.find(item => item.id === id)?.title || null,
      practice:async id => {if (await this.enroll(id)) location.hash = '/history/review';}});
    window.addEventListener('beforeprint', () => {
      this.printDetails = [...document.querySelectorAll('#learning-report details')].map(item => [item,item.open]);
      this.printDetails.forEach(([item]) => {item.open=true;});
    });
    window.addEventListener('afterprint', () => this.printDetails?.forEach(([item,open]) => {item.open=open;}));
  }
  feedback(text = '', error = false) {
    $('learning-feedback').textContent = text;
    $('learning-feedback').classList.toggle('error', error);
    if (error && document.body.dataset.view !== 'history') this.notify?.(text,true);
  }
  async run(operation) {
    try { return await operation(); }
    catch (error) { this.feedback(error.message || '操作失败，请重试。', true); }
  }
  async start(legacy) {
    await learningStore.ready();
    await learningStore.migrateLegacy(legacy);
    this.data = await learningStore.snapshot();
    this.course = this.data.course || await getOfflineCourse().catch(() => null);
    this.onSnapshot(this.data);
    try {
      const response = await fetch('/static/review-bank.json?v=learning-v1');
      if (!response.ok) throw Error('复习题库暂不可用，请重试。');
      this.bank = (await response.json()).items;
    } catch (error) { this.feedback(error.message, true); }
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (saved?.version === 1 && saved.day === day(Date.now()) && Array.isArray(saved.tasks)) {
        saved.tasks = saved.tasks.filter(task => this.bank.some(q => q.id === task.questionId && q.knowledgeId === task.card.knowledgeId && q.type === task.card.type));
        this.session = saved;
      }
    } catch { this.session = null; }
    learningStore.subscribe(() => this.run(async () => {
      this.data = await learningStore.snapshot();
      const archiveReset = !this.data.events.length && !this.data.cards.length && !this.data.attempts.length;
      if (archiveReset) {
        this.session = null;
        this.persistSession();
      }
      if (this.data.course) this.course = this.data.course;
      this.onSnapshot(this.data);
      const limit=$('learning-tools-content').querySelector('select');
      if(limit)limit.value=this.data.settings.dailyLimit||6;
      const editing = $('learning-content').contains(document.activeElement) && document.activeElement.matches('textarea,input');
      if (!this.saving && (archiveReset || !editing) && document.body.dataset.view === 'history') await this.render();
    }));
    this.route();
    this.renderTools();
  }
  setCatalog(items, relations, course = null) {
    this.catalog = items;
    this.relations = relations;
    if (course) this.course = course;
    this.run(() => this.render());
  }
  async ingest(record) {
    const result = await learningStore.ingestConversation(record);
    this.data = await learningStore.snapshot();
    return result;
  }
  async clearConversations() { await learningStore.clearConversations(); }
  async exportConversations() {
    const data = await learningStore.snapshot();
    downloadText(JSON.stringify({version:'1.2.1', records:data.conversations.map(item => item.record)}, null, 2), 'r-tutor-conversations.json', 'application/json;charset=utf-8');
  }
  async exportArchive() {
    const data = await learningStore.exportArchive();
    downloadText(JSON.stringify(data,null,2),'r-tutor-learning-archive.json','application/json;charset=utf-8');
  }
  async visit(id) { return this.run(() => learningStore.recordVisit(id)); }
  async enroll(id) {
    return this.run(async () => {
      await learningStore.enroll(id);
      if (!this.session?.tasks.some(task => !this.data.attempts.some(attempt => attempt.id === task.id))) {
        this.session=null;this.persistSession();
      }
      this.feedback(`${id} 已加入复习。`);
      return true;
    });
  }
  async bookmark({knowledgeId = null, conversationId = null, title}) {
    return this.run(async () => {
      const id = conversationId ? `conversation:${conversationId}` : `knowledge:${knowledgeId}`;
      const existing = this.data.bookmarks.find(item => item.id === id);
      if (existing) { this.feedback('已收藏，可在复习页修改备注。'); return true; }
      const at = new Date().toISOString();
      await learningStore.saveBookmark({id, knowledgeId, conversationId, title:String(title).slice(0,1000), note:'', createdAt:at, updatedAt:at});
      this.feedback('已收藏，可在复习页添加备注。');
      return true;
    });
  }
  route() {
    if (!location.hash.startsWith('#/history')) return;
    const requested = location.hash.split('/')[2] || 'overview';
    this.tab = TABS.includes(requested) ? requested : 'overview';
    document.querySelectorAll('[data-learning-tab]').forEach((tab, index, tabs) => {
      const selected = tab.dataset.learningTab === this.tab;
      if (selected) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
      tab.onkeydown = event => {
        const step = {ArrowRight:1, ArrowLeft:-1}[event.key];
        let next;
        if (step) next = (index+step+tabs.length)%tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length-1;
        if (next === undefined) return;
        event.preventDefault(); tabs[next].focus(); tabs[next].click();
      };
    });
    this.run(() => this.render());
  }
  knowledgeLink(id, text) { return action(text || this.title(id), () => this.openKnowledge(id), 'lc-topic'); }
  title(id) { return `${id} · ${this.catalog.find(item => item.id === id)?.title || id}`; }
  queue() {
    return buildReviewQueue({cards:this.data.cards, events:this.data.events, attempts:this.data.attempts,
      knowledge:this.catalog, now:new Date().toISOString(), timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      limit:this.data.settings.dailyLimit || 6});
  }
  async render() {
    if (!this.data) return;
    const token = ++this.renderToken;
    const root = $('learning-content');
    $('learning-records').hidden = this.tab !== 'records';
    root.hidden = this.tab === 'records';
    root.replaceChildren();
    if (this.tab === 'overview') this.renderOverview(root);
    if (this.tab === 'review') this.renderReview(root);
    if (this.tab === 'summary') await this.renderSummary(root, token);
    if (this.tab === 'records') this.renderConversationList();
  }
  renderOverview(root) {
    const visited = new Set(this.data.events.map(event => event.knowledgeId));
    const viewed = new Set(this.data.events.filter(event => event.kind === 'view').map(event => event.knowledgeId));
    const studied = new Set(this.data.events.filter(event => ['study','debug','exercise_view'].includes(event.kind)).map(event => event.knowledgeId));
    const practiced = new Set(this.data.attempts.map(attempt => attempt.cardId.split(':')[0]));
    const mastered = new Set(this.data.attempts.filter(independent).map(attempt => attempt.cardId.split(':')[0]));
    const due = this.data.cards.filter(card => Date.parse(card.dueAt) <= Date.now());
    const today = this.data.attempts.filter(attempt => day(attempt.at) === day(Date.now()));
    const hero = node('div', undefined, 'lc-hero');
    const heading = node('div');
    heading.append(node('h2', visited.size ? '接着上次，继续学习。' : '从一个知识点开始。'),
      node('p', visited.size ? '回看学过的内容，完成一次独立回忆。' : '浏览课程或向助教提问，建立你的学习记录。', 'muted'));
    hero.append(heading, link(due.length ? '开始复习 →' : '浏览知识地图 →', due.length ? '#/history/review' : '#/knowledge'));
    root.append(hero);
    const stats = node('dl', undefined, 'lc-stats');
    for (const [label, value] of [['学习主题',visited.size],['待复习卡片',due.length],['今日作答',today.length],['独立完成主题',mastered.size]]) {
      const metric = node('div'); metric.append(node('dt',label),node('dd',String(value))); stats.append(metric);
    }
    root.append(stats);
    const grid = node('div', undefined, 'lc-overview-grid');
    const units = section('单元进度');
    units.append(node('p','按有独立完成证据的知识点计算。','muted lc-caption'));
    for (const unit of this.units) {
      const items = this.catalog.filter(item => item.chapter === unit);
      const completed = items.filter(item => mastered.has(item.id)).length;
      const row = node('div', undefined, 'lc-unit');
      const label = node('div', undefined, 'lc-row');
      label.append(node('h3',unit),node('span',`${completed} / ${items.length}`,'muted'));
      const progress = node('progress'); progress.max = Math.max(items.length,1); progress.value = completed;
      progress.setAttribute('aria-label',unit + '独立完成进度');
      row.append(label,progress);
      const topics = disclosure('查看知识状态');
      for (const item of items) {
        const states = [];
        if (viewed.has(item.id)) states.push('已浏览');
        if (studied.has(item.id)) states.push('已学习');
        if (practiced.has(item.id)) states.push('已练习');
        if (mastered.has(item.id)) states.push('独立完成');
        if (due.some(card => card.knowledgeId === item.id)) states.push('待复习');
        const entry = node('div',undefined,'lc-topic-status');
        entry.append(this.knowledgeLink(item.id),node('small',states.join(' · ') || '待开始','muted'));
        topics.append(entry);
      }
      row.append(topics); units.append(row);
    }
    const activity = section('最近活动');
    const latest = [...this.data.events.map(event => ({...event, label:{view:'浏览知识',study:'学习讲解',exercise_view:'查看练习',debug:'代码纠错',enroll:'加入复习'}[event.kind] || '学习'})),
      ...this.data.attempts.map(attempt => ({...attempt, knowledgeId:attempt.cardId.split(':')[0],label:GRADES[attempt.grade]}))]
      .sort((a,b) => b.at.localeCompare(a.at)).slice(0,6);
    if (!latest.length) activity.append(node('p','还没有学习活动。','muted'),link('去AI问答 →','#/chat'));
    for (const item of latest) {
      const row = node('div',undefined,'lc-activity');
      row.append(node('small',`${new Date(item.at).toLocaleString('zh-CN')} · ${item.label}`,'muted'),this.knowledgeLink(item.knowledgeId));
      if (item.conversationId) row.append(action('返回对话',() => this.openConversation(item.conversationId)));
      activity.append(row);
    }
    grid.append(units,activity); root.append(grid);
    const rules = disclosure('统计口径');
    rules.append(node('p','学习主题按学习事件中的知识编号去重。待复习按已到期卡片计数，每个主题含概念与应用两张卡。今日作答按设备本地日期统计已提交记录。独立完成主题按至少一次有效独立作答的知识编号去重，要求答案非空、评级为独立或熟练，且锁定前未用提示、未查看答案。浏览与讲解记录计入学习主题。'));
    root.append(rules);
  }
  persistSession() {
    try {
      if (this.session) localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
      else localStorage.removeItem(SESSION_KEY);
    } catch { this.feedback('当前浏览器无法保存待作答草稿，请完成后提交。',true); }
  }
  createSession() {
    const queue = this.queue();
    const tasks = queue.map(({card,reason}) => {
      const questions = this.bank.filter(q => !q.variantOf && q.knowledgeId === card.knowledgeId && q.type === card.type);
      const previous = this.data.attempts.filter(item => item.cardId === card.id).length;
      const question = questions[previous % questions.length];
      return question ? {card,reason,questionId:question.id,id:crypto.randomUUID(),createdAt:new Date().toISOString(),answer:'',choice:null,
        locked:false,hintUsed:false,answerRevealed:false,showReference:false,variantChoice:null,variantPassed:false,skipped:false} : null;
    }).filter(Boolean);
    if (tasks.length < queue.length) this.feedback(`${queue.length-tasks.length} 项任务缺少对应题目，已保留卡片，更新资料后可重新生成任务。`,true);
    this.session = {version:1, day:day(Date.now()), tasks, index:0};
    this.persistSession();
  }
  renderReview(root) {
    const intro = node('div',undefined,'lc-row');
    intro.append(node('h2','今日复习'),node('span',`每次 ${this.data.settings.dailyLimit || 6} 题`,'muted'));
    root.append(intro);
    if (!this.catalog.length) {root.append(node('p','正在读取课程资料…'));return;}
    if (this.session?.day !== day(Date.now())) this.session = null;
    if (this.session?.tasks.length === 0 && this.queue().length) this.session = null;
    if (!this.session) this.createSession();
    const tasks = this.session.tasks;
    const submitted = new Set(this.data.attempts.map(attempt => attempt.id));
    for (const task of tasks) {
      if (this.data.attempts.some(attempt => attempt.cardId === task.card.id && attempt.id !== task.id &&
          Date.parse(attempt.at) >= Date.parse(task.createdAt || task.card.updatedAt))) submitted.add(task.id);
    }
    const pending = tasks.filter(task => !submitted.has(task.id));
    const task = tasks[this.session.index];
    if (!task || submitted.has(task.id)) {
      const panel = section(pending.length ? '还有待处理题目' : tasks.length ? '本轮已完成' : '当前没有到期任务', 'lc-paper');
      panel.append(node('p',pending.length ? `${pending.length} 题已保留，可以继续作答。` : tasks.length ? `已提交 ${tasks.length} 次作答。下次检测按复习安排进行。` : '在知识详情中选择“加入复习”，或等待已学内容到期。','muted'));
      if (pending.length) panel.append(action('继续待处理题',() => {this.session.index = tasks.indexOf(pending[0]);this.persistSession();this.render();},'primary'));
      panel.append(action('刷新今日任务',() => {this.session = null;this.render();}),link('知识地图 →','#/knowledge'));
      root.append(panel);
    } else this.renderQuestion(root, task);
    this.renderBookmarks(root);
  }
  renderQuestion(root, task) {
    const question = this.bank.find(item => item.id === task.questionId);
    if (!question) {root.append(node('p','这道题的资料暂不可用。请更新离线资料后重试。')); return;}
    const panel = section(this.title(task.card.knowledgeId),'lc-paper lc-question');
    panel.dataset.questionId = question.id;
    panel.append(node('p',`${task.card.type === 'concept' ? '概念回忆' : '应用练习'} · ${this.session.index+1} / ${this.session.tasks.length}`,'lc-caption muted'),
      node('p',task.reason,'lc-reason'),node('h3',question.prompt));
    if (question.code) this.codeBlock(panel,question.code,'题目代码',true);
    if (task.submission) {
      panel.append(node('p',task.submission.answerText || '本次未填写答案。'),
        node('p',`待保存评级 · ${GRADES[task.submission.grade]}`),
        node('p','重试将沿用本次答案、评级、时间和编号。','muted'));
      const retry = action('重试保存本次评级',() => this.submit(task,question,task.submission.grade),'primary');
      retry.disabled = this.saving;
      panel.append(retry);
      root.append(panel);
      return;
    }
    let input;
    if (question.format === 'choice') {
      input = node('fieldset',undefined,'lc-choices'); input.append(node('legend','选择你的答案'));
      question.choices.forEach((choice,index) => {
        const label = node('label'); const radio = node('input');
        radio.type = 'radio'; radio.name = 'review-choice'; radio.value = index; radio.checked = task.choice === index; radio.disabled = task.locked;
        radio.onchange = () => {task.choice=index;task.answer=choice;this.persistSession();};
        label.append(radio,node('span',choice)); input.append(label);
      });
    } else {
      const label = node('label','你的回答');label.htmlFor='review-answer'; panel.append(label);
      input = node('textarea');input.id='review-answer';input.rows=4;input.maxLength=12000;input.value=task.answer;input.readOnly=task.locked;
      input.placeholder='先回忆，再写下思路或代码…';
      input.oninput = () => {task.answer=input.value;this.persistSession();};
    }
    panel.append(input);
    const controls = node('div',undefined,'lc-actions');
    if (!task.locked) controls.append(action('锁定答案',() => {
      if (!task.answer.trim()) {this.feedback('请先作答，或选择“未掌握，进入重学”。',true);return;}
      task.locked = true;task.evidence={hintUsed:task.hintUsed,answerRevealed:task.answerRevealed};this.persistSession();this.render();
    },'primary'));
    controls.append(action('解题提示',() => {if(!task.locked)task.hintUsed=true;task.showHint=true;this.persistSession();this.render();}),
      action('参考答案',() => {if(!task.locked)task.answerRevealed=true;task.showReference=true;this.persistSession();this.render();}));
    panel.append(controls);
    if (task.showHint) panel.append(node('p',question.hint,'lc-hint'));
    if (task.showReference) panel.append(node('h3','参考要点'),node('p',question.reference,'lc-reference'));
    const source = disclosure('题目与答案来源');
    for (const ref of question.sourceRefs || []) source.append(this.knowledgeLink(ref.knowledgeId,`${ref.knowledgeId} · ${ref.field}${ref.locator ? ' · '+ref.locator : ''}`));
    panel.append(source);
    if (task.locked) this.renderAssessment(panel,task,question);
    else panel.append(action('未掌握，进入重学',() => this.submit(task,question,'again')));
    panel.append(action('跳过，保留待处理',() => {task.skipped=true;this.session.index++;this.persistSession();this.render();}));
    root.append(panel);
  }
  renderAssessment(panel,task,question) {
    const assisted = task.evidence.hintUsed || task.evidence.answerRevealed;
    const correct = question.format === 'choice' ? task.choice === question.correctIndex : null;
    panel.append(node('p',correct === null ? '对照参考要点自评。' : correct ? '客观判分 · 回答正确' : '客观判分 · 请重学后再试', 'lc-assessment'));
    const variant = this.bank.find(item => item.variantOf === question.id && item.format === 'choice');
    if (variant && !assisted && correct !== false) {
      const part = disclosure('完成变式，验证熟练程度');
      part.open = task.variantChoice !== null;
      part.append(node('p',variant.prompt));
      if (variant.code) this.codeBlock(part,variant.code,'变式代码',true);
      variant.choices.forEach((choice,index) => {
        const b = action(choice,() => {
          task.variantChoice=index;task.variantPassed=index===variant.correctIndex;this.persistSession();this.render();
        },'lc-variant');
        b.disabled = task.variantChoice !== null;part.append(b);
      });
      if (task.variantChoice !== null) part.append(node('p',task.variantPassed ? '变式通过。' : '变式未通过，可按本题表现自评。'),node('p',variant.reference));
      for (const ref of variant.sourceRefs || []) part.append(this.knowledgeLink(ref.knowledgeId,`${ref.knowledgeId} · ${ref.field}`));
      panel.append(part);
    }
    const grades = node('div',undefined,'lc-actions lc-grades');
    for (const grade of Object.keys(GRADES)) {
      const b = action(GRADES[grade],() => this.submit(task,question,grade),grade === 'good' ? 'primary' : '');
      b.disabled = this.saving || (grade !== 'again' && correct === false) || (['good','easy'].includes(grade) && assisted) || (grade === 'easy' && !task.variantPassed);
      grades.append(b);
    }
    panel.append(grades,node('p',assisted ? '锁定前已使用提示或答案，本题最高可选“提示完成”。' : variant ? '熟练完成需要独立回答正确并通过变式。开放题依据参考要点自评。' : '本题暂缺可核验变式，可评为独立完成。','lc-caption muted'));
  }
  async submit(task,question,grade) {
    if (this.saving) return;
    this.saving=true;
    document.querySelectorAll('.lc-question button').forEach(b => {b.disabled=true;});
    try {
      const evidence = task.evidence || task;
      if (!task.submission) task.submission = {id:task.id,cardId:task.card.id,questionId:question.id,
        at:task.submittedAt || (task.submittedAt=new Date().toISOString()),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,
        grade,answerText:task.answer,hintUsed:evidence.hintUsed,answerRevealed:evidence.answerRevealed,
        variantPassed:task.variantPassed,assessmentSource:question.format === 'choice' ? 'objective' : 'self'};
      this.persistSession();
      const result = await learningStore.saveAttempt(task.submission);
      this.data = await learningStore.snapshot();
      this.session.index++;
      this.persistSession();
      this.feedback(`已保存 · ${GRADES[result.attempt.grade]}。${grade === 'again' ? '可回到知识详情查看讲解。' : ''}`);
    } catch (error) {this.feedback(error.message || '保存失败，请重试。',true);this.persistSession();}
    finally {
      this.saving=false;await this.render();
      const next=$('learning-content').querySelector('.lc-section h2');
      if(next){next.tabIndex=-1;next.focus({preventScroll:true});next.scrollIntoView({block:'start',behavior:'instant'});}
    }
  }
  renderBookmarks(root) {
    const collection = section('难点收藏');
    if (!this.data.bookmarks.length) collection.append(node('p','在知识详情或已完成的回答中收藏，在这里写下难点。','muted'));
    for (const bookmark of this.data.bookmarks) {
      const item = node('article',undefined,'lc-bookmark');
      const heading = node('div',undefined,'lc-row');
      heading.append(node('h3',bookmark.title),action('移除',() => this.run(() => learningStore.removeBookmark(bookmark.id))));
      item.append(heading);
      if (bookmark.conversationId) item.append(action('返回对话',() => this.openConversation(bookmark.conversationId)));
      if (bookmark.knowledgeId) item.append(this.knowledgeLink(bookmark.knowledgeId));
      const detail = disclosure(bookmark.note ? '查看 / 修改个人备注' : '添加个人备注');
      if (bookmark.note) item.append(node('p',bookmark.note,'lc-note'));
      const label = node('label','个人备注');
      const input = node('textarea'); input.rows=2;input.maxLength=6000;input.value=bookmark.note;label.append(input);
      const save = action('保存备注',() => this.run(async () => {
        await learningStore.saveBookmark({...bookmark,note:input.value,updatedAt:new Date().toISOString()});
        this.feedback('备注已保存。');input.blur();await this.render();
      }));
      detail.append(label,save);item.append(detail);collection.append(item);
    }
    root.append(collection);
  }
  renderConversationList() {
    const root = $('history-list'); root.replaceChildren();
    const conversations = [...this.data.conversations].reverse();
    if (!conversations.length) {root.append(node('p','还没有对话记录。','empty-state'),link('去AI问答 →','#/chat'));return;}
    let shown=0;
    const more = action('显示更多',append);
    const self=this;
    function append() {
      for (const {id,record} of conversations.slice(shown,shown+30)) {
        const row=action('',() => self.openConversation(id),'history-row');
        const text=node('span');text.append(node('strong',record.display_question || record.request.question || '代码纠错'),node('small',record.response.answer.summary.slice(0,90)));
        row.append(text,node('time',new Date(record.time).toLocaleString('zh-CN')));root.insertBefore(row,more);
      }
      shown+=30;more.hidden=shown>=conversations.length;
    }
    root.append(more);append();
  }
  async detail(id) {
    const cached=this.course?.knowledge?.find(item => item.id===id);
    return this.api('/api/knowledge/'+encodeURIComponent(id)).catch(() => cached || null);
  }
  async renderSummary(root,token) {
    const controls=node('div',undefined,'lc-summary-controls');
    const select=node('select');select.id='summary-period';select.setAttribute('aria-label','小结日期范围');
    for(const [value,text] of [['today','今日'],['week','最近7天'],['custom','自选范围']]) {
      const option=node('option',text);option.value=value;select.append(option);
    }
    select.value=this.summaryRange.mode;
    select.onchange=() => {
      this.summaryRange.mode=select.value;
      if(select.value!=='custom') {this.summaryRange.end=day(Date.now());this.summaryRange.start=day(Date.now()-(select.value==='week'?6:0)*86400000);}
      this.render();
    };
    controls.append(select);
    if(this.summaryRange.mode==='custom') for(const [key,label] of [['start','开始日期'],['end','结束日期']]) {
      const wrap=node('label',label);const input=node('input');input.type='date';input.value=this.summaryRange[key];input.setAttribute('aria-label',label);
      input.onchange=() => {this.summaryRange[key]=input.value;this.render();};wrap.append(input);controls.append(wrap);
    }
    root.append(controls);
    const {start,end}=this.summaryRange;
    if(!start||!end||start>end) {root.append(node('p','请选择有效日期，结束日期应晚于或等于开始日期。','error'));return;}
    const within=value => day(value)>=start && day(value)<=end;
    const events=this.data.events.filter(item=>within(item.at));
    const attempts=this.data.attempts.filter(item=>within(item.at));
    const conversations=this.data.conversations.filter(item=>within(item.record.time));
    const ids=[...new Set([...events.map(item=>item.knowledgeId),...attempts.map(item=>item.cardId.split(':')[0])])];
    const report=node('article',undefined,'lc-report lc-paper');report.id='learning-report';
    report.append(node('h2','学习小结'),node('p',`${start} 至 ${end} · 本地课程与记录模板生成`,'muted'),
      node('p',`${ids.length} 个主题 · ${events.length} 次学习事件 · ${attempts.length} 次作答 · ${attempts.filter(independent).length} 次独立完成 · ${conversations.length} 条对话`));
    const output=node('div',undefined,'lc-actions lc-no-print');
    output.append(action('导出文本周报',()=>downloadText(report.innerText,`r-tutor-weekly-report_${start}_${end}.txt`)),action('打印',()=>window.print()));
    root.append(output,report);
    await this.summaryUI.mount({controls, root, before:output, report, snapshot:this.data,
      period:{start_date:start, end_date:end, time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone},
      isCurrent:() => token === this.renderToken});
    if(token!==this.renderToken)return;
    if(!ids.length) report.append(node('p','这段时间还没有学习事件或作答。'),link('浏览知识地图 →','#/knowledge'));
    const details=await Promise.all(ids.map(id=>this.detail(id)));
    if(token!==this.renderToken)return;
    ids.forEach((id,index)=>{
      const k=details[index];const part=section(this.title(id));
      part.append(this.knowledgeLink(id,'返回知识点'));
      const records=conversations.filter(item=>item.record.response.related_knowledge?.[0]===id);
      for(const item of records) part.append(action('返回对话 · '+(item.record.display_question||item.record.request.question||'代码纠错'),()=>this.openConversation(item.id)));
      part.append(node('h3','课程要点'),node('p',k?.fields?.['解释'] || '课程详情暂不可用，请更新离线资料。'));
      if(k?.fields?.['运行示例']) {const code=disclosure('典型代码 · 未运行验证');this.codeBlock(code,k.fields['运行示例'],'课程示例',true);part.append(code);}
      part.append(node('h3','主要易错点'),node('p',k?.fields?.['易错提醒']||'该条目暂缺课程易错说明。'));
      const failed=attempts.filter(item=>item.cardId.startsWith(id+':')&&!independent(item));
      part.append(node('p',`本范围 ${attempts.filter(item=>item.cardId.startsWith(id+':')).length} 次作答，${failed.length} 次需继续巩固。`,'muted'));
      part.append(node('h3','下一步'),node('p',failed.length?'回看易错点，在下次检测中独立回忆。':this.data.cards.some(card=>card.knowledgeId===id)?'按卡片到期时间继续检测。':'加入复习，建立概念与应用检测。'));
      const sources=disclosure('课程来源');
      for(const ref of k?.sources||[])sources.append(node('p',`${ref.file} · ${ref.locator}`));part.append(sources);
      report.append(part);
    });
    report.append(node('p','统计按设备本地日期筛选。主题由学习事件和作答的知识编号去重。独立完成计数要求非空答案、独立或熟练评级，且锁定前未用提示或答案。易错点来自课程资料，巩固次数来自本范围作答。','lc-caption muted'));
  }
  async renderTools() {
    const root = $('learning-tools-content');
    root.replaceChildren();
    const settings = section('复习设置');
    const label = node('label','每次题数');
    const limit = node('select');
    limit.setAttribute('aria-label','每次题数');
    for (let count=3; count<=12; count++) {
      const option = node('option',String(count));
      option.value=count;
      limit.append(option);
    }
    limit.value = this.data.settings.dailyLimit || 6;
    limit.onchange = () => this.run(async () => {
      await learningStore.saveSettings({dailyLimit:Number(limit.value)});
      this.feedback('已保存，下轮任务生效。');
    });
    label.append(limit);
    settings.append(label);

    const archive = section('学习档案');
    archive.append(node('p','保存文件可用于跨设备导入。导入时合并记录并去重。','muted'));
    const file = node('input');
    file.type='file';
    file.accept='.json,application/json';
    file.id='learning-import';
    file.setAttribute('aria-label','选择学习档案文件');
    file.onchange = () => this.run(async () => {
      const selected = file.files[0];
      if (!selected) return;
      try {
        if (selected.size > 20*1024*1024) throw Error('档案超过20MB，请选择较小的有效档案。');
        let data;
        try { data=JSON.parse(await selected.text()); }
        catch { throw Error('文件无法解析，请选择有效的JSON学习档案。'); }
        const result = await learningStore.importArchive(data);
        this.data = await learningStore.snapshot();
        this.session = null;
        this.persistSession();
        this.onSnapshot(this.data);
        await this.render();
        await this.renderTools();
        this.feedback(`${selected.name} · 导入 ${result.imported} 项，重复 ${result.duplicates} 项。`);
      } finally { file.value=''; }
    });
    archive.append(action('导出学习档案', event => this.openExport(event.currentTarget)),file);

    const reset = disclosure('重置个人学习档案');
    reset.append(node('p','将清除对话、学习事件、复习、收藏和个人设置。'));
    const confirm = node('label');
    const checkbox = node('input');
    checkbox.type='checkbox';
    confirm.append(checkbox,node('span','我确认清除个人学习档案'));
    const resetButton = action('确认重置', () => this.run(async () => {
      if (!checkbox.checked) return;
      await learningStore.resetLearningData();
      localStorage.removeItem('r-tutor-mock-v1');
      this.session = null;
      this.persistSession();
      this.data = await learningStore.snapshot();
      this.onSnapshot(this.data);
      await this.render();
      await this.renderTools();
      this.feedback('个人学习档案已重置。');
    }));
    resetButton.disabled=true;
    checkbox.onchange = () => { resetButton.disabled=!checkbox.checked; };
    reset.append(confirm,resetButton);
    archive.append(reset);

    const offline = section('离线资料');
    const state = node('p','正在检查离线资料…','muted');
    const progress = node('progress');
    progress.hidden=true;
    progress.setAttribute('aria-label','离线资料下载进度');
    const download = action('保存离线资料', () => this.run(async () => {
      download.disabled=true;
      progress.hidden=false;
      state.textContent='准备下载…';
      try {
        const result = await downloadOffline(({completed,total}) => {
          progress.max=total||1;
          progress.value=completed;
          state.textContent=`已下载 ${completed} / ${total} 项`;
        });
        const persisted = result.persistence?.granted ?? await navigator.storage?.persisted?.().catch(() => false);
        await learningStore.saveCourse(result.course);
        this.course=result.course;
        state.textContent=`版本 ${result.knowledgeVersion} · ${result.assetCount} 项 · ${new Date(result.downloadedAt).toLocaleString('zh-CN')} · ${persisted?'已获持久存储':'浏览器常规存储'}`;
        download.textContent='更新离线资料';
        this.feedback('离线资料已保存。刷新页面以加载已保存版本。');
      } catch (error) {
        const previous = await getOfflineStatus().catch(() => null);
        state.textContent = previous?.ready
          ? `下载未完成 · 可用版本 ${previous.knowledgeVersion} · ${previous.assetCount} 项`
          : '下载未完成，请重试。';
        throw error;
      } finally {
        download.disabled=false;
        progress.hidden=true;
      }
    }));
    offline.append(state,progress,download);
    root.append(settings,archive,offline);
    try {
      const status = await getOfflineStatus();
      const emptyMessage = status.supported ? '尚未保存离线资料。' : '当前浏览器不支持离线资源缓存。';
      state.textContent = status.ready
        ? `版本 ${status.knowledgeVersion} · ${status.assetCount} 项 · ${new Date(status.downloadedAt).toLocaleString('zh-CN')}`
        : status.error || emptyMessage;
      download.textContent = status.ready ? '更新离线资料' : '保存离线资料';
      download.disabled = !status.supported;
    } catch (error) {
      state.textContent = error.message || '离线状态读取失败。';
    }
  }
}
