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
