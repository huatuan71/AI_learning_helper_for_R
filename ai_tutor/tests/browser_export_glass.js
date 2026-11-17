async (page, baseUrl = 'http://127.0.0.1:8000') => {
  const checks = [], errors = [];
  const check = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const route = async view => {
    await page.evaluate(view => { location.hash = '/' + view; }, view);
    await page.waitForFunction(view => document.body.dataset.view === view.split('/')[0] &&
      document.querySelector('#main-content').getAnimations().length === 0, view);
  };
  const open = async entry => {
    if (entry === 'more') {
      await page.locator('#more-toggle').click();
      await page.locator('#export').click();
    } else if (entry === 'records') {
      await route('history/records');
      await page.locator('#history-export').click();
    } else {
      await route('history');
      await page.locator('#learning-tools').evaluate(node => { node.open = true; });
      await page.locator('#learning-tools-content').getByRole('button', {name:'导出学习档案', exact:true}).click();
    }
  };
  const downloadData = async action => {
    await page.evaluate(() => {
      window.__exportOriginalURL = URL.createObjectURL;
      URL.createObjectURL = blob => {
        window.__exportBlob = blob.text();
        return window.__exportOriginalURL(blob);
      };
    });
    try {
      const [download] = await Promise.all([page.waitForEvent('download'), action()]);
      return {name:download.suggestedFilename(), data:await page.evaluate(async () => JSON.parse(await window.__exportBlob))};
    } finally {
      await page.evaluate(() => {
        URL.createObjectURL = window.__exportOriginalURL;
        delete window.__exportOriginalURL;
        delete window.__exportBlob;
      });
    }
  };
  try {
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(baseUrl + '/?export-test=' + Date.now() + '#/history', {waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.body.dataset.learningReady === 'true');
    // Only this suite's isolated browser data is reset.
    await page.evaluate(async () => {
      const {learningStore} = await import('/static/learning-store.js?v=learning-v1');
      await learningStore.resetLearningData();
      await learningStore.ingestConversation({time:new Date().toISOString(),
        request:{question:'导出测试',knowledge_id:'K06'},
        response:{request_id:'export-glass-test',status:'ok',mode:'mock',task_type:'concept',related_knowledge:['K06'],
          answer:{summary:'使用 is.na() 判断缺失值。',steps:[],issues:[],follow_ups:[]},citations:[]}});
      await learningStore.enroll('K06');
      const at = new Date().toISOString();
      await learningStore.saveBookmark({id:'knowledge:K06',knowledgeId:'K06',conversationId:null,
        title:'K06 缺失值',note:'复习 is.na()',createdAt:at,updatedAt:at});
    });
    let fullData, fullArchive;
    for (const entry of ['more','records','tools']) {
      await open(entry);
      check(await page.locator('#export-dialog').isVisible(), `${entry} opens the shared export dialog`);
      check(await page.locator('#export-format-archive').isChecked(), `${entry} defaults to the complete archive`);
      check(await page.locator('#export-download').textContent() === '导出完整档案', `${entry} states the selected download scope`);
      const result = await downloadData(() => page.locator('#export-download').click());
      check(result.name === 'r-tutor-learning-archive.json' && result.data.app === 'r-language-tutor', `${entry} downloads a restorable archive`);
      fullData ||= result.data.data;
      fullArchive ||= result.data;
      check(JSON.stringify(result.data.data) === JSON.stringify(fullData), `${entry} exports identical personal data`);
      check(await page.locator('#export-dialog').isHidden(), `${entry} closes the dialog after export`);
    }
    check(fullData.conversations.length === 1 && fullData.cards.length === 2 && fullData.bookmarks.length === 1, 'archive contains conversations, review cards and notes');
    const imported = await page.evaluate(async archive => {
      const {learningStore} = await import('/static/learning-store.js?v=learning-v1');
      const result = await learningStore.importArchive(archive);
      const data = await learningStore.snapshot();
      return {duplicates:result.duplicates, conversations:data.conversations.length, cards:data.cards.length, bookmarks:data.bookmarks.length};
    }, fullArchive);
    check(imported.duplicates > 0 && imported.conversations === 1 && imported.cards === 2 && imported.bookmarks === 1, 'default archive is accepted by the existing importer without duplicating data');
    await open('records');
    await page.locator('#export-format-conversations').check();
    check(await page.locator('#export-download').textContent() === '导出对话', 'conversation selection updates the action label');
    const conversation = await downloadData(() => page.locator('#export-download').click());
    check(conversation.name === 'r-tutor-conversations.json' && conversation.data.records.length === 1 && !conversation.data.data, 'conversation selection exports the original conversation format');
    await page.waitForFunction(() => document.activeElement === document.querySelector('#history-export'));
    check(await page.locator('#history-export').evaluate(node => node === document.activeElement), 'record export restores focus to its entry');
    await open('records');
    check(await page.locator('#export-format-archive').isChecked(), 'reopening restores the complete-archive default');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#export-dialog').open && document.activeElement === document.querySelector('#history-export'));
    check(await page.locator('#export-dialog').isHidden() && await page.locator('#history-export').evaluate(node => node === document.activeElement), 'Escape closes the export dialog and restores focus');

    await page.evaluate(async () => {
      const {LearningCenter} = await import('/static/learning-center.js?v=learning-ui-v2');
      window.__originalArchiveExport = LearningCenter.prototype.exportArchive;
      LearningCenter.prototype.exportArchive = async () => { throw Error('测试导出失败'); };
    });
    await open('records');
    await page.locator('#export-download').click();
    await page.waitForFunction(() => document.querySelector('#export-feedback').textContent.includes('测试导出失败'));
    check(await page.locator('#export-dialog').isVisible() && await page.locator('#export-download').isEnabled(), 'failed export preserves the dialog and re-enables retry');
    await page.evaluate(async () => {
      const {LearningCenter} = await import('/static/learning-center.js?v=learning-ui-v2');
      LearningCenter.prototype.exportArchive = window.__originalArchiveExport;
      delete window.__originalArchiveExport;
    });
    await downloadData(() => page.locator('#export-download').click());
    check(await page.locator('#export-dialog').isHidden(), 'retry succeeds after an export error');

    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:width === 390 ? 844 : 1000});
      await route('history');
      await page.evaluate(() => window.scrollTo({top:200,behavior:'instant'}));
      await page.locator('#more-toggle').click();
      const menu = await page.locator('#more-panel').evaluate(node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        return {bodyLevel:node.parentElement === document.body, position:style.position,
          blur:style.backdropFilter || style.webkitBackdropFilter,
          alpha:Number(style.backgroundColor.match(/[\d.]+/g).at(-1)),
          left:box.left,right:box.right,top:box.top,bottom:box.bottom,
          navBottom:document.querySelector('.nav-shell').getBoundingClientRect().bottom};
      });
      check(menu.bodyLevel && menu.position === 'fixed', `${width}px menu escapes the navigation backdrop root`);
      check(menu.blur.includes('blur(28px)') && menu.alpha < .85, `${width}px menu uses translucent frosted glass`);
      check(menu.left >= 8 && menu.right <= width - 8 && menu.top >= menu.navBottom && menu.bottom <= (width === 390 ? 844 : 1000), `${width}px menu stays within the viewport below navigation`);
      await page.screenshot({path:`output/playwright/export-menu-${width}.png`});
      await page.evaluate(() => window.scrollBy({top:100,behavior:'instant'}));
      const moved = await page.locator('#more-panel').boundingBox();
      check(Math.abs(moved.y - menu.top) < 1, `${width}px menu remains anchored during page scrolling`);
      await page.keyboard.press('Escape');
      check(await page.locator('#more-panel').isHidden() && await page.locator('#more-toggle').evaluate(node => node === document.activeElement), `${width}px menu closes and restores focus`);
      await open('more');
      const dialog = await page.locator('#export-dialog').boundingBox();
      check(dialog.width <= width - 24 && dialog.height <= (width === 390 ? 844 : 1000), `${width}px export dialog fits the screen`);
      const layout = await page.locator('#export-options').evaluate(fieldset => {
        const boxes = [...fieldset.querySelectorAll('.export-option')].map(option => {
          const box = option.getBoundingClientRect();
          const title = option.querySelector('strong').getBoundingClientRect();
          const description = option.querySelector('small').getBoundingClientRect();
          return {x:box.x,top:box.top,bottom:box.bottom,width:box.width,
            titleBottom:title.bottom,descriptionTop:description.top,
            descriptionSize:parseFloat(getComputedStyle(option.querySelector('small')).fontSize)};
        });
        return {border:parseFloat(getComputedStyle(fieldset).borderWidth),boxes,
          blur:getComputedStyle(fieldset.closest('dialog')).backdropFilter};
      });
      check(layout.border === 0 && layout.boxes[1].top >= layout.boxes[0].bottom+10,
        `${width}px options form separate rows without a fieldset frame`);
      check(layout.boxes.every(box => Math.abs(box.width-layout.boxes[0].width)<1 && Math.abs(box.x-layout.boxes[0].x)<1),
        `${width}px options use the same full-row alignment`);
      check(layout.boxes.every(box => box.descriptionTop >= box.titleBottom+3 && box.descriptionSize >= 14),
        `${width}px descriptions have readable type and their own line`);
      check(layout.blur.includes('blur(30px)'), `${width}px export dialog uses the shared frosted surface`);
      const downloadBox = await page.locator('#export-download').boundingBox();
      check(downloadBox.height >= 44 && downloadBox.width >= layout.boxes[0].width-1,
        `${width}px export action has a full-width accessible target`);
      await page.locator('#export-conversations-description').click();
      check(await page.getByRole('radio',{name:'对话记录',exact:true}).isChecked(), `${width}px description click selects the whole row`);
      await page.locator('#export-format-conversations').press('ArrowUp');
      check(await page.getByRole('radio',{name:'完整档案',exact:true}).isChecked() &&
        await page.locator('#export-download').textContent() === '导出完整档案', `${width}px arrow keys switch the option and action`);
      await page.keyboard.press('Tab');
      check(await page.evaluate(() => !!document.activeElement.closest('#export-dialog')), `${width}px modal keyboard focus stays inside`);
      await page.screenshot({path:`output/playwright/export-dialog-${width}.png`});
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#export-dialog').open && document.activeElement === document.querySelector('#more-toggle'));
      check(await page.locator('#more-toggle').evaluate(node => node === document.activeElement), `${width}px menu-origin export restores the more button focus`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px has no horizontal overflow`);
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.setViewportSize({width:390,height:360});
    await open('more');
    const short = await page.locator('#export-dialog').boundingBox();
    check(short.y >= 15 && short.y+short.height <= 345, 'short viewport keeps the export panel inside the screen');
    await page.locator('#export-download').scrollIntoViewIfNeeded();
    const shortAction = await page.locator('#export-download').boundingBox();
    check(await page.locator('#export-dialog').evaluate(node => node.scrollTop>0) && shortAction.y >= 0 && shortAction.y+shortAction.height <= 360,
      'short viewport can scroll to the export action inside the panel');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#export-dialog').open);
    await page.setViewportSize({width:1440,height:1000});
    await route('knowledge');
    await page.locator('#more-toggle').click();
    check(await page.locator('#more-panel').evaluate(node => {
      const style = getComputedStyle(node);
      return Number(style.backgroundColor.match(/[\d.]+/g).at(-1)) < .85 && style.color !== 'rgb(29, 29, 31)';
    }), 'knowledge map menu retains a translucent dark glass theme');
    await page.screenshot({path:'output/playwright/export-menu-dark.png'});
    await page.keyboard.press('Escape');
    await page.locator('#more-toggle').focus();
    await page.keyboard.press('ArrowDown');
    check(await page.locator('#more-panel a').first().evaluate(node => node === document.activeElement), 'keyboard opening focuses the first menu item after reparenting');
    await page.keyboard.press('Escape');
    check(errors.length === 0, 'no uncaught export or menu errors');
    return {passed:checks.length,checks,errors};
  } finally { page.off('pageerror', onError); }
}
