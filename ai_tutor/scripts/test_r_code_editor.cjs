// Standalone real-browser checks for the native textarea mirror.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const staticRoot = path.resolve(__dirname, '../static');
const fixture = `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="/r-code-editor.css">
<style>body{margin:20px}textarea{width:100%;height:180px;padding:12px;border:1px solid #abc;margin:12px 0;font-size:14px;line-height:1.7}*{box-sizing:border-box}</style>
<form><label for="code">R代码</label><textarea id="code" wrap="soft"></textarea><button type="button" id="next">Next</button></form>
<script type="module">
import {enhanceRTextarea} from '/r-code-editor.js';
window.enhance=enhanceRTextarea;
window.code=document.querySelector('textarea');
window.editor=enhanceRTextarea(code,{renderCode: source=>document.createTextNode(source)});
window.ready=true;
</script>`;

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end(fixture); return; }
    const filename = path.join(staticRoot, path.basename(req.url));
    if (!fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(fs.readFileSync(filename));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  let page;
  const failures=[];
  try {
    browser = await chromium.launch();
    page = await browser.newPage({viewport: {width:1440,height:900}});
    page.on('pageerror', error => failures.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    assert.equal(await page.evaluate(() => enhance(code)===editor), true);
    assert.equal(await page.locator('.r-code-editor__highlight').getAttribute('aria-hidden'), 'true');
    await page.locator('#code').focus();
    await page.keyboard.insertText('x <- c(1, 2)');
    await page.waitForFunction(() => document.querySelector('pre code').textContent === code.value);
    await page.keyboard.press('Control+z');
    assert.equal(await page.locator('#code').inputValue(), '');
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await page.locator('#code').inputValue(), 'x <- c(1, 2)');
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
    await page.evaluate(() => navigator.clipboard.writeText('# 粘贴\nmean(x)'));
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+v');
    assert.equal(await page.locator('#code').inputValue(), '# 粘贴\nmean(x)');
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g,'\n'), '# 粘贴\nmean(x)');
    await page.evaluate(() => {code.setSelectionRange(2, 4); editor.refresh();});
    assert.deepEqual(await page.evaluate(() => [code.selectionStart,code.selectionEnd]), [2,4]);
    await page.evaluate(() => {
      window.inputCount=0;
      code.addEventListener('input',()=>inputCount++);
      editor.setValue('# 中文\n\tx <- 1\n\n');
    });
    assert.equal(await page.evaluate(() => inputCount), 0);
    assert.equal(await page.locator('#code').inputValue(), '# 中文\n\tx <- 1\n\n');
    await page.evaluate(() => editor.setValue('file <- "<script>"', {emitInput:true}));
    assert.equal(await page.evaluate(() => inputCount), 1);
    assert.equal(await page.locator('pre script').count(), 0);
    await page.evaluate(() => code.dispatchEvent(new CompositionEvent('compositionstart')));
    assert.equal(await page.locator('.r-code-editor').evaluate(el => el.classList.contains('r-code-editor--composing')), true);
    assert.notEqual(await page.locator('#code').evaluate(el => getComputedStyle(el).color), 'rgba(0, 0, 0, 0)');
    await page.evaluate(() => {code.value='中文 <- 1';code.dispatchEvent(new CompositionEvent('compositionend'));});
    assert.equal(await page.locator('pre code').textContent(), '中文 <- 1');
    await page.evaluate(() => {editor.setValue(('x'.repeat(2000)+'\n').repeat(100));code.scrollTop=400;code.scrollLeft=500;code.dispatchEvent(new Event('scroll'));});
    assert.deepEqual(await page.evaluate(() => {
      const pre=document.querySelector('pre');return [pre.scrollTop,pre.scrollLeft];
    }), [400,500]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth), true);
    await page.evaluate(() => {code.readOnly=true;});
    await page.locator('#code').focus();
    await page.keyboard.type('unchanged');
    assert.equal(await page.evaluate(() => code.value.includes('unchanged')), false);
    await page.evaluate(() => {code.readOnly=false;code.disabled=true;editor.refresh();});
    assert.equal(await page.locator('#code').isDisabled(), true);
    await page.evaluate(() => {code.disabled=false;code.parentElement.hidden=true;});
    await page.evaluate(() => {code.parentElement.hidden=false;editor.refresh();editor.setValue('');});
    assert.equal(await page.locator('#code').inputValue(), '');
    await page.locator('#code').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#next').evaluate(el => el===document.activeElement), true);
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => {editor.setValue('a'.repeat(4000));editor.refresh();});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth), true);
    const alignment=await page.evaluate(() => {
      const pre=document.querySelector('pre').getBoundingClientRect();const ta=code.getBoundingClientRect();
      return Math.abs(pre.left-ta.left)<1 && Math.abs(pre.top-ta.top)<1;
    });
    assert.equal(alignment,true);
    await page.emulateMedia({forcedColors:'active'});
    assert.equal(await page.locator('pre').isVisible(), false);
    await page.emulateMedia({forcedColors:'none'});
    await page.evaluate(() => {editor.destroy();editor.destroy();});
    assert.equal(await page.locator('.r-code-editor').count(),0);
    assert.equal(await page.locator('#code').getAttribute('wrap'),'soft');
    await page.evaluate(() => {editor=enhance(code,{renderCode:()=>{throw Error('failure');}});});
    assert.equal(await page.locator('pre').isVisible(),false);
    await page.evaluate(() => editor.destroy());
    const touchContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
    const touchPage=await touchContext.newPage();
    await touchPage.goto(`http://127.0.0.1:${server.address().port}`);
    await touchPage.waitForFunction(() => window.ready);
    await touchPage.locator('#code').tap();
    await touchPage.keyboard.insertText('触摸 <- 1');
    assert.equal(await touchPage.locator('#code').inputValue(),'触摸 <- 1');
    await touchContext.close();
    const performance=await page.evaluate(() => {
      editor=enhance(code);
      const start=performance.now();
      for(let i=0;i<20;i++) editor.setValue('x'.repeat(102400));
      const ms=(performance.now()-start)/20;
      editor.destroy();
      return ms;
    });
    assert.deepEqual(failures,[]);
    console.log('PASS native editing, clipboard copy/paste, undo/redo, selection, setValue, composition events, scrolling, 390px touch emulation, readonly/disabled, Tab, forced colors, lifecycle, renderer fallback');
    console.log(`100KB plain-text setValue mean over 20 runs: ${performance.toFixed(2)}ms`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
