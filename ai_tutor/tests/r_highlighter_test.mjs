import assert from 'node:assert/strict';
import test from 'node:test';
import {performance} from 'node:perf_hooks';
import {cpus, platform, release} from 'node:os';
import {tokenizeR, rCodeFragment, MAX_HIGHLIGHT_LENGTH} from '../static/r-highlighter.js';

const allowed = new Set(['plain', 'keyword', 'function', 'string', 'number', 'comment', 'operator', 'punctuation']);
function tokens(source) {
  const result = tokenizeR(source);
  assert.equal(result.map(token => token.text).join(''), source);
  for (const token of result) assert.ok(allowed.has(token.type));
  return result;
}
function category(source, expected) {
  assert.deepEqual(tokens(source), [{type: expected, text: source}]);
}

test('R lexical classes, operators and identifier boundaries', () => {
  for (const value of ['if', 'else', 'for', 'function', 'TRUE', 'FALSE', 'NULL', 'Inf', 'NaN',
    'NA', 'NA_character_', 'NA_complex_', 'NA_integer_', 'NA_real_']) category(value, 'keyword');
  for (const value of ['1', '.5', '1e-3', '2L', '2.5i', '0x1.fp+2', '0XAF']) category(value, 'number');
  for (const value of ['<-', '<<-', '->', '->>', '::', ':::', '$', '@', '%in%', '%>%', '|>', '~', '\\']) category(value, 'operator');
  for (const value of ['NA.value', 'aTRUE', '中文NA', 'x.1', 'x1', '数据1']) category(value, 'plain');
  assert.equal(tokens('if(TRUE)')[0].type, 'keyword');
  for (const value of ['mean', 'is.na', 'data.frame', '均值', '`函数 名`']) {
    assert.equal(tokens(`${value} (x)`)[0].type, 'function');
  }
  category('`if # 2 <-`', 'plain');
});

test('strings, raw strings and comment priority, including incomplete streams', () => {
  for (const source of ['"a\\\"b"', "'a\\\'b'", '"# if(TRUE)"', 'r"(a "quote" #)"',
    'R"--[a ]" #]--"', 'r"{hello}"', 'r"(未结束', '"未结束', "'未结束", '"尾部\\']) {
    category(source, 'string');
  }
  category('# "quotes" `name` r"( if(1) <script>', 'comment');
  const mixed = tokens('"a" # "comment"\r\nmean(x)');
  assert.equal(mixed.find(token => token.type === 'comment').text, '# "comment"');
});

test('exact whitespace, Unicode, hostile HTML and all stream prefixes', () => {
  const source = '\t数据 <- r"--(a\r\n"b" #c)--"\r\n\n# <script>alert(1)</script> 😀\nprint("<img onerror=x>")\n';
  tokens('');
  tokens(' \t\r\n\n\n');
  tokens(source);
  for (let end = 0; end <= source.length; end++) tokens(source.slice(0, end));
});

test('DOM builder uses only text nodes and controlled spans', () => {
  const original = globalThis.document;
  const makeNode = (tagName, text = '') => ({
    tagName, children: [], className: '',
    append(node) { this.children.push(node); },
    set textContent(value) { this.children = []; text = value; },
    get textContent() { return text + this.children.map(child => child.textContent).join(''); },
    set innerHTML(value) { assert.fail(`HTML sink used: ${value}`); },
  });
  globalThis.document = {
    createDocumentFragment: () => makeNode('#fragment'),
    createTextNode: text => makeNode('#text', text),
    createElement: tagName => { assert.equal(tagName, 'span'); return makeNode(tagName); },
  };
  try {
    const source = '<script>alert("x")</script>\r\n# <img onerror=evil>\n均值(1)';
    const fragment = rCodeFragment(source);
    assert.equal(fragment.textContent, source);
    for (const child of fragment.children) {
      assert.ok(child.tagName === '#text' || /^r-token-(keyword|function|string|number|comment|operator|punctuation)$/.test(child.className));
    }
  } finally {
    globalThis.document = original;
  }
});

test('size and node caps retain the entire original source', () => {
  category('x'.repeat(MAX_HIGHLIGHT_LENGTH + 1), 'plain');
  category('x+'.repeat(15_000), 'plain');
});

test('measured performance samples', () => {
  console.log(JSON.stringify({platform: platform(), release: release(), cpu: cpus()[0]?.model, node: process.version}));
  for (const [name, source] of [
    ['10k R', '值 <- mean(c(1, 2L)) # 注释\n'.repeat(420)],
    ['100k R', '值 <- mean(c(1, 2L)) # 注释\n'.repeat(4000)],
    ['100k line', 'x'.repeat(100_000)],
    ['100k unfinished', 'r"('.padEnd(100_000, 'x')],
    ['1M fallback', 'x'.repeat(1_000_000)],
  ]) {
    const start = performance.now();
    const result = tokens(source);
    console.log(JSON.stringify({name, length: source.length, milliseconds: +(performance.now() - start).toFixed(3), tokens: result.length}));
  }
});
