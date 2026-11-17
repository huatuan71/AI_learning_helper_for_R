const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    const root = path.resolve(__dirname, '../static');
    await page.route('http://highlight.test/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/') return route.fulfill({contentType: 'text/html', body: '<!doctype html><main></main>'});
      const filename = path.resolve(root, '.' + pathname);
      assert.ok(filename.startsWith(root + path.sep));
      await route.fulfill({contentType: 'text/javascript', body: await fs.readFile(filename)});
    });
    await page.goto('http://highlight.test/');
    const result = await page.evaluate(async () => {
      const {rCodeFragment} = await import('/r-highlighter.js');
      const source = '\t均值 <- mean(c(1, NA_real_))\r\n# <img onerror="globalThis.pwned=true">\n"<script>pwned=true</script>"\n';
      const fragment = rCodeFragment(source);
      const equal = fragment.textContent === source;
      document.querySelector('main').append(fragment);
      return {
        equal,
        tags: [...document.querySelector('main').querySelectorAll('*')].map(node => node.tagName),
        classes: [...document.querySelectorAll('span')].map(node => node.className),
        globalPrism: 'Prism' in window,
        executed: Boolean(globalThis.pwned),
      };
    });
    assert.equal(result.equal, true);
    assert.equal(result.globalPrism, false);
    assert.equal(result.executed, false);
    assert.ok(result.tags.every(tag => tag === 'SPAN'));
    assert.ok(result.classes.includes('r-token-function'));
    assert.ok(result.classes.includes('r-token-comment'));
    assert.ok(result.classes.every(value => /^r-token-(keyword|function|string|number|comment|operator|punctuation)$/.test(value)));
    console.log(JSON.stringify({browser: browser.version(), ...result}));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
