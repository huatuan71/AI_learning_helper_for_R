async (page, baseUrl = 'http://127.0.0.1:8014') => {
  const checks = [], errors = [];
  const check = (condition, name) => {
    if (!condition) throw Error(name);
    checks.push(name);
  };
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  const route = async view => {
    await page.evaluate(view => { location.hash = '/' + view; }, view);
    await page.waitForFunction(view => document.body.dataset.view === view, view);
    await page.waitForTimeout(300);
  };
  try {
    await page.setViewportSize({width:1440,height:1000});
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto(baseUrl+'/#/knowledge');
    await page.waitForFunction(() => document.querySelectorAll('.scene-orb-label').length === 43);
    // Capture the existing scene for assertions without adding a production debug API.
    await page.evaluate(() => {
      const prototype = window.KnowledgeMap.prototype;
      const original = prototype.updateOrbs;
      prototype.updateOrbs = function (...args) {
        window.__sceneForTest = this;
        prototype.updateOrbs = original;
        return original.apply(this, args);
      };
    });
    await page.waitForFunction(() => !!window.__sceneForTest);
    const initial = await page.evaluate(() => ({
      count:window.__sceneForTest.orbSlots.length,
      phase:window.__sceneForTest.orbitPhase,
      time:window.__sceneForTest.elapsedSeconds,
    }));
    check(initial.count === 43, '43 real knowledge orbs participate in revolution');
    await page.waitForTimeout(300);
    const motion = await page.evaluate(initial => {
      const scene = window.__sceneForTest;
      return {phase:scene.orbitPhase - initial.phase,time:scene.elapsedSeconds - initial.time,
        oceanTime:scene.oceanUniforms.uTime.value};
    }, initial);
    check(motion.phase > 0, 'knowledge field revolves automatically');
    check(Math.abs(motion.phase / motion.time - .025) < .000001, 'revolution uses configured constant angular speed');
    check(motion.oceanTime > initial.time, 'ocean waves continue independently');

    const geometry = await page.evaluate(() => {
      const scene = window.__sceneForTest;
      scene.stop();
      scene.active = false;
      scene.orbitPhase = 0;
      scene.fieldYaw = 0;
      scene.fieldTilt = 0;
      scene.hoverId = null;
      scene.resumeOrbitAt = 0;
      scene.updateOrbs(scene.elapsedSeconds, false);
      const before = scene.orbSlots.map(slot => slot.orbitPosition.clone());
      scene.lastFrameTime = 10000;
      for (let index = 1; index <= 20; index++) scene.frame(10000 + index * 50);
      const center = scene.fieldCenter;
      const angles = scene.orbSlots.map((slot, index) => {
        const old = before[index];
        const position = slot.orbitPosition;
        return Math.atan2(position.x - center.x, position.z - center.z) -
          Math.atan2(old.x - center.x, old.z - center.z);
      }).map(angle => Math.atan2(Math.sin(angle), Math.cos(angle)));
      const radiusError = Math.max(...scene.orbSlots.map((slot, index) =>
        Math.abs(slot.orbitPosition.distanceTo(center) - before[index].distanceTo(center))));
      const distanceError = Math.max(...scene.orbSlots.slice(1).map((slot, index) =>
        Math.abs(slot.orbitPosition.distanceTo(scene.orbSlots[0].orbitPosition) - before[index + 1].distanceTo(before[0]))));
      scene.setActive(true);
      return {angles,radiusError,distanceError};
    });
    check(geometry.angles.every(angle => Math.abs(angle - .025) < .000001), 'all 43 orbs have the same angular displacement');
    check(geometry.radiusError < .000001, 'revolution preserves orbit radii');
    check(geometry.distanceError < .000001, 'revolution preserves course cluster spacing');

    await page.mouse.move(660,220);
    const beforeDrag = await page.evaluate(() => {
      const scene = window.__sceneForTest;
      return {camera:scene.camera.position.toArray(),ocean:scene.ocean.matrixWorld.toArray(),yaw:scene.fieldYaw};
    });
    await page.mouse.down();
    await page.mouse.move(820,250,{steps:8});
    await page.mouse.up();
    const drag = await page.evaluate(() => {
      const scene = window.__sceneForTest;
      return {camera:scene.camera.position.toArray(),ocean:scene.ocean.matrixWorld.toArray(),yaw:scene.fieldYaw,phase:scene.orbitPhase};
    });
    check(Math.abs(drag.yaw - beforeDrag.yaw - .48) < .000001, 'rightward drag follows the pointer with reduced sensitivity');
    check(JSON.stringify(drag.camera) === JSON.stringify(beforeDrag.camera), 'drag leaves the overview camera fixed');
    check(JSON.stringify(drag.ocean) === JSON.stringify(beforeDrag.ocean), 'drag leaves the particle ocean orientation fixed');
    await page.waitForTimeout(350);
    check(await page.evaluate(phase => window.__sceneForTest.orbitPhase === phase, drag.phase), 'drag release briefly holds the chosen angle');
    await page.waitForTimeout(850);
    check(await page.evaluate(phase => window.__sceneForTest.orbitPhase > phase, drag.phase), 'revolution resumes after interaction');

    for (const direction of [1, -1]) {
      await page.locator('#map-reset').click();
      const startY = direction === 1 ? 320 : 540;
      await page.mouse.move(680, startY);
      await page.mouse.down();
      await page.mouse.move(680, startY + direction * 40, {steps:4});
      const firstTilt = await page.evaluate(() => window.__sceneForTest.fieldTilt);
      await page.mouse.move(680, startY + direction * 80, {steps:4});
      const secondTilt = await page.evaluate(() => window.__sceneForTest.fieldTilt);
      check(Math.abs(firstTilt * direction - .068) < .000001 && Math.abs(secondTilt * direction - .136) < .000001,
        `vertical drag uses reduced sensitivity and continues beyond the former limit in direction ${direction}`);
      await page.mouse.move(680, startY + direction * 200, {steps:8});
      await page.mouse.up();
      const fullTilt = await page.evaluate(() => window.__sceneForTest.fieldTilt);
      check(Math.abs(fullTilt - direction * Math.PI / 10) < .000001, `vertical drag reaches 18 degrees in direction ${direction}`);
      await page.waitForTimeout(200);
      check(await page.evaluate(tilt => window.__sceneForTest.fieldTilt === tilt, fullTilt), `vertical angle holds after release in direction ${direction}`);
      check(await page.locator('#map-detail').isHidden(), `vertical drag does not open details in direction ${direction}`);
      await page.screenshot({path:`output/playwright/vertical-tilt-${direction === 1 ? 'down' : 'up'}.png`});
    }

    const tiltGeometry = await page.evaluate(() => {
      const scene = window.__sceneForTest;
      scene.stop();
      const config = window.LIQUID_KNOWLEDGE_CONFIG;
      const waveCrest = config.ocean.level + config.ocean.waveHeight * (0.46 + 0.34 + 0.24 + 0.12);
      let clearance = Infinity, spacingError = 0;
      for (const tilt of [-config.revolution.tiltLimit, 0, config.revolution.tiltLimit]) {
        scene.fieldTilt = tilt;
        for (let step = 0; step < 16; step++) {
          scene.fieldYaw = step * Math.PI / 8;
          scene.updateOrbs(scene.elapsedSeconds, false);
          for (const slot of scene.orbSlots) {
            const maximumExtent = slot.baseScale * 1.035 * (1 + config.liquid.waveStrength * (1 + .18 * .32)) + .13;
            clearance = Math.min(clearance, slot.orbitPosition.y - maximumExtent - waveCrest);
            spacingError = Math.max(spacingError, Math.abs(slot.orbitPosition.distanceTo(scene.orbSlots[0].orbitPosition) -
              slot.base.distanceTo(scene.orbSlots[0].base)));
          }
        }
      }
      scene.resetView();
      return {clearance, spacingError};
    });
    check(tiltGeometry.clearance >= .19, 'orbs stay above the maximum wave crest throughout the expanded tilt and revolution range');
    check(tiltGeometry.spacingError < .000001, 'expanded tilt preserves spacing between course orbs');
    await page.locator('#map-reset').click();
    const selected = await page.evaluate(() => {
      const scene = window.__sceneForTest;
      scene.fieldYaw = .65;
      scene.fieldTilt = Math.PI / 12;
      scene.orbitPhase = .3;
      scene.updateOrbs(scene.elapsedSeconds, false);
      const slot = scene.orbSlots.find(slot => slot.item.id === 'K06');
      scene.select('K06');
      return {error:scene.transition.toTarget.distanceTo(slot.orbitPosition),phase:scene.orbitPhase};
    });
    check(selected.error < .000001, 'focus camera targets the current revolved and tilted position');
    await page.waitForFunction(() => document.querySelector('#detail-title')?.textContent.startsWith('K06'));
    await page.waitForTimeout(150);
    check(await page.evaluate(phase => window.__sceneForTest.orbitPhase === phase, selected.phase), 'details pause revolution for reading');
    await page.keyboard.press('Escape');
    check(await page.locator('#map-detail').isHidden(), 'Escape returns from the revolved knowledge detail');
    await page.locator('#map-reset').click();
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForTimeout(100);
    const reduced = await page.evaluate(() => ({phase:window.__sceneForTest.orbitPhase,time:window.__sceneForTest.elapsedSeconds}));
    await page.waitForTimeout(200);
    check(await page.evaluate(before => window.__sceneForTest.orbitPhase === before.phase && window.__sceneForTest.elapsedSeconds === before.time, reduced),
      'reduced motion freezes revolution and ocean time');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await route('chat');
    const paused = await page.evaluate(() => ({phase:window.__sceneForTest.orbitPhase,time:window.__sceneForTest.elapsedSeconds,raf:window.__sceneForTest.raf}));
    await page.waitForTimeout(200);
    check(await page.evaluate(before => window.__sceneForTest.orbitPhase === before.phase && window.__sceneForTest.elapsedSeconds === before.time && window.__sceneForTest.raf === 0, paused),
      'leaving the map pauses scene calculation');
    await route('knowledge');
    check(await page.evaluate(() => window.__sceneForTest.active && window.__sceneForTest.raf !== 0), 'returning to the map resumes rendering');

    await page.evaluate(() => {
      window.__snapshotCalls = 0;
      if (document.startViewTransition) document.startViewTransition = () => { window.__snapshotCalls++; throw Error('Unexpected whole-document snapshot'); };
    });
    for (const view of ['chat','knowledge','chat','home','knowledge']) {
      const frames = await page.evaluate(view => new Promise(resolve => {
        const header = document.querySelector('.app-header');
        const baseline = header.getBoundingClientRect();
        const samples = [];
        const started = performance.now();
        location.hash = '/' + view;
        const sample = () => {
          const box = header.getBoundingClientRect();
          samples.push({fixed:box.x === baseline.x && box.y === baseline.y && box.width === baseline.width,
            visible:getComputedStyle(header).opacity === '1' && header.isConnected,
            contentAnimating:document.querySelector('#main-content').getAnimations().length > 0,
            headerAnimating:header.getAnimations().some(animation => animation.effect.getKeyframes().some(frame => 'opacity' in frame || 'transform' in frame))});
          if (performance.now() - started < 340) requestAnimationFrame(sample);
          else resolve(samples);
        };
        requestAnimationFrame(sample);
      }), view);
      check(frames.length >= 3 && frames.every(frame => frame.visible && frame.fixed && !frame.headerAnimating), `navigation remains continuously visible entering ${view}`);
      check(frames.some(frame => frame.contentAnimating), `only page content fades entering ${view}`);
    }
    check(await page.evaluate(() => window.__snapshotCalls === 0), 'navigation is excluded from whole-document snapshots');
    await page.screenshot({path:'output/playwright/orbit-independent-desktop.png'});
    await page.evaluate(() => { location.hash = '/chat'; location.hash = '/knowledge'; location.hash = '/review'; });
    await page.waitForFunction(() => document.body.dataset.view === 'review');
    await page.waitForTimeout(300);
    check(await page.locator('#workspace-title').textContent() === '代码纠错', 'rapid navigation keeps the final requested page');
    await page.setViewportSize({width:390,height:844});
    await route('knowledge');
    check(await page.locator('.scene-orb-label').count() === 43, 'mobile keeps all 43 revolved knowledge objects');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile revolution has no horizontal page overflow');
    await page.locator('#map-reset').click();
    await page.mouse.move(190, 370);
    await page.mouse.down();
    await page.mouse.move(190, 570, {steps:8});
    await page.mouse.up();
    check(await page.evaluate(() => Math.abs(window.__sceneForTest.fieldTilt - Math.PI / 10) < .000001), '390px viewport retains the full vertical tilt range');
    check(await page.locator('#map-detail').isHidden(), 'mobile vertical drag keeps the map available');
    await page.screenshot({path:'output/playwright/orbit-independent-mobile.png'});
    check(errors.length === 0, 'no uncaught scene or navigation errors');
    return {passed:checks.length,checks,errors};
  } finally {
    page.off('pageerror', onError);
    await page.evaluate(() => { delete window.__sceneForTest; });
  }
}
