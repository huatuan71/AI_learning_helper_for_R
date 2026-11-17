async (page, baseUrl = 'http://127.0.0.1:8000') => {
  const checks = [], errors = [];
  const check = (condition, name) => {
    if (!condition) throw Error(name);
    checks.push(name);
  };
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const notice = page.locator('#status');
  const rejectChat = route => route.fulfill({status:409, contentType:'application/json', body:JSON.stringify({
    request_id:'notice-idle-test', error:{code:'CONFIG_REQUIRED', message:'请重新配置模型。'}
  })});
  const showValidation = async () => {
    await page.locator('#question').fill('');
    await page.locator('#send').click();
    await notice.waitFor({state:'visible'});
  };
  const showConfiguration = async () => {
    await page.locator('#question').fill('缺失值');
    await page.locator('#send').click();
    await page.locator('#status-action').waitFor({state:'visible'});
    await page.waitForFunction(() => !document.querySelector('#send').disabled);
  };
  try {
    await page.setViewportSize({width:1440,height:1000});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(baseUrl + '/#/chat');
    await page.waitForFunction(() => document.body.dataset.learningReady === 'true' &&
      document.querySelector('#model-provider').options.length > 0);
    await page.clock.install();
    await page.route('**/api/chat', rejectChat);

    await showValidation();
    await page.clock.fastForward(4000);
    check(await notice.isVisible(), 'idle notification remains visible before five seconds');
    await page.clock.fastForward(1100);
    check(await notice.isHidden(), 'idle notification dismisses after five seconds');

    await showValidation();
    await page.locator('#status-message').hover();
    await page.clock.fastForward(6000);
    check(await notice.isVisible(), 'hovering the message itself pauses dismissal');
    await page.mouse.move(20,650);
    await page.clock.fastForward(4000);
    check(await notice.isVisible(), 'pointer exit starts a fresh five-second interval');
    await page.clock.fastForward(1100);
    check(await notice.isHidden(), 'notification dismisses five seconds after pointer exit');

    await showValidation();
    await page.clock.fastForward(4000);
    await showValidation();
    await page.clock.fastForward(4000);
    check(await notice.isVisible(), 'a replacement notification cancels the old dismissal timer');
    await page.clock.fastForward(1100);
    check(await notice.isHidden(), 'replacement notification receives its own five seconds');

    await showConfiguration();
    await page.locator('#status-action').focus();
    await page.clock.fastForward(6000);
    check(await notice.isVisible(), 'keyboard focus pauses dismissal of the configuration action');
    await page.locator('#question').focus();
    await page.clock.fastForward(4000);
    check(await notice.isVisible(), 'focus exit restarts the full interval');
    await page.clock.fastForward(1100);
    check(await notice.isHidden(), 'notification dismisses after focus leaves');

    await showConfiguration();
    await page.locator('#status-action').hover();
    await page.clock.fastForward(6000);
    check(await notice.isVisible(), 'hovering the action keeps it available');
    await page.locator('#status-action').click();
    await page.locator('#model-dialog').waitFor({state:'visible'});
    check(true, 'configuration shortcut still opens the model dialog');
    await page.locator('#model-apply').click();
    await page.waitForFunction(() => document.querySelector('#model-feedback').textContent.includes('设置已应用'));
    check(await notice.isHidden(), 'applying settings clears the notification and its timer');
    await page.keyboard.press('Escape');

    await showValidation();
    await page.locator('#status-message').hover();
    await page.mouse.down();
    await page.mouse.move(20,650);
    await page.clock.fastForward(6000);
    check(await notice.isVisible(), 'a held pointer pauses dismissal after leaving the notice');
    await page.mouse.up();
    await page.clock.fastForward(5100);
    check(await notice.isHidden(), 'releasing outside the notice resumes dismissal');

    await page.setViewportSize({width:390,height:844});
    await showValidation();
    const message = await page.locator('#status-message').boundingBox();
    await page.touchscreen.tap(message.x + message.width / 2, message.y + message.height / 2);
    await page.clock.fastForward(5100);
    check(await notice.isHidden(), 'touch interaction does not leave a sticky hover pause');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390px notification has no horizontal overflow');
    check(errors.length === 0, 'no uncaught notification errors');
    return {passed:checks.length,checks,errors};
  } finally {
    await page.unroute('**/api/chat',rejectChat);
    page.off('pageerror',onError);
  }
}
