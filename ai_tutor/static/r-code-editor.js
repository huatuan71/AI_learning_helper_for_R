// The textarea owns editing, selection, history and submitted data.
const editors = new WeakMap();
const metrics = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'tabSize',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
];

export function enhanceRTextarea(textarea, {renderCode} = {}) {
  if (editors.has(textarea)) return editors.get(textarea);
  if (textarea?.tagName !== 'TEXTAREA' || !textarea.parentNode) {
    throw new TypeError('A mounted textarea is required');
  }
  const doc = textarea.ownerDocument;
  const view = doc.defaultView;
  const wrapper = doc.createElement('div');
  wrapper.className = 'r-code-editor';
  const layer = doc.createElement('pre');
  layer.className = 'r-code-editor__highlight';
  layer.setAttribute('aria-hidden', 'true');
  const content = doc.createElement('code');
  layer.append(content);
  const originalWrap = textarea.getAttribute('wrap');
  textarea.before(wrapper);
  wrapper.append(textarea, layer);
  textarea.classList.add('r-code-editor__input');
  textarea.wrap = 'off';
  let destroyed = false;
  let composing = false;
  let frame = null;

  function state(name, enabled) {
    if (wrapper.classList.contains(name) !== enabled) wrapper.classList.toggle(name, enabled);
  }

  function scroll() {
    layer.scrollTop = textarea.scrollTop;
    layer.scrollLeft = textarea.scrollLeft;
  }

  function refresh() {
    if (destroyed) return;
    if (frame !== null) view.cancelAnimationFrame(frame);
    frame = null;
    try {
      const style = view.getComputedStyle(textarea);
      for (const key of metrics) layer.style[key] = style[key];
      // Exclude the native scrollbars from the mirror viewport.
      layer.style.width = `${textarea.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`;
      layer.style.height = `${textarea.clientHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
      layer.style.top = `${textarea.offsetTop}px`;
      layer.style.left = `${textarea.offsetLeft}px`;
      const source = textarea.value;
      const rendered = renderCode ? renderCode(source) : doc.createTextNode(source);
      if (!rendered || rendered.textContent !== source) throw new Error('Code renderer changed source');
      content.replaceChildren(rendered);
      // The final empty line needs a line box for identical vertical scrolling.
      if (!source || source.endsWith('\n')) content.append(doc.createTextNode('\u200b'));
      const styled = view.getComputedStyle(layer).position === 'absolute';
      state('r-code-editor--ready', styled);
      scroll();
    } catch {
      state('r-code-editor--ready', false);
      content.replaceChildren();
    }
  }

  function schedule() {
    if (!destroyed && frame === null) frame = view.requestAnimationFrame(refresh);
  }
  function compositionStart() {
    composing = true;
    state('r-code-editor--composing', true);
  }
  function compositionEnd() {
    composing = false;
    refresh();
    state('r-code-editor--composing', false);
  }
  function input() {
    if (!composing) schedule();
  }
  function reset() { schedule(); }
  textarea.addEventListener('input', input);
  textarea.addEventListener('scroll', scroll);
  textarea.addEventListener('compositionstart', compositionStart);
  textarea.addEventListener('compositionend', compositionEnd);
  textarea.form?.addEventListener('reset', reset);
  view.addEventListener('resize', schedule);
  view.visualViewport?.addEventListener('resize', schedule);
  const resizeObserver = view.ResizeObserver ? new view.ResizeObserver(schedule) : null;
  resizeObserver?.observe(textarea);
  const attributes = new view.MutationObserver(schedule);
  attributes.observe(textarea, {attributes: true, attributeFilter: ['class', 'style', 'rows', 'readonly', 'disabled', 'hidden', 'dir']});
  doc.fonts?.ready.then(schedule);
  const form = textarea.form;
  const api = {
    refresh,
    setValue(source, {emitInput = false} = {}) {
      if (destroyed) return;
      textarea.value = String(source ?? '');
      refresh();
      if (emitInput) textarea.dispatchEvent(new view.Event('input', {bubbles: true}));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) view.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      attributes.disconnect();
      textarea.removeEventListener('input', input);
      textarea.removeEventListener('scroll', scroll);
      textarea.removeEventListener('compositionstart', compositionStart);
      textarea.removeEventListener('compositionend', compositionEnd);
      form?.removeEventListener('reset', reset);
      view.removeEventListener('resize', schedule);
      view.visualViewport?.removeEventListener('resize', schedule);
      textarea.classList.remove('r-code-editor__input');
      if (originalWrap === null) textarea.removeAttribute('wrap');
      else textarea.setAttribute('wrap', originalWrap);
      wrapper.replaceWith(textarea);
      editors.delete(textarea);
    },
  };
  editors.set(textarea, api);
  refresh();
  return api;
}
