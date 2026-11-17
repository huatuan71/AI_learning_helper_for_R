const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  fs.mkdirSync('output/playwright', {recursive:true});
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:1440,height:1000}, reducedMotion:'reduce', permissions:['clipboard-read','clipboard-write']});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8026');
    await page.waitForFunction(() => document.body.dataset.learningReady === 'true');
    assert(await page.locator('[data-r-code] .r-token-function').count() > 0);
    assert(await page.locator('.code-wrong').count() === 1);
    const result = await page.evaluate(async () => {
      const {createAnswerRenderer} = await import('/static/answer-renderer.js?v=r-highlighting-v1');
      const {rCodeFragment} = await import('/static/r-highlighter.js?v=r-highlighting-v1');
      const source = '\t# 中文 <img src=x onerror=alert(1)>\r\nx <- mean(c(2L, NA), na.rm = TRUE)\n\n';
      const renderer = createAnswerRenderer(() => {});
      const root = document.createElement('div');
      renderer.codeBlock(root, source, 'R', true, 'R');
      const pre = root.querySelector('pre');
      const unknown = document.createElement('div');
      renderer.codeBlock(unknown, source, 'text', false, 'text');
      const markdown = document.createElement('div');
      renderer.renderTeachingBody(markdown, {content_markdown:'```R\nx <- mean(1:5)\n```\n\n```python\nprint(1)\n```'});
      const fragment = rCodeFragment(source);
      return {same:pre.textContent === source && fragment.textContent === source,
        safe:root.querySelectorAll('img,script').length === 0,
        colored:!!pre.querySelector('.r-token-function'),
        unknown:unknown.querySelectorAll('span[class^="r-token-"]').length === 0,
        markdown:markdown.querySelectorAll('pre.r-code').length === 1,
        markdownText:[...markdown.querySelectorAll('pre')].map(node => node.textContent)};
    });
    assert(result.same && result.safe && result.colored && result.unknown && result.markdown);
    assert.deepEqual(result.markdownText, ['x <- mean(1:5)', 'print(1)']);
    await page.evaluate(() => {location.hash='/review';});
    await page.waitForFunction(() => !document.querySelector('#code-panel').hidden);
    const source = '# 中文\nx <- mean(c(1, NA), na.rm = TRUE)\n';
    await page.locator('#code').fill(source);
    await page.waitForFunction(() => document.querySelector('.r-code-editor__highlight .r-token-function'));
    assert.equal(await page.locator('#code').inputValue(), source);
    assert.equal(await page.locator('.r-code-editor__highlight').getAttribute('aria-hidden'), 'true');
    await page.screenshot({path:'output/playwright/r-highlighting-desktop.png',fullPage:true});
    await page.locator('#code-clear').click();
    await page.locator('#r-file').setInputFiles({name:'test.R',mimeType:'text/plain',buffer:Buffer.from(source)});
    await page.waitForFunction(() => document.querySelector('#code').value.startsWith('# 中文'));
    await page.waitForFunction(() => document.querySelector('.r-code-editor__highlight .r-token-function'));
    const metrics = await page.evaluate(() => {
      const input=document.querySelector('#code');
      const layer=document.querySelector('.r-code-editor__highlight');
      const a=getComputedStyle(input),b=getComputedStyle(layer);
      return ['fontFamily','fontSize','lineHeight','paddingLeft','paddingTop','tabSize'].every(key => a[key]===b[key]);
    });
    assert(metrics);
    await page.setViewportSize({width:390,height:844});
    await page.locator('#code').fill('x <- "'+'a'.repeat(6000)+'"');
    await page.waitForTimeout(150);
    assert(await page.locator('#code').evaluate(node => node.scrollWidth > node.clientWidth));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
    await page.screenshot({path:'output/playwright/r-highlighting-mobile.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.goto((process.env.BASE_URL || 'http://127.0.0.1:8026')+'/#/knowledge');
    await page.waitForFunction(() => document.querySelectorAll('.scene-orb-label').length===43);
    await page.locator('#map-search').fill('K06');
    await page.locator('.scene-orb-label[data-id="K06"]').click();
    await page.waitForFunction(() => document.querySelector('#detail-body .r-token-function'));
    assert(await page.locator('#detail-body pre.r-code').count() === 2);
    await page.screenshot({path:'output/playwright/r-highlighting-dark.png',fullPage:true});
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({passed:true, checks:['homepage','error underline','safe DOM','CRLF equivalence','R vs text','Markdown language','native input','file load','metrics','mobile long line','dark theme'], screenshots:3}));
  } finally { await browser.close(); }
}
main().catch(error => {console.error(error);process.exitCode=1;});
