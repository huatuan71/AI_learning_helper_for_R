# Syntax core delivery

Validated on 17 November 2026 in Windows 10.0.26300 with an Intel Core i9-14900HX, Node 24.15.0 and headless Chromium 147.0.7727.15.

## Public API

`tokenizeR(source)` returns ordered `{type, text}` records. Types are `plain`, `keyword`, `function`, `string`, `number`, `comment`, `operator` and `punctuation`. Concatenating every `text` preserves the entire source, including CRLF, tabs, Unicode and final newlines. Nullish input becomes an empty string. Other values are converted with `String`.

`rCodeFragment(source)` returns a `DocumentFragment`. Plain code uses text nodes. Other tokens use spans with exactly `r-token-keyword`, `r-token-function`, `r-token-string`, `r-token-number`, `r-token-comment`, `r-token-operator` or `r-token-punctuation`. Its textContent equals the source. HTML parsing and HTML string insertion are absent from this component.

```javascript
import {rCodeFragment} from './r-highlighter.js';
pre.replaceChildren(rCodeFragment(source));
```

The integration owns language selection, CSS and editor injection. Runtime dependency `vendor/prism/prism.js` must be included in offline assets. PrismJS 1.30.0 is MIT licensed, with original source, license and a deterministic local build script included.

## Limits

Highlighting is lexical. Function coloring recognizes a name followed by whitespace and `(`, including backtick and Chinese names. It cannot resolve R bindings, dynamically constructed call targets, formulas or whether the source executes successfully. Reserved words take keyword priority. Incomplete strings and raw strings stay safely readable through streaming prefixes.

More than 100,000 UTF-16 code units returns one plain token before tokenization. More than 20,000 tokens returns one plain token after tokenization to bound DOM construction. Parser exceptions, unsupported nested token content or a failed source-reconstruction check also return the entire plain source. These size and node limits are deterministic. There is no mid-call time cancellation of the synchronous tokenizer.

## Results

`node --test tests/r_highlighter_test.mjs` passed all 6 tests. Coverage includes every category, keyword/name boundaries, percent operators, assignments, namespace/member operators, pipes, numeric suffixes and scientific notation, backticks, raw delimiters, escaped quotes, incomplete strings including trailing escapes, Unicode, hostile HTML, tabs, empty input, CRLF, trailing newlines and every prefix of a mixed-source stream. The DOM-builder unit check rejects any use of innerHTML and verifies only controlled spans and text nodes.

`node tests/r_highlighter_browser.cjs` passed against actual Chromium. DOM textContent matched the CRLF source, all generated elements were spans, malicious HTML stayed text, no payload executed and no global Prism appeared. This isolated browser check routes local modules from disk. The application-level UI/browser verification belongs to the integration delivery.

The worktree reused the existing Playwright package with `NODE_PATH` set to the main checkout's `ai_tutor/node_modules`, and set `PLAYWRIGHT_BROWSERS_PATH` to `C:/Users/huani/AppData/Local/ms-playwright` to locate the installed browser.

Single-run tokenization and reconstruction measurements are recorded below. Timing varies with load and these measurements cover this Windows desktop.

| Sample | UTF-16 length | Milliseconds | Returned tokens |
|---|---|---|---|
| Repeated R statements | 10,500 | 3.325 | 6,301 |
| Repeated R statements, token-cap fallback | 100,000 | 17.382 | 1 |
| Long identifier | 100,000 | 0.526 | 1 |
| Unfinished raw string | 100,000 | 0.070 | 1 |
| Size-cap fallback | 1,000,000 | 0.003 | 1 |

The pure token timings exclude browser DOM layout and rendering. Platform-specific display and input-method testing is part of editor/integration acceptance.
