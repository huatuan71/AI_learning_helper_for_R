'use strict';
import {markdownFragment} from './answer-markdown.js?v=learning-v1';
const $ = id => document.getElementById(id);
function syncViewportWidth() {
  document.documentElement.style.setProperty('--viewport-width', `${window.innerWidth}px`);
}
syncViewportWidth();
window.addEventListener('resize', syncViewportWidth, {passive:true});
const STORE = 'r-tutor-mock-v1';
const UNITS = ['环境与自助学习','类型与缺失','向量与字符串','矩阵与数组','数据框','列表与批量处理','函数与控制','综合与包扩展'];
const mobile = matchMedia('(max-width:760px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let records = [], knowledge = [], relations = [], activeId = null, busy = false;
let currentView = '', pendingRecord = null;
let pendingLatestScroll = false;
let skipNextHashRoute = false, activeViewAnimation = null, routeSequence = 0;
const FOLLOW_LABELS = {'举个例子':'例题','有什么易错点':'易错点','给我练习':'练习'};
let codeOpen = false, freshContext = false;
let requestController = null;
let learningCenter = null;

function pick(object, fields) {
  return Object.fromEntries(fields.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
}
function safeRecord(record) {
  const response = record.response;
  const result = {
    time: record.time,
    request: pick(record.request, ['session_id','question','task_type','code','error_message','knowledge_id','teaching_mode']),
    response: pick(response, ['request_id','status','mode','task_type','related_knowledge','matched_case_id',
      'prompt_version','knowledge_version','provider','model','used_web_search','search_status','duration_ms']),
  };
  if (typeof record.id === 'string') result.id = record.id;
  result.response.answer = pick(response.answer, ['content_markdown','summary','steps','corrected_code','example_code','expected_output',
    'execution_status','code_kind','follow_ups','is_supplementary']);
  result.response.answer.issues = (response.answer.issues || []).map(issue => pick(issue, ['kind','line','reason']));
  result.response.citations = (response.citations || []).map(source => pick(source, ['knowledge_id','source_id','file','locator','raw']));
  result.response.web_citations = (response.web_citations || []).map(source => pick(source, ['source_id','title','url']));
  result.response.usage = pick(response.usage, ['input_tokens','output_tokens','total_tokens']);
  if (record.display_question) result.display_question = record.display_question;
  return result;
}
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || '[]');
  if (Array.isArray(saved)) records = saved.filter(x => x?.request && typeof x?.response?.answer?.summary === 'string').slice(-100).map(safeRecord);
} catch { records = []; }
activeId = records.at(-1)?.response.related_knowledge?.[0] || null;

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(text, action, cls, request = false) {
  const b = el('button', text, cls);
  b.type = 'button'; b.onclick = action;
  if (request) { b.dataset.request = 'true'; b.disabled = busy; }
  return b;
}
function details(title, cls = '') {
  const node = el('details', undefined, 'secondary-details ' + cls);
  node.append(el('summary', title));
  return node;
}
function status(text = '', error = false) {
  $('status').textContent = text;
  $('status').hidden = !text;
  $('status').classList.toggle('error', error);
}
function save() {
  if (learningCenter) return true;
  try { localStorage.setItem(STORE, JSON.stringify(records.map(safeRecord))); return true; }
  catch { status('浏览器存储不可用，当前记录仍可导出。', true); return false; }
}
async function api(path, body, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store',
    method: body ? 'POST' : 'GET',
    headers: body ? {'Content-Type': 'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
    signal: options.signal || AbortSignal.timeout(body ? (modelSettings.config.mode === 'search' ? 100000 : 70000) : 10000)
  });
  let data;
  try { data = await response.json(); } catch { throw Error('服务返回了无法读取的响应'); }
  if (!response.ok) {
    const error = Error(data.error?.message || '请求失败（' + response.status + '）');
    error.code = data.error?.code;
    error.requestId = data.request_id;
    throw error;
  }
  return data;
}
async function streamApi(path, body, signal, onEvent) {
  const response = await fetch(path, {method:'POST', credentials:'include', cache:'no-store',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal});
  if (!response.ok) {
    const data = await response.json();
    const error = Error(data.error?.message || '请求失败');
    error.code = data.error?.code; error.requestId = data.request_id; throw error;
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw Error('服务返回了无法读取的流式响应');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const {value, done} = await reader.read();
      buffer += decoder.decode(value, {stream:!done});
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0,boundary); buffer = buffer.slice(boundary+2);
        const lines = frame.split('\n');
        const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const dataLines = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart());
        if (!dataLines.length) continue;
        const data = JSON.parse(dataLines.join('\n'));
        if (event === 'done') return data;
        if (event === 'error') {
          const error = Error(data.error?.message || '生成失败');
          error.code = data.error?.code; error.requestId = data.request_id; throw error;
        }
        onEvent(event, data);
      }
      if (done) throw Error('连接提前结束，请重新发送。');
    }
  } finally {
    await reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}

function liveAnswer(question, review) {
  const card = el('article', undefined, 'message streaming-message' + (review ? ' review-message' : ''));
  card.setAttribute('aria-live', 'off'); card.setAttribute('aria-busy', 'true');
  card.append(el('p', question || '审查提交的R代码', 'question'));
  const content = el('div', undefined, 'assistant-answer');
  const label = el('p', '生成中 · 待校验', 'answer-label');
  const body = el('div', undefined, 'answer-body stream-summary');
  content.append(label,body); card.append(content); $('messages').append(card);
  $('welcome').hidden = true; $('review-empty').hidden = true;
  let fields = {};
  return {
    remove: () => card.remove(),
    update(event, data) {
      const scroll = currentView === 'review' ? document.scrollingElement : $('conversation-scroll');
      const follow = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 100;
      if (event === 'status') {
        label.textContent = ({searching:'正在检索网络来源…',preparing:'正在准备…',generating:'生成中 · 待校验',validating:'正在校验回答和引用…',repairing:'正在修复回答结构…'})[data.stage] || '生成中 · 待校验';
      } else if (event === 'reset') fields = {};
      else if (event === 'delta' && typeof data.text === 'string' && /^(content_markdown|summary|corrected_code|example_code|expected_output|steps\.\d+)$/.test(data.field)) {
        fields[data.field] = (fields[data.field] || '') + data.text;
      }
      const steps = Object.keys(fields).filter(key => key.startsWith('steps.'))
        .sort((a,b) => Number(a.slice(6)) - Number(b.slice(6))).map(key => fields[key]);
      renderTeachingBody(body, {...fields, steps}, []);
      if (follow) scroll.scrollTop = scroll.scrollHeight;
    }
  };
}
function showError(error) {
  if (error.name === 'AbortError') { status('请求已取消。'); return; }
  if (error.code === 'SESSION_EXPIRED' || error.code === 'CONFIG_REQUIRED') {
    modelSettings.refresh().catch(() => {});
  }
  const message = error.name === 'TypeError' ? '无法连接本地服务，请启动服务后重试。' :
    error.name === 'TimeoutError' ? '请求超时，请重试。' : error.message;
  status(message + (error.requestId ? '（请求编号 ' + error.requestId + '）' : ''), true);
}
function setBusy(value) {
  busy = value;
  fileInput.locked = value;
  for (const id of ['send','question','code','error-message','code-toggle','clear','history-clear','file-pick','file-remove','code-clear','topic-clear']) $(id).disabled = value;
  document.querySelectorAll('[data-request]').forEach(b => { b.disabled = value; });
  $('send').textContent = value ? '发送中…' : '发送 ↑';
  $('cancel-request').hidden = !value;
}
function setCode(value) {
  if (currentView === 'review') value = true;
  codeOpen = value;
  $('code-panel').hidden = !value;
  $('code-toggle').textContent = value ? '收起代码' : '添加代码';
  $('code-toggle').setAttribute('aria-expanded', String(value));
}
function setMore(value, focus = false) {
  $('more-panel').hidden = !value;
  $('more-toggle').setAttribute('aria-expanded', String(value));
  if (focus) (value ? $('more-panel').querySelector('a') : $('more-toggle')).focus();
}
function selectTopic(id) {
  activeId = id || null;
  const k = knowledge.find(k => k.id === activeId);
  $('current-topic').textContent = k ? k.id + ' · ' + k.title : '';
  $('topic-chip').hidden = !k;
}
function codeBlock(parent, text, label, unverified = false) {
  if (!text) return;
  const wrap = el('div', undefined, 'code-wrap');
  const heading = el('div', undefined, 'code-heading');
  heading.append(el('span', label));
  if (unverified) heading.append(el('span', '未运行验证', 'unverified'));
  const copy = button('复制代码', async () => {
    try { await navigator.clipboard.writeText(text); copy.textContent = '已复制'; }
    catch { status('复制失败，请手动选中代码复制。', true); }
  }, 'copy');
  heading.append(copy); wrap.append(heading, el('pre', text)); parent.append(wrap);
}
function firstSentence(text) {
  const match = text.match(/^.*?[。！？](?:\s*\[W\d+\])*|^[^\n]+\n/u);
  return match ? match[0].trim() : text;
}
function appendProse(node, text, sources = []) {
  const parts = String(text).split(/(\[W\d+\])/g);
  for (const part of parts) {
    const source = sources.find(item => '[' + item.source_id + ']' === part);
    let url;
    try { url = source && new URL(source.url); } catch { url = null; }
    if (url && ['https:','http:'].includes(url.protocol) && !url.username && !url.password) {
      const link = el('a', part, 'web-citation');
      link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = source.title;
      node.append(link);
    } else node.append(document.createTextNode(part));
  }
  return node;
}
function renderTeachingBody(node, answer, sources = []) {
  node.replaceChildren();
  if (answer.content_markdown?.trim()) {
    node.append(markdownFragment(answer.content_markdown));
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const references = [];
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (/\[W\d+\]/.test(text.textContent) && !text.parentElement.closest('code,pre,a')) references.push(text);
    }
    for (const text of references) text.replaceWith(appendProse(el('span'), text.textContent, sources));
    for (const pre of [...node.querySelectorAll('pre')]) {
      const code = pre.querySelector('code');
      const language = code?.className.match(/\blanguage-([\w+-]+)/)?.[1] || '';
      const holder = el('div');
      const label = language.toLowerCase() === 'r' ? 'R代码' : (language ? language + '代码' : '代码');
      codeBlock(holder, (code || pre).textContent.replace(/\n$/, ''), label, true);
      pre.replaceWith(...holder.childNodes);
    }
    return;
  }
  if (answer.summary) node.append(appendProse(el('p'), answer.summary, sources));
  const steps = el('ol', undefined, 'steps');
  (answer.steps || []).forEach(text => steps.append(appendProse(el('li'), text, sources)));
  if (steps.childElementCount) node.append(steps);
  for (const issue of answer.issues || []) {
    const label = ({error:'运行错误',warning:'警告',logic:'逻辑错误'}[issue.kind] || issue.kind) +
      (issue.line == null ? '' : ' · 第' + issue.line + '行');
    node.append(appendProse(el('p'), label + '。' + issue.reason, sources));
  }
  codeBlock(node, answer.corrected_code || answer.example_code, answer.corrected_code ? '参考修正' : '代码讲解', true);
}
function renderRecords() {
  const root = $('messages'); root.replaceChildren();
  $('welcome').hidden = records.length > 0;
  $('review-empty').hidden = records.some(record => record.response.task_type === 'debug');
  for (const [index, record] of records.entries()) {
    const r = record.response, a = r.answer;
    const card = el('article', undefined, 'message' + (r.task_type === 'debug' ? ' review-message' : ''));
    card.id = 'record-' + index; card.tabIndex = -1;
    const user = el('div', undefined, 'question-group');
    user.append(el('p', record.display_question || record.request.question || '审查提交的R代码', 'question'));
    if (record.request.code || record.request.error_message) {
      const submitted = details('提交内容', 'user-code');
      codeBlock(submitted, record.request.code, '提交的代码');
      if (record.request.error_message) submitted.append(el('pre', record.request.error_message));
      user.append(submitted);
    }
    card.append(user);
    const assistant = el('div', undefined, 'assistant-answer');
    assistant.append(el('p', r.task_type === 'debug' ? (r.matched_case_id ? '参考案例 · ' + r.matched_case_id : '代码纠错') : '助教', 'answer-label'));
    if (r.mode && r.mode !== 'mock') {
      assistant.append(el('span', (r.provider || '') + ' · ' + (r.model || '') + (a.is_supplementary ? ' · AI补充' : ''), 'answer-mode'));
      if (r.mode === 'search') assistant.append(el('p', {
        completed:'本轮已获取网络来源', not_triggered:'本轮未触发网页搜索',
        no_results:'搜索未获得可用来源', failed:'本轮搜索失败'
      }[r.search_status] || '本轮未获得网络来源', 'search-notice'));
    }
    if (r.task_type === 'debug' && r.status === 'no_match') assistant.append(el('p','当前资料未匹配到可靠案例。请补充最小复现代码、完整报错和预期结果。','review-advice'));
    const body = el('div', undefined, 'answer-body');
    renderTeachingBody(body, a, r.web_citations);
    assistant.append(body);
    const follow = el('div', undefined, 'followups');
    (a.follow_ups || []).forEach(t => follow.append(button(FOLLOW_LABELS[t] || t, () => {
      navigate('chat'); setCode(false);
      send(t, {knowledgeId: r.related_knowledge?.[0] || null, useComposer: false,
        taskType:t === '给我练习' ? 'exercise' : 'auto', displayQuestion: FOLLOW_LABELS[t] || t});
    }, '', true)));
    if (r.task_type === 'exercise' && record.request.teaching_mode !== 'solution' && r.status === 'ok') {
      follow.append(button('参考答案', () => {
        navigate('chat'); setCode(false);
        send(record.request.question, {knowledgeId:r.related_knowledge?.[0] || null, useComposer:false,
          taskType:'exercise', solution:true, displayQuestion:'参考答案'});
      }, 'solution', true));
    }
    follow.append(button('继续提问', () => $('question').focus()));
    if (learningCenter && record.id) follow.append(button('收藏回答', async event => {
      const target = event.currentTarget;
      const saved = await learningCenter.bookmark({conversationId:record.id, knowledgeId:r.related_knowledge?.[0] || null,
        title:record.display_question || record.request.question || '代码纠错'});
      if (saved) {target.textContent = '已收藏';status('已收藏，可在学习记录的复习页添加备注。');}
    }));
    if (!a.content_markdown && a.expected_output) {
      const output = details('参考输出', 'reference-output');
      output.append(el('p', '预期输出 · 未经运行验证', 'muted'));
      output.append(el('pre',a.expected_output)); assistant.append(output);
    }
    if ((r.citations || []).length) {
      const sources = details('内容来源', 'sources');
      for (const c of r.citations) {
        const row = el('div', undefined, 'source-row');
        row.append(button(c.knowledge_id, () => explainKnowledge(c.knowledge_id), '', true),
          el('span', c.file + ' · ' + c.locator));
        sources.append(row);
      }
      assistant.append(sources);
    }
    if ((r.web_citations || []).length) {
      const sources = details('网络来源', 'web-sources');
      sources.open = true;
      for (const source of r.web_citations) {
        let url;
        try { url = new URL(source.url); } catch { continue; }
        if (!['https:','http:'].includes(url.protocol) || url.username || url.password) continue;
        const link = el('a', '[' + source.source_id + '] ' + source.title, 'web-citation');
        link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
      }
      assistant.append(sources);
    }
    if ((r.related_knowledge || []).length) {
      const related = details('相关知识', 'related-knowledge');
      for (const id of r.related_knowledge) {
        const k = knowledge.find(item => item.id === id);
        related.append(button(id + (k ? ' · ' + k.title : ''), () => explainKnowledge(id), '', true));
      }
      assistant.append(related);
    }
    assistant.append(follow);
    card.append(assistant); root.append(card);
  }
}
function scrollToLatest() {
  if ($('layout').hidden || document.body.dataset.view !== currentView) {
    pendingLatestScroll = true;
    return;
  }
  pendingLatestScroll = false;
  const card = [...$('messages').children].filter(n => currentView !== 'review' || n.classList.contains('review-message')).at(-1);
  if (!card) return;
  if (currentView === 'review') {
    card.scrollIntoView({block:'start',behavior:'instant'});
    return;
  }
  const scroll = $('conversation-scroll');
  const headerHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header'));
  scroll.scrollTop += card.getBoundingClientRect().top - scroll.getBoundingClientRect().top - headerHeight - 20;
}
async function send(question, options = {}) {
  if (busy) return;
  const useComposer = options.useComposer !== false;
  const q = (question ?? $('question').value).trim();
  const includeCode = useComposer && (codeOpen || currentView === 'review');
  if (includeCode && fileInput.reading) { status('文件正在读取，请稍后发送。',true); return; }
  if (includeCode && fileInput.count() > 10000) { status('代码超过10000字符，请精简后再发送。',true); $('code').focus(); return; }
  const code = includeCode ? $('code').value : '';
  const error = includeCode ? $('error-message').value : '';
  if (!q && !code.trim()) { status('请先输入问题或代码。', true); $('question').focus(); return; }
  const historyRecords = freshContext ? [] : records.slice(-6);
  let historyTrimmed = !freshContext && records.length > 6;
  const body = {
    session_id:'local-browser', question:q, task_type:includeCode ? 'debug' : (options.taskType || 'auto'),
    code, error_message:error,
    knowledge_id:options.knowledgeId === undefined ? activeId : options.knowledgeId,
    history:historyRecords.flatMap(x => {
      const oldQuestion = x.request.question || '';
      const oldError = x.request.error_message || '';
      const answer = x.response.answer;
      const previousAnswer = answer.content_markdown || [answer.summary, ...(answer.steps || []),
        ...(answer.issues || []).map(issue => issue.reason), answer.corrected_code || answer.example_code || ''].join('\n\n');
      if (oldQuestion.length > 1500 || oldError.length > 400) historyTrimmed = true;
      return [
        {role:'user',content:[oldQuestion.slice(0,1500), x.request.code || '', oldError.slice(0,400)].join('\n')},
        {role:'assistant',content:previousAnswer}
      ];
    })
  };
  if (body.task_type === 'exercise') body.teaching_mode = options.solution ? 'solution' : 'hint';
  for (const item of body.history) {
    if (item.content.length > 12000) { item.content = item.content.slice(0,12000); historyTrimmed = true; }
  }
  while (body.history.reduce((total, item) => total + item.content.length, 0) > 24000) {
    body.history.splice(0, 2); historyTrimmed = true;
  }
  setBusy(true); status('正在查询…');
  requestController = new AbortController();
  const signal = AbortSignal.any([requestController.signal, AbortSignal.timeout(modelSettings.config.mode === 'search' ? 100000 : 70000)]);
  let draft = null;
  try {
    const path = includeCode ? '/api/review' : '/api/chat';
    let response;
    if (modelSettings.config.mode === 'mock') response = await api(path, body, {signal});
    else {
      draft = liveAnswer(q, includeCode); scrollToLatest();
      response = await streamApi(path + '/stream', body, signal, (event,data) => draft.update(event,data));
    }
    const record = safeRecord({time:new Date().toISOString(), request:body, response,
      ...(options.displayQuestion ? {display_question:options.displayQuestion} : {})});
    let storageError = null;
    if (learningCenter) {
      try { record.id = (await learningCenter.ingest(record)).conversationId; }
      catch (error) { storageError = error; }
    }
    if (record.id) records = records.filter(item => item.id !== record.id);
    records.push(record);
    records = records.slice(-100); freshContext = false;
    renderRecords(); renderHistory(); selectTopic(response.related_knowledge?.[0] || null);
    if (useComposer) $('question').value = '';
    if (save()) status(historyTrimmed ? '较早对话已裁剪，需要分析完整代码时请重新提交。' : '');
    if (storageError) status('回答已生成，学习档案保存失败。' + storageError.message, true);
    scrollToLatest();
  } catch (e) {
    if (draft) { draft.remove(); renderRecords(); }
    showError(e);
  }
  finally { draft?.remove(); requestController = null; setBusy(false); }
}
function explainKnowledge(id) {
  if (busy) return;
  navigate('chat');
  setCode(false);

  const k = knowledge.find(k => k.id === id);
  send('讲解这个知识点', {knowledgeId:id,useComposer:false,displayQuestion:'讲解 ' + id + (k ? ' · ' + k.title : '')});
}

function setNav(value) {
  $('main-nav').classList.toggle('nav-open', value);
  $('nav-toggle').setAttribute('aria-expanded', String(value));
}
function navigate(view, recordIndex = null) {
  pendingRecord = recordIndex;
  if (location.hash === '#/' + view) route();
  else { skipNextHashRoute = true; location.hash = '/' + view; route(); }
}
function route(focus = true) {
  let view = location.hash.slice(2).split('/')[0];
  if (!['home','knowledge','chat','review','history'].includes(view)) {
    view = 'home'; history.replaceState(null, '', '#/home');
  }
  const previousView = currentView;
  const previousLearningTab = learningCenter?.tab;
  const changed = view !== previousView;
  const learning = view === 'chat' || view === 'review';
  const sequence=++routeSequence;
  setNav(false); setMore(false);
  currentView = view;
  const applyView=()=>{
    document.querySelectorAll('#main-nav a').forEach(a => {
      if (a.hash === '#/' + view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (changed && view !== 'knowledge') mapUI.close(false);
    if (typeof mapUI.setActive === 'function') mapUI.setActive(view === 'knowledge');
    document.documentElement.classList.toggle('learning-history', view === 'history');
    document.body.classList.toggle('learning', learning);
    document.body.classList.toggle('review-mode', view === 'review');
    document.body.dataset.view = view;
    const toolbar = document.querySelector('.conversation-toolbar');
    if (view === 'chat') $('conversation-scroll').prepend(toolbar);
    else $('workspace').insertBefore(toolbar, $('conversation-scroll'));
    $('home-view').hidden = view !== 'home';
    $('knowledge-view').hidden = view !== 'knowledge';
    $('history-view').hidden = view !== 'history';
    $('layout').hidden = !learning;
    if (view === 'history') learningCenter?.route();
    $('workspace-title').textContent = view === 'review' ? '代码纠错' : 'AI问答';
    if (changed && learning) setCode(view === 'review');
    $('question').placeholder = view === 'review' ? '问题说明（可选）' : '输入问题，继续学习…';
  };
  const finish=()=>{
    if(sequence!==routeSequence)return;
    if (changed && view === 'knowledge') mapUI.center();
    if (changed || (view === 'history' && previousLearningTab !== learningCenter?.tab)) {
      window.scrollTo({top:0, left:0, behavior:'instant'});
    }
    if (changed) {
      if (focus) (learning ? $('workspace-title') : view === 'knowledge' ? $('map-title') : view === 'history' ? $('history-title') : $('main-content')).focus({preventScroll:true});
    }
    if (learning && pendingLatestScroll) scrollToLatest();
    if (pendingRecord !== null) {
      const node = $('record-' + pendingRecord);
      pendingRecord = null;
      if (node) { node.scrollIntoView({block:'start',behavior:'instant'}); node.focus({preventScroll:true}); }
    }
  };
  const animate=changed&&!!previousView&&!reducedMotion.matches;
  const content = $('main-content');
  activeViewAnimation?.cancel();
  activeViewAnimation = null;
  content.inert = false;
  if (animate) {
    content.inert = true;
    const fadeOut = content.animate([{opacity:1},{opacity:0}], {duration:100,easing:'ease-in',fill:'forwards'});
    activeViewAnimation = fadeOut;
    fadeOut.finished.then(() => {
      if (sequence !== routeSequence) return;
      content.inert = false;
      applyView();
      finish();
      const fadeIn = content.animate([{opacity:0},{opacity:1}], {duration:160,easing:'ease-out'});
      activeViewAnimation = fadeIn;
      fadeOut.cancel();
      fadeIn.finished.catch(() => {});
    }, () => {});
  } else {
    applyView();
    finish();
  }
}
function renderHistory() {
  if (learningCenter?.data) { learningCenter.renderConversationList(); return; }
  const root = $('history-list'); root.replaceChildren();
  if (!records.length) {
    const empty = el('div', '暂无学习记录', 'empty-state');
    const link = el('a', 'AI问答'); link.href = '#/chat'; empty.append(link); root.append(empty); return;
  }
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i];
    const row = button(undefined, () => navigate(record.request.task_type === 'debug' ? 'review' : 'chat', i), 'history-row');
    const text = el('span'); text.append(el('strong', record.display_question || record.request.question || '代码纠错'));
    text.append(el('small', firstSentence(record.response.answer.summary).slice(0,90)));
    const date = new Date(record.time);
    row.append(text, el('time', Number.isNaN(date.getTime()) ? '学习记录' : date.toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})));
    root.append(row);
  }
}
const modelSettings = new window.ModelSettings(status);
const fileInput = new window.RFileInput();
const composer = document.querySelector('.composer-dock');
new ResizeObserver(() => {
  if (currentView === 'chat') {
    $('workspace').style.setProperty('--composer-height', `${composer.getBoundingClientRect().height}px`);
  }
}).observe(composer);
async function courseApi(path) {
  try { return await api(path); }
  catch (error) {
    const id = decodeURIComponent(path.split('/').at(-1));
    const cached = (learningCenter?.course || learningCenter?.data?.course)?.knowledge?.find(item => item.id === id);
    if (cached) return cached;
    throw error;
  }
}
const mapUI = new window.KnowledgeMap({api:courseApi, codeBlock, units:UNITS,
  visit: id => learningCenter?.visit(id),
  enroll: id => learningCenter?.enroll(id),
  bookmark: id => learningCenter?.bookmark({knowledgeId:id,title:id+' · '+knowledge.find(item => item.id===id)?.title}),
  explain: id => explainKnowledge(id),
  exercise: id => { if(busy)return; navigate('chat');setCode(false);send('给我练习',{knowledgeId:id,useComposer:false,taskType:'exercise',displayQuestion:'练习'}); }
});
$('topic-clear').onclick = () => {selectTopic(null); freshContext=true; $('question').focus();};
document.querySelector('.skip-link').onclick = e => { e.preventDefault(); $('main-content').focus(); };
window.addEventListener('hashchange', () => {if(skipNextHashRoute){skipNextHashRoute=false;return;}route();});
$('nav-toggle').onclick = () => { setMore(false); setNav(!$('main-nav').classList.contains('nav-open')); };
document.addEventListener('click', e => {
  if (!e.target.closest('#main-nav') && !e.target.closest('#nav-toggle')) setNav(false);
});
$('main-nav').addEventListener('click', e => { if (e.target.closest('a')) setNav(false); });

$('history-export').onclick = () => $('export').click();
$('history-clear').onclick = () => $('clear').click();
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('in-view'); observer.unobserve(entry.target); }
  }), {threshold:.12});
  document.querySelectorAll('.reveal').forEach(node => observer.observe(node));
}

$('ask-form').onsubmit = e => { e.preventDefault(); send(); };
$('cancel-request').onclick = () => requestController?.abort();
$('code-toggle').onclick = () => { setCode(!codeOpen); if (codeOpen) $('code').focus(); };
$('more-toggle').onclick = () => setMore($('more-panel').hidden);
$('more-toggle').onkeydown = e => { if (e.key === 'ArrowDown') { e.preventDefault(); setMore(true,true); } };
document.addEventListener('click', e => { if (!e.target.closest('.more-wrap')) setMore(false); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if ($('main-nav').classList.contains('nav-open')) { setNav(false); $('nav-toggle').focus(); e.preventDefault(); }
    if (!$('more-panel').hidden) { setMore(false,true); e.preventDefault(); }
  }
});
mobile.addEventListener('change', () => setNav(false));
$('version-open').onclick = () => { setMore(false); $('version-dialog').showModal(); };
$('version-close').onclick = () => $('version-dialog').close();
$('version-dialog').addEventListener('close', () => $('more-toggle').focus());
$('clear').onclick = async () => {
  if (busy) return;
  if (learningCenter) {
    try { await learningCenter.clearConversations(); }
    catch (error) { status(error.message, true); return; }
  }
  records = []; setMore(false); setCode(false); selectTopic(null); renderRecords(); renderHistory();
  if (save()) status();
  if (currentView === 'chat' || currentView === 'review') $('question').focus();
  else if (currentView === 'history') $('history-title').focus();
  else $('more-toggle').focus();
};
$('export').onclick = async () => {
  setMore(false);
  if (learningCenter) {
    try { await learningCenter.exportConversations(); }
    catch (error) {status(error.message,true);}
    return;
  }
  const blob = new Blob([JSON.stringify({version:'1.2.1',records:records.map(safeRecord)},null,2)], {type:'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob), link = el('a');
  link.href = url; link.download = 'R语言学习记录.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.querySelectorAll('[data-example]').forEach(b => {
  b.dataset.request = 'true'; b.onclick = () => { setCode(false); send(b.dataset.example,{useComposer:false}); };
});
$('debug-example').dataset.request = 'true';
$('debug-example').onclick = () => {
  navigate('review'); setCode(true); $('code').value = 'x <- c(1, NA, 3)\nx[x == NA]'; fileInput.detach(); fileInput.count(); $('error-message').value = '';
  send('为什么不能用x == NA判断缺失？');
};
renderRecords(); renderHistory(); route(false);
async function startLearning() {
  try {
    const {LearningCenter} = await import('./learning-center.js?v=learning-v1');
    learningCenter = new LearningCenter({units:UNITS, api:courseApi, codeBlock, notify:status,
      openKnowledge:id => {navigate('knowledge');setTimeout(() => mapUI.select(id),120);},
      openConversation:id => {
        const all = learningCenter.data.conversations;
        const item = all.find(item => item.id===id);
        if (!item) {learningCenter.feedback('该对话已清除。',true);return;}
        records = all.slice(-100).map(item => ({...safeRecord(item.record),id:item.id}));
        if (!records.some(record => record.id===id)) records.unshift({...safeRecord(item.record),id});
        renderRecords();
        navigate(item.record.response.task_type==='debug'?'review':'chat',records.findIndex(record => record.id===id));
      },
      onSnapshot:data => {
        if (busy) return;
        const restored = data.conversations.slice(-100).map(item => ({...safeRecord(item.record),id:item.id}));
        if (JSON.stringify(restored)!==JSON.stringify(records)) {
          records=restored;renderRecords();renderHistory();
        }
      }
    });
    let legacy=[];
    try {const saved=JSON.parse(localStorage.getItem(STORE)||'[]');if(Array.isArray(saved))legacy=saved.filter(item=>item?.request && typeof item?.response?.answer?.summary==='string').map(safeRecord);} catch {}
    await learningCenter.start(legacy);
    try { localStorage.removeItem(STORE); } catch { /* IndexedDB remains usable if legacy storage is denied. */ }
    renderRecords();
  } catch (error) {
    learningCenter=null;
    $('learning-content').textContent='学习模块尚未就绪。'+error.message;
    $('learning-records').hidden=false;
    status('学习模块加载失败，'+error.message,true);
  }
  const [healthResult,catalogResult] = await Promise.allSettled([api('/api/health'),api('/api/knowledge')]);
  const cached = learningCenter?.course;
  if (catalogResult.status==='fulfilled') {
    knowledge=catalogResult.value.items;relations=catalogResult.value.relations||[];
  } else if (cached?.knowledge?.length) {
    knowledge=cached.knowledge;relations=cached.relations||[];
    learningCenter.feedback('使用已保存课程资料。');
  } else {status('课程资料读取失败，请连接服务或先保存离线资料。',true);return;}
  if (healthResult.status==='fulfilled') $('version-number').textContent='应用 '+healthResult.value.version+' · 知识版本 '+healthResult.value.knowledge_version;
  selectTopic(activeId);renderRecords();mapUI.load(knowledge,relations);
  learningCenter?.setCatalog(knowledge,relations,cached);
  document.body.dataset.learningReady = 'true';
}
startLearning();
