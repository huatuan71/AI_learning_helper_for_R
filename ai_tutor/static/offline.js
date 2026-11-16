/* Public, origin-local course packages. Personal archives belong to learningStore. */
let registrationPromise = null;
let listening = false;
let persistence = {supported: false, granted: null, error: null};

function publish(state) {
  const previous = window.__rTutorOffline || {};
  if (Object.entries(state).every(([key, value]) => previous[key] === value)) return;
  window.__rTutorOffline = {...window.__rTutorOffline, ...state};
  window.dispatchEvent(new CustomEvent('r-tutor-offline', {detail: window.__rTutorOffline}));
}

function supported() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window &&
    Boolean(window.crypto?.subtle);
}

function waitForActivation(registration) {
  if (registration.active?.state === 'activated') return Promise.resolve(registration);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(Error('离线服务尚未激活，请联网重试。')), 15000);
    const worker = registration.installing || registration.waiting || registration.active;
    const check = () => {
      if (registration.active?.state === 'activated') finish();
      else if (worker?.state === 'redundant') finish(Error('离线服务安装失败，请联网重试。'));
    };
    function finish(error) {
      clearTimeout(timer);
      worker?.removeEventListener('statechange', check);
      if (error) reject(error);
      else resolve(registration);
    }
    worker?.addEventListener('statechange', check);
    check();
  });
}

export async function registerOffline() {
  if (!supported()) {
    const state = {supported: false, registered: false,
      error: '此地址或浏览器无法启用离线服务。请使用 HTTPS 或本机 localhost。'};
    publish(state);
    return state;
  }
  if (!listening) {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'R_TUTOR_OFFLINE_CHANGED') publish({changedAt: event.data.at});
    });
    listening = true;
  }
  try {
    if (!registrationPromise) {
      registrationPromise = navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'})
        .then(waitForActivation);
    }
    await registrationPromise;
    const state = {supported: true, registered: true, error: null};
    publish(state);
    return state;
  } catch (error) {
    registrationPromise = null;
    const state = {supported: true, registered: false, error: error.message};
    publish(state);
    return state;
  }
}

async function requestWorker(type, onProgress) {
  const state = await registerOffline();
  if (!state.registered) throw Error(state.error);
  const registration = await registrationPromise;
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    let timer;
    const finish = (error, value) => {
      clearTimeout(timer);
      channel.port1.close();
      if (error) reject(error);
      else resolve(value);
    };
    const heartbeat = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(Error('离线服务响应超时，请检查连接后重试。')), 60000);
    };
    channel.port1.onmessage = event => {
      heartbeat();
      const message = event.data;
      if (message.type === 'progress') {
        // A UI listener failure must not interrupt a verified package download.
        try { onProgress?.(message.state); } catch (error) { console.error(error); }
      } else if (message.type === 'error') {
        const error = Error(message.message);
        error.code = message.code;
        finish(error);
      } else if (message.type === 'result') finish(null, message.value);
    };
    heartbeat();
    registration.active.postMessage({type}, [channel.port2]);
  });
}

export async function getOfflineStatus() {
  if (typeof navigator.storage?.persisted === 'function') {
    try { persistence = {...persistence, granted: await navigator.storage.persisted(),
      supported: typeof navigator.storage.persist === 'function'}; }
    catch (error) { persistence = {...persistence, error: error.message}; }
  }
  const base = {supported: supported(), ready: false, knowledgeVersion: null,
    downloadedAt: null, assetCount: 0, persistence};
  if (!base.supported) return {...base, error: '离线服务需要 HTTPS 或本机 localhost。'};
  try {
    return {...base, ...await requestWorker('STATUS'), persistence};
  } catch (error) {
    return {...base, error: error.message};
  }
}

export async function downloadOffline(onProgress) {
  // Call this method directly from the user's save action to retain user activation.
  const storage = navigator.storage;
  persistence = {supported: typeof storage?.persist === 'function', granted: null, error: null};
  if (persistence.supported) {
    try { persistence.granted = await storage.persist(); }
    catch (error) { persistence.error = error.message; }
  }
  publish({persistence});
  const result = await requestWorker('DOWNLOAD', onProgress);
  publish({ready: true, knowledgeVersion: result.knowledgeVersion,
    downloadedAt: result.downloadedAt, assetCount: result.assetCount});
  return {...result, persistence};
}

export async function getOfflineCourse() {
  if (!supported()) return null;
  try { return await requestWorker('COURSE'); }
  catch { return null; }
}
