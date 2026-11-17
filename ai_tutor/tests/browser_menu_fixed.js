async (page, baseUrl = 'http://127.0.0.1:8000') => {
  const checks = [], samples = [], errors = [];
  const check = (ok, name, detail) => {
    if (!ok) throw Error(name + (detail ? ' ' + JSON.stringify(detail) : ''));
    checks.push(name);
  };
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const measure = () => page.evaluate(() => {
    const menu = document.querySelector('#more-panel');
    const rect = menu.getBoundingClientRect();
    return {x:rect.x, y:rect.y, width:rect.width, height:rect.height,
      scrollY, position:getComputedStyle(menu).position,
      navBottom:document.querySelector('.nav-shell').getBoundingClientRect().bottom};
  });
  try {
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(baseUrl + '/?menu-fixed-test=' + Date.now() + '#/history', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.body.dataset.learningReady === 'true');
    for (const staleStyle of [false, true]) {
      const legacy = staleStyle ? await page.addStyleTag({content:'.popover { position:absolute; right:0; top:54px; }'}) : null;
      for (const width of [1440,390]) {
        await page.setViewportSize({width,height:width === 390 ? 844 : 1000});
        await page.evaluate(() => window.scrollTo({top:0,behavior:'instant'}));
        await page.locator('#more-toggle').click();
        const initial = await measure();
        const prefix = `${width}px ${staleStyle ? 'cached style' : 'current style'}`;
        for (const delta of [160,220,-120]) {
          await page.mouse.move(Math.min(300,width/2),500);
          const before = await page.evaluate(() => scrollY);
          await page.mouse.wheel(0,delta);
          await page.waitForFunction(before => Math.abs(scrollY-before)>20,before);
          await page.waitForTimeout(120);
          const current = await measure();
          samples.push({viewportWidth:width,staleStyle,delta,...current});
          check(Math.abs(current.y-initial.y)<1 && Math.abs(current.x-initial.x)<1,
            `${prefix} menu stays fixed during wheel ${delta}`, {initial,current});
          check(current.y >= current.navBottom+6, `${prefix} menu remains below navigation during wheel ${delta}`);
        }
        check(initial.position === 'fixed', `${prefix} component enforces viewport positioning`);
        await page.keyboard.press('Escape');
        await page.locator('#more-toggle').click();
        check(Math.abs((await measure()).y-initial.y)<1, `${prefix} opening after scrolling uses the same viewport position`);
        await page.screenshot({path:`output/playwright/menu-fixed-${width}-${staleStyle?'cached':'current'}.png`});
        await page.keyboard.press('Escape');
      }
      if (legacy) await legacy.evaluate(node => node.remove());
    }
    await page.setViewportSize({width:1440,height:300});
    await page.locator('#more-toggle').click();
    const short = await measure();
    check(short.y >= short.navBottom+6 && short.y+short.height <= 290, 'short viewport keeps the menu inside available space');
    const bodyScroll = await page.evaluate(() => scrollY);
    await page.locator('#more-panel button').last().scrollIntoViewIfNeeded();
    check(await page.locator('#more-panel').evaluate(node => node.scrollTop>0), 'short viewport scrolls the menu contents independently');
    check(await page.evaluate(before => scrollY === before,bodyScroll), 'scrolling menu content preserves the underlying page position');
    check(Math.abs((await measure()).y-short.y)<1, 'internal menu scrolling preserves the fixed frame');
    await page.keyboard.press('Escape');
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#more-toggle').click();
    check(await page.locator('#more-panel').evaluate(node => node.scrollTop===0), 'opening the menu starts at its first item');
    await page.locator('#export').click();
    check(await page.locator('#export-dialog').isVisible(), 'fixed menu still opens the shared export dialog');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.activeElement === document.querySelector('#more-toggle'));
    check(errors.length===0, 'no uncaught positioning errors');
    return {passed:checks.length,checks,samples,errors};
  } finally { page.off('pageerror',onError); }
}
