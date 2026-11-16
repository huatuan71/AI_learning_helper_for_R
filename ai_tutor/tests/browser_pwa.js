/* Standalone real-browser acceptance. See docs/offline-pwa.md for setup.
 * Default mode supplies only absent handoff resources and a course/map adapter.
 * --integrated requires the real merged UI and learning modules, with no substitutes.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const backend = process.env.PWA_BASE_URL || 'http://127.0.0.1:8013';
const integrated = process.argv.includes('--integrated');
const checks = [];
const handoff = ['learning-store.js', 'review-scheduler.js', 'learning-center.js',
  'learning-center.css', 'review-bank.json'];
const check = (condition, name) => { assert.ok(condition, name); checks.push(name); };

function harness(html) {
  // Exercise the actual KnowledgeMap against the four public offline exports.
  // Production app.js and knowledge-map.js fallback wiring belongs to the UI thread.
  return html.replace(/<script type="module" src="[^\"]*bootstrap[^\"]*"><\/script>/,
    `<script type="module">
      import * as offline from '/static/offline.js?v=learning-v1';
      import '/static/knowledge-map.js?v=learning-v1';
      window.offline = offline;
      await offline.registerOffline();
      let course;
      try {
        const response = await fetch('/offline-course.json');
        if (!response.ok) throw Error('course');
        course = await response.json();
      } catch { course = await offline.getOfflineCourse(); }
      if (course) {
        document.querySelector('#home-view').hidden = true;
        document.querySelector('#knowledge-view').hidden = false;
        const units = [...new Set(course.knowledge.map(item => item.chapter))];
        window.pwaMap = new window.KnowledgeMap({units,
          api: async url => {
            try {
              const response = await fetch(url);
              if (!response.ok) throw Error('network');
              return await response.json();
            } catch {
              const saved = await offline.getOfflineCourse();
              const item = saved?.knowledge.find(item => url.endsWith('/' + item.id));
              if (!item) throw Error('missing detail');
              return item;
            }
          }, explain() {}, exercise() {},
          codeBlock(node, text) { const pre = document.createElement('pre'); pre.textContent = text; node.append(pre); }
        });
        window.pwaMap.load(course.knowledge, course.relations);
      }
    </script>`);
}

async function main() {
  const sourceCourse = JSON.parse(await fs.readFile(path.join(root, 'data/course.json'), 'utf8'));
  const html = await fs.readFile(path.join(root, 'static/index.html'), 'utf8');
  const worker = await fs.readFile(path.join(root, 'static/service-worker.js'), 'utf8');
  const resourceVersion = worker.match(/const RESOURCE_VERSION = '([^']+)'/)[1];
  const state = {fixtures: !integrated, failedPath: null, disconnect: false,
    course: sourceCourse, workerVersion: resourceVersion, extraAsset: false, slow: false};
  const hits = [];
  const missing = [];
  for (const file of handoff) {
    try { await fs.access(path.join(root, 'static', file)); }
    catch { missing.push(file); }
  }
  if (integrated) assert.deepEqual(missing, [], 'Merge all handoff files before --integrated');
  const bankFixture = {version: 'test-contract-bank-v1', items: sourceCourse.knowledge.flatMap(item =>
    ['concept', 'application'].map(type => ({id: `${item.id}-${type}`, knowledgeId: item.id, type,
      format: 'self', prompt: item.title, hint: '', reference: item.fields['解释'],
      sourceRefs: [{knowledgeId: item.id, field: '解释'}], variantOf: null})))};
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    hits.push({path: url.pathname, method: req.method});
    try {
      if (url.pathname === state.failedPath) {
        if (state.disconnect) return res.destroy();
        res.writeHead(503, {'Content-Type': 'text/plain'});
        return res.end('test-only missing resource');
      }
      if (state.slow && url.pathname === '/') await new Promise(resolve => setTimeout(resolve, 180));
      if (url.pathname === '/' && !integrated) {
        res.writeHead(200, {'Content-Type': 'text/html'});
        return res.end(harness(html));
      }
      if (url.pathname === '/sw.js') {
        let script = worker.replace(/const RESOURCE_VERSION = '[^']+'/, `const RESOURCE_VERSION = '${state.workerVersion}'`);
        if (state.extraAsset) script = script.replace('const ASSETS = [', "const ASSETS = [\n  '/static/update-fixture.js',");
        res.writeHead(200, {'Content-Type': 'application/javascript', 'Service-Worker-Allowed': '/',
          'Cache-Control': 'no-store'});
        return res.end(script);
      }
      if (url.pathname === '/static/update-fixture.js' && state.extraAsset) {
        res.writeHead(200, {'Content-Type': 'application/javascript'});
        return res.end('export const updatedPackage = true;');
      }
      if (url.pathname === '/offline-course.json') {
        res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        return res.end(JSON.stringify(state.course));
      }
      const file = url.pathname.replace('/static/', '');
      if (state.fixtures && missing.includes(file)) {
        const json = file.endsWith('.json');
        res.writeHead(200, {'Content-Type': json ? 'application/json' : file.endsWith('.css') ? 'text/css' : 'application/javascript'});
        return res.end(json ? JSON.stringify(bankFixture) : file.endsWith('.css') ? '/* test-only handoff fixture */' : 'export const testContractFixture = true;');
      }
      // Proxy to a real FastAPI process. No model/config/health request is synthesized.
      const target = new URL(req.url, backend);
      const upstream = http.request(target, {method: req.method, headers: req.headers}, response => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      });
      upstream.on('error', error => { res.writeHead(502); res.end(error.message); });
      req.pipe(upstream);
    } catch (error) { res.writeHead(500); res.end(error.message); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const output = path.resolve(root, 'output/playwright');
  await fs.mkdir(output, {recursive: true});
  // Chromium adds hashed cache directories beneath this path on Windows.
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'r-tutor-pwa-'));
  const launchOptions = {headless: true, viewport: {width: 1440, height: 1000},
    args: ['--enable-unsafe-swiftshader', '--host-resolver-rules=MAP r-tutor.test 127.0.0.1']};
  if (process.env.PWA_BROWSER_CHANNEL) launchOptions.channel = process.env.PWA_BROWSER_CHANNEL;
  let context;
  let browserVersion;
  let actualPersistence;
  const call = (page, method) => page.evaluate(async method => {
    const offline = await import('/static/offline.js?v=learning-v1');
    return offline[method]();
  }, method);
  const save = page => page.evaluate(async () => {
    const offline = await import('/static/offline.js?v=learning-v1');
    const progress = [];
    try {
      const result = await offline.downloadOffline(state => progress.push(state));
      return {ok: true, result, progress};
    } catch (error) { return {ok: false, message: error.message, code: error.code, progress}; }
  });
  try {
    context = await chromium.launchPersistentContext(profile, launchOptions);
    browserVersion = context.browser().version();
    let page = context.pages()[0];
    await page.goto(origin);
    const registration = await call(page, 'registerOffline');
    check(registration.supported && registration.registered, 'first installation waits for activation');
    check(!(await call(page, 'getOfflineStatus')).ready, 'installation alone is not a completed package');
    state.failedPath = '/static/icons/icon-512.png';
    const incomplete = await save(page);
    check(!incomplete.ok && !(await call(page, 'getOfflineStatus')).ready, 'missing resource rejects initial download');
    state.failedPath = null;
    const complete = await save(page);
    check(complete.ok, 'complete whitelist downloads and verifies' + (complete.message ? ' — ' + complete.message : ''));
    actualPersistence = complete.result.persistence;
    const progress = complete.progress;
    check(progress[0].completed === 0 && progress.at(-1).completed === complete.result.assetCount &&
      progress.every((item, index) => item.completed === index), 'per-resource progress is monotonic and complete');
    const first = await call(page, 'getOfflineStatus');
    check(first.ready && first.knowledgeVersion === sourceCourse.version && first.resourceVersion === resourceVersion &&
      /^[a-f0-9]{64}$/.test(first.bundleVersion) && first.reviewBankVersion, 'versions derive from verified downloaded bytes');
    const repeatedEvents = await page.evaluate(async () => {
      const offline = await import('/static/offline.js?v=learning-v1');
      let count = 0;
      const listener = () => { count++; };
      window.addEventListener('r-tutor-offline', listener);
      await offline.getOfflineStatus();
      await offline.registerOffline();
      window.removeEventListener('r-tutor-offline', listener);
      return count;
    });
    check(repeatedEvents === 0, 'status reads avoid recursive unchanged-state UI notifications');
    const images = await page.evaluate(async () => {
      for (const name of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
        const image = new Image(); image.src = '/static/icons/' + name; await image.decode();
        if (image.naturalWidth < 180) return false;
      }
      return true;
    });
    check(images, 'browser decodes all three PNG installation icons');
    await context.setOffline(true);
    await page.reload();
    check((await call(page, 'getOfflineCourse')).knowledge.length === 43, 'offline reload recovers the complete course');
    await page.evaluate(() => { location.hash = '/knowledge'; });
    if (integrated) {
      await page.locator('#map-search').fill('K06');
      await page.locator('.scene-orb-label[data-id=K06]').click();
    } else await page.evaluate(() => window.pwaMap.select('K06'));
    await page.waitForFunction(() => document.querySelector('#detail-body').textContent.includes('is.na'));
    check(await page.locator('#map-detail').isVisible(), integrated ? 'merged UI opens offline map details' : 'contract adapter opens actual KnowledgeMap offline details');
    const hitCount = hits.length;
    const cached = await page.evaluate(async () => {
      const response = await fetch('/static/vendor/three/three.module.min.js?v=old-build');
      return response.ok && (await response.text()).length > 100000;
    });
    check(cached && hits.length === hitCount, 'Three.js cache hit normalizes build queries with zero server traffic');
    const liveOffline = await page.evaluate(async () => {
      const results = [];
      for (const [url, method] of [['/api/health', 'GET'], ['/api/ai/config', 'GET'],
        ['/api/chat', 'POST'], ['/api/chat/stream', 'POST']]) {
        try { await fetch(url, {method}); results.push(false); }
        catch { results.push(true); }
      }
      return results.every(Boolean);
    });
    check(liveOffline, 'health configuration POST and SSE require live network while offline');
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: path.join(output, 'pwa-offline-map-mobile.png')});
    await context.close(); context = null;
    context = await chromium.launchPersistentContext(profile, launchOptions);
    await context.setOffline(true);
    page = context.pages()[0];
    await page.goto(origin + '/?reopen=1');
    check((await call(page, 'getOfflineStatus')).ready && (await call(page, 'getOfflineCourse')).version === sourceCourse.version,
      'browser process close and reopen preserves offline startup');
    await context.setOffline(false);
    const onlineHealth = await page.evaluate(async () => (await fetch('/api/health')).json());
    check(onlineHealth.status === 'ok', 'restored network reads actual backend health');
    state.course = {...sourceCourse, version: sourceCourse.version + '-test-update'};
    state.failedPath = '/static/icons/icon-512.png'; state.disconnect = true;
    const interrupted = await save(page);
    check(!interrupted.ok && (await call(page, 'getOfflineStatus')).bundleVersion === first.bundleVersion &&
      (await call(page, 'getOfflineCourse')).version === sourceCourse.version, 'interrupted update preserves previous complete version');
    state.failedPath = null; state.disconnect = false;
    const worker = context.serviceWorkers()[0];
    await worker.evaluate(() => {
      globalThis.__pwaOriginalPut = Cache.prototype.put;
      Cache.prototype.put = function () { return Promise.reject(new DOMException('test quota', 'QuotaExceededError')); };
    });
    const quota = await save(page);
    await worker.evaluate(() => { Cache.prototype.put = globalThis.__pwaOriginalPut; });
    check(quota.code === 'QUOTA_EXCEEDED' && (await call(page, 'getOfflineStatus')).ready, 'quota failure reports actionable error and retains old package');
    await page.evaluate(() => Object.defineProperty(navigator.storage, 'persist', {configurable: true, value: undefined}));
    state.slow = true;
    const tab = await context.newPage(); await tab.goto(origin);
    const [updated, sameUpdate] = await Promise.all([save(page), save(tab)]);
    state.slow = false;
    check(updated.ok && sameUpdate.ok && updated.result.bundleVersion === sameUpdate.result.bundleVersion,
      'concurrent tabs join one complete update');
    check(updated.result.persistence.supported === false, 'unsupported persistent-storage request remains observable');
    check((await call(tab, 'getOfflineCourse')).version === state.course.version, 'other tab reads updated snapshot');
    await tab.close();
    state.workerVersion = 'learning-v2-test';
    state.extraAsset = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
    });
    await page.waitForFunction(async () => {
      const offline = await import('/static/offline.js?v=learning-v1');
      return (await offline.getOfflineStatus()).updateAvailable;
    });
    check((await call(page, 'getOfflineStatus')).ready, 'new worker with added resources keeps the previous complete shell available');
    const upgraded = await save(page);
    check(upgraded.ok && upgraded.result.resourceVersion === 'learning-v2-test' &&
      upgraded.result.assetCount === first.assetCount + 1, 'expanded resource manifest commits only after complete download');
    const networkStart = hits.length;
    const model = await page.evaluate(async () => {
      const config = await fetch('/api/ai/config');
      const chat = await fetch('/api/chat', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({question: 'mean中的na.rm怎么用？'})});
      const stream = await fetch('/api/chat/stream', {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({question: 'NA是什么'})});
      return {config: config.ok, chat: chat.ok, stream: stream.ok && (await stream.text()).includes('event:')};
    });
    check(model.config && model.chat && model.stream && hits.slice(networkStart).some(hit => hit.path === '/api/chat/stream'),
      'configuration chat and SSE reach real FastAPI after reconnect');
    const cacheKeys = await page.evaluate(async () => {
      const result = [];
      for (const name of await caches.keys()) {
        if (name.startsWith('r-language-tutor-offline:')) {
          result.push(...(await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname));
        }
      }
      return result;
    });
    check(!cacheKeys.some(key => key.startsWith('/api/')), 'CacheStorage contains public assets and excludes every API response');
    const completedCount = await page.evaluate(async () => {
      return (await caches.keys()).filter(name => name.startsWith('r-language-tutor-offline:')).length;
    });
    check(completedCount === 2, 'cleanup retains two complete packages after failures and updates');
    const insecure = await context.newPage();
    await insecure.goto(`http://r-tutor.test:${server.address().port}/`);
    const insecureState = await call(insecure, 'registerOffline');
    check(!insecureState.supported && await insecure.evaluate(() => !isSecureContext),
      'plain HTTP hostname has no offline capability and returns HTTPS guidance');
    await insecure.close();
    // A changed cache body fails its SHA-256 check and rolls back to a complete package.
    await page.evaluate(async () => {
      const packages = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith('r-language-tutor-offline:')) continue;
        const cache = await caches.open(name);
        const response = await cache.match('/__r_tutor_offline_commit__');
        if (response) packages.push({cache, meta: await response.json()});
      }
      packages.sort((a, b) => b.meta.downloadedAt.localeCompare(a.meta.downloadedAt));
      await packages[0].cache.put('/static/app.js', new Response('corrupted bytes',
        {headers: {'Content-Type': 'application/javascript'}}));
    });
    const rollback = await call(page, 'getOfflineStatus');
    check(rollback.ready && rollback.resourceVersion === resourceVersion, 'corrupt package hash rolls back to the previous verified version');
    // Remove required data from every completed package to simulate eviction.
    await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('r-language-tutor-offline:')) await (await caches.open(name)).delete('/static/review-bank.json');
      }
    });
    check(!(await call(page, 'getOfflineStatus')).ready && await call(page, 'getOfflineCourse') === null,
      'missing cached resource invalidates readiness and snapshot availability');
    const report = {mode: integrated ? 'integrated' : 'contract-fixtures', platform: process.platform,
      browser: 'Chromium ' + browserVersion, desktop: '1440x1000', mobileEmulation: '390x844',
      missingHandoffFiles: missing, persistence: actualPersistence, checks, passed: checks.length,
      physicalDevices: 'Android/iOS/macOS/Windows installation pending'};
    await fs.writeFile(path.join(output, 'pwa-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (context) await context.close();
    await new Promise(resolve => server.close(resolve));
    if (path.dirname(profile) !== path.resolve(os.tmpdir()) || !path.basename(profile).startsWith('r-tutor-pwa-')) {
      throw Error('Unexpected browser profile cleanup path');
    }
    await fs.rm(profile, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
