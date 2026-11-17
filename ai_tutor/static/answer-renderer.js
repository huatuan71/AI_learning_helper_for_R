import {markdownFragment} from './answer-markdown.js?v=learning-v1';
import {rCodeFragment} from './r-highlighter.js?v=r-highlighting-v1';

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function button(text, action, cls) {
  const node = el('button', text, cls);
  node.type = 'button';
  node.onclick = action;
  return node;
}

export function firstSentence(text) {
  const match = text.match(/^.*?[。！？](?:\s*\[W\d+\])*|^[^\n]+\n/u);
  return match ? match[0].trim() : text;
}

export function createAnswerRenderer(notify) {
  function codeBlock(parent, text, label, unverified = false, language = '') {
    if (!text) return;
    const wrap = el('div', undefined, 'code-wrap');
    const heading = el('div', undefined, 'code-heading');
    heading.append(el('span', label));
    if (unverified) heading.append(el('span', '未运行验证', 'unverified'));
    const copy = button('复制代码', async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = '已复制'; }
      catch { notify('复制失败，请手动选中代码复制。', true); }
    }, 'copy');
    const pre = el('pre');
    pre.dataset.language = language;
    if (language.toLowerCase() === 'r') {
      pre.className = 'r-code';
      pre.append(rCodeFragment(text));
    } else pre.textContent = text;
    heading.append(copy); wrap.append(heading, pre); parent.append(wrap);
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
        codeBlock(holder, (code || pre).textContent.replace(/\n$/, ''), label, true, language);
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
    codeBlock(node, answer.corrected_code || answer.example_code, answer.corrected_code ? '参考修正' : '代码讲解', true, 'r');
  }
  return {codeBlock, renderTeachingBody};
}
