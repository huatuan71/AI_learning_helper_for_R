import {requestJson} from './api-client.js?v=ascii-v1';
import {learningStore} from './learning-store.js?v=learning-v1';
import {buildSummaryInput, summaryMatches, PROMPT_VERSION} from './learning-summary-data.js?v=ai-summary-v1';

const PROVIDERS = {deepseek:'DeepSeek', qwen:'通义千问', openai:'OpenAI'};
const GRADES = {again:'未掌握', hinted:'提示完成', good:'独立完成', easy:'熟练完成'};
const samePeriod = (left, right) => left?.start_date === right?.start_date &&
  left?.end_date === right?.end_date && left?.time_zone === right?.time_zone;

function element(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}
function button(text, handler, className = '') {
  const result = element('button', text, className);
  result.type = 'button';
  result.onclick = handler;
  return result;
}
function formattedTime(value) {
  return new Date(value).toLocaleString('zh-CN');
}
function coverageText(coverage) {
  return `已分析 ${coverage.included_evidence_count} / ${coverage.total_evidence_count} 条证据${coverage.truncated ? ' · 摘录已截断，结论仅覆盖所列记录' : ''}`;
}

export function summaryText(record) {
  const response = record.response;
  const summary = response.summary;
  const lines = ['AI学习总结', `${response.period.start_date} 至 ${response.period.end_date} · ${response.period.time_zone}`,
    `${PROVIDERS[response.provider] || response.provider} · ${response.model} · ${formattedTime(response.generated_at)}`,
    coverageText(response.coverage), '', summary.overview];
  for (const [title, items, field] of [['近期重点',summary.topics,'observation'],
    ['复习优先项',summary.review_priorities,'reason'], ['下一步建议',summary.next_actions,'action']]) {
    lines.push('', title);
    for (const item of items) {
      lines.push(`${item.knowledge_id} · ${item[field]}${item.action ? '\n' + item.reason : ''}`);
      for (const id of item.evidence_ids) {
        const source = record.evidence.find(source => source.id === id);
        lines.push(source ? `来源 ${source.kind} · ${source.source_id} · ${formattedTime(source.at)}` : '来源记录已缺失');
      }
    }
  }
  if (summary.uncertainties.length) lines.push('', '记录局限', ...summary.uncertainties);
  return lines.join('\n');
}

export class LearningSummaryUI {
  constructor({getModelConfig, refreshModelConfig, openModelSettings, notify, openKnowledge, openConversation, practice, title, download}) {
    Object.assign(this, {getModelConfig, refreshModelConfig, openModelSettings, notify, openKnowledge, openConversation, practice, title, download});
    this.job = null;
    this.context = null;
    window.addEventListener('online', () => this.paint());
    window.addEventListener('offline', () => this.paint());
  }
  current(context = this.context) {
    return context === this.context && context?.report.isConnected && context.isCurrent();
  }
  refreshConfig() {
    if (!this.current()) return;
    this.selectSaved(this.context);
    this.paint();
  }
  matchesCurrent(record, input) {
    const config = this.getModelConfig();
    return !!input && ['deepseek','qwen','openai'].includes(config.provider) && typeof config.model === 'string' &&
      !!config.model.trim() && summaryMatches(record, input, {...config, prompt_version:PROMPT_VERSION});
  }
  selectSaved(context) {
    const records = (context.snapshot.summaries || []).filter(record => samePeriod(record.period, context.period))
      .sort((left, right) => right.generated_at.localeCompare(left.generated_at));
    context.record = records.find(record => this.matchesCurrent(record, context.input)) || records[0] || null;
  }
  async mount({controls, root, before, report, snapshot, period, isCurrent}) {
    const context = {controls, root, report, snapshot, period, isCurrent, input:null, record:null, message:'正在整理本期记录…', error:false};
    this.context = context;
    context.generate = button('AI总结', () => this.generate(), 'primary');
    context.generate.id = 'ai-summary-generate';
    context.generate.disabled = true;
    context.cancel = button('取消生成', () => this.cancel());
    context.cancel.id = 'ai-summary-cancel';
    context.cancel.hidden = !this.job;
    controls.append(context.generate, context.cancel);
    context.panel = element('section', undefined, 'lc-ai-controls lc-paper lc-no-print');
    context.panel.setAttribute('aria-label', 'AI总结设置与发送内容');
    context.description = element('p', '', 'muted lc-caption');
    context.configure = button('配置模型', event => this.openModelSettings(event.currentTarget));
    context.configure.id = 'ai-summary-configure';
    context.status = element('p', context.message, 'lc-ai-status');
    context.status.setAttribute('role', 'status');
    context.preview = element('details', undefined, 'lc-ai-preview');
    context.preview.append(element('summary', '发送内容'));
    context.panel.append(context.description, context.configure, context.status, context.preview);
    root.insertBefore(context.panel, before);
    context.result = element('section', undefined, 'lc-ai-result');
    context.result.id = 'learning-ai-summary';
    report.append(context.result);
    this.selectSaved(context);
    this.paint();
    try {
      context.input = await buildSummaryInput(snapshot, period);
      context.message = '';
      this.selectSaved(context);
      if (this.current(context)) this.renderPreview(context);
    } catch (error) {
      context.message = error.message || '本期记录整理失败，请重试。';
      context.error = true;
    }
    if (this.current(context)) this.paint();
  }
  renderPreview(context) {
    const summary = context.preview.firstElementChild;
    context.preview.replaceChildren(summary);
    context.preview.append(element('p', coverageText(context.input.coverage), 'muted lc-caption'),
      element('p', '摘录包含问题、回答和作答信号。完整代码与个人备注不发送。', 'muted lc-caption'));
    const json = element('pre', JSON.stringify(context.input, null, 2));
    json.id = 'ai-summary-input';
    context.preview.append(json);
  }
  paint() {
    const context = this.context;
    if (!this.current(context)) return;
    const config = this.getModelConfig();
    const configured = config.configured && config.mode !== 'mock';
    context.description.textContent = configured
      ? `本期统计和对话摘录将发送至 ${PROVIDERS[config.provider] || config.provider} · ${config.model}，按厂商计费。${config.mode === 'search' ? '总结使用普通生成。' : ''}`
      : '选择模型后可生成AI总结。本期统计和对话摘录将发送至所选厂商，按厂商计费。';
    context.configure.hidden = configured && !context.needsConfig;
    context.generate.disabled = !context.input || !!this.job;
    context.generate.textContent = this.job && samePeriod(this.job.input.period, context.period)
      ? '生成中…' : context.record ? '重新生成' : 'AI总结';
    context.cancel.hidden = !this.job;
    context.generate.setAttribute('aria-busy', String(!!this.job));
    let message = context.message;
    if (this.job) message = samePeriod(this.job.input.period, context.period)
      ? '正在生成本期总结，可以取消。' : '另一日期范围的总结正在生成，可以取消后再生成。';
    else if (!message && navigator.onLine === false) message = '当前离线，可查看已保存总结。';
    context.status.textContent = message;
    context.status.classList.toggle('error', context.error && !this.job);
    this.renderResult(context);
  }
  async generate() {
    const context = this.context;
    if (!this.current(context) || !context.input || this.job) return;
    context.error = false;
    if (!context.input.evidence.length) {
      context.message = '这段时间还没有可用于总结的学习记录。';
      this.paint();
      return;
    }
    const config = {...this.getModelConfig()};
    if (!config.configured || config.mode === 'mock') {
      context.message = '请先配置模型，再生成AI总结。';
      this.paint();
      this.notify?.(context.message, true, {label:'配置模型', run:event => this.openModelSettings(event.currentTarget)});
      await this.openModelSettings(context.generate);
      return;
    }
    if (navigator.onLine === false) {
      context.message = '联网后可以生成AI总结，已保存总结仍可查看。';
      this.paint();
      return;
    }
    const job = {input:context.input, controller:new AbortController(), cancelled:false};
    this.notify?.();
    this.job = job;
    this.paint();
    try {
      const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(70000)]);
      const response = await requestJson('/api/learning/summary', job.input, {signal});
      if (job.cancelled || signal.aborted) return;
      if (response.status === 'no_data') {
        this.finishMessage(job, '这段时间还没有可用于总结的学习记录。');
        return;
      }
      const record = await learningStore.saveSummary(response, job.input);
      const current = this.context;
      if (this.current(current) && samePeriod(current.period, record.period)) {
        current.snapshot = {...current.snapshot, summaries:[record, ...(current.snapshot.summaries || []).filter(item => item.id !== record.id)]};
        this.selectSaved(current);
      }
      this.finishMessage(job, 'AI总结已保存在当前设备。');
    } catch (error) {
      if (job.cancelled) this.finishMessage(job, '已取消，可以再次生成。');
      else {
        const needsConfig = ['CONFIG_REQUIRED','SESSION_EXPIRED','CONFIG_CHANGED'].includes(error.code);
        const message = error.name === 'TimeoutError' ? '生成超时，请重试。' :
          error.name === 'TypeError' ? '无法连接服务，请检查网络后重试。' : error.message || '生成失败，请重试。';
        this.finishMessage(job, message, true);
        if (needsConfig) {
          this.notify?.(message, true, {label:'配置模型', run:event => this.openModelSettings(event.currentTarget)});
          await this.refreshModelConfig?.().catch(() => {});
          if (this.current() && samePeriod(this.context.period, job.input.period)) this.context.needsConfig = true;
        }
      }
    } finally {
      if (this.job === job) this.job = null;
      this.paint();
    }
  }
  finishMessage(job, message, error = false) {
    if (!this.current() || !samePeriod(this.context.period, job.input.period)) return;
    this.context.message = message;
    this.context.error = error;
  }
  cancel() {
    if (!this.job) return;
    this.job.cancelled = true;
    this.job.controller.abort();
  }
  renderResult(context) {
    const result = context.result;
    result.replaceChildren();
    const record = context.record;
    if (!record) return;
    const response = record.response;
    const summary = response.summary;
    const heading = element('div', undefined, 'lc-row');
    heading.append(element('h3', 'AI学习总结'));
    const actions = element('div', undefined, 'lc-actions lc-no-print');
    actions.append(button('复制总结', () => this.copy(record)), button('导出AI总结', () => this.download(summaryText(record),
      `r-tutor-ai-summary_${response.period.start_date}_${response.period.end_date}.txt`)));
    result.append(heading, element('p', `${PROVIDERS[response.provider] || response.provider} · ${response.model} · ${formattedTime(response.generated_at)}`, 'muted lc-caption'),
      element('p', `${response.period.start_date} 至 ${response.period.end_date} · ${response.period.time_zone}`, 'muted lc-caption'),
      element('p', coverageText(response.coverage), 'muted lc-caption'));
    if (!this.matchesCurrent(record, context.input)) {
      result.append(element('p', '这份总结对应先前的记录或模型设置，可按当前数据重新生成。', 'lc-ai-stale'));
    }
    result.append(element('p', summary.overview), actions);
    for (const [label, items, field] of [['近期重点',summary.topics,'observation'],
      ['复习优先项',summary.review_priorities,'reason'], ['下一步建议',summary.next_actions,'action']]) {
      if (!items.length) continue;
      const part = element('div', undefined, 'lc-ai-part');
      part.append(element('h3', label));
      for (const item of items) {
        const row = element('article', undefined, 'lc-ai-observation');
        row.append(element('p', item[field]));
        if (item.action) row.append(element('p', item.reason, 'muted'));
        const links = element('div', undefined, 'lc-ai-links');
        const exists = this.title(item.knowledge_id);
        const knowledge = button('相关知识 · ' + (exists || item.knowledge_id), () => this.openKnowledge(item.knowledge_id));
        knowledge.disabled = !exists;
        links.append(knowledge);
        if (item.action && exists) links.append(button('练习', () => this.practice(item.knowledge_id)));
        row.append(links);
        for (const id of item.evidence_ids) row.append(this.source(record.evidence.find(source => source.id === id), context.snapshot));
        part.append(row);
      }
      result.append(part);
    }
    if (summary.uncertainties.length) {
      const limits = element('div', undefined, 'lc-ai-limits');
      limits.append(element('h3', '记录局限'));
      for (const text of summary.uncertainties) limits.append(element('p', text));
      result.append(limits);
    }
  }
  source(source, snapshot) {
    const list = {conversation:snapshot.conversations, event:snapshot.events, attempt:snapshot.attempts};
    const original = source && list[source.kind]?.find(item => item.id === source.source_id);
    if (!original) {
      const missing = button('来源记录已缺失', () => {});
      missing.disabled = true;
      missing.className = 'lc-ai-missing';
      return missing;
    }
    const details = element('details', undefined, 'lc-ai-source');
    details.append(element('summary', `${{conversation:'对话',event:'学习记录',attempt:'作答记录'}[source.kind]} · ${formattedTime(source.at)}`));
    if (source.kind === 'attempt') {
      details.append(element('p', `${original.assessmentSource === 'self' ? '用户自评' : '客观题评分'} · ${GRADES[original.grade]}${original.hintUsed ? ' · 使用提示' : ''}${original.answerRevealed ? ' · 查看参考答案' : ''}`),
        element('p', original.answerText || '本次未填写答案。'));
    }
    if (source.kind === 'event') details.append(element('p', ({view:'浏览知识',study:'学习讲解',exercise_view:'查看练习',debug:'代码纠错',enroll:'加入复习'})[original.kind] || '学习活动'));
    const conversationId = source.kind === 'conversation' ? source.source_id : original.conversationId;
    if (conversationId && snapshot.conversations.some(item => item.id === conversationId)) {
      details.append(button('返回对话', () => this.openConversation(conversationId)));
    }
    return details;
  }
  async copy(record) {
    try {
      await navigator.clipboard.writeText(summaryText(record));
      this.notify?.('AI总结已复制。');
    } catch {
      this.notify?.('复制未完成，可使用“导出AI总结”保存文本。', true);
    }
  }
}
