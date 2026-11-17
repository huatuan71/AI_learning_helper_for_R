import Prism from './vendor/prism/prism.js';

// Bound both tokenization work and the number of display nodes for uploaded/streamed code.
export const MAX_HIGHLIGHT_LENGTH = 100_000;
const MAX_TOKENS = 20_000;
const TYPES = new Set(['plain', 'keyword', 'function', 'string', 'number', 'comment', 'operator', 'punctuation']);
const identifier = String.raw`(?:[\p{L}.][\p{L}\p{N}\p{M}._]*)`;
// Protect complete and unfinished lexical atoms first. This also keeps HTML inert.
const grammar = {
  // One ordered scan keeps quote characters in comments and # characters in strings inert.
  'atom': /#[^\r\n]*|(?<![\p{L}\p{N}._])[rR]"(?:(-*)\([\s\S]*?(?:\)\1"|$)|(-*)\[[\s\S]*?(?:\]\2"|$)|(-*)\{[\s\S]*?(?:\}\3"|$))|"(?:\\(?:[\s\S]|$)|[^"\\])*(?:"|$)|'(?:\\(?:[\s\S]|$)|[^'\\])*(?:'|$)|`(?:\\(?:[\s\S]|$)|[^`\\])*(?:`|$)|%[^%\s]*%/u,
  'keyword': {
    pattern: /(^|[^\p{L}\p{N}._])(?:TRUE|FALSE|NA(?:_character_|_complex_|_integer_|_real_)?|NULL|Inf|NaN|break|else|for|function|if|in|next|repeat|while)(?![\p{L}\p{N}._])/u,
    lookbehind: true,
  },
  'function': {
    pattern: new RegExp(`(^|[^\\p{L}\\p{N}._])${identifier}(?=\\s*\\()`, 'u'),
    lookbehind: true,
  },
  'number': {
    pattern: /(^|[^\p{L}\p{N}._])(?:0[xX](?:[\da-fA-F]+(?:\.[\da-fA-F]*)?|\.[\da-fA-F]+)(?:[pP][+-]?\d+)?|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)[iL]?(?![\p{L}\p{N}._])/u,
    lookbehind: true,
  },
  'operator': /%[^%\s]*%|<<-|->>|<-|->|:::|::|\|>|&&|\|\||<=|>=|==|!=|[-+*/^$@~:<>=!&|?\\]/,
  'punctuation': Prism.languages.r.punctuation,
};

/** Return controlled lexical tokens whose text joins to the exact input. */
export function tokenizeR(source) {
  source = String(source ?? '');
  const fallback = () => [{type: 'plain', text: source}];
  if (source.length > MAX_HIGHLIGHT_LENGTH) return fallback();
  try {
    let offset = 0;
    const tokens = Prism.tokenize(source, grammar).map(token => {
      const text = typeof token === 'string' ? token : token.content;
      offset += text.length;
      let type = typeof token === 'string' ? 'plain' : token.type;
      if (type === 'atom') {
        type = text.startsWith('#') ? 'comment' : 'string';
        if (text.startsWith('%')) type = 'operator';
        if (text.startsWith('`')) type = /^\s*\(/.test(source.slice(offset)) ? 'function' : 'plain';
      }
      return {type: TYPES.has(type) ? type : 'plain', text};
    });
    if (tokens.length > MAX_TOKENS || tokens.some(token => typeof token.text !== 'string') ||
        tokens.map(token => token.text).join('') !== source) return fallback();
    return tokens;
  } catch {
    return fallback();
  }
}

/** Construct inert DOM, preserving whitespace, line endings and every source character. */
export function rCodeFragment(source) {
  const fragment = document.createDocumentFragment();
  for (const {type, text} of tokenizeR(source)) {
    if (type === 'plain') {
      fragment.append(document.createTextNode(text));
    } else {
      const span = document.createElement('span');
      span.className = `r-token-${type}`;
      span.textContent = text;
      fragment.append(span);
    }
  }
  return fragment;
}

