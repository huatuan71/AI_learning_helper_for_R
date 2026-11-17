/* Update RESOURCE_VERSION with an incompatible shell release. Public resources only. */
const RESOURCE_VERSION = 'ai-exercise-v1';
const CACHE_PREFIX = 'r-language-tutor-offline:';
const COMMIT_PATH = '/__r_tutor_offline_commit__';
const ASSETS = [
  '/',
  '/static/index.html',
  '/static/style.css',
  '/static/learning.css',
  '/static/model-settings.css',
  '/static/learning-center.css',
  '/static/bootstrap.js',
  '/static/offline.js',
  '/static/app.js',
  '/static/api-client.js',
  '/static/answer-renderer.js',
  '/static/knowledge-map.js',
  '/static/liquid-scene.js',
  '/static/r-file.js',
  '/static/model-settings.js',
  '/static/answer-markdown.js',
  '/static/learning-store.js',
  '/static/review-scheduler.js',
  '/static/learning-center.js',
  '/static/learning-summary-data.js',
  '/static/learning-summary-ui.js',
  '/static/ai-exercise-data.js',
  '/static/ai-exercise-ui.js',
  '/static/vendor/three/three.module.min.js',
  '/static/vendor/marked/marked.js',
  '/static/vendor/dompurify/purify.js',
  '/static/review-bank.json',
  '/offline-course.json',
  '/static/manifest.webmanifest',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/apple-touch-icon.png'
];
// The current course has no rendered image URLs. Add actual course images here when introduced.
const ALLOWED = new Set(ASSETS);
let downloadJob = null;
const progressPorts = new Set();

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

async function digest(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function committedPackages() {
  const packages = [];
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX)) continue;
    try {
      const cache = await caches.open(name);
      const response = await cache.match(COMMIT_PATH);
      if (!response) continue;
      const meta = await response.json();
      // A committed manifest belongs to the release that wrote it. A newer shell
      // can add resources while the previous complete package remains available.
      if (meta.schema === 1 && Array.isArray(meta.assets) && meta.assets.length > 0 &&
          meta.assets.every(asset => ALLOWED.has(asset.path) && /^[a-f0-9]{64}$/.test(asset.sha256)) &&
          new Set(meta.assets.map(asset => asset.path)).size === meta.assets.length &&
          meta.assets.some(asset => asset.path === '/offline-course.json')) {
        packages.push({cache, meta, name});
      }
    } catch { /* An interrupted or malformed package cannot become active. */ }
  }
  return packages.sort((a, b) => b.meta.downloadedAt.localeCompare(a.meta.downloadedAt));
}

async function verifyPackage(pack, hashes = false) {
  for (const asset of pack.meta.assets) {
    const response = await pack.cache.match(asset.path);
    if (!response?.ok) return false;
    if (hashes && await digest(await response.arrayBuffer()) !== asset.sha256) return false;
  }
  return true;
}

async function activePackage(hashes = false) {
  for (const pack of await committedPackages()) {
    if (await verifyPackage(pack, hashes)) return pack;
  }
  return null;
}

async function status() {
  const pack = await activePackage(true);
  if (!pack) return {ready: false, knowledgeVersion: null, downloadedAt: null, assetCount: 0,
    resourceVersion: RESOURCE_VERSION, bundleVersion: null, reviewBankVersion: null};
  return {ready: true, knowledgeVersion: pack.meta.knowledgeVersion,
    downloadedAt: pack.meta.downloadedAt, assetCount: pack.meta.assets.length,
    resourceVersion: pack.meta.resourceVersion, bundleVersion: pack.meta.bundleVersion,
    reviewBankVersion: pack.meta.reviewBankVersion,
    updateAvailable: pack.meta.resourceVersion !== RESOURCE_VERSION};
}

function expectedType(path) {
  if (path === '/' || path.endsWith('.html')) return 'text/html';
  if (path.endsWith('.js')) return 'javascript';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.png')) return 'image/png';
  return 'json';
}

async function checkContent(path, response, bytes) {
  const type = response.headers.get('Content-Type') || '';
  if (!response.ok || !bytes.byteLength || !type.includes(expectedType(path))) {
    throw Error(`资源校验失败 ${path}（HTTP ${response.status}，${type}）`);
  }
  if (path.endsWith('.png')) {
    const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
    if (header.join(',') !== '137,80,78,71,13,10,26,10') throw Error(`无效 PNG ${path}`);
  }
  if (path.endsWith('.json') || path.endsWith('.webmanifest')) return JSON.parse(new TextDecoder().decode(bytes));
  return null;
}

function reportProgress(state) {
  for (const port of progressPorts) port.postMessage({type: 'progress', state});
}

async function downloadPackage() {
  const name = `${CACHE_PREFIX}${RESOURCE_VERSION}:${crypto.randomUUID()}`;
  const cache = await caches.open(name);
  let committed = false;
  try {
    const assets = [];
    let course, bank;
    reportProgress({completed: 0, total: ASSETS.length});
    for (const path of ASSETS) {
      const response = await fetch(path, {cache: 'no-store', credentials: 'omit', redirect: 'error',
        signal: AbortSignal.timeout(20000)});
      const bytes = await response.clone().arrayBuffer();
      const content = await checkContent(path, response, bytes);
      if (path === '/offline-course.json') course = content;
      if (path === '/static/review-bank.json') bank = content;
      assets.push({path, sha256: await digest(bytes), bytes: bytes.byteLength});
      await cache.put(path, response);
      reportProgress({completed: assets.length, total: ASSETS.length, path});
    }
    if (typeof course?.version !== 'string' || !course.version || !Array.isArray(course.knowledge) ||
        course.knowledge.length !== 43 || new Set(course.knowledge.map(item => item.id)).size !== 43 ||
        !course.knowledge.every(item => /^K(0[1-9]|[1-3]\d|4[0-3])$/.test(item.id)) ||
        !Array.isArray(course.relations) || !Array.isArray(course.questions) ||
        !Array.isArray(course.errors)) throw Error('课程快照结构校验失败');
    if (typeof bank?.version !== 'string' || !Array.isArray(bank.items) || !bank.items.length ||
        new Set(bank.items.map(item => item.id)).size !== bank.items.length ||
        bank.items.some(item => typeof item.reference !== 'string' || !item.reference.trim()) ||
        !course.knowledge.every(topic => ['concept','application'].every(type =>
          bank.items.some(item => item.knowledgeId === topic.id && item.type === type && !item.variantOf)))) {
      throw Error('复习题库与参考答案校验失败');
    }
    const meta = {schema: 1, resourceVersion: RESOURCE_VERSION, knowledgeVersion: course.version,
      reviewBankVersion: bank.version, assets,
      bundleVersion: await digest(new TextEncoder().encode(JSON.stringify(assets)))};
    if (!await verifyPackage({cache, meta}, true)) throw Error('离线资源写入校验失败');
    meta.downloadedAt = new Date().toISOString();
    // This final write is the sole publication point. Partial caches have no commit record.
    await cache.put(COMMIT_PATH, new Response(JSON.stringify(meta), {headers: {'Content-Type': 'application/json'}}));
    committed = true;
    // Retain the newest complete package and one complete rollback version.
    // Uncommitted caches may belong to another worker and are left alone.
    try {
      const packages = await committedPackages();
      for (const old of packages.slice(2)) await caches.delete(old.name);
    } catch { /* Publication has succeeded even if old-cache cleanup is denied. */ }
    const clients = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
    for (const client of clients) client.postMessage({type: 'R_TUTOR_OFFLINE_CHANGED', at: meta.downloadedAt});
    return {course, knowledgeVersion: course.version, downloadedAt: meta.downloadedAt,
      assetCount: assets.length, resourceVersion: RESOURCE_VERSION,
      reviewBankVersion: bank.version, bundleVersion: meta.bundleVersion};
  } finally {
    if (!committed) await caches.delete(name);
  }
}

async function reply(event) {
  const port = event.ports[0];
  if (!port || !event.source?.url || new URL(event.source.url).origin !== self.location.origin) return;
  try {
    let value;
    if (event.data?.type === 'DOWNLOAD') {
      progressPorts.add(port);
      // Tabs sharing this worker join one download and receive the same verified result.
      if (!downloadJob) downloadJob = downloadPackage().finally(() => { downloadJob = null; });
      value = await downloadJob;
    } else if (event.data?.type === 'STATUS') value = await status();
    else if (event.data?.type === 'COURSE') {
      const pack = await activePackage(true);
      value = pack ? await (await pack.cache.match('/offline-course.json')).json() : null;
    } else return;
    port.postMessage({type: 'result', value});
  } catch (error) {
    const quota = error.name === 'QuotaExceededError';
    port.postMessage({type: 'error', code: quota ? 'QUOTA_EXCEEDED' : 'DOWNLOAD_FAILED',
      message: quota ? '浏览器存储空间不足，请释放空间后重试。' : error.message});
  } finally { progressPorts.delete(port); }
}
self.addEventListener('message', event => event.waitUntil(reply(event)));

async function cachedResource(request, path) {
  for (const pack of await committedPackages()) {
    if (!await verifyPackage(pack, path === '/' || path === '/static/index.html')) continue;
    const response = await pack.cache.match(path);
    if (response) {
      const asset = pack.meta.assets.find(item => item.path === path);
      if (asset && await digest(await response.clone().arrayBuffer()) === asset.sha256) return response;
    }
  }
  return fetch(request);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !ALLOWED.has(url.pathname)) return;
  // Query build markers share canonical public bytes inside a complete package.
  event.respondWith(cachedResource(request, url.pathname));
});
