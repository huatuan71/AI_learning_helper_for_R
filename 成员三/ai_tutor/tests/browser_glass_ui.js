async (page, baseUrl = 'http://127.0.0.1:8014') => {
  const checks = [], errors = [];
  const check = (value, name) => { if (!value) throw new Error(name); checks.push(name); };
  const route = async view => {
    await page.evaluate(view => { location.hash = `#/${view}`; }, view);
    await page.waitForFunction(view => {
      const target = view === 'chat' || view === 'review'
        ? document.querySelector('#layout')
        : document.querySelector(`#${view}-view`);
      return location.hash === `#/${view}` && target && !target.hidden;
    }, view);
    await page.waitForTimeout(400);
  };
  const noOverflow = async name => check(await page.evaluate(() =>
    document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), name);
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  try {
    await page.setViewportSize({width:1440, height:1000});
    await page.goto(baseUrl+'/#/chat');
    await page.evaluate(() => localStorage.removeItem('r-tutor-mock-v1'));
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.learningReady === 'true' && document.body.dataset.view === 'chat');

    const nav = await page.locator('.nav-shell').evaluate(node => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      return {left:box.left, right:box.right, width:box.width, radius:parseFloat(style.borderRadius),
        blur:style.backdropFilter || style.webkitBackdropFilter, background:style.backgroundColor,
        shadow:style.boxShadow};
    });
    check(nav.left > 20 && nav.right < 1420, 'desktop navigation floats away from viewport edges');
    check(nav.radius >= 20 && nav.blur.includes('blur') && nav.shadow !== 'none', 'desktop navigation uses glass material');

    const chat = await page.evaluate(() => {
      const layout = document.querySelector('#layout').getBoundingClientRect();
      const workspace = document.querySelector('#workspace').getBoundingClientRect();
      const form = getComputedStyle(document.querySelector('#ask-form'));
      return {layoutLeft:layout.left, layoutWidth:layout.width, workspaceWidth:workspace.width,
        formBlur:form.backdropFilter || form.webkitBackdropFilter,
        formRadius:parseFloat(form.borderRadius), formShadow:form.boxShadow};
    });
    check(chat.layoutLeft === 0 && Math.abs(chat.layoutWidth - 1440) <= 1, 'chat layout is full bleed');
    check(Math.abs(chat.workspaceWidth - 1440) <= 1, 'chat workspace has no centered canvas boundary');
    check(chat.formBlur.includes('blur') && chat.formRadius >= 20 && chat.formShadow !== 'none', 'chat composer uses glass material');
    const composerReadability = await page.locator('#ask-form').evaluate(node => {
      const style = getComputedStyle(node);
      return {blur:Number(style.backdropFilter.match(/blur\(([\d.]+)px\)/)?.[1]),
        opacity:Number(style.backgroundColor.match(/[\d.]+/g).at(-1))};
    });
    check(composerReadability.blur >= 48 && composerReadability.opacity >= .96,
      'chat composer strongly blurs and masks underlying answer text');

    const response = await page.request.post(baseUrl+'/api/chat', {data:{question:'mean中的na.rm怎么用？'}});
    const answer = await response.json();
    answer.mode = 'ai';
    answer.provider = 'browser-fixture';
    answer.model = 'layout-check';
    answer.answer.content_markdown = '## 缺失值与均值\n\n' +
      ('使用 `is.na(x)` 识别缺失值。计算均值时可以设置 `na.rm = TRUE`，并核对筛选后的数据。\n\n').repeat(24) +
      '```r\nx <- c(2, NA, 4)\nmean(x, na.rm = TRUE)\n```\n\n参考结果为3。';
    const record = {time:new Date().toISOString(),request:{question:'缺失值与均值',task_type:'auto'},response:answer};
    await page.evaluate(record => localStorage.setItem('r-tutor-mock-v1', JSON.stringify([record])), record);
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.learningReady === 'true' && document.body.dataset.view === 'chat' && !document.querySelector('#layout').hidden);
    const answerGlass = await page.locator('.assistant-answer').evaluate(node => {
      const style = getComputedStyle(node);
      return {blur:style.backdropFilter,background:style.backgroundColor,radius:parseFloat(style.borderRadius)};
    });
    check(answerGlass.blur.includes('blur') && answerGlass.background !== 'rgba(0, 0, 0, 0)' && answerGlass.radius >= 20,
      'restored model answer renders in a glass dialog');
    const desktopWidths = await page.evaluate(() => ({
      composer:document.querySelector('#ask-form').getBoundingClientRect().width,
      answer:document.querySelector('.assistant-answer').getBoundingClientRect().width,
    }));
    check(desktopWidths.composer === 840 && desktopWidths.answer === 980,
      'desktop input is narrower than answer dialog');
    const scrollBounds = await page.locator('#conversation-scroll').boundingBox();
    check(scrollBounds.y === 0 && scrollBounds.height === 1000, 'chat scroll extends behind top and bottom controls');
    await page.locator('.assistant-answer').evaluate(node => {
      const scroll = document.querySelector('#conversation-scroll');
      scroll.scrollTop += node.getBoundingClientRect().top - 30;
    });
    const overlap = await page.evaluate(() => {
      const answer = document.querySelector('.assistant-answer').getBoundingClientRect();
      const nav = document.querySelector('.nav-shell').getBoundingClientRect();
      const composer = document.querySelector('#ask-form').getBoundingClientRect();
      return answer.top < nav.bottom && answer.bottom > composer.top;
    });
    check(overlap, 'model response scrolls beneath navigation and composer');
    await page.locator('#question').fill('计算均值时如何处理 NA？');
    await page.screenshot({path:'output/playwright/nav-fixed-chat-composer.png'});
    await page.locator('#conversation-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    const endIsReadable = await page.locator('.message .followups').last().evaluate(node =>
      node.getBoundingClientRect().bottom <= document.querySelector('#ask-form').getBoundingClientRect().top);
    check(endIsReadable, 'last answer actions scroll fully above the composer');
    await page.screenshot({path:'output/playwright/glass-repair-chat-desktop.png'});
    await page.locator('#code-toggle').click();
    await page.waitForFunction(() => {
      const workspace = document.querySelector('#workspace');
      const measured = parseFloat(workspace.style.getPropertyValue('--composer-height'));
      return Math.abs(measured - document.querySelector('.composer-dock').getBoundingClientRect().height) < 2;
    });
    check(true, 'chat clearance follows expanded code composer height');
    await page.locator('#code-toggle').click();

    await route('review');
    const review = await page.evaluate(() => {
      const layout = document.querySelector('#layout').getBoundingClientRect();
      const workspace = document.querySelector('#workspace').getBoundingClientRect();
      const output = getComputedStyle(document.querySelector('#conversation-scroll'));
      return {layoutWidth:layout.width, workspaceWidth:workspace.width, divider:output.borderLeftWidth,
        bodyOverflow:getComputedStyle(document.body).overflowY,
        sendBottom:document.querySelector('#send').getBoundingClientRect().bottom,
        pageHeight:document.documentElement.scrollHeight};
    });
    check(Math.abs(review.layoutWidth - 1440) <= 1 && Math.abs(review.workspaceWidth - 1440) <= 1, 'review layout is full bleed');
    check(review.divider === '0px', 'review removes the old center boundary');
    check(review.bodyOverflow === 'auto' && review.pageHeight >= 1000, 'review uses reachable page scrolling');
    const reviewForm = await page.locator('#ask-form').evaluate(node => {
      const style = getComputedStyle(node);
      const input = getComputedStyle(document.querySelector('#code'));
      return {shadow:style.boxShadow,blur:style.backdropFilter,radius:style.borderRadius,font:input.fontSize,fontFamily:input.fontFamily};
    });
    check(reviewForm.shadow === 'none' && reviewForm.blur === 'none' && reviewForm.radius === '0px',
      'review form has no residual outer canvas shadow or glass boundary');
    check(parseFloat(reviewForm.font) >= 16 && reviewForm.fontFamily.includes('Microsoft YaHei'),
      'review code has readable size and Chinese fallback');
    await page.keyboard.press('End');
    check(await page.locator('#send').isVisible(), 'review bottom action remains reachable');

    await route('knowledge');
    const mapGlass = await page.evaluate(() => {
      const search = getComputedStyle(document.querySelector('#map-search'));
      const reset = getComputedStyle(document.querySelector('#map-reset'));
      return {searchBlur:search.backdropFilter || search.webkitBackdropFilter,
        resetBlur:reset.backdropFilter || reset.webkitBackdropFilter};
    });
    check(mapGlass.searchBlur.includes('blur') && mapGlass.resetBlur.includes('blur'), 'knowledge controls use glass material');
    const mapBackground = await page.evaluate(() => {
      const view = document.querySelector('#knowledge-view').getBoundingClientRect();
      return {top:view.top,height:view.height,body:getComputedStyle(document.body).backgroundColor,
        view:getComputedStyle(document.querySelector('#knowledge-view')).backgroundColor};
    });
    check(mapBackground.top === 0 && mapBackground.height === 1000 && mapBackground.body === mapBackground.view,
      'knowledge scene extends behind navigation with one dark background');
    await page.screenshot({path:'output/playwright/glass-repair-map-desktop.png'});

    for (const view of ['home','knowledge','history','chat','review']) {
      await route(view);
      await noOverflow(`desktop ${view} has no horizontal overflow`);
      const bounds = await page.locator('.nav-shell').boundingBox();
      check(Math.abs(bounds.x - nav.left) < .5 && bounds.y === 14 && bounds.width === nav.width,
        `desktop ${view} keeps navigation coordinates`);
      check(await page.locator('#main-nav a[aria-current="page"]').evaluate(node => {
        const style = getComputedStyle(node);
        return parseFloat(style.borderRadius) >= 999 && style.boxShadow.includes('inset') && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
      }), `desktop ${view} has selected capsule highlight`);
    }
    const gutterBounds = [];
    for (const gutter of ['stable','auto']) {
      await page.evaluate(value => { document.documentElement.style.scrollbarGutter = value; }, gutter);
      gutterBounds.push(await page.locator('.nav-shell').boundingBox());
    }
    check(gutterBounds.every(box => Math.abs(box.x - nav.left) < .5 && box.width === nav.width),
      'scrollbar reservation does not shift navigation');
    await page.evaluate(() => { document.documentElement.style.scrollbarGutter = ''; });
    const modePositions = [];
    const previousMode = await page.locator('#runtime-mode').textContent();
    for (const mode of ['模拟版','真实AI','搜索已开启']) {
      await page.locator('#runtime-mode').evaluate((node, text) => { node.textContent = text; }, mode);
      modePositions.push(await page.locator('#main-nav').boundingBox());
    }
    check(modePositions.every(box => box.x === modePositions[0].x && box.width === modePositions[0].width),
      'mode label length does not shift navigation links');
    await page.locator('#runtime-mode').evaluate((node, text) => { node.textContent = text; }, previousMode);

    await page.locator('#more-toggle').click();
    const menuGlass = await page.locator('#more-panel').evaluate(node => {
      const style = getComputedStyle(node);
      return {blur:style.backdropFilter || style.webkitBackdropFilter, radius:parseFloat(style.borderRadius), shadow:style.boxShadow};
    });
    check(menuGlass.blur.includes('blur') && menuGlass.radius >= 18 && menuGlass.shadow !== 'none', 'more menu uses glass material');
    await page.locator('#version-open').click();
    const versionGlass = await page.locator('#version-dialog').evaluate(node => {
      const style = getComputedStyle(node);
      return {blur:style.backdropFilter || style.webkitBackdropFilter, radius:parseFloat(style.borderRadius)};
    });
    check(versionGlass.blur.includes('blur') && versionGlass.radius >= 24, 'version dialog uses glass material');
    await page.locator('#version-close').click();
    await page.locator('#more-toggle').click();
    await page.locator('#model-open').click();
    const modelGlass = await page.locator('#model-dialog').evaluate(node => {
      const style = getComputedStyle(node);
      return {blur:style.backdropFilter || style.webkitBackdropFilter, radius:parseFloat(style.borderRadius)};
    });
    check(modelGlass.blur.includes('blur') && modelGlass.radius >= 24, 'model dialog uses glass material');
    await page.locator('#model-close').click();

    await page.setViewportSize({width:390, height:844});
    await route('chat');
    const mobileNav = await page.locator('.nav-shell').evaluate(node => {
      const box = node.getBoundingClientRect(), style = getComputedStyle(node);
      return {left:box.left, right:box.right, radius:parseFloat(style.borderRadius), blur:style.backdropFilter || style.webkitBackdropFilter};
    });
    check(mobileNav.left >= 8 && mobileNav.right <= 382 && mobileNav.radius >= 18 && mobileNav.blur.includes('blur'), 'mobile navigation remains floating glass');
    for (const view of ['home','knowledge','history','chat','review']) {
      await route(view);
      const bounds = await page.locator('.nav-shell').boundingBox();
      check(Math.abs(bounds.x - mobileNav.left) < .5 && bounds.y === 10 && bounds.width === mobileNav.right - mobileNav.left,
        `mobile ${view} keeps navigation coordinates`);
      await page.locator('#nav-toggle').click();
      check(await page.locator('#main-nav a[aria-current="page"]').evaluate(node => {
        const style = getComputedStyle(node);
        return parseFloat(style.borderRadius) >= 999 && style.boxShadow.includes('inset');
      }), `mobile ${view} has selected capsule highlight`);
      await page.locator('#nav-toggle').click();
    }
    await route('chat');
    await page.locator('#nav-toggle').click();
    const mobileMenu = await page.locator('#main-nav').evaluate(node => {
      const style = getComputedStyle(node), rgba = style.backgroundColor.match(/[\d.]+/g).map(Number);
      return {alpha:rgba.length > 3 ? rgba[3] : 1, blur:style.backdropFilter || style.webkitBackdropFilter};
    });
    check(mobileMenu.alpha >= .9 && mobileMenu.blur.includes('blur'), 'mobile navigation menu stays readable over content');
    await page.locator('#nav-toggle').click();
    const composer = await page.locator('#ask-form').boundingBox();
    check(composer.x >= 8 && composer.x + composer.width <= 382, 'mobile glass composer stays inside viewport');
    check(composer.width < (await page.locator('.assistant-answer').boundingBox()).width,
      'mobile input is narrower than answer dialog');
    await noOverflow('mobile chat has no horizontal overflow');
    await route('review');
    await noOverflow('mobile review has no horizontal overflow');
    await page.screenshot({path:'output/playwright/glass-repair-review-mobile.png',fullPage:true});
    await route('chat');
    await page.locator('#conversation-scroll').evaluate(node => { node.scrollTop = node.scrollHeight; });
    const mobileEnd = await page.locator('.message .followups').last().evaluate(node =>
      node.getBoundingClientRect().bottom <= document.querySelector('#ask-form').getBoundingClientRect().top);
    check(mobileEnd, 'mobile last response actions remain readable above input');
    await page.screenshot({path:'output/playwright/glass-repair-chat-mobile.png'});
    check(errors.length === 0, 'no uncaught glass interface errors');
    return {passed:checks.length, checks, errors};
  } finally {
    page.off('pageerror', onError);
  }
}
