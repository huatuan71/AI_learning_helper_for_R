async (page, baseUrl = 'http://127.0.0.1:8000') => {
  const checks = [], samples = [], errors = [];
  const check = (value, name) => { if (!value) throw Error(name); checks.push(name); };
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const ready = () => page.waitForFunction(() => document.body.dataset.learningReady === 'true');
  const tabReady = tab => page.waitForFunction(tab =>
    document.querySelector(`[data-learning-tab="${tab}"]`)?.hasAttribute('aria-current'), tab);
  const measure = () => page.evaluate(() => {
    const rect = selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return {x:box.x, y:box.y, width:box.width};
    };
    return {title:rect('#history-title'), tabs:rect('#learning-tabs'), nav:rect('.nav-shell'),
      height:document.documentElement.scrollHeight, scroll:scrollY,
      overflow:document.documentElement.scrollWidth > innerWidth};
  });
  const sameRect = (a, b) => ['x','y','width'].every(key => Math.abs(a[key] - b[key]) < .5);
  const mainRoute = async view => {
    await page.evaluate(view => { location.hash = '/' + view; }, view);
    await page.waitForFunction(view => document.body.dataset.view === view &&
      document.querySelector('#main-content').getAnimations().length === 0, view);
  };
  const captureExport = async (trigger, parse = JSON.parse) => {
    await page.evaluate(() => {
      window.__layoutOriginalURL = URL.createObjectURL;
      URL.createObjectURL = blob => {
        window.__layoutExport = blob.text();
        return window.__layoutOriginalURL(blob);
      };
    });
    try {
      const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
      const data = parse(await page.evaluate(() => window.__layoutExport));
      return {name:download.suggestedFilename(), data};
    } finally {
      await page.evaluate(() => {
        URL.createObjectURL = window.__layoutOriginalURL;
        delete window.__layoutOriginalURL;
        delete window.__layoutExport;
      });
    }
  };
  try {
    await page.setViewportSize({width:1440, height:1000});
    await page.goto(baseUrl + '/#/history', {waitUntil:'domcontentloaded'});
    await ready();
    await page.reload({waitUntil:'domcontentloaded'});
    await ready();
    check(await page.evaluate(() => history.scrollRestoration === 'manual'), 'hash router controls browser scroll restoration');
    // This suite runs in an isolated browser context, as do the other regression suites.
    await page.evaluate(async () => {
      const {learningStore} = await import('/static/learning-store.js?v=learning-v1');
      await learningStore.resetLearningData();
      await learningStore.ingestConversation({time:new Date().toISOString(),
        request:{question:'缺失值布局测试', task_type:'concept', knowledge_id:'K06'},
        response:{request_id:'learning-layout-test', status:'ok', mode:'mock', task_type:'concept',
          related_knowledge:['K06'], answer:{summary:'使用 is.na() 检查缺失值。', steps:[], issues:[], follow_ups:[]}, citations:[]}});
      await learningStore.enroll('K06');
    });
    // Force classic scrollbars to reproduce the original 8px shift on desktop.
    const classicScrollbar = await page.addStyleTag({content:'::-webkit-scrollbar { width:16px; height:16px; }'});
    for (const width of [1440, 390]) {
      await page.setViewportSize({width, height:width === 390 ? 844 : 1000});
      await mainRoute('home');
      const header = await page.locator('.nav-shell').boundingBox();
      await mainRoute('history');
      let baseline;
      const heights = [];
      for (const tab of ['overview', 'review', 'summary', 'records', 'overview']) {
        await page.locator(`[data-learning-tab="${tab}"]`).click();
        await tabReady(tab);
        await page.waitForTimeout(120);
        const current = await measure();
        samples.push({width, tab, ...current});
        baseline ||= current;
        heights.push(current.height);
        check(sameRect(current.title, baseline.title) && sameRect(current.tabs, baseline.tabs), `${width}px ${tab} title and tab bar stay aligned`);
        check(sameRect(current.nav, header), `${width}px ${tab} floating navigation stays fixed`);
        check(!current.overflow, `${width}px ${tab} has no horizontal overflow`);
      }
      check(Math.max(...heights) - Math.min(...heights) > 100, `${width}px checks cover different content heights`);
      await page.evaluate(() => window.scrollTo({top:300, behavior:'instant'}));
      check(await page.evaluate(() => scrollY > 100), `${width}px overview can scroll normally`);
      await page.evaluate(() => { location.hash = '/history/summary'; });
      await tabReady('summary');
      await page.locator('#learning-report .lc-section').first().waitFor();
      await page.waitForTimeout(120);
      check(await page.evaluate(() => scrollY === 0), `${width}px switching long tabs resets scroll immediately`);
      await page.goBack();
      await tabReady('overview');
      await page.waitForTimeout(120);
      check(await page.evaluate(() => scrollY === 0), `${width}px browser back aligns the tab header`);
      await page.locator('[data-learning-tab="overview"]').focus();
      await page.keyboard.press('ArrowRight');
      await tabReady('review');
      check(await page.evaluate(() => document.activeElement?.dataset.learningTab === 'review'), `${width}px keyboard navigation retains tab focus`);
      await page.screenshot({path:`output/playwright/learning-layout-${width}.png`, fullPage:true});
    }
    await classicScrollbar.evaluate(style => style.remove());
    await page.setViewportSize({width:1440, height:1000});
    await page.locator('[data-learning-tab="records"]').click();
    await tabReady('records');
    const menuExport = await captureExport(async () => {
      await page.locator('#more-toggle').click();
      await page.locator('#export').click();
      await page.locator('#export-format-conversations').check();
      await page.locator('#export-download').click();
    });
    const recordsExport = await captureExport(async () => {
      await page.locator('#history-export').click();
      await page.locator('#export-format-conversations').check();
      await page.locator('#export-download').click();
    });
    check(JSON.stringify(menuExport.data) === JSON.stringify(recordsExport.data), 'more-menu and records-tab exports share the same conversation payload');
    check(menuExport.data.records.length === 1 && menuExport.name === 'r-tutor-conversations.json', 'conversation export contains the saved conversation');
    await page.locator('[data-learning-tab="summary"]').click();
    await tabReady('summary');
    await page.locator('#learning-report').waitFor();
    const weeklyExport = await captureExport(() => page.getByRole('button', {name:'导出文本周报', exact:true}).click(), text => text);
    check(/^r-tutor-weekly-report_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.txt$/.test(weeklyExport.name), 'weekly report uses an ASCII filename');
    check(weeklyExport.data.includes('学习小结'), 'weekly report retains Chinese learning content');
    await page.locator('#learning-tools').evaluate(node => { node.open = true; });
    const archiveExport = await captureExport(async () => {
      await page.locator('#learning-tools-content').getByRole('button', {name:'导出学习档案', exact:true}).click();
      await page.locator('#export-download').click();
    });
    check(archiveExport.name === 'r-tutor-learning-archive.json', 'full archive uses an ASCII filename');
    check(archiveExport.data.app === 'r-language-tutor' && archiveExport.data.schemaVersion === 2, 'full archive has the versioned restore format');
    check(archiveExport.data.data.conversations.length === 1 && archiveExport.data.data.events.length > 0 &&
      archiveExport.data.data.cards.length === 2 && Array.isArray(archiveExport.data.data.attempts) &&
      Array.isArray(archiveExport.data.data.bookmarks) && archiveExport.data.data.settings.dailyLimit === 6,
      'full archive additionally contains learning events, review cards, attempts, bookmarks and settings');
    check(!('course' in archiveExport.data.data), 'course downloads are independent of the personal archive');
    await page.emulateMedia({media:'print'});
    check(await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter === 'auto'), 'printing removes the screen scrollbar gutter');
    await page.emulateMedia({media:'screen', reducedMotion:'reduce'});
    await page.locator('[data-learning-tab="overview"]').click();
    await page.locator('[data-learning-tab="records"]').click();
    check(await page.evaluate(() => scrollY === 0), 'reduced-motion tab changes align the page immediately');
    await mainRoute('chat');
    check(await page.evaluate(() => !document.documentElement.classList.contains('learning-history')), 'learning scrollbar policy is scoped to the history view');
    check(errors.length === 0, 'no uncaught errors');
    return {passed:checks.length, checks, samples, errors};
  } finally {
    page.off('pageerror', onError);
  }
}
