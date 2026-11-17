// Start isolated local services and run the existing browser acceptance suites.
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {parseArgs} = require('node:util');

const root = path.resolve(__dirname, '..');
const children = new Set();
let stopping = false;
let cleanupPromise;

function options() {
  const {values} = parseArgs({options: {
    python: {type: 'string'},
    suite: {type: 'string', default: 'all'},
    browser: {type: 'string', default: 'chromium'},
    help: {type: 'boolean', default: false},
  }});
  if (!['all', 'regression', 'pwa', 'integration'].includes(values.suite)) {
    throw Error('--suite must be all, regression, pwa or integration');
  }
  if (!['chromium', 'webkit'].includes(values.browser)) {
    throw Error('--browser must be chromium or webkit');
  }
  if (values.browser === 'webkit' && values.suite !== 'integration') {
    throw Error('--browser webkit requires --suite integration');
  }
  return values;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function health(url) {
  return new Promise(resolve => {
    const request = http.get(url + '/api/health', response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        try { resolve(response.statusCode === 200 && JSON.parse(body).status === 'ok'); }
        catch { resolve(false); }
      });
      response.on('error', () => resolve(false));
    });
    request.setTimeout(1000, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function startServer(python, script) {
  const port = await freePort();
  if (stopping) throw Error('Browser checks interrupted');
  const url = 'http://127.0.0.1:' + port;
  const child = spawn(python, [script, '--port', String(port)], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, APP_ENV: 'development', RENDER: '', PYTHONIOENCODING: 'utf-8'},
  });
  children.add(child);
  let output = '';
  let error;
  child.on('error', value => { error = value; });
  const record = chunk => { output = (output + chunk.toString()).slice(-8192); };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (error) throw error;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw Error(script + ' exited during startup\n' + output);
    }
    if (await health(url)) return url;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw Error(script + ' startup timed out\n' + output);
}

async function runSuite(script, args, env) {
  if (stopping) throw Error('Browser checks interrupted');
  console.log('Running ' + script);
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root, env, windowsHide: true, stdio: 'inherit',
  });
  children.add(child);
  const timer = setTimeout(() => child.kill(), 300000);
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (code === 0) resolve();
        else reject(Error(script + ' failed with ' + (signal || 'exit code ' + code)));
      });
    });
  } finally {
    clearTimeout(timer);
    children.delete(child);
  }
}

function stopChildren() {
  cleanupPromise ||= Promise.all([...children].map(child => new Promise(resolve => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.once('error', () => { clearTimeout(timer); resolve(); });
    child.kill();
  }))).then(() => children.clear());
  return cleanupPromise;
}

async function main() {
  const args = options();
  if (args.help) {
    console.log('node scripts/test_browser.cjs [--python PATH] [--suite all|regression|pwa|integration] [--browser chromium|webkit]');
    return;
  }
  require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const defaultPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const python = args.python || process.env.PYTHON || defaultPython;
  if (!fs.existsSync(python) && python === defaultPython) {
    throw Error('Install requirements-dev.txt in .venv or provide --python PATH');
  }
  try {
    const base = await startServer(python, 'scripts/serve.py');
    const env = {...process.env, BASE_URL: base, PWA_BASE_URL: base, BROWSER: args.browser};
    if (['all', 'regression'].includes(args.suite)) {
      env.AI_BASE_URL = await startServer(python, 'tests/browser_fixture_server.py');
      await runSuite('tests/browser_regression.cjs', [], env);
      await runSuite('tests/browser_learning_summary.js', [], {...env, BASE_URL: env.AI_BASE_URL});
      await runSuite('tests/browser_ai_exercises.js', [], {...env, BASE_URL: env.AI_BASE_URL});
      await runSuite('tests/browser_summary_storage.cjs', [], env);
      await runSuite('tests/browser_exercise_storage.cjs', [], env);
    }
    if (['all', 'pwa'].includes(args.suite)) {
      await runSuite('tests/browser_pwa.js', ['--integrated'], env);
    }
    if (['all', 'integration'].includes(args.suite)) {
      await runSuite('tests/browser_integration.cjs', [], env);
    }
  } finally {
    await stopChildren();
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    stopping = true;
    await stopChildren();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
