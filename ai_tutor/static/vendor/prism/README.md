# PrismJS 1.30.0

Vendored 17 November 2026 under the MIT license in `LICENSE`. The npm registry's `prismjs/latest` reported 1.30.0 on that date. Runtime assets work entirely offline.

Official source files are retained verbatim.

- [Core at v1.30.0](https://raw.githubusercontent.com/PrismJS/prism/v1.30.0/components/prism-core.js)
- [R grammar at v1.30.0](https://raw.githubusercontent.com/PrismJS/prism/v1.30.0/components/prism-r.js)
- [License at v1.30.0](https://raw.githubusercontent.com/PrismJS/prism/v1.30.0/LICENSE)
- [Prism tokenize and manual mode documentation](https://prismjs.com/docs/prism)

From `ai_tutor`, run `node scripts/build_prism.mjs` to regenerate `prism.js` from the two upstream files without dependencies or network access. The wrapper scopes upstream browser/CommonJS detection to private arguments and supplies a private window object with `manual` and `disableWorkerMessageHandler` enabled. No `window.Prism`, worker listener, automatic DOM scanning or injected script is created.

`static/r-highlighter.js` calls this private Prism instance's `tokenize` method. Its application grammar adapts upstream R rules for complete and streamed strings, raw strings, backtick names, Unicode names, modern pipes and call-site function highlighting. [R's quote documentation](https://stat.ethz.ch/R-manual/R-devel/library/base/html/Quotes.html) specifies the raw-string delimiters and dash matching used here.

Only `prism.js` is a runtime dependency. The upstream files, build script and license provide provenance and reproducibility.
