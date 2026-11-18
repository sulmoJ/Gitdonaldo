'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { start } = require('../server.js');

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitdonaldo-test-'));
  const g = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  g('init', '-q', '-b', 'main');
  g('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'first');
  g('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'second');
  return dir;
}

const getJSON = async (url) => {
  const r = await fetch(url);
  return { status: r.status, body: await r.json() };
};

test('start({port: 0}) picks a free port and serves the API', async (t) => {
  const repo = makeRepo();
  const app = await start({ port: 0, defaultRepo: repo });
  t.after(() => app.close());

  assert.ok(app.port > 0);
  assert.strictEqual(app.url, `http://127.0.0.1:${app.port}`);

  assert.deepStrictEqual((await getJSON(`${app.url}/api/health`)).body, { ok: true });

  const info = await getJSON(`${app.url}/api/repo`);
  assert.strictEqual(info.status, 200);
  assert.strictEqual(info.body.currentBranch, 'main');

  const commits = await getJSON(`${app.url}/api/commits`);
  assert.deepStrictEqual(commits.body.map((c) => c.subject), ['second', 'first']);

  const page = await fetch(`${app.url}/`);
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /<title>Gitdonaldo<\/title>/);
});

test('two servers can run side by side', async (t) => {
  const a = await start({ port: 0 });
  const b = await start({ port: 0 });
  t.after(() => Promise.all([a.close(), b.close()]));
  assert.notStrictEqual(a.port, b.port);
});

test('defaultRepo: null requires ?repo=', async (t) => {
  const repo = makeRepo();
  const app = await start({ port: 0, defaultRepo: null });
  t.after(() => app.close());

  const none = await getJSON(`${app.url}/api/repo`);
  assert.strictEqual(none.status, 400);
  assert.strictEqual(none.body.error, 'no repo selected');

  const withRepo = await getJSON(`${app.url}/api/repo?repo=${encodeURIComponent(repo)}`);
  assert.strictEqual(withRepo.status, 200);
});

test('start() rejects when the port is taken', async (t) => {
  const a = await start({ port: 0 });
  t.after(() => a.close());
  await assert.rejects(start({ port: a.port }), { code: 'EADDRINUSE' });
});

test('close() resolves and frees the port', async () => {
  const a = await start({ port: 0 });
  await a.close();
  const b = await start({ port: a.port });
  await b.close();
});

test('`node server.js` still listens on PORT (browser mode)', async (t) => {
  const repo = makeRepo();
  const probe = await start({ port: 0 });
  const port = probe.port;
  await probe.close();

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), REPO: repo },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => { if (String(d).includes('ready')) resolve(); });
    child.on('exit', (code) => reject(new Error(`exited early: ${code}`)));
  });
  const info = await getJSON(`http://127.0.0.1:${port}/api/repo`);
  assert.strictEqual(info.body.name, path.basename(repo));
});

// ---- security (Electron M3) ------------------------------------------------------------

const http = require('node:http');

function rawGet(port, pathName, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathName, headers }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

test('token: /api/* requires x-gitdonaldo-token when start({token})', async (t) => {
  const repo = makeRepo();
  const app = await start({ port: 0, defaultRepo: repo, token: 'secret-token' });
  t.after(() => app.close());

  assert.strictEqual((await rawGet(app.port, '/api/repo')).status, 403);
  assert.strictEqual((await rawGet(app.port, '/api/health')).status, 403);
  assert.strictEqual((await rawGet(app.port, '/api/repo', { 'x-gitdonaldo-token': 'wrong' })).status, 403);
  assert.strictEqual((await rawGet(app.port, '/api/repo', { 'x-gitdonaldo-token': 'secret-token' })).status, 200);
  // static UI is still served without the token
  assert.strictEqual((await rawGet(app.port, '/')).status, 200);
});

test('token: not required when start() has no token (browser mode)', async (t) => {
  const repo = makeRepo();
  const app = await start({ port: 0, defaultRepo: repo });
  t.after(() => app.close());
  assert.strictEqual((await rawGet(app.port, '/api/repo')).status, 200);
});

test('host check: only 127.0.0.1:<port> and localhost:<port> are accepted', async (t) => {
  const app = await start({ port: 0 });
  t.after(() => app.close());

  assert.strictEqual((await rawGet(app.port, '/', { host: `127.0.0.1:${app.port}` })).status, 200);
  assert.strictEqual((await rawGet(app.port, '/', { host: `localhost:${app.port}` })).status, 200);
  assert.strictEqual((await rawGet(app.port, '/', { host: `evil.example:${app.port}` })).status, 403);
  assert.strictEqual((await rawGet(app.port, '/api/health', { host: 'evil.example' })).status, 403);
});

test('security headers are sent on every response', async (t) => {
  const app = await start({ port: 0 });
  t.after(() => app.close());

  for (const p of ['/', '/app.js', '/api/health', '/missing']) {
    const { headers } = await rawGet(app.port, p);
    assert.match(headers['content-security-policy'], /default-src 'self'/, p);
    assert.strictEqual(headers['x-content-type-options'], 'nosniff', p);
  }
});

test('UI has no inline scripts or inline style attributes (CSP compatible)', () => {
  const dir = path.join(__dirname, '..', 'public');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/);
  for (const f of ['index.html', 'app.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /style="/, f);
  }
});
